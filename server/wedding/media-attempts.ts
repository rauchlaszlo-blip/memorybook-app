import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient,QueryResultRow} from 'pg';
import type {MediaKind} from '../../shared/media-limits';
import type {MediaLimits} from './media';
import {PhotoError} from './media-error';
import {accessSql} from './access-window';

type Row=QueryResultRow; // Public responses are explicitly projected below.
type Decoded={mime:string;width:number;height:number;durationSeconds:number|null;preview:Buffer;display:Buffer};
export type MediaAttemptLease={id:string;bookId:string;key:string;device:string|null;kind:MediaKind;lease:string;diagnosticId:string;ownerId?:string};
const leaseMs=120_000,sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const code=(error:unknown)=>error instanceof PhotoError?error.code:'MEDIA_RETRY_REQUIRED';
const status=(error:unknown)=>error instanceof PhotoError?error.status:503;
const failureContexts=new WeakMap<object,{diagnosticId:string;stage:string}>();
export function mediaAttemptFailure(error:unknown){return typeof error==='object'&&error!==null?failureContexts.get(error):undefined;}
const diagnosticMimes=new Set(['image/jpeg','image/png','image/heic','image/heif','image/avif','image/webp','video/mp4','video/webm','video/quicktime','audio/mp4','audio/webm','audio/ogg','audio/wav','audio/mpeg','application/octet-stream']);
const mediaMetadata='id,sha256,kind,mime_type,duration_seconds,guest_device_id,state,expires_at,submission_id';
const metadataColumns=`a.id,a.book_id,a.upload_key,a.guest_device_id,a.kind,a.state,a.stage,a.sha256,a.byte_length,a.media_id,a.error_code,a.error_status,a.diagnostic_id,a.lease_token,a.lease_until,a.created_at,a.updated_at,a.source_hint,a.mime_hint,a.pending_bytes IS NOT NULL AS has_bytes,m.expires_at`;
export function uploadAck(row:Row,replayed:boolean){return{mediaId:row.id,kind:row.kind,mimeType:row.mime_type,durationSeconds:row.duration_seconds??null,replayed,state:row.state,expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,submissionId:row.submission_id??null};}
function summary(row:Row){
  const interrupted=['receiving','processing'].includes(row.state)&&(!row.lease_until||new Date(row.lease_until).getTime()<=Date.now());
  const expired=row.state==='uploaded'&&row.expires_at&&new Date(row.expires_at).getTime()<=Date.now();
  const state=interrupted||expired?'failed':row.state;
  return{id:row.id,kind:row.kind,state,stage:row.stage,errorCode:interrupted?(row.has_bytes?'MEDIA_RETRY_REQUIRED':'UPLOAD_INTERRUPTED'):expired?'PHOTO_EXPIRED':row.error_code??null,
    diagnosticId:row.diagnostic_id,byteLength:Number(row.byte_length),createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString(),mediaId:row.media_id??null,
    source:row.source_hint||'unknown',mimeType:row.mime_hint??null,
    retryAvailable:state!=='attached'&&!['receiving','processing'].includes(state)&&!!(row.has_bytes||row.media_id),requiresGuestSubmission:state!=='attached'};
}
export function createMediaAttemptService(pool:Pool,limits:MediaLimits,decode:(bytes:Buffer,kind:MediaKind)=>Promise<Decoded>){
  async function transaction<T>(fn:(db:PoolClient)=>Promise<T>){const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(61107,2)');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
  async function book(db:PoolClient,id:string,ownerId?:string){const row=(await db.query(`SELECT id,owner_user_id,closed_at,${accessSql()} AS access_state FROM event_books WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!row||ownerId&&row.owner_user_id!==ownerId)throw new PhotoError('INVITE_NOT_FOUND',404);return row;}
  function open(row:Row){if(row.closed_at)throw new PhotoError('SUBMISSIONS_CLOSED',410);if(row.access_state!=='open')throw new PhotoError(row.access_state==='early'?'SUBMISSIONS_EARLY':'SUBMISSIONS_ENDED',410);}
  async function quota(db:PoolClient,bookId:string,attemptId:string,bytes:number,newMedia=false){
    const q=(await db.query(`SELECT
      (SELECT COALESCE(sum(stored_size),0) FROM event_media)+(SELECT COALESCE(sum(stored_size),0) FROM event_media_annotations)+
      (SELECT COALESCE(sum(octet_length(pending_bytes)),0) FROM event_media_attempts WHERE id<>$2) AS total,
      (SELECT COALESCE(sum(stored_size),0) FROM event_media WHERE book_id=$1)+(SELECT COALESCE(sum(a.stored_size),0) FROM event_media_annotations a JOIN event_media m ON m.id=a.media_id WHERE m.book_id=$1)+
      (SELECT COALESCE(sum(octet_length(pending_bytes)),0) FROM event_media_attempts WHERE book_id=$1 AND id<>$2) AS book,
      (SELECT count(*) FROM event_media WHERE book_id=$1) AS count,
      (SELECT count(*) FROM event_media) AS total_count,pg_database_size(current_database()) AS dbsize`,[bookId,attemptId])).rows[0];
    if(Number(q.total)+bytes>limits.totalBytes||Number(q.book)+bytes>limits.bookBytes||newMedia&&(Number(q.count)>=100||Number(q.total_count)>=1000)||Number(q.dbsize)>700*1024*1024)throw new PhotoError('PHOTO_QUOTA',413);
  }
  async function begin(bookId:string,key:string,device:string|null,kind:MediaKind,hints:{source?:string;mime?:string;ownerId?:string}={}):Promise<MediaAttemptLease>{
    return transaction(async db=>{
      const b=await book(db,bookId,hints.ownerId),media=(await db.query(`SELECT ${mediaMetadata} FROM event_media WHERE book_id=$1 AND upload_key=$2`,[bookId,key])).rows[0];
      if(media&&(media.kind!==kind||media.guest_device_id&&media.guest_device_id!==device))throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
      const prior=(await db.query('SELECT id,kind,guest_device_id,lease_until,diagnostic_id FROM event_media_attempts WHERE book_id=$1 AND upload_key=$2 FOR UPDATE',[bookId,key])).rows[0];
      if(prior&&(prior.kind!==kind||prior.guest_device_id!==device))throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
      if(prior?.lease_until&&new Date(prior.lease_until).getTime()>Date.now())throw new PhotoError('MEDIA_BUSY',429);
      if(media?.state!=='attached')open(b);
      if(!prior){const count=(await db.query('SELECT count(*) FILTER(WHERE book_id=$1) AS book,count(*) AS total FROM event_media_attempts',[bookId])).rows[0];if(Number(count.book)>=300||Number(count.total)>=3000)throw new PhotoError('PHOTO_QUOTA',413);}
      const id=prior?.id||randomUUID(),lease=randomUUID(),diagnosticId=prior?.diagnostic_id||randomUUID();
      if(prior)await db.query(`UPDATE event_media_attempts SET lease_token=$2,lease_until=CURRENT_TIMESTAMP+($3*interval '1 millisecond'),updated_at=CURRENT_TIMESTAMP,
        state=CASE WHEN media_id IS NULL THEN CASE WHEN pending_bytes IS NULL THEN 'receiving' ELSE 'processing' END ELSE state END,
        stage=CASE WHEN media_id IS NULL THEN CASE WHEN pending_bytes IS NULL THEN 'receiving' ELSE 'validation' END ELSE stage END WHERE id=$1`,[id,lease,leaseMs]);
      else await db.query(`INSERT INTO event_media_attempts(id,book_id,upload_key,guest_device_id,kind,state,stage,diagnostic_id,lease_token,lease_until,media_id,source_hint,mime_hint)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP+($10*interval '1 millisecond'),$11,$12,$13)`,[id,bookId,key,device,kind,media?.state||'receiving',media?'submission':'receiving',diagnosticId,lease,leaseMs,media?.id||null,['gallery','camera','recorder','file'].includes(hints.source||'')?hints.source:'unknown',diagnosticMimes.has(hints.mime||'')?hints.mime:null]);
      return{id,bookId,key,device,kind,lease,diagnosticId,...(hints.ownerId?{ownerId:hints.ownerId}:{})};
    });
  }
  async function failed(attempt:MediaAttemptLease,error:unknown,stage='validation'){
    if(typeof error==='object'&&error!==null&&!failureContexts.has(error))failureContexts.set(error,{diagnosticId:attempt.diagnosticId,stage});
    await pool.query(`UPDATE event_media_attempts SET state=CASE WHEN state='attached' THEN state ELSE 'failed' END,stage=CASE WHEN state='attached' THEN stage ELSE $3 END,error_code=CASE WHEN state='attached' THEN NULL ELSE $4 END,error_status=CASE WHEN state='attached' THEN NULL ELSE $5::integer END,
      lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND lease_token=$2`,[attempt.id,attempt.lease,stage,code(error),status(error)]);
  }
  async function process(attempt:MediaAttemptLease,bytes:Buffer){
    let stage='validation';
    try{
      const checksum=sha(bytes);
      const existing=await transaction(async db=>{
        const b=await book(db,attempt.bookId,attempt.ownerId),a=(await db.query('SELECT sha256,lease_token,lease_until FROM event_media_attempts WHERE id=$1 FOR UPDATE',[attempt.id])).rows[0];
        if(!a||a.lease_token!==attempt.lease||new Date(a.lease_until).getTime()<=Date.now())throw new PhotoError('MEDIA_RETRY_REQUIRED',503);
        if(a.sha256&&a.sha256!==checksum)throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
        const m=(await db.query(`SELECT ${mediaMetadata} FROM event_media WHERE book_id=$1 AND upload_key=$2`,[attempt.bookId,attempt.key])).rows[0];
        if(m){
          if(m.sha256!==checksum||m.kind!==attempt.kind||m.guest_device_id&&m.guest_device_id!==attempt.device)throw new PhotoError('IDEMPOTENCY_CONFLICT',409);
          if(m.state!=='attached'){open(b);m.expires_at=(await db.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP+($2*interval '1 second') WHERE id=$1 RETURNING expires_at",[m.id,limits.ttlSeconds])).rows[0].expires_at;}
          await db.query(`UPDATE event_media_attempts SET media_id=$2,state=$3,stage=$4,error_code=NULL,error_status=NULL,sha256=$5,byte_length=$6,pending_bytes=NULL,
            lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[attempt.id,m.id,m.state,m.state==='attached'?'complete':'submission',checksum,bytes.length]);return uploadAck(m,true);
        }
        open(b);await quota(db,attempt.bookId,attempt.id,bytes.length,true);
        await db.query(`UPDATE event_media_attempts SET pending_bytes=COALESCE(pending_bytes,$2),sha256=$3,byte_length=$4,state='processing',stage='validation',error_code=NULL,error_status=NULL,
          lease_until=CURRENT_TIMESTAMP+($5*interval '1 millisecond'),updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[attempt.id,bytes,checksum,bytes.length,leaseMs]);return null;
      });
      if(existing)return existing;
      const decoded=await decode(bytes,attempt.kind);
      stage='storage';
      return await transaction(async db=>{
        const b=await book(db,attempt.bookId,attempt.ownerId);open(b);
        const a=(await db.query('SELECT sha256,lease_token,lease_until,pending_bytes=$2 AS bytes_match FROM event_media_attempts WHERE id=$1 FOR UPDATE',[attempt.id,bytes])).rows[0];
        if(!a||a.lease_token!==attempt.lease||new Date(a.lease_until).getTime()<=Date.now()||a.sha256!==checksum||!a.bytes_match)throw new PhotoError('MEDIA_RETRY_REQUIRED',503);
        const stored=bytes.length+decoded.preview.length+decoded.display.length;await quota(db,attempt.bookId,attempt.id,stored,true);
        const id=randomUUID(),row=(await db.query(`INSERT INTO event_media(id,book_id,upload_key,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size,expires_at,kind,duration_seconds,guest_device_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploaded',$9,$10,$11,$12,CURRENT_TIMESTAMP+($13*interval '1 second'),$14,$15,$16) RETURNING ${mediaMetadata}`,[id,attempt.bookId,attempt.key,decoded.mime,bytes.length,checksum,decoded.width,decoded.height,bytes,decoded.preview,decoded.display,stored,limits.ttlSeconds,attempt.kind,decoded.durationSeconds,attempt.device])).rows[0];
        await db.query(`UPDATE event_media_attempts SET media_id=$2,pending_bytes=NULL,state='uploaded',stage='submission',error_code=NULL,error_status=NULL,
          lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[attempt.id,id]);return uploadAck(row,false);
      });
    }catch(error){await failed(attempt,error,stage).catch(()=>undefined);throw error;}
  }
  async function rows(bookId:string){
    const found=await pool.query(`SELECT ${metadataColumns} FROM event_media_attempts a LEFT JOIN event_media m ON m.id=a.media_id WHERE a.book_id=$1 AND a.state<>'attached'
      UNION ALL SELECT m.id,m.book_id,m.upload_key,m.guest_device_id,m.kind,m.state,'submission',m.sha256,m.original_size,m.id,NULL,NULL,m.id,NULL,NULL,m.created_at,m.created_at,'unknown',m.mime_type,false,m.expires_at
      FROM event_media m WHERE m.book_id=$1 AND m.state='uploaded' AND NOT EXISTS(SELECT 1 FROM event_media_attempts a WHERE a.book_id=m.book_id AND a.upload_key=m.upload_key)
      ORDER BY updated_at DESC LIMIT 400`,[bookId]);return found.rows;
  }
  async function list(bookId:string){return{attempts:(await rows(bookId)).map(summary)};}
  async function retry(bookId:string,id:string,ownerId:string){
    const found=(await pool.query(`SELECT a.upload_key,a.guest_device_id,a.kind,a.state,a.diagnostic_id,a.stage,(a.pending_bytes IS NOT NULL OR a.media_id IS NOT NULL) AS has_bytes FROM event_media_attempts a WHERE a.id=$1 AND a.book_id=$2`,[id,bookId])).rows[0];
    const prior=found||(await pool.query("SELECT upload_key,guest_device_id,kind,state,id AS diagnostic_id,'submission' AS stage,true AS has_bytes FROM event_media WHERE id=$1 AND book_id=$2 AND state='uploaded'",[id,bookId])).rows[0];
    if(!prior)throw new PhotoError('MEDIA_NOT_FOUND',404);
    let attempt:MediaAttemptLease|undefined;
    try{
      if(prior.state==='attached'||!prior.has_bytes)throw new PhotoError('MEDIA_RETRY_UNAVAILABLE',409);
      attempt=await begin(bookId,prior.upload_key,prior.guest_device_id,prior.kind,{ownerId});
      const bytes=(await pool.query('SELECT COALESCE(a.pending_bytes,m.original_bytes) AS bytes FROM event_media_attempts a LEFT JOIN event_media m ON m.id=a.media_id WHERE a.id=$1',[attempt.id])).rows[0]?.bytes;
      if(!bytes)throw new PhotoError('MEDIA_RETRY_UNAVAILABLE',409);
      const upload=await process(attempt,bytes);
      const current=(await pool.query(`SELECT ${metadataColumns} FROM event_media_attempts a LEFT JOIN event_media m ON m.id=a.media_id WHERE a.id=$1 AND a.book_id=$2`,[attempt.id,bookId])).rows[0];
      return{attempt:summary(current),upload};
    }catch(error){
      if(attempt)await failed(attempt,error,mediaAttemptFailure(error)?.stage||'storage').catch(()=>undefined);
      if(typeof error==='object'&&error!==null&&!failureContexts.has(error))failureContexts.set(error,{diagnosticId:prior.diagnostic_id,stage:prior.stage});
      throw error;
    }
  }
  async function recovery(bookId:string,key:string,device:string){
    const a=(await pool.query(`SELECT ${metadataColumns} FROM event_media_attempts a LEFT JOIN event_media m ON m.id=a.media_id WHERE a.book_id=$1 AND a.upload_key=$2 AND a.guest_device_id=$3`,[bookId,key,device])).rows[0];
    const m=(await pool.query('SELECT id,kind,mime_type,duration_seconds,state,expires_at,submission_id FROM event_media WHERE book_id=$1 AND upload_key=$2 AND guest_device_id=$3',[bookId,key,device])).rows[0];
    if(m&&(m.state==='attached'||new Date(m.expires_at).getTime()>Date.now())){const {replayed,...result}=uploadAck(m,true);void replayed;return{...result,...(a?{diagnosticId:a.diagnostic_id}:{})};}
    if(a)return summary(a);
    if(m)return{state:'failed',stage:'submission',mediaId:m.id,errorCode:'PHOTO_EXPIRED',diagnosticId:m.id,retryAvailable:true};
    return null;
  }
  return{begin,process,failed,list,retry,recovery};
}
