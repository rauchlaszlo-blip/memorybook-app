import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import express from 'express';
import sharp from 'sharp';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { createWorkflowService, createWorkflowRouter, createExportWorker, enforceDraftRestrictions, WorkflowError } from '../server/wedding/book-workflow';
import type { WorkflowActor } from '../server/wedding/book-workflow';
import { arrange } from '../server/wedding/montage-layout';
import { imageWithInk } from '../server/wedding/montage-pdf';
import { createMontageRouter } from '../server/wedding/montage';
import { blankElement, defaultProfile, mockProvider, validateDraft } from '../shared/montage';
import type { Draft } from '../shared/montage';
import type { Annotation } from '../shared/photo-annotation';

const errorCode = (code: string) => (error: unknown) => error instanceof WorkflowError && error.code === code;

test('workflow: 10 fictional guests, 30 real images, frozen sources, authorized edits, approval and durable private PDF queue', async () => {
  const connectionString = localDatabaseUrl(), schema = 'workflow_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const service = createWorkflowService(pool), worker = createExportWorker(pool);
  const owner: WorkflowActor = { ownerId: 'fictional-owner', kind: 'owner' }, foreign: WorkflowActor = { ownerId: 'other-owner', kind: 'owner' };
  const bookId = randomUUID(), foreignBookId = randomUUID();
  const mcp: WorkflowActor = { ownerId: owner.ownerId, kind: 'mcp', allowedBookIds: [bookId], grantId: randomUUID() };
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    await migrateWedding(pool); await migrateWedding(pool);
    for (const [id, ownerId] of [[bookId, owner.ownerId], [foreignBookId, foreign.ownerId]]) await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at)
      VALUES($1,$2,'celebration','wedding','Fiktív MCP könyv – Ő és Ű','[]','wedding-classic',1,$3,CURRENT_TIMESTAMP)`, [id, ownerId, randomUUID()]);
    const ink: Annotation = { version: 1, space: 'exif-oriented-normalized', strokes: [{ color: '#d62828', width: .014, points: [[.1, .1], [.2, .6], [.8, .2]] }] };
    let firstMedia = '';
    for (let guest = 0; guest < 10; guest++) {
      const id = randomUUID();
      const message = guest === 9 ? ' ' : guest === 2 ? 'Árvíztűrő tükörfúrógép. Őszinte örömöt és hosszú, boldog közös életet! '.repeat(40) : `Őszinte örömöt, egészséget és boldogságot kíván a fiktív ${guest}. beküldő!`;
      await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)', [id, bookId, randomUUID(), guest < 2 ? 'Azonos Fiktív Név' : 'Fiktív Vendég ' + guest, message, 'fictional-device-' + guest]);
      for (let index = 0; index < 3; index++) {
        const mediaId = randomUUID(), width = index === 1 ? 320 : 480, height = index === 1 ? 480 : 320;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${['#edd0ac', '#c7dfcc', '#d1d9f1'][index]}"/><circle cx="50%" cy="42%" r="80" fill="#987354"/><text x="25" y="40" font-size="25">Fiktiv ${guest + 1} / ${index + 1}</text></svg>`;
        const original = await sharp(Buffer.from(svg)).png().toBuffer();
        await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
          VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8,'attached',$9,$9,$9,$10)`, [mediaId, bookId, randomUUID(), id, original.length, createHash('sha256').update(original).digest('hex'), width, height, original, original.length * 3]);
        if (guest === 0 && index === 0) {
          firstMedia = mediaId; const preview = await imageWithInk(original, ink, { x: 0, y: 0, scale: 1 });
          await pool.query(`INSERT INTO event_media_annotations(media_id,version,layer,layer_hash,preview_bytes,display_bytes,stored_size)
            VALUES($1,1,$2,$3,$4,$4,2*octet_length($4::bytea)+octet_length($2::jsonb::text))`, [mediaId, JSON.stringify(ink), createHash('sha256').update(JSON.stringify(ink)).digest('hex'), preview]);
        }
      }
    }
    assert.equal((await service.listBooks(mcp)).books.length, 1);
    assert.equal((await service.listSubmissions(mcp, bookId, { limit: 3 })).nextOffset, 3);
    assert.equal((await service.listSubmissions(mcp, bookId, { offset: 9, limit: 3 })).submissions.length, 1);
    assert.equal((await service.getBook(mcp, bookId)).capabilities.audio, false);
    assert.equal((await service.getBook(mcp, bookId)).capabilities.video, false);
    await assert.rejects(service.getBook(foreign, bookId), errorCode('BOOK_NOT_FOUND'));
    await assert.rejects(service.getBook(mcp, foreignBookId), errorCode('BOOK_NOT_FOUND'));
    await assert.rejects(service.getBook({ ...mcp, allowedBookIds: undefined }, bookId), errorCode('BOOK_NOT_FOUND'));
    await assert.rejects(service.getMedia(mcp, bookId, randomUUID()), errorCode('MEDIA_NOT_FOUND'));
    await assert.rejects(service.listSubmissions(mcp, bookId, { limit: 500 }), errorCode('INVALID_PAGINATION'));
    const snapshotKey = randomUUID(), snapshot = await service.createSnapshot(mcp, bookId, { key: snapshotKey });
    const snapshotId = String(snapshot.id), sources = snapshot.sources;
    assert.equal(sources.length, 10); assert.equal(sources.flatMap(s => s.media).length, 30);
    assert.equal(new Set(sources.map(s => s.guestId)).size, 10);
    assert.equal(sources.filter(s => s.name === 'Azonos Fiktív Név').length, 2);
    assert.equal((await service.createSnapshot(mcp, bookId, { key: snapshotKey })).id, snapshot.id);
    await assert.rejects(service.createSnapshot(mcp, bookId, { key: snapshotKey, selectedIds: [sources[0].id] }), errorCode('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(service.createSnapshot(mcp, bookId, { key: randomUUID(), selectedIds: [randomUUID()] }), errorCode('INVALID_SOURCE_IDS'));
    const image = await service.getMedia(mcp, bookId, firstMedia, { snapshotId });
    assert.equal(image.mimeType, 'image/png'); assert.equal((await sharp(image.bytes).metadata()).width, 480); assert.deepEqual(image.layer, ink);
    const original = await service.getMedia(mcp, bookId, firstMedia, { snapshotId, preview: false });
    assert.ok(Buffer.isBuffer(original.bytes));
    const foreignSourceId = randomUUID(), foreignMediaId = randomUUID();
    await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)', [foreignSourceId, foreignBookId, randomUUID(), 'Másik fiktív tulajdonos vendége', 'Idegen könyv üzenete', 'foreign-device']);
    await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
      SELECT $1,$2,$3,$4,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size FROM event_media WHERE id=$5`, [foreignMediaId, foreignBookId, randomUUID(), foreignSourceId, firstMedia]);
    await assert.rejects(service.getMedia(mcp, bookId, foreignMediaId), errorCode('MEDIA_NOT_FOUND'));
    await assert.rejects(service.getSubmission(mcp, bookId, foreignSourceId), errorCode('SUBMISSION_NOT_FOUND'));
    await assert.rejects(service.createSnapshot(mcp, bookId, { key: randomUUID(), selectedIds: [foreignSourceId] }), errorCode('INVALID_SOURCE_IDS'));
    await assert.rejects(pool.query('UPDATE event_book_snapshots SET sources=$2 WHERE id=$1', [snapshotId, '[]']), /Immutable/);
    await assert.rejects(pool.query('DELETE FROM event_book_snapshot_media WHERE snapshot_id=$1', [snapshotId]), /Immutable/);

    const initial: Draft = { schema: 1, format: 'A4', spread: false, selected: sources.map(s => s.id), excluded: [], profile: structuredClone(defaultProfile), pages: [{ id: randomUUID(), background: '#fffaf4', locked: false, elements: [] }] };
    const draft = await arrange(initial, sources, mockProvider);
    const request = { key: randomUUID(), parentId: null, snapshotId, draft };
    const versions = await Promise.all([service.saveVersion(mcp, bookId, request), service.saveVersion(mcp, bookId, request)]);
    assert.equal(versions[0].id, versions[1].id); const firstVersion = versions[0];
    assert.equal(firstVersion.coverage.covered, 9); assert.equal(firstVersion.coverage.mediaOnly.length, 1); assert.equal(firstVersion.coverage.missing.length, 0);
    assert.equal(firstVersion.preflight.filter(p => p.severity === 'error').length, 0);
    await assert.rejects(service.saveVersion(mcp, bookId, { ...request, draft: { ...draft, spread: true } }), errorCode('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(service.saveVersion(mcp, bookId, { ...request, key: randomUUID() }), errorCode('VERSION_CONFLICT'));
    const invalid = structuredClone(draft); invalid.pages.flatMap(p => p.elements).find(e => e.kind === 'photo')!.mediaId = randomUUID();
    await assert.rejects(service.saveVersion(mcp, bookId, { ...request, key: randomUUID(), parentId: firstVersion.id, draft: invalid }), errorCode('INVALID_DRAFT'));
    await assert.rejects(service.startExport(mcp, bookId, { key: randomUUID(), versionId: firstVersion.id }), errorCode('APPROVE_FIRST'));
    await assert.rejects(service.approveVersion(mcp, bookId, firstVersion.id), errorCode('OWNER_APPROVAL_REQUIRED'));

    const manual = structuredClone(firstVersion.draft), photo = manual.pages.flatMap(p => p.elements).find(e => e.kind === 'photo')!;
    photo.pinToPage = true; photo.locked = true; photo.rotation = 7; photo.crop = { x: .1, y: .1, w: .8, h: .8 };
    const ownerVersion = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: firstVersion.id, snapshotId, draft: manual });
    const moved = structuredClone(ownerVersion.draft), movedPhoto = moved.pages.flatMap(p => p.elements).find(e => e.id === photo.id)!;
    movedPhoto.x += 1;
    await assert.rejects(service.saveVersion(mcp, bookId, { key: randomUUID(), parentId: ownerVersion.id, snapshotId, draft: moved }), errorCode('ELEMENT_LOCKED'));
    movedPhoto.x -= 1; movedPhoto.locked = false;
    await assert.rejects(service.saveVersion(mcp, bookId, { key: randomUUID(), parentId: ownerVersion.id, snapshotId, draft: moved }), errorCode('ELEMENT_LOCKED'));
    movedPhoto.pinToPage = false;
    const unlocked = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: ownerVersion.id, snapshotId, draft: moved });
    const prohibited = structuredClone(unlocked.draft); prohibited.excluded = [sources[0].guestId];
    await assert.rejects(service.saveVersion(mcp, bookId, { key: randomUUID(), parentId: unlocked.id, snapshotId, draft: prohibited }), errorCode('OWNER_EXCLUSION_REQUIRED'));
    const rewritten = structuredClone(unlocked.draft), rewrittenText = rewritten.pages.flatMap(p => p.elements).find(e => e.kind === 'text')!;
    rewrittenText.text = 'Kitalált helyettesítő üzenet'; rewrittenText.edited = true;
    await assert.rejects(service.saveVersion(mcp, bookId, { key: randomUUID(), parentId: unlocked.id, snapshotId, draft: rewritten }), errorCode('OWNER_TEXT_EDIT_REQUIRED'));
    const approved = await service.approveVersion(owner, bookId, unlocked.id); assert.equal(approved.approved, true);
    assert.equal(approved.edition.approved_by, owner.ownerId); assert.ok(approved.edition.approved_at);
    const editionId = approved.edition.id;
    await assert.rejects(pool.query("UPDATE event_book_editions SET draft='{}' WHERE id=$1", [editionId]), /Immutable/);
    await assert.rejects(pool.query("UPDATE event_montage_versions SET draft='{}' WHERE id=$1", [unlocked.id]), /Immutable/);

    // New material and a changed original source cannot change the edition or its processing scope.
    await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), bookId, randomUUID(), 'Későbbi fiktív beküldő', 'Későn érkező üzenet.', 'late-device']);
    await pool.query('UPDATE event_submissions SET message=$2 WHERE id=$1', [sources[0].id, 'A forrás jelenlegi szövege később megváltozott.']);
    assert.equal((await service.getSnapshot(mcp, bookId, snapshotId)).sources[0].message, sources[0].message);
    assert.equal((await service.getVersion(mcp, bookId, unlocked.id)).coverage.total, 10);
    assert.equal((await service.listSubmissions(mcp, bookId)).total, 11);
    assert.equal((await service.listSubmissions(mcp, bookId, { snapshotId })).total, 10);
    const later = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: unlocked.id, snapshotId, draft: unlocked.draft });
    assert.equal(later.approved_at, null); assert.equal((await service.approval(mcp, bookId, unlocked.id)).edition.id, editionId);

    const exportKey = randomUUID(), jobs = await Promise.all([service.startExport(mcp, bookId, { key: exportKey, versionId: unlocked.id }), service.startExport(mcp, bookId, { key: exportKey, versionId: unlocked.id })]);
    assert.equal(jobs[0].id, jobs[1].id); assert.equal(jobs[0].status, 'queued');
    const aliasKey = randomUUID(); assert.equal((await service.startExport(mcp, bookId, { key: aliasKey, versionId: unlocked.id })).id, jobs[0].id);
    await assert.rejects(service.startExport(mcp, bookId, { key: aliasKey, versionId: later.id }), errorCode('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(service.downloadExport(mcp, bookId, jobs[0].id), errorCode('EXPORT_NOT_READY'));
    await assert.rejects(service.getExport(foreign, bookId, jobs[0].id), errorCode('BOOK_NOT_FOUND'));
    // Simulate death after claiming: a fresh worker recovers the expired durable lease.
    await pool.query("UPDATE event_book_export_jobs SET status='running',attempts=1,lease_token=$2,lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1", [jobs[0].id, randomUUID()]);
    assert.equal(await worker.runOnce(), true);
    const job = await service.getExport(mcp, bookId, jobs[0].id); assert.equal(job.status, 'complete'); assert.equal(job.attempts, 2);
    assert.equal(job.report.printReady, false); assert.equal(job.report.versionId, unlocked.id); assert.equal(job.report.snapshotId, snapshotId);
    const pdf = await service.downloadExport(mcp, bookId, job.id); assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    await mkdir('test-results/book-workflow', { recursive: true }); await writeFile('test-results/book-workflow/a4.pdf', pdf.bytes);
    assert.equal((await createWorkflowService(pool).getExport(owner, bookId, job.id)).status, 'complete');
    assert.equal(await worker.runOnce(), false);

    const a5 = await arrange({ ...initial, format: 'A5' }, sources, mockProvider);
    const a5Version = await service.saveVersion(mcp, bookId, { key: randomUUID(), parentId: later.id, snapshotId, draft: a5 });
    await service.approveVersion(owner, bookId, a5Version.id);
    const a5Job = await service.startExport(mcp, bookId, { key: randomUUID(), versionId: a5Version.id });
    let attempts = 0;
    const failingWorker = createExportWorker(pool, { retryDelayMs: 0, render: async () => { attempts++; throw new Error('Fictional renderer outage; never log secrets here'); } });
    await failingWorker.runOnce(); assert.equal((await service.getExport(owner, bookId, a5Job.id)).status, 'queued');
    await failingWorker.stop(); // Worker restart retains attempt count and queued job.
    await worker.runOnce(); assert.equal((await service.getExport(owner, bookId, a5Job.id)).status, 'complete'); assert.equal(attempts, 1);
    await writeFile('test-results/book-workflow/a5.pdf', (await service.downloadExport(owner, bookId, a5Job.id)).bytes);
    assert.notEqual(a5.pages.length, initial.pages.length);

    const incomplete = structuredClone(a5); incomplete.pages.forEach(p => { p.elements = p.elements.filter(e => e.sourceId !== sources[0].id); });
    const incompleteVersion = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: a5Version.id, snapshotId, draft: incomplete });
    await assert.rejects(service.approveVersion(owner, bookId, incompleteVersion.id), errorCode('INCOMPLETE'));
    incomplete.excluded = [sources[0].guestId];
    const excludedVersion = await service.saveVersion(owner, bookId, { key: randomUUID(), parentId: incompleteVersion.id, snapshotId, draft: incomplete });
    assert.equal(excludedVersion.coverage.missing.length, 0); await service.approveVersion(owner, bookId, excludedVersion.id);
    const terminalJob = await service.startExport(mcp, bookId, { key: randomUUID(), versionId: excludedVersion.id });
    const exhaustedWorker = createExportWorker(pool, { retryDelayMs: 0, render: async () => { throw new Error('Fictional persistent failure'); } });
    for (let i = 0; i < 3; i++) assert.equal(await exhaustedWorker.runOnce(), true);
    assert.equal(await exhaustedWorker.runOnce(), false); await exhaustedWorker.stop();
    const failed = await service.getExport(owner, bookId, terminalJob.id); assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 3); assert.equal(failed.error_code, 'EXPORT_RENDER_FAILED');
    assert.equal((await service.startExport(owner, bookId, { key: randomUUID(), versionId: excludedVersion.id })).id, terminalJob.id, 'repeated requests cannot reset the bounded retry limit');

    await pool.query('UPDATE event_books SET closed_at=NULL WHERE id=$1', [foreignBookId]);
    const fullForeign = await service.createSnapshot(foreign, foreignBookId, { key: randomUUID() });
    const foreignDraft = await arrange({ ...initial, selected: [foreignSourceId] }, fullForeign.sources, mockProvider);
    const foreignVersion = await service.saveVersion(foreign, foreignBookId, { key: randomUUID(), parentId: null, snapshotId: String(fullForeign.id), draft: foreignDraft });
    await assert.rejects(service.approveVersion(foreign, foreignBookId, foreignVersion.id), errorCode('CLOSE_OR_SELECT_FIRST'));
    const selectedForeign = await service.createSnapshot(foreign, foreignBookId, { key: randomUUID(), selectedIds: [foreignSourceId] });
    const concurrent = await Promise.allSettled([1, 2].map(() => service.saveVersion(foreign, foreignBookId, { key: randomUUID(), parentId: foreignVersion.id, snapshotId: String(selectedForeign.id), draft: foreignDraft })));
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
    const winner = concurrent.find(r => r.status === 'fulfilled'); assert.ok(winner && winner.status === 'fulfilled');
    assert.equal((await service.approveVersion(foreign, foreignBookId, winner.value.id)).approved, true);

    const app = express(); server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server!.once('listening', r));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = 'http://127.0.0.1:' + address.port;
    app.use('/api/book-workflow', createWorkflowRouter(pool, async req => req.get('x-owner') ? { user: { id: req.get('x-owner')! } } : null, origin));
    app.use('/api/montage', createMontageRouter(pool, async req => req.get('x-owner') ? { user: { id: req.get('x-owner')! } } : null, origin));
    const call = (suffix: string, who?: string, body?: unknown) => fetch(origin + '/api/book-workflow/' + bookId + suffix, { method: body === undefined ? 'GET' : 'POST', headers: { ...(who ? { 'x-owner': who } : {}), Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal((await call('')).status, 401); assert.equal((await call('', foreign.ownerId)).status, 404);
    assert.equal((await call('/image/' + firstMedia + '?snapshotId=' + snapshotId, owner.ownerId)).status, 200);
    assert.equal((await call('/exports/' + job.id + '/download', owner.ownerId)).status, 200);
    assert.equal((await call('/exports/' + job.id + '/download')).status, 401);
    const legacy = (suffix: string, body?: unknown) => fetch(origin + '/api/montage/' + bookId + suffix, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-owner': owner.ownerId, Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(Buffer.from(await (await legacy('/versions/' + unlocked.id + '/pdf')).arrayBuffer()).equals(pdf.bytes), 'legacy PDF URL serves the exact durable edition, not mutable sources');
    assert.equal((await legacy('/versions/' + unlocked.id + '/preview-pdf')).status, 409);
    assert.equal((await legacy('/automatic', { format: 'A4' })).status, 409);
    assert.equal((await legacy('/versions', { key: randomUUID(), parentId: excludedVersion.id, kind: 'manual', draft: incomplete })).status, 409);
    assert.equal((await fetch(origin + '/api/book-workflow/' + bookId + '/versions', { method: 'POST', headers: { 'x-owner': owner.ownerId, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const auditRows = (await pool.query('SELECT operation,details FROM event_book_audit WHERE book_id=$1', [bookId])).rows;
    for (const operation of ['snapshot.created', 'version.saved', 'edition.approved', 'export.queued', 'export.completed', 'export.attempt_failed']) assert.ok(auditRows.some(row => row.operation === operation));
    assert.ok(!JSON.stringify(auditRows).includes('Őszinte örömöt'), 'audit never stores original guest content');
    await writeFile('test-results/book-workflow/verification.json', JSON.stringify({ fictionalOnly: true, guests: 10, images: 30, snapshotFrozen: true, a4Pages: unlocked.draft.pages.length, a5Pages: a5.pages.length, jobs: 3, retryRecovery: true, boundedRetryFailure: true, legacySnapshotBypass: false, auditOperations: [...new Set(auditRows.map(row => row.operation))], physicalDevices: 'not tested', chatgptClient: 'not tested', audioVideo: 'unsupported' }, null, 2));
  } finally {
    if (server) await new Promise<void>(r => server!.close(() => r()));
    await worker.stop(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});

test('independent pinning and layout restrictions cannot be removed or transferred by MCP', async () => {
  const sourceId = randomUUID(), mcp: WorkflowActor = { kind: 'mcp', ownerId: 'a', allowedBookIds: [] }, owner: WorkflowActor = { kind: 'owner', ownerId: 'a' };
  const element = { ...blankElement('element', sourceId), text: 'Ékezet', pinToPage: true, locked: false };
  const before: Draft = { schema: 1, format: 'A4', spread: false, selected: [sourceId], excluded: [], profile: structuredClone(defaultProfile), pages: [{ id: 'page1', background: '#ffffff', locked: false, elements: [element] }, { id: 'page2', background: '#ffffff', locked: false, elements: [] }] };
  const legacyArranged = await arrange(before, [{ id: sourceId, guestId: 'g', name: 'Fiktív', message: 'Ékezet', media: [] }], mockProvider);
  const pinnedPage = legacyArranged.pages.find(p => p.elements.some(e => e.id === element.id));
  assert.equal(pinnedPage?.id, 'page1'); assert.equal(pinnedPage?.elements[0].pinToPage, true); assert.equal(pinnedPage?.elements[0].locked, false);
  assert.equal(pinnedPage?.elements[0].x, element.x, 'legacy deterministic rearrangement conservatively retains pinned geometry');
  const moved = structuredClone(before); moved.pages[1].elements.push(moved.pages[0].elements.pop()!);
  assert.throws(() => enforceDraftRestrictions(before, moved, mcp), errorCode('ELEMENT_PINNED'));
  moved.pages[1].elements[0].pinToPage = false; assert.throws(() => enforceDraftRestrictions(before, moved, mcp), errorCode('ELEMENT_PINNED'));
  assert.doesNotThrow(() => enforceDraftRestrictions(before, moved, owner));
  const adjusted = structuredClone(before); adjusted.pages[0].elements[0].x += 1;
  assert.doesNotThrow(() => enforceDraftRestrictions(before, adjusted, mcp), 'pin allows geometry changes on same page');
  before.pages[0].elements[0].locked = true;
  assert.throws(() => enforceDraftRestrictions(before, adjusted, mcp), errorCode('ELEMENT_LOCKED'));
  const removed = structuredClone(before); removed.pages[0].elements = [];
  assert.throws(() => enforceDraftRestrictions(before, removed, owner), errorCode('ELEMENT_PINNED'));
  const bad = structuredClone(before); bad.pages[0].elements[0].rotation = Number.NaN;
  assert.throws(() => validateDraft(bad, [{ id: sourceId, guestId: 'g', name: 'Fiktív', message: 'Ékezet', media: [] }]), /INVALID_DRAFT/);
  const caption = structuredClone(before); caption.pages[0].elements[0].edited = true; caption.pages[0].elements[0].textRole = 'caption';
  const promoted = structuredClone(caption); promoted.pages[0].elements[0].textRole = 'message';
  assert.throws(() => enforceDraftRestrictions(caption, promoted, mcp), errorCode('OWNER_TEXT_EDIT_REQUIRED'));
});
