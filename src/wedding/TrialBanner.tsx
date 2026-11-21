import {useState} from 'react';
import type {TrialAccess} from './trial-access';
import './trial.css';

export function TrialExit({disabled=false}:{disabled?:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function leave(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/pilot/app-trial/leave',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      if(!response.ok)throw new Error('LEAVE_FAILED');
      window.location.assign('/wedding');
    }catch{setError('Most nem sikerült kilépni a próbából. Próbáld újra.');setBusy(false);}
  }
  return <><button type="button" disabled={disabled||busy} onClick={()=>void leave()}>{busy?'Kilépés…':'Kilépés a próbából'}</button>{error&&<p role="alert">{error}</p>}</>;
}

export function TrialBanner({trial,disabled=false}:{trial:TrialAccess|null|undefined;disabled?:boolean}){
  if(!trial)return null;
  return <aside className="trial-banner" aria-label="Próbamód">
    <strong>Próbamód · fiktív emlékkönyv</strong>
    <p>Ezt a próbakönyvet átnézheted és szerkesztheted. Lejárat: <time dateTime={trial.expiresAt}>{new Date(trial.expiresAt).toLocaleString('hu-HU',{timeZone:'Europe/Budapest'})}</time> (magyar idő).</p>
    <div><a href="/wedding">A próbakönyv áttekintése</a><TrialExit disabled={disabled}/></div>
  </aside>;
}

export function TrialUnavailable(){
  return <aside className="trial-banner" aria-label="Lejárt próbahozzáférés"><p role="alert">A próbahozzáférés lejárt vagy már nem érvényes. Nyisd meg újra az érvényes próbalinket, vagy lépj ki a próbából.</p><TrialExit/></aside>;
}
