import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import { Pool } from 'pg';
import { chromium, expect } from '@playwright/test';
import { initializeCollectionFixture, seedCollectionPage } from './collection-fixture';
import { createCollectionTrialAccess, collectionTrialCookie, parseCollectionTrialGrant } from '../server/collection/trial';
import { createCollectionRouter } from '../server/collection/router';

const connectionString = process.env.DATABASE_URL || 'postgresql://memorybook_test@127.0.0.1:5432/memorybook_wedding_test', database = new URL(connectionString);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || !database.pathname.endsWith('_test') || process.env.WEDDING_LOCAL_DATABASE_ACK !== 'yes') throw new Error('Local acknowledged test database required');
const schema = 'trial_collection_' + randomUUID().replaceAll('-', ''), admin = new Pool({ connectionString }), pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
const key = randomBytes(32).toString('base64url'), env = { COLLECTION_PILOT_ENABLED: 'yes', COLLECTION_PILOT_TRIAL: '', PUBLIC_APP_URL: '', NODE_ENV: 'test' };
let fixture: Awaited<ReturnType<typeof seedCollectionPage>>, other: Awaited<ReturnType<typeof seedCollectionPage>>, server: ReturnType<typeof express.application.listen>, origin: string, loopback: string, cookie: string, validGrant: string, fallbackCalls = 0;
const call = (path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string; owner?: boolean } = {}) => fetch(loopback + path, { method: options.method || (options.body === undefined ? 'GET' : 'POST'), redirect: 'manual', headers: { ...(options.cookie === undefined ? {} : { Cookie: options.cookie }), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.owner ? { 'x-test-owner': 'owner-a' } : {}), Origin: options.origin || origin }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); await initializeCollectionFixture(pool); await pool.query('ALTER TABLE books ADD COLUMN invite_token TEXT');
  fixture = await seedCollectionPage(pool); other = await seedCollectionPage(pool);
  const title = 'Esküvői anyaggyűjtés – fiktív próbakönyv'; await pool.query('UPDATE books SET title=$2,invite_token=$3 WHERE id=$1', [fixture.bookId, title, 'trial-guest-book']); await pool.query('UPDATE books SET invite_token=$2 WHERE id=$1', [other.bookId, 'other-guest-book']);
  validGrant = JSON.stringify({ bookId: fixture.bookId, ownerId: fixture.ownerId, title, expiresAt: new Date(Date.now() + 3600_000).toISOString(), tokenHash: createHash('sha256').update(key).digest('hex') }); env.COLLECTION_PILOT_TRIAL = validGrant;
  const app = express(), trial = createCollectionTrialAccess(pool, env); app.use(trial.router);
  app.use(createCollectionRouter({ pool, env, getSession: async req => { if (trial.hasTrialCookie(req)) return trial.getCollectionTrialSession(req); fallbackCalls++; return req.get('x-test-owner') ? { user: { id: req.get('x-test-owner')! } } : null; } }));
  app.get('/api/health', (_req, res) => res.json({ healthy: true }));
  app.use('/api/auth', (_req, res) => res.json({ fullAuthRoute: true })); app.use('/api/payments', (_req, res) => res.json({ paymentRoute: true })); app.get('/api/debug', (_req, res) => res.json({ debug: true }));
  app.use('/api/page-invites', (_req, res) => res.json({ scopedGuestRoute: true })); app.use('/api/invites', (_req, res) => res.json({ scopedGuestRoute: true }));
  app.use(express.static(resolve('dist'))); app.use((_req, res) => res.sendFile(resolve('dist/index.html')));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done)); const address = server.address(); assert.ok(address && typeof address !== 'string'); origin = `http://collection.localhost:${address.port}`; loopback = `http://127.0.0.1:${address.port}`; env.PUBLIC_APP_URL = origin;
  const response = await call('/api/pilot/collection-trial/redeem', { body: { key } }); assert.equal(response.status, 200); cookie = response.headers.get('set-cookie')!.split(';')[0];
});
after(async () => { if (server) await new Promise<void>(done => server.close(() => done())); await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

test('trial grants only this fictional collection, uses secure cookie, and never falls back to full auth', async () => {
  const response = await call('/api/pilot/collection-trial/redeem', { body: { key } }); const header = response.headers.get('set-cookie') || '';
  assert.equal(header.includes('HttpOnly'), true); assert.equal(header.includes('Secure'), true); assert.equal(header.includes('SameSite=Strict'), true); assert.equal(header.includes('Path=/'), true);
  assert.equal((await response.json()).redirectTo, `/my-books/${fixture.bookId}/materials`);
  assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, { cookie })).status, 200);
  assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, {})).status, 401);
  const count = fallbackCalls;
  for (const path of [`/api/my/books/${other.bookId}/collection`, `/api/my/books/${other.bookId}/collection-settings`, '/api/auth/get-session', '/api/payments/paypal/create-order', '/api/debug', '/api/health', '/my-books', `/my-books/${fixture.bookId}`, '/purchase', '/login', `/api/my/books/${fixture.bookId}/collection?bookId=${other.bookId}`]) assert.equal((await call(path, { cookie, owner: true })).status, 404, 'Denied route ' + path);
  assert.equal(fallbackCalls, count);
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call(`/api/my/books/${fixture.bookId}/collection-settings`, { cookie, method: 'PUT', body: { expectedRevision: 0, events: [], locations: [] }, origin: 'https://foreign.invalid' })).status, 403);
  const setting = await call(`/api/my/books/${fixture.bookId}/collection-settings`, { cookie, method: 'PUT', body: { expectedRevision: 0, events: [{ id: randomUUID(), label: 'Fiktív ceremónia', order: 0 }], locations: [] } }); assert.equal(setting.status, 200);
});
test('same-book guest handoff remains scoped; invalid, expired, duplicate and revoked cookies cannot elevate', async () => {
  for (const path of ['/join/trial-guest-book', `/p/${fixture.token}`, '/api/invites/trial-guest-book', `/api/page-invites/${fixture.token}`, `/api/collection/invites/${fixture.token}`]) assert.equal((await call(path, { cookie })).status, 200);
  assert.equal((await call('/api/invites/trial-guest-book/page-session', { cookie, body: {} })).status, 200);
  for (const path of ['/join/other-guest-book', `/p/${other.token}`, '/api/invites/other-guest-book', `/api/page-invites/${other.token}`, `/api/collection/invites/${other.token}`]) assert.equal((await call(path, { cookie })).status, 404);
  for (const invalidCookie of [cookie + '; ' + cookie, `${collectionTrialCookie}=bad`, `${collectionTrialCookie}=`]) assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, { cookie: invalidCookie, owner: true })).status, 404);
  env.COLLECTION_PILOT_TRIAL = JSON.stringify({ ...JSON.parse(validGrant), expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, { cookie, owner: true })).status, 404); assert.equal((await call('/collection/try', { cookie })).status, 200);
  const left = await call('/api/pilot/collection-trial/leave', { cookie, method: 'POST' }); assert.equal(left.status, 200); assert.equal((left.headers.get('set-cookie') || '').startsWith(collectionTrialCookie + '=;'), true);
  env.COLLECTION_PILOT_TRIAL = JSON.stringify({ ...JSON.parse(validGrant), tokenHash: '0'.repeat(64) }); assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, { cookie })).status, 404);
  env.COLLECTION_PILOT_TRIAL = validGrant; await pool.query('UPDATE books SET title=$2 WHERE id=$1', [fixture.bookId, 'Fiktív megváltozott cím']); assert.equal((await call(`/api/my/books/${fixture.bookId}/collection`, { cookie })).status, 404); await pool.query('UPDATE books SET title=$2 WHERE id=$1', [fixture.bookId, JSON.parse(validGrant).title]);
  assert.throws(() => parseCollectionTrialGrant(JSON.stringify({ ...JSON.parse(validGrant), extra: true })), /INVALID_COLLECTION_TRIAL_CONFIG/);
});
test('fresh mobile Chrome redeems fragment into actual collection UI, edits settings, hides broader navigation and leaves', { timeout: 45_000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--host-resolver-rules=MAP collection.localhost 127.0.0.1'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'hu-HU' }), page = await context.newPage(); let leaked = false, redemptions = 0; const errors: string[] = [];
    page.on('request', request => { if (request.url().includes(key)) leaked = true; if (new URL(request.url()).pathname.endsWith('/redeem')) redemptions++; }); page.on('pageerror', error => errors.push(error.name));
    await page.goto(origin + '/collection/try#key=' + key); await expect(page.getByRole('heading', { name: 'Beérkezett anyagok', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Próbamód · fiktív emlékkönyv' })).toBeVisible(); assert.equal(new URL(page.url()).hash, ''); assert.equal(redemptions, 1); assert.equal(leaked, false);
    await expect(page.locator('a[href="/login"]')).toHaveCount(0); await expect(page.locator(`a[href="/my-books/${fixture.bookId}"]`)).toHaveCount(0); await expect(page.getByText('Korábbi oldal megnyitása', { exact: true })).toHaveCount(0);
    await page.locator('summary').filter({ hasText: 'Események és helyszínek' }).click(); await page.getByRole('button', { name: 'Esemény hozzáadása', exact: true }).click(); await page.getByLabel('Esemény neve 2', { exact: true }).fill('Fiktív vacsora'); await page.getByRole('button', { name: 'Beállítások mentése', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Beállítások mentve' })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await mkdir('test-results/collection-trial', { recursive: true }); await page.screenshot({ path: 'test-results/collection-trial/local-mobile-owner.png', fullPage: true });
    await page.getByRole('button', { name: 'Kilépés a próbából', exact: true }).click(); await expect(page.getByRole('heading', { name: 'A MemoryBook kipróbálása', exact: true })).toBeVisible(); assert.equal((await context.cookies()).some(value => value.name === collectionTrialCookie), false); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
