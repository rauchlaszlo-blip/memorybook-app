import { useRef, useState } from 'react';
import type { PointerEvent, CSSProperties } from 'react';
import { emptyAnnotation, inkColors, inkWidths, strokePath } from '../../shared/photo-annotation';
import type { Annotation, InkStroke } from '../../shared/photo-annotation';
import { drawingCopy } from './drawing-copy';
import type { AppLanguage } from '../i18n';

export function Ink({ layer, aspect }: { layer: Annotation; aspect: number }) {
  const w = 1000, h = w / aspect;
  return <>{layer.strokes.map((s,i) => s.points.length === 1
    ? <circle key={i} cx={s.points[0][0]*w} cy={s.points[0][1]*h} r={s.width*Math.min(w,h)/2} fill={s.color} />
    : <path key={i} d={strokePath(s,w,h)} fill="none" stroke={s.color} strokeWidth={s.width*Math.min(w,h)} strokeLinecap="round" strokeLinejoin="round" />)}</>;
}
export function AnnotatedPreview({ src, layer, alt, onError }: { src:string; layer:Annotation; alt:string; onError:()=>void }) {
  const [aspect,setAspect] = useState(1);
  return <div className="wedding-annotated-preview" style={{maxWidth:`min(100%, ${360*aspect}px)`}}>
    <img src={src} alt={alt} onError={onError} onLoad={e=>setAspect(e.currentTarget.naturalWidth/e.currentTarget.naturalHeight)} />
    <svg aria-hidden="true" viewBox={`0 0 1000 ${1000/aspect}`}><Ink layer={layer} aspect={aspect}/></svg>
  </div>;
}
export function PhotoDrawing({ src, initial, language, onDone, onCancel }: { src:string; initial:Annotation; language:AppLanguage; onDone:(a:Annotation)=>void; onCancel:()=>void }) {
  const t = drawingCopy[language];
  const [layer,setLayer] = useState(initial);
  const [undo,setUndo] = useState<Annotation[]>([]), [redo,setRedo] = useState<Annotation[]>([]);
  const [color,setColor] = useState<string>(inkColors[0]), [width,setWidth] = useState<number>(inkWidths[1]);
  const [aspect,setAspect] = useState(1), [ready,setReady] = useState(false), [limit,setLimit] = useState(false);
  const active = useRef<{id:number;stroke:InkStroke}|null>(null);
  const [pending,setPending] = useState<InkStroke|null>(null);
  function replace(next:Annotation) { setUndo(v=>[...v,layer].slice(-50));setRedo([]);setLayer(next); }
  function point(e:PointerEvent<SVGSVGElement>):[number,number] {
    const r=e.currentTarget.getBoundingClientRect();
    const round=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*100000)/100000;
    return [round((e.clientX-r.left)/r.width),round((e.clientY-r.top)/r.height)];
  }
  function start(e:PointerEvent<SVGSVGElement>) {
    if (!ready || active.current || !e.isPrimary || e.button!==0) return;
    const count=layer.strokes.reduce((n,s)=>n+s.points.length,0);
    if(layer.strokes.length>=200 || count>=10000){setLimit(true);return;}
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setLimit(false);
    active.current={id:e.pointerId,stroke:{color,width,points:[point(e)]}};setPending(active.current.stroke);
  }
  function move(e:PointerEvent<SVGSVGElement>) {
    const a=active.current;if(!a || a.id!==e.pointerId)return;e.preventDefault();
    if(layer.strokes.reduce((n,s)=>n+s.points.length,0)+a.stroke.points.length>=10000){setLimit(true);return;}
    const p=point(e),last=a.stroke.points[a.stroke.points.length-1];if(p[0]===last[0] && p[1]===last[1])return;
    a.stroke={...a.stroke,points:[...a.stroke.points,p]};setPending(a.stroke);
  }
  function finish(e:PointerEvent<SVGSVGElement>,cancel=false) {
    if(active.current?.id!==e.pointerId)return;
    if(!cancel)replace({...layer,strokes:[...layer.strokes,active.current.stroke]});
    active.current=null;setPending(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return <div className="wedding-drawing" role="dialog" aria-modal="true" aria-label={t.edit} onKeyDown={e=>{if(e.key==='Escape')onCancel();}}>
    <div className="wedding-drawing-tools">
      <strong>{t.edit}</strong><p>{t.hint}</p>
      <div>{inkColors.map((c,i)=><button autoFocus={i===0} type="button" key={c} aria-label={t.colors[i]} aria-pressed={color===c} onClick={()=>setColor(c)}><span className="wedding-ink-swatch" style={{background:c}}/>{t.colors[i]}</button>)}</div>
      <div>{inkWidths.map((w,i)=><button type="button" key={w} aria-pressed={width===w} onClick={()=>setWidth(w)}>{t.widths[i]}</button>)}</div>
      <div><button type="button" disabled={!undo.length || !!pending} onClick={()=>{setRedo(v=>[...v,layer]);setLayer(undo[undo.length-1]);setUndo(v=>v.slice(0,-1));}}>{t.undo}</button>
      <button type="button" disabled={!redo.length || !!pending} onClick={()=>{setUndo(v=>[...v,layer]);setLayer(redo[redo.length-1]);setRedo(v=>v.slice(0,-1));}}>{t.redo}</button>
      <button type="button" disabled={!layer.strokes.length || !!pending} onClick={()=>{if(window.confirm(t.confirm))replace(emptyAnnotation());}}>{t.clear}</button></div>
      {limit && <p role="alert">{t.limit}</p>}
    </div>
    <div className="wedding-drawing-surface" style={{'--photo-aspect':aspect} as CSSProperties}>
      <img src={src} alt="" draggable={false} onLoad={e=>{setAspect(e.currentTarget.naturalWidth/e.currentTarget.naturalHeight);setReady(true);}} />
      <svg role="img" aria-label={t.canvas} viewBox={`0 0 1000 ${1000/aspect}`} onPointerDown={start} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)}>
        <Ink layer={pending?{...layer,strokes:[...layer.strokes,pending]}:layer} aspect={aspect}/>
      </svg>
    </div>
    <div className="wedding-drawing-footer"><button type="button" disabled={!ready || !!pending} onClick={()=>onDone(layer)}>{t.done}</button><button type="button" onClick={onCancel}>{t.cancel}</button></div>
  </div>;
}
