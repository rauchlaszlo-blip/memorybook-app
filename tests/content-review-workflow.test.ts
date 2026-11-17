import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import express from 'express';
import sharp from 'sharp';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { createWorkflowService, createWorkflowRouter, createExportWorker, WorkflowError } from '../server/wedding/book-workflow';
import { createMontageRouter } from '../server/wedding/montage';
import { defaultProfile, mockProvider } from '../shared/montage';
import type { Draft } from '../shared/montage';
import { arrange } from '../server/wedding/montage-layout';

const blocked = (error: unknown) => error instanceof WorkflowError && error.code === 'CONTENT_REVIEW_BLOCKED';
const required = (error: unknown) => error instanceof WorkflowError && error.code === 'CONTENT_REVIEW_REQUIRED';

test('content review workflow: granular holds, private/shareable editions, immutable history and all PDF aliases', {timeout:120000}, async () => {
  const connectionString=localDatabaseUrl(), schema='review_flow_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString}); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`}), service=createWorkflowService(pool), worker=createExportWorker(pool);
  const owner={ownerId:'review-fictional-owner',kind:'owner' as const}, bookId=randomUUID(), mcp={...owner,kind:'mcp' as const,allowedBookIds:[bookId]};
  let server:ReturnType<typeof express.application.listen>|undefined;
  try {
    await migrateWedding(pool);
    await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at)
      VALUES($1,$2,'celebration','wedding','Fiktív átnézési könyv','[]','wedding-classic',1,$3,CURRENT_TIMESTAMP)`,[bookId,owner.ownerId,randomUUID()]);
    const sources:string[]=[],media:string[]=[];
    for(let i=0;i<2;i++) {
      const sourceId=randomUUID(); sources.push(sourceId);
      await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[sourceId,bookId,randomUUID(),'Azonos fiktív név',i?'PRIVATE_TEXT_SENTINEL_20261117':'A tiszta üzenet használható marad.','distinct-guest-'+i]);
      const image=await sharp({create:{width:400,height:300,channels:3,background:i?'#00aa77':'#aa3377'}}).png().toBuffer(),mediaId=randomUUID();media.push(mediaId);
      await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
        VALUES($1,$2,$3,$4,'image/png',$5,$6,400,300,'attached',$7,$7,$7,$8)`,[mediaId,bookId,randomUUID(),sourceId,image.length,createHash('sha256').update(image).digest('hex'),image,image.length*3]);
    }
    const snapshot=await service.createSnapshot(owner,bookId,{key:randomUUID(),selectedIds:sources});
    const initial:Draft={schema:1,format:'A4',spread:false,selected:sources,excluded:[],profile:structuredClone(defaultProfile),pages:[{id:randomUUID(),background:'#fffaf4',locked:false,elements:[]}]};
    const draft=await arrange(initial,snapshot.sources,mockProvider);
    draft.pages[0].locked=true;
    const original=await service.saveVersion(owner,bookId,{key:randomUUID(),parentId:null,snapshotId:snapshot.id,draft});
    await service.approveVersion(owner,bookId,original.id);
    const exportRequest={key:randomUUID(),versionId:original.id}, job=await service.startExport(owner,bookId,exportRequest);
    await worker.runOnce(); const before=await service.downloadExport(owner,bookId,job.id);
    assert.equal(before.bytes.subarray(0,5).toString(),'%PDF-');
    const frozenBefore=(await pool.query('SELECT draft_hash,draft FROM event_book_editions WHERE version_id=$1',[original.id])).rows[0];
    const photoFlag=await service.createContentFlag(mcp,bookId,{key:randomUUID(),sourceId:sources[0],mediaId:media[0],categories:['possible_sexual','possible_extremist'],reason:'Ártalmatlan színminta; szimulált jelzés.',scope:{kind:'full'}});
    assert.equal(photoFlag.item.flags.length,2);
    const filtered=await service.getSnapshot(mcp,bookId,snapshot.id);
    assert.equal(filtered.sources[0].media.length,0); assert.equal(filtered.sources[0].message,snapshot.sources[0].message);
    assert.equal(filtered.sources[1].media.length,1);
    await assert.rejects(service.getMedia(mcp,bookId,media[0],{snapshotId:snapshot.id}),blocked);
    await assert.rejects(service.getVersion(mcp,bookId,original.id),blocked);
    await assert.rejects(service.startExport(owner,bookId,exportRequest),blocked);
    await assert.rejects(service.downloadExport(owner,bookId,job.id),blocked);
    assert.equal((await service.getExport(owner,bookId,job.id)).downloadPath,null);
    assert.equal((await service.getVersion(owner,bookId,original.id)).contentReview.blocked,true);
    await assert.rejects(service.saveVersion(owner,bookId,{key:randomUUID(),parentId:original.id,snapshotId:snapshot.id,draft:original.draft}),blocked);
    const app=express();server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
    const session=async(req:express.Request)=>req.get('x-fictional-owner')?{user:{id:owner.ownerId}}:null;
    app.use('/api/book-workflow',createWorkflowRouter(pool,session,base));app.use('/api/montage',createMontageRouter(pool,session,base));
    for(const path of [`/api/book-workflow/${bookId}/exports/${job.id}/download`,`/api/montage/${bookId}/versions/${original.id}/pdf`]) {
      assert.equal((await fetch(base+path)).status,401);
      const denied=await fetch(base+path,{headers:{'x-fictional-owner':'true'}});assert.equal(denied.status,409);assert.equal((await denied.json()).error,'CONTENT_REVIEW_BLOCKED');
    }
    assert.equal((await fetch(base+`/api/book-workflow/${bookId}/reviews`,{method:'POST',headers:{'x-fictional-owner':'true','Content-Type':'application/json'},body:'{}'})).status,403);
    const resolved=await service.decideContentFlag(owner,bookId,photoFlag.item.id,{key:randomUUID(),decision:'allowed',scope:{kind:'full'},note:'Szimulált jelzés, fiktív színminta.'});
    await assert.rejects(service.downloadExport(owner,bookId,job.id),required);
    await assert.rejects(service.approveVersion(owner,bookId,original.id,{expectedReviewRevision:0}),error=>error instanceof WorkflowError&&error.code==='CONTENT_REVIEW_CONFLICT');
    await service.approveVersion(owner,bookId,original.id,{expectedReviewRevision:resolved.revision});
    assert.deepEqual((await service.downloadExport(owner,bookId,job.id)).bytes,before.bytes);
    await service.decideContentFlag(owner,bookId,photoFlag.item.id,{key:randomUUID(),decision:'private_only',scope:{kind:'full'}});
    const textFlag=await service.createContentFlag(owner,bookId,{key:randomUUID(),sourceId:sources[1],categories:['offensive_text'],reason:'Fiktív próbaszöveg jelzése.',scope:{kind:'full'}});
    await service.decideContentFlag(owner,bookId,textFlag.item.id,{key:randomUUID(),decision:'private_only',scope:{kind:'full'}});
    const shared={...original.draft,editionVariant:'shareable' as const};
    await assert.rejects(service.saveVersion(owner,bookId,{key:randomUUID(),parentId:original.id,snapshotId:snapshot.id,draft:shared}),blocked);
    const policy=await service.reviewDraft(owner,bookId,{draft:shared,snapshotId:snapshot.id});
    const clean=structuredClone(shared);for(const page of clean.pages)page.elements=page.elements.filter(element=>!policy.blockedElementIds.includes(element.id));
    const forbiddenCleanup=structuredClone(clean);forbiddenCleanup.pages[0].elements=[];
    await assert.rejects(service.saveVersion(owner,bookId,{key:randomUUID(),parentId:original.id,snapshotId:snapshot.id,draft:forbiddenCleanup,reviewCleanup:true}),error=>error instanceof WorkflowError&&error.code==='PAGE_LOCKED');
    const sharedVersion=await service.saveVersion(owner,bookId,{key:randomUUID(),parentId:original.id,snapshotId:snapshot.id,draft:clean,reviewCleanup:true});
    assert.ok(sharedVersion.coverage.reviewMissing.some(item=>item.guestId==='distinct-guest-1'));
    await service.approveVersion(owner,bookId,sharedVersion.id);
    const sharedJob=await service.startExport(owner,bookId,{key:randomUUID(),versionId:sharedVersion.id});await worker.runOnce();
    const sharedPdf=await service.downloadExport(owner,bookId,sharedJob.id);
    const shareableSources=await service.getSnapshot(owner,bookId,snapshot.id,'shareable');
    assert.equal(shareableSources.sources[0].media.length,0);assert.equal(shareableSources.sources[1].message,'');
    assert.ok(!JSON.stringify(shareableSources).includes('PRIVATE_TEXT_SENTINEL_20261117'));
    await assert.rejects(service.getMedia(owner,bookId,media[0],{snapshotId:snapshot.id,editionVariant:'shareable'}),blocked);
    assert.ok((await service.getMedia(owner,bookId,media[0],{snapshotId:snapshot.id})).bytes.length);
    await mkdir('test-results/content-review',{recursive:true});await writeFile('test-results/content-review/shareable.pdf',sharedPdf.bytes);
    assert.deepEqual((await pool.query('SELECT draft_hash,draft FROM event_book_editions WHERE version_id=$1',[original.id])).rows[0],frozenBefore);
    assert.equal(Number((await pool.query('SELECT count(*) n FROM event_media')).rows[0].n),2);
    // A restrictive decision arriving during rendering must prevent publication of bytes.
    const next=await service.saveVersion(owner,bookId,{key:randomUUID(),parentId:sharedVersion.id,snapshotId:snapshot.id,draft:clean});await service.approveVersion(owner,bookId,next.id);
    const racingRequest={key:randomUUID(),versionId:next.id},racingJob=await service.startExport(owner,bookId,racingRequest);
    let racingFlagId='';
    const racing=createExportWorker(pool,{render:async()=>{
      racingFlagId=(await service.createContentFlag(owner,bookId,{key:randomUUID(),sourceId:sources[1],mediaId:media[1],categories:['possible_extremist'],reason:'Ártalmatlan próba: jelzés renderelés közben.',scope:{kind:'full'}})).item.id;
      return Buffer.from('%PDF-fictitious-render');
    }});
    await racing.runOnce();await racing.stop();
    const race=await service.getExport(owner,bookId,racingJob.id);assert.equal(race.status,'failed');assert.equal(race.error_code,'CONTENT_REVIEW_BLOCKED');
    assert.equal((await pool.query('SELECT pdf_bytes FROM event_book_export_jobs WHERE id=$1',[racingJob.id])).rows[0].pdf_bytes,null);
    await service.decideContentFlag(owner,bookId,racingFlagId,{key:randomUUID(),decision:'false_positive',scope:{kind:'full'}});
    await service.approveVersion(owner,bookId,next.id);
    assert.equal((await service.startExport(owner,bookId,racingRequest)).status,'queued');
    await worker.runOnce();assert.equal((await service.getExport(owner,bookId,racingJob.id)).status,'complete');
  } finally {await worker.stop();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
