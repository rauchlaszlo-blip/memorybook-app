import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import sharp from 'sharp';
import { createWeddingRouter } from '../server/wedding/router';
import { cleanupMedia, decodePhoto, mediaLimits } from '../server/wedding/media';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { emptyAnnotation, parseAnnotation } from '../shared/photo-annotation';
const connectionString=localDatabaseUrl();
const schema='photo_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString});
let pool:Pool;
let server:Server;
let base='';
let jpeg:Buffer,png:Buffer;
const limits=mediaLimits();
const env={NODE_ENV:'test',WEDDING_ENABLED:'true',WEDDING_PILOT_CREATE_ENABLED:'true',WEDDING_PILOT_USER_IDS:'a,b'};
async function start(config=limits) {
  const app=express();app.use(createWeddingRouter({pool,env,media:config,getSession:async req=>req.get('x-owner')?{user:{id:req.get('x-owner')!}}:null}));
  const srv=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>srv.once('listening',resolve));
  const address=srv.address();assert.ok(address && typeof address!=='string');return {srv,url:'http://127.0.0.1:'+address.port};
}
async function call(path:string,body?:unknown,owner?:string,url=base) {
  return fetch(url+path,{method:body===undefined?'GET':'POST',headers:{...(owner?{'x-owner':owner}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function book(owner='a') {const r=await call('/books',{names:'Fotópróba – fiktív',date:'2027-06-05'},owner);assert.equal(r.status,201);return (await r.json()).book;}
async function upload(b:{invite_token:string},key=randomUUID(),bytes=jpeg,url=base) {
  return fetch(url+'/guest/'+b.invite_token+'/media/'+key,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes)});
}
const wish=(key:string,mediaId?:string)=>({name:'Fiktív Éva',message:'Árvíztűrő jókívánság!',idempotencyKey:key,...(mediaId?{mediaId}:{})});
before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString,options:`-c search_path=${schema}`});await migrateWedding(pool);
  jpeg=await sharp({create:{width:80,height:40,channels:3,background:'#de6856'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  png=await sharp({create:{width:40,height:80,channels:4,background:'#5566aa80'}}).png().toBuffer();
  const started=await start();server=started.srv;base=started.url;
});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();});
test('photo + text; exact original checksum; EXIF rotation; protected preview/display/original; text alone',async()=>{
  const b=await book();const key=randomUUID();const result=await upload(b,key);assert.equal(result.status,201);const {mediaId}=await result.json();
  // Pending images are not exposed, even to the owner.
  assert.equal((await call('/media/'+mediaId+'/original',undefined,'a')).status,404);
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(key,mediaId))).status,201);
  const list=await (await call('/books/'+b.id,undefined,'a')).json();assert.equal(list.submissions[0].media[0].id,mediaId);
  for(const variant of ['original','preview','display']){
    assert.equal((await call(`/media/${mediaId}/${variant}`)).status,401);
    assert.equal((await call(`/media/${mediaId}/${variant}`,undefined,'b')).status,404);
    const image=await call(`/media/${mediaId}/${variant}`,undefined,'a');assert.equal(image.status,200);assert.match(image.headers.get('cache-control')!,/no-store/);
    const bytes=Buffer.from(await image.arrayBuffer());
    if(variant==='original')assert.deepEqual(bytes,jpeg);
    else {const meta=await sharp(bytes).metadata();assert.equal(meta.width,40);assert.equal(meta.height,80);assert.equal(meta.orientation,undefined);}
  }
  const stored=await pool.query('SELECT sha256,state FROM event_media WHERE id=$1',[mediaId]);assert.equal(stored.rows[0].sha256,createHash('sha256').update(jpeg).digest('hex'));assert.equal(stored.rows[0].state,'attached');
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(randomUUID()))).status,201);
  const photoKey=randomUUID();const photo=(await (await upload(b,photoKey,png)).json()).mediaId;
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(photoKey,photo))).status,201);
});
test('invalid type, HEIC signature, corrupt JPEG, truncated PNG, byte limit and pixel limit',async()=>{
  const b=await book();
  for(const input of [Buffer.from('<svg/>'),Buffer.from('0000ftypheic0000')])assert.equal((await upload(b,randomUUID(),input)).status,415);
  assert.equal((await upload(b,randomUUID(),Buffer.from([255,216,255,0,1]))).status,400);
  assert.equal((await upload(b,randomUUID(),png.subarray(0,png.length-20))).status,400);
  assert.equal((await upload(b,randomUUID(),Buffer.alloc(limits.maxBytes+1))).status,413);
  await assert.rejects(decodePhoto(jpeg,{...limits,maxPixels:100}),{code:'PHOTO_PIXELS'});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,0);
});
test('book and global quotas reject without storing images',async()=>{
  for(const config of [{...limits,bookBytes:1},{...limits,totalBytes:1}]){
    const scoped=await start(config);try{assert.equal((await upload(await book(),randomUUID(),jpeg,scoped.url)).status,413);}finally{await new Promise<void>(r=>scoped.srv.close(()=>r()));}
  }
});
test('parallel upload and replay after lost response do not duplicate storage or submissions',async()=>{
  const b=await book();const key=randomUUID();const results=await Promise.all([upload(b,key),upload(b,key)]);
  assert.ok(results.every(r=>[200,201].includes(r.status)));
  const ids=await Promise.all(results.map(r=>r.json()));assert.equal(ids[0].mediaId,ids[1].mediaId);
  assert.equal((await upload(b,key,png)).status,409);
  const data=wish(key,ids[0].mediaId);
  const sent=await Promise.all([call('/guest/'+b.invite_token+'/submissions',data),call('/guest/'+b.invite_token+'/submissions',data)]);
  assert.deepEqual(sent.map(r=>r.status).sort(),[200,201]);
  assert.equal((await upload(b,key)).status,200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,1);
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(key))).status,409);
});
test('interrupted binary request creates no complete image; retry works',async()=>{
  const b=await book(),key=randomUUID();
  await new Promise<void>(resolve=>{
    const req=request(base+'/guest/'+b.invite_token+'/media/'+key,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':jpeg.length}},()=>resolve());
    req.on('error',()=>resolve());req.write(jpeg.subarray(0,30));setTimeout(()=>{req.destroy();resolve();},50);
  });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,0);
  assert.equal((await upload(b,key)).status,201);
});
test('close during upload/finalize; foreign book/key; expiry cleanup preserves attached images',async()=>{
  const b=await book(),other=await book('b'),key=randomUUID();const {mediaId}=await (await upload(b,key)).json();
  assert.equal((await call('/guest/'+other.invite_token+'/submissions',wish(key,mediaId))).status,409);
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(randomUUID(),mediaId))).status,409);
  await call('/books/'+b.id+'/close',{},'a');
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',wish(key,mediaId))).status,410);
  assert.equal((await upload(b)).status,410);
  await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[mediaId]);
  const attachedBefore=(await pool.query("SELECT count(*)::int AS n FROM event_media WHERE state='attached'")).rows[0].n;
  await cleanupMedia(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media WHERE id=$1',[mediaId])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM event_media WHERE state='attached'")).rows[0].n,attachedBefore);
  const open=await book(),k=randomUUID(),id=(await (await upload(open,k)).json()).mediaId;
  await pool.query("UPDATE event_media SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[id]);
  assert.equal((await call('/guest/'+open.invite_token+'/submissions',wish(k,id))).status,409);
});
test('server and DB connection restart preserve original and photo association',async()=>{
  const b=await book(),key=randomUUID(),{mediaId}=await (await upload(b,key)).json();await call('/guest/'+b.invite_token+'/submissions',wish(key,mediaId));
  await new Promise<void>(r=>server.close(()=>r()));await pool.end();pool=new Pool({connectionString,options:`-c search_path=${schema}`});
  await migrateWedding(pool);const started=await start();server=started.srv;base=started.url;
  const original=await call('/media/'+mediaId+'/original',undefined,'a');assert.deepEqual(Buffer.from(await original.arrayBuffer()),jpeg);
  const detail=await (await call('/books/'+b.id,undefined,'a')).json();assert.equal(detail.submissions[0].media[0].id,mediaId);
});

test('closure holding the book lock rejects an in-flight upload without persisting it',async()=>{
  const b=await book();const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('UPDATE event_books SET closed_at=CURRENT_TIMESTAMP WHERE id=$1',[b.id]);
    const pending=upload(b);
    await new Promise(resolve=>setTimeout(resolve,50));await client.query('COMMIT');
    assert.equal((await pending).status,410);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media WHERE book_id=$1',[b.id])).rows[0].n,0);
  }finally{await client.query('ROLLBACK');client.release();}
});

test('annotation commits with photo, original unchanged, private layer/composite, exact replay and foreign-book denial',async()=>{
  const b=await book(),k=randomUUID(),id=(await (await upload(b,k)).json()).mediaId;
  const layer=parseAnnotation({...emptyAnnotation(),strokes:[{color:'#d62828',width:0.014,points:[[0.1,0.5],[0.9,0.5]]}]});
  const body={...wish(k,id),annotation:layer};
  const other=await book('b');assert.equal((await call('/guest/'+other.invite_token+'/submissions',body)).status,409);
  const results=await Promise.all([call('/guest/'+b.invite_token+'/submissions',body),call('/guest/'+b.invite_token+'/submissions',body)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_media_annotations WHERE media_id=$1',[id])).rows[0].n,1);
  for(const variant of ['annotation','preview','display','original']){
    assert.equal((await call(`/media/${id}/${variant}`)).status,401);assert.equal((await call(`/media/${id}/${variant}`,undefined,'b')).status,404);
    const result=await call(`/media/${id}/${variant}`,undefined,'a');assert.equal(result.status,200);
    if(variant==='annotation')assert.deepEqual(await result.json(),layer);
    if(variant==='original')assert.deepEqual(Buffer.from(await result.arrayBuffer()),jpeg);
  }
  const display=Buffer.from(await (await call(`/media/${id}/display`,undefined,'a')).arrayBuffer());
  const base=(await pool.query('SELECT display_bytes FROM event_media WHERE id=$1',[id])).rows[0].display_bytes;
  assert.notDeepEqual(display,base);
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...body,annotation:{...layer,strokes:[]}})).status,409);
  await migrateWedding(pool);assert.deepEqual(await (await call(`/media/${id}/annotation`,undefined,'a')).json(),layer);
});

test('invalid annotation structure, external resources, limits, missing photo, closed book rejected',async()=>{
  const b=await book(),k=randomUUID(),id=(await (await upload(b,k)).json()).mediaId;
  for(const annotation of [{...emptyAnnotation(),version:2},{...emptyAnnotation(),url:'https://example.test/a.svg'},
    {...emptyAnnotation(),strokes:[{color:'url(https://evil.test)',width:0.007,points:[[0,0]]}]},
    {...emptyAnnotation(),strokes:[{color:'#000000',width:0.007,points:[[1.1,0]]}]},
    {...emptyAnnotation(),strokes:[{color:'#000000',width:0.007,points:Array.from({length:10001},()=>[0,0])}]},
    {...emptyAnnotation(),strokes:Array.from({length:201},()=>({color:'#000000',width:0.007,points:[[0,0]]}))}]){
    assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...wish(k,id),annotation})).status,400);
  }
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...wish(k,id),annotation:{...emptyAnnotation(),junk:'x'.repeat(350000)}})).status,413);
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...wish(k),annotation:emptyAnnotation()})).status,400);
  await call('/books/'+b.id+'/close',{},'a');
  assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...wish(k,id),annotation:emptyAnnotation()})).status,410);
  assert.equal((await pool.query('SELECT count(*)::int n FROM event_media_annotations WHERE media_id=$1',[id])).rows[0].n,0);
});

test('annotation quota failure rolls back complete submission and preserves pending original for retry',async()=>{
  const b=await book(),k=randomUUID(),id=(await (await upload(b,k)).json()).mediaId;
  const size=(await pool.query('SELECT stored_size FROM event_media WHERE id=$1',[id])).rows[0].stored_size;
  const scoped=await start({...limits,bookBytes:size});
  try{
    const body={...wish(k,id),annotation:{...emptyAnnotation(),strokes:[{color:'#000000',width:0.007,points:[[0,0],[1,1]]}]}};
    assert.equal((await call('/guest/'+b.invite_token+'/submissions',body,undefined,scoped.url)).status,413);
    assert.equal((await pool.query('SELECT count(*)::int n FROM event_submissions WHERE book_id=$1',[b.id])).rows[0].n,0);
    assert.equal((await pool.query('SELECT state FROM event_media WHERE id=$1',[id])).rows[0].state,'uploaded');
    assert.equal((await call('/guest/'+b.invite_token+'/submissions',body)).status,201);
  }finally{await new Promise<void>(r=>scoped.srv.close(()=>r()));}
});

test('oriented portrait and landscape composites put ink at the same normalized position in preview and display',async()=>{
  for(const orientation of [1,6]){
    const bytes=await sharp({create:{width:1000,height:500,channels:3,background:'#cccccc'}}).jpeg().withMetadata({orientation}).toBuffer();
    const b=await book(),k=randomUUID(),id=(await (await upload(b,k,bytes)).json()).mediaId;
    const layer={...emptyAnnotation(),strokes:[{color:'#d62828',width:0.014,points:[[0.1,0.5],[0.9,0.5]]}]};
    assert.equal((await call('/guest/'+b.invite_token+'/submissions',{...wish(k,id),annotation:layer})).status,201);
    for(const variant of ['display','preview']){
      const bytes=Buffer.from(await (await call(`/media/${id}/${variant}`,undefined,'a')).arrayBuffer());
      const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(info.width>info.height,orientation===1);
      const center=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;
      assert.ok(data[center]>data[center+1]+70,'red ink must cross image center');
      const corner=(Math.floor(info.height*.1)*info.width+Math.floor(info.width*.1))*info.channels;
      assert.ok(Math.abs(data[corner]-data[corner+1])<10,'unmarked corner remains gray');
    }
  }
});
