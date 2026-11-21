import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import express from 'express';
import {Pool} from 'pg';
import sharp from 'sharp';
import {appTrialCookieName,createAppTrialAccess,parseAppTrialGrant} from '../server/pilot/app-trial';
import type {AppTrialGrant} from '../server/pilot/app-trial';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {createWorkflowService,createWorkflowRouter,createExportWorker} from '../server/wedding/book-workflow';
import {createWeddingRouter} from '../server/wedding/router';
import {createMontageRouter} from '../server/wedding/montage';
import {mediaLimits} from '../server/wedding/media';
import {arrange} from '../server/wedding/montage-layout';
import {defaultProfile,mockProvider} from '../shared/montage';
import type {Draft} from '../shared/montage';

test('passwordless fictional app trial: exact-book interactive access without full-account authority',{timeout:120000},async t=>{
  const connectionString=localDatabaseUrl(),schema='app_trial_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),workflow=createWorkflowService(pool),worker=createExportWorker(pool);
  const owner={ownerId:'fictional-trial-owner',kind:'owner' as const},secret=randomBytes(32).toString('base64url');
  const env:{PILOT_APP_TRIAL_GRANT?:string}={};
  let server:ReturnType<typeof express.application.listen>|undefined;
  try{
    await migrateWedding(pool);
    const seed=async(title:string)=>{
      const bookId=randomUUID(),sourceId=randomUUID(),mediaId=randomUUID(),invite=randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at)
        VALUES($1,$2,'celebration','wedding',$3,'[]','wedding-classic',1,$4,CURRENT_TIMESTAMP)`,[bookId,owner.ownerId,title,invite]);
      await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[sourceId,bookId,randomUUID(),'Kitalált vendég','Árvíztűrő, fiktív emlék.','trial-guest-'+bookId]);
      const photo=await sharp({create:{width:800,height:600,channels:3,background:'#396f52'}}).png().toBuffer();
      await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
        VALUES($1,$2,$3,$4,'image/png',$5,$6,800,600,'attached',$7,$7,$7,$8)`,[mediaId,bookId,randomUUID(),sourceId,photo.length,createHash('sha256').update(photo).digest('hex'),photo,photo.length*3]);
      const snapshot=await workflow.createSnapshot(owner,bookId,{key:randomUUID(),selectedIds:[sourceId]});
      const initial:Draft={schema:1,format:'A4',spread:false,selected:[sourceId],excluded:[],profile:structuredClone(defaultProfile),pages:[{id:randomUUID(),background:'#ffffff',locked:false,elements:[]}]};
      const draft=await arrange(initial,snapshot.sources,mockProvider),version=await workflow.saveVersion(owner,bookId,{key:randomUUID(),parentId:null,snapshotId:snapshot.id,draft});
      return{bookId,sourceId,mediaId,invite,title,snapshot,version,photo};
    };
    const chosen=await seed('Fiktív kipróbálható alkalmazás'),other=await seed('Fiktív másik, nem engedélyezett könyv');
    await workflow.approveVersion(owner,other.bookId,other.version.id);const otherExport=await workflow.startExport(owner,other.bookId,{key:randomUUID(),versionId:other.version.id});await worker.runOnce();
    const grant:AppTrialGrant={bookId:chosen.bookId,ownerId:owner.ownerId,expectedTitle:chosen.title,tokenHash:createHash('sha256').update(secret).digest('hex'),authorizedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600_000).toISOString()};
    const configure=(patch:Partial<AppTrialGrant>={})=>{env.PILOT_APP_TRIAL_GRANT=JSON.stringify({...grant,...patch});};configure();
    const app=express();server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
    const access=createAppTrialAccess(pool,base,env);app.use(access.router);
    const session=async(req:express.Request)=>access.hasTrialCookie(req)?access.getSession(req):(req.headers.cookie||'').includes('existing-owner=yes')?{user:{id:owner.ownerId}}:null;
    let accountOrMcpHits=0;app.use(['/oauth','/mcp','/.well-known','/api/auth','/api/shop','/api/pilot/redeem'],(_req,res)=>{accountOrMcpHits++;res.json({sensitive:true});});
    app.use('/api/book-workflow',createWorkflowRouter(pool,session,base));app.use('/api/montage',createMontageRouter(pool,session,base));
    app.use('/api/wedding',createWeddingRouter({pool,getSession:session,publicOrigin:base,media:mediaLimits(),contentReview:true,env:{NODE_ENV:'test',WEDDING_ENABLED:'true'}}));
    app.get(/^\/wedding(?:\/.*)?$/,(_req,res)=>{res.type('html').send('<main>Fiktív alkalmazás</main>');});app.get('/assets/trial.js',(_req,res)=>{res.type('js').send('/* public asset */');});
    app.use((_req,res)=>{res.status(404).end();});
    let cookie='';
    const request=(path:string,body?:unknown,headers:Record<string,string>={},method=body===undefined?'GET':'POST')=>fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
    const auditCount=async()=>Number((await pool.query('SELECT count(*) n FROM event_book_audit')).rows[0].n);
    const otherBefore=(await pool.query(`SELECT (SELECT count(*) FROM event_montage_versions WHERE book_id=$1) versions,(SELECT count(*) FROM event_book_audit WHERE book_id=$1) audit`,[other.bookId])).rows[0];
    await t.test('redeem validates origin and exact grant; cookie is scoped and redeem writes no application data',async()=>{
      const before=await auditCount();
      assert.equal((await request('/api/pilot/app-trial/redeem',{key:secret},{Origin:'https://foreign.invalid'})).status,403);
      assert.equal((await request('/api/pilot/app-trial/redeem',{key:randomBytes(32).toString('base64url')})).status,404);
      assert.equal((await request('/api/pilot/app-trial/redeem',{key:secret,bookId:other.bookId})).status,404);
      const response=await request('/api/pilot/app-trial/redeem',{key:secret});assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{success:true,bookId:chosen.bookId,redirectTo:'/wedding/books/'+chosen.bookId});
      const set=response.headers.get('set-cookie')!;assert.match(set,/HttpOnly/);assert.match(set,/Secure/);assert.match(set,/SameSite=Strict/);assert.match(set,/Path=\//);cookie=set.split(';')[0];assert.equal(cookie,appTrialCookieName+'='+secret);
      assert.equal(await auditCount(),before);assert.equal((await request('/api/wedding/books/'+chosen.bookId)).status,200);
    });
    await t.test('capabilities and list reveal only the selected book; same-book app/media/reviews are usable',async()=>{
      const caps=await(await request('/api/wedding/capabilities')).json();assert.equal(caps.authenticated,true);assert.equal(caps.canCreate,false);assert.equal(caps.shopAvailable,false);assert.deepEqual(caps.trial,{bookId:chosen.bookId,expiresAt:grant.expiresAt});
      const list=await(await request('/api/wedding/books')).json();assert.deepEqual(list.books.map((b:{id:string})=>b.id),[chosen.bookId]);
      for(const path of ['/wedding','/wedding/books/'+chosen.bookId,'/wedding/books/'+chosen.bookId+'/montage','/wedding/join/'+chosen.invite,'/api/wedding/guest/'+chosen.invite,'/api/montage/'+chosen.bookId,'/api/book-workflow/'+chosen.bookId,'/api/book-workflow/'+chosen.bookId+'/reviews'])assert.equal((await request(path)).status,200,path);
      const image=await request('/api/wedding/media/'+chosen.mediaId+'/original');assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),chosen.photo);
      const ownVersion=await request(`/api/book-workflow/${chosen.bookId}/versions/${chosen.version.id}`);assert.equal(ownVersion.status,200);
    });
    await t.test('deny-by-default boundary survives stronger owner cookies and bearer tokens',async()=>{
      const originalCookie=cookie;cookie+='; existing-owner=yes';
      for(const path of ['/api/wedding/books/'+other.bookId,'/wedding/books/'+other.bookId,'/api/book-workflow','/api/book-workflow/'+other.bookId,'/api/montage/'+other.bookId,'/api/wedding/media/'+other.mediaId+'/original','/api/wedding/guest/'+other.invite,'/wedding/join/'+other.invite,'/oauth/authorize','/mcp','/mcp/media/'+chosen.bookId+'/'+chosen.mediaId,'/.well-known/oauth-authorization-server','/api/auth/get-session','/api/shop/session','/pilot/account','/wedding/view/'+secret])assert.equal((await request(path,undefined,{Authorization:'Bearer deliberately-valid-looking-token'})).status,404,path);
      for(const path of ['/api/wedding/books','/api/wedding/books/'+chosen.bookId+'/close','/api/montage/'+chosen.bookId+'/versions','/api/shop/orders','/oauth/token','/api/pilot/redeem'])assert.equal((await request(path,{})).status,404,path);
      assert.equal((await request('/api/book-workflow/'+chosen.bookId+'/versions',{}, {},'DELETE')).status,404);
      assert.equal((await request('/api/book-workflow/'+chosen.bookId+'/versions',{}, {Origin:'https://foreign.invalid'})).status,403);
      assert.equal(accountOrMcpHits,0);cookie=originalCookie;
    });
    await t.test('foreign child IDs inside an allowed book path cannot bypass core ownership checks',async()=>{
      const root='/api/book-workflow/'+chosen.bookId;
      for(const path of [root+'/snapshots/'+other.snapshot.id,root+'/versions/'+other.version.id,root+'/exports/'+otherExport.id,root+'/exports/'+otherExport.id+'/download',root+'/media/'+other.mediaId,root+'/image/'+other.mediaId])assert.equal((await request(path)).status,404,path);
      assert.equal((await request(root+'/image/'+chosen.mediaId+'?snapshotId='+other.snapshot.id)).status,404);
      const denied=await request(root+'/snapshots',{key:randomUUID(),selectedIds:[other.sourceId]});assert.equal(denied.status,400);
    });
    await t.test('real editing, review decisions, approval and export work only on the fictional book',async()=>{
      const root='/api/book-workflow/'+chosen.bookId,next=structuredClone(chosen.version.draft);next.pages[0].background='#fdf7ef';
      assert.equal((await request(root+'/review-draft',{draft:next,snapshotId:chosen.snapshot.id,versionId:chosen.version.id})).status,200);
      const saved=await request(root+'/versions',{key:randomUUID(),parentId:chosen.version.id,snapshotId:chosen.snapshot.id,draft:next});assert.equal(saved.status,201);const version=await saved.json();
      assert.equal((await request(root+'/versions/'+version.id+'/approve',{expectedReviewRevision:0})).status,200);
      const exported=await request(root+'/exports',{key:randomUUID(),versionId:version.id});assert.equal(exported.status,202);const job=await exported.json();await worker.runOnce();
      assert.equal((await request(root+'/exports/'+job.id+'/download')).status,200);
      const flagged=await request(root+'/reviews',{key:randomUUID(),sourceId:chosen.sourceId,mediaId:chosen.mediaId,categories:['possible_sexual'],reason:'Ártalmatlan fiktív színminta próbája.',scope:{kind:'full'}});assert.equal(flagged.status,201);const flag=await flagged.json();
      assert.equal((await request(root+'/exports/'+job.id+'/download')).status,409);
      const decided=await request(root+'/reviews/'+flag.item.id+'/decision',{key:randomUUID(),decision:'false_positive',scope:{kind:'full'},expectedRevision:flag.revision});assert.equal(decided.status,200);const decision=await decided.json();
      assert.equal((await request(root+'/exports/'+job.id+'/download')).status,409);
      assert.equal((await request(root+'/versions/'+version.id+'/approve',{expectedReviewRevision:decision.revision})).status,200);assert.equal((await request(root+'/exports/'+job.id+'/download')).status,200);
      const audit=(await pool.query("SELECT actor_id,details FROM event_book_audit WHERE operation='trial.requested' AND book_id=$1",[chosen.bookId])).rows;assert.ok(audit.length>=6);assert.ok(audit.every(row=>row.actor_id.startsWith('trial:')));assert.ok(!JSON.stringify(audit).includes(secret)&&!JSON.stringify(audit).includes(chosen.invite));
    });
    await t.test('malformed, duplicated, expired, revoked and ownership-changed trials never fall back to full owner auth',async()=>{
      const originalCookie=cookie;
      for(const value of [appTrialCookieName+'=bad',originalCookie+'; '+originalCookie,appTrialCookieName+'=',appTrialCookieName,appTrialCookieName+' =bad']){cookie=value+'; existing-owner=yes';assert.equal((await request('/api/wedding/books')).status,404);}
      cookie=originalCookie+'; existing-owner=yes';
      configure({authorizedAt:new Date(Date.now()-7200_000).toISOString(),expiresAt:new Date(Date.now()-3600_000).toISOString()});assert.equal((await request('/api/wedding/books')).status,404);
      env.PILOT_APP_TRIAL_GRANT='';assert.equal((await request('/api/wedding/books')).status,404);configure();
      await pool.query('UPDATE event_books SET owner_user_id=$1 WHERE id=$2',['different-owner',chosen.bookId]);assert.equal((await request('/api/wedding/books')).status,404);await pool.query('UPDATE event_books SET owner_user_id=$1 WHERE id=$2',[owner.ownerId,chosen.bookId]);
      configure({expectedTitle:'Fiktív más cím'});assert.equal((await request('/api/wedding/books')).status,404);configure();cookie=originalCookie;
      assert.equal(parseAppTrialGrant(undefined),null);for(const bad of ['[]','{',JSON.stringify({...grant,ownerId:[owner.ownerId]}),JSON.stringify({...grant,expiresAt:new Date(Date.parse(grant.authorizedAt)+31*86400_000).toISOString()})])assert.throws(()=>parseAppTrialGrant(bad),/^Error: INVALID_PILOT_APP_TRIAL_GRANT$/);
    });
    await t.test('leave always works for an invalid trial and preserves unrelated cookies and normal owner access',async()=>{
      cookie=appTrialCookieName+'=invalid; existing-owner=yes';env.PILOT_APP_TRIAL_GRANT='';
      assert.equal((await request('/wedding/try')).status,200);assert.equal((await request('/assets/trial.js')).status,200);
      assert.equal((await request('/api/pilot/app-trial/leave',{}, {Origin:'https://foreign.invalid'})).status,403);
      const response=await request('/api/pilot/app-trial/leave',{});assert.equal(response.status,200);const cleared=response.headers.get('set-cookie')!;assert.ok(cleared.startsWith(appTrialCookieName+'=;'));assert.ok(!cleared.includes('existing-owner'));
      cookie='existing-owner=yes';const normal=await(await request('/api/wedding/books')).json();assert.equal(normal.books.length,2);cookie='';assert.equal((await request('/api/wedding/books')).status,401);
      assert.deepEqual((await pool.query(`SELECT (SELECT count(*) FROM event_montage_versions WHERE book_id=$1) versions,(SELECT count(*) FROM event_book_audit WHERE book_id=$1) audit`,[other.bookId])).rows[0],otherBefore);
    });
  }finally{
    await worker.stop();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
