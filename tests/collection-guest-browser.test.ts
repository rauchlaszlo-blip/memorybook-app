import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import type { Browser, BrowserContext, Route } from '@playwright/test';
import type { CollectionFile, CollectionReceipt, FileIdentity } from '../src/collection/uploader';

async function fixture(browser: Browser, language = 'hu') {
  const app = express(); app.use(express.static(resolve('dist'))); app.get('/p/:token', (_req, res) => res.sendFile(resolve('dist/index.html')));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({ locale: 'hu-HU', viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
  const groupId = randomUUID(), bookId = randomUUID(), eventId = randomUUID(), locationId = randomUUID();
  const files = new Map<string, CollectionFile>(), chunks = new Map<string, Map<number, Buffer>>(), beginIds: string[] = [], commits: string[] = [], versions: Record<string, unknown>[] = [];
  let version = 1, canvas: Record<string, unknown> = { version: '7.4.0', objects: [] }, receipt: CollectionReceipt | undefined;
  let loseChunkAck = false, rejectChunk = false, failSave = false, commitFault: 'none' | '202' | 'lost' | 'conflict' = 'none';
  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body, headers: { 'Access-Control-Allow-Origin': origin } });
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': '*' } });
    if (path === '/api/page-invites/fixture-invite') {
      if (method === 'GET') return receipt ? reply(route, { error: 'PAGE_ALREADY_SUBMITTED' }, 409) : reply(route, { id: groupId, bookId, bookTitle: 'Fiktív gyűjtési próba', bookType: 'event', pageNumber: 1, version, language, canvasData: canvas, inviteStatus: 'draft' });
      if (method === 'PUT') {
        if (failSave) return reply(route, { error: 'PAGE_SAVE_FAILED' }, 503);
        const body = request.postDataJSON(); canvas = body.canvasData; versions.push(canvas); version++; return reply(route, { newVersion: version });
      }
    }
    const base = '/api/collection/invites/fixture-invite';
    if (path === base) return reply(route, { enabled: true, groupId, bookId, pageVersion: version, state: receipt ? 'submitted' : 'draft', receipt, limits: { chunkBytes: 8192, photo: { maxBytes: 20 * 1048576, maxCount: 10 }, audio: { maxBytes: 8 * 1048576, maxCount: 2, maxDurationSeconds: 1.5 }, video: { maxBytes: 24 * 1048576, maxCount: 2, maxDurationSeconds: 1.5 } }, events: [{ id: eventId, label: 'Szertartás', order: 1 }], locations: [{ id: locationId, label: 'Kert', order: 1 }], files: [...files.values()] });
    if (path === base + '/files' && method === 'POST') {
      const body: FileIdentity = request.postDataJSON(); beginIds.push(body.id);
      if (!files.has(body.id)) { files.set(body.id, { ...body, state: 'uploading', receivedChunks: [], chunkCount: Math.ceil(body.byteLength / 8192), chunkBytes: 8192, errorCode: null, retryAvailable: false }); chunks.set(body.id, new Map()); }
      return reply(route, { file: files.get(body.id) }, 201);
    }
    const match = path.match(/\/files\/([^/]+)(?:\/(chunks)\/(\d+)|\/(complete|retry|preview|original))?$/);
    if (match) {
      const file = files.get(match[1]); if (!file) return reply(route, { error: 'FILE_NOT_FOUND' }, 404);
      if (method === 'DELETE') { file.state = 'removed'; return reply(route, { file }); }
      if (match[2] === 'chunks') {
        const index = Number(match[3]);
        if (rejectChunk && index === 1) return route.abort();
        const bytes = request.postDataBuffer()!; chunks.get(file.id)!.set(index, bytes); file.receivedChunks = [...chunks.get(file.id)!.keys()];
        if (loseChunkAck) { loseChunkAck = false; return route.abort(); }
        return reply(route, { file });
      }
      if (match[4] === 'complete' || match[4] === 'retry') {
        const original = Buffer.concat([...chunks.get(file.id)!.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]));
        assert.equal(original.length, file.byteLength); assert.equal(createHash('sha256').update(original).digest('hex'), file.sha256);
        file.state = 'ready'; file.previewUrl = file.kind === 'photo' ? `${base}/files/${file.id}/preview` : undefined; return reply(route, { file });
      }
      if (match[4] === 'preview' || match[4] === 'original') return route.fulfill({ body: Buffer.concat([...chunks.get(file.id)!.values()]), contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': origin } });
      return reply(route, { file });
    }
    if (path === base + '/commit') {
      commits.push(request.postData()!);
      if (commitFault === '202') return reply(route, { accepted: false, state: 'processing' }, 202);
      if (commitFault === 'conflict') return reply(route, { error: 'SELECTION_CHANGED' }, 409);
      const body = request.postDataJSON(); assert.equal(body.expectedVersion, version); assert.match(body.previewDataUrl, /^data:image\/jpeg;base64,/);
      receipt ||= { accepted: true, state: 'committed', groupId, submissionId: randomUUID(), committedAt: new Date().toISOString(), replayed: false };
      if (commitFault === 'lost') { commitFault = 'none'; return route.abort(); }
      return reply(route, { ...receipt, replayed: commits.length > 1 });
    }
    throw new Error(`Unexpected fixture endpoint: ${method} ${path}`);
  });
  return { context, origin, files, chunks, beginIds, commits, versions, groupId, eventId, locationId, setLoseChunkAck: () => { loseChunkAck = true; }, setRejectChunk: (value: boolean) => { rejectChunk = value; }, setFailSave: (value: boolean) => { failSave = value; }, setCommitFault: (value: typeof commitFault) => { commitFault = value; }, close: async () => { await context.close(); await new Promise<void>(done => server.close(() => done())); } };
}

test('guest collection preserves original bytes before Fabric optimization, recovers lost chunk and commit ACKs, and never hides failed form', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome' }); const f = await fixture(browser);
  try {
    const page = await f.context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => void dialog.accept());
    await page.goto(f.origin + '/p/fixture-invite'); const panel = page.getByRole('region', { name: 'Csatolt eredeti fájlok', exact: true });
    await expect(panel.getByText('1.5 másodperc').first()).toBeVisible();
    const original = await sharp({ create: { width: 6000, height: 1000, channels: 3, background: '#79a99b' } }).jpeg({ quality: 95 }).toBuffer();
    f.setLoseChunkAck();
    await page.locator('.memorybook-editor-toolbar input[type=file]').nth(1).setInputFiles({ name: 'fictional-original.jpg', mimeType: 'image/jpeg', buffer: original });
    await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toBeVisible();
    await expect.poll(() => f.versions.length).toBeGreaterThan(0);
    assert.equal(f.files.size, 1); const file = [...f.files.values()][0]; assert.equal(file.sha256, createHash('sha256').update(original).digest('hex')); assert.equal(f.beginIds.length, 1);
    const image = (f.versions.at(-1)!.objects as Record<string, unknown>[]).find(object => object.collectionAssetId === file.id)!;
    assert.ok(image); assert.equal(image.width, 2480); assert.match(String(image.src), /^data:image\/webp;base64,/);
    const second = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#db8462' } }).png().toBuffer();
    const third = await sharp({ create: { width: 90, height: 70, channels: 3, background: '#5261ab' } }).png().toBuffer();
    await panel.getByLabel('Fájlok hozzáadása').setInputFiles([{ name: 'group-second.png', mimeType: 'image/png', buffer: second }, { name: 'group-third.png', mimeType: 'image/png', buffer: third }]);
    await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toHaveCount(3); assert.equal(f.files.size, 3);
    await panel.getByLabel('Szertartás', { exact: true }).check(); await panel.getByLabel('Kert', { exact: true }).check();
    f.setCommitFault('202'); await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click();
    await expect(page.getByRole('alert').first()).toContainText('még nem igazolta vissza'); await expect(page.getByTestId('memorybook-canvas-frame')).toBeVisible();
    await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toHaveCount(0);
    await mkdir('test-results/collection-guest', { recursive: true }); await page.screenshot({ path: 'test-results/collection-guest/mobile-unconfirmed.png', fullPage: true });
    await expect(panel.getByLabel('Kert', { exact: true })).toBeDisabled();
    f.setCommitFault('lost'); await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click(); await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toBeVisible();
    assert.equal(new Set(f.commits).size, 1); const sent = JSON.parse(f.commits[0]); assert.deepEqual(sent.eventIds, [f.eventId]); assert.deepEqual(sent.locationIds, [f.locationId]);
    await page.reload(); await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toBeVisible(); assert.deepEqual(errors, []);
  } finally { await f.close(); await browser.close(); }
});

test('interrupted upload resumes with same ID and cached original even when sessionStorage is blocked; removal keeps stored original', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome' }); const f = await fixture(browser);
  try {
    await f.context.addInitScript(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (this === sessionStorage) throw new DOMException('Test storage unavailable', 'QuotaExceededError'); return original.call(this, key, value); }; });
    const page = await f.context.newPage(); page.on('dialog', dialog => void dialog.accept()); await page.goto(f.origin + '/p/fixture-invite');
    const panel = page.getByRole('region', { name: 'Csatolt eredeti fájlok', exact: true }); await expect(panel.getByLabel('Fájlok hozzáadása')).toBeVisible();
    const original = await sharp({ create: { width: 6000, height: 1000, channels: 3, background: '#7294af' } }).jpeg().toBuffer();
    f.setRejectChunk(true); await panel.getByLabel('Fájlok hozzáadása').setInputFiles({ name: 'resume.jpg', mimeType: 'image/jpeg', buffer: original });
    await expect(panel.getByRole('button', { name: 'Újrapróbálás', exact: true })).toBeVisible(); const id = f.beginIds[0];
    await page.reload(); await expect(panel.getByRole('button', { name: 'Újrapróbálás', exact: true })).toBeVisible(); f.setRejectChunk(false);
    await panel.getByRole('button', { name: 'Újrapróbálás', exact: true }).click(); await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toBeVisible();
    assert.deepEqual(f.beginIds, [id, id]); assert.equal(f.files.size, 1); const bytes = Buffer.concat([...f.chunks.get(id)!.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1])); assert.deepEqual(bytes, original);
    await panel.getByRole('button', { name: 'Eltávolítás a beküldésből', exact: true }).click(); await expect(panel.getByRole('article')).toHaveCount(0); assert.equal(f.files.get(id)!.state, 'removed'); assert.equal(bytes.length, original.length);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  } finally { await f.close(); await browser.close(); }
});

test('real synthetic Chrome recording uses configured duration and explicit final submit; EN/DE controls remain available', { timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  let context: BrowserContext | undefined;
  const f = await fixture(browser, 'en');
  try {
    context = f.context; const page = await context.newPage(); await page.goto(f.origin + '/p/fixture-invite');
    const panel = page.getByRole('region', { name: 'Attached original files', exact: true }); await expect(panel.getByRole('button', { name: 'Start audio recording', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Start audio recording', exact: true }).click(); await expect(panel.getByText(/Recording ·/)).toBeVisible();
    await expect(panel.getByText('Original received', { exact: true })).toBeVisible({ timeout: 12_000 }); assert.equal(f.files.size, 1); assert.equal([...f.files.values()][0].kind, 'audio'); assert.equal(f.commits.length, 0);
    await expect(panel.locator('audio')).toHaveAttribute('preload', 'none'); assert.equal(await panel.locator('audio').evaluate((audio: HTMLAudioElement) => audio.autoplay), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  } finally { await f.close(); }
  const german = await fixture(browser, 'de');
  try { const page = await german.context.newPage(); await page.goto(german.origin + '/p/fixture-invite'); await expect(page.getByRole('heading', { name: 'Angehängte Originaldateien' })).toBeVisible(); await expect(page.getByLabel('Nicht angegeben')).toHaveCount(2); }
  finally { await german.close(); await browser.close(); }
});

test('failed canvas save prevents commit; a definite commit rejection unlocks correction and uses a new commit key', { timeout: 45_000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome' }); const f = await fixture(browser);
  try {
    const page = await f.context.newPage(); page.on('dialog', dialog => void dialog.accept()); await page.goto(f.origin + '/p/fixture-invite');
    const panel = page.getByRole('region', { name: 'Csatolt eredeti fájlok', exact: true }); await expect(panel.getByLabel('Fájlok hozzáadása')).toBeVisible();
    f.setFailSave(true); const original = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#8b6f92' } }).jpeg().toBuffer();
    await page.locator('.memorybook-editor-toolbar input[type=file]').nth(1).setInputFiles({ name: 'kept-on-failure.jpg', mimeType: 'image/jpeg', buffer: original });
    await expect(panel.getByText('Eredeti fájl átvéve', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible(); await expect(page.getByTestId('memorybook-canvas-frame')).toBeVisible(); assert.equal(f.commits.length, 0);
    f.setFailSave(false); f.setCommitFault('conflict'); await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click();
    await expect.poll(() => f.commits.length).toBe(1); await expect(panel.getByLabel('Kert', { exact: true })).toBeEnabled();
    await panel.getByLabel('Kert', { exact: true }).check(); f.setCommitFault('none'); await page.getByRole('button', { name: 'Oldal beküldése', exact: true }).click();
    await expect(page.getByText('Az oldalad elküldve. Köszönjük!', { exact: true })).toBeVisible();
    assert.notEqual(JSON.parse(f.commits[0]).key, JSON.parse(f.commits[1]).key); assert.deepEqual(JSON.parse(f.commits[1]).locationIds, [f.locationId]);
  } finally { await f.close(); await browser.close(); }
});
