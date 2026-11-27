import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { startCollectionBrowserFixture } from './collection-browser-fixture';

test('actual collection API: guest photo + synthetic audio/video commit once, owner gets exact originals and playable previews', { timeout: 90_000 }, async () => {
  const fixture = await startCollectionBrowserFixture();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--host-resolver-rules=MAP collection.localhost 127.0.0.1', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'hu-HU', permissions: ['camera', 'microphone'] });
    const page = await guest.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept());
    await page.goto(`${fixture.origin}/p/${fixture.token}`);
    const panel = page.getByRole('region', { name: 'Csatolt eredeti fájlok', exact: true }); await expect(panel.getByLabel('Fájlok hozzáadása')).toBeVisible();
    const photo = await sharp({ create: { width: 3200, height: 900, channels: 3, background: '#72957f' } }).jpeg({ quality: 93 }).toBuffer();
    await page.locator('.memorybook-editor-toolbar input[type=file]').nth(1).setInputFiles({ name: 'fiktiv-eredeti-foto.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toHaveCount(1);
    for (const label of ['Hangfelvétel indítása', 'Videó felvétele']) {
      await panel.getByRole('button', { name: label, exact: true }).click();
      await expect(panel.getByText(/● Felvétel készül/)).toBeVisible(); await page.waitForTimeout(1200);
      await panel.getByRole('button', { name: 'Felvétel leállítása', exact: true }).click();
      await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toHaveCount(label.startsWith('Hang') ? 2 : 3, { timeout: 20_000 });
    }
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM collection_groups WHERE state=\'submitted\'')).rows[0].n, 0);
    const originals = (await fixture.pool.query('SELECT id,kind,original_bytes,actual_sha256 FROM collection_files ORDER BY kind')).rows;
    assert.equal(originals.length, 3); assert.deepEqual(originals.find(file => file.kind === 'photo').original_bytes, photo);
    for (const file of originals) { assert.equal(createHash('sha256').update(file.original_bytes).digest('hex'), file.actual_sha256); assert.ok(file.original_bytes.length > 100); }
    await mkdir('test-results/collection-guest', { recursive: true }); await panel.screenshot({ path: 'test-results/collection-guest/actual-api-ready.png' });
    await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click(); await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toBeVisible();
    const group = (await fixture.pool.query('SELECT submission_id,canvas_json,preview_bytes FROM collection_groups WHERE page_id=$1', [fixture.pageId])).rows[0];
    assert.ok(group.submission_id); assert.ok(group.preview_bytes.length > 100); assert.ok(group.canvas_json.objects.some((object: { collectionAssetId?: string }) => object.collectionAssetId === originals.find(file => file.kind === 'photo').id));
    const ownerHeaders = { 'x-test-owner': fixture.ownerId };
    const listResponse = await fetch(`${fixture.loopbackOrigin}/api/my/books/${fixture.bookId}/collection`, { headers: ownerHeaders }); assert.equal(listResponse.status, 200);
    const collection = await listResponse.json(), session = collection.sessions.find((item: { groupId: string }) => item.groupId === fixture.pageId);
    assert.equal(session.files.length, 3); assert.equal(session.submissionId, group.submission_id);
    for (const file of session.files) {
      const downloaded = await fetch(fixture.loopbackOrigin + file.originalUrl, { headers: ownerHeaders }); assert.equal(downloaded.status, 200);
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), originals.find(original => original.id === file.id).original_bytes);
      assert.equal((await fetch(fixture.loopbackOrigin + file.originalUrl)).status, 401);
    }
    // The protected media URLs are exercised by real browser decoders, without autoplay.
    await guest.addCookies([fixture.ownerCookie]);
    for (const kind of ['audio', 'video']) {
      const file = session.files.find((item: { kind: string }) => item.kind === kind);
      const playable = await page.evaluate(async ({ kind, url }) => {
        const element = document.createElement(kind === 'audio' ? 'audio' : 'video'); element.preload = 'metadata'; element.controls = true; document.body.append(element);
        return await new Promise<{ duration: number; autoplay: boolean }>((resolve, reject) => {
          const timer = setTimeout(() => { element.remove(); reject(new Error('MEDIA_PREVIEW_TIMEOUT')); }, 10000);
          element.onloadedmetadata = () => { clearTimeout(timer); const result = { duration: element.duration, autoplay: element.autoplay }; element.remove(); resolve(result); };
          element.onerror = () => { clearTimeout(timer); element.remove(); reject(new Error('MEDIA_PREVIEW_FAILED')); }; element.src = url;
        });
      }, { kind, url: file.playbackUrl });
      assert.ok(playable.duration > 0 && playable.duration <= 20); assert.equal(playable.autoplay, false);
    }
    await page.reload(); await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toBeVisible(); assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM collection_groups WHERE state=\'submitted\'')).rows[0].n, 1); assert.deepEqual(errors, []);
  } finally { await browser.close(); await fixture.close(); }
});
