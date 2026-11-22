import { Router, json } from 'express';
import type { Request, RequestHandler, ErrorRequestHandler } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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
    res.json({ enabled: true, authenticated: !!session, internetPilot: !!allowPilotOwner, shopAvailable:!!shopAvailable, contentReview, mediaAttempts:!!media, canCreate: canCreate(session) });
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
    let client:PoolClient|undefined;
    let limitDetails:{kind?:string;limit?:number}={};
    const key:unknown=req.body?.idempotencyKey,mediaId:unknown=req.body?.mediaId,device=guestDevice(req);
    try{
      const name=cleanText(req.body?.name,100),rawMessage=req.body?.message;
      const emptyMediaMessage=typeof rawMessage==='string' && rawMessage.length<=4000 && rawMessage.trim()==='' && !Array.from(rawMessage).some(c=>c.charCodeAt(0)<32 && ![9,10,13].includes(c.charCodeAt(0))) && mediaId;
      const message=emptyMediaMessage?'':cleanText(rawMessage,4000);
      let annotation:Annotation|null=null;
      if(req.body?.annotation!==undefined){
        try{annotation=parseAnnotation(req.body.annotation);}catch{throw new PhotoError('ANNOTATION_INVALID',400);}
        if(!mediaId||!media)throw new PhotoError('ANNOTATION_INVALID',400);
      }
      if(mediaId!==undefined&&(!media||typeof mediaId!=='string'||!uuid.test(mediaId)))throw new PhotoError('PHOTO_INVALID',400);
      if(!tokenPattern.test(String(req.params.token)))throw new PhotoError('INVITE_NOT_FOUND',404);
      if(!name||message===null||typeof key!=='string'||!uuid.test(key))throw new PhotoError('INVALID_SUBMISSION',400);
      client=await pool.connect();await client.query('BEGIN');
      if(mediaId)await client.query('SELECT pg_advisory_xact_lock(61107,2)');
      const book=(await client.query(`SELECT id,closed_at,package_version,${accessSql()} AS access_state FROM event_books WHERE invite_token=$1 AND ${productFilter} FOR UPDATE`,[req.params.token])).rows[0];
      if(!book)throw new PhotoError('INVITE_NOT_FOUND',404);
      if((book.package_version||mediaId)&&!device)throw new PhotoError('GUEST_SESSION_REQUIRED',428);
      const prior=(await client.query('SELECT id,guest_name,message,guest_device_id FROM event_submissions WHERE book_id=$1 AND idempotency_key=$2',[book.id,key])).rows[0];
      if(prior){
        const priorMedia=media?(await client.query('SELECT m.id,a.layer_hash FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE m.submission_id=$1',[prior.id])).rows[0]:undefined;
        if((prior.guest_device_id&&prior.guest_device_id!==device)||(priorMedia?.id||undefined)!==mediaId||(priorMedia?.layer_hash||null)!==annotationHash(annotation)||prior.guest_name!==name||prior.message!==message)throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
        await client.query('COMMIT');res.json({accepted:true,state:'committed',replayed:true,submissionId:prior.id,mediaId:priorMedia?.id??null});return;
      }
      if(book.closed_at)throw new PhotoError('SUBMISSIONS_CLOSED',410);
      if(book.access_state!=='open')throw new PhotoError(book.access_state==='early'?'SUBMISSIONS_EARLY':'SUBMISSIONS_ENDED',410);
      if(mediaId){
        const photo=(await client.query("SELECT id,display_bytes,kind,guest_device_id FROM event_media WHERE id=$1 AND book_id=$2 AND upload_key=$3 AND state='uploaded' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE",[mediaId,book.id,key])).rows[0];
        if(!photo)throw new PhotoError('PHOTO_EXPIRED',409);
        if(photo.guest_device_id&&photo.guest_device_id!==device)throw new PhotoError('MEDIA_GUEST_MISMATCH',409);
        const kind=photo.kind as keyof typeof guestMediaLimits;
        if(annotation&&kind!=='photo')throw new PhotoError('ANNOTATION_INVALID',400);
        const used=(await client.query('SELECT count(*)::int n FROM event_submissions s JOIN event_media m ON m.submission_id=s.id WHERE s.book_id=$1 AND s.guest_device_id=$2 AND m.kind=$3',[book.id,device,kind])).rows[0];
        if(used.n>=guestMediaLimits[kind].maxCount){limitDetails={kind,limit:guestMediaLimits[kind].maxCount};throw new PhotoError('MEDIA_GUEST_LIMIT',413);}
        if(annotation?.strokes.length&&media)await attachAnnotation(client,mediaId as string,book.id,photo.display_bytes,annotation,media);
      }
      const submissionId=randomUUID();
      await client.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[submissionId,book.id,key,name,message,device]);
      if(mediaId){
        await client.query("UPDATE event_media SET submission_id=$1,state='attached',expires_at=NULL WHERE id=$2",[submissionId,mediaId]);
        await client.query("UPDATE event_media_attempts SET media_id=$3,state='attached',stage='complete',error_code=NULL,error_status=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE book_id=$1 AND upload_key=$2 AND guest_device_id=$4",[book.id,key,mediaId,device]);
      }
      await client.query('COMMIT');res.status(201).json({accepted:true,state:'committed',replayed:false,submissionId,mediaId:mediaId??null});
    }catch(error){
      if(client)await client.query('ROLLBACK').catch(()=>undefined);
      const errorCode=error instanceof PhotoError?error.code:'WEDDING_REQUEST_FAILED',status=error instanceof PhotoError?error.status:503;
      let diagnosticId=randomUUID();
      // Bind diagnostics to the same guest/key. A rejected replay never changes a committed attempt.
      if(media&&device&&typeof key==='string'&&uuid.test(key)&&tokenPattern.test(String(req.params.token))){
        const result=await (client||pool).query(`UPDATE event_media_attempts a SET state='failed',stage='submission',error_code=$4,error_status=$5,updated_at=CURRENT_TIMESTAMP
          FROM event_books b WHERE a.book_id=b.id AND b.invite_token=$1 AND a.upload_key=$2 AND a.guest_device_id=$3 AND a.state<>'attached' AND a.lease_token IS NULL RETURNING a.diagnostic_id`,[req.params.token,key,device,errorCode,status]).catch(()=>null);
        if(result?.rows[0])diagnosticId=result.rows[0].diagnostic_id;
      }
      console.warn(JSON.stringify({event:'media.failure',diagnosticId,stage:'submission',errorCode,status}));
      res.status(status).json({error:errorCode,diagnosticId,stage:'commit',...limitDetails});
    }finally{client?.release();}
  }));
  router.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  const invalidBody: ErrorRequestHandler = (error: { status?: number }, _req, res, _next) => {
    void _next;
    res.status(error.status === 413 ? 413 : 400).json({ error: 'INVALID_SUBMISSION' });
  };
  router.use(invalidBody);
  return router;
}
