import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {Pool} from 'pg';
import express from 'express';
import sharp from 'sharp';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {createWeddingRouter} from '../server/wedding/router';
import {createMediaAttemptService} from '../server/wedding/media-attempts';
import {cleanupMedia,decodePhoto,mediaLimits} from '../server/wedding/media';
import {PhotoError} from '../server/wedding/media-error';
import {attachAnnotation} from '../server/wedding/annotation';
import {emptyAnnotation} from '../shared/photo-annotation';

const connectionString=localDatabaseUrl(),schema='attempt_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const limits=mediaLimits(),env={NODE_ENV:'test',WEDDING_ENABLED:'true',WEDDING_PILOT_CREATE_ENABLED:'true',WEDDING_PILOT_USER_IDS:'a,b'};
let server:Server,base:string,jpeg:Buffer;
const decode=async(bytes:Buffer)=>({...await decodePhoto(bytes,limits),durationSeconds:null});
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
async function call(path:string,body?:unknown,owner?:string,cookie?:string){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{'x-owner':owner}:{}),...(cookie?{cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});}
async function book(){const r=await call('/books',{names:'Kísérlet – fiktív',date:'2027-06-05'},'a');assert.equal(r.status,201);const b=(await r.json()).book;const guest=await call('/guest/'+b.invite_token),cookie=guest.headers.get('set-cookie')!.split(';')[0];return{...b,cookie,device:digest(cookie.split('=')[1])};}
async function upload(b:Awaited<ReturnType<typeof book>>,key:string,bytes=jpeg){return fetch(base+`/guest/${b.invite_token}/media/${key}`,{method:'POST',headers:{'Content-Type':'application/octet-stream',cookie:b.cookie,'X-Media-Source':'gallery','X-Media-Mime':'image/jpeg'},body:new Uint8Array(bytes)});}
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrateWedding(pool);jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#7777bb'}}).jpeg().toBuffer();const app=express();app.use(createWeddingRouter({pool,env,media:limits,getSession:async req=>req.get('x-owner')?{user:{id:req.get('x-owner')!}}:null}));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');base='http://127.0.0.1:'+address.port;});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});

test('failed decode survives restart; owner retries exact quarantine bytes; durable attach ACK and recovery are idempotent',async()=>{
  const b=await book(),key=randomUUID();
  const failed=createMediaAttemptService(pool,limits,async()=>{throw new PhotoError('MEDIA_RETRY_REQUIRED',503);});
  const lease=await failed.begin(b.id,key,b.device,'photo',{source:'gallery',mime:'image/jpeg'});
  await assert.rejects(failed.process(lease,jpeg),{code:'MEDIA_RETRY_REQUIRED'});
  const stored=(await pool.query('SELECT * FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0];assert.equal(stored.state,'failed');assert.deepEqual(stored.pending_bytes,jpeg);assert.equal(stored.sha256,digest(jpeg));
  const newConnection=new Pool({connectionString,options:`-c search_path=${schema}`});
  try{const restarted=createMediaAttemptService(newConnection,limits,decode);const list=await restarted.list(b.id);assert.equal(list.attempts[0].retryAvailable,true);assert.equal(list.attempts[0].source,'gallery');assert.equal(JSON.stringify(list).includes(jpeg.toString('base64')),false);}finally{await newConnection.end();}
  assert.equal((await call(`/books/${b.id}/media-attempts`)).status,401);assert.equal((await call(`/books/${b.id}/media-attempts`,undefined,'b')).status,404);
  assert.equal((await call(`/books/${b.id}/media-attempts/${lease.id}/retry`,{},'b')).status,404);
  const retry=await call(`/books/${b.id}/media-attempts/${lease.id}/retry`,{},'a');assert.equal(retry.status,200);const {upload:ack}=await retry.json();assert.equal(ack.state,'uploaded');assert.equal(ack.submissionId,null);assert.ok(ack.expiresAt);
  assert.equal((await call(`/media/${ack.mediaId}/original`,undefined,'a')).status,404);
  const ready=(await pool.query('SELECT a.pending_bytes,m.original_bytes FROM event_media_attempts a JOIN event_media m ON m.id=a.media_id WHERE a.id=$1',[lease.id])).rows[0];assert.equal(ready.pending_bytes,null);assert.deepEqual(ready.original_bytes,jpeg);
  const payload={name:'Fiktív vendég',message:'',idempotencyKey:key,mediaId:ack.mediaId};
  const committed=await call(`/guest/${b.invite_token}/submissions`,payload,undefined,b.cookie);assert.equal(committed.status,201);const result=await committed.json();assert.equal(result.accepted,true);assert.equal(result.state,'committed');assert.equal(result.mediaId,ack.mediaId);assert.match(result.submissionId,/^[\da-f-]{36}$/);
  const replay=await call(`/guest/${b.invite_token}/submissions`,payload,undefined,b.cookie);assert.deepEqual(await replay.json(),{...result,replayed:true});
  const recovery=await call(`/guest/${b.invite_token}/media/${key}`,undefined,undefined,b.cookie);const recovered=await recovery.json();assert.equal(recovered.state,'attached');assert.equal(recovered.submissionId,result.submissionId);assert.equal(recovered.expiresAt,null);
  assert.deepEqual((await (await call(`/books/${b.id}/media-attempts`,undefined,'a')).json()).attempts,[]);
  assert.deepEqual(Buffer.from(await (await call(`/media/${ack.mediaId}/original`,undefined,'a')).arrayBuffer()),jpeg);
});

test('lease fencing, stale read-only state, identity/hash conflicts and original immutability',async()=>{
  const b=await book(),key=randomUUID(),service=createMediaAttemptService(pool,limits,decode),lease=await service.begin(b.id,key,b.device,'photo');
  await assert.rejects(service.begin(b.id,key,b.device,'photo'),{code:'MEDIA_BUSY'});
  await assert.rejects(service.begin(b.id,key,'other-device','photo'),{code:'IDEMPOTENCY_CONFLICT'});
  await pool.query("UPDATE event_media_attempts SET lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[lease.id]);
  const before=(await pool.query('SELECT updated_at FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0].updated_at;
  const stale=(await service.list(b.id)).attempts[0];assert.equal(stale.state,'failed');assert.equal(stale.errorCode,'UPLOAD_INTERRUPTED');assert.equal(stale.retryAvailable,false);
  assert.deepEqual((await pool.query('SELECT updated_at FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0].updated_at,before);
  const next=await service.begin(b.id,key,b.device,'photo');await assert.rejects(service.process(lease,jpeg),{code:'MEDIA_RETRY_REQUIRED'});
  const ack=await service.process(next,jpeg);assert.equal(ack.state,'uploaded');
  const changed=await service.begin(b.id,key,b.device,'photo');await assert.rejects(service.process(changed,Buffer.from('different')),{code:'IDEMPOTENCY_CONFLICT'});
  assert.deepEqual((await pool.query('SELECT original_bytes FROM event_media WHERE id=$1',[ack.mediaId])).rows[0].original_bytes,jpeg);
  await assert.rejects(pool.query("UPDATE event_media_attempts SET sha256=repeat('0',64) WHERE id=$1",[lease.id]),/immutable/);
  const recovered=await service.recovery(b.id,key,b.device);assert.equal(recovered!.state,'uploaded');assert.equal(await service.recovery(b.id,key,'wrong'),null);
});

test('private invalid bytes stay bounded and cannot be replaced or served through any media path',async()=>{
  const b=await book(),key=randomUUID(),invalid=Buffer.from('not a photo');const response=await upload(b,key,invalid);assert.equal(response.status,415);const error=await response.json();assert.match(error.diagnosticId,/^[\da-f-]{36}$/);
  const list=await (await call(`/books/${b.id}/media-attempts`,undefined,'a')).json();const item=list.attempts[0];assert.equal(item.state,'failed');assert.equal(item.errorCode,'PHOTO_TYPE');assert.equal(item.diagnosticId,error.diagnosticId);assert.equal(item.retryAvailable,true);
  for(const variant of ['original','preview','display','playback'])assert.equal((await call(`/media/${item.id}/${variant}`,undefined,'a')).status,404);
  assert.equal((await upload(b,key,jpeg)).status,409);
  assert.equal((await call(`/books/${b.id}/media-attempts/${item.id}/retry`,{},'a')).status,415);
  assert.deepEqual((await pool.query('SELECT pending_bytes FROM event_media_attempts WHERE id=$1',[item.id])).rows[0].pending_bytes,invalid);
  await assert.rejects(pool.query('UPDATE event_media_attempts SET pending_bytes=NULL WHERE id=$1',[item.id]),/remain preserved/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_submissions WHERE book_id=$1',[b.id])).rows[0].n,0);
});

test('pending bytes reserve upload and annotation quota before commit',async()=>{
  const b=await book(),service=createMediaAttemptService(pool,{...limits,bookBytes:jpeg.length},async()=>{throw new PhotoError('MEDIA_RETRY_REQUIRED',503);});
  const lease=await service.begin(b.id,randomUUID(),b.device,'photo');await assert.rejects(service.process(lease,jpeg));
  const second=await service.begin(b.id,randomUUID(),b.device,'photo');await assert.rejects(service.process(second,Buffer.from('x')),{code:'PHOTO_QUOTA'});
  assert.equal((await pool.query('SELECT sum(octet_length(pending_bytes))::int n FROM event_media_attempts WHERE book_id=$1',[b.id])).rows[0].n,jpeg.length);
  const good=await book(),key=randomUUID(),ack=await (await upload(good,key)).json();
  const row=(await pool.query('SELECT stored_size,display_bytes FROM event_media WHERE id=$1',[ack.mediaId])).rows[0];
  const pending=createMediaAttemptService(pool,limits,async()=>{throw new PhotoError('MEDIA_RETRY_REQUIRED',503);}),p=await pending.begin(good.id,randomUUID(),good.device,'photo');
  const reservation=Buffer.alloc(30_000,7);await assert.rejects(pending.process(p,reservation));
  const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(61107,2)');await assert.rejects(attachAnnotation(db,ack.mediaId,good.id,row.display_bytes,{...emptyAnnotation(),strokes:[{color:'#000000',width:.007,points:[[0,0],[1,1]]}]},{...limits,bookBytes:row.stored_size+reservation.length}),{code:'PHOTO_QUOTA'});await db.query('ROLLBACK');}finally{db.release();}
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_media_annotations WHERE media_id=$1',[ack.mediaId])).rows[0].n,0);
});

test('storage failure leaves exact quarantine, then retry persists once; closing during decode cannot attach',async()=>{
  const b=await book(),service=createMediaAttemptService(pool,limits,decode),key=randomUUID(),lease=await service.begin(b.id,key,b.device,'photo');
  await pool.query(`CREATE FUNCTION test_storage_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id='${b.id}'::uuid THEN RAISE EXCEPTION 'fictional storage failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_storage_failure BEFORE INSERT ON event_media FOR EACH ROW EXECUTE FUNCTION test_storage_failure()`);
  try{await assert.rejects(service.process(lease,jpeg),/fictional storage failure/);}finally{await pool.query('DROP TRIGGER test_storage_failure ON event_media; DROP FUNCTION test_storage_failure()');}
  const row=(await pool.query('SELECT state,stage,pending_bytes FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0];assert.equal(row.state,'failed');assert.equal(row.stage,'storage');assert.deepEqual(row.pending_bytes,jpeg);
  const retry=await service.retry(b.id,lease.id,'a');assert.equal(retry.upload.state,'uploaded');assert.equal((await pool.query('SELECT count(*)::int n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,1);
  const closing=await book(),closed=createMediaAttemptService(pool,limits,async(bytes)=>{await pool.query('UPDATE event_books SET closed_at=CURRENT_TIMESTAMP WHERE id=$1',[closing.id]);return decode(bytes);}),c=await closed.begin(closing.id,randomUUID(),closing.device,'photo');
  await assert.rejects(closed.process(c,jpeg),{code:'SUBMISSIONS_CLOSED'});assert.deepEqual((await pool.query('SELECT pending_bytes FROM event_media_attempts WHERE id=$1',[c.id])).rows[0].pending_bytes,jpeg);assert.equal((await pool.query('SELECT count(*)::int n FROM event_media WHERE book_id=$1',[closing.id])).rows[0].n,0);
});

test('expired uploaded originals survive cleanup and owner retry renews same media without committing guest content',async()=>{
  const b=await book(),key=randomUUID(),ack=await (await upload(b,key)).json();await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[ack.mediaId]);await cleanupMedia(pool);
  assert.deepEqual((await pool.query('SELECT original_bytes FROM event_media WHERE id=$1',[ack.mediaId])).rows[0].original_bytes,jpeg);
  const list=await (await call(`/books/${b.id}/media-attempts`,undefined,'a')).json();assert.equal(list.attempts[0].errorCode,'PHOTO_EXPIRED');
  const retry=await call(`/books/${b.id}/media-attempts/${list.attempts[0].id}/retry`,{},'a');assert.equal(retry.status,200);const result=await retry.json();assert.equal(result.upload.mediaId,ack.mediaId);assert.equal(result.upload.replayed,true);assert.equal(result.attempt.requiresGuestSubmission,true);assert.ok(new Date(result.upload.expiresAt).getTime()>Date.now());
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_submissions WHERE book_id=$1',[b.id])).rows[0].n,0);
});

test('concurrent rejected finalizations do not exhaust a small connection pool',async()=>{
  const b=await book(),small=new Pool({connectionString,max:2,connectionTimeoutMillis:750,options:`-c search_path=${schema}`});
  const app=express();app.use(createWeddingRouter({pool:small,env,media:limits,getSession:async()=>null}));const srv=app.listen(0,'127.0.0.1');await new Promise<void>(r=>srv.once('listening',r));const address=srv.address();assert.ok(address&&typeof address!=='string');
  try{
    const responses=await Promise.all(Array.from({length:8},()=>fetch(`http://127.0.0.1:${address.port}/guest/${b.invite_token}/submissions`,{method:'POST',headers:{'Content-Type':'application/json',cookie:b.cookie},body:JSON.stringify({name:'Fiktív vendég',message:'',idempotencyKey:randomUUID(),mediaId:randomUUID()})})));
    assert.deepEqual(responses.map(r=>r.status),Array(8).fill(409));assert.equal((await small.query('SELECT 1 AS ok')).rows[0].ok,1);
  }finally{await new Promise<void>(r=>srv.close(()=>r()));await small.end();}
});

test('owner retry rechecks ownership under the final storage transaction',async()=>{
  const b=await book(),first=createMediaAttemptService(pool,limits,async()=>{throw new PhotoError('MEDIA_RETRY_REQUIRED',503);}),lease=await first.begin(b.id,randomUUID(),b.device,'photo');await assert.rejects(first.process(lease,jpeg));
  const retry=createMediaAttemptService(pool,limits,async bytes=>{await pool.query("UPDATE event_books SET owner_user_id='b' WHERE id=$1",[b.id]);return decode(bytes);});
  await assert.rejects(retry.retry(b.id,lease.id,'a'),{code:'INVITE_NOT_FOUND'});
  assert.deepEqual((await pool.query('SELECT pending_bytes FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0].pending_bytes,jpeg);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,0);
});

test('pre-V9 orphan with no attempt row remains visible and retries without changing original or media ID',async()=>{
  const b=await book(),key=randomUUID(),ack=await (await upload(b,key)).json();
  // This isolated fixture models a preserved V8 upload, before attempt tracking existed.
  await pool.query('DELETE FROM event_media_attempts WHERE book_id=$1',[b.id]);await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[ack.mediaId]);
  const list=await (await call(`/books/${b.id}/media-attempts`,undefined,'a')).json();assert.equal(list.attempts[0].id,ack.mediaId);assert.equal(list.attempts[0].errorCode,'PHOTO_EXPIRED');
  const retry=await call(`/books/${b.id}/media-attempts/${ack.mediaId}/retry`,{},'a');assert.equal(retry.status,200);const result=await retry.json();assert.equal(result.upload.mediaId,ack.mediaId);assert.equal(result.upload.replayed,true);
  const row=(await pool.query('SELECT m.original_bytes,a.sha256,a.media_id FROM event_media m JOIN event_media_attempts a ON a.media_id=m.id WHERE m.id=$1',[ack.mediaId])).rows[0];assert.deepEqual(row.original_bytes,jpeg);assert.equal(row.sha256,digest(jpeg));assert.equal(row.media_id,ack.mediaId);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_submissions WHERE book_id=$1',[b.id])).rows[0].n,0);
});
