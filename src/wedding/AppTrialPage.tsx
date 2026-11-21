import {useEffect,useState} from 'react';
import {TrialExit} from './TrialBanner';
import './wedding.css';

// Capture once before clearing the fragment. The key never enters the request URL,
// local/session storage or visible error messages, including a StrictMode remount.
function captureKey(){
  if(window.location.pathname!=='/wedding/try')return '';
  const key=new URLSearchParams(window.location.hash.slice(1)).get('key')||'';
  if(window.location.hash)window.history.replaceState(null,'',window.location.pathname);
  return key;
}
let trialKey=captureKey(),generation=0;
let redemption:Promise<string>|undefined;
function redeem(){
  redemption??=(async()=>{
    if(!/^[A-Za-z\d_-]{43}$/.test(trialKey))throw new Error('INVALID_LINK');
    const key=trialKey;trialKey='';
    const response=await fetch('/api/pilot/app-trial/redeem',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    if(!response.ok)throw new Error([401,403,404,410].includes(response.status)?'EXPIRED_LINK':'CONNECTION');
    const result=await response.json() as {success?:boolean;bookId?:string;redirectTo?:string};
    if(result.success!==true||!result.bookId||!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(result.bookId)||result.redirectTo!=='/wedding/books/'+result.bookId)throw new Error('INVALID_REPLY');
    return result.redirectTo;
  })();
  return redemption;
}
export function AppTrialPage(){
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    function start(){
      const attempt=generation;
      void redeem().then(path=>{if(active&&attempt===generation)window.location.replace(path);}).catch(cause=>{
        if(active&&attempt===generation)setError(cause instanceof Error&&['EXPIRED_LINK','INVALID_LINK'].includes(cause.message)
          ?'Ez a próbalink lejárt vagy nem érvényes. Nyisd meg a neked adott teljes, érvényes próbalinket.'
          :'Most nem sikerült megnyitni a próbakönyvet. Nyisd meg újra az eredeti próbalinket.');
      });
    }
    function reopen(){
      if(!window.location.hash)return;
      trialKey=captureKey();redemption=undefined;generation++;setError('');start();
    }
    start();window.addEventListener('hashchange',reopen);
    return()=>{active=false;window.removeEventListener('hashchange',reopen);};
  },[]);
  return <main className="wedding"><div className="wedding-shell"><section className="wedding-card">
    <h1>A MemoryBook kipróbálása</h1>
    {error?<><p role="alert">{error}</p><TrialExit/></>:<p role="status">A fiktív próbakönyv megnyitása…</p>}
  </section></div></main>;
}
