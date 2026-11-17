import { Router,json } from 'express';
import type { Request,RequestHandler } from 'express';
import type { Pool } from 'pg';
import { randomUUID,createHash } from 'node:crypto';
import { coverage,validateDraft,mockProvider,defaultProfile } from '../../shared/montage';
import type { PlanProvider,Draft } from '../../shared/montage';
import type { WeddingSession } from './router';
import { arrange,preflight } from './montage-layout';
import { imageWithInk,proofPdf } from './montage-pdf';
import sharp from 'sharp';
import { createWorkflowService, WorkflowError } from './book-workflow';
import { ContentReviewError, reviewState, filterReviewSources, reviewDraftPolicy, getReviewClearance, clearReviewForVersion } from './content-review';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export {montageSources} from './montage-sources';
import {montageSources} from './montage-sources';
export function createMontageRouter(pool:Pool,getSession:(req:Request)=>Promise<WeddingSession>,origin:string,provider:PlanProvider=mockProvider){
  const workflow=createWorkflowService(pool);
  const filteredSources=async(db:Pick<Pool,'query'>,bookId:string,variant:'private'|'shareable'='private')=>{const sources=await montageSources(db,bookId);return filterReviewSources(sources,await reviewState(db,bookId,sources),variant);};
  const checkPolicy=async(db:Pick<Pool,'query'>,bookId:string,versionId:string,draft:Draft,release=false)=>{
    const policy=await reviewDraftPolicy(db,bookId,draft,await montageSources(db,bookId),{versionId,clearanceRevision:await getReviewClearance(db,bookId,versionId)});
    if(policy.blocked||release&&policy.requiresReview)throw new WorkflowError(policy.blocked?'CONTENT_REVIEW_BLOCKED':'CONTENT_REVIEW_REQUIRED',409,policy);
    return policy;
  };
  const legacyPdf=async(bookId:string,versionId:string,preview:boolean)=>{
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[bookId]);
      const row=(await c.query('SELECT draft,approved_at,snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[versionId,bookId])).rows[0];
      if(!row)throw new WorkflowError('VERSION_NOT_FOUND',404);
      if(row.snapshot_id)throw new WorkflowError('USE_BOOK_WORKFLOW',409);
      if(!preview&&!row.approved_at)throw new WorkflowError('APPROVE_FIRST',409);
      await checkPolicy(c,bookId,versionId,row.draft,!preview);
      const filtered=await filteredSources(c,bookId,row.draft.editionVariant);
      if(preflight(row.draft,filtered.sources).some(p=>p.severity==='error'))throw new WorkflowError('PREFLIGHT',409);
      const bytes=await proofPdf(row.draft,bookId,versionId,c as unknown as Pool,preview);await c.query('COMMIT');return bytes;
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  };
  const r=Router();r.use(json({limit:'3mb'}));r.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(req.method!=='GET'&&req.get('origin')!==origin){res.sendStatus(403);return;}next();});
  const handle=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){if(e instanceof WorkflowError||e instanceof ContentReviewError){res.status(e.status).json({error:e.code,details:e.details});return;}const code=e instanceof Error?e.message:'ERROR';res.status(['INVALID_DRAFT','INVALID_PLAN','TEXT_NEEDS_MANUAL_LAYOUT'].includes(code)?400:503).json({error:code==='INVALID_DRAFT'?code:code==='TEXT_NEEDS_MANUAL_LAYOUT'?code:'RETRY'});}};
  r.use('/:bookId',handle(async(req,res,next)=>{const session=await getSession(req);if(!session){res.sendStatus(401);return;}if(!uuid.test(String(req.params.bookId))){res.sendStatus(404);return;}
    const book=(await pool.query('SELECT id,owner_user_id,closed_at,title FROM event_books WHERE id=$1 AND owner_user_id=$2',[req.params.bookId,session.user.id])).rows[0];if(!book){res.sendStatus(404);return;}res.locals.book=book;next();}));
  r.get('/:bookId',handle(async(req,res)=>{const id=res.locals.book.id;if(req.query.editionVariant!==undefined&&!['private','shareable'].includes(String(req.query.editionVariant)))throw new WorkflowError('INVALID_EDITION_VARIANT');const filtered=await filteredSources(pool,id,req.query.editionVariant==='shareable'?'shareable':'private'),versions=(await pool.query("SELECT id,parent_id,kind,approved_at,created_at,(request_hash LIKE 'auto:%') AS automatic FROM event_montage_versions WHERE book_id=$1 ORDER BY created_at DESC,id DESC",[id])).rows;res.json({book:res.locals.book,...filtered,versions,used:versions.filter(v=>v.kind==='mock').length,limit:2,provider:provider.name,profile:defaultProfile});}));
  r.get('/:bookId/versions/:id',handle(async(req,res)=>{res.json(await workflow.getVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,String(req.params.id)));}));
  // Automatic local layout is not an AI invocation and never spends the two AI/mock credits.
  r.post('/:bookId/automatic',handle(async(req,res)=>{
    const format=req.body?.format||'A4';if(!['A4','A5'].includes(format)){res.sendStatus(400);return;}
    const c=await pool.connect();try{
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(61107,5)');await c.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id]);
      const latest=(await c.query('SELECT id,draft,snapshot_id FROM event_montage_versions WHERE book_id=$1 ORDER BY revision DESC LIMIT 1',[res.locals.book.id])).rows[0];
      const editionVariant:Draft['editionVariant']=latest?.draft.editionVariant||'private';
      const {sources}=await filteredSources(c,res.locals.book.id,editionVariant);
      if(!sources.length){await c.query('ROLLBACK');res.status(409).json({error:'NO_CONTENT'});return;}
      if(latest?.snapshot_id){await c.query('ROLLBACK');res.status(409).json({error:'MCP_WORKFLOW_ACTIVE'});return;}
      const excluded=latest?.draft.excluded||[];
      const protectedPages=latest?(latest.draft as Draft).pages.filter(p=>p.locked||p.elements.some(e=>e.locked||e.pinToPage)):[];
      if(latest?.draft.format!==format&&protectedPages.length){await c.query('ROLLBACK');res.status(409).json({error:'UNLOCK_BEFORE_FORMAT_CHANGE'});return;}
      const locked=protectedPages.map(p=>p.locked?p:{...p,elements:p.elements.filter(e=>e.locked||e.pinToPage)});
      const signature='auto:'+createHash('sha256').update(JSON.stringify({automatic:1,format,editionVariant,sources,excluded,locked})).digest('hex');
      const prior=(await c.query('SELECT id,draft FROM event_montage_versions WHERE book_id=$1 AND request_hash=$2',[res.locals.book.id,signature])).rows[0];
      if(prior){await checkPolicy(c,res.locals.book.id,prior.id,prior.draft);await c.query('COMMIT');res.json({id:prior.id,replayed:true});return;}
      const initial:Draft={schema:1,format,editionVariant,spread:false,selected:sources.map(s=>s.id),excluded,pages:locked.length?locked:[{id:randomUUID(),background:'#fffaf4',locked:false,elements:[]}],profile:structuredClone(defaultProfile)};
      await checkPolicy(c,res.locals.book.id,latest?.id||randomUUID(),initial);
      // Stable guest identity groups submissions; names alone never merge people.
      const grouped=[...sources].sort((a,b)=>a.guestId.localeCompare(b.guestId)||a.id.localeCompare(b.id));
      const draft=await arrange(initial,grouped,mockProvider);
      await checkPolicy(c,res.locals.book.id,latest?.id||randomUUID(),draft);
      const stats=(await c.query('SELECT count(*) FILTER(WHERE book_id=$1)::int n,COALESCE(sum(octet_length(draft::text)),0)::bigint total,COALESCE(sum(octet_length(draft::text)) FILTER(WHERE book_id=$1),0)::bigint book FROM event_montage_versions',[res.locals.book.id])).rows[0],bytes=Buffer.byteLength(JSON.stringify(draft));
      if(stats.n>=200||Number(stats.total)+bytes>64*1024*1024||Number(stats.book)+bytes>25*1024*1024){await c.query('ROLLBACK');res.status(409).json({error:'VERSION_LIMIT'});return;}
      const id=randomUUID();await c.query('INSERT INTO event_montage_versions(id,book_id,parent_id,owner_id,action_key,request_hash,kind,draft) VALUES($1,$2,$3,$4,$5,$6,\'manual\',$7)',[id,res.locals.book.id,latest?.id||null,res.locals.book.owner_user_id,randomUUID(),signature,JSON.stringify(draft)]);
      await c.query('COMMIT');res.status(201).json({id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.get('/:bookId/versions/:id/preview-pdf',handle(async(req,res)=>{
    if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const bytes=await legacyPdf(res.locals.book.id,String(req.params.id),true);res.type('application/pdf').setHeader('Content-Disposition','inline; filename="memorybook-egyszeru-elonezet.pdf"');res.send(bytes);
  }));
  r.post('/:bookId/versions',handle(async(req,res)=>{
    if(req.body?.snapshotId){res.status(201).json(await workflow.saveVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,req.body));return;}
    const {key,parentId,kind}=req.body||{};if(!uuid.test(key||'')||!['mock','manual'].includes(kind)||(parentId!==null&&!uuid.test(parentId||''))){res.sendStatus(400);return;}
    const requestHash=createHash('sha256').update(JSON.stringify({parentId,kind,draft:req.body.draft})).digest('hex');
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(61107,5)');await c.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id]);
      const head=(await c.query('SELECT snapshot_id FROM event_montage_versions WHERE book_id=$1 ORDER BY revision DESC LIMIT 1',[res.locals.book.id])).rows[0];if(head?.snapshot_id){await c.query('ROLLBACK');res.status(409).json({error:'SNAPSHOT_REQUIRED'});return;}
      const prior=(await c.query('SELECT id,request_hash,draft FROM event_montage_versions WHERE book_id=$1 AND action_key=$2',[res.locals.book.id,key])).rows[0];if(prior){if(prior.request_hash!==requestHash)throw new WorkflowError('IDEMPOTENCY_CONFLICT',409);await checkPolicy(c,res.locals.book.id,prior.id,prior.draft);await c.query('COMMIT');res.json({id:prior.id});return;}
      const stats=(await c.query("SELECT count(*)::int n,count(*) FILTER(WHERE kind='mock')::int used FROM event_montage_versions WHERE book_id=$1",[res.locals.book.id])).rows[0];
      if(stats.n>=200||kind==='mock'&&stats.used>=2){await c.query('ROLLBACK');res.status(409).json({error:kind==='mock'?'ARRANGEMENT_LIMIT':'VERSION_LIMIT'});return;}
      if(parentId&&!(await c.query('SELECT id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[parentId,res.locals.book.id])).rowCount){await c.query('ROLLBACK');res.sendStatus(404);return;}
      const sources=await montageSources(c as unknown as Pool,res.locals.book.id);let draft=validateDraft(req.body.draft,sources);
      if(kind==='mock')draft=await arrange(draft,(await filteredSources(c,res.locals.book.id,draft.editionVariant)).sources,provider);
      await checkPolicy(c,res.locals.book.id,parentId||randomUUID(),draft);
      const storage=(await c.query('SELECT COALESCE(sum(octet_length(draft::text)),0)::bigint total,COALESCE(sum(octet_length(draft::text)) FILTER(WHERE book_id=$1),0)::bigint book FROM event_montage_versions',[res.locals.book.id])).rows[0],bytes=Buffer.byteLength(JSON.stringify(draft));
      if(Number(storage.total)+bytes>64*1024*1024||Number(storage.book)+bytes>25*1024*1024){await c.query('ROLLBACK');res.status(409).json({error:'VERSION_STORAGE_LIMIT'});return;}
      const id=randomUUID();await c.query('INSERT INTO event_montage_versions(id,book_id,parent_id,owner_id,action_key,kind,draft,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,res.locals.book.id,parentId,res.locals.book.owner_user_id,key,kind,JSON.stringify(draft),requestHash]);await c.query('COMMIT');res.status(201).json({id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.post('/:bookId/versions/:id/approve',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const version=(await pool.query('SELECT snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];
    if(version?.snapshot_id){res.json(await workflow.approveVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,String(req.params.id),req.body||{}));return;}
    const c=await pool.connect();try{await c.query('BEGIN');const book=(await c.query('SELECT closed_at,submission_end FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id])).rows[0];
      if(!book.closed_at&&(!book.submission_end||new Date(book.submission_end)>new Date())){await c.query('ROLLBACK');res.status(409).json({error:'CLOSE_FIRST'});return;}
      const row=(await c.query('SELECT draft FROM event_montage_versions WHERE id=$1 AND book_id=$2 FOR UPDATE',[req.params.id,res.locals.book.id])).rows[0];if(!row){await c.query('ROLLBACK');res.sendStatus(404);return;}
      const policy=await checkPolicy(c,res.locals.book.id,String(req.params.id),row.draft);
      if(req.body?.expectedReviewRevision!==undefined&&req.body.expectedReviewRevision!==policy.revision)throw new WorkflowError('CONTENT_REVIEW_CONFLICT',409);
      const {sources}=await filteredSources(c,res.locals.book.id,row.draft.editionVariant),cov=coverage(row.draft,sources),reviewMissing=new Set(cov.reviewMissing.map(x=>x.guestId)),missing=cov.missing.filter(id=>!reviewMissing.has(id)),errors=preflight(row.draft,sources).filter(x=>x.severity==='error');
      if(missing.length||errors.length){await c.query('ROLLBACK');res.status(409).json({error:'INCOMPLETE',missing,errors});return;}
      await c.query('UPDATE event_montage_versions SET approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),approved_by=$2 WHERE id=$1',[req.params.id,res.locals.book.owner_user_id]);
      await clearReviewForVersion(c,res.locals.book.id,String(req.params.id),policy.revision,res.locals.book.owner_user_id);await c.query('COMMIT');res.json({approved:true});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.get('/:bookId/versions/:id/pdf',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}const row=(await pool.query('SELECT draft,approved_at,snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];if(!row){res.sendStatus(404);return;}if(!row.approved_at){res.status(409).json({error:'APPROVE_FIRST'});return;}
    if(row.snapshot_id){const job=(await pool.query("SELECT id FROM event_book_export_jobs WHERE book_id=$1 AND version_id=$2 AND status='complete' ORDER BY created_at DESC LIMIT 1",[res.locals.book.id,req.params.id])).rows[0];if(!job){res.status(409).json({error:'EXPORT_NOT_READY'});return;}const file=await workflow.downloadExport({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,job.id);res.type(file.mimeType).setHeader('Content-Disposition',`attachment; filename="${file.filename}"`);res.send(file.bytes);return;}
    const bytes=await legacyPdf(res.locals.book.id,String(req.params.id),false);res.type('application/pdf').setHeader('Content-Disposition',`attachment; filename="memorybook-${row.draft.format}-ellenorzo.pdf"`);res.send(bytes);
  }));
  r.get('/:bookId/image/:id',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}const x=Number(req.query.x||0),y=Number(req.query.y||0),scale=Number(req.query.scale||1);if(![x,y,scale].every(Number.isFinite)||Math.abs(x)>1||Math.abs(y)>1||scale<.1||scale>3){res.sendStatus(400);return;}
    if(req.query.editionVariant!==undefined&&!['private','shareable'].includes(String(req.query.editionVariant)))throw new WorkflowError('INVALID_EDITION_VARIANT');
    const media=await workflow.getMedia({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,String(req.params.id),{editionVariant:req.query.editionVariant==='shareable'?'shareable':'private',preview:false});
    const full=await imageWithInk(media.bytes,media.layer,{x,y,scale});res.type('image/png').send(await sharp(full).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer());
  }));return r;
}
