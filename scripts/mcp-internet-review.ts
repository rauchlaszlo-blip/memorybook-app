import { createHash, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReviewItem, ReviewState } from '../shared/content-review';
import { ensure, getJson, postJson, uuid } from './mcp-internet-utils';

export type InternetReviewCheckpoint = {
  bookId: string; snapshotId?: string; versionId?: string; jobId?: string;
  flagCreateKey?: string; reviewId?: string; decisionKey?: string;
  reviewSourceId?: string; reviewMediaId?: string; reviewContentHash?: string;
  reviewFlagIds?: string[]; reviewPdfSha256?: string; reviewHoldVerified?: boolean;
  reviewDecisionRevision?: number;
  reviewStatus?: 'prepared' | 'flagged' | 'hold_verified' | 'resolved' | 'complete' | 'recovered';
};
export type InternetReviewReport = {
  enabled: true; status: string; reviewId?: string; flagIds?: string[];
  sourceId?: string; mediaId?: string; holdVerified?: boolean; originalPdfUnchanged?: boolean;
  cleanup?: string; errorCode?: string;
};
const categories = ['possible_sexual', 'possible_extremist'];
const reasonFor = (key: string) => `Ártalmatlan fiktív technikai próba; nem valódi szexuális vagy szélsőséges tartalom és nem gépi minősítés. Tesztazonosító: ${key}`;
const noteFor = (key: string) => `Kizárólag a fiktív technikai próba saját MCP-jelölésének visszaállítása. Tesztazonosító: ${key}`;
const parsed = <T>(result: CallToolResult): T => {
  ensure(!result.isError, 'CONTENT_REVIEW_MCP_CALL_FAILED');
  const block = result.content.find(item => item.type === 'text'); ensure(block?.type === 'text', 'CONTENT_REVIEW_MCP_TEXT_MISSING');
  return JSON.parse(block.text) as T;
};

/** Fail closed if another report/owner decision was added to this grouped item. */
export function assertOwnedTechnicalReview(checkpoint: InternetReviewCheckpoint, item: ReviewItem) {
  ensure(checkpoint.flagCreateKey && uuid.test(checkpoint.flagCreateKey), 'TECHNICAL_REVIEW_KEY_REQUIRED');
  ensure(item.id === checkpoint.reviewId && item.sourceId === checkpoint.reviewSourceId && item.mediaId === checkpoint.reviewMediaId && item.contentHash === checkpoint.reviewContentHash && !item.contentChanged, 'TECHNICAL_REVIEW_TARGET_CHANGED');
  ensure(item.flags.length === 2 && new Set(item.flags.map(flag => flag.category)).size === 2 && item.flags.every(flag => uuid.test(flag.id) && categories.includes(flag.category) && flag.origin === 'mcp' && flag.reason === reasonFor(checkpoint.flagCreateKey!) && flag.evidenceContentHash === checkpoint.reviewContentHash && flag.scope.kind === 'full'), 'TECHNICAL_REVIEW_FOREIGN_FLAGS');
  if (checkpoint.reviewFlagIds) ensure(JSON.stringify([...checkpoint.reviewFlagIds].sort()) === JSON.stringify(item.flags.map(flag => flag.id).sort()), 'TECHNICAL_REVIEW_FLAG_IDS_CHANGED');
  ensure(item.history.every(entry => entry.decision === 'false_positive' && entry.note === noteFor(checkpoint.flagCreateKey!) && entry.scope.kind === 'full'), 'TECHNICAL_REVIEW_OWNER_DECISION_CHANGED');
  ensure(item.decision === null || item.decision === 'false_positive', 'TECHNICAL_REVIEW_OWNER_DECISION_CHANGED');
}

export function createInternetReviewTrial(options: {
  checkpoint: InternetReviewCheckpoint; denyBookId: string; owner: APIRequestContext;
  call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  save: () => Promise<void>; mark: (stage: string) => void; pass: (check: string) => void;
  report: InternetReviewReport;
}) {
  const { checkpoint: cp, denyBookId, owner, call, save, mark, pass, report } = options;
  const bookPath = `/api/book-workflow/${cp.bookId}`;
  const target = (state: ReviewState) => {
    const item = state.items.find(entry => entry.mediaId === cp.reviewMediaId && entry.sourceId === cp.reviewSourceId);
    ensure(item, 'TECHNICAL_REVIEW_TARGET_MISSING'); return item;
  };
  const ownerState = () => getJson<ReviewState>(owner, `${bookPath}/reviews?sourceId=${cp.reviewSourceId}`);
  const mcpState = async () => parsed<ReviewState>(await call('list_content_flags', { bookId: cp.bookId, sourceId: cp.reviewSourceId, status: 'all' }));
  const updateReport = () => { report.reviewId = cp.reviewId; report.flagIds = cp.reviewFlagIds; report.sourceId = cp.reviewSourceId; report.mediaId = cp.reviewMediaId; report.holdVerified = cp.reviewHoldVerified === true; };
  const validatePrepared = () => {
    ensure([cp.bookId, cp.snapshotId, cp.versionId, cp.jobId, cp.flagCreateKey, cp.decisionKey, cp.reviewId, cp.reviewSourceId, cp.reviewMediaId].every(value => typeof value === 'string' && uuid.test(value)), 'TECHNICAL_REVIEW_CHECKPOINT_INCOMPLETE');
    ensure(/^[a-f0-9]{64}$/.test(cp.reviewContentHash || '') && /^[a-f0-9]{64}$/.test(cp.reviewPdfSha256 || ''), 'TECHNICAL_REVIEW_HASH_REQUIRED');
  };
  const denied = async (name: string, args: Record<string, unknown>, code: string) => {
    const result = await call(name, args); ensure(result.isError === true, 'CONTENT_REVIEW_DENIAL_MISSING');
    const block = result.content.find(item => item.type === 'text'); ensure(block?.type === 'text', 'CONTENT_REVIEW_DENIAL_INVALID');
    ensure((JSON.parse(block.text) as { error?: string }).error === code, 'CONTENT_REVIEW_DENIAL_CODE_MISMATCH');
  };
  const verifyRestoredPdf = async (expectedRevision?: number) => {
    const state = await ownerState(); const item = target(state); assertOwnedTechnicalReview(cp, item);
    ensure(item.decision === 'false_positive', 'TECHNICAL_REVIEW_NOT_RESOLVED');
    const technicalRevision = Math.max(...item.history.map(entry => entry.revision));
    const expected = expectedRevision ?? cp.reviewDecisionRevision ?? technicalRevision;
    ensure(Number.isSafeInteger(expected) && expected >= 0 && expected === technicalRevision, 'TECHNICAL_REVIEW_DECISION_REVISION_CHANGED');
    const approval = await getJson<{ approved: boolean; withheld: boolean; contentReview: { blocked: boolean; revision: number } }>(owner, `${bookPath}/versions/${cp.versionId}/approval`);
    ensure(approval.approved && approval.contentReview.blocked === false, 'TECHNICAL_REVIEW_OTHER_HOLD_REMAINS');
    if (approval.withheld) {
      ensure(state.revision === expected && approval.contentReview.revision === expected, 'TECHNICAL_REVIEW_UNRELATED_REVISION_CHANGED');
      await postJson(owner, `${bookPath}/versions/${cp.versionId}/approve`, { expectedReviewRevision: expected });
    }
    const pdf = await owner.get(`${bookPath}/exports/${cp.jobId}/download`, { maxRedirects: 0 });
    ensure(pdf.status() === 200, 'TECHNICAL_REVIEW_RESTORED_PDF_STATUS_' + pdf.status());
    ensure(createHash('sha256').update(await pdf.body()).digest('hex') === cp.reviewPdfSha256, 'TECHNICAL_REVIEW_PDF_BYTES_CHANGED');
    report.originalPdfUnchanged = true;
  };
  const restore = async () => {
    validatePrepared(); const state = await ownerState(); const item = target(state);
    if (!item.flags.length) { ensure(cp.reviewStatus === 'prepared' && !cp.reviewFlagIds?.length && !item.history.length, 'TECHNICAL_REVIEW_FLAGS_DISAPPEARED'); return false; }
    assertOwnedTechnicalReview(cp, item);
    cp.reviewFlagIds = item.flags.map(flag => flag.id).sort(); await save(); updateReport();
    if (item.decision === null) {
      // The server compares this revision under its book lock. A concurrently added
      // user flag/decision therefore cannot be swept into the technical cleanup.
      const resolved = await postJson<{ revision: number }>(owner, `${bookPath}/reviews/${item.id}/decision`, { key: cp.decisionKey, decision: 'false_positive', note: noteFor(cp.flagCreateKey!), scope: { kind: 'full' }, expectedRevision: state.revision });
      ensure(Number.isSafeInteger(resolved.revision) && resolved.revision > state.revision, 'TECHNICAL_REVIEW_DECISION_REVISION_INVALID'); cp.reviewDecisionRevision = resolved.revision;
    } else {
      const revision = Math.max(...item.history.map(entry => entry.revision));
      ensure(Number.isSafeInteger(revision) && revision >= 0 && (cp.reviewDecisionRevision === undefined || cp.reviewDecisionRevision === revision), 'TECHNICAL_REVIEW_DECISION_REVISION_CHANGED'); cp.reviewDecisionRevision = revision;
    }
    cp.reviewStatus = 'resolved'; await save();
    await verifyRestoredPdf(cp.reviewDecisionRevision); return true;
  };
  return {
    async prepare(sourceId: string, mediaId: string, pdfSha256: string) {
      if (cp.flagCreateKey) { validatePrepared(); return; }
      ensure(uuid.test(sourceId) && uuid.test(mediaId) && /^[a-f0-9]{64}$/.test(pdfSha256), 'TECHNICAL_REVIEW_PREPARATION_INVALID');
      const state = parsed<ReviewState>(await call('list_content_flags', { bookId: cp.bookId, sourceId, status: 'all' }));
      const item = state.items.find(entry => entry.mediaId === mediaId && entry.sourceId === sourceId);
      ensure(item && !item.flags.length && !item.history.length && item.decision === null && item.status === 'unreviewed', 'TECHNICAL_REVIEW_TARGET_HAS_EXISTING_FLAGS');
      cp.flagCreateKey = randomUUID(); cp.decisionKey = randomUUID(); cp.reviewId = item.id;
      cp.reviewSourceId = sourceId; cp.reviewMediaId = mediaId; cp.reviewContentHash = item.contentHash; cp.reviewPdfSha256 = pdfSha256; cp.reviewStatus = 'prepared';
      validatePrepared(); await save(); updateReport();
    },
    async run() {
      validatePrepared(); updateReport(); mark('content_review_precondition');
      let item = target(await mcpState());
      if (item.flags.length) {
        assertOwnedTechnicalReview(cp, item); cp.reviewFlagIds = item.flags.map(flag => flag.id).sort(); await save(); updateReport();
        if (item.decision === 'false_positive') {
          await verifyRestoredPdf();
          const complete = cp.reviewStatus === 'complete' && cp.reviewHoldVerified;
          report.status = complete ? 'PRIOR_COMPLETED_TRIAL_PRESERVED' : 'PRIOR_TRIAL_RECOVERED_NO_NEW_HOLD';
          cp.reviewStatus = complete ? 'complete' : 'recovered'; await save();
          pass(complete ? 'prior_content_review_trial_preserved_without_new_hold' : 'prior_technical_review_recovered_without_claiming_new_hold'); return;
        }
      } else ensure(cp.reviewStatus === 'prepared' && !cp.reviewFlagIds?.length && !item.history.length && item.contentHash === cp.reviewContentHash && item.id === cp.reviewId, 'TECHNICAL_REVIEW_PRECONDITION_CHANGED');
      const body = { bookId: cp.bookId, key: cp.flagCreateKey, sourceId: cp.reviewSourceId, mediaId: cp.reviewMediaId, categories, reason: reasonFor(cp.flagCreateKey!), scope: { kind: 'full' } };
      mark('content_review_sdk_flag');
      const created = parsed<{ item: ReviewItem; revision: number; replayed: boolean }>(await call('create_content_flag', body));
      assertOwnedTechnicalReview(cp, created.item); cp.reviewFlagIds = created.item.flags.map(flag => flag.id).sort(); cp.reviewStatus = 'flagged'; await save(); updateReport();
      const replay = parsed<{ item: ReviewItem; replayed: boolean }>(await call('create_content_flag', body)); assertOwnedTechnicalReview(cp, replay.item); ensure(replay.replayed === true, 'TECHNICAL_REVIEW_REPLAY_FAILED');
      const listed = await mcpState(); item = target(listed); assertOwnedTechnicalReview(cp, item); ensure(item.decision === null && listed.pendingIds.includes(item.id) && listed.pendingCount >= 1, 'TECHNICAL_REVIEW_PENDING_SUMMARY_MISSING');
      ensure(!Object.hasOwn(item, 'text') && !Object.hasOwn(item, 'previewUrl'), 'TECHNICAL_REVIEW_RAW_CONTENT_LEAK');
      await denied('create_content_flag', { ...body, decision: 'allowed' }, 'INVALID_ARGUMENTS');
      await denied('create_content_flag', { ...body, origin: 'manual' }, 'INVALID_ARGUMENTS');
      await denied('list_content_flags', { bookId: denyBookId }, 'BOOK_NOT_FOUND');
      await denied('create_content_flag', { ...body, bookId: denyBookId }, 'BOOK_NOT_FOUND');
      pass('sdk_technical_multicategory_flag_idempotency_and_strict_denials');
      mark('content_review_hold');
      await denied('get_media', { bookId: cp.bookId, snapshotId: cp.snapshotId, mediaId: cp.reviewMediaId }, 'CONTENT_REVIEW_BLOCKED');
      await denied('get_draft', { bookId: cp.bookId, versionId: cp.versionId }, 'CONTENT_REVIEW_BLOCKED');
      const heldPdf = await owner.get(`${bookPath}/exports/${cp.jobId}/download`, { maxRedirects: 0 }); ensure(heldPdf.status() === 409, 'CONTENT_REVIEW_PDF_HOLD_STATUS_' + heldPdf.status());
      const held = parsed<{ withheld: boolean; downloadUrl?: string | null; downloadPath?: string | null }>(await call('get_export', { bookId: cp.bookId, jobId: cp.jobId }));
      ensure(held.withheld === true && !held.downloadUrl && !held.downloadPath, 'CONTENT_REVIEW_WITHHELD_EXPORT_LINK');
      cp.reviewHoldVerified = true; cp.reviewStatus = 'hold_verified'; await save(); updateReport(); pass('snapshot_media_old_draft_and_approved_pdf_hold_verified');
      mark('content_review_owner_restore'); await restore(); cp.reviewStatus = 'complete'; await save();
      report.status = 'PASS'; updateReport(); pass('technical_flag_false_positive_owner_reapproval_original_pdf_hash_unchanged');
    },
    async cleanup() {
      if (!cp.flagCreateKey || cp.reviewStatus === 'complete' || cp.reviewStatus === 'recovered') return;
      if (await restore()) { cp.reviewStatus = 'recovered'; await save(); report.cleanup = 'OWN_TECHNICAL_FLAG_RESOLVED_AND_EDITION_REAPPROVED'; }
      else report.cleanup = 'NO_TECHNICAL_FLAG_CREATED';
      updateReport();
    },
  };
}
