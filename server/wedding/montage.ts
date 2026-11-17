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
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export {montageSources} from './montage-sources';
import {montageSources} from './montage-sources';
export function createMontageRouter(pool:Pool,getSession:(req:Request)=>Promise<WeddingSession>,origin:string,provider:PlanProvider=mockProvider){
  const workflow=createWorkflowService(pool);
  const r=Router();r.use(json({limit:'3mb'}));r.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(req.method!=='GET'&&req.get('origin')!==origin){res.sendStatus(403);return;}next();});
  const handle=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){if(e instanceof WorkflowError){res.status(e.status).json({error:e.code,details:e.details});return;}const code=e instanceof Error?e.message:'ERROR';res.status(['INVALID_DRAFT','INVALID_PLAN','TEXT_NEEDS_MANUAL_LAYOUT'].includes(code)?400:503).json({error:code==='INVALID_DRAFT'?code:code==='TEXT_NEEDS_MANUAL_LAYOUT'?code:'RETRY'});}};
  r.use('/:bookId',handle(async(req,res,next)=>{const session=await getSession(req);if(!session){res.sendStatus(401);return;}if(!uuid.test(String(req.params.bookId))){res.sendStatus(404);return;}
    const book=(await pool.query('SELECT id,owner_user_id,closed_at,title FROM event_books WHERE id=$1 AND owner_user_id=$2',[req.params.bookId,session.user.id])).rows[0];if(!book){res.sendStatus(404);return;}res.locals.book=book;next();}));
  r.get('/:bookId',handle(async(_req,res)=>{const id=res.locals.book.id;const sources=await montageSources(pool,id),versions=(await pool.query("SELECT id,parent_id,kind,approved_at,created_at,(request_hash LIKE 'auto:%') AS automatic FROM event_montage_versions WHERE book_id=$1 ORDER BY created_at DESC,id DESC",[id])).rows;res.json({book:res.locals.book,sources,versions,used:versions.filter(v=>v.kind==='mock').length,limit:2,provider:provider.name,profile:defaultProfile});}));
  r.get('/:bookId/versions/:id',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}const row=(await pool.query('SELECT * FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];if(!row){res.sendStatus(404);return;}if(row.snapshot_id){res.json(await workflow.getVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,String(req.params.id)));return;}const sources=await montageSources(pool,res.locals.book.id);res.json({...row,coverage:coverage(row.draft,sources),preflight:preflight(row.draft,sources)});}));
  // Automatic local layout is not an AI invocation and never spends the two AI/mock credits.
  r.post('/:bookId/automatic',handle(async(req,res)=>{
    const format=req.body?.format||'A4';if(!['A4','A5'].includes(format)){res.sendStatus(400);return;}
    const c=await pool.connect();try{
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(61107,5)');await c.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id]);
      const sources=await montageSources(c as unknown as Pool,res.locals.book.id);
      if(!sources.length){await c.query('ROLLBACK');res.status(409).json({error:'NO_CONTENT'});return;}
      const latest=(await c.query('SELECT id,draft,snapshot_id FROM event_montage_versions WHERE book_id=$1 ORDER BY revision DESC LIMIT 1',[res.locals.book.id])).rows[0];
      if(latest?.snapshot_id){await c.query('ROLLBACK');res.status(409).json({error:'MCP_WORKFLOW_ACTIVE'});return;}
      const excluded=latest?.draft.excluded||[];
      const protectedPages=latest?(latest.draft as Draft).pages.filter(p=>p.locked||p.elements.some(e=>e.locked||e.pinToPage)):[];
      if(latest?.draft.format!==format&&protectedPages.length){await c.query('ROLLBACK');res.status(409).json({error:'UNLOCK_BEFORE_FORMAT_CHANGE'});return;}
      const locked=protectedPages.map(p=>p.locked?p:{...p,elements:p.elements.filter(e=>e.locked||e.pinToPage)});
      const signature='auto:'+createHash('sha256').update(JSON.stringify({automatic:1,format,sources,excluded,locked})).digest('hex');
      const prior=(await c.query('SELECT id FROM event_montage_versions WHERE book_id=$1 AND request_hash=$2',[res.locals.book.id,signature])).rows[0];
      if(prior){await c.query('COMMIT');res.json({id:prior.id,replayed:true});return;}
      const initial:Draft={schema:1,format,spread:false,selected:sources.map(s=>s.id),excluded,pages:locked.length?locked:[{id:randomUUID(),background:'#fffaf4',locked:false,elements:[]}],profile:structuredClone(defaultProfile)};
      // Stable guest identity groups submissions; names alone never merge people.
      const grouped=[...sources].sort((a,b)=>a.guestId.localeCompare(b.guestId)||a.id.localeCompare(b.id));
      const draft=await arrange(initial,grouped,mockProvider);
      const stats=(await c.query('SELECT count(*) FILTER(WHERE book_id=$1)::int n,COALESCE(sum(octet_length(draft::text)),0)::bigint total,COALESCE(sum(octet_length(draft::text)) FILTER(WHERE book_id=$1),0)::bigint book FROM event_montage_versions',[res.locals.book.id])).rows[0],bytes=Buffer.byteLength(JSON.stringify(draft));
      if(stats.n>=200||Number(stats.total)+bytes>64*1024*1024||Number(stats.book)+bytes>25*1024*1024){await c.query('ROLLBACK');res.status(409).json({error:'VERSION_LIMIT'});return;}
      const id=randomUUID();await c.query('INSERT INTO event_montage_versions(id,book_id,parent_id,owner_id,action_key,request_hash,kind,draft) VALUES($1,$2,$3,$4,$5,$6,\'manual\',$7)',[id,res.locals.book.id,latest?.id||null,res.locals.book.owner_user_id,randomUUID(),signature,JSON.stringify(draft)]);
      await c.query('COMMIT');res.status(201).json({id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.get('/:bookId/versions/:id/preview-pdf',handle(async(req,res)=>{
    if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const row=(await pool.query('SELECT draft,snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];if(!row){res.sendStatus(404);return;}
    if(row.snapshot_id){res.status(409).json({error:'USE_BOOK_WORKFLOW'});return;}
    if(preflight(row.draft,await montageSources(pool,res.locals.book.id)).some(p=>p.severity==='error')){res.status(409).json({error:'PREFLIGHT'});return;}
    const bytes=await proofPdf(row.draft,res.locals.book.id,String(req.params.id),pool,true);res.type('application/pdf').setHeader('Content-Disposition','inline; filename="memorybook-egyszeru-elonezet.pdf"');res.send(bytes);
  }));
  r.post('/:bookId/versions',handle(async(req,res)=>{
    if(req.body?.snapshotId){res.status(201).json(await workflow.saveVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,req.body));return;}
    const {key,parentId,kind}=req.body||{};if(!uuid.test(key||'')||!['mock','manual'].includes(kind)||(parentId!==null&&!uuid.test(parentId||''))){res.sendStatus(400);return;}
    const requestHash=createHash('sha256').update(JSON.stringify({parentId,kind,draft:req.body.draft})).digest('hex');
    const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(61107,5)');await c.query('SELECT id FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id]);
      const head=(await c.query('SELECT snapshot_id FROM event_montage_versions WHERE book_id=$1 ORDER BY revision DESC LIMIT 1',[res.locals.book.id])).rows[0];if(head?.snapshot_id){await c.query('ROLLBACK');res.status(409).json({error:'SNAPSHOT_REQUIRED'});return;}
      const prior=(await c.query('SELECT id,request_hash FROM event_montage_versions WHERE book_id=$1 AND action_key=$2',[res.locals.book.id,key])).rows[0];if(prior){await c.query('COMMIT');if(prior.request_hash!==requestHash){res.status(409).json({error:'IDEMPOTENCY_CONFLICT'});return;}res.json({id:prior.id});return;}
      const stats=(await c.query("SELECT count(*)::int n,count(*) FILTER(WHERE kind='mock')::int used FROM event_montage_versions WHERE book_id=$1",[res.locals.book.id])).rows[0];
      if(stats.n>=200||kind==='mock'&&stats.used>=2){await c.query('ROLLBACK');res.status(409).json({error:kind==='mock'?'ARRANGEMENT_LIMIT':'VERSION_LIMIT'});return;}
      if(parentId&&!(await c.query('SELECT id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[parentId,res.locals.book.id])).rowCount){await c.query('ROLLBACK');res.sendStatus(404);return;}
      const sources=await montageSources(c as unknown as Pool,res.locals.book.id);let draft=validateDraft(req.body.draft,sources);
      if(kind==='mock')draft=await arrange(draft,sources,provider);
      const storage=(await c.query('SELECT COALESCE(sum(octet_length(draft::text)),0)::bigint total,COALESCE(sum(octet_length(draft::text)) FILTER(WHERE book_id=$1),0)::bigint book FROM event_montage_versions',[res.locals.book.id])).rows[0],bytes=Buffer.byteLength(JSON.stringify(draft));
      if(Number(storage.total)+bytes>64*1024*1024||Number(storage.book)+bytes>25*1024*1024){await c.query('ROLLBACK');res.status(409).json({error:'VERSION_STORAGE_LIMIT'});return;}
      const id=randomUUID();await c.query('INSERT INTO event_montage_versions(id,book_id,parent_id,owner_id,action_key,kind,draft,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,res.locals.book.id,parentId,res.locals.book.owner_user_id,key,kind,JSON.stringify(draft),requestHash]);await c.query('COMMIT');res.status(201).json({id});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.post('/:bookId/versions/:id/approve',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const version=(await pool.query('SELECT snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];
    if(version?.snapshot_id){res.json(await workflow.approveVersion({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,String(req.params.id)));return;}
    const c=await pool.connect();try{await c.query('BEGIN');const book=(await c.query('SELECT closed_at,submission_end FROM event_books WHERE id=$1 FOR UPDATE',[res.locals.book.id])).rows[0];
      if(!book.closed_at&&(!book.submission_end||new Date(book.submission_end)>new Date())){await c.query('ROLLBACK');res.status(409).json({error:'CLOSE_FIRST'});return;}
      const row=(await c.query('SELECT draft FROM event_montage_versions WHERE id=$1 AND book_id=$2 FOR UPDATE',[req.params.id,res.locals.book.id])).rows[0];if(!row){await c.query('ROLLBACK');res.sendStatus(404);return;}
      const sources=await montageSources(c as unknown as Pool,res.locals.book.id),missing=coverage(row.draft,sources).missing,errors=preflight(row.draft,sources).filter(x=>x.severity==='error');
      if(missing.length||errors.length){await c.query('ROLLBACK');res.status(409).json({error:'INCOMPLETE',missing,errors});return;}
      await c.query('UPDATE event_montage_versions SET approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),approved_by=$2 WHERE id=$1',[req.params.id,res.locals.book.owner_user_id]);await c.query('COMMIT');res.json({approved:true});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }));
  r.get('/:bookId/versions/:id/pdf',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}const row=(await pool.query('SELECT draft,approved_at,snapshot_id FROM event_montage_versions WHERE id=$1 AND book_id=$2',[req.params.id,res.locals.book.id])).rows[0];if(!row){res.sendStatus(404);return;}if(!row.approved_at){res.status(409).json({error:'APPROVE_FIRST'});return;}
    if(row.snapshot_id){const job=(await pool.query("SELECT id FROM event_book_export_jobs WHERE book_id=$1 AND version_id=$2 AND status='complete' ORDER BY created_at DESC LIMIT 1",[res.locals.book.id,req.params.id])).rows[0];if(!job){res.status(409).json({error:'EXPORT_NOT_READY'});return;}const file=await workflow.downloadExport({ownerId:res.locals.book.owner_user_id,kind:'owner'},res.locals.book.id,job.id);res.type(file.mimeType).setHeader('Content-Disposition',`attachment; filename="${file.filename}"`);res.send(file.bytes);return;}
    const errors=preflight(row.draft,await montageSources(pool,res.locals.book.id)).filter(x=>x.severity==='error');if(errors.length){res.status(409).json({error:'PREFLIGHT',errors});return;}
    const bytes=await proofPdf(row.draft,res.locals.book.id,String(req.params.id),pool);res.type('application/pdf').setHeader('Content-Disposition',`attachment; filename="memorybook-${row.draft.format}-ellenorzo.pdf"`);res.send(bytes);
  }));
  r.get('/:bookId/image/:id',handle(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}const x=Number(req.query.x||0),y=Number(req.query.y||0),scale=Number(req.query.scale||1);if(![x,y,scale].every(Number.isFinite)||Math.abs(x)>1||Math.abs(y)>1||scale<.1||scale>3){res.sendStatus(400);return;}
    const row=(await pool.query("SELECT m.original_bytes,a.layer FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE m.id=$1 AND m.book_id=$2 AND m.state='attached'",[req.params.id,res.locals.book.id])).rows[0];if(!row){res.sendStatus(404);return;}
    const full=await imageWithInk(row.original_bytes,row.layer,{x,y,scale});res.type('image/png').send(await sharp(full).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer());
  }));return r;
}
