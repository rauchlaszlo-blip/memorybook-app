import {useCallback,useEffect,useRef,useState} from 'react';
type Attempt={id:string;kind:'photo'|'audio'|'video';state:'receiving'|'processing'|'uploaded'|'attached'|'failed';stage:string;errorCode:string|null;diagnosticId:string;byteLength:number;createdAt:string;updatedAt:string;mediaId:string|null;retryAvailable:boolean;requiresGuestSubmission:boolean};
const states={receiving:'A fájl fogadása folyamatban',processing:'Feldolgozás alatt',uploaded:'Feltöltve, vendégbeküldésre vár',attached:'Beküldve',failed:'A feldolgozás nem sikerült'},kinds={photo:'Fotó',audio:'Hang',video:'Videó'};
const failures:Record<string,string>={UPLOAD_INTERRUPTED:'A feltöltés megszakadt, nem érkezett meg a teljes fájl.',MEDIA_RETRY_REQUIRED:'A korábbi feldolgozás megszakadt. Az eredeti fájl újra feldolgozható.',PHOTO_TOO_LARGE:'A fotó meghaladja a fájlméretkorlátot.',PHOTO_PIXELS:'A fotó felbontása meghaladja a korlátot.',PHOTO_TYPE:'A kép formátuma nem támogatott.',PHOTO_INVALID:'A képet nem sikerült beolvasni.',MEDIA_TYPE:'Ez a formátum vagy felbontás nem dolgozható fel.',MEDIA_TOO_LARGE:'A fájl meghaladja a méretkorlátot.',MEDIA_DURATION:'A felvétel hosszabb a megengedett 20 másodpercnél.',MEDIA_INVALID:'A felvételt nem sikerült ellenőrizni.',MEDIA_BUSY:'A feldolgozó foglalt volt.',MEDIA_DECODER_UNAVAILABLE:'A médiafeldolgozó nem volt elérhető.',MEDIA_QUOTA:'A médiatárhely megtelt.',PHOTO_QUOTA:'A médiatárhely megtelt.',PHOTO_EXPIRED:'A félbehagyott feltöltés lejárt.'};
export function MediaAttemptsPanel({bookId,reloadToken,onRetried}:{bookId:string;reloadToken:number;onRetried:()=>Promise<void>}){
  const [attempts,setAttempts]=useState<Attempt[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState<string|null>(null);
  const generation=useRef(0),loading=useRef(false),alive=useRef(true),root='/api/wedding/books/'+bookId+'/media-attempts';
  const load=useCallback(async()=>{
    if(loading.current||!alive.current)return;loading.current=true;
    const current=++generation.current;
    try{const response=await fetch(root,{credentials:'same-origin'});if(!response.ok)throw new Error('READ_FAILED');const data=await response.json() as {attempts:Attempt[]};if(alive.current&&current===generation.current){setAttempts(data.attempts);setLoaded(true);setError('');}}
    catch{if(alive.current&&current===generation.current)setError('A feltöltési állapotok most nem kérdezhetők le. A beérkezett emlékek listája ettől külön frissíthető.');}
    finally{loading.current=false;}
  },[root]);
  const invalidate=useCallback(()=>{generation.current++;alive.current=false;},[]);
  useEffect(()=>{alive.current=true;return invalidate;},[invalidate]);
  useEffect(()=>{void Promise.resolve().then(load);},[load,reloadToken]);
  const processing=attempts.some(item=>item.state==='receiving'||item.state==='processing');
  useEffect(()=>{
    if(!processing)return;
    let timer:ReturnType<typeof setInterval>|undefined;
    const schedule=()=>{if(timer)clearInterval(timer);timer=undefined;if(document.visibilityState==='visible')timer=setInterval(()=>void load(),3000);};
    const visible=()=>{schedule();if(document.visibilityState==='visible')void load();};
    schedule();document.addEventListener('visibilitychange',visible);
    return()=>{if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[processing,load]);
  async function retry(item:Attempt){
    if(busy)return;setBusy(item.id);setError('');setNotice('');
    try{
      const response=await fetch(root+'/'+item.id+'/retry',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}),result=await response.json() as {attempt?:Attempt};
      if(!response.ok||!result.attempt)throw new Error('RETRY_FAILED');
      setNotice(result.attempt.state==='uploaded'?'Az eredeti fájl feldolgozása elkészült. A vendégnek még véglegesítenie kell ugyanazt a beküldést.':'A feldolgozás állapota frissült. Ellenőrizd az alábbi eredményt.');
      await load();await onRetried();
    }catch{await load();setError('Nem sikerült befejezni az újrafeldolgozást. Frissítsd az állapotot; a korábbi fájlt nem töröltük.');}
    finally{setBusy(null);}
  }
  const pending=attempts.filter(item=>item.state!=='attached');
  return <section className="wedding-card wedding-media-attempts" aria-label="Feltöltések feldolgozása">
    <h2>Feltöltések feldolgozása{loaded?' ('+pending.length+')':''}</h2><p>A feltöltött fájl csak a vendég végleges beküldése után kerül a beérkezett emlékek közé. Az alábbi tételek még nem kész beküldések.</p>
    <button disabled={!!busy} onClick={()=>void load()}>Feltöltési állapotok frissítése</button>
    {error&&<p className="wedding-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!loaded&&!error&&<p role="status">Feltöltési állapotok betöltése…</p>}{loaded&&!pending.length&&<p>Nincs félbemaradt vagy hibás feltöltés.</p>}
    {pending.map(item=><article key={item.id}><h3>{kinds[item.kind]} · {states[item.state]}</h3>
      <p><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('hu-HU',{timeZone:'Europe/Budapest'})}</time> (magyar idő) · {(item.byteLength/1024/1024).toFixed(2)} MB</p>
      {item.errorCode&&<p>{failures[item.errorCode]||'A feldolgozás hibával megállt.'}</p>}<p>Hiba- és feltöltésazonosító: <code>{item.diagnosticId}</code></p>
      {item.retryAvailable&&<><p>A szerveren megőrzött eredeti fájl újrapróbálható. Ez önmagában nem véglegesít vendégbeküldést.</p><button disabled={!!busy} onClick={()=>void retry(item)}>{busy===item.id?'Újrafeldolgozás…':'Feldolgozás újrapróbálása'}</button></>}
      {item.requiresGuestSubmission&&<p>A vendég a saját oldalán a korábbi feltöltés ellenőrzésével és ugyanannak a beküldésnek az újrapróbálásával folytathatja.</p>}
    </article>)}
  </section>;
}
