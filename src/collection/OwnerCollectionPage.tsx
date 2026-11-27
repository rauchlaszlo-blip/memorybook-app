import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {setAppLanguage,SUPPORTED_APP_LANGUAGES} from '../i18n';
import type {AppLanguage} from '../i18n';
import {ownerLocale,useOwnerUiLanguage} from '../ownerUiI18n';
import {ownerCollectionText} from './owner-copy';
import type {OwnerCollectionKey} from './owner-copy';
import './owner-collection.css';
import {useCollectionTrial} from './trial-access';
import {CollectionTrialBanner} from './CollectionTrialBanner';

const API_BASE=['localhost','127.0.0.1'].includes(window.location.hostname)?`http://${window.location.hostname}:3001`:'';
type Choice={id:string;label:string;order:number};
type Settings={revision:number;events:Choice[];locations:Choice[]};
type FileState='uploading'|'processing'|'ready'|'failed'|'removed';
type CollectedFile={id:string;kind:'photo'|'video'|'audio';fileName:string;byteLength:number;sha256?:string|null;state:FileState;actualMimeType?:string|null;width?:number|null;height?:number|null;durationSeconds?:number|null;captureTime?:string|null;captureTimeSource?:string|null;uploadedAt?:string|null;errorCode?:string|null;retryAvailable?:boolean;provenance?:string;originalUrl?:string|null;previewUrl?:string|null;playbackUrl?:string|null};
type Session={groupId:string;state:'draft'|'submitted';submissionId?:string;committedAt?:string|null;createdAt:string;updatedAt:string;sender:string;guestData:Record<string,unknown>;eventIds:string[];locationIds:string[];events:Choice[];locations:Choice[];canvasData:unknown;previewUrl?:string|null;files:CollectedFile[]};
type LegacyPage={id:string;pageNumber:number;state:string;canvasData:unknown;previewUrl?:string|null;updatedAt?:string|null;guestData?:Record<string,unknown>;provenance:string};
type LegacyContribution={id:string;contributorName:string;memoryText:string;photoUrl?:string|null;createdAt?:string|null;provenance:string};
type Collection={book:{id:string;title:string};settings:Settings;sessions:Session[];legacy:{pages:LegacyPage[];contributions:LegacyContribution[]}};
type Filter={sender:string;from:string;to:string;event:string;location:string;state:string};
const emptyFilter:Filter={sender:'',from:'',to:'',event:'',location:'',state:''};
type Copy=(key:OwnerCollectionKey,values?:Record<string,string|number>)=>string;

// Collection media must come through this book's authenticated API. Never
// follow canvas/legacy URLs to remote hosts or present them as verified originals.
function protectedUrl(value:string|null|undefined,bookId:string){
  if(!value)return undefined;
  try{const base=new URL(API_BASE||window.location.origin),url=new URL(value,base);
    return url.origin===base.origin&&url.pathname.startsWith(`/api/my/books/${encodeURIComponent(bookId)}/collection/`)&&!url.username&&!url.password?url.href:undefined;
  }catch{return undefined;}
}
function canvasText(value:unknown,depth=0):string{
  if(depth>5||!value||typeof value!=='object')return '';
  const item=value as {text?:unknown;objects?:unknown[]};
  return [typeof item.text==='string'?item.text:'',...(Array.isArray(item.objects)?item.objects.slice(0,1000).map(child=>canvasText(child,depth+1)):[])].filter(Boolean).join('\n\n');
}
function folded(value:string){return value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();}
function dateKey(value:string|null|undefined){const date=new Date(value||'');if(!Number.isFinite(date.getTime()))return '';return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function formatDate(value:string|null|undefined,language:AppLanguage){const date=new Date(value||'');return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(ownerLocale(language),{dateStyle:'medium',timeStyle:'short'}).format(date):'—';}
function captureLabel(file:CollectedFile,language:AppLanguage,t:Copy){
  if(!file.captureTime)return t('noCaptureTime');
  // EXIF local wall-clock values have no known offset. UTC here only preserves
  // their literal components for locale formatting; it does not assign a zone.
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(file.captureTime)){
    const date=new Date(`${file.captureTime}Z`);
    return `${Number.isFinite(date.getTime())?new Intl.DateTimeFormat(ownerLocale(language),{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date):file.captureTime} · ${t('timezoneUnknown')}`;
  }
  return `${formatDate(file.captureTime,language)}${file.captureTimeSource?.endsWith('.local-timezone-unknown')?` · ${t('timezoneUnknown')}`:''}`;
}
function bytesLabel(bytes:number,language:AppLanguage){return new Intl.NumberFormat(ownerLocale(language),{maximumFractionDigits:1}).format(bytes>=1048576?bytes/1048576:bytes/1024)+(bytes>=1048576?' MB':' KB');}
function uniqueChoices(configured:Choice[],collected:Choice[]){const all=new Map<string,Choice>();for(const choice of [...configured,...collected])if(!all.has(choice.id))all.set(choice.id,choice);return [...all.values()];}
async function readResponse<T>(response:Response):Promise<T>{if(response.status===401)throw new Error('AUTH_REQUIRED');if(response.status===403||response.status===404)throw new Error('BOOK_UNAVAILABLE');if(response.status===409)throw new Error('CONFLICT');const data=await response.json().catch(()=>null);if(!response.ok||!data)throw new Error(data?.error==='MEDIA_BUSY'?'MEDIA_BUSY':'REQUEST_FAILED');return data as T;}

function ChoiceEditor({kind,choices,onChange,disabled,t}:{kind:'events'|'locations';choices:Choice[];onChange:(next:Choice[])=>void;disabled:boolean;t:Copy}){
  const reorder=(index:number,direction:number)=>{const next=[...choices];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next.map((item,order)=>({...item,order})));};
  return <section aria-label={t(kind)}><h3>{t(kind)}</h3><ol className="collection-config-list">{choices.map((choice,index)=><li className="collection-config-row" key={choice.id}>
    <label>{t(kind==='events'?'eventLabel':'locationLabel')} {index+1}<input maxLength={120} required value={choice.label} disabled={disabled} onChange={event=>onChange(choices.map(item=>item.id===choice.id?{...item,label:event.target.value}:item))}/></label>
    <div className="collection-config-buttons"><button type="button" disabled={disabled||index===0} aria-label={`${t('up')}: ${choice.label}`} onClick={()=>reorder(index,-1)}>↑ {t('up')}</button><button type="button" disabled={disabled||index===choices.length-1} aria-label={`${t('down')}: ${choice.label}`} onClick={()=>reorder(index,1)}>↓ {t('down')}</button><button type="button" disabled={disabled} aria-label={`${t('remove')}: ${choice.label}`} onClick={()=>onChange(choices.filter(item=>item.id!==choice.id).map((item,order)=>({...item,order})))}>{t('remove')}</button></div>
  </li>)}</ol><button type="button" disabled={disabled} onClick={()=>onChange([...choices,{id:crypto.randomUUID(),label:'',order:choices.length}])}>{t(kind==='events'?'addEvent':'addLocation')}</button></section>;
}

function MaterialFile({file,bookId,language,t,onRetry,busy}:{file:CollectedFile;bookId:string;language:AppLanguage;t:Copy;onRetry:(id:string)=>void;busy:boolean}){
  const preview=protectedUrl(file.previewUrl,bookId),playback=protectedUrl(file.playbackUrl,bookId),original=protectedUrl(file.originalUrl,bookId);
  const state:OwnerCollectionKey=['uploading','processing','ready','failed','removed'].includes(file.state)?file.state:'unknown';
  return <section className="collection-file" aria-label={`${t(file.kind||'file')}: ${file.fileName}`}>
    <div className="collection-file-title"><span className="collection-file-name">{file.fileName||t(file.kind||'file')}</span><span className={`collection-status collection-status-${state}`}>{t(state)}</span></div>
    {file.kind==='photo'&&preview&&<img src={preview} alt={file.fileName||t('photo')} loading="lazy"/>}
    {file.kind==='video'&&playback&&<video controls preload="none" playsInline src={playback} aria-label={`${t('video')}: ${file.fileName}`}/>}
    {file.kind==='audio'&&playback&&<audio controls preload="none" src={playback} aria-label={`${t('audio')}: ${file.fileName}`}/>}
    {!preview&&!playback&&file.state!=='removed'&&<p className="collection-muted">{t('filesPending')}</p>}
    <dl><dt>{t(file.kind||'file')}</dt><dd>{bytesLabel(file.byteLength||0,language)}{file.durationSeconds!=null?` · ${new Intl.NumberFormat(ownerLocale(language),{maximumFractionDigits:2}).format(file.durationSeconds)} s`:''}{file.width&&file.height?` · ${file.width} × ${file.height}`:''}</dd>
      <dt>{t('receivedAt')}</dt><dd>{formatDate(file.uploadedAt,language)}</dd><dt>{t('captureTime')}</dt><dd>{captureLabel(file,language,t)}</dd></dl>
    {file.errorCode&&<p className="collection-muted">{t('errorCode')}: <code>{/^[A-Z0-9_]{1,80}$/.test(file.errorCode)?file.errorCode:'UNKNOWN'}</code></p>}
    <div className="collection-actions">{original&&<a className="collection-button" href={original} download>{t(file.provenance==='original_bytes_verified'?'original':'downloadStored')}</a>}{file.retryAvailable&&<button disabled={busy} onClick={()=>onRetry(file.id)}>{t(busy?'retrying':'retry')}</button>}</div>
  </section>;
}

export function OwnerCollectionPage({bookId}:{bookId:string}){
  const trialAccess=useCollectionTrial();
  const language=useOwnerUiLanguage(),t:Copy=(key,values)=>ownerCollectionText(language,key,values);
  const api=`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}`;
  const [data,setData]=useState<Collection|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<OwnerCollectionKey|null>(null),[notice,setNotice]=useState<OwnerCollectionKey|null>(null);
  const [filters,setFilters]=useState<Filter>(emptyFilter),[settings,setSettings]=useState<Settings|null>(null),[savedSettings,setSavedSettings]=useState<Settings|null>(null),[settingsSaving,setSettingsSaving]=useState(false),[settingsMessage,setSettingsMessage]=useState<OwnerCollectionKey|null>(null),[settingsError,setSettingsError]=useState<OwnerCollectionKey|null>(null),[retrying,setRetrying]=useState<string|null>(null);
  const refreshing=useRef<{signal?:AbortSignal}|null>(null);
  const load=useCallback((signal?:AbortSignal)=>{if(refreshing.current&&!refreshing.current.signal?.aborted)return Promise.resolve();const request={signal};refreshing.current=request;return fetch(`${api}/collection`,{credentials:'include',signal})
    .then(response=>readResponse<Collection>(response))
    .then(result=>{if(signal?.aborted||refreshing.current!==request)return;setData(result);setError(current=>current==='loadError'?null:current);setSettings(current=>current??structuredClone(result.settings));setSavedSettings(current=>current??structuredClone(result.settings));})
    .catch((cause:unknown)=>{if(signal?.aborted||refreshing.current!==request)return;if(cause instanceof Error&&['AUTH_REQUIRED','BOOK_UNAVAILABLE'].includes(cause.message))setData(null);setError(cause instanceof Error&&cause.message==='AUTH_REQUIRED'?'login':cause instanceof Error&&cause.message==='BOOK_UNAVAILABLE'?'unavailable':'loadError');})
    .finally(()=>{if(refreshing.current===request){refreshing.current=null;if(!signal?.aborted)setLoading(false);}});},[api]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[load]);
  const hasProcessing=!!data?.sessions.some(session=>session.files.some(file=>file.state==='uploading'||file.state==='processing'));
  useEffect(()=>{
    const controller=new AbortController(),refresh=()=>{if(!document.hidden)void load(controller.signal);};
    const timer=hasProcessing?window.setInterval(refresh,5000):undefined;
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();if(timer!==undefined)window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[hasProcessing,load]);
  const events=useMemo(()=>uniqueChoices(data?.settings.events||[],data?.sessions.flatMap(session=>session.events||[])||[]),[data]);
  const locations=useMemo(()=>uniqueChoices(data?.settings.locations||[],data?.sessions.flatMap(session=>session.locations||[])||[]),[data]);
  const visible=useMemo(()=>(data?.sessions||[]).filter(session=>{
    const date=dateKey(session.committedAt||session.createdAt||session.updatedAt);
    return(!filters.sender||folded(session.sender||'').includes(folded(filters.sender)))&&(!filters.from||!!date&&date>=filters.from)&&(!filters.to||!!date&&date<=filters.to)&&(!filters.event||(session.eventIds||[]).includes(filters.event))&&(!filters.location||(session.locationIds||[]).includes(filters.location))&&(!filters.state||(filters.state==='draft'||filters.state==='submitted'?session.state===filters.state:session.files.some(file=>filters.state==='processing'?['uploading','processing'].includes(file.state):file.state==='failed')));
  }),[data,filters]);
  const changeFilter=(key:keyof Filter,value:string)=>setFilters(current=>({...current,[key]:value}));
  const settingsDirty=JSON.stringify(settings)!==JSON.stringify(savedSettings);
  const saveSettings=async(event:FormEvent)=>{
    event.preventDefault();if(!settings||settingsSaving)return;
    const events=settings.events.map((item,order)=>({...item,label:item.label.trim(),order})),locations=settings.locations.map((item,order)=>({...item,label:item.label.trim(),order}));
    if([...events,...locations].some(item=>!item.label)){setSettingsError('labelsRequired');return;}
    setSettingsSaving(true);setSettingsError(null);setSettingsMessage(null);
    try{const result=await readResponse<Settings>(await fetch(`${api}/collection-settings`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:settings.revision,events,locations})}));setSettings(structuredClone(result));setSavedSettings(structuredClone(result));setData(current=>current?{...current,settings:result}:current);setSettingsMessage('saved');}
    catch(cause){if(cause instanceof Error&&cause.message==='AUTH_REQUIRED'){setData(null);setError('login');}else setSettingsError(cause instanceof Error&&cause.message==='CONFLICT'?'settingsConflict':'settingsError');}
    finally{setSettingsSaving(false);}
  };
  const reloadSettings=async()=>{
    if(settingsDirty&&!window.confirm(t('discardSettings')))return;
    setSettingsSaving(true);setSettingsError(null);setSettingsMessage(null);
    try{const result=await readResponse<Settings>(await fetch(`${api}/collection-settings`,{credentials:'include'}));setSettings(structuredClone(result));setSavedSettings(structuredClone(result));setData(current=>current?{...current,settings:result}:current);}
    catch(cause){if(cause instanceof Error&&cause.message==='AUTH_REQUIRED'){setData(null);setError('login');}else setSettingsError('settingsError');}finally{setSettingsSaving(false);}
  };
  const retryFile=async(id:string)=>{
    if(retrying)return;setRetrying(id);setError(null);setNotice(null);
    try{const result=await readResponse<{file:CollectedFile}>(await fetch(`${api}/collection/files/${encodeURIComponent(id)}/retry`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'}));setData(current=>current?{...current,sessions:current.sessions.map(session=>({...session,files:session.files.map(file=>file.id===id?result.file:file)}))}:current);setNotice('retryDone');}
    catch(cause){if(cause instanceof Error&&cause.message==='AUTH_REQUIRED')setData(null);setError(cause instanceof Error&&cause.message==='MEDIA_BUSY'?'busy':cause instanceof Error&&cause.message==='AUTH_REQUIRED'?'login':'retryError');}finally{setRetrying(null);}
  };
  return <main className="collection-owner">
    <CollectionTrialBanner language={language} trial={trialAccess.trial} denied={trialAccess.denied}/>
    <div className="collection-topline">{trialAccess.loaded&&!trialAccess.trial&&!trialAccess.denied&&<a href={`/my-books/${encodeURIComponent(bookId)}`}>← {t('back')}</a>}<label>{t('language')}<select aria-label={t('language')} value={language} onChange={event=>setAppLanguage(event.target.value as AppLanguage)}>{SUPPORTED_APP_LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label></div>
    <h1>{t('materials')}</h1>{data&&<h2>{data.book.title}</h2>}<p className="collection-subtitle">{t('intro')}</p>
    {error&&!trialAccess.denied&&<div className="collection-error" role="alert">{t(error)}{error==='login'&&!trialAccess.trial&&<> <a href="/login">{t('signIn')}</a></>}</div>}{notice&&<div className="collection-success" role="status">{t(notice)}</div>}
    <div className="collection-actions"><button onClick={()=>{setLoading(true);setError(null);void load();}} disabled={loading}>{t(loading?'loading':'refresh')}</button>{data&&!trialAccess.denied&&<><a className="collection-button collection-primary" href={`${api}/collection/archive.zip`} download>{t('archive')}</a><a className="collection-button" href={`${api}/collection/manifest.json`} download>{t('manifest')}</a></>}</div>
    {data&&!trialAccess.denied&&<><p className="collection-muted">{t('archiveHint')}</p>
      <section className="collection-panel" aria-label={t('materials')}><div className="collection-filters">
        <label>{t('sender')}<input type="search" value={filters.sender} onChange={event=>changeFilter('sender',event.target.value)}/></label>
        <label>{t('event')}<select aria-label={t('event')} value={filters.event} onChange={event=>changeFilter('event',event.target.value)}><option value="">{t('all')}</option>{events.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label>{t('location')}<select aria-label={t('location')} value={filters.location} onChange={event=>changeFilter('location',event.target.value)}><option value="">{t('all')}</option>{locations.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label>{t('dateFrom')}<input type="date" value={filters.from} onChange={event=>changeFilter('from',event.target.value)}/></label><label>{t('dateTo')}<input type="date" value={filters.to} onChange={event=>changeFilter('to',event.target.value)}/></label>
        <label>{t('state')}<select aria-label={t('state')} value={filters.state} onChange={event=>changeFilter('state',event.target.value)}><option value="">{t('all')}</option>{(['submitted','draft','processing','failed'] as const).map(state=><option key={state} value={state}>{t(state)}</option>)}</select></label>
      </div><div className="collection-filter-footer"><span className="collection-count" role="status">{t('showing',{visible:visible.length,total:data.sessions.length})}</span><button onClick={()=>setFilters(emptyFilter)}>{t('clear')}</button></div></section>
      <section aria-label={t('materials')} aria-busy={loading}>{!visible.length&&<p className="collection-panel">{t(data.sessions.length?'noMatch':'empty')}</p>}{visible.map(session=>{
        const preview=protectedUrl(session.previewUrl,bookId),text=canvasText(session.canvasData);
        return <article className="collection-card" key={session.groupId} data-collection-session={session.groupId}>
          <div className="collection-card-heading"><h2>{session.sender||t('anonymous')}</h2><span className={`collection-status collection-status-${session.state}`}>{t(session.state)}</span></div>
          <p className="collection-muted">{formatDate(session.committedAt||session.createdAt||session.updatedAt,language)}</p>
          {session.state==='draft'&&<p className="collection-draft-note">{t('draftNotice')}</p>}
          <div className="collection-tags">{session.events?.map(item=><span className="collection-tag" key={item.id}>{t('event')}: {item.label}</span>)}{session.locations?.map(item=><span className="collection-tag" key={item.id}>{t('location')}: {item.label}</span>)}</div>
          {preview&&<img className="collection-preview" src={preview} alt={t('canvas')} loading="lazy"/>}{text&&<p className="collection-text">{text}</p>}
          <div className="collection-files">{session.files.map(file=><MaterialFile key={file.id} file={file} bookId={bookId} language={language} t={t} onRetry={id=>void retryFile(id)} busy={retrying!==null}/>)}</div>
        </article>;
      })}</section>
      {settings&&<details className="collection-panel collection-settings"><summary>{t('settings')}</summary><p className="collection-muted">{t('settingsHint')}</p><form onSubmit={event=>void saveSettings(event)}>
        <div className="collection-settings-grid"><ChoiceEditor kind="events" choices={settings.events} disabled={settingsSaving} t={t} onChange={events=>{setSettings(current=>current?{...current,events}:current);setSettingsMessage(null);}}/><ChoiceEditor kind="locations" choices={settings.locations} disabled={settingsSaving} t={t} onChange={locations=>{setSettings(current=>current?{...current,locations}:current);setSettingsMessage(null);}}/></div>
        {settingsError&&<p role="alert" className="collection-error">{t(settingsError)}{settingsError==='login'&&<> <a href="/login">{t('signIn')}</a></>}</p>}{settingsMessage&&<p role="status" className="collection-success">{t(settingsMessage)}</p>}
        <div className="collection-actions"><button className="collection-primary" type="submit" disabled={settingsSaving||!settingsDirty}>{t(settingsSaving?'saving':'saveSettings')}</button><button type="button" disabled={settingsSaving} onClick={()=>void reloadSettings()}>{t('reloadSettings')}</button></div>
      </form></details>}
      {!!(data.legacy.pages.length||data.legacy.contributions.length)&&<section className="collection-panel" aria-label={t('legacy')}><h2>{t('legacy')}</h2><p className="collection-muted">{t('legacyHint')}</p><div className="collection-legacy-list">
        {data.legacy.pages.map(page=><article className="collection-legacy-item" key={page.id}><h3>{t('legacyPage')} {page.pageNumber}</h3><p className="collection-muted">{formatDate(page.updatedAt,language)} · {t('originalUnverified')}</p>{protectedUrl(page.previewUrl,bookId)&&<img src={protectedUrl(page.previewUrl,bookId)} alt={t('legacyPage')} loading="lazy"/>}<p className="collection-text">{canvasText(page.canvasData)}</p>{!trialAccess.trial&&!trialAccess.denied&&<a href={`/my-books/${encodeURIComponent(bookId)}?page=${encodeURIComponent(page.id)}`}>{t('openLegacy')}</a>}</article>)}
        {data.legacy.contributions.map(item=><article className="collection-legacy-item" key={item.id}><h3>{item.contributorName||t('legacyContribution')}</h3><p className="collection-muted">{formatDate(item.createdAt,language)} · {t('originalUnverified')}</p><p className="collection-text">{item.memoryText}</p>{protectedUrl(item.photoUrl,bookId)&&<img src={protectedUrl(item.photoUrl,bookId)} alt={t('legacyContribution')} loading="lazy"/>}</article>)}
      </div></section>}
    </>}
  </main>;
}
