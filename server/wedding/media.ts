import { Router, raw } from 'express';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import type { WeddingOptions } from './router';

sharp.concurrency(1);
sharp.cache(false);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
const filter = "product='celebration' AND event_type='wedding' AND template_id='wedding-classic' AND template_version=1";
export function mediaLimits(env: NodeJS.ProcessEnv = process.env) {
  function bounded(key: string, fallback: number, ceiling: number) {
    const n = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) throw new Error(`Invalid ${key}`);
    return n;
  }
  return {
    maxBytes: bounded('PILOT_PHOTO_MAX_BYTES', 6*1024*1024, 10*1024*1024),
    maxPixels: bounded('PILOT_PHOTO_MAX_PIXELS', 24_000_000, 30_000_000),
    bookBytes: bounded('PILOT_PHOTO_BOOK_BYTES', 50*1024*1024, 100*1024*1024),
    totalBytes: bounded('PILOT_PHOTO_TOTAL_BYTES', 200*1024*1024, 200*1024*1024),
    ttlSeconds: bounded('PILOT_PHOTO_TTL_SECONDS', 3600, 86400),
  };
}
export type MediaLimits = ReturnType<typeof mediaLimits>;
export class PhotoError extends Error { constructor(public code: string, public status = 400) { super(code); } }
let decoding = 0;
export async function decodePhoto(bytes: Buffer, limits: MediaLimits) {
  if (!bytes.length || bytes.length > limits.maxBytes) throw new PhotoError('PHOTO_TOO_LARGE',413);
  const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!jpeg && !png) throw new PhotoError('PHOTO_TYPE',415);
  if (decoding >= 2) throw new PhotoError('RATE_LIMITED',429);
  decoding++;
  try {
    const image = sharp(bytes,{limitInputPixels:limits.maxPixels,failOn:'warning'});
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages || 1)!==1 || !['jpeg','png'].includes(meta.format || '')) throw new PhotoError('PHOTO_INVALID');
    if(meta.width*meta.height>limits.maxPixels) throw new PhotoError('PHOTO_PIXELS',413);
    // Full decoder validation, orientation and metadata stripping for safe display.
    const display = await image.autoOrient().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:82}).timeout({seconds:15}).toBuffer();
    const preview = await sharp(display).resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer();
    return {mime:jpeg?'image/jpeg':'image/png',width:meta.width,height:meta.height,display,preview};
  } catch(error) {
    if(error instanceof PhotoError) throw error;
    if(error instanceof Error && /pixel limit/i.test(error.message)) throw new PhotoError('PHOTO_PIXELS',413);
    throw new PhotoError('PHOTO_INVALID');
  } finally { decoding--; }
}
export async function cleanupMedia(pool: Pool) {
  // Never deletes attached media. Active attachment and cleanup serialize on row locks.
  await pool.query("DELETE FROM event_media WHERE submission_id IS NULL AND state='uploaded' AND expires_at<CURRENT_TIMESTAMP");
}
export function createMediaRouter(pool: Pool, getSession: WeddingOptions['getSession'], limits: MediaLimits) {
  const router=Router();let active=0;
  const wrap=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(error){
    res.status(error instanceof PhotoError?error.status:503).json({error:error instanceof PhotoError?error.code:'PHOTO_RETRY'});
  }};
  router.post('/guest/:token/media/:key',wrap(async(req,res,next)=>{
    if(!token.test(String(req.params.token)) || !uuid.test(String(req.params.key))){res.status(404).json({error:'INVITE_NOT_FOUND'});return;}
    if(active>=2){res.setHeader('Retry-After','5');res.status(429).json({error:'RATE_LIMITED'});return;}
    active++;let released=false;const release=()=>{if(!released){released=true;active--;}};
    res.once('finish',release);res.once('close',release);
    const book=await pool.query(`SELECT id FROM event_books WHERE invite_token=$1 AND ${filter}`,[req.params.token]);
    if(!book.rowCount){res.status(404).json({error:'INVITE_NOT_FOUND'});return;}
    next();
  }),raw({type:'application/octet-stream',limit:limits.maxBytes}),wrap(async(req,res)=>{
    if(!Buffer.isBuffer(req.body))throw new PhotoError('PHOTO_TYPE',415);
    const bytes=req.body as Buffer;
    const hash=createHash('sha256').update(bytes).digest('hex');
    // A completed upload can be reused without decoding/storing another copy.
    const prior=await pool.query(`SELECT m.id,m.sha256 FROM event_media m JOIN event_books b ON b.id=m.book_id
      WHERE b.invite_token=$1 AND m.upload_key=$2 AND (m.state='attached' OR m.expires_at>CURRENT_TIMESTAMP)`,[req.params.token,req.params.key]);
    if(prior.rowCount){if(prior.rows[0].sha256!==hash)throw new PhotoError('IDEMPOTENCY_CONFLICT',409);res.json({mediaId:prior.rows[0].id,replayed:true});return;}
    const photo=await decodePhoto(bytes,limits);
    const storedSize=bytes.length+photo.preview.length+photo.display.length;
    await cleanupMedia(pool);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(61107,2)');
      const book=await client.query(`SELECT id,closed_at FROM event_books WHERE invite_token=$1 AND ${filter} FOR UPDATE`,[req.params.token]);
      if(!book.rowCount)throw new PhotoError('INVITE_NOT_FOUND',404);
      const existing=await client.query('SELECT id,sha256 FROM event_media WHERE book_id=$1 AND upload_key=$2',[book.rows[0].id,req.params.key]);
      if(existing.rowCount){
        if(existing.rows[0].sha256!==hash)throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
        await client.query('COMMIT');res.json({mediaId:existing.rows[0].id,replayed:true});return;
      }
      if(book.rows[0].closed_at)throw new PhotoError('SUBMISSIONS_CLOSED',410);
      const quota=await client.query(`SELECT COALESCE(sum(stored_size),0)::bigint AS total,
        COALESCE(sum(stored_size) FILTER (WHERE book_id=$1),0)::bigint AS book,
        count(*) FILTER (WHERE book_id=$1)::int AS book_count,count(*)::int AS total_count FROM event_media`,[book.rows[0].id]);
      const q=quota.rows[0];
      const annotations=(await client.query(`SELECT COALESCE(sum(a.stored_size),0)::bigint AS total,COALESCE(sum(a.stored_size) FILTER(WHERE m.book_id=$1),0)::bigint AS book FROM event_media_annotations a JOIN event_media m ON m.id=a.media_id`,[book.rows[0].id])).rows[0];
      q.total=Number(q.total)+Number(annotations.total);q.book=Number(q.book)+Number(annotations.book);
      const size=await client.query('SELECT pg_database_size(current_database()) AS size');
      if(Number(q.total)+storedSize>limits.totalBytes || Number(q.book)+storedSize>limits.bookBytes || q.book_count>=100 || q.total_count>=1000 || Number(size.rows[0].size)>700*1024*1024)throw new PhotoError('PHOTO_QUOTA',413);
      const id=randomUUID();
      await client.query(`INSERT INTO event_media(id,book_id,upload_key,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploaded',$9,$10,$11,$12,CURRENT_TIMESTAMP + $13*interval '1 second')`,
        [id,book.rows[0].id,req.params.key,photo.mime,bytes.length,hash,photo.width,photo.height,bytes,photo.preview,photo.display,storedSize,limits.ttlSeconds]);
      await client.query('COMMIT');res.status(201).json({mediaId:id,replayed:false});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  router.get('/media/:id/:variant',wrap(async(req,res)=>{
    const session=await getSession(req);
    if(!session){res.status(401).json({error:'UNAUTHENTICATED'});return;}
    const variant=String(req.params.variant);
    if(!uuid.test(String(req.params.id))||!['original','preview','display','annotation'].includes(variant)){res.sendStatus(404);return;}
    const column={original:'m.original_bytes',preview:'COALESCE(a.preview_bytes,m.preview_bytes)',display:'COALESCE(a.display_bytes,m.display_bytes)',annotation:'a.layer'}[variant]!;
    const result=await pool.query(`SELECT ${column} AS bytes,m.mime_type FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id
      JOIN event_books b ON b.id=m.book_id JOIN event_submissions s ON s.id=m.submission_id AND s.book_id=m.book_id
      WHERE m.id=$1 AND b.owner_user_id=$2 AND m.state='attached'`,[req.params.id,session.user.id]);
    if(!result.rowCount){res.sendStatus(404);return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    if(variant==='annotation'){if(!result.rows[0].bytes){res.sendStatus(404);return;}res.json(result.rows[0].bytes);return;}
    if(variant==='original')res.setHeader('Content-Disposition',`attachment; filename="photo.${result.rows[0].mime_type==='image/png'?'png':'jpg'}"`);
    res.type(variant==='original'?result.rows[0].mime_type:'image/jpeg').send(result.rows[0].bytes);
  }));
  const failed:ErrorRequestHandler=(err,req,res,next)=>{void req;void next;res.status(err.status===413?413:400).json({error:err.status===413?'PHOTO_TOO_LARGE':'PHOTO_RETRY'});};
  router.use(failed);
  return router;
}
