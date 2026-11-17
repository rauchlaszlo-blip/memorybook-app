import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Draft, Source } from '../../shared/montage';
import { reviewCategories } from '../../shared/content-review';
import type { CreateReviewInput, DecideReviewInput, ReviewDecision, ReviewDraftPolicy, ReviewFlag, ReviewItem, ReviewListOptions, ReviewScope, ReviewState, ReviewSummary } from '../../shared/content-review';
import { deploymentAllowsMcpBook } from '../mcp/book-policy';
import { montageSources } from './montage-sources';

type Db = Pick<Pool, 'query'>;
export type ReviewActor = { ownerId: string; kind: 'owner' | 'mcp'; allowedBookIds?: string[] };
export class ContentReviewError extends Error {
  constructor(public code: string, public status = 400, public details?: unknown) { super(code); }
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const fail = (code = 'INVALID_CONTENT_REVIEW', status = 400): never => { throw new ContentReviewError(code, status); };
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const textHash = (sourceId: string, text: string) => hash({ kind: 'text', sourceId, text });
const itemId = (bookId: string, key: string, digest: string) => {
  const h = hash({ bookId: bookId.toLowerCase(), key, digest });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
function strict(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) return fail();
  return value as Record<string, unknown>;
}
function scopeInput(value: unknown): ReviewScope {
  const s = strict(value, ['kind', 'startSeconds', 'endSeconds', 'note']);
  if (typeof s.kind !== 'string' || !['full', 'partial', 'unspecified'].includes(s.kind)) return fail();
  if (s.note !== undefined && (typeof s.note !== 'string' || s.note.length > 1000)) return fail();
  for (const k of ['startSeconds', 'endSeconds']) if (s[k] !== undefined && (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || Number(s[k]) < 0 || Number(s[k]) > 86400 || s.kind !== 'partial')) return fail();
  if (s.startSeconds !== undefined && s.endSeconds !== undefined && Number(s.endSeconds) <= Number(s.startSeconds)) return fail();
  return { kind: s.kind as ReviewScope['kind'], ...(s.startSeconds !== undefined ? { startSeconds: Number(s.startSeconds) } : {}), ...(s.endSeconds !== undefined ? { endSeconds: Number(s.endSeconds) } : {}), ...(s.note !== undefined ? { note: String(s.note).trim() } : {}) };
}
function createInput(value: unknown): CreateReviewInput {
  const x = strict(value, ['key', 'sourceId', 'mediaId', 'versionId', 'elementId', 'expectedContentHash', 'categories', 'reason', 'scope']);
  if (x.expectedContentHash !== undefined && (typeof x.expectedContentHash !== 'string' || !/^[a-f\d]{64}$/.test(x.expectedContentHash))) return fail();
  if (!validId(x.key) || !validId(x.sourceId) || x.mediaId !== undefined && !validId(x.mediaId) || x.versionId !== undefined && !validId(x.versionId)) return fail();
  if ((x.versionId !== undefined) !== (x.elementId !== undefined) || x.mediaId !== undefined && x.versionId !== undefined || x.elementId !== undefined && (typeof x.elementId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(x.elementId))) return fail();
  if (!Array.isArray(x.categories) || !x.categories.length || x.categories.length > 3 || new Set(x.categories).size !== x.categories.length || x.categories.some(c => !reviewCategories.includes(c)) || typeof x.reason !== 'string' || !x.reason.trim() || x.reason.length > 1000) return fail();
  return { key: String(x.key).toLowerCase(), sourceId: String(x.sourceId).toLowerCase(), ...(x.mediaId ? { mediaId: String(x.mediaId).toLowerCase() } : {}), ...(x.versionId ? { versionId: String(x.versionId).toLowerCase(), elementId: String(x.elementId) } : {}), ...(x.expectedContentHash ? { expectedContentHash: String(x.expectedContentHash) } : {}), categories: [...x.categories].sort(), reason: x.reason.trim(), scope: scopeInput(x.scope) };
}
function decideInput(value: unknown): DecideReviewInput {
  const x = strict(value, ['key', 'decision', 'note', 'scope', 'expectedRevision']);
  if (!validId(x.key) || typeof x.decision !== 'string' || !['false_positive', 'allowed', 'private_only', 'omit'].includes(x.decision) || x.note !== undefined && (typeof x.note !== 'string' || x.note.length > 1000)) return fail();
  if (x.expectedRevision !== undefined && (typeof x.expectedRevision !== 'number' || !Number.isSafeInteger(x.expectedRevision) || x.expectedRevision < 0)) return fail();
  return { key: String(x.key).toLowerCase(), decision: x.decision as ReviewDecision, ...(x.note !== undefined ? { note: String(x.note).trim() } : {}), ...(x.expectedRevision !== undefined ? { expectedRevision: x.expectedRevision as number } : {}), scope: scopeInput(x.scope) };
}
async function authorize(db: Db, actor: ReviewActor, bookId: string, lock = false) {
  if (!validId(bookId) || !actor?.ownerId || !['owner', 'mcp'].includes(actor.kind)) return fail('BOOK_NOT_FOUND', 404);
  if (actor.kind === 'mcp' && (!actor.allowedBookIds?.map(id => id.toLowerCase()).includes(bookId.toLowerCase()) || !deploymentAllowsMcpBook(bookId))) return fail('BOOK_NOT_FOUND', 404);
  const row = (await db.query(`SELECT content_review_revision FROM event_books WHERE id=$1 AND owner_user_id=$2${lock ? ' FOR UPDATE' : ''}`, [bookId, actor.ownerId])).rows[0];
  if (!row) return fail('BOOK_NOT_FOUND', 404);
  return Number(row.content_review_revision);
}
type Target = { id: string; logicalKey: string; sourceId: string; mediaId?: string; versionId?: string; elementId?: string; kind: ReviewItem['kind']; contentHash: string; contributor: string; text?: string; previewUrl?: string; mediaEvidence?: { originalSha256: string; annotation: unknown } };
type ItemRow = { id: string; logical_key: string; source_id: string; media_id: string | null; version_id: string | null; element_id: string | null; kind: ReviewItem['kind']; content_hash: string; evidence: { contributor: string; text?: string; mediaEvidence?: Target['mediaEvidence'] } };
type FlagRow = { id: string; item_id: string; category: ReviewFlag['category']; origin: ReviewFlag['origin']; reason: string; scope: ReviewScope; revision: string; created_at: Date };
type DecisionRow = { item_id: string; decision: ReviewDecision; scope: ReviewScope; note: string | null; actor_id: string; revision: string; created_at: Date };
type StateOptions = { versionId?: string; draft?: Draft; snapshotId?: string };
async function targets(db: Db, bookId: string, sources: Source[], options: StateOptions, historicalKeys: Set<string>): Promise<Target[]> {
  const result: Target[] = [];
  const push = (t: Omit<Target, 'id'>) => { const id = itemId(bookId, t.logicalKey, t.contentHash); if (!result.some(x => x.id === id)) result.push({ id, ...t }); };
  const mediaIds = sources.flatMap(s => s.media.map(m => m.id));
  const media = mediaIds.length ? (options.snapshotId
    ? await db.query(`SELECT sm.media_id AS id,sm.source_id,sm.original_bytes,sm.annotation AS layer FROM event_book_snapshot_media sm JOIN event_book_snapshots s ON s.id=sm.snapshot_id WHERE sm.snapshot_id=$1 AND s.book_id=$2 AND sm.media_id=ANY($3::uuid[])`, [options.snapshotId, bookId, mediaIds])
    : await db.query(`SELECT m.id,m.submission_id AS source_id,m.original_bytes,a.layer FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE m.book_id=$1 AND m.state='attached' AND m.id=ANY($2::uuid[])`, [bookId, mediaIds])).rows : [];
  const byMedia = new Map(media.map(m => [m.id, m]));
  for (const s of sources) {
    if (s.message.trim() || historicalKeys.has('text:' + s.id)) push({ logicalKey: 'text:' + s.id, sourceId: s.id, kind: 'text', contentHash: textHash(s.id, s.message), contributor: s.name, text: s.message });
    for (const m of s.media) {
      const bytes = byMedia.get(m.id); if (!bytes || bytes.source_id !== s.id) return fail('REVIEW_SOURCE_UNAVAILABLE', 409);
      const originalSha256 = createHash('sha256').update(bytes.original_bytes).digest('hex');
      push({ logicalKey: 'media:' + m.id, sourceId: s.id, mediaId: m.id, kind: 'photo', contentHash: hash({ kind: 'photo', sourceId: s.id, mediaId: m.id, bytes: originalSha256, annotation: bytes.layer || null }), mediaEvidence: { originalSha256, annotation: bytes.layer || null }, contributor: s.name,
        previewUrl: options.snapshotId ? `/api/book-workflow/${bookId}/image/${m.id}?snapshotId=${options.snapshotId}` : `/api/montage/${bookId}/image/${m.id}` });
    }
  }
  for (const e of options.draft?.pages.flatMap(p => p.elements) || []) if (e.kind === 'text' && e.edited && typeof e.text === 'string') {
    const source = sources.find(s => s.id === e.sourceId); if (!source) continue;
    push({ logicalKey: 'edited:' + e.sourceId, sourceId: e.sourceId, ...(options.versionId ? { versionId: options.versionId } : {}), elementId: e.id, kind: 'text', contentHash: textHash(e.sourceId, e.text), contributor: source.name, text: e.text });
  }
  return result;
}
const keyFor = (item: Pick<ReviewItem, 'sourceId' | 'mediaId' | 'elementId'>) => item.mediaId ? 'media:' + item.mediaId : item.elementId ? 'edited:' + item.sourceId : 'text:' + item.sourceId;
const pending = (item: ReviewItem) => item.flags.length > 0 && item.decision === null;
const restriction = (item: ReviewItem, variant: 'private' | 'shareable') => pending(item) ? 'pending' : item.decision === 'omit' ? 'omit' : item.decision === 'private_only' && variant === 'shareable' ? 'private_only' : null;
function fullyCovers(scope: ReviewScope) {
  // A partial/unspecified acknowledgement never clears an entire photo or message.
  // Audio/video time ranges are retained as evidence, not a supported release path.
  return scope.kind === 'full';
}
async function buildState(db: Db, bookId: string, sources: Source[], options: StateOptions = {}, extraTargets: Target[] = []): Promise<ReviewState> {
  // Db may be one transaction client; never concurrently use a pg client.
  const book = await db.query('SELECT content_review_revision FROM event_books WHERE id=$1', [bookId]);
  const itemRows = await db.query<ItemRow>('SELECT * FROM event_content_review_items WHERE book_id=$1', [bookId]);
  const flagRows = await db.query<FlagRow>('SELECT f.* FROM event_content_review_flags f JOIN event_content_review_items i ON i.id=f.item_id WHERE i.book_id=$1 ORDER BY f.revision,f.id', [bookId]);
  const decisionRows = await db.query<DecisionRow>('SELECT d.* FROM event_content_review_decisions d JOIN event_content_review_items i ON i.id=d.item_id WHERE i.book_id=$1 ORDER BY d.revision DESC', [bookId]);
  const versionRows = await db.query<{ id: string; draft: Draft; approved_at: Date | null }>('SELECT id,draft,approved_at FROM event_montage_versions WHERE book_id=$1 ORDER BY revision', [bookId]);
  if (!book.rowCount) return fail('BOOK_NOT_FOUND', 404);
  const histories = new Map(itemRows.rows.map(i => [i.id, i]));
  const current = await targets(db, bookId, sources, options, new Set(itemRows.rows.map(i => i.logical_key)));
  for (const target of extraTargets) if (!current.some(t => t.id === target.id)) current.push(target);
  const items: ReviewItem[] = current.map(target => {
    const exact = flagRows.rows.filter(f => f.item_id === target.id);
    const evidence = exact.length ? exact : flagRows.rows.filter(f => histories.get(f.item_id)?.logical_key === target.logicalKey);
    const flags: ReviewFlag[] = evidence.map(f => ({ id: f.id, category: f.category, origin: f.origin, reason: f.reason, createdAt: new Date(f.created_at).toISOString(), scope: f.scope, evidenceContentHash: histories.get(f.item_id)!.content_hash }));
    const latest = decisionRows.rows.find(d => d.item_id === target.id);
    const effective = latest && Number(latest.revision) >= Math.max(0, ...evidence.map(f => Number(f.revision))) && (['omit', 'private_only'].includes(latest.decision) || fullyCovers(latest.scope)) ? latest : undefined;
    const contentChanged = evidence.length > 0 && evidence.some(f => histories.get(f.item_id)!.content_hash !== target.contentHash) && !effective;
    const affectedPages = versionRows.rows.flatMap(v => {
      const pageNumbers = v.draft.pages.flatMap((p, i) => p.elements.some(e => target.mediaId ? e.kind === 'photo' && e.mediaId === target.mediaId : e.kind === 'text' && e.sourceId === target.sourceId && (!target.elementId || e.edited && textHash(e.sourceId, e.text || '') === target.contentHash)) ? [i + 1] : []);
      return pageNumbers.length ? [{ versionId: v.id, pageNumbers, approved: !!v.approved_at }] : [];
    });
    const history = decisionRows.rows.filter(d => d.item_id === target.id).map(d => ({ decision: d.decision, scope: d.scope, ...(d.note ? { note: d.note } : {}), actorId: d.actor_id, createdAt: new Date(d.created_at).toISOString(), revision: Number(d.revision) }));
    return { id: target.id, sourceId: target.sourceId, ...(target.mediaId ? { mediaId: target.mediaId } : {}), ...(target.versionId ? { versionId: target.versionId } : {}), ...(target.elementId ? { elementId: target.elementId } : {}), kind: target.kind, contentHash: target.contentHash, contributor: target.contributor, ...(target.text !== undefined ? { text: target.text } : {}), ...(target.previewUrl ? { previewUrl: target.previewUrl } : {}), categories: [...new Set(flags.map(f => f.category))], flags, decision: effective?.decision || null, ...(latest ? { decidedBy: latest.actor_id, decidedAt: new Date(latest.created_at).toISOString() } : {}), scope: latest?.scope || { kind: 'unspecified' }, contentChanged, status: contentChanged ? 'changed' : flags.length ? effective ? 'resolved' : 'pending' : 'unreviewed', affectedPages, history };
  });
  const pendingIds = items.filter(pending).map(i => i.id);
  return { revision: Number(book.rows[0].content_review_revision), items, pendingCount: pendingIds.length, pendingIds, totalCount: items.filter(i => i.flags.length).length, targetCount: items.length, capabilities: { delete: false, audio: false, video: false, automatedDetection: false, publicSharing: false } };
}

/** Callers supplying a transaction must hold the book row lock through the protected operation. */
export async function reviewState(db: Db, bookId: string, sources: Source[], options: StateOptions = {}): Promise<ReviewState> { return buildState(db, bookId, sources, options); }

export function filterReviewSources(sources: Source[], state: ReviewState, variant: 'private' | 'shareable' = 'private'): { sources: Source[]; contentReview: ReviewSummary } {
  const result = structuredClone(sources);
  const contentReview: ReviewSummary = { revision: state.revision, pendingCount: state.pendingCount, pendingIds: [...state.pendingIds], restrictedIds: [], omittedItems: [], omittedContributors: [], partialOmissions: [] };
  const reasonLabels = { pending: 'Átnézésre váró tartalom miatt kimaradt.', omit: 'Tulajdonosi döntés miatt kimaradt.', private_only: 'Saját célú tartalom miatt a megosztható változatból kimaradt.' };
  for (const source of result) {
    const textItem = state.items.find(i => i.sourceId === source.id && i.kind === 'text' && !i.elementId);
    const reason = textItem && restriction(textItem, variant);
    source.review = { originalHasMessage: !!source.message.trim(), textState: textItem ? pending(textItem) ? 'pending' : textItem.decision === 'omit' ? 'omit' : textItem.decision === 'private_only' ? 'private_only' : textItem.decision ? 'allowed' : 'unreviewed' : 'unreviewed', pendingIds: textItem && pending(textItem) ? [textItem.id] : [] };
    if (reason && textItem) { source.message = ''; contentReview.restrictedIds.push(textItem.id); contentReview.omittedItems.push({ sourceId: source.id, guestId: source.guestId, contributor: source.name, reviewId: textItem.id, kind: 'text', reason, reasonLabel: reasonLabels[reason] }); }
    source.media = source.media.filter(media => {
      const item = state.items.find(i => i.mediaId === media.id), why = item && restriction(item, variant);
      if (!why || !item) return true;
      contentReview.restrictedIds.push(item.id); contentReview.omittedItems.push({ sourceId: source.id, guestId: source.guestId, contributor: source.name, reviewId: item.id, kind: item.kind, reason: why, reasonLabel: reasonLabels[why] }); return false;
    });
  }
  const represented = new Set(result.filter(s => s.message.trim() || s.media.length).map(s => s.guestId));
  contentReview.partialOmissions = contentReview.omittedItems.filter(item => represented.has(item.guestId));
  for (const guestId of new Set(contentReview.omittedItems.filter(item => !represented.has(item.guestId)).map(item => item.guestId))) {
    const items = contentReview.omittedItems.filter(item => item.guestId === guestId), reasons = [...new Set(items.map(item => item.reason))];
    contentReview.omittedContributors.push({ guestId, contributor: items[0].contributor, sourceIds: [...new Set(items.map(item => item.sourceId))], reviewIds: items.map(item => item.reviewId), reasons, reasonLabels: reasons.map(reason => reasonLabels[reason]) });
  }
  return { sources: result, contentReview };
}

export async function reviewDraftPolicy(db: Db, bookId: string, draft: Draft, sources: Source[], options: { versionId?: string; snapshotId?: string; clearanceRevision?: number } = {}): Promise<ReviewDraftPolicy> {
  const state = await reviewState(db, bookId, sources, { ...options, draft });
  const pendingIds = new Set<string>(), restrictedIds = new Set<string>(), blockedElementIds = new Set<string>(), affectedPages = new Set<number>(), keys = new Set<string>();
  draft.pages.forEach((page, index) => page.elements.forEach(e => {
    const relevant = state.items.filter(i => e.kind === 'photo' ? i.mediaId === e.mediaId : i.sourceId === e.sourceId && i.kind === 'text' && (!i.elementId || e.edited && i.contentHash === textHash(e.sourceId, e.text || '')));
    for (const item of relevant) {
      keys.add(keyFor(item));
      if (!restriction(item, draft.editionVariant || 'private')) continue;
      (pending(item) ? pendingIds : restrictedIds).add(item.id); blockedElementIds.add(e.id); affectedPages.add(index + 1);
    }
  }));
  const restrictions = (await db.query('SELECT logical_key,last_restriction_revision FROM event_content_review_restrictions WHERE book_id=$1', [bookId])).rows;
  const blocked = blockedElementIds.size > 0;
  const requiresReview = blocked || restrictions.some(r => keys.has(r.logical_key) && Number(r.last_restriction_revision) > (options.clearanceRevision || 0));
  return { revision: state.revision, blocked, affectedPages: [...affectedPages].sort((a, b) => a - b), blockedElementIds: [...blockedElementIds], pendingIds: [...pendingIds], restrictedIds: [...restrictedIds], requiresReview };
}
export async function getReviewClearance(db: Db, bookId: string, versionId: string): Promise<number> {
  const row = (await db.query('SELECT owner_reviewed_revision FROM event_content_release_clearances WHERE book_id=$1 AND version_id=$2', [bookId, versionId])).rows[0];
  return Number(row?.owner_reviewed_revision || 0);
}
/** Owner-authenticated approval calls this within the same locked transaction as policy validation. */
export async function clearReviewForVersion(db: Db, bookId: string, versionId: string, revision: number, actorId: string): Promise<void> {
  const book = (await db.query('SELECT content_review_revision FROM event_books WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [bookId, actorId])).rows[0];
  if (!book) return fail('BOOK_NOT_FOUND', 404);
  if (Number(book.content_review_revision) !== revision) return fail('CONTENT_REVIEW_CONFLICT', 409);
  if (!(await db.query('SELECT id FROM event_montage_versions WHERE id=$1 AND book_id=$2', [versionId, bookId])).rowCount) return fail('VERSION_NOT_FOUND', 404);
  await db.query(`INSERT INTO event_content_release_clearances(book_id,version_id,owner_reviewed_revision,actor_id) VALUES($1,$2,$3,$4) ON CONFLICT(book_id,version_id) DO UPDATE SET owner_reviewed_revision=EXCLUDED.owner_reviewed_revision,actor_id=EXCLUDED.actor_id,reviewed_at=CURRENT_TIMESTAMP`, [bookId, versionId, revision, actorId]);
  await db.query(`INSERT INTO event_book_audit(book_id,actor_id,actor_kind,operation,target_id,details) VALUES($1,$2,'owner','content.release_reviewed',$3,$4)`, [bookId, actorId, versionId, JSON.stringify({ revision })]);
}

async function materialize(db: Db, bookId: string, target: Target) {
  await db.query(`INSERT INTO event_content_review_items(id,book_id,logical_key,source_id,media_id,version_id,element_id,kind,content_hash,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [target.id, bookId, target.logicalKey, target.sourceId, target.mediaId || null, target.versionId || null, target.elementId || null, target.kind, target.contentHash, JSON.stringify({ contributor: target.contributor, ...(target.text !== undefined ? { text: target.text } : {}), ...(target.mediaEvidence ? { mediaEvidence: target.mediaEvidence } : {}) })]);
}
const targetOf = (item: ReviewItem): Target => ({ ...item, logicalKey: keyFor(item) });
const targetFromRow = (row: ItemRow): Target => ({ id: row.id, logicalKey: row.logical_key, sourceId: row.source_id, ...(row.media_id ? { mediaId: row.media_id } : {}), ...(row.version_id ? { versionId: row.version_id } : {}), ...(row.element_id ? { elementId: row.element_id } : {}), kind: row.kind, contentHash: row.content_hash, contributor: row.evidence.contributor, ...(row.evidence.text !== undefined ? { text: row.evidence.text } : {}), ...(row.evidence.mediaEvidence ? { mediaEvidence: row.evidence.mediaEvidence } : {}) });
async function currentState(db: Db, bookId: string, versionId?: string) {
  const sources = await montageSources(db, bookId);
  const latest = (await db.query('SELECT id,draft FROM event_montage_versions WHERE book_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY revision DESC LIMIT 1', [bookId, versionId || null])).rows[0];
  if (versionId && !latest) return fail('VERSION_NOT_FOUND', 404);
  const options = latest ? { versionId: latest.id as string, draft: latest.draft as Draft } : {};
  // A flag on an earlier saved edit remains discoverable after a newer version is saved.
  const priorEdits = versionId ? [] : (await db.query<ItemRow>('SELECT * FROM event_content_review_items WHERE book_id=$1 AND element_id IS NOT NULL', [bookId])).rows.map(targetFromRow);
  return { sources, options, state: await buildState(db, bookId, sources, options, priorEdits) };
}
async function increment(db: Db, bookId: string, logicalKey: string, restrictive: boolean) {
  const row = (await db.query('UPDATE event_books SET content_review_revision=content_review_revision+1 WHERE id=$1 RETURNING content_review_revision', [bookId])).rows[0];
  const revision = Number(row.content_review_revision);
  if (restrictive) await db.query(`INSERT INTO event_content_review_restrictions(book_id,logical_key,last_restriction_revision) VALUES($1,$2,$3) ON CONFLICT(book_id,logical_key) DO UPDATE SET last_restriction_revision=EXCLUDED.last_restriction_revision`, [bookId, logicalKey, revision]);
  return revision;
}
export function createContentReviewService(pool: Pool) {
  const transaction = async <T>(actor: ReviewActor, bookId: string, fn: (db: PoolClient, revision: number) => Promise<T>) => {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const revision = await authorize(db, actor, bookId, true); const result = await fn(db, revision); await db.query('COMMIT'); return result; }
    catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  };
  const request = async (db: Db, bookId: string, key: string, operation: string, input: unknown) => {
    const digest = hash({ operation, input });
    const prior = (await db.query('SELECT * FROM event_content_review_requests WHERE book_id=$1 AND action_key=$2', [bookId, key])).rows[0];
    if (prior && (prior.operation !== operation || prior.request_hash !== digest)) return fail('IDEMPOTENCY_CONFLICT', 409);
    return { digest, prior };
  };
  const remember = (db: Db, bookId: string, key: string, operation: string, digest: string, id: string, revision: number) => db.query('INSERT INTO event_content_review_requests(book_id,action_key,operation,request_hash,item_id,revision) VALUES($1,$2,$3,$4,$5,$6)', [bookId, key, operation, digest, id, revision]);
  const storedTarget = async (db: Db, bookId: string, id: string): Promise<Target> => {
    const row = (await db.query<ItemRow>('SELECT * FROM event_content_review_items WHERE id=$1 AND book_id=$2', [id, bookId])).rows[0];
    if (!row) return fail('CONTENT_REVIEW_NOT_FOUND', 404);
    return targetFromRow(row);
  };
  const resultItem = async (db: Db, bookId: string, target: Target, revision: number, replayed: boolean) => {
    const { sources, options } = await currentState(db, bookId);
    const state = await buildState(db, bookId, sources, options, [target]);
    return { item: state.items.find(i => i.id === target.id)!, revision, replayed };
  };
  return {
    async list(actor: ReviewActor, bookId: string, input: ReviewListOptions = {}): Promise<ReviewState> {
      strict(input, ['category', 'status', 'sourceId', 'versionId']);
      if (input.category !== undefined && !reviewCategories.includes(input.category) || input.status !== undefined && !['all', 'pending', 'resolved', 'unreviewed', 'changed'].includes(input.status) || input.sourceId !== undefined && !validId(input.sourceId) || input.versionId !== undefined && !validId(input.versionId)) return fail();
      // One transaction/book lock gives a coherent revision and decision view.
      return transaction(actor, bookId, async db => {
        const { state } = await currentState(db, bookId, input.versionId);
        state.items = state.items.filter(i => (!input.sourceId || i.sourceId === input.sourceId.toLowerCase()) && (!input.category || i.categories.includes(input.category)) && (!input.status || input.status === 'all' || input.status === 'pending' && pending(i) || i.status === input.status));
        state.pendingIds = state.items.filter(pending).map(i => i.id); state.pendingCount = state.pendingIds.length; state.totalCount = state.items.filter(i => i.flags.length).length; state.targetCount = state.items.length;
        return state;
      });
    },
    async create(actor: ReviewActor, bookId: string, value: CreateReviewInput) {
      const input = createInput(value);
      return transaction(actor, bookId, async (db, priorRevision) => {
        const { digest, prior } = await request(db, bookId, input.key, 'flag', input);
        if (prior) return resultItem(db, bookId, await storedTarget(db, bookId, prior.item_id), Number(prior.revision), true);
        const sources = await montageSources(db, bookId);
        let options: StateOptions = {};
        if (input.versionId) {
          const v = (await db.query('SELECT draft,snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2', [input.versionId, bookId])).rows[0];
          if (!v) return fail('VERSION_NOT_FOUND', 404);
          const e = (v.draft as Draft).pages.flatMap(p => p.elements).find(e => e.id === input.elementId && e.sourceId === input.sourceId && e.kind === 'text' && e.edited);
          if (!e) return fail('INVALID_REVIEW_TARGET');
          options = { versionId: input.versionId, draft: v.draft };
        }
        const available = await targets(db, bookId, sources, options, new Set());
        const target = available.find(t => t.sourceId === input.sourceId && (input.mediaId ? t.mediaId === input.mediaId : input.elementId ? t.elementId === input.elementId : t.kind === 'text' && !t.elementId));
        if (!target) return fail('INVALID_REVIEW_TARGET', 404);
        if (input.expectedContentHash && input.expectedContentHash !== target.contentHash) return fail('CONTENT_REVIEW_CONFLICT', 409);
        await materialize(db, bookId, target);
        const origin = actor.kind === 'owner' ? 'manual' : 'mcp';
        const existing = (await db.query('SELECT category FROM event_content_review_flags WHERE item_id=$1 AND origin=$2', [target.id, origin])).rows.map(r => r.category);
        const added = input.categories.filter(c => !existing.includes(c));
        const revision = added.length ? await increment(db, bookId, target.logicalKey, true) : priorRevision;
        for (const category of added) await db.query('INSERT INTO event_content_review_flags(id,item_id,category,origin,reason,scope,actor_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), target.id, category, origin, input.reason, JSON.stringify(input.scope), actor.ownerId, revision]);
        await remember(db, bookId, input.key, 'flag', digest, target.id, revision);
        if (added.length) await db.query('INSERT INTO event_book_audit(book_id,actor_id,actor_kind,operation,target_id,details) VALUES($1,$2,$3,$4,$5,$6)', [bookId, actor.ownerId, actor.kind, 'content.flagged', target.id, JSON.stringify({ revision, categories: added, contentHash: target.contentHash, scope: input.scope })]);
        return resultItem(db, bookId, target, revision, !added.length);
      });
    },
    async decide(actor: ReviewActor, bookId: string, reviewId: string, value: DecideReviewInput) {
      if (actor?.kind !== 'owner') return fail('OWNER_REVIEW_REQUIRED', 403);
      if (!validId(reviewId)) return fail('CONTENT_REVIEW_NOT_FOUND', 404);
      reviewId = reviewId.toLowerCase();
      const input = decideInput(value);
      return transaction(actor, bookId, async (db, currentRevision) => {
        const { digest, prior } = await request(db, bookId, input.key, 'decision', { reviewId, ...input });
        if (prior) return resultItem(db, bookId, await storedTarget(db, bookId, prior.item_id), Number(prior.revision), true);
        if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) return fail('CONTENT_REVIEW_CONFLICT', 409);
        const { state, sources, options } = await currentState(db, bookId);
        const current = state.items.find(i => i.id === reviewId);
        let target = current ? targetOf(current) : await storedTarget(db, bookId, reviewId);
        if (current?.mediaId) {
          const exact = (await targets(db, bookId, sources, options, new Set())).find(t => t.id === reviewId);
          if (!exact) return fail('CONTENT_REVIEW_CONFLICT', 409);
          target = exact;
        }
        const item = current || (await buildState(db, bookId, sources, options, [target])).items.find(i => i.id === reviewId)!;
        if (!item.flags.length) return fail('CONTENT_NOT_FLAGGED', 409);
        await materialize(db, bookId, target);
        const revision = await increment(db, bookId, target.logicalKey, ['omit', 'private_only'].includes(input.decision));
        await db.query('INSERT INTO event_content_review_decisions(id,item_id,decision,note,scope,actor_id,revision) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), target.id, input.decision, input.note || null, JSON.stringify(input.scope), actor.ownerId, revision]);
        await remember(db, bookId, input.key, 'decision', digest, target.id, revision);
        await db.query(`INSERT INTO event_book_audit(book_id,actor_id,actor_kind,operation,target_id,details) VALUES($1,$2,'owner','content.decided',$3,$4)`, [bookId, actor.ownerId, target.id, JSON.stringify({ revision, decision: input.decision, scope: input.scope, contentHash: target.contentHash })]);
        return resultItem(db, bookId, target, revision, false);
      });
    },
  };
}
