import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import express from 'express';
import {Pool} from 'pg';
import sharp from 'sharp';
import {createBookViewRouter,parseBookViewGrant} from '../server/pilot/book-view';
import type {BookViewGrant} from '../server/pilot/book-view';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {createWorkflowService,createWorkflowRouter,createExportWorker} from '../server/wedding/book-workflow';
import {createWeddingRouter} from '../server/wedding/router';
import {mediaLimits} from '../server/wedding/media';
import {arrange} from '../server/wedding/montage-layout';
import {defaultProfile,mockProvider} from '../shared/montage';
import type {Draft} from '../shared/montage';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
test('fictional PDF capability: exact immutable export, anonymous read only, expiry/revocation and live review gate',{timeout:120000},async t=>{
  const connectionString=localDatabaseUrl(),schema='book_view_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`}),service=createWorkflowService(pool),worker=createExportWorker(pool);
  const owner={ownerId:'fictional-book-view-owner',kind:'owner' as const};
  const bookId=randomUUID(),sourceId=randomUUID(),mediaId=randomUUID(),title='Fiktív névtelen olvasási próba';
  const token=randomBytes(32).toString('base64url'),env:{PILOT_BOOK_VIEW_GRANT?:string}={};
  let server:ReturnType<typeof express.application.listen>|undefined;
  try{
    await migrateWedding(pool);
    await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at)
      VALUES($1,$2,'celebration','wedding',$3,'[]','wedding-classic',1,$4,CURRENT_TIMESTAMP)`,[bookId,owner.ownerId,title,randomUUID()]);
    await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[sourceId,bookId,randomUUID(),'Kitalált vendég','Árvíztűrő, ártalmatlan fiktív emlék.','fictional-view-guest']);
    const photo=await sharp({create:{width:800,height:600,channels:3,background:'#396f52'}}).png().toBuffer();
    await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
      VALUES($1,$2,$3,$4,'image/png',$5,$6,800,600,'attached',$7,$7,$7,$8)`,[mediaId,bookId,randomUUID(),sourceId,photo.length,hash(photo),photo,photo.length*3]);
    const snapshot=await service.createSnapshot(owner,bookId,{key:randomUUID(),selectedIds:[sourceId]});
    const empty:Draft={schema:1,format:'A4',spread:false,selected:[sourceId],excluded:[],profile:structuredClone(defaultProfile),pages:[{id:randomUUID(),background:'#ffffff',locked:false,elements:[]}]};
    const draft=await arrange(empty,snapshot.sources,mockProvider);delete draft.editionVariant;
    // Match historical editions whose missing variant is private by default.
    const versionId=randomUUID();
    await pool.query(`INSERT INTO event_montage_versions(id,book_id,owner_id,action_key,request_hash,kind,draft,snapshot_id)
      VALUES($1,$2,$3,$4,'fictional-view-fixture','manual',$5,$6)`,[versionId,bookId,owner.ownerId,randomUUID(),JSON.stringify(draft),snapshot.id]);
    await service.approveVersion(owner,bookId,versionId);
    const job=await service.startExport(owner,bookId,{key:randomUUID(),versionId});await worker.runOnce();
    const pdf=(await service.downloadExport(owner,bookId,job.id)).bytes;
    const grant:BookViewGrant={bookId,exportId:job.id,editionId:job.edition_id,versionId,snapshotId:snapshot.id,tokenHash:hash(token),pdfHash:hash(pdf),reviewRevision:0,expectedTitle:title,authorizedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600_000).toISOString()};
    const configure=(patch:Partial<BookViewGrant>={})=>{env.PILOT_BOOK_VIEW_GRANT=JSON.stringify({...grant,...patch});};configure();
    const app=express();app.use(createBookViewRouter(pool,env));
    app.use('/api/book-workflow',createWorkflowRouter(pool,async()=>null,'http://localhost'));
    app.use('/api/wedding',createWeddingRouter({pool,media:mediaLimits(),getSession:async()=>null,env:{NODE_ENV:'test',WEDDING_ENABLED:'true'}}));
    app.use((_req,res)=>{res.status(404).end();});server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port,path='/wedding/view/'+token;
    const read=(suffix='',method='GET')=>fetch(base+path+suffix,{method,redirect:'manual'});
    const fingerprint=async()=>{
      const result:Record<string,string>={};
      for(const table of ['event_books','event_submissions','event_media','event_book_snapshots','event_book_snapshot_media','event_montage_versions','event_book_editions','event_book_export_jobs','event_book_audit','event_content_release_clearances'])
        result[table]=(await pool.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS h FROM ${table} t`)).rows[0].h;
      return result;
    };
    await t.test('exact existing private-default PDF is anonymous, inline, byte-identical and read-only',async()=>{
      const before=await fingerprint(),response=await read();assert.equal(response.status,200);
      assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('content-disposition'),'inline; filename="memorybook.pdf"');
      assert.equal(response.headers.get('set-cookie'),null);assert.match(response.headers.get('cache-control')||'',/no-store/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
      const head=await read('','HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
      const range=await fetch(base+path,{headers:{Range:'bytes=0-15'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),pdf.subarray(0,16));
      assert.deepEqual(await fingerprint(),before,'reading never modifies a source, version, approval, export or audit');
    });
    await t.test('bad token, path, method, overrides and owner APIs cannot broaden access',async()=>{
      assert.equal((await fetch(base+'/wedding/view/'+randomBytes(32).toString('base64url'))).status,404);
      for(const suffix of ['?bookId='+bookId,'?exportId='+job.id,'/media/'+mediaId,'/pdf','/','/../other'])assert.equal((await read(suffix)).status,404);
      for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal((await read('',method)).status,404);
      for(const p of [`/api/book-workflow/${bookId}`,`/api/book-workflow/${bookId}/exports/${job.id}/download`,`/api/wedding/books/${bookId}`,`/api/wedding/media/${mediaId}/original`])assert.equal((await fetch(base+p)).status,401);
      const denied=await fetch(base+'/wedding/view/'+randomBytes(32).toString('base64url'));const body=await denied.text();assert.ok(!body.includes(sourceId)&&!body.includes(title)&&!body.includes(token));
    });
    await t.test('every configured identity/hash is exact; mutable PDF tampering is withheld',async()=>{
      for(const key of ['bookId','exportId','editionId','versionId','snapshotId'] as const){configure({[key]:randomUUID()});assert.equal((await read()).status,404,key);}
      for(const key of ['tokenHash','pdfHash'] as const){configure({[key]:'0'.repeat(64)});assert.equal((await read()).status,404,key);}
      configure({expectedTitle:'Másik fiktív könyv'});assert.equal((await read()).status,404);configure({reviewRevision:1});assert.equal((await read()).status,404);configure();
      await pool.query('UPDATE event_book_export_jobs SET pdf_bytes=$1 WHERE id=$2',[Buffer.from('%PDF-tampered-fictitious'),job.id]);assert.equal((await read()).status,404);
      await pool.query('UPDATE event_book_export_jobs SET pdf_bytes=$1 WHERE id=$2',[pdf,job.id]);assert.equal((await read()).status,200);
    });
    await t.test('an inconsistent edition hash is denied even when all configured record IDs and PDF bytes match',async()=>{
      const badVersion=randomUUID(),badEdition=randomUUID(),badJob=randomUUID();
      await pool.query(`INSERT INTO event_montage_versions(id,book_id,owner_id,action_key,request_hash,kind,draft,snapshot_id,approved_at,approved_by)
        SELECT $1,book_id,owner_id,$2,'fictional-corrupt-hash','manual',draft,snapshot_id,CURRENT_TIMESTAMP,approved_by FROM event_montage_versions WHERE id=$3`,[badVersion,randomUUID(),versionId]);
      await pool.query(`INSERT INTO event_book_editions(id,book_id,version_id,snapshot_id,draft,draft_hash,approved_by,report)
        SELECT $1,book_id,$2,snapshot_id,draft,$3,approved_by,report FROM event_book_editions WHERE id=$4`,[badEdition,badVersion,'0'.repeat(64),job.edition_id]);
      await pool.query(`INSERT INTO event_book_export_jobs(id,book_id,edition_id,version_id,action_key,request_hash,status,pdf_bytes)
        VALUES($1,$2,$3,$4,$5,'fictional-corrupt-hash','complete',$6)`,[badJob,bookId,badEdition,badVersion,randomUUID(),pdf]);
      configure({editionId:badEdition,versionId:badVersion,exportId:badJob,authorizedAt:new Date().toISOString()});assert.equal((await read()).status,404);
      configure();assert.equal((await read()).status,200);
    });
    await t.test('empty, expired, future and revoked configuration deny; malformed startup config fails closed',async()=>{
      assert.equal(parseBookViewGrant(undefined),null);assert.equal(parseBookViewGrant(' '),null);
      for(const bad of ['{','[]',JSON.stringify({...grant,token:'must-never-appear'}),JSON.stringify({...grant,reviewRevision:'0'}),JSON.stringify({...grant,bookId:[bookId]}),JSON.stringify({...grant,expiresAt:new Date(Date.parse(grant.authorizedAt)+31*86400_000).toISOString()})])assert.throws(()=>createBookViewRouter(pool,{PILOT_BOOK_VIEW_GRANT:bad}),/^Error: INVALID_PILOT_BOOK_VIEW_GRANT$/);
      configure({authorizedAt:new Date(Date.now()-7200_000).toISOString(),expiresAt:new Date(Date.now()-3600_000).toISOString()});assert.equal((await read()).status,404);
      configure({authorizedAt:new Date(Date.now()+3600_000).toISOString(),expiresAt:new Date(Date.now()+7200_000).toISOString()});assert.equal((await read()).status,404);
      env.PILOT_BOOK_VIEW_GRANT='';assert.equal((await read()).status,404);env.PILOT_BOOK_VIEW_GRANT='invalid';assert.equal((await read()).status,404);configure();assert.equal((await read()).status,200);
    });
    await t.test('pending and private-only/omit block; owner reapproval cannot renew an old share grant',async()=>{
      const flag=await service.createContentFlag(owner,bookId,{key:randomUUID(),sourceId,mediaId,categories:['possible_sexual'],reason:'Ártalmatlan színminta szimulált jelzése.',scope:{kind:'full'}});
      assert.equal((await read()).status,404);
      const resolved=await service.decideContentFlag(owner,bookId,flag.item.id,{key:randomUUID(),decision:'false_positive',scope:{kind:'full'}});
      await service.approveVersion(owner,bookId,versionId);assert.equal((await read()).status,404,'new owner clearance alone cannot renew the separate anonymous grant');
      grant.reviewRevision=resolved.revision;grant.authorizedAt=new Date().toISOString();configure();assert.equal((await read()).status,200);
      for(const decision of ['private_only','omit'] as const){const result=await service.decideContentFlag(owner,bookId,flag.item.id,{key:randomUUID(),decision,scope:{kind:'full'}});configure({reviewRevision:result.revision});assert.equal((await read()).status,404,decision+' is blocked even with a newly authorized grant revision');}
      const allowed=await service.decideContentFlag(owner,bookId,flag.item.id,{key:randomUUID(),decision:'allowed',scope:{kind:'full'}});await service.approveVersion(owner,bookId,versionId);
      configure();assert.equal((await read()).status,404,'later resolution never resurrects the old grant');grant.reviewRevision=allowed.revision;grant.authorizedAt=new Date().toISOString();configure();assert.equal((await read()).status,200);
      assert.deepEqual((await service.downloadExport(owner,bookId,job.id)).bytes,pdf,'original immutable edition remains unchanged');
    });
    await t.test('revocation while waiting for the book lock prevents an in-flight read',async()=>{
      const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[bookId]);
      try{
        const pending=read();
        let waiting=false;
        for(let i=0;i<100;i++){
          const state=await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'SELECT id,title,content_review_revision FROM event_books%' AND wait_event_type='Lock'");
          if(state.rows[0].n){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(waiting,true);env.PILOT_BOOK_VIEW_GRANT='';await lock.query('COMMIT');assert.equal((await pending).status,404);
      }finally{await lock.query('ROLLBACK');lock.release();configure();}
      assert.equal((await read()).status,200);
    });
    await t.test('a changed live source flag cannot inherit a decision onto different frozen text',async()=>{
      await pool.query('UPDATE event_submissions SET message=$1 WHERE id=$2',['Későbbi, másik ártalmatlan fiktív szöveg.',sourceId]);
      const flag=await service.createContentFlag(owner,bookId,{key:randomUUID(),sourceId,categories:['offensive_text'],reason:'Fiktív változás és hash-különbség próbája.',scope:{kind:'full'}});
      assert.equal((await read()).status,404);
      const allowed=await service.decideContentFlag(owner,bookId,flag.item.id,{key:randomUUID(),decision:'allowed',scope:{kind:'full'}});
      configure({reviewRevision:allowed.revision,authorizedAt:new Date().toISOString()});assert.equal((await read()).status,404,'permission for the changed live content does not clear a distinct frozen hash');
      const immutable=(await pool.query('SELECT draft FROM event_book_editions WHERE id=$1',[job.edition_id])).rows[0].draft;
      assert.deepEqual(immutable,draft);assert.deepEqual((await pool.query('SELECT pdf_bytes FROM event_book_export_jobs WHERE id=$1',[job.id])).rows[0].pdf_bytes,pdf);
    });
  }finally{
    await worker.stop();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
    await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
