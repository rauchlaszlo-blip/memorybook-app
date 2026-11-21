import {createHash,timingSafeEqual} from 'node:crypto';
import {Router,json} from 'express';
import type {Request,Response} from 'express';
import type {Pool} from 'pg';
import type {WeddingSession} from '../wedding/router';

export const appTrialCookieName='__Host-memorybook-app-trial';
export type AppTrialGrant={bookId:string;ownerId:string;expectedTitle:string;tokenHash:string;authorizedAt:string;expiresAt:string};
type Environment={PILOT_APP_TRIAL_GRANT?:string};
type TrialBook={id:string;owner_user_id:string;title:string;invite_token:string;[key:string]:unknown};
type Access={grant:AppTrialGrant;book:TrialBook;configured:string;cookie:string};
type Scope={kind:'owner'|'guest'|'books'|'capabilities'|'html';label:string;mediaId?:string;audit?:boolean};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const token=/^[A-Za-z\d_-]{43}$/;
const hash=(value:string)=>createHash('sha256').update(value).digest();
const cookieOptions={secure:true,httpOnly:true,sameSite:'strict' as const,path:'/'};
const active=(grant:AppTrialGrant)=>Date.parse(grant.authorizedAt)<=Date.now()&&Date.parse(grant.expiresAt)>Date.now();
const invalid=():never=>{throw new Error('INVALID_PILOT_APP_TRIAL_GRANT');};
export function parseAppTrialGrant(raw:string|undefined):AppTrialGrant|null{
  if(raw===undefined||!raw.trim())return null;
  let value:unknown;try{value=JSON.parse(raw);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const v=value as Record<string,unknown>,keys=['bookId','ownerId','expectedTitle','tokenHash','authorizedAt','expiresAt'];
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key)))return invalid();
  if(typeof v.bookId!=='string'||!uuid.test(v.bookId)||typeof v.ownerId!=='string'||!v.ownerId.trim()||v.ownerId.length>200)return invalid();
  if(typeof v.expectedTitle!=='string'||v.expectedTitle.length>200||!/fiktív/i.test(v.expectedTitle)||typeof v.tokenHash!=='string'||!/^[a-f\d]{64}$/.test(v.tokenHash))return invalid();
  for(const key of ['authorizedAt','expiresAt'])if(typeof v[key]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v[key])||!Number.isFinite(Date.parse(v[key])))return invalid();
  const duration=Date.parse(v.expiresAt as string)-Date.parse(v.authorizedAt as string);if(duration<=0||duration>30*86400_000)return invalid();
  return v as AppTrialGrant;
}
function trialCookies(req:Request){return(req.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.split('=',1)[0].trim()===appTrialCookieName);}
function path(req:Request){return req.originalUrl.split('?')[0];}
function publicAsset(req:Request){return ['GET','HEAD'].includes(req.method)&&(/^(?:\/assets|\/fonts)\/[a-zA-Z\d_./-]+$/.test(path(req))||/^\/favicon\.(?:ico|png|svg)$/.test(path(req))||path(req)==='/wedding/try');}
function scope(req:Request,book:TrialBook):Scope|null{
  const p=path(req),get=req.method==='GET',post=req.method==='POST';
  // Encoded delimiters, suffixes and alternate routes never expand this capability.
  if(p.includes('%')||p.includes('\\')||p.split('/').some(part=>part==='.'||part==='..'))return null;
  if(get&&p==='/api/wedding/capabilities')return{kind:'capabilities',label:'capabilities'};
  if(get&&p==='/api/wedding/books')return{kind:'books',label:'book.list'};
  if(get&&(p==='/'||p==='/wedding'||p==='/wedding/books/'+book.id||p==='/wedding/books/'+book.id+'/montage'||p==='/wedding/join/'+book.invite_token))return{kind:'html',label:'app'};
  if(get&&p==='/api/wedding/books/'+book.id)return{kind:'owner',label:'book.read'};
  const media=/^\/api\/wedding\/media\/([^/]+)\/(original|preview|display|annotation|playback)$/.exec(p);
  if(get&&media&&uuid.test(media[1]))return{kind:'owner',label:'media.read',mediaId:media[1]};
  const workflow='/api/book-workflow/'+book.id;
  if(p===workflow&&get)return{kind:'owner',label:'workflow.read'};
  if(p.startsWith(workflow+'/')){
    const suffix=p.slice(workflow.length+1),parts=suffix.split('/'),id=parts[1];
    if(get&&['reviews','submissions','exports'].includes(suffix))return{kind:'owner',label:suffix+'.read'};
    if(get&&parts.length===2&&['snapshots','versions','exports','image','media'].includes(parts[0])&&uuid.test(id))return{kind:'owner',label:parts[0]+'.read'};
    if(get&&parts.length===3&&uuid.test(id)&&(parts[0]==='versions'&&parts[2]==='approval'||parts[0]==='exports'&&parts[2]==='download'))return{kind:'owner',label:parts[0]+'.read'};
    if(post&&['reviews','review-draft','snapshots','versions','exports'].includes(suffix))return{kind:'owner',label:suffix+'.request',audit:suffix!=='review-draft'};
    if(post&&parts.length===3&&uuid.test(id)&&(parts[0]==='reviews'&&parts[2]==='decision'||parts[0]==='versions'&&parts[2]==='approve'))return{kind:'owner',label:parts[0]+'.'+parts[2],audit:true};
  }
  const montage='/api/montage/'+book.id;
  if(get&&p===montage)return{kind:'owner',label:'montage.read'};
  if(p.startsWith(montage+'/')){
    const parts=p.slice(montage.length+1).split('/');
    if(get&&parts.length===2&&['image','versions'].includes(parts[0])&&uuid.test(parts[1]))return{kind:'owner',label:'montage.read'};
    if(get&&parts.length===3&&parts[0]==='versions'&&uuid.test(parts[1])&&['preview-pdf','pdf'].includes(parts[2]))return{kind:'owner',label:'montage.pdf'};
    // The pilot automatic route is the local deterministic arranger, not a paid provider.
    if(post&&parts.length===1&&parts[0]==='automatic')return{kind:'owner',label:'montage.automatic',audit:true};
  }
  const guest='/api/wedding/guest/'+book.invite_token;
  if(get&&p===guest)return{kind:'guest',label:'guest.read'};
  if(post&&p===guest+'/submissions')return{kind:'guest',label:'guest.submit',audit:true};
  if(p.startsWith(guest+'/media/')&&uuid.test(p.slice((guest+'/media/').length))&&(get||post))return{kind:'guest',label:get?'guest.media.recovery':'guest.media.upload',audit:post};
  return null;
}

/** Mount router BEFORE every auth/MCP/API/SPA router. Presence of any trial cookie
 * must choose getSession exclusively: never fall back to a full owner session.
 */
export function createAppTrialAccess(pool:Pool,origin:string,env:Environment=process.env){
  parseAppTrialGrant(env.PILOT_APP_TRIAL_GRANT);
  const router=Router(),cache=new WeakMap<Request,Access>(),hasTrialCookie=(req:Request)=>trialCookies(req).length>0;
  async function resolve(req:Request,key?:string):Promise<Access|null>{
    const configured=env.PILOT_APP_TRIAL_GRANT;let grant:AppTrialGrant|null;
    try{grant=parseAppTrialGrant(configured);}catch{return null;}
    if(!grant||!active(grant))return null;
    const cookies=trialCookies(req),cookie=key??(cookies.length===1?cookies[0].slice(appTrialCookieName.length+1):'');
    if(!token.test(cookie)||!timingSafeEqual(hash(cookie),Buffer.from(grant.tokenHash,'hex')))return null;
    const previous=cache.get(req);if(!key&&previous&&previous.configured===configured&&previous.cookie===cookie)return previous;
    const book=(await pool.query(`SELECT id,owner_user_id,title,subjects,starts_on::text,ends_on::text,template_id,template_version,closed_at,created_at,invite_token,package_version,submission_start,submission_end,finalized_at
      FROM event_books WHERE id=$1 AND owner_user_id=$2 AND title=$3 AND product='celebration'`,[grant.bookId,grant.ownerId,grant.expectedTitle])).rows[0] as TrialBook|undefined;
    if(!book||env.PILOT_APP_TRIAL_GRANT!==configured||!active(grant))return null;
    const access={book,grant,configured:configured!,cookie};if(!key)cache.set(req,access);return access;
  }
  async function permitted(req:Request,access:Access){
    const result=scope(req,access.book);if(!result)return null;
    if(result.mediaId&&!(await pool.query("SELECT id FROM event_media WHERE id=$1 AND book_id=$2 AND state='attached'",[result.mediaId,access.book.id])).rowCount)return null;
    return result;
  }
  async function getSession(req:Request):Promise<WeddingSession>{
    if(!hasTrialCookie(req))return null;
    const access=await resolve(req);if(!access)return null;
    const route=await permitted(req,access);return route?.kind==='owner'?{user:{id:access.book.owner_user_id}}:null;
  }
  const deny=(res:Response)=>res.status(404).json({error:'TRIAL_SCOPE_DENIED'});
  router.post('/api/pilot/app-trial/redeem',json({limit:'1kb'}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.get('origin')!==origin){res.status(403).json({error:'ORIGIN_REQUIRED'});return;}
    if(!req.body||typeof req.body!=='object'||Object.keys(req.body).length!==1||typeof req.body.key!=='string'||Object.keys(req.query).length){deny(res);return;}
    try{
      const access=await resolve(req,req.body.key);if(!access){deny(res);return;}
      res.cookie(appTrialCookieName,access.cookie,{...cookieOptions,maxAge:Math.max(0,Date.parse(access.grant.expiresAt)-Date.now())});
      res.json({success:true,bookId:access.book.id,redirectTo:'/wedding/books/'+access.book.id});
    }catch{res.status(503).json({error:'TRIAL_UNAVAILABLE'});}
  });
  router.post('/api/pilot/app-trial/leave',(req,res)=>{
    if(req.get('origin')!==origin){res.status(403).json({error:'ORIGIN_REQUIRED'});return;}
    res.clearCookie(appTrialCookieName,cookieOptions);res.setHeader('Cache-Control','no-store');res.json({success:true});
  });
  router.use(async(req,res,next)=>{
    if(!hasTrialCookie(req)||publicAsset(req)){next();return;}
    res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-MemoryBook-Access':'book-trial'});
    try{
      const access=await resolve(req);if(!access){deny(res);return;}
      const route=await permitted(req,access);if(!route){deny(res);return;}
      if(req.method!=='GET'&&req.get('origin')!==origin){res.status(403).json({error:'ORIGIN_REQUIRED'});return;}
      if(route.kind==='capabilities'){
        res.json({enabled:true,authenticated:true,internetPilot:true,shopAvailable:false,contentReview:true,canCreate:false,trial:{bookId:access.book.id,expiresAt:access.grant.expiresAt}});return;
      }
      if(route.kind==='books'){
        const {owner_user_id:ownerId,...book}=access.book;void ownerId;
        res.json({books:[{...book,guest_url:origin+'/wedding/join/'+book.invite_token}]});return;
      }
      if(path(req)==='/'){res.redirect(303,'/wedding/books/'+access.book.id);return;}
      // This supplemental audit identifies trial attempts without logging bodies,
      // bearer keys or guest invite URLs. Domain audits still describe results.
      if(route.audit)await pool.query(`INSERT INTO event_book_audit(book_id,actor_id,actor_kind,operation,target_id,details)
        VALUES($1,$2,'owner','trial.requested',$1,$3)`,[access.book.id,'trial:'+access.grant.tokenHash.slice(0,16),JSON.stringify({method:req.method,route:route.label})]);
      next();
    }catch{res.status(503).json({error:'TRIAL_UNAVAILABLE'});}
  });
  return{router,getSession,hasTrialCookie};
}
