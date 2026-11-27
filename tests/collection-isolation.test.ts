import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import sharp from 'sharp';
import {collectionDatabaseConfig,collectionDatabaseState,collectionPublicSnapshot,initializeCollectionDatabase,collectionPilotSchema,collectionPilotBook} from '../server/collection/database-isolation';

test('dedicated pilot configuration fails closed and leaves ordinary main connection settings unchanged',()=>{
 const token=randomBytes(32).toString('base64url'),env={DATABASE_URL:'postgresql://local:fake@localhost/test?options=-c%20search_path%3Dpublic',COLLECTION_PILOT_ENABLED:'yes',COLLECTION_DATABASE_SCHEMA:collectionPilotSchema,COLLECTION_PILOT_GUEST_TOKEN:token};
 assert.deepEqual(collectionDatabaseConfig({DATABASE_URL:'postgresql://localhost/normal'}),{connectionString:'postgresql://localhost/normal'});
 assert.throws(()=>collectionDatabaseConfig({...env,COLLECTION_DATABASE_SCHEMA:undefined}),/SCHEMA_REQUIRED/);assert.throws(()=>collectionDatabaseConfig({...env,COLLECTION_DATABASE_SCHEMA:'public'}),/SCHEMA_REQUIRED/);assert.throws(()=>collectionDatabaseConfig({...env,COLLECTION_DATABASE_SCHEMA:'a,public'}),/SCHEMA_REQUIRED/);assert.throws(()=>collectionDatabaseConfig({...env,COLLECTION_PILOT_ENABLED:undefined}),/REQUIRES_PILOT/);assert.throws(()=>collectionDatabaseConfig({...env,COLLECTION_PILOT_GUEST_TOKEN:''}),/GUEST_TOKEN_REQUIRED/);
 const config=collectionDatabaseConfig(env);assert.equal(config.max,3);assert.equal(new URL(config.connectionString!).searchParams.get('options'),'-c search_path='+collectionPilotSchema+' -c default_transaction_read_only=off');
});

test('pilot connection overrides inherited database read-only default without changing old public bytes or other connections',{timeout:30000},async()=>{
 const connection=process.env.DATABASE_URL||'postgresql://memorybook_test@127.0.0.1:5432/memorybook_wedding_test',url=new URL(connection);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||process.env.WEDDING_LOCAL_DATABASE_ACK!=='yes')throw new Error('Local acknowledged test database required');
 const name='memorybook_readonly_'+randomUUID().replaceAll('-','')+'_test',admin=new Pool({connectionString:connection});assert.match(name,/^memorybook_readonly_[a-f0-9]{32}_test$/);
 await admin.query(`CREATE DATABASE "${name}"`);url.pathname='/'+name;url.searchParams.delete('options');const setup=new Pool({connectionString:url.toString()});let ordinary:Pool|undefined,pilot:Pool|undefined;
 try{
  await setup.query('CREATE TABLE public.preserved_originals(id TEXT PRIMARY KEY,original_bytes BYTEA)');await setup.query('INSERT INTO public.preserved_originals VALUES($1,$2)',['fictional-original',Buffer.from('Unchanged original bytes')]);
  // Only this disposable database receives a synthetic inherited setting. The
  // application under test never alters database/role defaults.
  await admin.query(`ALTER DATABASE "${name}" SET default_transaction_read_only=on`);await setup.end();
  ordinary=new Pool({connectionString:url.toString(),max:1});const inherited=await collectionDatabaseState(ordinary);assert.equal(inherited.defaultReadOnly,'on');assert.equal(inherited.transactionReadOnly,'on');assert.equal(inherited.defaultSource,'database');assert.equal(inherited.inRecovery,false);
  const env={DATABASE_URL:url.toString(),COLLECTION_PILOT_ENABLED:'yes',COLLECTION_DATABASE_SCHEMA:collectionPilotSchema,COLLECTION_PILOT_GUEST_TOKEN:randomBytes(32).toString('base64url')};pilot=new Pool(collectionDatabaseConfig(env));
  const before=await collectionPublicSnapshot(pilot,env);await initializeCollectionDatabase(pilot,env);await pilot.query('CREATE TABLE collection_writable_probe(id INTEGER PRIMARY KEY)');await pilot.query('INSERT INTO collection_writable_probe VALUES(1)');assert.equal((await pilot.query('SELECT count(*)::int n FROM collection_writable_probe')).rows[0].n,1);
  const clients=await Promise.all([pilot.connect(),pilot.connect(),pilot.connect()]);try{for(const client of clients){const state=await collectionDatabaseState(client);assert.equal(state.defaultReadOnly,'off');assert.equal(state.transactionReadOnly,'off');await client.query('BEGIN READ ONLY');assert.equal((await collectionDatabaseState(client)).transactionReadOnly,'on');await assert.rejects(client.query('INSERT INTO collection_writable_probe VALUES(2)'),{code:'25006'});await client.query('ROLLBACK');}}finally{for(const client of clients)client.release();}
  assert.deepEqual(await collectionPublicSnapshot(pilot,env),before);assert.equal((await collectionDatabaseState(ordinary)).defaultReadOnly,'on');assert.equal((await collectionDatabaseState(ordinary)).transactionReadOnly,'on');await assert.rejects(ordinary.query('CREATE TABLE public.must_not_exist(id INTEGER)'),{code:'25006'});
  const setting=(await admin.query('SELECT setconfig FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=$1) AND setrole=0',[name])).rows[0].setconfig;assert.ok(setting.includes('default_transaction_read_only=on'));
 }finally{if(pilot)await pilot.end();if(ordinary)await ordinary.end();if(!ordinary)await setup.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
});

test('actual isolated startup and auth preserve public sentinel bytes and never overwrite pilot data on restart',{timeout:60000},async()=>{
 const connection=process.env.DATABASE_URL||'postgresql://memorybook_test@127.0.0.1:5432/memorybook_wedding_test',url=new URL(connection);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||process.env.WEDDING_LOCAL_DATABASE_ACK!=='yes')throw new Error('Local acknowledged test database required');
 const database='memorybook_isolation_'+randomUUID().replaceAll('-','')+'_test',admin=new Pool({connectionString:connection});
 assert.match(database,/^memorybook_isolation_[a-f0-9]{32}_test$/);await admin.query(`CREATE DATABASE "${database}"`);url.pathname='/'+database;url.searchParams.delete('options');
 const baseline=new Pool({connectionString:url.toString()}),token=randomBytes(32).toString('base64url'),env={NODE_ENV:'test',DATABASE_URL:url.toString(),COLLECTION_PILOT_ENABLED:'yes',COLLECTION_DATABASE_SCHEMA:collectionPilotSchema,COLLECTION_PILOT_GUEST_TOKEN:token};
 const trialKey=randomBytes(32).toString('base64url'),grant={bookId:collectionPilotBook.id,ownerId:collectionPilotBook.ownerId,title:collectionPilotBook.title,expiresAt:new Date(Date.now()+86400000).toISOString(),tokenHash:createHash('sha256').update(trialKey).digest('hex')};
 const isolated=new Pool(collectionDatabaseConfig(env)),tables=['users','books','pages','event_books','event_media','auth_sessions','auth_accounts','auth_verifications'];let child:ChildProcess|undefined;
 const fingerprint=async()=>{const rows=[];for(const table of tables)rows.push([table,(await baseline.query(`SELECT * FROM public.${table} ORDER BY id`)).rows]);return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
 async function stop(){if(child&&child.exitCode===null){const ended=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill();await ended;}child=undefined;}
 async function start(){const reserve=createServer();await new Promise<void>(r=>reserve.listen(0,'127.0.0.1',r));const address=reserve.address();assert.ok(address&&typeof address!=='string');const port=address.port;await new Promise<void>(r=>reserve.close(()=>r()));const origin='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,...env,PORT:String(port),PGOPTIONS:'-c search_path=public',PUBLIC_APP_URL:origin,BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:randomUUID()+randomUUID(),COLLECTION_PILOT_TRIAL:JSON.stringify(grant),GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',CLOUDINARY_CLOUD_NAME:'',CLOUDINARY_API_KEY:'',CLOUDINARY_API_SECRET:''},stdio:['ignore','ignore','ignore']});
  let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('ISOLATED_LOCAL_STARTUP_FAILED');try{if((await fetch(origin+'/api/health')).status===200){ready=true;break;}}catch{/* startup */}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);return origin;
 }
 try{
  for(const table of tables){await baseline.query(`CREATE TABLE public.${table}(id TEXT PRIMARY KEY,payload JSONB,original_bytes BYTEA)`);await baseline.query(`INSERT INTO public.${table} VALUES($1,$2,$3)`,['sentinel-'+table,{keep:'Fiktív változatlan adat',table},Buffer.from('unchanged-original-'+table)]);}
  const before=await fingerprint();await assert.rejects(initializeCollectionDatabase(baseline,env),/NOT_ISOLATED/);assert.equal((await baseline.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=$1',[collectionPilotSchema])).rows[0].n,0);
  const origin=await start(),context=(await isolated.query('SELECT current_schema() AS selected,current_schemas(false)::text[] AS path')).rows[0];assert.equal(context.selected,collectionPilotSchema);assert.deepEqual(context.path,[collectionPilotSchema]);
  const seeded=(await isolated.query('SELECT owner_user_id,title,invite_token FROM books WHERE id=$1',[collectionPilotBook.id])).rows[0];assert.equal(seeded.owner_user_id,collectionPilotBook.ownerId);assert.equal(seeded.title,collectionPilotBook.title);assert.equal(seeded.invite_token,token);
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Fiktív izolációs próba',email:'isolation-'+randomUUID()+'@example.invalid',password:'Local-'+randomUUID()})});assert.equal(signup.status,200);const user=(await signup.json()).user;assert.equal((await isolated.query('SELECT count(*)::int n FROM users WHERE id=$1',[user.id])).rows[0].n,1);assert.equal((await isolated.query('SELECT count(*)::int n FROM auth_sessions')).rows[0].n,1);
  const call=(path:string,body?:unknown,method='POST',cookie?:string)=>fetch(origin+path,{method:body===undefined?'GET':method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const redeem=await call('/api/pilot/collection-trial/redeem',{key:trialKey});assert.equal(redeem.status,200);const cookie=redeem.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookie);
  const created=await call(`/api/invites/${token}/page-session`,{deviceId:randomUUID(),guestData:{name:'Fiktív adatbázis-előnézet'}});assert.equal(created.status,201);const page=await created.json(),guest='/api/page-invites/'+page.inviteToken,collection='/api/collection/invites/'+page.inviteToken;
  const jpeg=await sharp({create:{width:80,height:50,channels:3,background:'#789abc'}}).jpeg().toBuffer(),previewDataUrl='data:image/jpeg;base64,'+jpeg.toString('base64'),canvasData={objects:[{type:'IText',text:'Fiktív szöveg és rajz'},{type:'Path',path:[['M',10,10],['L',20,20]]}]};
  const saved=await call(guest,{canvasData,previewDataUrl,expectedVersion:1},'PUT',cookie);assert.equal(saved.status,200);const ack=await saved.json();assert.equal(ack.newVersion,2);assert.equal(ack.previewImageUrl,collection+'/page-preview');
  assert.deepEqual(Buffer.from(await (await call(ack.previewImageUrl,undefined,'GET',cookie)).arrayBuffer()),jpeg);
  const stale=await call(guest,{canvasData:{objects:[]},previewDataUrl,expectedVersion:1},'PUT',cookie);assert.equal(stale.status,409);assert.equal((await isolated.query('SELECT version FROM pages WHERE id=$1',[page.pageId])).rows[0].version,2);
  const ownerPath=`/api/my/books/${collectionPilotBook.id}/collection`,list=await call(ownerPath,undefined,'GET',cookie);assert.equal(list.status,200);const draft=(await list.json()).sessions.find((s:{groupId:string})=>s.groupId===page.pageId);assert.equal(draft.state,'draft');assert.ok(draft.previewUrl);assert.equal((await call(draft.previewUrl)).status,401);assert.equal((await call(ownerPath,undefined,'GET',cookie+'x')).status,404);assert.equal((await call('/api/my/books',undefined,'GET',cookie)).status,404);
  assert.deepEqual(Buffer.from(await (await call(draft.previewUrl,undefined,'GET',cookie)).arrayBuffer()),jpeg);
  const beforeSize=(await isolated.query('SELECT stored_size FROM collection_groups WHERE page_id=$1',[page.pageId])).rows[0].stored_size;
  const commit={key:randomUUID(),expectedVersion:2,eventIds:[],locationIds:[],authorShareApproved:false};const committed=await call(collection+'/commit',commit,'POST',cookie);assert.equal(committed.status,200);assert.equal((await committed.json()).state,'committed');assert.equal((await call(collection+'/commit',commit,'POST',cookie)).status,200);
  const frozen=(await isolated.query('SELECT canvas_json,preview_bytes,stored_size,state FROM collection_groups WHERE page_id=$1',[page.pageId])).rows[0];assert.equal(frozen.state,'submitted');assert.deepEqual(frozen.preview_bytes,jpeg);assert.deepEqual(frozen.canvas_json,canvasData);assert.ok(frozen.stored_size>=beforeSize);assert.ok(frozen.stored_size<beforeSize+jpeg.length);
  assert.equal((await call(guest,{canvasData:{objects:[]},previewDataUrl,expectedVersion:2},'PUT',cookie)).status,410);assert.deepEqual(Buffer.from(await (await call(draft.previewUrl,undefined,'GET',cookie)).arrayBuffer()),jpeg);
  assert.equal((await call('/api/collection/invites/not-a-real-invite/page-preview')).status,404);await isolated.query("UPDATE pages SET invite_created_at=CURRENT_TIMESTAMP-interval '15 days' WHERE id=$1",[page.pageId]);assert.equal((await call(ack.previewImageUrl)).status,410);assert.equal((await call(draft.previewUrl,undefined,'GET',cookie)).status,200);
  const rotated=randomBytes(32).toString('base64url');await isolated.query('UPDATE books SET title=$2,event_device_limit=7,invite_token=$3 WHERE id=$1',[collectionPilotBook.id,'Tulajdonos által módosított fiktív cím',rotated]);await stop();await start();
  const preserved=(await isolated.query('SELECT title,event_device_limit,invite_token FROM books WHERE id=$1',[collectionPilotBook.id])).rows[0];assert.equal(preserved.title,'Tulajdonos által módosított fiktív cím');assert.equal(preserved.event_device_limit,7);assert.equal(preserved.invite_token,rotated);assert.equal(await fingerprint(),before);
 }finally{await stop();await isolated.end();await baseline.end();await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);await admin.end();}
});
