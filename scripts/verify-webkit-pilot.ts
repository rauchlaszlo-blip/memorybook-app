import { webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const { origin, phoneBook } = JSON.parse(await readFile('test-results/internet-verification.json', 'utf8'));
assert.match(origin, /^https:\/\/memorybook-wedding-text-pilot-[a-z0-9]+\.onrender\.com$/);
const oldPhoto = JSON.parse(await readFile('test-results/photo-verification.json', 'utf8'));
const browser = await webkit.launch();
try {
  const owner = await browser.newContext({ storageState: 'test-results/internet-owner-state.local' });
  const original = await owner.request.get(`${origin}/api/wedding/media/${oldPhoto.mediaId}/original`);
  assert.equal(original.status(), 200); assert.equal(createHash('sha256').update(await original.body()).digest('hex'), oldPhoto.sha256);
  const detail = await (await owner.request.get(`${origin}/api/wedding/books/${oldPhoto.bookId}`)).json();
  assert.ok(detail.submissions.some((s: {media: {id: string}[]}) => s.media.some(m => m.id === oldPhoto.mediaId)));
  const create = await owner.request.post(origin + '/api/wedding/books', { headers: { Origin: origin }, data: { names: 'WebKit automata próba – fiktív', date: '2027-06-05' } });
  assert.equal(create.status(), 201); const {book} = await create.json();
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ locale: 'hu-HU', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    if (blocked) await context.addInitScript(() => { for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Storage blocked', 'SecurityError'); } }); });
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(phoneBook.guest_url); await expect(page.getByLabel('Neved', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Kép kiválasztása', { exact: true })).toBeVisible();
    await page.goto(book.guest_url); await page.getByLabel('Neved', { exact: true }).fill('Fiktív WebKit próba');
    await page.getByLabel('Jókívánságod', { exact: true }).fill(blocked ? 'Tiltott tárolás, fotós próba.' : 'Normál tárolás, szöveges próba.');
    if (blocked) {
      const bytes = await sharp({ create: { width: 100, height: 160, channels: 3, background: '#77aa99' } }).png().toBuffer();
      await page.getByLabel('Kép kiválasztása', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: bytes });
      await expect(page.getByAltText('Kiválasztott fotó')).toBeVisible();
      await page.screenshot({ path: 'test-results/webkit-photo-preview.png', fullPage: true });
    }
    await page.getByRole('button', { name: 'Beküldés', exact: true }).click();
    await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.', { exact: true })).toBeVisible();
    assert.deepEqual(errors, []); await context.close();
  }
  const result = await (await owner.request.get(`${origin}/api/wedding/books/${book.id}`)).json(); assert.equal(result.submissions.length, 2);
  assert.equal(result.submissions.filter((s: {media: unknown[]}) => s.media.length === 1).length, 1);
  await writeFile('test-results/webkit-verification.json', JSON.stringify({ checkedAt: new Date().toISOString(), result: 'PASS', persistedPhoto: oldPhoto.mediaId, bookId: book.id, physicalIPhone: 'OPEN' }, null, 2));
  console.log('PASS: deployed WebKit text + PNG, normal and blocked storage, unchanged old guest link, prior-deploy original checksum and association. Physical iPhone OPEN.');
} finally { await browser.close(); }
