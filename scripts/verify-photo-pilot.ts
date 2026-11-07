import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

// Explicit operator-run check: isolated pilot and synthetic images only.
const { origin } = JSON.parse(await readFile('test-results/internet-verification.json', 'utf8'));
assert.match(origin, /^https:\/\/memorybook-wedding-text-pilot-[a-z0-9]+\.onrender\.com$/);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const owner = await browser.newContext({ storageState: 'test-results/internet-owner-state.local' });
  await owner.addInitScript(() => localStorage.setItem('memorybook.appLanguage', 'hu'));
  const anon = await browser.newContext();
  const api = origin + '/api/wedding';
  const response = await owner.request.post(api + '/books', { headers: { Origin: origin }, data: { names: 'Automata fotópróba – fiktív', date: '2027-06-05' } });
  assert.equal(response.status(), 201);
  const { book } = await response.json();
  const image = await sharp({ create: { width: 240, height: 120, channels: 3, background: '#da8268' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const key = randomUUID();
  const upload = (bytes: Buffer, uploadKey = key) => anon.request.post(api + '/guest/' + book.invite_token + '/media/' + uploadKey, { headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, data: bytes });
  const uploaded = await upload(image); assert.equal(uploaded.status(), 201);
  const { mediaId } = await uploaded.json();
  const retry = await upload(image); assert.equal(retry.status(), 200); assert.equal((await retry.json()).mediaId, mediaId);
  assert.equal((await owner.request.get(api + '/media/' + mediaId + '/original')).status(), 404);
  const submit = (data: unknown) => anon.request.post(api + '/guest/' + book.invite_token + '/submissions', { headers: { Origin: origin }, data });
  const body = { name: 'Fiktív Éva', message: 'Árvíztűrő fotós jókívánság!', idempotencyKey: key, mediaId };
  assert.equal((await submit(body)).status(), 201); assert.equal((await submit(body)).status(), 200);
  for (const variant of ['original', 'preview', 'display']) {
    assert.equal((await anon.request.get(api + '/media/' + mediaId + '/' + variant)).status(), 401);
    const res = await owner.request.get(api + '/media/' + mediaId + '/' + variant); assert.equal(res.status(), 200);
    assert.match(res.headers()['cache-control'], /no-store/);
    if (variant === 'original') assert.deepEqual(await res.body(), image);
    else { const meta = await sharp(await res.body()).metadata(); assert.equal(meta.width, 120); assert.equal(meta.height, 240); }
  }
  assert.equal((await upload(Buffer.from('<svg/>'), randomUUID())).status(), 415);
  assert.equal((await submit({ name: 'Fiktív Örs', message: 'Fotó nélkül is működik.', idempotencyKey: randomUUID() })).status(), 201);
  const detail = await (await owner.request.get(api + '/books/' + book.id)).json(); assert.equal(detail.submissions.length, 2);
  assert.equal(detail.submissions.filter((s: { media: unknown[] }) => s.media.length === 1).length, 1);
  const page = await owner.newPage(); await page.goto(origin + '/wedding/books/' + book.id);
  await expect(page.getByText(body.message, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fotó nagyobb nézetben' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await page.screenshot({ path: 'test-results/photo-owner-enlarged.png', fullPage: true });
  await page.getByRole('button', { name: 'Vissza az üzenetekhez' }).click();
  await page.screenshot({ path: 'test-results/photo-owner-list.png', fullPage: true });
  assert.equal((await owner.request.post(api + '/books/' + book.id + '/close', { headers: { Origin: origin }, data: {} })).status(), 200);
  assert.equal((await upload(image, randomUUID())).status(), 410);
  assert.equal((await submit({ name: 'Fiktív', message: 'Lezárás után', idempotencyKey: randomUUID() })).status(), 410);
  await writeFile('test-results/photo-verification.json', JSON.stringify({ origin, checkedAt: new Date().toISOString(), bookId: book.id, mediaId, sha256: createHash('sha256').update(image).digest('hex'), result: 'PASS', physicalPhone: 'OPEN' }, null, 2));
  console.log('PASS: HTTPS photo + text, original bytes, orientation, protected variants, idempotent upload/submission, invalid type, text-only, owner enlarged view, closure. Physical camera/gallery tests OPEN.');
} finally { await browser.close(); }
