import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReviewItem, ReviewState } from '../shared/content-review';
import { createInternetReviewTrial } from '../scripts/mcp-internet-review';
import type { InternetReviewCheckpoint, InternetReviewReport } from '../scripts/mcp-internet-review';

function fixture(resolved = false) {
  const pdf = Buffer.from('%PDF-fictional-local-test'), flagCreateKey = randomUUID();
  const cp: InternetReviewCheckpoint = { bookId: randomUUID(), snapshotId: randomUUID(), versionId: randomUUID(), jobId: randomUUID(), flagCreateKey, decisionKey: randomUUID(), reviewId: randomUUID(), reviewSourceId: randomUUID(), reviewMediaId: randomUUID(), reviewContentHash: 'a'.repeat(64), reviewPdfSha256: createHash('sha256').update(pdf).digest('hex'), reviewStatus: resolved ? 'complete' : 'flagged', reviewHoldVerified: resolved };
  const reason = `Ártalmatlan fiktív technikai próba; nem valódi szexuális vagy szélsőséges tartalom és nem gépi minősítés. Tesztazonosító: ${flagCreateKey}`;
  const note = `Kizárólag a fiktív technikai próba saját MCP-jelölésének visszaállítása. Tesztazonosító: ${flagCreateKey}`;
  const item: ReviewItem = { id: cp.reviewId!, sourceId: cp.reviewSourceId!, mediaId: cp.reviewMediaId!, kind: 'photo', contentHash: cp.reviewContentHash!, contributor: 'Fiktív vendég', categories: ['possible_sexual', 'possible_extremist'], flags: ['possible_sexual', 'possible_extremist'].map(category => ({ id: randomUUID(), category: category as 'possible_sexual' | 'possible_extremist', origin: 'mcp', reason, createdAt: new Date().toISOString(), scope: { kind: 'full' }, evidenceContentHash: cp.reviewContentHash! })), decision: resolved ? 'false_positive' : null, scope: { kind: 'full' }, contentChanged: false, status: resolved ? 'resolved' : 'pending', history: resolved ? [{ decision: 'false_positive', scope: { kind: 'full' }, note, actorId: 'fictional-owner', createdAt: new Date().toISOString(), revision: 8 }] : [], affectedPages: [] };
  cp.reviewFlagIds = item.flags.map(flag => flag.id).sort();
  const state: ReviewState = { revision: 8, items: [item], pendingCount: resolved ? 0 : 1, pendingIds: resolved ? [] : [item.id], totalCount: 1, targetCount: 1, capabilities: { delete: false, audio: false, video: false, automatedDetection: false, publicSharing: false } };
  const report: InternetReviewReport = { enabled: true, status: 'PENDING' }, calls: { path: string; data: Record<string, unknown> }[] = [], checks: string[] = [];
  const response = (status: number, value: unknown) => ({ status: () => status, json: async () => value, body: async () => pdf });
  const owner = {
    get: async (path: string) => path.includes('/reviews?') ? response(200, structuredClone(state)) : path.endsWith('/approval') ? response(200, { approved: true, withheld: false, contentReview: { blocked: false, revision: state.revision } }) : response(item.decision ? 200 : 409, {}),
    post: async (path: string, options: { data: Record<string, unknown> }) => {
      calls.push({ path, data: options.data });
      if (path.endsWith('/decision')) { assert.equal(options.data.expectedRevision, state.revision); item.decision = 'false_positive'; item.history.push({ decision: 'false_positive', scope: { kind: 'full' }, note, actorId: 'fictional-owner', createdAt: new Date().toISOString(), revision: ++state.revision }); state.pendingCount = 0; state.pendingIds = []; }
      return response(200, { revision: state.revision });
    },
  } as unknown as APIRequestContext;
  const text = (value: unknown, error = false): CallToolResult => ({ ...(error ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }] });
  let creates = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    if (args.bookId !== cp.bookId) return text({ error: 'BOOK_NOT_FOUND' }, true);
    if (name === 'list_content_flags') return text(state);
    if (name === 'create_content_flag') { if ('origin' in args || 'decision' in args) return text({ error: 'INVALID_ARGUMENTS' }, true); creates++; return text({ item, revision: state.revision, replayed: true }); }
    if (name === 'get_media' || name === 'get_draft') return text({ error: 'CONTENT_REVIEW_BLOCKED' }, true);
    if (name === 'get_export') return text({ withheld: true, downloadUrl: null, downloadPath: null });
    throw new Error('UNEXPECTED_TEST_TOOL');
  };
  const trial = createInternetReviewTrial({ checkpoint: cp, denyBookId: randomUUID(), owner, call, save: async () => {}, mark: () => {}, pass: check => checks.push(check), report });
  return { cp, item, state, report, owner, calls, checks, trial, creates: () => creates, response };
}

test('optional remote review recovery verifies a resumed hold and sends revision-guarded own-flag cleanup', async () => {
  const f = fixture(); await f.trial.run();
  assert.equal(f.cp.reviewStatus, 'complete'); assert.equal(f.cp.reviewHoldVerified, true); assert.equal(f.report.status, 'PASS'); assert.equal(f.report.originalPdfUnchanged, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].data.expectedRevision, 8); assert.equal(f.calls[0].data.decision, 'false_positive');
  assert.equal(f.creates(), 2); await f.trial.cleanup(); assert.equal(f.calls.length, 1);
});

test('completed technical trial is reused without creating or reopening any flag and without claiming a fresh hold', async () => {
  const f = fixture(true); await f.trial.run(); await f.trial.cleanup();
  assert.equal(f.creates(), 0); assert.equal(f.calls.length, 0); assert.equal(f.report.status, 'PRIOR_COMPLETED_TRIAL_PRESERVED');
  assert.deepEqual(f.checks, ['prior_content_review_trial_preserved_without_new_hold']);
});

test('technical cleanup never resolves a foreign flag or an independent owner decision', async () => {
  const foreign = fixture(); foreign.item.flags.push({ ...foreign.item.flags[0], id: randomUUID(), origin: 'manual', reason: 'Fiktív tulajdonosi észrevétel.' });
  await assert.rejects(foreign.trial.cleanup(), /TECHNICAL_REVIEW_FOREIGN_FLAGS/); assert.equal(foreign.calls.length, 0);
  const ownerDecision = fixture(); ownerDecision.item.history.push({ decision: 'private_only', scope: { kind: 'full' }, note: 'Tulajdonosi döntés', actorId: 'owner', createdAt: new Date().toISOString(), revision: 9 });
  await assert.rejects(ownerDecision.trial.cleanup(), /TECHNICAL_REVIEW_OWNER_DECISION_CHANGED/); assert.equal(ownerDecision.calls.length, 0);
});

test('technical cleanup sends a conditional revision and propagates a server race rejection without reapproval', async () => {
  const f = fixture(); f.owner.post = (async (_path: string, options: { data: Record<string, unknown> }) => { assert.equal(options.data.expectedRevision, 8); return f.response(409, { error: 'CONTENT_REVIEW_CONFLICT' }); }) as APIRequestContext['post'];
  await assert.rejects(f.trial.cleanup(), /HTTP_WRITE_FAILED_409/); assert.equal(f.item.decision, null); assert.equal(f.cp.reviewStatus, 'flagged');
});

test('fresh technical preparation rejects an already flagged target before creating checkpoint keys or mutating anything', async () => {
  const f = fixture(); delete f.cp.flagCreateKey; delete f.cp.decisionKey;
  await assert.rejects(f.trial.prepare(f.cp.reviewSourceId!, f.cp.reviewMediaId!, f.cp.reviewPdfSha256!), /TECHNICAL_REVIEW_TARGET_HAS_EXISTING_FLAGS/);
  assert.equal(f.cp.flagCreateKey, undefined); assert.equal(f.creates(), 0); assert.equal(f.calls.length, 0);
});

test('technical cleanup does not reapprove an edition after an unrelated review revision changes', async () => {
  const f = fixture(true); f.cp.reviewStatus = 'resolved'; f.state.revision = 9;
  const originalGet = f.owner.get.bind(f.owner);
  f.owner.get = (async (path: string) => path.endsWith('/approval') ? f.response(200, { approved: true, withheld: true, contentReview: { blocked: false, revision: 9 } }) : originalGet(path)) as APIRequestContext['get'];
  await assert.rejects(f.trial.cleanup(), /TECHNICAL_REVIEW_UNRELATED_REVISION_CHANGED/); assert.equal(f.calls.length, 0);
});

test('technical reapproval uses only the exact own-decision revision as an atomic precondition', async () => {
  const f = fixture(true); f.cp.reviewStatus = 'resolved';
  const originalGet = f.owner.get.bind(f.owner);
  f.owner.get = (async (path: string) => path.endsWith('/approval') ? f.response(200, { approved: true, withheld: true, contentReview: { blocked: false, revision: 8 } }) : originalGet(path)) as APIRequestContext['get'];
  await f.trial.cleanup(); assert.equal(f.calls.length, 1); assert.ok(f.calls[0].path.endsWith('/approve')); assert.deepEqual(f.calls[0].data, { expectedReviewRevision: 8 });
});
