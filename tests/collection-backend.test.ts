import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
import express from 'express';
import type {Server} from 'node:http';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createCollectionRouter} from '../server/collection/router';
import {createCollectionService,collectionLimits} from '../server/collection/service';
import {migrateCollection} from '../server/collection/schema';
import {initializeCollectionFixture,seedCollectionPage} from './collection-fixture';
const connectionString=process.env.DATABASE_URL||'postgresql://memorybook_test@127.0.0.1:5432/memorybook_wedding_test';
const url=new URL(connectionString);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||process.env.WEDDING_LOCAL_DATABASE_ACK!=='yes')throw new Error('Local acknowledged test database required');
const schema='collection_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const limits=collectionLimits(),sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');let base:string,server:Server,jpeg:Buffer;
const service=createCollectionService(pool,limits);
const guest=(token:string)=>({token}),owner=(bookId:string,ownerId='owner-a')=>({bookId,ownerId});
async function call(path:string,body?:unknown,ownerId?:string,method?:string,origin?:string){return fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{...(ownerId?{'x-test-owner':ownerId}:{}),...(body!==undefined?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json',Origin:origin||base}:{})},body:body===undefined?undefined:Buffer.isBuffer(body)?new Uint8Array(body):JSON.stringify(body)});}
const fileInput=(bytes=jpeg,kind='photo')=>({id:randomUUID(),kind,fileName:'Kitalált eredeti.jpg',mimeType:'image/jpeg',byteLength:bytes.length,sha256:sha(bytes)});
async function ready(b:Awaited<ReturnType<typeof seedCollectionPage>>,bytes=jpeg){const input=fileInput(bytes);await service.begin(guest(b.token),input);for(let i=0;i<Math.ceil(bytes.length/limits.chunkBytes);i++)await service.chunk(guest(b.token),input.id,i,bytes.subarray(i*limits.chunkBytes,(i+1)*limits.chunkBytes));return{input,result:await service.complete(guest(b.token),input.id)};}
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await initializeCollectionFixture(pool);jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#906660'}}).jpeg().toBuffer();const app=express();app.use(createCollectionRouter({pool,env:{NODE_ENV:'test'},getSession:async req=>req.get('x-test-owner')?{user:{id:req.get('x-test-owner')!}}:null}));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert.ok(a&&typeof a!=='string');base='http://127.0.0.1:'+a.port;});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});

test('chunk resume and immutable original: reload, out-of-order and exact replay never duplicate bytes',async()=>{
  const b=await seedCollectionPage(pool),bytes=Buffer.alloc(limits.chunkBytes+31,7),input=fileInput(bytes),actor=guest(b.token);
  const begun=await service.begin(actor,input);assert.equal(begun.file.state,'uploading');assert.equal((await service.begin(actor,input)).replayed,true);
  await service.chunk(actor,input.id,1,bytes.subarray(limits.chunkBytes));await service.chunk(actor,input.id,1,bytes.subarray(limits.chunkBytes));
  await assert.rejects(service.chunk(actor,input.id,1,Buffer.alloc(31,8)),{code:'CHUNK_CONFLICT'});
  const fresh=new Pool({connectionString,options:`-c search_path=${schema}`});try{assert.deepEqual((await createCollectionService(fresh,limits).status(actor,input.id)).file.receivedChunks,[1]);}finally{await fresh.end();}
  await assert.rejects(service.complete(actor,input.id),{code:'UPLOAD_INCOMPLETE'});await service.chunk(actor,input.id,0,bytes.subarray(0,limits.chunkBytes));
  await assert.rejects(service.complete(actor,input.id));const failed=(await service.status(actor,input.id)).file;assert.equal(failed.state,'failed');assert.equal(failed.retryAvailable,true);
  assert.deepEqual((await service.bytes(owner(b.bookId),input.id,'original')).bytes,bytes);assert.equal((await pool.query('SELECT count(*)::int n FROM collection_chunks WHERE file_id=$1',[input.id])).rows[0].n,0);
  await assert.rejects(pool.query('UPDATE collection_files SET original_bytes=$2 WHERE id=$1',[input.id,Buffer.alloc(bytes.length,8)]),/immutable/);
  await assert.rejects(service.begin(actor,{...input,sha256:'0'.repeat(64)}),{code:'IDEMPOTENCY_CONFLICT'});
});

test('owner/invite ACL, cross-book IDs, CSRF, private original downloads and range responses',async()=>{
  const b=await seedCollectionPage(pool),other=await seedCollectionPage(pool,{ownerId:'owner-b'}),{input}=await ready(b);
  assert.equal((await call(`/api/my/books/${b.bookId}/collection`)).status,401);assert.equal((await call(`/api/my/books/${b.bookId}/collection`,undefined,'owner-b')).status,404);
  assert.equal((await call(`/api/collection/invites/${other.token}/files/${input.id}`)).status,404);
  assert.equal((await call(`/api/my/books/${other.bookId}/collection/files/${input.id}/original`,undefined,'owner-b')).status,404);
  assert.equal((await call(`/api/my/books/${b.bookId}/collection-settings`,{expectedRevision:0,events:[],locations:[]},'owner-a','PUT','https://foreign.invalid')).status,403);
  const result=await call(`/api/my/books/${b.bookId}/collection/files/${input.id}/original`,undefined,'owner-a');assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),jpeg);assert.match(result.headers.get('cache-control')!,/private.*no-store/);assert.match(result.headers.get('content-disposition')!,/attachment/);
  const range=await fetch(base+`/api/collection/invites/${b.token}/files/${input.id}/original`,{headers:{Range:'bytes=0-9'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),jpeg.subarray(0,10));
  await pool.query("UPDATE pages SET invite_created_at=CURRENT_TIMESTAMP-interval '15 days' WHERE id=$1",[b.pageId]);assert.equal((await call(`/api/collection/invites/${b.token}/files/${input.id}/original`)).status,410);assert.equal((await call(`/api/my/books/${b.bookId}/collection/files/${input.id}/original`,undefined,'owner-a')).status,200);
});

test('atomic strict receipt freezes labels, text/drawing, guest metadata, JPEG and original references',async()=>{
  const b=await seedCollectionPage(pool),eventId=randomUUID(),locationId=randomUUID();await service.saveSettings(owner(b.bookId),{expectedRevision:0,events:[{id:eventId,label:'Szertartás',order:0}],locations:[{id:locationId,label:'Kert',order:0}]});
  const {input}=await ready(b);const canvas={objects:[{type:'IText',text:'Árvíztűrő tükörfúrógép'},{type:'Path',path:[['M',0,0],['L',9,8]]},{type:'Image',collectionAssetId:input.id}]};await pool.query('UPDATE pages SET canvas_json=$2 WHERE id=$1',[b.pageId,canvas]);
  const payload={key:randomUUID(),expectedVersion:1,eventIds:[eventId],locationIds:[locationId],authorShareApproved:false,previewDataUrl:'data:image/jpeg;base64,'+jpeg.toString('base64')};
  const response=await call(`/api/collection/invites/${b.token}/commit`,payload);assert.equal(response.status,200);const receipt=await response.json();assert.equal(receipt.state,'committed');assert.equal(receipt.accepted,true);assert.equal(receipt.groupId,b.pageId);assert.match(receipt.submissionId,/^[\da-f-]{36}$/);
  assert.deepEqual(await service.commit(guest(b.token),payload),{...receipt,replayed:true});await assert.rejects(service.commit(guest(b.token),{...payload,authorShareApproved:true}),{code:'IDEMPOTENCY_CONFLICT'});
  const bootstrap=await service.bootstrap(guest(b.token));assert.equal(bootstrap.receipt!.submissionId,receipt.submissionId);assert.equal(bootstrap.state,'submitted');
  await service.saveSettings(owner(b.bookId),{expectedRevision:1,events:[{id:eventId,label:'Új címke',order:0}],locations:[]});await pool.query('UPDATE pages SET canvas_json=$2,event_guest_data=$3 WHERE id=$1',[b.pageId,{}, {name:'Későbbi tulajdonosi módosítás'}]);
  const list=await service.ownerList(owner(b.bookId)),saved=list.sessions[0];assert.deepEqual(saved.canvasData,canvas);assert.equal(saved.sender,'Fiktív Vendég');assert.equal(saved.events[0].label,'Szertartás');assert.equal(saved.locations[0].label,'Kert');assert.deepEqual(await service.groupPreview(owner(b.bookId),b.pageId),jpeg);
  await assert.rejects(pool.query("UPDATE collection_groups SET guest_data='{}' WHERE page_id=$1",[b.pageId]),/immutable/);
  const zip=await call(`/api/my/books/${b.bookId}/collection/archive.zip`,undefined,'owner-a');assert.equal(zip.status,200);const bytes=Buffer.from(await zip.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(jpeg));assert.ok(bytes.includes(Buffer.from('snapshots.json')));assert.ok(bytes.includes(Buffer.from('manifest.json')));assert.equal(bytes.includes(Buffer.from(b.token)),false);
});

test('failed/incomplete/removed assets gate commit, legacy standard and dedication remain separate',async()=>{
  const b=await seedCollectionPage(pool),input=fileInput();await service.begin(guest(b.token),input);const payload={key:randomUUID(),expectedVersion:1,eventIds:[],locationIds:[],authorShareApproved:false};await assert.rejects(service.commit(guest(b.token),payload),{code:'COLLECTION_INCOMPLETE'});
  await service.chunk(guest(b.token),input.id,0,jpeg);await service.complete(guest(b.token),input.id);await pool.query('UPDATE pages SET canvas_json=$2 WHERE id=$1',[b.pageId,{objects:[{collectionAssetId:input.id}]}]);await service.remove(guest(b.token),input.id);await assert.rejects(service.commit(guest(b.token),payload),{code:'CANVAS_ASSET_UNAVAILABLE'});
  assert.deepEqual((await service.bytes(owner(b.bookId),input.id,'original')).bytes,jpeg);await pool.query('UPDATE pages SET canvas_json=$2 WHERE id=$1',[b.pageId,{objects:[{type:'IText',text:'Csak üzenet'}]}]);assert.equal((await service.commit(guest(b.token),payload)).state,'committed');
  for(const bookType of ['standard','dedication']){const old=await seedCollectionPage(pool,{bookType});await assert.rejects(service.bootstrap(guest(old.token)),{code:'INVITE_NOT_FOUND'});assert.equal((await pool.query('SELECT invite_status FROM pages WHERE id=$1',[old.pageId])).rows[0].invite_status,'draft');}
  const main=await readFile(new URL('../server/index.ts',import.meta.url),'utf8');const submit=main.slice(main.indexOf("app.post('/api/page-invites/:token/submit'"),main.indexOf("app.get('/api/health'"));assert.match(submit,/collection_groups WHERE page_id/);assert.match(submit,/COLLECTION_COMMIT_REQUIRED/);
});

test('owner sees text/drawing-only autosaved drafts without a GET creating collection state',async()=>{
  const b=await seedCollectionPage(pool),before=(await pool.query('SELECT updated_at,invite_created_at,canvas_json FROM pages WHERE id=$1',[b.pageId])).rows[0];
  const list=await service.ownerList(owner(b.bookId)),draft=list.sessions.find(s=>s.groupId===b.pageId)!;assert.equal(draft.state,'draft');assert.equal(draft.submissionId,null);assert.equal(draft.committedAt,null);assert.equal(draft.createdAt,before.invite_created_at.toISOString());assert.deepEqual(draft.files,[]);assert.deepEqual(draft.canvasData,before.canvas_json);
  assert.equal((await pool.query('SELECT count(*)::int n FROM collection_groups WHERE page_id=$1',[b.pageId])).rows[0].n,0);assert.deepEqual((await pool.query('SELECT updated_at FROM pages WHERE id=$1',[b.pageId])).rows[0].updated_at,before.updated_at);
});

test('quota reservations, same-device counts across invitations and removed-original accounting are atomic',async()=>{
  const b=await seedCollectionPage(pool),other=await seedCollectionPage(pool,{bookId:b.bookId,device:b.device}),limited=createCollectionService(pool,{...limits,photo:{...limits.photo,maxCount:1},bookBytes:jpeg.length+1});const input=fileInput();await limited.begin(guest(b.token),input);
  await assert.rejects(limited.begin(guest(other.token),fileInput()),{code:'FILE_COUNT_LIMIT'});await limited.remove(guest(b.token),input.id);const replacement=fileInput();assert.equal((await limited.begin(guest(other.token),replacement)).file.state,'uploading');
  await limited.chunk(guest(other.token),replacement.id,0,jpeg);await limited.remove(guest(other.token),replacement.id);await assert.rejects(limited.begin(guest(b.token),fileInput()),{code:'STORAGE_QUOTA'});
  const parallel=await seedCollectionPage(pool),two=createCollectionService(pool,{...limits,photo:{...limits.photo,maxCount:1}});const results=await Promise.allSettled([two.begin(guest(parallel.token),fileInput()),two.begin(guest(parallel.token),fileInput())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await pool.query('SELECT count(*)::int n FROM collection_files WHERE book_id=$1',[parallel.bookId])).rows[0].n,1);
  const partial=await seedCollectionPage(pool),partialBytes=Buffer.alloc(limits.chunkBytes+1000,3),bounded=createCollectionService(pool,{...limits,bookBytes:partialBytes.length+10}),first=fileInput(partialBytes);await bounded.begin(guest(partial.token),first);await bounded.chunk(guest(partial.token),first.id,0,partialBytes.subarray(0,limits.chunkBytes));await bounded.remove(guest(partial.token),first.id);
  await bounded.begin(guest(partial.token),fileInput(Buffer.alloc(1000)));await assert.rejects(bounded.begin(guest(partial.token),fileInput(Buffer.alloc(11))),{code:'STORAGE_QUOTA'});assert.equal((await pool.query('SELECT octet_length(bytes) n FROM collection_chunks WHERE file_id=$1',[first.id])).rows[0].n,limits.chunkBytes);
});

test('processing failures/restart are visible, lease fencing and owner retry preserve exact original and local capture time',async()=>{
  const b=await seedCollectionPage(pool),input=fileInput();await service.begin(guest(b.token),input);await service.chunk(guest(b.token),input.id,0,jpeg);const broken=createCollectionService(pool,limits,async()=>{throw new Error('DECODER_UNAVAILABLE');});await assert.rejects(broken.complete(guest(b.token),input.id),{code:'DECODER_UNAVAILABLE'});assert.equal((await service.status(guest(b.token),input.id)).file.state,'failed');
  await pool.query("UPDATE collection_files SET state='processing',lease_token=$2,lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[input.id,randomUUID()]);const before=(await pool.query('SELECT updated_at FROM collection_files WHERE id=$1',[input.id])).rows[0].updated_at;assert.equal((await service.status(guest(b.token),input.id)).file.state,'failed');assert.deepEqual((await pool.query('SELECT updated_at FROM collection_files WHERE id=$1',[input.id])).rows[0].updated_at,before);
  const decoder=createCollectionService(pool,limits,async()=>({mimeType:'image/jpeg',width:80,height:60,durationSeconds:null,capturedAt:'2026-11-26T10:11:12',captureTimeSource:'exif.DateTimeOriginal.local-timezone-unknown',preview:jpeg,playback:null,playbackMimeType:null}));const recovered=await decoder.complete(owner(b.bookId),input.id);assert.equal(recovered.file.state,'ready');assert.equal(recovered.file.captureTime,'2026-11-26T10:11:12');assert.deepEqual((await service.bytes(owner(b.bookId),input.id,'original')).bytes,jpeg);await migrateCollection(pool);
});

test('an expired processor cannot overwrite a newer successful retry or charge derivatives twice',async()=>{
  const b=await seedCollectionPage(pool),input=fileInput(),boundedLimits={...limits,bookBytes:jpeg.length*2};let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{finish=r;});
  const old=createCollectionService(pool,boundedLimits,async()=>{entered();await gate;return{mimeType:'image/jpeg',width:80,height:60,durationSeconds:null,capturedAt:null,captureTimeSource:null,preview:jpeg,playback:null,playbackMimeType:null};});
  const newer=createCollectionService(pool,boundedLimits,async()=>({mimeType:'image/jpeg',width:80,height:60,durationSeconds:null,capturedAt:null,captureTimeSource:null,preview:jpeg,playback:null,playbackMimeType:null}));
  await old.begin(guest(b.token),input);await old.chunk(guest(b.token),input.id,0,jpeg);const pending=old.complete(guest(b.token),input.id);await started;
  await assert.rejects(newer.complete(owner(b.bookId),input.id),{code:'PROCESSING_BUSY'});await pool.query("UPDATE collection_files SET lease_until=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[input.id]);
  assert.equal((await newer.complete(owner(b.bookId),input.id)).file.state,'ready');finish();await assert.rejects(pending,{code:'PROCESSING_INTERRUPTED'});assert.equal((await newer.complete(owner(b.bookId),input.id)).file.state,'ready');assert.deepEqual((await newer.bytes(owner(b.bookId),input.id,'original')).bytes,jpeg);
  await assert.rejects(newer.begin(guest(b.token),fileInput(Buffer.from('x'))),{code:'STORAGE_QUOTA'});
});
