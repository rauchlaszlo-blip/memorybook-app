import {createHash,timingSafeEqual} from 'node:crypto';
import {Router} from 'express';
import type {Pool,PoolClient} from 'pg';
import type {Draft,Source} from '../../shared/montage';
import {reviewDraftPolicy} from '../wedding/content-review';
import {sendMediaBytes} from '../wedding/media-response';

/** Operator-only authorization for one already approved, fictional PDF.
 * This grants no owner session and is separate from the immutable edition approval.
 * Removing/replacing the environment value revokes it; no public issuance API exists.
 */
export type BookViewGrant={
  bookId:string;exportId:string;editionId:string;versionId:string;snapshotId:string;
  tokenHash:string;pdfHash:string;reviewRevision:number;expectedTitle:string;
  authorizedAt:string;expiresAt:string;
};
type Environment={PILOT_BOOK_VIEW_GRANT?:string};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const digest=/^[a-f\d]{64}$/;
const keys=['bookId','exportId','editionId','versionId','snapshotId','tokenHash','pdfHash','reviewRevision','expectedTitle','authorizedAt','expiresAt'];
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const draftHash=(draft:Draft)=>sha(JSON.stringify(canonical(draft)));
const invalid=():never=>{throw new Error('INVALID_PILOT_BOOK_VIEW_GRANT');};

/** Strict validation contains no token/config values in errors. Empty means disabled. */
export function parseBookViewGrant(raw:string|undefined):BookViewGrant|null{
  if(raw===undefined||raw.trim()==='')return null;
  let value:unknown;try{value=JSON.parse(raw);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))return invalid();
  for(const k of ['bookId','exportId','editionId','versionId','snapshotId'])if(typeof v[k]!=='string'||!uuid.test(v[k]))return invalid();
  for(const k of ['tokenHash','pdfHash'])if(typeof v[k]!=='string'||!digest.test(v[k]))return invalid();
  if(!Number.isSafeInteger(v.reviewRevision)||Number(v.reviewRevision)<0)return invalid();
  if(typeof v.expectedTitle!=='string'||v.expectedTitle.length>200||!/fiktív/i.test(v.expectedTitle))return invalid();
  for(const k of ['authorizedAt','expiresAt'])if(typeof v[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v[k])||!Number.isFinite(Date.parse(v[k])))return invalid();
  const duration=Date.parse(v.expiresAt as string)-Date.parse(v.authorizedAt as string);
  if(duration<=0||duration>30*86400_000)return invalid();
  return v as BookViewGrant;
}

/** Mount before the /wedding SPA fallback. Every read is independently authorized. */
export function createBookViewRouter(pool:Pool,env:Environment=process.env){
  parseBookViewGrant(env.PILOT_BOOK_VIEW_GRANT); // Invalid deployment configuration fails startup.
  const router=Router();
  router.use('/wedding/view',async(req,res)=>{
    res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
    const deny=()=>{res.status(404).type('text').send('A könyv ezen a linken nem érhető el.');};
    if(!['GET','HEAD'].includes(req.method)||Object.keys(req.query).length||!/^\/[A-Za-z\d_-]{43}$/.test(req.path)){deny();return;}
    const configured=env.PILOT_BOOK_VIEW_GRANT;
    let grant:BookViewGrant|null;
    try{grant=parseBookViewGrant(configured);}catch{deny();return;}
    const validTime=()=>!!grant&&Date.parse(grant.authorizedAt)<=Date.now()&&Date.parse(grant.expiresAt)>Date.now();
    if(!grant||!validTime()||!timingSafeEqual(Buffer.from(sha(req.path.slice(1)),'hex'),Buffer.from(grant.tokenHash,'hex'))){deny();return;}
    let client:PoolClient|undefined;
    try{
      client=await pool.connect();
      await client.query('BEGIN');
      const book=(await client.query('SELECT id,title,content_review_revision FROM event_books WHERE id=$1 FOR UPDATE',[grant.bookId])).rows[0];
      if(!book||book.title!==grant.expectedTitle||grant.reviewRevision>Number(book.content_review_revision)){await client.query('ROLLBACK');deny();return;}
      // All joins bind the same approved immutable edition, version and snapshot.
      const record=(await client.query(`SELECT e.draft,e.draft_hash,e.approved_at,v.draft AS version_draft,
        s.sources,j.pdf_bytes FROM event_book_export_jobs j
        JOIN event_book_editions e ON e.id=j.edition_id AND e.book_id=j.book_id AND e.version_id=j.version_id
        JOIN event_montage_versions v ON v.id=e.version_id AND v.book_id=e.book_id AND v.snapshot_id=e.snapshot_id
        JOIN event_book_snapshots s ON s.id=e.snapshot_id AND s.book_id=e.book_id
        WHERE j.id=$1 AND j.book_id=$2 AND j.edition_id=$3 AND j.version_id=$4 AND e.snapshot_id=$5
          AND j.status='complete' AND v.approved_at IS NOT NULL`,[grant.exportId,grant.bookId,grant.editionId,grant.versionId,grant.snapshotId])).rows[0];
      if(!record||new Date(record.approved_at).getTime()>Date.parse(grant.authorizedAt)
        ||draftHash(record.draft)!==record.draft_hash||draftHash(record.version_draft)!==record.draft_hash
        ||!Buffer.isBuffer(record.pdf_bytes)||record.pdf_bytes.subarray(0,5).toString()!=='%PDF-'||sha(record.pdf_bytes)!==grant.pdfHash){
        await client.query('ROLLBACK');deny();return;
      }
      // Private-default historical editions are never mutated or silently relabelled.
      // This distinct grant must pass the stronger sharing rule on the SAME frozen content.
      const policy=await reviewDraftPolicy(client,grant.bookId,{...record.draft,editionVariant:'shareable'} as Draft,record.sources as Source[],{
        versionId:grant.versionId,snapshotId:grant.snapshotId,clearanceRevision:grant.reviewRevision,
      });
      if(policy.blocked||policy.requiresReview||env.PILOT_BOOK_VIEW_GRANT!==configured||!validTime()){
        await client.query('ROLLBACK');deny();return;
      }
      // Copy and authorize the bytes while holding the same lock used by review decisions.
      // A subsequent revocation prevents new reads, not bytes already authorized/delivered.
      const bytes=Buffer.from(record.pdf_bytes);
      await client.query('COMMIT');
      sendMediaBytes(req,res,{bytes,mimeType:'application/pdf',filename:'memorybook.pdf',attachment:false,range:true});
    }catch{
      await client?.query('ROLLBACK').catch(()=>undefined);
      if(!res.headersSent)res.status(503).type('text').send('A könyv most nem érhető el.');
    }finally{client?.release();}
  });
  return router;
}
