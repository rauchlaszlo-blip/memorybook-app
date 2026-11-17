import PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { blankElement, sizes, validateDraft, isPhotoMedia } from '../../shared/montage';
import type { Draft, Source, PlanProvider, Element, Page } from '../../shared/montage';
export const fontPath=resolve('public/fonts/DejaVuSans.ttf');
export const pt=72/25.4;
const measureDoc=new PDFDocument({autoFirstPage:false});measureDoc.font(fontPath);
export function textHeight(text:string,width:number,fontSize:number){measureDoc.fontSize(fontSize);return measureDoc.heightOfString(text,{width:width*pt,lineGap:0})/pt;}
export async function arrange(input:Draft,sources:Source[],provider:PlanProvider):Promise<Draft>{
  const d=structuredClone(input),{w,h}=sizes[d.format],margin=Math.max(12,d.profile.safe+d.profile.binding);
  // A deterministic fallback keeps pinned objects on their original page as well.
  // Keeping their geometry is conservative; pinning itself does not imply a layout lock.
  const locked=d.pages.filter(p=>p.locked||p.elements.some(e=>e.locked||e.pinToPage)).map(p=>p.locked?p:{...p,elements:p.elements.filter(e=>e.locked||e.pinToPage)});
  const lockedElements=locked.flatMap(p=>p.elements);
  const chosen=sources.filter(s=>d.selected.includes(s.id)&&!d.excluded.includes(s.guestId));
  if(!chosen.length&&!locked.length)throw new Error('INVALID_PLAN');
  const plan=await provider.plan(chosen,d.format);
  if(!Array.isArray(plan)||plan.length!==chosen.length||new Set(plan.map(p=>p.sourceId)).size!==chosen.length||plan.some(p=>!chosen.some(s=>s.id===p.sourceId)||!['portrait-card','wide-card'].includes(p.template)))throw new Error('INVALID_PLAN');
  const pages:Page[]=[...locked];
  for(const item of plan){
    const s=chosen.find(s=>s.id===item.sourceId)!;
    const last=pages.length>locked.length?pages[pages.length-1]:null;
    const bottom=last?Math.max(margin,...last.elements.map(e=>e.y+e.h))+12:h;
    let page:Page;
    let y=margin;
    if(d.format==='A4'&&last&&bottom<h-margin-40){page=last;y=bottom;}
    else {page={id:randomUUID(),background:'#fffaf4',locked:false,elements:[]};pages.push(page);}
    const width=w-2*margin;
    for(const media of s.media.filter(isPhotoMedia)){
      const photoHeight=d.format==='A5'?65:90;
      if(y+photoHeight>h-margin){page={id:randomUUID(),background:'#fffaf4',locked:false,elements:[]};pages.push(page);y=margin;}
      const aspect=media.width/media.height,fitW=Math.min(width,photoHeight*aspect),fitH=fitW/aspect;
      page.elements.push({...blankElement(randomUUID(),s.id),kind:'photo',mediaId:media.id,x:margin+(width-fitW)/2,y,w:fitW,h:fitH});y+=fitH+8;
    }
    let start=0;
    while(start<s.message.length){
      const available=h-margin-y-10;
      if(available<25){page={id:randomUUID(),background:'#fffaf4',locked:false,elements:[]};pages.push(page);y=margin;continue;}
      let lo=start+1,hi=s.message.length,end=start;
      if(textHeight(s.message.slice(start),width,12)<=available){end=s.message.length;lo=hi+1;}
      while(lo<=hi){const mid=Math.floor((lo+hi)/2);if(textHeight(s.message.slice(start,mid),width,12)<=available){end=mid;lo=mid+1;}else hi=mid-1;}
      if(end===start)throw new Error('TEXT_NEEDS_MANUAL_LAYOUT');
      // Keep contiguous source ranges; splitting does not remove/rewrite any character.
      const text=s.message.slice(start,end),height=textHeight(text,width,12)+9;
      page.elements.push({...blankElement(randomUUID(),s.id),text,partStart:start,partEnd:end,x:margin,y,w:width,h:height});start=end;y+=height+5;
    }
  }
  if(!pages.length)pages.push({id:randomUUID(),background:'#fffaf4',locked:false,elements:[]});
  const generated=pages.slice(locked.length).map(p=>({...p,elements:p.elements.filter(e=>!lockedElements.some(l=>l.sourceId===e.sourceId&&l.kind===e.kind&&(e.kind==='photo'?l.mediaId===e.mediaId:l.text===e.text)))})).filter(p=>p.elements.length);
  const result=[...locked,...generated];if(!result.length)result.push(pages[0]);
  return validateDraft({...d,pages:result},sources);
}
export function preflight(d:Draft,sources:Source[]){
  const problems:{page:number;element:string;severity:'error'|'warning';message:string}[]=[];
  d.pages.forEach((p,i)=>p.elements.forEach((e:Element)=>{
    const add=(severity:'error'|'warning',message:string)=>problems.push({page:i+1,element:e.id,severity,message});
    if(e.kind==='text'&&textHeight(e.text||'',e.w,e.fontSize)+7>e.h+.5)add('error','A szöveg túlfut. Növeld a szövegdobozt vagy adj hozzá oldalt.');
    const size=sizes[d.format],inner=d.profile.safe+d.profile.binding;
    const angle=(e.rotation||0)*Math.PI/180,cx=e.x+e.w/2,cy=e.y+e.h/2;
    const halfW=(Math.abs(e.w*Math.cos(angle))+Math.abs(e.h*Math.sin(angle)))/2;
    const halfH=(Math.abs(e.w*Math.sin(angle))+Math.abs(e.h*Math.cos(angle)))/2;
    if(cx-halfW<inner||cy-halfH<d.profile.safe||cx+halfW>size.w-d.profile.safe||cy+halfH>size.h-d.profile.safe)add('warning','Az elem a biztonsági vagy kötésmargóba ér (forgatással együtt).');
    if(cx-halfW<0||cy-halfH<0||cx+halfW>size.w||cy+halfH>size.h)add('error','Az elforgatott elem a kész oldalméreten túlra ér.');
    if(e.kind==='photo'){
      const m=sources.find(s=>s.id===e.sourceId)?.media.find(m=>m.id===e.mediaId);
      if(!m)add('error','A hivatkozott média hiányzik a feldolgozási pillanatképből.');
      if(m&&!isPhotoMedia(m))add('error','Hang vagy videó nem használható fotóként a PDF-ben.');
      if(m&&isPhotoMedia(m)){const dpi=Math.min(Math.max(300,d.profile.minDpi),m.width*e.crop.w/(e.w/25.4),m.height*e.crop.h/(e.h/25.4));if(dpi<d.profile.minDpi)add('warning',`Alacsony tényleges felbontás: ${Math.round(dpi)} DPI (kivágás után).`);
        const b=m.inkBounds;if(b){const x=e.ink.x+b.x*e.ink.scale,y=e.ink.y+b.y*e.ink.scale;if(x<e.crop.x||y<e.crop.y||x+b.w*e.ink.scale>e.crop.x+e.crop.w||y+b.h*e.ink.scale>e.crop.y+e.crop.h)add('warning','A kézírás vagy rajz egy része a kivágáson kívülre kerül. Ellenőrizd a rajz helyzetét.');}
      }
    }
  }));
  const recordings=sources.filter(s=>d.selected.includes(s.id)&&!d.excluded.includes(s.guestId)).flatMap(s=>s.media.filter(m=>!isPhotoMedia(m)));
  if(recordings.length)problems.push({page:1,element:'recordings-not-embedded',severity:'warning',message:`${recordings.length} hang- vagy videófelvétel az eredeti gyűjteményben megmarad; a PDF nem tartalmazza, és nem készül hozzá automatikus átirat vagy QR-kód.`});
  return problems;
}
