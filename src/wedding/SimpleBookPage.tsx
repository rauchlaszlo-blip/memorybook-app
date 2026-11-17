import {useCallback,useEffect,useState} from 'react';
import type {Draft,Source} from '../../shared/montage';
import type {ContentReviewStatus} from './content-review';
import {BookWorkflowPanel} from './BookWorkflowPanel';
import './montage.css';
type Version={id:string;draft:Draft;snapshotId:string|null;approved_at:string|null;coverage:{covered:number;missing:string[];mediaOnly:string[]};preflight:{severity:string;message:string}[];contentReview?:ContentReviewStatus};
type Book={book:{title:string};latestVersionId:string|null;snapshots:{id:string;created_at:string}[]};
async function read<T>(url:string):Promise<T>{const response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw new Error('A könyv most nem tölthető be. A mentett változatok megmaradtak.');return response.json();}
export function SimpleBookPage({bookId}:{bookId:string}){
  const root='/api/book-workflow/'+bookId,[book,setBook]=useState<Book|null>(null),[version,setVersion]=useState<Version|null>(null),[sources,setSources]=useState<Source[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const load=useCallback(async()=>{setBusy(true);setError('');try{const result=await read<Book>(root);setBook(result);setVersion(result.latestVersionId?await read<Version>(root+'/versions/'+result.latestVersionId):null);const all:Source[]=[];let offset:number|null=0;while(offset!==null){const page:{submissions:Source[];nextOffset:number|null}=await read<{submissions:Source[];nextOffset:number|null}>(root+'/submissions?limit=50&offset='+offset);all.push(...page.submissions);offset=page.nextOffset;}setSources(all);}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[root]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  return <main className="montage simple-book"><a href={'/wedding/books/'+bookId}>← Vissza az emlékekhez</a><h1>{book?.book.title||'A könyvetek'}</h1><p>A ChatGPT az engedélyezett emlékekből szerkeszthető könyvtervezetet készít. Te átnézed, módosítod és jóváhagyod; utána készülhet el az ellenőrző PDF.</p>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">A mentett könyvváltozat betöltése…</p>}
    <section><h2>{version?'Mentett könyvtervezet':'Még nincs könyvtervezet'}</h2>{version?<><p>{version.draft.pages.length} oldal · {version.draft.format} · {version.approved_at?'Jóváhagyott kiadás':'Átnézésre és jóváhagyásra vár'}</p><p>{version.coverage.covered} beküldő üzenete szerepel · {version.coverage.missing.length} hiányzó beküldő.</p>{version.preflight.length>0&&<p>A szerkesztőben {version.preflight.length} ellenőrzési észrevétel látható.</p>}</>:<p>Rögzítsd a feldolgozandó emlékeket, majd kérd a ChatGPT-t a könyv összeállítására. Kézzel is létrehozhatsz tervezetet.</p>}<a className="montage-download" href="?szerkesztes=1">{version?'Tervezet megnyitása és javítása':'Kézi szerkesztő megnyitása'}</a><button disabled={busy} onClick={()=>void load()}>Mentett terv frissítése</button></section>
    <BookWorkflowPanel bookId={bookId} snapshotId={version?.snapshotId||null} snapshots={book?.snapshots||[]} sources={sources} versionId={version?.id||null} approved={!!version?.approved_at} contentReview={version?.contentReview} onSnapshot={async()=>load()}/>
    <p>A megnyitás és a frissítés nem készít új rendezést, és nem módosítja a korábbi könyvtervet.</p><small>A PDF/X-megfelelőség, a nyomdai profil és a fizikai mintanyomat még külön ellenőrzést igényel.</small>
  </main>;
}
