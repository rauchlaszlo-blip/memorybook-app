import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import express from 'express';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { createWeddingRouter } from '../server/wedding/router';
import { mediaLimits, cleanupMedia } from '../server/wedding/media';
import { assertMediaToolsReady, decodeAv, mediaBinaryPaths } from '../server/wedding/av-decoder';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { guestMediaLimits } from '../shared/media-limits';
import { emptyAnnotation } from '../shared/photo-annotation';

const execute=promisify(execFile),connectionString=localDatabaseUrl(),schema='av_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString});
let pool:Pool,server:Server,base='',folder='';
const samples:Record<string,Buffer>={};
type Book={id:string;invite_token:string;cookie:string};
async function fixture(name:string,args:string[]) {
  const path=join(folder,name);await execute(mediaBinaryPaths().ffmpeg,['-v','error','-nostdin','-y',...args,path],{timeout:30000,windowsHide:true});return readFile(path);
}
async function book():Promise<Book> {
  const response=await fetch(base+'/books',{method:'POST',headers:{'content-type':'application/json','x-owner':'av-owner'},body:JSON.stringify({names:'Fiktív média próba',date:'2027-06-05'})});
  assert.equal(response.status,201);const b=(await response.json()).book;const guest=await fetch(base+'/guest/'+b.invite_token);return {...b,cookie:guest.headers.get('set-cookie')!.split(';')[0]};
}
async function upload(b:Book,kind:string,bytes:Buffer,key=randomUUID()) {
  const r=await fetch(base+'/guest/'+b.invite_token+'/media/'+key,{method:'POST',headers:{'content-type':'application/octet-stream','x-media-kind':kind,cookie:b.cookie},body:new Uint8Array(bytes)});
  return {response:r,body:await r.json(),key};
}
async function submit(b:Book,key:string,mediaId:string,extra:Record<string,unknown>={}) {
  return fetch(base+'/guest/'+b.invite_token+'/submissions',{method:'POST',headers:{'content-type':'application/json',cookie:b.cookie},body:JSON.stringify({name:'Azonos nevű fiktív vendég',message:'Rövid fiktív tesztüzenet',idempotencyKey:key,mediaId,...extra})});
}
before(async()=>{
  await assertMediaToolsReady();folder=await mkdtemp(join(tmpdir(),'memorybook-av-test-'));
  samples.wav=await fixture('short.wav',['-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=0.5','-c:a','pcm_s16le']);
  samples.long=await fixture('long.wav',['-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','20.1','-c:a','pcm_s16le']);
  samples.justLong=await fixture('just-long.wav',['-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','20.01','-c:a','pcm_s16le']);
  samples.exact=await fixture('exact.wav',['-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','20','-c:a','pcm_s16le']);
  samples.webm=await fixture('short.webm',['-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libvpx','-threads','1','-c:a','libopus','-shortest']);
  samples.mp4=await fixture('short.mp4',['-f','lavfi','-i','color=c=green:s=120x160:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libx264','-threads','1','-c:a','aac','-movflags','frag_keyframe+empty_moov','-shortest']);
  samples.m4a=await fixture('short.m4a',['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:a','aac']);
  samples.audioWebm=await fixture('audio.webm',['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:a','libopus','-live','1']);
  samples.ogg=await fixture('short.ogg',['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:a','libopus']);
  samples.mov=await fixture('iphone.mov',['-f','lavfi','-i','color=c=yellow:s=120x160:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libx265','-tag:v','hvc1','-x265-params','pools=1:frame-threads=1:log-level=error','-threads','1','-c:a','aac','-shortest']);
  samples.exactMp4=await fixture('exact.mp4',['-f','lavfi','-i','color=c=black:s=16x16:r=10:d=20','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','20','-c:v','libx264','-threads','1','-c:a','aac','-movflags','frag_keyframe+empty_moov']);
  samples.photo=await sharp({create:{width:20,height:20,channels:3,background:'#ff8800'}}).png().toBuffer();
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString,options:`-c search_path=${schema}`});await migrateWedding(pool);
  const app=express();const options={pool,media:mediaLimits(),env:{NODE_ENV:'test',WEDDING_ENABLED:'true',WEDDING_PILOT_CREATE_ENABLED:'true',WEDDING_PILOT_USER_IDS:'av-owner'},getSession:async(req:express.Request)=>req.get('x-owner')?{user:{id:req.get('x-owner')!}}:null};
  app.use('/quota',createWeddingRouter(options));app.use(createWeddingRouter(options));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');base='http://127.0.0.1:'+addr.port;
});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool?.end();try{await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await admin.end();if(folder&&resolve(dirname(folder))===resolve(tmpdir())&&basename(folder).startsWith('memorybook-av-test-'))await rm(resolve(folder),{recursive:true,force:true});}});

test('actual full decoder accepts WAV, MP4/AAC, Ogg/Opus and recorder-style durationless WebM; exact20s accepted',async()=>{
  for(const [name,kind] of [['wav','audio'],['m4a','audio'],['ogg','audio'],['audioWebm','audio'],['webm','video'],['mp4','video'],['mov','video'],['exact','audio']] as const){
    const result=await decodeAv(samples[name],kind);assert.ok(result.durationSeconds>0&&result.durationSeconds<=20,name);assert.match(result.mime,new RegExp('^'+kind+'/'));
    if(name==='mov')assert.equal(result.mime,'video/quicktime');
  }
  // Fragmented AAC includes encoder priming/padding; it must never exceed the actual
  // decoded20s limit merely because the advertised movie duration says20s.
  try{const exact=await decodeAv(samples.exactMp4,'video');assert.ok(exact.durationSeconds<=20);}catch(error){assert.equal((error as {code:string}).code,'MEDIA_DURATION');}
});
test('rejects type spoof, truncated/concatenated containers, unsupported codecs, over20s and maxbytes',async()=>{
  for(const [bytes,kind] of [[samples.photo,'audio'],[samples.wav,'video'],[samples.webm,'audio'],[samples.wav.subarray(0,samples.wav.length-20),'audio'],[Buffer.concat([samples.mp4,Buffer.from('<script>evil</script>')]),'video'],[samples.mp4.subarray(0,samples.mp4.length-20),'video'],[Buffer.concat([samples.ogg,Buffer.from('PK\x03\x04')]),'audio'],[samples.audioWebm.subarray(0,samples.audioWebm.length-10),'audio'],[Buffer.concat([samples.audioWebm,Buffer.from('PK\x03\x04inert-polyglot-test')]),'audio']] as const)await assert.rejects(decodeAv(bytes,kind),{name:'Error'});
  await assert.rejects(decodeAv(samples.long,'audio'),{code:'MEDIA_DURATION'});
  await assert.rejects(decodeAv(samples.justLong,'audio'),{code:'MEDIA_DURATION'});
  await assert.rejects(decodeAv(Buffer.alloc(guestMediaLimits.audio.maxBytes+1),'audio'),{code:'MEDIA_TOO_LARGE'});
  const unsupported=await fixture('unsupported.mp4',['-f','lavfi','-i','color=c=black:s=16x16:r=1:d=1','-c:v','mpeg4']);
  await assert.rejects(decodeAv(unsupported,'video'),{code:'MEDIA_TYPE'});
});
test('commits protected AV original/playback, byte ranges and metadata; no image derivatives/annotation',async()=>{
  const b=await book();for(const kind of ['audio','video'] as const){const bytes=kind==='audio'?samples.wav:samples.mp4,u=await upload(b,kind,bytes);assert.equal(u.response.status,201,JSON.stringify(u.body));assert.equal(u.body.kind,kind);
    assert.equal((await fetch(base+'/media/'+u.body.mediaId+'/playback',{headers:{'x-owner':'av-owner'}})).status,404);
    assert.equal((await submit(b,u.key,u.body.mediaId,{annotation:emptyAnnotation()})).status,400);
    assert.equal((await submit(b,u.key,u.body.mediaId,{message:'\u0000'})).status,400);
    assert.equal((await submit(b,u.key,u.body.mediaId,{message:'\u000b'})).status,400);
    assert.equal((await submit(b,u.key,u.body.mediaId,{message:'x'.repeat(4001)})).status,400);
    assert.equal((await submit(b,u.key,u.body.mediaId,{message:''})).status,201);
    for(const variant of ['preview','display','annotation'])assert.equal((await fetch(base+'/media/'+u.body.mediaId+'/'+variant,{headers:{'x-owner':'av-owner'}})).status,404);
    assert.equal((await fetch(base+'/media/'+u.body.mediaId+'/playback')).status,401);
    assert.equal((await fetch(base+'/media/'+u.body.mediaId+'/playback',{headers:{'x-owner':'foreign'}})).status,404);
    const partial=await fetch(base+'/media/'+u.body.mediaId+'/playback',{headers:{'x-owner':'av-owner',range:'bytes=0-19'}});assert.equal(partial.status,206);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),bytes.subarray(0,20));
    assert.equal((await fetch(base+'/media/'+u.body.mediaId+'/playback',{headers:{'x-owner':'av-owner',range:'bytes=99999999-'}})).status,416);
    const original=await fetch(base+'/media/'+u.body.mediaId+'/original',{headers:{'x-owner':'av-owner'}});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
    const row=(await pool.query('SELECT sha256,octet_length(preview_bytes) AS preview,state FROM event_media WHERE id=$1',[u.body.mediaId])).rows[0];assert.equal(row.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(row.preview,0);assert.equal(row.state,'attached');
  }
  const detail=await(await fetch(base+'/books/'+b.id,{headers:{'x-owner':'av-owner'}})).json();for(const item of detail.submissions){assert.ok(item.media[0].playbackUrl);assert.equal(item.media[0].previewUrl,null);}
  await migrateWedding(pool);
});
test('quota only commits; stable retry/replay, concurrent boundary, guest/book isolation and failed attempts preserve quota',async()=>{
  const b=await book(),other=await book();
  const bad=await upload(b,'audio',samples.long);assert.equal(bad.body.error,'MEDIA_DURATION');
  const first=await upload(b,'audio',samples.wav);assert.equal(first.response.status,201);assert.equal((await submit(b,first.key,first.body.mediaId)).status,201);
  const repeat=await upload(b,'audio',samples.wav,first.key);assert.equal(repeat.response.status,200);assert.equal((await submit(b,first.key,first.body.mediaId)).status,200);
  const second=await upload(b,'audio',samples.wav),third=await upload(b,'audio',samples.wav);
  const sent=await Promise.all([submit(b,second.key,second.body.mediaId),submit(b,third.key,third.body.mediaId)]);assert.deepEqual(sent.map(r=>r.status).sort(),[201,413]);
  const rejected=sent[0].status===413?second:third;
  assert.equal((await submit(other,rejected.key,rejected.body.mediaId)).status,409);
  const foreignIdentity={...b,cookie:other.cookie};assert.equal((await submit(foreignIdentity,rejected.key,rejected.body.mediaId)).status,409);
  assert.equal((await upload(foreignIdentity,'audio',samples.wav,first.key)).response.status,409);
  const newGuest=await upload(foreignIdentity,'audio',samples.wav);assert.equal((await submit(foreignIdentity,newGuest.key,newGuest.body.mediaId)).status,201);
  const independent=await upload({...other,cookie:b.cookie},'audio',samples.wav);assert.equal((await submit({...other,cookie:b.cookie},independent.key,independent.body.mediaId)).status,201);
  const usage=await(await fetch(base+'/guest/'+b.invite_token,{headers:{cookie:b.cookie}})).json();assert.deepEqual(usage.media.used,{photo:0,video:0,audio:2});assert.equal(usage.media.remaining.audio,0);
  assert.equal((await pool.query("SELECT state FROM event_media WHERE id=$1",[rejected.body.mediaId])).rows[0].state,'uploaded');
  await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1second' WHERE id=$1",[rejected.body.mediaId]);await cleanupMedia(pool);
  assert.equal((await pool.query("SELECT count(*)::int n FROM event_media WHERE book_id=$1 AND state='attached'",[b.id])).rows[0].n,3);
});
test('all books enforce10photos and2videos independently; upload/session bypass and wrong-kind replay denied',async()=>{
  base+='/quota'; // A fresh rate bucket: this case tests committed guest quotas, not the separate IP write budget.
  const b=await book();
  const noSession=await fetch(base+'/guest/'+b.invite_token+'/media/'+randomUUID(),{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(samples.photo)});assert.equal(noSession.status,428);
  for(let i=0;i<11;i++){const u=await upload(b,'photo',samples.photo);assert.equal(u.response.status,201);assert.equal((await submit(b,u.key,u.body.mediaId)).status,i<10?201:413);}
  for(let i=0;i<3;i++){const u=await upload(b,'video',samples.mp4);assert.equal(u.response.status,201);assert.equal((await submit(b,u.key,u.body.mediaId)).status,i<2?201:413);if(i===0)assert.equal((await upload(b,'audio',samples.mp4,u.key)).response.status,409);}
  const usage=await(await fetch(base+'/guest/'+b.invite_token,{headers:{cookie:b.cookie}})).json();assert.deepEqual(usage.media.used,{photo:10,video:2,audio:0});
});
test('parallel duplicate upload returns busy or replay, then samekey retries without duplicate storage or charge',async()=>{
  const b=await book(),key=randomUUID();
  const attempts=await Promise.all([upload(b,'audio',samples.wav,key),upload(b,'audio',samples.wav,key)]);
  assert.ok(attempts.some(a=>a.response.status===201));assert.ok(attempts.every(a=>[200,201,429].includes(a.response.status)));
  const retry=await upload(b,'audio',samples.wav,key);assert.equal(retry.response.status,200);
  const used=await(await fetch(base+'/guest/'+b.invite_token,{headers:{cookie:b.cookie}})).json();assert.equal(used.media.used.audio,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,1);
  assert.equal((await submit(b,key,retry.body.mediaId)).status,201);assert.equal((await submit(b,key,retry.body.mediaId)).status,200);
});
test('lost upload response recovery is exact guest/book/key scoped, read-only and works after closure',async()=>{
  const b=await book(),other=await book(),uploaded=await upload(b,'audio',samples.wav),pending=await upload(b,'video',samples.mp4);
  assert.equal(uploaded.response.status,201);assert.equal(pending.response.status,201);
  const recover=(which:Book,key:string,cookie:string|null=which.cookie)=>fetch(base+'/guest/'+which.invite_token+'/media/'+key,{headers:cookie?{cookie}:{}});
  const read=await recover(b,uploaded.key);assert.equal(read.status,200);assert.equal(read.headers.get('set-cookie'),null);
  const recovered=await read.json();assert.match(recovered.diagnosticId,/^[a-f0-9-]{36}$/);
  assert.deepEqual(recovered,{mediaId:uploaded.body.mediaId,kind:'audio',mimeType:'audio/wav',durationSeconds:uploaded.body.durationSeconds,state:'uploaded',expiresAt:uploaded.body.expiresAt,submissionId:null,diagnosticId:recovered.diagnosticId});
  const committed=await submit(b,uploaded.key,uploaded.body.mediaId);assert.equal(committed.status,201);const committedBody=await committed.json();
  assert.equal((await submit(b,uploaded.key,uploaded.body.mediaId)).status,200);
  const attached=await(await recover(b,uploaded.key)).json();assert.equal(attached.state,'attached');assert.equal(attached.submissionId,committedBody.submissionId);assert.equal(attached.expiresAt,null);
  assert.equal((await fetch(base+'/books/'+b.id+'/close',{method:'POST',headers:{'x-owner':'av-owner'}})).status,200);
  const before=(await pool.query('SELECT id,state,submission_id,stored_size,expires_at FROM event_media WHERE book_id=$1 ORDER BY id',[b.id])).rows;
  assert.equal((await recover(b,uploaded.key)).status,200);assert.equal((await recover(b,pending.key)).status,200);
  for(const response of [await recover(other,uploaded.key),await recover(b,uploaded.key,other.cookie),await recover(b,uploaded.key,null),await recover(b,randomUUID()),await recover(b,'not-a-uuid')]){
    assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'MEDIA_NOT_FOUND'});assert.equal(response.headers.get('set-cookie'),null);
  }
  assert.deepEqual((await pool.query('SELECT id,state,submission_id,stored_size,expires_at FROM event_media WHERE book_id=$1 ORDER BY id',[b.id])).rows,before);
  const usage=await(await fetch(base+'/guest/'+b.invite_token,{headers:{cookie:b.cookie}})).json();assert.deepEqual(usage.media.used,{photo:0,video:0,audio:1});
  await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[pending.body.mediaId]);
  // Expiry now blocks attachment while retaining the original for owner recovery.
  const expired=await recover(b,pending.key);assert.equal(expired.status,200);const expiredBody=await expired.json();assert.equal(expiredBody.state,'failed');assert.equal(expiredBody.errorCode,'PHOTO_EXPIRED');assert.equal(expiredBody.mediaId,pending.body.mediaId);assert.equal(expiredBody.retryAvailable,true);
  assert.equal((await recover(b,pending.key,other.cookie)).status,404);assert.equal((await recover(b,pending.key,null)).status,404);
});
