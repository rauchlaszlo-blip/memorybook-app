import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import express from 'express';
import {Pool} from 'pg';
import sharp from 'sharp';
import {migrateWedding} from '../server/wedding/migrate';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {createPilotMediaDiagnostics} from '../server/pilot/media-diagnostics';
import {createAppTrialAccess,appTrialCookieName} from '../server/pilot/app-trial';
import {createClientMediaDiagnostics} from '../server/pilot/client-media-diagnostics';

test('pilot diagnostic reads metadata only with exact owner and explicit scope; trial cannot widen it',async()=>{
  const connectionString=localDatabaseUrl(),schema='diagnostic_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);await migrateWedding(pool);
  const id=randomUUID(),foreign=randomUUID(),ordinary=randomUUID(),mediaId=randomUUID(),key=randomBytes(32).toString('base64url');
  const env={MEMORYBOOK_MCP_ALLOWED_BOOK_IDS:[id,foreign,ordinary].join(','),PILOT_APP_TRIAL_GRANT:JSON.stringify({bookId:id,ownerId:'owner',expectedTitle:'Fiktív diagnosztika',tokenHash:createHash('sha256').update(key).digest('hex'),authorizedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()})};
  for(const [bookId,owner,title] of [[id,'owner','Fiktív diagnosztika'],[foreign,'foreign','Fiktív idegen'],[ordinary,'owner','Nem tesztanyag']])
    await pool.query("INSERT INTO event_books(id,owner_user_id,product,event_type,title,template_id,template_version,invite_token) VALUES($1,$2,'celebration','wedding',$3,'wedding-classic',1,$4)",[bookId,owner,title,randomBytes(32).toString('base64url')]);
  const original=await sharp({create:{width:20,height:30,channels:3,background:'red'}}).jpeg().toBuffer();
  await pool.query(`INSERT INTO event_media(id,book_id,upload_key,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size,expires_at)
    VALUES($1,$2,$3,'image/jpeg',$4,$5,20,30,'uploaded',$6,$6,$6,$7,CURRENT_TIMESTAMP+interval '1 hour')`,[mediaId,id,randomUUID(),original.length,createHash('sha256').update(original).digest('hex'),original,3*original.length]);
  const submissionId=randomUUID();await pool.query("INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message) VALUES($1,$2,$3,'NEVER_PRINT_NAME','NEVER_PRINT_MESSAGE')",[submissionId,id,randomUUID()]);
  const app=express(),trial=createAppTrialAccess(pool,'https://pilot.onrender.com',env);app.use(trial.router);
  const logged:unknown[]=[];app.use(createClientMediaDiagnostics(pool,'https://pilot.onrender.com',value=>logged.push(value)));
  app.use(createPilotMediaDiagnostics(pool,async req=>req.get('x-owner')?{user:{id:req.get('x-owner')!}}:null,env));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
  const path=(bookId=id)=>'/api/pilot/books/'+bookId+'/media-diagnostics';
  try{
    assert.equal((await fetch(base+path())).status,401);
    assert.equal((await fetch(base+path(foreign),{headers:{'x-owner':'owner'}})).status,404);
    assert.equal((await fetch(base+path(ordinary),{headers:{'x-owner':'owner'}})).status,404);
    assert.equal((await fetch(base+path(),{headers:{'x-owner':'owner',cookie:appTrialCookieName+'='+key}})).status,404);
    const response=await fetch(base+path(),{headers:{'x-owner':'owner'}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);
    const data=await response.json();assert.equal(data.media.length,1);assert.equal(data.media[0].id,mediaId);assert.equal(data.media[0].owner_visible,false);assert.equal(data.media[0].signature,'jpeg');assert.equal(data.media[0].original_size_matches,true);assert.equal(data.usage.unattached,1);assert.equal(data.usage.bytes,3*original.length);
    assert.equal(data.submissions[0].id,submissionId);assert.equal(data.submissions[0].media_count,0);
    assert.doesNotMatch(JSON.stringify(data),/NEVER_PRINT|invite_token|upload_key|guest_device_id|original_bytes|preview_bytes|display_bytes/);
    assert.equal(data.media[0].original_hash_matches,true);
    const invite=(await pool.query('SELECT invite_token FROM event_books WHERE id=$1',[id])).rows[0].invite_token;
    const clientPath=base+'/api/wedding/guest/'+invite+'/media-diagnostics',guestCookie='memorybook-guest-device='+randomBytes(32).toString('base64url');
    const observation={diagnosticId:randomUUID(),stage:'selection',kind:'photo',source:'gallery',mimeType:'image/heic',byteLength:3000,errorCode:'CLIENT_PHOTO_TYPE'};
    const observe=(body:unknown,cookie=guestCookie,origin='https://pilot.onrender.com')=>fetch(clientPath,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});
    assert.equal((await observe(observation,'')).status,428);assert.equal((await observe(observation,guestCookie,'https://wrong.example')).status,403);
    assert.equal((await observe({...observation,filename:'NEVER_PRINT_FILE'})).status,400);assert.equal((await observe({...observation,errorCode:'NEVER_PRINT_RAW_ERROR'})).status,400);
    assert.equal((await observe(observation)).status,202);assert.equal((await observe(observation)).status,202);assert.equal(logged.length,1);
    assert.doesNotMatch(JSON.stringify(logged),new RegExp(invite+'|'+guestCookie.split('=')[1]+'|NEVER_PRINT|guest_device_id|filename'));
    for(let index=0;index<9;index++)assert.equal((await observe({...observation,diagnosticId:randomUUID(),mimeType:'image/SECRET_NONSTANDARD'})).status,202);
    assert.equal((logged[1] as {mimeType:string}).mimeType,'unknown');assert.equal((await observe({...observation,diagnosticId:randomUUID()})).status,429);
    env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS='';assert.equal((await fetch(base+path(),{headers:{'x-owner':'owner'}})).status,404);
    assert.deepEqual((await pool.query('SELECT original_bytes FROM event_media WHERE id=$1',[mediaId])).rows[0].original_bytes,original);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
