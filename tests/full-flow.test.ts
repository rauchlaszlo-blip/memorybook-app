import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';

test('real auth, legacy regression and wedding browser flow on isolated PostgreSQL', { timeout: 120_000 }, async () => {
  const connectionString = localDatabaseUrl();
  assert.match(new URL(connectionString).pathname, /^\/memorybook_wedding_test/);
  const schema = `flow_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const port = 3003;
  const base = `http://127.0.0.1:${port}`;
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (process.env[key]) childEnv[key] = process.env[key];
  Object.assign(childEnv, {
    NODE_ENV: 'test', DATABASE_URL: connectionString, PGOPTIONS: `-c search_path=${schema}`,
    BETTER_AUTH_SECRET: randomBytes(48).toString('hex'), BETTER_AUTH_URL: base,
    PUBLIC_APP_URL: base, PORT: String(port), BIND_HOST: '127.0.0.1',
    WEDDING_ENABLED: 'true', WEDDING_PILOT_CREATE_ENABLED: 'true', WEDDING_PILOT_USER_IDS: '',
  });
  let output = '';
  let child: ReturnType<typeof spawn> | undefined;
  async function start() {
    output = '';
    child = spawn(process.execPath, ['--import', 'tsx', '--import', './scripts/wedding-no-dotenv.ts', 'server/index.ts'], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout?.on('data', b => { output += String(b); });
    child.stderr?.on('data', b => { output += String(b); });
    for (let i = 0; i < 100; i++) {
      if (output.includes('MemoryBook backend running')) return;
      if (child.exitCode !== null) throw new Error(`Local server failed to start: ${output}`);
      await delay(100);
    }
    throw new Error('Local server did not become ready');
  }
  async function stop() {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
  async function request(path: string, method = 'GET', body?: unknown, cookie = '') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, data: await response.json() };
  }
  const password = randomBytes(24).toString('hex');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await start();
    const a = await request('/api/auth/sign-up/email', 'POST', { name: 'Pilot Owner A', email: 'owner-a@example.test', password });
    assert.equal(a.response.status, 200);
    const b = await request('/api/auth/sign-up/email', 'POST', { name: 'Pilot Owner B', email: 'owner-b@example.test', password });
    assert.equal(b.response.status, 200);
    const userId: string = a.data.user.id;
    await stop(); childEnv.WEDDING_PILOT_USER_IDS = userId; await start();
    const login = await request('/api/auth/sign-in/email', 'POST', { email: 'owner-a@example.test', password });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const loginB = await request('/api/auth/sign-in/email', 'POST', { email: 'owner-b@example.test', password });
    const cookieB = loginB.response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    assert.equal((await request('/api/my/books')).response.status, 401);
    assert.equal((await request('/api/my/books', 'POST', { title: 'No free legacy book' }, cookie)).response.status, 402);
    // Legacy fixtures only in the unique disposable schema, no payment/provider calls.
    await pool.query("INSERT INTO books(id,owner_user_id,title,book_type) VALUES ('legacy-test',$1,'Legacy','standard')", [userId]);
    await pool.query("INSERT INTO pages(id,book_id,page_number) VALUES ('legacy-page','legacy-test',1)");
    const legacyBefore = await pool.query("SELECT * FROM books WHERE id='legacy-test'");
    await migrateWedding(pool); await migrateWedding(pool);
    assert.deepEqual((await pool.query("SELECT * FROM books WHERE id='legacy-test'")).rows, legacyBefore.rows);
    assert.equal((await request('/api/books/legacy-test/pages', 'GET', undefined, cookie)).response.status, 200);
    assert.equal((await request('/api/books/legacy-test/pages', 'GET', undefined, cookieB)).response.status, 404);
    assert.equal((await request('/api/pages/legacy-page', 'PUT', { canvasData: { objects: [] }, expectedVersion: 1 }, cookie)).response.status, 200);
    assert.equal((await request('/api/pages/legacy-page', 'PUT', { canvasData: { objects: [] }, expectedVersion: 1 }, cookie)).response.status, 409);
    assert.equal((await request('/api/pages/legacy-page', 'PUT', { canvasData: { objects: [] }, expectedVersion: 2 }, cookieB)).response.status, 403);
    const invite = await request('/api/my/books/legacy-test/pages/legacy-page/invite', 'POST', {}, cookie);
    assert.equal(invite.response.status, 200);
    assert.equal((await request(`/api/page-invites/${invite.data.inviteToken}`)).response.status, 200);
    assert.equal((await request(`/api/page-invites/${invite.data.inviteToken}`, 'PUT', { canvasData: { objects: [] }, expectedVersion: 2 })).response.status, 200);
    assert.equal((await request(`/api/page-invites/${invite.data.inviteToken}`, 'PUT', { canvasData: { objects: [] }, expectedVersion: 2 })).response.status, 409);

    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' });
    const owner = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await owner.addCookies(login.response.headers.getSetCookie().map(raw => {
      const part = raw.split(';')[0]; const equals = part.indexOf('=');
      return { name: part.slice(0, equals), value: part.slice(equals + 1), url: base };
    }));
    await owner.addInitScript(() => localStorage.setItem('memorybook.appLanguage', 'hu'));
    const page = await owner.newPage();
    await page.goto(base + '/wedding');
    await page.getByLabel('Megjelenített nevek').fill('Ági és Örs');
    await page.getByLabel('Az esküvő dátuma').fill('2027-06-05');
    await page.getByRole('button', { name: 'Vendégkönyv létrehozása', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ági és Örs', exact: true })).toBeVisible();
    const link = await page.getByLabel('Beküldési link', { exact: true }).inputValue();
    await expect(page.getByRole('img', { name: 'QR-kód a vendégeknek' })).toBeVisible();
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await guestContext.addInitScript(() => localStorage.setItem('memorybook.appLanguage', 'hu'));
    const guest = await guestContext.newPage();
    await guest.goto(link);
    await guest.getByLabel('Neved', { exact: true }).fill('Őszinte Éva');
    const text = 'Árvíztűrő tükörfúrógép. <img src=x onerror=alert(1)> Sok boldogságot!';
    await guest.getByLabel('Jókívánságod', { exact: true }).fill(text);
    await guest.screenshot({ path: 'test-results/wedding-mobile-form.png', fullPage: true });
    let dropped = false; let firstKey = ''; let posts = 0;
    await guest.route('**/api/wedding/guest/*/submissions', async route => {
      const body = route.request().postDataJSON();
      posts++;
      if (!dropped) {
        dropped = true; firstKey = body.idempotencyKey;
        await route.fetch(); // Commit succeeds, but the browser never receives the response.
        await route.abort('failed');
      } else { assert.equal(body.idempotencyKey, firstKey); await route.continue(); }
    });
    await guest.getByRole('button', { name: 'Beküldés', exact: true }).click({ clickCount: 2 });
    await expect(guest.getByRole('alert')).toContainText('Nem kaptunk biztos választ');
    await expect(guest.getByLabel('Jókívánságod', { exact: true })).toHaveValue(text);
    assert.equal(posts, 1);
    await page.getByRole('button', { name: 'Frissítés', exact: true }).click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    assert.equal(await page.locator('.wedding-message img').count(), 0);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Beküldés lezárása', exact: true }).click();
    await expect(page.getByText('A beküldés lezárult.', { exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Beküldés újrapróbálása', exact: true }).click();
    await expect(guest.getByText('Köszönjük! A jókívánságod megérkezett.', { exact: true })).toBeVisible();
    const count = await pool.query('SELECT count(*)::int AS n FROM event_submissions');
    assert.equal(count.rows[0].n, 1);
    assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await guest.screenshot({ path: 'test-results/wedding-mobile-success.png', fullPage: true });
    await page.screenshot({ path: 'test-results/wedding-owner.png', fullPage: true });
    await guest.reload();
    await expect(guest.getByText('A beküldés lezárult.', { exact: true })).toBeVisible();
    await page.getByRole('combobox').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Guest QR code' })).toBeVisible();
    await page.getByRole('combobox').selectOption('de');
    await expect(page.getByRole('heading', { name: 'QR-Code für Gäste' })).toBeVisible();
    await browser.close(); browser = undefined;
    // The existing API keeps working with the new product disabled.
    await stop(); childEnv.WEDDING_ENABLED = 'false'; await start();
    assert.equal((await request('/api/wedding/books', 'GET', undefined, cookie)).response.status, 404);
    assert.equal((await request('/api/books/legacy-test/pages', 'GET', undefined, cookie)).response.status, 200);
  } finally {
    await browser?.close(); await stop(); await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
