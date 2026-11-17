import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import type { Pool } from 'pg';
import type { Draft, Element, Source } from '../../shared/montage';
import { sizes } from '../../shared/montage';
import { annotationSvg } from '../../shared/photo-annotation';
import type { Annotation } from '../../shared/photo-annotation';
import { fontPath,pt } from './montage-layout';
export async function imageWithInk(original:Buffer,layer:Annotation|null,ink:Element['ink']){
  const base=await sharp(original).rotate().png().toBuffer(),meta=await sharp(base).metadata();
  if(!layer)return base;
  const svg=annotationSvg(layer,meta.width!,meta.height!);
  const transformed=svg.replace(/(<svg[^>]*>)(.*)(<\/svg>)/s,`$1<g transform="translate(${ink.x*meta.width!} ${ink.y*meta.height!}) scale(${ink.scale})">$2</g>$3`);
  return sharp(base).composite([{input:Buffer.from(transformed)}]).png().toBuffer();
}
export type FrozenPdfSources={sources:Source[];media:Map<string,{original:Buffer;layer:Annotation|null}>};
export async function proofPdf(d:Draft,bookId:string,versionId:string,pool:Pool,preview=false,frozen?:FrozenPdfSources){
  const doc=new PDFDocument({autoFirstPage:false,info:{Title:'MemoryBook – ellenőrző PDF',Subject:(preview?'Előnézet – még nem jóváhagyott változat ':'Jóváhagyott változat ')+versionId,Author:'MemoryBook tesztpilot'}}),chunks:Buffer[]=[];
  const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.font(fontPath);const {w,h}=sizes[d.format],bleed=d.profile.bleed,pair=d.spread?2:1;
  for(let start=0;start<d.pages.length;start+=pair){
    doc.addPage({size:[(w*pair+bleed*2)*pt,(h+bleed*2)*pt],margin:0});
    // TrimBox expresses the exact finished format even when a trial bleed is set.
    // These boxes are geometry only, not a PDF/X or printing-house certification.
    Object.assign(doc.page.dictionary.data,{
      TrimBox:[bleed*pt,bleed*pt,(bleed+w*pair)*pt,(bleed+h)*pt],
      BleedBox:[0,0,(w*pair+bleed*2)*pt,(h+bleed*2)*pt],
    });
    for(let side=0;side<pair&&start+side<d.pages.length;side++){
      const p=d.pages[start+side],offset=bleed+side*w;doc.save().translate(offset*pt,bleed*pt);
      doc.rect(-bleed*pt,-bleed*pt,(w+bleed*2)*pt,(h+bleed*2)*pt).fill(p.background);
      for(const e of p.elements){
        // The editor and PDF rotate around the same element centre; attached ink is
        // composited in original image coordinates before crop and transformation.
        doc.save();
        if(e.rotation)doc.rotate(e.rotation,{origin:[(e.x+e.w/2)*pt,(e.y+e.h/2)*pt]});
        if(e.kind==='text'){doc.font(fontPath).fontSize(e.fontSize).fillColor(e.color).text(e.text||'',e.x*pt,e.y*pt,{width:e.w*pt,height:(e.h-7)*pt,lineGap:0});}
        else {
          const captured=frozen?.media.get(e.mediaId!);
          const row=frozen?(captured?{original_bytes:captured.original,layer:captured.layer}:null):(await pool.query(`SELECT m.original_bytes,a.layer FROM event_media m LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE m.id=$1 AND m.book_id=$2 AND m.state='attached'`,[e.mediaId,bookId])).rows[0];
          if(!row)throw new Error('MISSING_MEDIA');
          const full=await imageWithInk(row.original_bytes,row.layer,e.ink),meta=await sharp(full).metadata();
          const left=Math.round(e.crop.x*meta.width!),top=Math.round(e.crop.y*meta.height!),width=Math.min(meta.width!-left,Math.round(e.crop.w*meta.width!)),height=Math.min(meta.height!-top,Math.round(e.crop.h*meta.height!));
          const outputDpi=Math.max(300,d.profile.minDpi);
          const bytes=await sharp(full).extract({left,top,width,height}).resize({width:Math.min(width,Math.ceil(e.w/25.4*outputDpi)),height:Math.min(height,Math.ceil(e.h/25.4*outputDpi)),fit:'fill'}).flatten({background:'#fff'}).jpeg({quality:92}).toBuffer();
          doc.image(bytes,e.x*pt,e.y*pt,{width:e.w*pt,height:e.h*pt});
        }
        doc.restore();
      }
      doc.font(fontPath).fontSize(7).fillColor('#777777').text(`${preview?'Előnézet – jóváhagyásra vár':'Ellenőrző PDF'} • ${start+side+1} • ${versionId.slice(0,8)}`,8*pt,(h-6)*pt,{lineBreak:false});doc.restore();
    }
  }
  doc.end();return result;
}
