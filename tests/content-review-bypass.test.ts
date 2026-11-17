import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { Pool } from 'pg';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { createMontageRouter, montageSources } from '../server/wedding/montage';
import { createWorkflowService } from '../server/wedding/book-workflow';
import { arrange } from '../server/wedding/montage-layout';
import { defaultProfile, mockProvider } from '../shared/montage';
import type { Draft } from '../shared/montage';
import { seedMcpBook } from './fixtures/mcp-book';

test('legacy non-snapshot routes cannot bypass later content review, replay old saves, or share private-only content', async () => {
  const connectionString = localDatabaseUrl(), schema = 'review_legacy_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    await migrateWedding(pool);
    const fixture = await seedMcpBook(pool, 'fictional-legacy-review-owner');
    const owner = { ownerId: fixture.ownerId, kind: 'owner' as const }, workflow = createWorkflowService(pool);
    const mcp = { ownerId: fixture.ownerId, kind: 'mcp' as const, allowedBookIds: [fixture.bookId] };
    const originalRows = (await pool.query('SELECT id,message FROM event_submissions WHERE book_id=$1 ORDER BY id', [fixture.bookId])).rows;
    const originalMedia = (await pool.query('SELECT id,sha256,original_bytes FROM event_media WHERE book_id=$1 ORDER BY id', [fixture.bookId])).rows.map(row => ({ id: row.id, sha256: row.sha256, bytesHash: createHash('sha256').update(row.original_bytes).digest('hex') }));
    const sources = await montageSources(pool, fixture.bookId);
    const draft: Draft = await arrange({ schema: 1, format: 'A4', spread: false, editionVariant: 'private', selected: sources.map(s => s.id), excluded: [], profile: structuredClone(defaultProfile), pages: [{ id: 'legacy-initial', background: '#fffaf4', locked: false, elements: [] }] }, sources, mockProvider);
    const protectedPage = draft.pages.find(page => page.elements.some(e => e.sourceId === fixture.submissionIds[0] && e.kind === 'text'));
    assert.ok(protectedPage); protectedPage.locked = true;
    const origin = 'https://memorybook-legacy-review.example.test', app = express();
    app.use('/api/montage', createMontageRouter(pool, async req => req.get('x-test-owner') ? { user: { id: req.get('x-test-owner')! } } : null, origin));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/api/montage/${fixture.bookId}`;
    const get = (path = '') => fetch(base + path, { headers: { 'x-test-owner': owner.ownerId } });
    const post = (path: string, body: unknown, requestOrigin = origin) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, 'x-test-owner': owner.ownerId }, body: JSON.stringify(body) });
    const rejected = async (response: Response, code: string) => { assert.equal(response.status, 409); assert.equal((await response.json()).error, code); };
    const pdf = async (path: string) => { const response = await get(path); assert.equal(response.status, 200); assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-'); };
    const privateRequest = { key: randomUUID(), parentId: null, kind: 'manual', draft };
    const saved = await post('/versions', privateRequest); assert.equal(saved.status, 201); const privateId = (await saved.json()).id as string;
    const shareableRequest = { key: randomUUID(), parentId: privateId, kind: 'manual', draft: { ...structuredClone(draft), editionVariant: 'shareable' } };
    const shared = await post('/versions', shareableRequest); assert.equal(shared.status, 201); const shareableId = (await shared.json()).id as string;
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_montage_versions WHERE book_id=$1 AND snapshot_id IS NULL', [fixture.bookId])).rows[0].n, 2, 'exercise real legacy editions, not snapshot aliases');
    for (const id of [privateId, shareableId]) {
      assert.equal((await post(`/versions/${id}/approve`, {})).status, 200);
      await pdf(`/versions/${id}/pdf`);
    }
    await pdf(`/versions/${privateId}/preview-pdf`);
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(base, { headers: { 'x-test-owner': 'another-owner' } })).status, 404);
    assert.equal((await post('/versions', privateRequest, 'https://evil.example')).status, 403);

    const textFlag = await workflow.createContentFlag(mcp, fixture.bookId, { key: randomUUID(), sourceId: fixture.submissionIds[0], categories: ['offensive_text'], reason: 'Fiktív bizonytalan szöveges jelölés.', scope: { kind: 'unspecified' } });
    const mediaFlag = await workflow.createContentFlag(mcp, fixture.bookId, { key: randomUUID(), sourceId: fixture.submissionIds[0], mediaId: fixture.mediaIds[0], categories: ['possible_sexual'], reason: 'Fiktív bizonytalan képi jelölés.', scope: { kind: 'partial', note: 'Tulajdonosi ellenőrzés szükséges.' } });
    for (const id of [privateId, shareableId]) {
      await rejected(await post(`/versions/${id}/approve`, {}), 'CONTENT_REVIEW_BLOCKED');
      await rejected(await get(`/versions/${id}/preview-pdf`), 'CONTENT_REVIEW_BLOCKED');
      await rejected(await get(`/versions/${id}/pdf`), 'CONTENT_REVIEW_BLOCKED');
    }
    await rejected(await post('/versions', privateRequest), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await post('/versions', shareableRequest), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await post('/versions', { ...privateRequest, key: randomUUID(), parentId: shareableId }), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await post('/automatic', { format: 'A4' }), 'CONTENT_REVIEW_BLOCKED');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_montage_versions WHERE book_id=$1', [fixture.bookId])).rows[0].n, 2, 'rejected save/replay/automatic routes create no versions');
    const overview = await (await get()).json();
    const hidden = overview.sources.find((source: { id: string }) => source.id === fixture.submissionIds[0]);
    assert.equal(hidden.message, ''); assert.equal(hidden.media.some((media: { id: string }) => media.id === fixture.mediaIds[0]), false);
    assert.equal(overview.contentReview.pendingCount, 2); assert.ok(overview.contentReview.omittedItems.some((item: { sourceId: string; reason: string; reasonLabel: string }) => item.sourceId === fixture.submissionIds[0] && item.reason === 'pending' && item.reasonLabel === 'Átnézésre váró tartalom miatt kimaradt.'));
    assert.equal(overview.contentReview.omittedContributors.some((item: { guestId: string }) => item.guestId === hidden.guestId), false, 'other clean photos keep this contributor represented');
    assert.ok(overview.contentReview.partialOmissions.some((item: { sourceId: string }) => item.sourceId === fixture.submissionIds[0]));
    const rawOwnerVersion = await (await get(`/versions/${privateId}`)).json();
    assert.equal(rawOwnerVersion.contentReview.blocked, true); assert.deepEqual(rawOwnerVersion.draft, draft, 'owner retains the old plan to inspect and repair it');
    assert.equal((await get(`/image/${fixture.mediaIds[0]}`)).status, 200, 'owner-only raw image access remains available for review');
    await rejected(await get(`/image/${fixture.mediaIds[0]}?editionVariant=shareable`), 'CONTENT_REVIEW_BLOCKED');

    for (const item of [textFlag.item, mediaFlag.item]) await workflow.decideContentFlag(owner, fixture.bookId, item.id, { key: randomUUID(), decision: 'false_positive', scope: { kind: 'full' } });
    for (const id of [privateId, shareableId]) {
      await rejected(await get(`/versions/${id}/pdf`), 'CONTENT_REVIEW_REQUIRED');
      assert.equal((await post(`/versions/${id}/approve`, {})).status, 200, 'explicit owner reapproval clears the later review hold');
      await pdf(`/versions/${id}/pdf`);
    }
    for (const item of [textFlag.item, mediaFlag.item]) await workflow.decideContentFlag(owner, fixture.bookId, item.id, { key: randomUUID(), decision: 'private_only', scope: { kind: 'full' } });
    await rejected(await get(`/versions/${privateId}/pdf`), 'CONTENT_REVIEW_REQUIRED');
    assert.equal((await post(`/versions/${privateId}/approve`, {})).status, 200); await pdf(`/versions/${privateId}/pdf`);
    await rejected(await post(`/versions/${shareableId}/approve`, {}), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await get(`/versions/${shareableId}/preview-pdf`), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await get(`/versions/${shareableId}/pdf`), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await post('/versions', shareableRequest), 'CONTENT_REVIEW_BLOCKED');
    await rejected(await get(`/image/${fixture.mediaIds[0]}?editionVariant=shareable`), 'CONTENT_REVIEW_BLOCKED');
    assert.equal((await get(`/image/${fixture.mediaIds[0]}`)).status, 200);
    const cleaned: Draft = { ...structuredClone(draft), editionVariant: 'shareable', pages: draft.pages.map(page => ({ ...structuredClone(page), locked: false, elements: page.elements.filter(element => !(element.kind === 'text' && element.sourceId === fixture.submissionIds[0]) && element.mediaId !== fixture.mediaIds[0]) })) };
    const cleanSave = await post('/versions', { key: randomUUID(), parentId: shareableId, kind: 'manual', draft: cleaned }); assert.equal(cleanSave.status, 201);
    const regenerated = await post('/automatic', { format: 'A4' }); assert.equal(regenerated.status, 201);
    const regeneratedId = (await regenerated.json()).id as string, automatic = await (await get(`/versions/${regeneratedId}`)).json();
    assert.equal(automatic.draft.editionVariant, 'shareable', 'automatic rearrangement preserves the selected edition variant');
    assert.equal((automatic.draft as Draft).pages.some(page => page.elements.some(element => element.kind === 'text' && element.sourceId === fixture.submissionIds[0] || element.mediaId === fixture.mediaIds[0])), false, 'automatic shareable layout does not reintroduce private-only text or image');
    assert.deepEqual((await pool.query('SELECT id,message FROM event_submissions WHERE book_id=$1 ORDER BY id', [fixture.bookId])).rows, originalRows);
    assert.deepEqual((await pool.query('SELECT id,sha256,original_bytes FROM event_media WHERE book_id=$1 ORDER BY id', [fixture.bookId])).rows.map(row => ({ id: row.id, sha256: row.sha256, bytesHash: createHash('sha256').update(row.original_bytes).digest('hex') })), originalMedia, 'all original bytes remain intact');
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
