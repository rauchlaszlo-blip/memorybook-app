import type {MediaKind} from './media-limits';
export type SourceMedia={id:string;kind?:MediaKind;mimeType?:string;durationSeconds?:number|null;width:number;height:number;annotated:boolean;inkBounds?:{x:number;y:number;w:number;h:number}};
// Missing kind is an earlier immutable photo snapshot, never an inferred AV file.
export const sourceMediaKind=(media:SourceMedia):MediaKind=>media.kind||'photo';
export const isPhotoMedia=(media:SourceMedia)=>sourceMediaKind(media)==='photo';
export const mediaCapabilities={images:true,annotations:true,audio:true,video:true,audioUpload:true,videoUpload:true,ownerPlayback:true,audioVideoInterpretation:false,audioVideoPdfEmbedding:false,transcription:false,durableMediaQr:false} as const;
export type Source = {id:string;guestId:string;name:string;message:string;review?:{originalHasMessage:boolean;textState:'pending'|'omit'|'private_only'|'allowed'|'unreviewed';pendingIds:string[]};media:SourceMedia[]};
export type Element = {id:string;kind:'text'|'photo';sourceId:string;mediaId?:string;x:number;y:number;w:number;h:number;locked:boolean;pinToPage?:boolean;rotation?:number;text?:string;textRole?:'message'|'caption';edited?:boolean;partStart?:number;partEnd?:number;fontSize:number;color:string;crop:{x:number;y:number;w:number;h:number};ink:{x:number;y:number;scale:number}};
export type Page = {id:string;background:string;locked:boolean;elements:Element[]};
export type PrintProfile = {bleed:number;safe:number;binding:number;minDpi:number;colorProfile:string;pdfRequirement:string;cover:{paper:string;widthMm:number|null;heightMm:number|null;spineMm:number|null;specification:string}};
export type Draft = {schema:1;format:'A4'|'A5';editionVariant?:'private'|'shareable';spread:boolean;excluded:string[];selected:string[];pages:Page[];profile:PrintProfile};
export const sizes={A4:{w:210,h:297},A5:{w:148,h:210}};
export const defaultProfile:PrintProfile={bleed:0,safe:8,binding:5,minDpi:200,colorProfile:'sRGB – ellenőrző, nyomdával egyeztetendő',pdfRequirement:'Ellenőrző PDF, nem PDF/X',cover:{paper:'Nincs kiválasztva',widthMm:null,heightMm:null,spineMm:null,specification:'Külön nyomdai specifikáció szükséges'}};
export function coverage(d:Draft,sources:Source[]){
  const guests=Array.from(new Set(sources.map(s=>s.guestId)));
  const texts=d.pages.flatMap(p=>p.elements.filter(e=>e.kind==='text'&&e.textRole!=='caption'&&e.text?.trim()));
  const included=new Set(sources.filter(s=>{
    if(s.review?.textState==='pending'||s.review?.textState==='omit'||s.review?.textState==='private_only'&&d.editionVariant==='shareable')return false;
    const elements=texts.filter(e=>e.sourceId===s.id);
    if(elements.some(e=>e.edited||e.text===s.message))return true;
    const parts=elements.filter(e=>e.partStart!==undefined).sort((a,b)=>a.partStart!-b.partStart!);let end=0;
    for(const e of parts){if(e.partStart!>end)return false;end=Math.max(end,e.partEnd!);}return !!s.message&&end===s.message.length;
  }).map(s=>s.guestId));
  const hasText=(id:string)=>sources.some(s=>s.guestId===id&&(s.message.trim()||s.review?.originalHasMessage));
  const missing=guests.filter(g=>hasText(g)&&!d.excluded.includes(g)&&!included.has(g));
  const reviewMissing=missing.filter(guestId=>!sources.some(s=>s.guestId===guestId&&s.message.trim()&&s.review?.textState!=='pending'&&s.review?.textState!=='omit'&&!(s.review?.textState==='private_only'&&d.editionVariant==='shareable'))).flatMap(guestId=>sources.filter(s=>s.guestId===guestId&&s.review?.originalHasMessage&&(s.review.textState==='pending'||s.review.textState==='omit'||s.review.textState==='private_only'&&d.editionVariant==='shareable')).map(s=>({guestId,sourceId:s.id,reason:s.review!.textState as 'pending'|'omit'|'private_only'})));
  return {total:guests.length,covered:guests.filter(g=>hasText(g)&&included.has(g)).length,missing,reviewMissing,excluded:guests.filter(g=>d.excluded.includes(g)),mediaOnly:guests.filter(g=>!hasText(g))};
}
const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function validateDraft(value:unknown,sources:Source[]):Draft {
  const fail=():never=>{throw new Error('INVALID_DRAFT');};
  if(!value||typeof value!=='object'||JSON.stringify(value).length>3_000_000) return fail();
  const d=value as Draft;
  if(d.schema!==1||!['A4','A5'].includes(d.format)||(d.editionVariant!==undefined&&!['private','shareable'].includes(d.editionVariant))||typeof d.spread!=='boolean'||!Array.isArray(d.pages)||!d.pages.length||d.pages.length>300||!Array.isArray(d.excluded)||!Array.isArray(d.selected))return fail();
  const {w,h}=sizes[d.format],guests=new Set(sources.map(s=>s.guestId)),ids=new Set<string>();
  if(d.excluded.length>2000||d.selected.length>2000||d.excluded.some(id=>!guests.has(id))||d.selected.some(id=>!sources.some(s=>s.id===id)))return fail();
  const id=(v:string)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v)||ids.has(v))fail();ids.add(v);return v;};
  const color=(v:string)=>{if(!/^#[a-f0-9]{6}$/i.test(v))fail();return v;};
  const profile=d.profile;
  if(profile?.cover&&([profile.cover.widthMm,profile.cover.heightMm].some(n=>n!==null&&!finite(n,10,2000))))return fail();
  if(!profile||!finite(profile.bleed,0,10)||!finite(profile.safe,0,25)||!finite(profile.binding,0,25)||!finite(profile.minDpi,72,600)||typeof profile.colorProfile!=='string'||profile.colorProfile.length>200||typeof profile.pdfRequirement!=='string'||profile.pdfRequirement.length>200||!profile.cover||typeof profile.cover.paper!=='string'||profile.cover.paper.length>200||typeof profile.cover.specification!=='string'||profile.cover.specification.length>500||(profile.cover.spineMm!==null&&!finite(profile.cover.spineMm,0,100)))return fail();
  const pages=d.pages.map(p=>{
    if(!p||typeof p.locked!=='boolean'||!Array.isArray(p.elements)||p.elements.length>60) return fail();
    return {id:id(p.id),background:color(p.background),locked:p.locked,elements:p.elements.map(e=>{
      const s=sources.find(s=>s.id===e.sourceId);if(!s||!d.selected.includes(e.sourceId)||!['photo','text'].includes(e.kind)||typeof e.locked!=='boolean'||(e.pinToPage!==undefined&&typeof e.pinToPage!=='boolean')||(e.rotation!==undefined&&!finite(e.rotation,-360,360))||!finite(e.x,0,w)||!finite(e.y,0,h)||!finite(e.w,1,w)||!finite(e.h,1,h)||e.x+e.w>w+.1||e.y+e.h>h+.1||!finite(e.fontSize,10,48))return fail();
      const validPart=Number.isInteger(e.partStart)&&Number.isInteger(e.partEnd)&&e.partStart!>=0&&e.partEnd!>e.partStart!&&e.partEnd!<=s.message.length&&s.message.slice(e.partStart,e.partEnd)===e.text;
      if(e.textRole!==undefined&&(e.kind!=='text'||!['message','caption'].includes(e.textRole)))return fail();
      if(e.kind==='text'&&(typeof e.text!=='string'||e.text.length>5000||(e.text!==s.message&&e.edited!==true&&!validPart)))return fail();
      if(e.kind==='photo'&&!s.media.some(m=>m.id===e.mediaId&&isPhotoMedia(m)))return fail();
      if(!e.crop||!finite(e.crop.x,0,1)||!finite(e.crop.y,0,1)||!finite(e.crop.w,.05,1)||!finite(e.crop.h,.05,1)||e.crop.x+e.crop.w>1.001||e.crop.y+e.crop.h>1.001||!e.ink||!finite(e.ink.x,-1,1)||!finite(e.ink.y,-1,1)||!finite(e.ink.scale,.1,3))return fail();
      return {id:id(e.id),kind:e.kind,sourceId:e.sourceId,...(e.kind==='photo'?{mediaId:e.mediaId}:{}),x:e.x,y:e.y,w:e.w,h:e.h,locked:e.locked,...(e.pinToPage!==undefined?{pinToPage:e.pinToPage}:{}),...(e.rotation!==undefined?{rotation:e.rotation}:{}),...(e.kind==='text'?{text:e.text,...(e.textRole?{textRole:e.textRole}:{}),edited:e.edited===true,...(validPart?{partStart:e.partStart,partEnd:e.partEnd}:{})}:{}),fontSize:e.fontSize,color:color(e.color),crop:{...e.crop},ink:{...e.ink}};
    })};
  });
  return {schema:1,format:d.format,editionVariant:d.editionVariant||'private',spread:d.spread,selected:[...new Set(d.selected)],excluded:[...new Set(d.excluded)],pages,profile:{...profile,cover:{...profile.cover}}};
}
// Deterministic mock provider: source IDs and allowlisted template only, never generated prose/photos.
export interface PlanProvider {name:string;plan(sources:Source[],format:Draft['format']):Promise<{sourceId:string;template:'portrait-card'|'wide-card'}[]>}
export const mockProvider:PlanProvider={name:'Deterministic mock – nincs bekötött AI',async plan(sources,format){return sources.map(s=>({sourceId:s.id,template:format==='A5'?'portrait-card':'wide-card'}));}};
export const blankElement=(id:string,sourceId:string):Element=>({id,sourceId,kind:'text',x:12,y:12,w:100,h:30,locked:false,fontSize:12,color:'#332d30',crop:{x:0,y:0,w:1,h:1},ink:{x:0,y:0,scale:1}});
