import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { Pool } from 'pg';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { createWorkflowService, createWorkflowRouter, createExportWorker, WorkflowError } from '../server/wedding/book-workflow';
import { createContentReviewService, reviewState } from '../server/wedding/content-review';
import { arrange, preflight } from '../server/wedding/montage-layout';
import { proofPdf } from '../server/wedding/montage-pdf';
import { blankElement, defaultProfile, mockProvider, validateDraft } from '../shared/montage';
import type { Draft } from '../shared/montage';
import { fictionalRecordings } from './fixtures/av-recordings';

const code = (expected: string) => (error: unknown) => error instanceof WorkflowError && error.code === expected;
test('AV workflow: protected playback, immutable snapshots, scoped review and photo-only PDF output', { timeout: 90000 }, async () => {
  const connectionString = localDatabaseUrl(), schema = 'av_workflow_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` }), service = createWorkflowService(pool), reviews = createContentReviewService(pool), worker = createExportWorker(pool);
  const owner = { ownerId: 'fictional-av-owner', kind: 'owner' as const }, bookId = randomUUID(), sourceId = randomUUID(), mcp = { ...owner, kind: 'mcp' as const, allowedBookIds: [bookId] };
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    await migrateWedding(pool);
    await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at) VALUES($1,$2,'celebration','wedding','Fiktív hang és videó','[]','wedding-classic',1,$3,CURRENT_TIMESTAMP)`, [bookId, owner.ownerId, randomUUID()]);
    await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)', [sourceId, bookId, randomUUID(), 'Fiktív AV vendég', 'Eredeti szöveg, automatikus átirat nélkül.', 'fictional-av-guest']);
    const samples = await fictionalRecordings(), ids: string[] = [];
    for (const sample of samples) {
      const id = randomUUID(); ids.push(id);
      await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,kind,duration_seconds,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'attached',$12,$13,$13,$8)`, [id, bookId, randomUUID(), sourceId, sample.mime, sample.kind, sample.durationSeconds, sample.bytes.length, createHash('sha256').update(sample.bytes).digest('hex'), sample.width, sample.height, sample.bytes, Buffer.alloc(0)]);
    }
    const snapshot = await service.createSnapshot(owner, bookId, { key: randomUUID(), selectedIds: [sourceId] });
    assert.deepEqual(new Set(snapshot.sources[0].media.map(m => m.kind)), new Set(['audio', 'video']));
    const initial: Draft = { schema: 1, format: 'A4', spread: false, selected: [sourceId], excluded: [], profile: structuredClone(defaultProfile), pages: [{ id: 'page1', background: '#ffffff', locked: false, elements: [] }] };
    const draft = await arrange(initial, snapshot.sources, mockProvider);
    assert.ok(draft.pages.flatMap(p => p.elements).every(e => e.kind === 'text')); assert.ok(preflight(draft, snapshot.sources).some(p => /nem tartalmazza/.test(p.message)));
    const counterfeit = structuredClone(draft); counterfeit.pages[0].elements.push({ ...blankElement('not-a-photo', sourceId), kind: 'photo', mediaId: ids[1] });
    assert.throws(() => validateDraft(counterfeit, snapshot.sources), /INVALID_DRAFT/);
    assert.ok(preflight(counterfeit, snapshot.sources).some(p => p.severity === 'error' && /nem használható fotóként/.test(p.message)));
    await assert.rejects(proofPdf(counterfeit, bookId, randomUUID(), pool, false, { sources: snapshot.sources, media: new Map([[ids[1], { original: samples[1].bytes, layer: null }]]) }), /MEDIA_NOT_IMAGE/);
    const version = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: null, snapshotId: snapshot.id, draft });
    await service.approveVersion(owner, bookId, version.id);
    const exportJob = await service.startExport(owner, bookId, { key: randomUUID(), versionId: version.id }); await worker.runOnce();
    const pdf = await service.downloadExport(owner, bookId, exportJob.id); assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(!pdf.bytes.includes(samples[0].bytes)); assert.ok(!pdf.bytes.toString('latin1').includes('/Subtype /Image'));
    const listed = await reviews.list(owner, bookId); assert.equal(listed.capabilities.ownerPlayback, true); assert.equal(listed.capabilities.transcription, false);
    for (const [i, sample] of samples.entries()) {
      const item = listed.items.find(item => item.mediaId === ids[i])!; assert.equal(item.kind, sample.kind); assert.equal(item.durationSeconds, sample.durationSeconds); assert.match(item.previewUrl!, /\/media\//);
      const original = await service.getMedia(mcp, bookId, ids[i], { snapshotId: snapshot.id }); assert.equal(original.kind, sample.kind); assert.equal(original.mimeType, sample.mime); assert.deepEqual(original.bytes, sample.bytes);
    }
    const app = express(); server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
    app.use('/api/book-workflow', createWorkflowRouter(pool, async req => req.get('x-owner') ? { user: { id: req.get('x-owner')! } } : null, base));
    const playback = base + `/api/book-workflow/${bookId}/media/${ids[0]}?snapshotId=${snapshot.id}`;
    assert.equal((await fetch(playback)).status, 401); assert.equal((await fetch(playback, { headers: { 'x-owner': 'foreign-owner' } })).status, 404);
    const range = await fetch(playback, { headers: { 'x-owner': owner.ownerId, Range: 'bytes=0-43' } }); assert.equal(range.status, 206); assert.equal(range.headers.get('content-type')?.split(';')[0], 'audio/wav'); assert.deepEqual(Buffer.from(await range.arrayBuffer()), samples[0].bytes.subarray(0, 44));
    assert.equal((await fetch(playback, { headers: { 'x-owner': owner.ownerId, Range: 'bytes=999999999-' } })).status, 416);
    assert.equal((await fetch(base + `/api/book-workflow/${bookId}/image/${ids[1]}`, { headers: { 'x-owner': owner.ownerId } })).status, 415);
    const flag = await reviews.create(mcp, bookId, { key: randomUUID(), sourceId, mediaId: ids[0], categories: ['offensive_text'], reason: 'Fiktív hangjel, csak részlet került megjelölésre.', scope: { kind: 'partial', startSeconds: 0, endSeconds: .1 } });
    assert.equal(flag.item.kind, 'audio'); await assert.rejects(service.getMedia(mcp, bookId, ids[0], { snapshotId: snapshot.id }), code('CONTENT_REVIEW_BLOCKED'));
    assert.equal((await fetch(playback, { headers: { 'x-owner': owner.ownerId } })).status, 200, 'owner may inspect the original to decide');
    const partial = await reviews.decide(owner, bookId, flag.item.id, { key: randomUUID(), decision: 'allowed', expectedRevision: flag.revision, scope: { kind: 'partial', startSeconds: 0, endSeconds: .1 } }); assert.equal(partial.item.decision, null);
    const privateOnly = await reviews.decide(owner, bookId, flag.item.id, { key: randomUUID(), decision: 'private_only', expectedRevision: partial.revision, scope: { kind: 'full' } });
    assert.equal(privateOnly.item.decision, 'private_only'); assert.deepEqual((await service.getMedia(mcp, bookId, ids[0], { snapshotId: snapshot.id })).bytes, samples[0].bytes);
    await assert.rejects(service.getMedia(owner, bookId, ids[0], { snapshotId: snapshot.id, editionVariant: 'shareable' }), code('CONTENT_REVIEW_BLOCKED'));
    assert.deepEqual((await service.downloadExport(owner, bookId, exportJob.id)).bytes, pdf.bytes, 'unembedded recording restrictions do not change a text-only PDF');
    const altered = Buffer.from(samples[0].bytes); altered[48] ^= 1;
    await pool.query('UPDATE event_media SET original_bytes=$2,sha256=$3 WHERE id=$1', [ids[0], altered, createHash('sha256').update(altered).digest('hex')]);
    assert.deepEqual((await service.getMedia(owner, bookId, ids[0], { snapshotId: snapshot.id })).bytes, samples[0].bytes);
    const now = (await reviews.list(owner, bookId)).items.find(item => item.mediaId === ids[0])!; assert.equal(now.contentChanged, true); assert.equal(now.decision, null);
    const frozen = (await reviewState(pool, bookId, snapshot.sources, { snapshotId: snapshot.id })).items.find(item => item.mediaId === ids[0])!; assert.equal(frozen.contentHash, flag.item.contentHash); assert.equal(frozen.decision, 'private_only');
    await assert.rejects(pool.query('UPDATE event_book_snapshot_media SET duration_seconds=5 WHERE snapshot_id=$1', [snapshot.id]), /Immutable/);
  } finally { await worker.stop(); if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
