import {useCallback,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {hasReviewFlag,reviewCategoryLabels,reviewDecisionLabels,reviewPending,reviewRequest} from './content-review';
import type {ReviewCategory,ReviewData,ReviewDecision,ReviewItem,ReviewScope} from './content-review';
import './content-review.css';

const categories=Object.keys(reviewCategoryLabels) as ReviewCategory[];
const decisions=Object.keys(reviewDecisionLabels) as ReviewDecision[];
const date=(value?:string)=>value?new Date(value).toLocaleString('hu-HU'):'Nincs rögzítve';
function scopeText(scope?:ReviewScope){if(!scope||scope.kind==='unspecified')return 'Nem meghatározott terjedelem';if(scope.kind==='full')return 'Teljes tartalom';return `Részleges átnézés${scope.startSeconds!==undefined?' · '+scope.startSeconds+'–'+(scope.endSeconds??'?')+' másodperc':''}${scope.note?' · '+scope.note:''}`;}

export function ReviewImage({covered,src,alt,children}:{covered:boolean;src:string;alt:string;children?:ReactNode}){
  const [revealed,setRevealed]=useState(false);
  if(covered&&!revealed)return <div className="review-covered"><p>A jelzett vagy még nem ellenőrzött kép előnézete fedve van.</p><button type="button" onClick={()=>setRevealed(true)}>Kép megtekintése</button></div>;
  return <div className="review-image">{children||<img src={src} alt={alt} loading="lazy"/>}{covered&&<button type="button" onClick={()=>setRevealed(false)}>Kép ismételt lefedése</button>}</div>;
}

export function ContentReviewPanel({bookId,versionId,onData,onChanged,onBeforeChange}:{bookId:string;versionId?:string|null;onData?:(data:ReviewData)=>void;onChanged?:()=>Promise<void>|void;onBeforeChange?:()=>Promise<unknown>|unknown}){
  const root='/api/book-workflow/'+bookId+'/reviews',[data,setData]=useState<ReviewData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[category,setCategory]=useState('all'),[status,setStatus]=useState('pending');
  const onDataRef=useRef(onData),onChangedRef=useRef(onChanged),onBeforeChangeRef=useRef(onBeforeChange);
  useEffect(()=>{onDataRef.current=onData;onChangedRef.current=onChanged;onBeforeChangeRef.current=onBeforeChange;},[onData,onChanged,onBeforeChange]);
  const load=useCallback(async()=>{const result=await reviewRequest<ReviewData>(root+(versionId?'?versionId='+encodeURIComponent(versionId):''));setData(result);onDataRef.current?.(result);setError('');},[root,versionId]);
  useEffect(()=>{let active=true;void reviewRequest<ReviewData>(root+(versionId?'?versionId='+encodeURIComponent(versionId):'')).then(result=>{if(active){setData(result);onDataRef.current?.(result);}}).catch(reason=>{if(active)setError(reason.message);});return()=>{active=false;};},[root,versionId]);
  async function changed(){await load();await onChangedRef.current?.();}
  const filtered=data?.items.filter(item=>(category==='all'||item.categories.includes(category as ReviewCategory))&&(status==='all'||status==='pending'&&reviewPending(item)||status==='resolved'&&hasReviewFlag(item)&&!reviewPending(item)||status==='unflagged'&&!hasReviewFlag(item)))||[];
  return <section id="tartalom-atnezes" className="content-review" aria-label="Átnézendő tartalmak">
    <h2>Átnézendő tartalmak</h2>
    <p>A jelzés átnézési kérés, nem biztos minősítés. Nincs automatikus tartalomfelismerés; a jelzés nélküli emlék nem számít ellenőrzöttnek.</p>
    {error&&<p role="alert">{error}</p>}
    {data?<><p role="status"><strong>{data.pendingCount} függő tétel</strong> · {data.totalCount} jelzett · {data.targetCount??data.items.length} átnézhető tartalom · állapot: {data.revision}</p><div className="review-filters"><label>Átnézési állapot<select value={status} onChange={event=>setStatus(event.target.value)}><option value="pending">Döntésre vár</option><option value="all">Minden tartalom</option><option value="resolved">Tulajdonosi döntéssel</option><option value="unflagged">Nincs jelzés – nem ellenőrzött</option></select></label><label>Jelzés kategóriája<select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">Minden kategória</option>{categories.map(key=><option key={key} value={key}>{reviewCategoryLabels[key]}</option>)}</select></label></div>
      <p>A függő tartalom nem kerülhet új rendezésbe vagy kiadásba. A „Felhasználható” döntés nem ad megosztási jogot. A már letöltött PDF-ek és másolatok nem vonhatók vissza.</p>
      {!filtered.length&&<p>{status==='pending'?'Nincs ebben a szűrésben döntésre váró jelzés. Ez nem jelenti az összes tartalom ellenőrzését.':'Nincs a szűrésnek megfelelő tartalom.'}</p>}
      <fieldset className="review-items" disabled={busy}><legend>Átnézhető tételek</legend>{filtered.map(item=><ReviewCard key={item.id+':'+item.contentHash+':'+(item.decidedAt||'')+':'+item.flags.length} item={item} revision={data.revision} root={root} onChanged={changed} onBeforeChange={()=>onBeforeChangeRef.current?.()} onBusyChange={setBusy}/>)}</fieldset>
      <p>Hang és videó ebben a pilotban nem tölthető fel és nem játszható le. Egy esetleges részleges jelzés nem jelenti a teljes felvétel átnézését.</p>
      <p>Törlés: ebben a pilotban nincs meglévő, megerősítéssel használható forrástörlés. A „Kihagyás” megőrzi az eredeti tartalmat és külön döntésként naplózódik.</p>
    </>:!error&&<p role="status">Átnézési lista betöltése…</p>}
    <button type="button" disabled={busy} onClick={()=>{setBusy(true);void changed().catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}>Átnézési lista frissítése</button>
  </section>;
}

function ReviewCard({item,revision,root,onChanged,onBeforeChange,onBusyChange}:{item:ReviewItem;revision:number;root:string;onChanged:()=>Promise<void>;onBeforeChange:()=>Promise<unknown>|unknown;onBusyChange:(busy:boolean)=>void}){
  const [selected,setSelected]=useState<ReviewCategory[]>([]),[reason,setReason]=useState(''),[note,setNote]=useState(''),[scope,setScope]=useState<ReviewScope>(()=>structuredClone(item.scope||{kind:item.kind==='audio'||item.kind==='video'?'unspecified':'full'})),[decision,setDecision]=useState<ReviewDecision>(item.decision||'allowed'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<{signature:string;key:string}|null>(null),guard=useRef(false);
  async function send(kind:'flag'|'decision'){
    if(guard.current)return;guard.current=true;setBusy(true);onBusyChange(true);setError('');
    const body=kind==='flag'?{sourceId:item.sourceId,expectedContentHash:item.contentHash,...(item.mediaId?{mediaId:item.mediaId}:{}),...(item.versionId?{versionId:item.versionId}:{}),...(item.elementId?{elementId:item.elementId}:{}),categories:selected,reason,scope}:{decision,note,scope,expectedRevision:revision};
    const signature=JSON.stringify({kind,id:item.id,body});if(pending.current?.signature!==signature)pending.current={signature,key:crypto.randomUUID()};
    try{await onBeforeChange();await reviewRequest(kind==='flag'?root:root+'/'+encodeURIComponent(item.id)+'/decision',{...body,key:pending.current.key});pending.current=null;await onChanged();}catch(failure){setError((failure as Error).message);}finally{guard.current=false;setBusy(false);onBusyChange(false);}
  }
  const flagged=hasReviewFlag(item),kindLabel={text:'Szöveg',photo:'Kép',audio:'Hang',video:'Videó'}[item.kind];
  return <article className="review-card">
    <h3>{item.contributor||'Beküldő'} · {kindLabel}</h3><p className="review-identity">Forrás: {item.sourceId.slice(0,8)}{item.mediaId?' · média: '+item.mediaId.slice(0,8):''}{item.versionId?' · változat: '+item.versionId.slice(0,8):''}</p>
    <p><strong>{reviewPending(item)?'Tulajdonosi döntésre vár':item.decision?reviewDecisionLabels[item.decision]:'Nincs jelzés – nem ellenőrzött'}</strong></p>
    {item.contentChanged&&<p role="alert">A korábbi döntés óta változott a tartalom. Új átnézés szükséges.</p>}
    {item.kind==='photo'&&item.previewUrl&&<ReviewImage key={item.contentHash+':'+(item.decision||'')} covered={flagged} src={item.previewUrl} alt={'Átnézendő kép – '+item.contributor}/>}
    {item.kind==='text'&&<blockquote className="review-text">{item.text||'A szöveg előnézete nem elérhető.'}</blockquote>}
    {(item.kind==='audio'||item.kind==='video')&&<p>A felvétel lejátszása nem támogatott. Nem készült automatikus átirat vagy teljes körű értelmezés.</p>}
    <p>Átnézés terjedelme: {scopeText(item.scope)}.</p>
    {item.affectedPages?.length>0&&<details><summary>Érintett könyvoldalak</summary>{item.affectedPages.map(affected=><p key={affected.versionId}>Változat {affected.versionId.slice(0,8)}: {affected.pageNumbers.join(', ')}. oldal{affected.approved?' · korábban jóváhagyott':''}</p>)}</details>}
    <details><summary>Jelzések és döntési előzmény ({item.flags.length+(item.history?.length||0)})</summary>{item.flags.map(flag=><div key={flag.id}><p><strong>{reviewCategoryLabels[flag.category]}</strong> · {flag.origin==='manual'?'Tulajdonosi jelzés':'Segédeszköz jelzése – bizonytalan'}</p><p>{flag.reason||'Nincs külön indoklás.'}</p><p>{date(flag.createdAt)} · {scopeText(flag.scope)}</p></div>)}{item.history?.map(entry=><div key={entry.revision}><p>Tulajdonosi döntés: {reviewDecisionLabels[entry.decision]} · {date(entry.createdAt)} · {entry.actorId||'Tulajdonos'}.</p><p>{scopeText(entry.scope)}{entry.note?' · '+entry.note:''}</p></div>)}</details>
    <fieldset disabled={busy}><legend>Kézi jelzés vagy tulajdonosi döntés</legend>
      <label>Átnézés terjedelme<select aria-label="Átnézés terjedelme" value={scope.kind} onChange={event=>setScope({kind:event.target.value as ReviewScope['kind']})}><option value="full">Teljes tartalom</option><option value="partial">Csak egy részlet</option><option value="unspecified">Nem meghatározott</option></select></label>
      {scope.kind==='partial'&&<><label>Átnézett részlet leírása<input maxLength={500} value={scope.note||''} onChange={event=>setScope({...scope,note:event.target.value})}/></label>{(item.kind==='audio'||item.kind==='video')&&<div className="review-filters"><label>Kezdet (másodperc)<input type="number" min={0} value={scope.startSeconds??''} onChange={event=>setScope({...scope,startSeconds:event.target.value===''?undefined:Number(event.target.value)})}/></label><label>Vég (másodperc)<input type="number" min={0} value={scope.endSeconds??''} onChange={event=>setScope({...scope,endSeconds:event.target.value===''?undefined:Number(event.target.value)})}/></label></div>}</>}
      {scope.kind!=='full'&&<p>A részleges vagy nem meghatározott átnézés nem oldja fel a teljes tartalom függő állapotát.</p>}
      <details><summary>Új jelzés hozzáadása</summary>{categories.map(category=><label key={category}><input type="checkbox" checked={selected.includes(category)} onChange={event=>setSelected(event.target.checked?[...selected,category]:selected.filter(value=>value!==category))}/>{reviewCategoryLabels[category]}</label>)}<label>Jelzés indoka<textarea maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button type="button" disabled={!selected.length} onClick={()=>void send('flag')}>Jelzés mentése</button></details>
      {flagged&&<><label>Tulajdonosi döntés<select aria-label="Tulajdonosi döntés" value={decision} onChange={event=>setDecision(event.target.value as ReviewDecision)}>{decisions.map(value=><option key={value} value={value}>{reviewDecisionLabels[value]}</option>)}</select></label><label>Döntés indoklása<textarea maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label><button type="button" onClick={()=>void send('decision')}>Tulajdonosi döntés mentése</button></>}
      <button type="button" disabled title="Ebben a pilotban nincs forrástörlési folyamat.">Törlés – nem érhető el ebben a pilotban</button>
    </fieldset>{error&&<p role="alert">{error}</p>}
  </article>;
}
