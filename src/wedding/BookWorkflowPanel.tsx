import {useCallback,useEffect,useRef,useState} from 'react';
import type {Source} from '../../shared/montage';
import type {ContentReviewStatus} from './content-review';

type Snapshot={id:string;created_at:string};
type Job={id:string;state?:string;status?:string;error?:string|null;last_error?:string|null;error_code?:string|null;version_id?:string;attempts?:number;withheld?:boolean;downloadPath?:string|null;contentReview?:ContentReviewStatus};
type Grant={id:string;client_name:string;created_at:string;expires_at:string;revoked_at:string|null};
const exportErrors:Record<string,string>={CONTENT_REVIEW_REQUIRED:'A mentett változat tartalmi döntéseit újra jóvá kell hagyni.',CONTENT_REVIEW_BLOCKED:'A PDF átnézésre váró vagy ebben a kiadásban nem használható tartalmat tartalmaz.',CONTENT_REVIEW_CHANGED:'A tartalmi döntések megváltoztak; új átnézés szükséges.',EXPORT_RENDER_FAILED:'A PDF összeállítása megszakadt.',EXPORT_RETRY_EXHAUSTED:'A három automatikus próbálkozás elfogyott.',MISSING_MEDIA:'A kiadás egyik képe nem érhető el.',EDITION_INTEGRITY:'A rögzített kiadás ellenőrzése eltérést talált.',EXPORT_STORAGE_LIMIT:'A pilot PDF-tárhelye megtelt.',EXPORT_FILE_TOO_LARGE:'Az elkészült PDF meghaladja a pilot fájlméretkorlátját.'};
async function request<T>(url:string,body?:unknown):Promise<T>{
  const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok){const result=await response.json().catch(()=>({error:''}));throw new Error(result.error==='APPROVE_FIRST'?'Előbb hagyd jóvá a mentett könyvváltozatot.':exportErrors[result.error]||'A művelet nem sikerült. Az anyagok megmaradtak; próbáld újra.');}
  return response.json();
}

export function BookWorkflowPanel({bookId,snapshotId,snapshots,sources,versionId,approved,onSnapshot,contentReview,pendingReviewCount}:{bookId:string;snapshotId:string|null;snapshots:Snapshot[];sources:Source[];versionId:string|null;approved:boolean;contentReview?:ContentReviewStatus|null;pendingReviewCount?:number;onSnapshot:(id:string)=>Promise<void>}){
  const root='/api/book-workflow/'+bookId,[selected,setSelected]=useState<string[]|null>(null),[created,setCreated]=useState<string|null>(null),[job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[grants,setGrants]=useState<Grant[]>([]),[endpoint,setEndpoint]=useState(''),[connectionError,setConnectionError]=useState('');
  const snapshotRequest=useRef<{signature:string;key:string}|null>(null),exportRequest=useRef<{version:string;key:string}|null>(null),guard=useRef(false);
  const loadGrants=useCallback(async()=>{try{const result=await request<{endpoint:string;grants:Grant[]}>('/api/mcp/books/'+bookId+'/grants');setEndpoint(result.endpoint);setGrants(result.grants);setConnectionError('');}catch{setConnectionError('A ChatGPT-kapcsolatok listája most nem elérhető.');}},[bookId]);
  const loadExports=useCallback(async()=>{const result=await request<{exports:Job[]}>(root+'/exports');setJob(result.exports.find(item=>item.version_id===versionId)||result.exports[0]||null);},[root,versionId]);
  useEffect(()=>{void Promise.resolve().then(loadGrants);},[loadGrants]);
  useEffect(()=>{
    let active=true;
    // Jobs created by ChatGPT or another owner device must appear here too.
    void request<{exports:Job[]}>(root+'/exports').then(result=>{if(active)setJob(result.exports.find(item=>item.version_id===versionId)||result.exports[0]||null);}).catch(()=>{if(active)setError('A PDF-munkák listája most nem elérhető. Próbáld frissíteni.');});
    return()=>{active=false;};
  },[root,versionId]);
  const status=job?.state||job?.status;
  useEffect(()=>{
    if(!job||!['queued','running','retry','pending'].includes(status||''))return;
    let active=true;
    const timer=setInterval(()=>{void request<Job>(root+'/exports/'+job.id).then(result=>{if(active)setJob(result);}).catch(()=>{if(active)setError('Az export állapota most nem kérdezhető le. A munka a kiszolgálón folytatódhat.');});},1200);
    return()=>{active=false;clearInterval(timer);};
  },[job,root,status]);
  async function run(action:()=>Promise<void>){if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{guard.current=false;setBusy(false);}}
  const selection=selected||sources.map(source=>source.id),complete=status==='complete'||status==='completed'||status==='succeeded',reviewHeld=!!(contentReview?.blocked||contentReview?.requiresReview),jobHeld=!!(job?.withheld||job?.contentReview?.blocked||job?.contentReview?.requiresReview||job?.downloadPath===null);
  return <section className="workflow-panel" aria-label="ChatGPT és PDF munkafolyamat">
    <h2>ChatGPT-rendezés és PDF</h2><p><a href={'/wedding/books/'+bookId+'/montage?szerkesztes=1#tartalom-atnezes'}>Átnézendő tartalmak{pendingReviewCount!==undefined?' ('+pendingReviewCount+' függő)':''}</a></p>{reviewHeld&&<p role="alert">A PDF átnézés miatt visszatartva. Ellenőrizd az érintett tartalmakat, majd hagyd jóvá a konkrét mentett változatot.</p>}
    {error&&<p role="alert">{error}</p>}
    <details><summary>Feldolgozandó emlékek rögzítése</summary>
      <p>A pillanatkép a kijelölt emlékeket és médiát rögzíti. A később beküldött emlékek külön pillanatképbe kerülhetnek; a mentett könyv nem változik meg ettől.</p>
      <button disabled={busy} onClick={()=>setSelected(sources.map(s=>s.id))}>Összes emlék</button><button disabled={busy} onClick={()=>setSelected([])}>Egyik sem</button>
      <div className="snapshot-sources">{sources.map(source=><label key={source.id}><input type="checkbox" checked={selection.includes(source.id)} onChange={event=>setSelected(event.target.checked?[...selection,source.id]:selection.filter(id=>id!==source.id))}/>{source.name} · {source.id.slice(0,8)} · {source.media.length} kép{source.message?' · üzenet':''}</label>)}</div>
      <button disabled={busy||!selection.length} onClick={()=>void run(async()=>{const signature=JSON.stringify(selection.slice().sort());if(snapshotRequest.current?.signature!==signature)snapshotRequest.current={signature,key:crypto.randomUUID()};const result=await request<{id:string}>(root+'/snapshots',{key:snapshotRequest.current.key,selectedIds:selection});setCreated(result.id);await onSnapshot(result.id);})}>Kijelölt emlékek rögzítése</button>
      <p>{snapshots.length} rögzített pillanatkép. A megnyitott terv alapja: {snapshotId||'még nincs rögzítve'}.</p>
      {created&&<p role="status">Az új feldolgozási pillanatkép: <code>{created}</code>. Kérd a ChatGPT-t, hogy ebből készítsen új tervezetet.</p>}
    </details>
    <details><summary>ChatGPT-kapcsolat és hozzáférések</summary>
      <p>A ChatGPT egyéni alkalmazásának MCP-címe: <code>{endpoint||location.origin+'/mcp'}</code>. A csatlakozáskor jelentkezz be, és jelöld ki az engedélyezett könyvet. A vendég QR-kódja nem ad szerkesztői hozzáférést.</p>
      <p>A kapcsolat visszavonása a hozzá engedélyezett összes könyvre érvényes. A könyv jóváhagyását te végzed itt. A ChatGPT csak a már jóváhagyott kiadás PDF-készítését indíthatja el.</p>
      {connectionError&&<p>{connectionError}</p>}{!connectionError&&!grants.length&&<p>Még nincs ehhez a könyvhöz engedélyezett ChatGPT-kapcsolat.</p>}
      {grants.map(grant=><div key={grant.id}><p>{grant.client_name} · {grant.revoked_at?'Visszavonva':'Engedélyezve'} · lejárat: {new Date(grant.expires_at).toLocaleString('hu-HU')}</p><button disabled={busy||!!grant.revoked_at} onClick={()=>void run(async()=>{await request('/api/mcp/grants/'+grant.id+'/revoke',{});await loadGrants();})}>Hozzáférés visszavonása</button></div>)}
      <button disabled={busy} onClick={()=>void loadGrants()}>Kapcsolatok frissítése</button>
    </details>
    <p>A PDF a jóváhagyott változatból készül. Ez ellenőrző PDF; a nyomdai megfelelőség még egyeztetendő.</p>
    <button disabled={busy} onClick={()=>void run(loadExports)}>Elkészült PDF-ek keresése</button>
    <button disabled={busy||!approved||!versionId||reviewHeld} onClick={()=>void run(async()=>{if(!versionId)return;if(exportRequest.current?.version!==versionId)exportRequest.current={version:versionId,key:crypto.randomUUID()};const result=await request<Job>(root+'/exports',{key:exportRequest.current.key,versionId});setJob(result);try{localStorage.setItem('memorybook-export:'+bookId,result.id);}catch{ /* The server job remains available. */ }})}>Jóváhagyott PDF készítése</button>
    {job&&<div aria-live="polite"><p>PDF-munka: {job.id.slice(0,8)} · {complete?'Elkészült':status==='failed'?'Sikertelen':status==='running'?'Készül':'Várakozik'}</p>{job.version_id&&<p>Kiadási változat: {job.version_id.slice(0,8)}</p>}{complete&&!jobHeld&&!reviewHeld&&<a className="montage-download" href={root+'/exports/'+job.id+'/download'}>Jóváhagyott ellenőrző PDF letöltése</a>}{complete&&(jobHeld||reviewHeld)&&<p>A korábbi PDF letöltése átnézés miatt visszatartva. A már letöltött másolatokat nem lehet visszavonni.</p>}{status==='failed'&&<p role="alert">A PDF nem készült el: {exportErrors[job.error_code||job.last_error||job.error||'']||'Az összeállítás hibával megállt.'} A könyvváltozat megmaradt. {job.attempts||0}/3 próbálkozás történt.</p>}<button disabled={busy} onClick={()=>void run(async()=>setJob(await request<Job>(root+'/exports/'+job.id)))}>PDF állapotának frissítése</button></div>}
  </section>;
}
