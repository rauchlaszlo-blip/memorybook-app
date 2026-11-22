import { Router, raw } from 'express';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import type { WeddingOptions } from './router';
import { guestDevice } from './access-window';
import { PhotoError } from './media-error';
import { decodeAv } from './av-decoder';
import { photoEnvelope } from './photo-envelope';
import { guestMediaLimits } from '../../shared/media-limits';
import type { MediaKind } from '../../shared/media-limits';
import { sendMediaBytes } from './media-response';
import { createMediaAttemptService, mediaAttemptFailure } from './media-attempts';
import type { MediaAttemptLease } from './media-attempts';
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
    const imageBytes=jpeg?await photoEnvelope(bytes):bytes;
    const image = sharp(imageBytes,{limitInputPixels:limits.maxPixels,failOn:'warning'});
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
// Expiry gates attachment, never retention. Owner retry can renew an orphan upload.
export async function cleanupMedia(_pool: Pool) { void _pool; }
export function createMediaRouter(pool: Pool, getSession: WeddingOptions['getSession'], limits: MediaLimits) {
  const router=Router();let active=0;
  const attempts=createMediaAttemptService(pool,limits,async(bytes,kind)=>kind==='photo'?{...await decodePhoto(bytes,limits),durationSeconds:null}:decodeAv(bytes,kind));
  const uploadKind=(req:Parameters<RequestHandler>[0]):MediaKind=> {
    const value=req.get('x-media-kind') || 'photo';
    if(!['photo','video','audio'].includes(value))throw new PhotoError('MEDIA_TYPE',415);
    return value as MediaKind;
  };
  const failure=async(res:Parameters<RequestHandler>[1],error:unknown,stage='validation')=>{
    const attempt=res.locals.mediaAttempt as MediaAttemptLease|undefined;
    stage=mediaAttemptFailure(error)?.stage||res.locals.mediaStage||stage;
    if(attempt)await attempts.failed(attempt,error,stage).catch(()=>undefined);
    const diagnosticId=mediaAttemptFailure(error)?.diagnosticId||attempt?.diagnosticId||randomUUID();
    const errorCode=error instanceof PhotoError?error.code:'MEDIA_RETRY_REQUIRED';
    const status=error instanceof PhotoError?error.status:503;
    console.warn(JSON.stringify({event:'media.failure',diagnosticId,stage,errorCode,status,...(attempt?{bookId:attempt.bookId,kind:attempt.kind}:{})}));
    if(!res.headersSent&&!res.destroyed)res.status(status).json({error:errorCode,diagnosticId,stage:'upload'});
  };
  const wrap=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(error){await failure(res,error);}};
  router.get('/guest/:token/media/:key',wrap(async(req,res)=>{
    const device=guestDevice(req);
    if(!device || !token.test(String(req.params.token)) || !uuid.test(String(req.params.key))){res.status(404).json({error:'MEDIA_NOT_FOUND'});return;}
    const book=(await pool.query(`SELECT id FROM event_books WHERE invite_token=$1 AND ${filter}`,[req.params.token])).rows[0];
    const result=book?await attempts.recovery(book.id,String(req.params.key),device):null;
    if(!result){res.status(404).json({error:'MEDIA_NOT_FOUND'});return;}
    res.json(result);
  }));
  const ownerBook=async(req:Parameters<RequestHandler>[0])=>{
    const session=await getSession(req);if(!session)throw new PhotoError('UNAUTHENTICATED',401);
    if(!uuid.test(String(req.params.bookId)))throw new PhotoError('BOOK_NOT_FOUND',404);
    const found=await pool.query(`SELECT id FROM event_books WHERE id=$1 AND owner_user_id=$2 AND ${filter}`,[req.params.bookId,session.user.id]);
    if(!found.rowCount)throw new PhotoError('BOOK_NOT_FOUND',404);return {id:String(req.params.bookId),ownerId:session.user.id};
  };
  router.get('/books/:bookId/media-attempts',wrap(async(req,res)=>{res.json(await attempts.list((await ownerBook(req)).id));}));
  router.post('/books/:bookId/media-attempts/:attemptId/retry',wrap(async(req,res)=>{
    const book=await ownerBook(req);if(!uuid.test(String(req.params.attemptId)))throw new PhotoError('MEDIA_NOT_FOUND',404);
    if(req.body&&Object.keys(req.body).length)throw new PhotoError('INVALID_REQUEST',400);
    if(active>=2)throw new PhotoError('MEDIA_BUSY',429);
    active++;try{res.json(await attempts.retry(book.id,String(req.params.attemptId),book.ownerId));}finally{active--;}
  }));
  router.post('/guest/:token/media/:key',wrap(async(req,res,next)=>{
    res.locals.mediaStage='receiving';
    if(!token.test(String(req.params.token)) || !uuid.test(String(req.params.key))){res.status(404).json({error:'INVITE_NOT_FOUND'});return;}
    const kind=uploadKind(req),device=guestDevice(req);
    if(!device)throw new PhotoError('GUEST_SESSION_REQUIRED',428);
    if(active>=2){res.setHeader('Retry-After','5');throw new PhotoError('RATE_LIMITED',429);}
    active++;let released=false;const release=()=>{if(!released){released=true;active--;}};
    res.once('finish',release);res.once('close',release);
    const book=(await pool.query(`SELECT id FROM event_books WHERE invite_token=$1 AND ${filter}`,[req.params.token])).rows[0];
    if(!book)throw new PhotoError('INVITE_NOT_FOUND',404);
    const attempt=await attempts.begin(book.id,String(req.params.key),device,kind,{source:req.get('x-media-source'),mime:req.get('x-media-mime')});
    res.locals.mediaAttempt=attempt;
    req.once('aborted',()=>{void attempts.failed(attempt,new PhotoError('UPLOAD_INTERRUPTED',400),'receiving').catch(()=>undefined);});
    if(req.aborted)throw new PhotoError('UPLOAD_INTERRUPTED',400);
    const length=Number(req.get('content-length'));
    if(length>(kind==='photo'?limits.maxBytes:guestMediaLimits[kind].maxBytes))throw new PhotoError(kind==='photo'?'PHOTO_TOO_LARGE':'MEDIA_TOO_LARGE',413);
    next();
  }),raw({type:'application/octet-stream',limit:guestMediaLimits.video.maxBytes}),wrap(async(req,res)=>{
    res.locals.mediaStage='validation';
    const attempt=res.locals.mediaAttempt as MediaAttemptLease;
    if(!Buffer.isBuffer(req.body))throw new PhotoError(attempt.kind==='photo'?'PHOTO_TYPE':'MEDIA_TYPE',415);
    if(!req.body.length||req.body.length>(attempt.kind==='photo'?limits.maxBytes:guestMediaLimits[attempt.kind].maxBytes))throw new PhotoError(attempt.kind==='photo'?'PHOTO_TOO_LARGE':'MEDIA_TOO_LARGE',413);
    const result=await attempts.process(attempt,req.body);
    res.status(result.replayed?200:201).json(result);
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
  const failed:ErrorRequestHandler=(err,req,res,next)=>{void next;void failure(res,new PhotoError(err.status===413?(req.get('x-media-kind') && req.get('x-media-kind')!=='photo'?'MEDIA_TOO_LARGE':'PHOTO_TOO_LARGE'):'UPLOAD_INTERRUPTED',err.status===413?413:400),'receiving');};
  router.use(failed);
  return router;
}
