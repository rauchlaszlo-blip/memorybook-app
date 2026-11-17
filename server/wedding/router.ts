import { Router, json } from 'express';
import type { Request, RequestHandler, ErrorRequestHandler } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { weddingTemplate } from '../../shared/event-templates';
import { localDatabaseUrl } from './local-db';
import { createMediaRouter } from './media';
import type { MediaLimits } from './media';
import { PhotoError } from './media';
import { parseAnnotation } from '../../shared/photo-annotation';
import type { Annotation } from '../../shared/photo-annotation';
import { annotationHash, attachAnnotation } from './annotation';
import { accessSql, guestDevice } from './access-window';
import { guestMediaLimits, maxMediaDurationSeconds, supportedMediaMimeTypes } from '../../shared/media-limits';

export type WeddingSession = { user: { id: string; email?: string | null } } | null;
export interface WeddingOptions {
  pool: Pool;
  getSession: (request: Request) => Promise<WeddingSession>;
  env?: NodeJS.ProcessEnv;
  loginPilot?: () => Promise<Response>;
  publicOrigin?: string;
  allowPilotOwner?: string;
  media?: MediaLimits;
  shopAvailable?: boolean;
  contentReview?: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const productFilter = "product = 'celebration' AND event_type = 'wedding' AND template_id = 'wedding-classic' AND template_version = 1";
const ownerColumns = 'id, title, subjects, starts_on::text, ends_on::text, template_id, template_version, closed_at, created_at, invite_token, package_version, submission_start, submission_end, finalized_at';

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || Array.from(text).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) return null;
  return text;
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function canCreateWedding(session: WeddingSession, env: NodeJS.ProcessEnv): boolean {
  return !!session && ['development', 'test'].includes(env.NODE_ENV || '') &&
    env.WEDDING_PILOT_CREATE_ENABLED === 'true' &&
    (env.WEDDING_PILOT_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(session.user.id);
}

export function createWeddingRouter({ pool, getSession, env = process.env, loginPilot, publicOrigin, allowPilotOwner, media, shopAvailable, contentReview = false }: WeddingOptions) {
  const router = Router();
  const canCreate = (session: WeddingSession) => canCreateWedding(session, env) ||
    (!!allowPilotOwner && session?.user.id === allowPilotOwner);
  const withLink = (book: Record<string, unknown>) => publicOrigin
    ? { ...book, guest_url: publicOrigin + '/wedding/join/' + book.invite_token } : book;
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (env.WEDDING_ENABLED !== 'true') { res.status(404).json({ error: 'WEDDING_DISABLED' }); return; }
    next();
  });
  router.use(json({ limit: media ? '340kb' : '32kb' }));
  router.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = new Set([`${req.protocol}://${req.get('host')}`, env.PUBLIC_APP_URL, env.BETTER_AUTH_URL]);
    if (['development', 'test'].includes(env.NODE_ENV || '')) {
      allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173');
    }
    if (req.method !== 'GET' && origin && !allowed.has(origin)) {
      res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' }); return;
    }
    next();
  });
  // Bound memory; shared IPs get a generous read budget, writes have a separate budget.
  const buckets = new Map<string, { count: number; until: number }>();
  router.use((req, res, next) => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const key = `${req.ip}:${req.method === 'GET' ? 'read' : 'write'}`;
    const entry = buckets.get(key) || { count: 0, until: now + 60_000 };
    if (!buckets.has(key) && buckets.size >= 10_000) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }
    buckets.set(key, entry);
    entry.count++;
    if (entry.count > (req.method === 'GET' ? 300 : 60)) {
      res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
      res.status(429).json({ error: 'RATE_LIMITED' }); return;
    }
    next();
  });
  const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await fn(req, res, next); } catch (error) {
      // Never log guest text, tokens, database connection strings or session data.
      res.status(error instanceof PhotoError ? error.status : 500).json({ error: error instanceof PhotoError ? error.code : 'WEDDING_REQUEST_FAILED' });
    }
  };
  if (media) router.use(createMediaRouter(pool, getSession, media));
  router.post('/pilot-login', handle(async (_req, res) => {
    if (env.WEDDING_PILOT_PASSWORDLESS !== 'true' || !env.WEDDING_PILOT_PASSWORD || !loginPilot) {
      res.status(404).json({ error: 'NOT_FOUND' }); return;
    }
    try { localDatabaseUrl(env); } catch { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    const owner = await pool.query('SELECT id FROM users WHERE email=$1', ['wedding-pilot@example.test']);
    if (owner.rowCount !== 1 || !canCreateWedding({ user: { id: owner.rows[0].id } }, env)) {
      res.status(403).json({ error: 'PILOT_ACCESS_REQUIRED' }); return;
    }
    const response = await loginPilot();
    if (!response.ok) { res.status(503).json({ error: 'PILOT_LOGIN_FAILED' }); return; }
    const cookies = response.headers.getSetCookie();
    if (!cookies.length) { res.status(503).json({ error: 'PILOT_LOGIN_FAILED' }); return; }
    res.setHeader('Set-Cookie', cookies);
    res.json({ success: true });
  }));
  router.get('/capabilities', handle(async (req, res) => {
    const session = await getSession(req);
    res.json({ enabled: true, authenticated: !!session, internetPilot: !!allowPilotOwner, shopAvailable:!!shopAvailable, contentReview, canCreate: canCreate(session) });
  }));
  router.get('/books', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    const result = await pool.query(`SELECT ${ownerColumns} FROM event_books WHERE owner_user_id = $1 AND ${productFilter} ORDER BY created_at DESC`, [session.user.id]);
    res.json({ books: result.rows.map(withLink) });
  }));
  router.post('/books', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!canCreate(session)) { res.status(403).json({ error: 'PILOT_ACCESS_REQUIRED' }); return; }
    const names = cleanText(req.body?.names, 160);
    const date = req.body?.date;
    if (!names || !validDate(date)) { res.status(400).json({ error: 'INVALID_BOOK' }); return; }
    const result = await pool.query(`INSERT INTO event_books
      (id, owner_user_id, product, event_type, title, subjects, starts_on, template_id, template_version, invite_token)
      VALUES ($1,$2,'celebration',$7,$3,$4,$5,$8,$9,$6) RETURNING ${ownerColumns}`,
    [randomUUID(), session.user.id, names, JSON.stringify([{ displayName: names, kind: 'group' }]), date, randomBytes(32).toString('base64url'), weddingTemplate.eventType, weddingTemplate.id, weddingTemplate.version]);
    res.status(201).json({ book: withLink(result.rows[0]) });
  }));
  router.get('/books/:id', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!uuid.test(String(req.params.id))) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    const book = await pool.query(`SELECT ${ownerColumns} FROM event_books WHERE id=$1 AND owner_user_id=$2 AND ${productFilter}`, [req.params.id, session.user.id]);
    if (!book.rowCount) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    const submissions = await pool.query('SELECT id, guest_name, message, created_at, occurred_on::text FROM event_submissions WHERE book_id=$1 ORDER BY created_at DESC, id', [req.params.id]);
    let items = submissions.rows;
    if (media) {
      const photos = await pool.query("SELECT id,submission_id,kind,mime_type,duration_seconds FROM event_media WHERE book_id=$1 AND state='attached' ORDER BY created_at", [req.params.id]);
      items = items.map(item => ({ ...item, media: photos.rows.filter(photo => photo.submission_id === item.id).map(photo => ({
        id: photo.id, kind:photo.kind,mimeType:photo.mime_type,durationSeconds:photo.duration_seconds,
        previewUrl:photo.kind==='photo'?'/api/wedding/media/' + photo.id + '/preview':null, displayUrl:photo.kind==='photo'?'/api/wedding/media/' + photo.id + '/display':null,
        playbackUrl:photo.kind!=='photo'?'/api/wedding/media/'+photo.id+'/playback':null, originalUrl: '/api/wedding/media/' + photo.id + '/original'
      })) }));
    }
    res.json({ book: withLink(book.rows[0]), submissions: items });
  }));
  router.post('/books/:id/close', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!uuid.test(String(req.params.id))) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    // UPDATE takes the same row lock as submission; whichever obtains it first wins.
    const result = await pool.query(`UPDATE event_books SET closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP)
      WHERE id=$1 AND owner_user_id=$2 AND ${productFilter} RETURNING ${ownerColumns}`, [req.params.id, session.user.id]);
    if (!result.rowCount) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    res.json({ book: withLink(result.rows[0]) });
  }));
  router.get('/guest/:token', handle(async (req, res) => {
    if (!tokenPattern.test(String(req.params.token))) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    const result = await pool.query(`SELECT id,title, starts_on::text, template_id, template_version, closed_at IS NOT NULL AS closed, package_version,submission_start,submission_end,${accessSql()} AS access_state
      FROM event_books WHERE invite_token=$1 AND ${productFilter}`, [req.params.token]);
    if (!result.rowCount) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    const event=result.rows[0];
    const device=guestDevice(req,res);
    const used={photo:0,video:0,audio:0};
    if(media) {
      const counts=await pool.query(`SELECT m.kind,count(*)::int AS n FROM event_submissions s JOIN event_media m ON m.submission_id=s.id WHERE s.book_id=$1 AND s.guest_device_id=$2 GROUP BY m.kind`,[event.id,device]);
      for(const row of counts.rows) if(Object.hasOwn(used,row.kind))used[row.kind as keyof typeof used]=row.n;
    }
    delete event.id;
    if(!event.package_version) { delete event.package_version;delete event.submission_start;delete event.submission_end;delete event.access_state; }
    res.json({ event, ...(media ? { photo: { maxBytes: media.maxBytes, maxPixels: media.maxPixels },media:{maxDurationSeconds:maxMediaDurationSeconds,limits:{...guestMediaLimits,photo:{...guestMediaLimits.photo,maxBytes:media.maxBytes}},used,remaining:{photo:Math.max(0,10-used.photo),video:Math.max(0,2-used.video),audio:Math.max(0,2-used.audio)},supportedMimeTypes:supportedMediaMimeTypes} } : {}) });
  }));
  router.post('/guest/:token/submissions', handle(async (req, res) => {
    const name = cleanText(req.body?.name, 100);
    const rawMessage=req.body?.message;
    const emptyMediaMessage=typeof rawMessage==='string' && rawMessage.length<=4000 && rawMessage.trim()==='' && !Array.from(rawMessage).some(c=>c.charCodeAt(0)<32 && ![9,10,13].includes(c.charCodeAt(0))) && req.body?.mediaId;
    const message = emptyMediaMessage ? '' : cleanText(rawMessage, 4000);
    const key: unknown = req.body?.idempotencyKey;
    const mediaId: unknown = req.body?.mediaId;
    let annotation: Annotation | null = null;
    if (req.body?.annotation !== undefined) {
      try { annotation = parseAnnotation(req.body.annotation); } catch { res.status(400).json({error:'ANNOTATION_INVALID'}); return; }
      if (!mediaId || !media) { res.status(400).json({error:'ANNOTATION_INVALID'}); return; }
    }
    if (mediaId !== undefined && (!media || typeof mediaId !== 'string' || !uuid.test(mediaId))) { res.status(400).json({ error: 'PHOTO_INVALID' }); return; }
    if (!tokenPattern.test(String(req.params.token))) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    if (!name || message===null || typeof key !== 'string' || !uuid.test(key)) { res.status(400).json({ error: 'INVALID_SUBMISSION' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (annotation?.strokes.length) await client.query('SELECT pg_advisory_xact_lock(61107,2)');
      const book = await client.query(`SELECT id, closed_at,package_version,${accessSql()} AS access_state FROM event_books WHERE invite_token=$1 AND ${productFilter} FOR UPDATE`, [req.params.token]);
      if (!book.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
      const device=guestDevice(req);
      if((book.rows[0].package_version || mediaId) && !device){await client.query('ROLLBACK');res.status(428).json({error:'GUEST_SESSION_REQUIRED'});return;}
      const prior = await client.query('SELECT id, guest_name, message,guest_device_id FROM event_submissions WHERE book_id=$1 AND idempotency_key=$2', [book.rows[0].id, key]);
      if (prior.rowCount) {
        const priorMedia = media ? await client.query('SELECT m.id,a.layer_hash FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE m.submission_id=$1', [prior.rows[0].id]) : { rows: [] };
        await client.query('COMMIT');
        if ((prior.rows[0].guest_device_id && prior.rows[0].guest_device_id!==device) || (priorMedia.rows[0]?.id || undefined) !== mediaId || (priorMedia.rows[0]?.layer_hash || null) !== annotationHash(annotation) || prior.rows[0].guest_name !== name || prior.rows[0].message !== message) {
          res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' }); return;
        }
        // A committed request can be acknowledged even after closure; no new write.
        res.json({ accepted: true, replayed: true }); return;
      }
      if (book.rows[0].closed_at) { await client.query('ROLLBACK'); res.status(410).json({ error: 'SUBMISSIONS_CLOSED' }); return; }
      if(book.rows[0].access_state!=='open'){await client.query('ROLLBACK');res.status(410).json({error:book.rows[0].access_state==='early'?'SUBMISSIONS_EARLY':'SUBMISSIONS_ENDED'});return;}
      if (mediaId) {
        const photo = await client.query("SELECT id,display_bytes,kind,guest_device_id FROM event_media WHERE id=$1 AND book_id=$2 AND upload_key=$3 AND state='uploaded' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE", [mediaId,book.rows[0].id,key]);
        if (!photo.rowCount) { await client.query('ROLLBACK'); res.status(409).json({ error: 'PHOTO_EXPIRED' }); return; }
        if(photo.rows[0].guest_device_id && photo.rows[0].guest_device_id!==device){await client.query('ROLLBACK');res.status(409).json({error:'MEDIA_GUEST_MISMATCH'});return;}
        const kind=photo.rows[0].kind as keyof typeof guestMediaLimits;
        if(annotation && kind!=='photo'){await client.query('ROLLBACK');res.status(400).json({error:'ANNOTATION_INVALID'});return;}
        const used=await client.query('SELECT count(*)::int n FROM event_submissions s JOIN event_media m ON m.submission_id=s.id WHERE s.book_id=$1 AND s.guest_device_id=$2 AND m.kind=$3',[book.rows[0].id,device,kind]);
        if(used.rows[0].n>=guestMediaLimits[kind].maxCount){await client.query('ROLLBACK');res.status(413).json({error:'MEDIA_GUEST_LIMIT',kind,limit:guestMediaLimits[kind].maxCount});return;}
        if (annotation?.strokes.length && media) await attachAnnotation(client, mediaId as string, book.rows[0].id, photo.rows[0].display_bytes, annotation, media);
      }
      const submissionId = randomUUID();
      await client.query(`INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id)
        VALUES ($1,$2,$3,$4,$5,$6)`, [submissionId, book.rows[0].id, key, name, message,device]);
      if (mediaId) await client.query("UPDATE event_media SET submission_id=$1,state='attached',expires_at=NULL WHERE id=$2", [submissionId,mediaId]);
      await client.query('COMMIT');
      res.status(201).json({ accepted: true, replayed: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }));
  router.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  const invalidBody: ErrorRequestHandler = (error: { status?: number }, _req, res, _next) => {
    void _next;
    res.status(error.status === 413 ? 413 : 400).json({ error: 'INVALID_SUBMISSION' });
  };
  router.use(invalidBody);
  return router;
}
