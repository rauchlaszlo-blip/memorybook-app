import type { Draft,Page,Source } from '../../shared/montage';
import { sizes } from '../../shared/montage';
export function canvasPage(page:Page,draft:Draft,sources:Source[],bookId:string,snapshotId?:string|null,hiddenElementIds:string[]=[],coveredMediaIds:string[]=[]){
  const f=750/sizes[draft.format].w;
  return {version:'7.4.0',background:page.background,objects:page.elements.map(e=>{
    const common={montageId:e.id,originX:'center',originY:'center',left:(e.x+e.w/2)*f,top:(e.y+e.h/2)*f,angle:e.rotation||0,strokeWidth:0,lockRotation:e.locked,lockMovementX:e.locked,lockMovementY:e.locked,lockScalingX:e.locked,lockScalingY:e.locked};
    const media=sources.find(source=>source.id===e.sourceId)?.media.find(item=>item.id===e.mediaId);
    if(hiddenElementIds.includes(e.id)||e.kind==='photo'&&(!media||coveredMediaIds.includes(e.mediaId!)))return {...common,montageId:undefined,type:'Rect',width:e.w*f,height:e.h*f,fill:'#e8e0e4',stroke:'#aa929e',strokeWidth:1,selectable:false,evented:false};
    if(e.kind==='text'){
      const radians=(e.rotation||0)*Math.PI/180;
      // Fabric measures text height itself. Keep its top-left at the transformed
      // model corner instead of centering it inside the model's reserved box.
      const left=(e.x+e.w/2-e.w/2*Math.cos(radians)+e.h/2*Math.sin(radians))*f;
      const top=(e.y+e.h/2-e.w/2*Math.sin(radians)-e.h/2*Math.cos(radians))*f;
      return {...common,originX:'left',originY:'top',left,top,type:'Textbox',text:e.text||'',width:e.w*f,height:e.h*f,fontSize:e.fontSize/72*25.4*f,fontFamily:'DejaVu Sans',fill:e.color,lineHeight:1.16,editable:false,scaleX:1,scaleY:1};
    }
    const m=media!;
    const previewScale=Math.min(1,1600/m.width,1600/m.height),width=Math.round(m.width*previewScale),height=Math.round(m.height*previewScale);
    const route=snapshotId?`/api/book-workflow/${bookId}/image/${m.id}?snapshotId=${snapshotId}&editionVariant=${draft.editionVariant||'private'}&`:`/api/montage/${bookId}/image/${m.id}?editionVariant=${draft.editionVariant||'private'}&`;
    return {...common,type:'Image',src:route+`x=${e.ink.x}&y=${e.ink.y}&scale=${e.ink.scale}`,crossOrigin:null,width:width*e.crop.w,height:height*e.crop.h,cropX:width*e.crop.x,cropY:height*e.crop.y,scaleX:e.w*f/(width*e.crop.w),scaleY:e.h*f/(height*e.crop.h)};
  })};
}
type CanvasObject={montageId?:string;left:number;top:number;width:number;height:number;scaleX:number;scaleY:number;fontSize?:number;angle?:number};
export function readCanvas(page:Page,draft:Draft,json:{objects?:CanvasObject[]}){
  const f=750/sizes[draft.format].w;
  return {...page,elements:page.elements.map(e=>{
    const o=json.objects?.find(o=>o.montageId===e.id);if(!o)return e;
    if(e.locked)return e;
    const w=o.width*o.scaleX/f,h=e.kind==='text'?Math.max(e.h,o.height*o.scaleY/f+7):o.height*o.scaleY/f;
    const radians=(o.angle||0)*Math.PI/180;
    const x=e.kind==='text'?o.left/f-w/2+w/2*Math.cos(radians)-h/2*Math.sin(radians):o.left/f-w/2;
    const y=e.kind==='text'?o.top/f-h/2+w/2*Math.sin(radians)+h/2*Math.cos(radians):o.top/f-h/2;
    return {...e,x,y,w,h,rotation:o.angle||0,fontSize:e.kind==='text'?(o.fontSize||12)*o.scaleY/f*72/25.4:e.fontSize};
  })};
}
