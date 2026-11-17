import { Router, raw } from 'express';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import type { WeddingOptions } from './router';
import { accessSql, guestDevice } from './access-window';
import { PhotoError } from './media-error';
import { decodeAv } from './av-decoder';
import { guestMediaLimits } from '../../shared/media-limits';
import type { MediaKind } from '../../shared/media-limits';
import { sendMediaBytes } from './media-response';
export { PhotoError } from './media-error';

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
let decoding = 0;
export async function decodePhoto(bytes: Buffer, limits: MediaLimits) {
  if (!bytes.length || bytes.length > limits.maxBytes) throw new PhotoError('PHOTO_TOO_LARGE',413);
  const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!jpeg && !png) throw new PhotoError('PHOTO_TYPE',415);
  if(jpeg && (bytes.at(-2)!==255 || bytes.at(-1)!==217))throw new PhotoError('PHOTO_INVALID');
  if(png){
    let offset=8,ended=false;
    while(offset<bytes.length){
      if(offset+12>bytes.length)throw new PhotoError('PHOTO_INVALID');
      const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      offset+=size+12;if(offset>bytes.length)throw new PhotoError('PHOTO_INVALID');
      if(type==='IEND'){if(size!==0 || offset!==bytes.length)throw new PhotoError('PHOTO_INVALID');ended=true;break;}
    }
    if(!ended)throw new PhotoError('PHOTO_INVALID');
  }
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
  const uploadKind=(req:Parameters<RequestHandler>[0]):MediaKind=> {
    const value=req.get('x-media-kind') || 'photo';
    if(!['photo','video','audio'].includes(value))throw new PhotoError('MEDIA_TYPE',415);
    return value as MediaKind;
  };
  const uploadResult=(row:Record<string,unknown>,replayed:boolean)=>({mediaId:row.id,replayed,kind:row.kind,mimeType:row.mime_type,durationSeconds:row.duration_seconds ?? null});
  const wrap=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(error){
    res.status(error instanceof PhotoError?error.status:503).json({error:error instanceof PhotoError?error.code:'PHOTO_RETRY'});
  }};
  // Recover a lost upload response after reload. Never creates an identity, exposes
  // a different guest's upload or consumes quota. Closure does not erase an upload.
  router.get('/guest/:token/media/:key',wrap(async(req,res)=>{
    const device=guestDevice(req);
    if(!device || !token.test(String(req.params.token)) || !uuid.test(String(req.params.key))){res.status(404).json({error:'MEDIA_NOT_FOUND'});return;}
    const found=await pool.query(`SELECT m.id,m.kind,m.mime_type,m.duration_seconds,m.state FROM event_media m JOIN event_books b ON b.id=m.book_id
      WHERE b.invite_token=$1 AND m.upload_key=$2 AND m.guest_device_id=$3 AND ${filter}
      AND (m.state='attached' OR (m.state='uploaded' AND m.expires_at>CURRENT_TIMESTAMP))`,[req.params.token,req.params.key,device]);
    if(!found.rowCount){res.status(404).json({error:'MEDIA_NOT_FOUND'});return;}
    const row=found.rows[0];
    res.json({mediaId:row.id,kind:row.kind,mimeType:row.mime_type,durationSeconds:row.duration_seconds,state:row.state});
  }));
  router.post('/guest/:token/media/:key',wrap(async(req,res,next)=>{
    if(!token.test(String(req.params.token)) || !uuid.test(String(req.params.key))){res.status(404).json({error:'INVITE_NOT_FOUND'});return;}
    const kind=uploadKind(req);
    if(!guestDevice(req))throw new PhotoError('GUEST_SESSION_REQUIRED',428);
    const length=Number(req.get('content-length'));
    if(length>(kind==='photo'?limits.maxBytes:guestMediaLimits[kind].maxBytes))throw new PhotoError(kind==='photo'?'PHOTO_TOO_LARGE':'MEDIA_TOO_LARGE',413);
    if(active>=2){res.setHeader('Retry-After','5');res.status(429).json({error:'RATE_LIMITED'});return;}
    active++;let released=false;const release=()=>{if(!released){released=true;active--;}};
    res.once('finish',release);res.once('close',release);
    const book=await pool.query(`SELECT id FROM event_books WHERE invite_token=$1 AND ${filter}`,[req.params.token]);
    if(!book.rowCount){res.status(404).json({error:'INVITE_NOT_FOUND'});return;}
    next();
  }),raw({type:'application/octet-stream',limit:guestMediaLimits.video.maxBytes}),wrap(async(req,res)=>{
    const kind=uploadKind(req),device=guestDevice(req)!;
    if(!Buffer.isBuffer(req.body))throw new PhotoError(kind==='photo'?'PHOTO_TYPE':'MEDIA_TYPE',415);
    const bytes=req.body as Buffer;
    const hash=createHash('sha256').update(bytes).digest('hex');
    // A completed upload can be reused without decoding/storing another copy.
    const prior=await pool.query(`SELECT m.id,m.sha256,m.kind,m.mime_type,m.duration_seconds,m.guest_device_id FROM event_media m JOIN event_books b ON b.id=m.book_id
      WHERE b.invite_token=$1 AND m.upload_key=$2 AND (m.state='attached' OR m.expires_at>CURRENT_TIMESTAMP)`,[req.params.token,req.params.key]);
    if(prior.rowCount){if(prior.rows[0].sha256!==hash || prior.rows[0].kind!==kind || (prior.rows[0].guest_device_id && prior.rows[0].guest_device_id!==device))throw new PhotoError('IDEMPOTENCY_CONFLICT',409);res.json(uploadResult(prior.rows[0],true));return;}
    const photo=kind==='photo'?{...await decodePhoto(bytes,limits),durationSeconds:null}:await decodeAv(bytes,kind);
    const storedSize=bytes.length+photo.preview.length+photo.display.length;
    await cleanupMedia(pool);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(61107,2)');
      const book=await client.query(`SELECT id,closed_at,${accessSql()} AS access_state FROM event_books WHERE invite_token=$1 AND ${filter} FOR UPDATE`,[req.params.token]);
      if(!book.rowCount)throw new PhotoError('INVITE_NOT_FOUND',404);
      const existing=await client.query('SELECT id,sha256,kind,mime_type,duration_seconds,guest_device_id FROM event_media WHERE book_id=$1 AND upload_key=$2',[book.rows[0].id,req.params.key]);
      if(existing.rowCount){
        if(existing.rows[0].sha256!==hash || existing.rows[0].kind!==kind || (existing.rows[0].guest_device_id && existing.rows[0].guest_device_id!==device))throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
        await client.query('COMMIT');res.json(uploadResult(existing.rows[0],true));return;
      }
      if(book.rows[0].closed_at)throw new PhotoError('SUBMISSIONS_CLOSED',410);
      if(book.rows[0].access_state!=='open')throw new PhotoError(book.rows[0].access_state==='early'?'SUBMISSIONS_EARLY':'SUBMISSIONS_ENDED',410);
      const quota=await client.query(`SELECT COALESCE(sum(stored_size),0)::bigint AS total,
        COALESCE(sum(stored_size) FILTER (WHERE book_id=$1),0)::bigint AS book,
        count(*) FILTER (WHERE book_id=$1)::int AS book_count,count(*)::int AS total_count FROM event_media`,[book.rows[0].id]);
      const q=quota.rows[0];
      const annotations=(await client.query(`SELECT COALESCE(sum(a.stored_size),0)::bigint AS total,COALESCE(sum(a.stored_size) FILTER(WHERE m.book_id=$1),0)::bigint AS book FROM event_media_annotations a JOIN event_media m ON m.id=a.media_id`,[book.rows[0].id])).rows[0];
      q.total=Number(q.total)+Number(annotations.total);q.book=Number(q.book)+Number(annotations.book);
      const size=await client.query('SELECT pg_database_size(current_database()) AS size');
      if(Number(q.total)+storedSize>limits.totalBytes || Number(q.book)+storedSize>limits.bookBytes || q.book_count>=100 || q.total_count>=1000 || Number(size.rows[0].size)>700*1024*1024)throw new PhotoError('PHOTO_QUOTA',413);
      const id=randomUUID();
      await client.query(`INSERT INTO event_media(id,book_id,upload_key,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size,expires_at,kind,duration_seconds,guest_device_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploaded',$9,$10,$11,$12,CURRENT_TIMESTAMP + $13*interval '1 second',$14,$15,$16)`,
        [id,book.rows[0].id,req.params.key,photo.mime,bytes.length,hash,photo.width,photo.height,bytes,photo.preview,photo.display,storedSize,limits.ttlSeconds,kind,photo.durationSeconds,device]);
      await client.query('COMMIT');res.status(201).json(uploadResult({id,kind,mime_type:photo.mime,duration_seconds:photo.durationSeconds},false));
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  router.get('/media/:id/:variant',wrap(async(req,res)=>{
    const session=await getSession(req);
    if(!session){res.status(401).json({error:'UNAUTHENTICATED'});return;}
    const variant=String(req.params.variant);
    if(!uuid.test(String(req.params.id))||!['original','playback','preview','display','annotation'].includes(variant)){res.sendStatus(404);return;}
    const column={original:'m.original_bytes',playback:'m.original_bytes',preview:'COALESCE(a.preview_bytes,m.preview_bytes)',display:'COALESCE(a.display_bytes,m.display_bytes)',annotation:'a.layer'}[variant]!;
    const result=await pool.query(`SELECT ${column} AS bytes,m.mime_type,m.kind FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id
      JOIN event_books b ON b.id=m.book_id JOIN event_submissions s ON s.id=m.submission_id AND s.book_id=m.book_id
      WHERE m.id=$1 AND b.owner_user_id=$2 AND m.state='attached'`,[req.params.id,session.user.id]);
    if(!result.rowCount){res.sendStatus(404);return;}
    const row=result.rows[0];
    if((row.kind!=='photo' && ['preview','display','annotation'].includes(variant)) || (row.kind==='photo' && variant==='playback')){res.sendStatus(404);return;}
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    if(variant==='annotation'){if(!result.rows[0].bytes){res.sendStatus(404);return;}res.json(result.rows[0].bytes);return;}
    const extension:Record<string,string>={'image/png':'png','image/jpeg':'jpg','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','audio/mp4':'m4a','audio/webm':'webm','audio/ogg':'ogg','audio/wav':'wav'};
    sendMediaBytes(req,res,{bytes:row.bytes,mimeType:['original','playback'].includes(variant)?row.mime_type:'image/jpeg',filename:variant==='original'?`${row.kind}.${extension[row.mime_type]}`:undefined,attachment:variant==='original',range:row.kind!=='photo'});
  }));
  const failed:ErrorRequestHandler=(err,req,res,next)=>{void next;res.status(err.status===413?413:400).json({error:err.status===413?(req.get('x-media-kind') && req.get('x-media-kind')!=='photo'?'MEDIA_TOO_LARGE':'PHOTO_TOO_LARGE'):'PHOTO_RETRY'});};
  router.use(failed);
  return router;
}
