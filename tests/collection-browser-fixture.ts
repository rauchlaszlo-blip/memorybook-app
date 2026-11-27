import {randomUUID} from 'node:crypto';
import express from 'express';
import {Pool} from 'pg';
import path from 'node:path';
import {createCollectionRouter} from '../server/collection/router';
import {initializeCollectionFixture,seedCollectionPage} from './collection-fixture';

/** Real collection API/storage/decoder; only legacy canvas preview upload is a local test adapter. */
export async function startCollectionBrowserFixture(){
 const connectionString=process.env.DATABASE_URL||'postgresql://memorybook_test@127.0.0.1:5432/memorybook_wedding_test',url=new URL(connectionString);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||process.env.WEDDING_LOCAL_DATABASE_ACK!=='yes')throw new Error('Local acknowledged test database required');
 const schema='browser_collection_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
 try{
  await initializeCollectionFixture(pool);const fixture=await seedCollectionPage(pool),app=express(),previews=new Map<string,Buffer>(),env={NODE_ENV:'test',PUBLIC_APP_URL:''};
  app.use(createCollectionRouter({pool,env,getSession:async req=>{
   const value=req.get('x-test-owner')||(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('collection-test-owner='))?.slice('collection-test-owner='.length);
   return value==='owner-a'?{user:{id:value}}:null;
  }}));
  app.use(express.json({limit:'5mb'}));
  app.get('/api/page-invites/:token',async(req,res)=>{
   const row=(await pool.query(`SELECT p.id,p.version,p.canvas_json AS "canvasData",p.invite_status AS "inviteStatus",p.invite_created_at AS "inviteCreatedAt",p.invite_created_at+interval '14 days' AS "inviteExpiresAt",p.page_number AS "pageNumber",p.book_id AS "bookId",b.title AS "bookTitle",b.book_type AS "bookType" FROM pages p JOIN books b ON b.id=p.book_id WHERE p.invite_token=$1`,[req.params.token])).rows[0];
   if(!row){res.status(404).json({error:'PAGE_INVITE_NOT_FOUND'});return;}if(row.inviteStatus==='submitted'){res.status(410).json({error:'PAGE_ALREADY_SUBMITTED'});return;}
   res.json({...row,language:'hu',inviteLanguage:'hu',previewImageUrl:previews.has(row.id)?'/__test/page-preview/'+encodeURIComponent(row.id):null});
  });
  app.put('/api/page-invites/:token',async(req,res)=>{
   // Match legacy CAS and save envelope; no Cloudinary or any other external service.
   const {expectedVersion,canvasData,previewDataUrl}=req.body||{};if(!Number.isInteger(expectedVersion)||!canvasData){res.status(400).json({error:'INVALID_CANVAS_DATA'});return;}
   const row=(await pool.query("UPDATE pages SET canvas_json=$2,version=version+1,invite_status='draft',updated_at=CURRENT_TIMESTAMP WHERE invite_token=$1 AND version=$3 AND invite_status<>'submitted' RETURNING id,version,updated_at",[req.params.token,canvasData,expectedVersion])).rows[0];
   if(!row){res.status(409).json({error:'PAGE_CONFLICT'});return;}
   if(typeof previewDataUrl==='string'&&previewDataUrl.startsWith('data:image/jpeg;base64,'))previews.set(row.id,Buffer.from(previewDataUrl.slice(23),'base64'));
   res.json({success:true,newVersion:row.version,previewImageUrl:'/__test/page-preview/'+encodeURIComponent(row.id),updatedAt:row.updated_at});
  });
  app.get('/__test/page-preview/:id',(req,res)=>{const bytes=previews.get(String(req.params.id));if(!bytes){res.sendStatus(404);return;}res.setHeader('Cache-Control','no-store');res.type('image/jpeg').send(bytes);});
  const dist=path.join(process.cwd(),'dist');app.use(express.static(dist));app.use((_req,res)=>res.sendFile(path.join(dist,'index.html')));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Local fixture did not listen');
  const origin='http://collection.localhost:'+address.port,loopbackOrigin='http://127.0.0.1:'+address.port;
  env.PUBLIC_APP_URL=origin;
  return{...fixture,origin,loopbackOrigin,pool,ownerCookie:{name:'collection-test-owner',value:fixture.ownerId,url:origin},close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}};
 }catch(error){await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw error;}
}
