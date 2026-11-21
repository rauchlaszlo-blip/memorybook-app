import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import QRCode from 'qrcode';
import { getAppLanguage, subscribeAppLanguage } from '../i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { weddingTemplate } from '../../shared/event-templates';
import './wedding.css';
import { photoCopy } from './photo-copy';
import { drawingCopy } from './drawing-copy';
import { PhotoDrawing, AnnotatedPreview } from './PhotoDrawing';
import { emptyAnnotation, parseAnnotation } from '../../shared/photo-annotation';
import type { Annotation } from '../../shared/photo-annotation';
import { windowCopy } from './window-copy';
import {ContentReviewPanel,ReviewImage} from './ContentReviewPanel';
import {hasReviewFlag} from './content-review';
import type {ReviewData} from './content-review';
import {GuestMediaCapture} from './GuestMediaCapture';
import {mediaDuration} from './media-duration';
import {MediaPlayback} from './MediaPlayback';
import {mediaCopy} from './media-copy';
import type {GuestMediaCapability,MediaKind} from './media-copy';
import {TrialBanner,TrialUnavailable} from './TrialBanner';
import type {TrialAccess} from './trial-access';

type Book = { id: string; title: string; starts_on: string; closed_at: string | null; invite_token: string; guest_url?: string; package_version?:number;submission_start?:string;submission_end?:string };
type Photo = { id: string; kind?:MediaKind; mimeType?:string; durationSeconds?:number; previewUrl: string; displayUrl: string; originalUrl: string; playbackUrl?:string };
type Attempt = { name: string; message: string; idempotencyKey: string; mediaId?: string; annotation?: Annotation };
type Draft = { name?: string; message?: string; hadPhoto?: boolean; hadMediaKind?:MediaKind; attempt?: Attempt; annotation?: Annotation };
function draftAnnotation(draft: Draft) { try { return parseAnnotation(draft.annotation); } catch { return emptyAnnotation(); } }
function readDraft(token?: string): Draft {
  try { return token ? JSON.parse(sessionStorage.getItem(`wedding-draft-${token}`) || '{}') : {}; } catch { return {}; }
}
type Submission = { media?: Photo[]; id: string; guest_name: string; message: string; created_at: string };
type GuestEvent = { title: string; starts_on: string; closed: boolean; template_id: string; template_version: number;access_state?:string;submission_start?:string;submission_end?:string;package_version?:number };
type Capability = { authenticated: boolean; canCreate: boolean; internetPilot?: boolean;shopAvailable?:boolean;contentReview?:boolean;trial?:TrialAccess };
const apiBase = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:3001` : '';

class ApiError extends Error { status: number; constructor(status: number, code: string) { super(code); this.status = status; } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}/api/wedding${path}`, {
    credentials: 'include', method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error);
  return data;
}
function attemptKey() {
  // getRandomValues also works on a local phone's HTTP LAN test origin.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function WeddingPage() {
  const [language, setLanguage] = useState(getAppLanguage);
  useEffect(() => subscribeAppLanguage(setLanguage), []);
  const t = weddingTemplate.copy[language];
  const pt = photoCopy[language];
  const dt = drawingCopy[language];
  const wt = windowCopy[language];
  const mt = mediaCopy[language];
  const time=(s:string)=>new Date(s).toLocaleString(language,{timeZone:'Europe/Budapest'});
  const guestToken = window.location.pathname.match(/^\/wedding\/join\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const bookId = window.location.pathname.match(/^\/wedding\/books\/([a-f0-9-]+)\/?$/)?.[1];
  const [capability, setCapability] = useState<Capability | null>(null);
  const [trialDenied,setTrialDenied]=useState(false);
  const [guest, setGuest] = useState<GuestEvent | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [reviewData,setReviewData]=useState<ReviewData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [names, setNames] = useState('');
  const [date, setDate] = useState('');
  const [draft] = useState(() => readDraft(guestToken));
  const [name, setName] = useState(draft.name || '');
  const [message, setMessage] = useState(draft.message || '');
  const [photoLimit, setPhotoLimit] = useState<{maxBytes:number;maxPixels:number} | null>(null);
  const [mediaCapability,setMediaCapability]=useState<GuestMediaCapability|null>(null),[mediaKind,setMediaKind]=useState<MediaKind>(draft.hadMediaKind||'photo'),[captureActive,setCaptureActive]=useState(false),[mediaSelecting,setMediaSelecting]=useState(false),[mediaPreviewWarning,setMediaPreviewWarning]=useState(false),[mediaError,setMediaError]=useState<keyof typeof mt|''>('');
  const selectionGeneration=useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [photoRequired, setPhotoRequired] = useState(!!(draft.hadPhoto||draft.hadMediaKind));
  const [preview, setPreview] = useState('');
  const [annotation,setAnnotation] = useState(() => draftAnnotation(draft));
  const [drawing,setDrawing] = useState(false);
  const [annotationError,setAnnotationError] = useState(false);
  const [showOriginal,setShowOriginal] = useState(false);
  const uploadedFile = useRef<File | null>(null);const [uploadedMediaId,setUploadedMediaId]=useState<string|null>(draft.attempt?.mediaId||null);
  const [photoError, setPhotoError] = useState<keyof typeof pt | ''>('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<'upload'|'processing'|'saving'|''>('');
  const [largePhoto, setLargePhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const attempt = useRef<Attempt | null>(draft.attempt || null);
  const [uncertain, setUncertain] = useState(!!draft.attempt);
  const [checkingUpload,setCheckingUpload]=useState(false),[uploadMissing,setUploadMissing]=useState(false);
  const [success, setSuccess] = useState(false);
  const [qr, setQr] = useState('');
  const [qrError, setQrError] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (guestToken) {
          const [result,caps] = await Promise.all([api<{ event: GuestEvent; photo?: {maxBytes:number;maxPixels:number};media?:GuestMediaCapability }>(`/guest/${guestToken}`),api<Capability>('/capabilities').catch(()=>null)]);
          if (result.event.template_id !== weddingTemplate.id || result.event.template_version !== weddingTemplate.version) throw new Error('unavailable');
          if (!cancelled) { setGuest(result.event); setPhotoLimit(result.photo || null);setMediaCapability(result.media||null);setCapability(caps); }
        } else {
          const initialCaps = await api<Capability>('/capabilities');
          if (!initialCaps.internetPilot && new URLSearchParams(window.location.search).get('pilot') === '1') {
            await api('/pilot-login', {});
            window.history.replaceState(null, '', window.location.pathname);
          }
          const caps = await api<Capability>('/capabilities');
          if (cancelled) return;
          setCapability(caps);
          if (caps.authenticated && bookId) {
            const data = await api<{ book: Book; submissions: Submission[] }>(`/books/${bookId}`);
            if (!cancelled) { setBook(data.book); setSubmissions(data.submissions); }
          } else if (caps.authenticated) {
            const data = await api<{ books: Book[] }>('/books');
            if (!cancelled) setBooks(data.books);
          }
        }
      } catch (cause) { if (!cancelled) {setError('unavailable');setTrialDenied(cause instanceof Error&&cause.message==='TRIAL_SCOPE_DENIED');} }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [guestToken, bookId]);

  const link = book ? book.guest_url || `${window.location.origin}/wedding/join/${book.invite_token}` : '';
  useEffect(() => {
    let cancelled = false;
    if (link) void QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQrError(true); });
    return () => { cancelled = true; };
  }, [link]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(()=>()=>{selectionGeneration.current++;},[]);
  useEffect(() => {
    if (!guestToken) return;
    try {
      if (success) sessionStorage.removeItem('wedding-draft-' + guestToken);
      else sessionStorage.setItem('wedding-draft-' + guestToken, JSON.stringify({name,message,hadPhoto:photoRequired&&mediaKind==='photo',hadMediaKind:photoRequired?mediaKind:undefined,attempt:attempt.current,annotation}));
    } catch { /* Storage is best-effort; in-page state still retains the draft. */ }
  }, [guestToken,name,message,photoRequired,uncertain,busy,success,annotation,mediaKind]);
  function selectPhoto(selected?: File) {
    if (!selected) return;
    if(uncertain&&mediaKind!=='photo'){setPhotoError('conflict');return;}
    if (!['image/jpeg','image/png'].includes(selected.type)) { setPhotoError('format'); return; }
    if (selected.size > (photoLimit?.maxBytes || 0)) { setPhotoError('size'); return; }
    if (!uncertain && annotation.strokes.length && !window.confirm(dt.discard)) return;
    if (!uncertain) setAnnotation(emptyAnnotation());
    if (!uncertain) attempt.current = null;setUploadedMediaId(null);
    setPhotoError('');setMediaError('');setMediaPreviewWarning(false);setMediaKind('photo'); setFile(selected); setPreview(URL.createObjectURL(selected)); setPhotoRequired(true);
  }
  async function selectRecording(selected:File,kind:'audio'|'video',durationHint?:number){
    if(uncertain&&mediaKind!==kind){setError('conflict');return;}if(!mediaCapability)return;
    if(selected.size>mediaCapability.limits[kind].maxBytes){setMediaError('size');return;}
    const token=++selectionGeneration.current;setMediaSelecting(true);setMediaError('');setMediaPreviewWarning(false);
    try{
      let duration=durationHint;if(duration===undefined){try{duration=await mediaDuration(selected,kind);}catch{if(token===selectionGeneration.current)setMediaPreviewWarning(true);}}if(token!==selectionGeneration.current)return;
      if(duration!==undefined&&(!Number.isFinite(duration)||duration<=0)){setMediaError('invalid');return;}if(duration!==undefined&&duration>mediaCapability.maxDurationSeconds){setMediaError('duration');return;}
      if(!uncertain&&annotation.strokes.length&&!window.confirm(dt.discard))return;
      if(!uncertain){setAnnotation(emptyAnnotation());attempt.current=null;setUploadedMediaId(null);}setFile(selected);setPreview(URL.createObjectURL(selected));setPhotoRequired(true);setMediaKind(kind);setPhotoError('');
    }catch{if(token===selectionGeneration.current)setMediaError('invalid');}finally{if(token===selectionGeneration.current)setMediaSelecting(false);}
  }
  function uploadPhoto(selected: File, key: string): Promise<{mediaId:string}> {
    return new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiBase + '/api/wedding/guest/' + guestToken + '/media/' + key);
      xhr.withCredentials = true; xhr.timeout = 120000;
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.setRequestHeader('X-Media-Kind',mediaKind);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setUploadProgress(Math.round(event.loaded/event.total*100));
      };
      xhr.upload.onload = () => setStage('processing');
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('network'));
      xhr.onload = () => {
        try { const data=JSON.parse(xhr.responseText); if(xhr.status>=200 && xhr.status<300) resolve(data); else reject(new ApiError(xhr.status,data.error)); }
        catch { reject(new Error('network')); }
      };
      xhr.send(selected);
    });
  }
  function report(error: unknown) {
    if(error instanceof ApiError && error.message.startsWith('MEDIA_')){const codes:Record<string,keyof typeof mt>={MEDIA_GUEST_LIMIT:'quota',MEDIA_DURATION:'duration',MEDIA_INVALID:'invalid',MEDIA_TYPE:'type',MEDIA_TOO_LARGE:'size',MEDIA_BUSY:'busy',MEDIA_DECODER_UNAVAILABLE:'decoder',MEDIA_QUOTA:'storage',MEDIA_EXPIRED:'expired'};setMediaError(codes[error.message]||'invalid');}
    else if(error instanceof ApiError && error.message==='PHOTO_DEVICE_LIMIT')setError('deviceLimit');
    else if(error instanceof ApiError && error.message==='GUEST_SESSION_REQUIRED')setError('deviceCookie');
    else if(error instanceof ApiError && ['SUBMISSIONS_EARLY','SUBMISSIONS_ENDED'].includes(error.message)){setGuest(g=>g?{...g,access_state:error.message==='SUBMISSIONS_EARLY'?'early':'ended'}:g);setUncertain(false);}
    else if (error instanceof ApiError && error.message === 'ANNOTATION_INVALID') setAnnotationError(true);
    else if (error instanceof ApiError && error.message.startsWith('PHOTO_')) {
      const codes: Record<string, keyof typeof pt> = {PHOTO_TYPE:'format',PHOTO_TOO_LARGE:'size',PHOTO_PIXELS:'pixels',PHOTO_INVALID:'invalid',PHOTO_QUOTA:'quota',PHOTO_EXPIRED:'expired'};
      setPhotoError(codes[error.message] || 'invalid');
    } else if (error instanceof ApiError && error.status < 500) {
      if (error.status === 410) { setError('closed'); setGuest(g => g ? { ...g, closed: true } : g); }
      else setError(error.status === 429 ? 'limited' : error.status === 409 ? 'conflict' : error.status === 400 ? 'invalid' : 'unavailable');
    } else setError('network');
  }
  async function recoverUpload(){
    const current=attempt.current;if(!current||checkingUpload)return;setCheckingUpload(true);setUploadMissing(false);setError('');
    try{
      const recovered=await api<{mediaId:string;kind:MediaKind;state:'uploaded'|'attached'}>(`/guest/${guestToken}/media/${current.idempotencyKey}`);
      if(attempt.current!==current)return;current.mediaId=recovered.mediaId;setUploadedMediaId(recovered.mediaId);setMediaKind(recovered.kind);setPhotoRequired(true);setPhotoError('');setMediaError('');
      try{sessionStorage.setItem('wedding-draft-'+guestToken,JSON.stringify({name:current.name,message:current.message,hadPhoto:recovered.kind==='photo',hadMediaKind:recovered.kind,attempt:current,annotation}));}catch{ /* Existing server upload remains reusable in this page. */ }
    }catch(reason){if(reason instanceof ApiError&&reason.status===404)setUploadMissing(true);else report(reason);}finally{setCheckingUpload(false);}
  }
  async function send() {
    if (busyRef.current||captureActive||mediaSelecting||checkingUpload) return;
    if (!name.trim() || (!message.trim()&&!file&&!attempt.current?.mediaId)) { setError('invalid'); return; }
    if (photoRequired && !file&&!attempt.current?.mediaId) { if(mediaKind==='photo')setPhotoError('reselect');else setMediaError('reselect'); return; }
    busyRef.current = true; setBusy(true); setError(''); setPhotoError('');setMediaError(''); setAnnotationError(false);
    attempt.current ??= { name, message, idempotencyKey: attemptKey() };
    if (!uncertain) { attempt.current.name = name; attempt.current.message = message; attempt.current.annotation = mediaKind==='photo'&&annotation.strokes.length ? annotation : undefined; }
    try {
      if (file && (!attempt.current.mediaId || uploadedFile.current !== file)) {
        setStage('upload'); setUploadProgress(null);
        // Same key/file reuses a stored upload, also after an ambiguous response or page reload.
        const uploaded = await uploadPhoto(file, attempt.current.idempotencyKey);
        attempt.current.mediaId = uploaded.mediaId;setUploadedMediaId(uploaded.mediaId); uploadedFile.current = file;
        try{sessionStorage.setItem('wedding-draft-'+guestToken,JSON.stringify({name:attempt.current.name,message:attempt.current.message,hadPhoto:mediaKind==='photo',hadMediaKind:mediaKind,attempt:attempt.current,annotation}));}catch{ /* The in-page attempt still retains the uploaded media ID. */ }
      }
      setStage('saving');
      await api(`/guest/${guestToken}/submissions`, attempt.current);
      try{sessionStorage.removeItem('wedding-draft-'+guestToken);}catch{ /* A confirmed server commit remains authoritative. */ }
      attempt.current=null;setUploadedMediaId(null);
      setSuccess(true); setUncertain(false); setFile(null); setPreview('');
    } catch (error) {
      report(error);
      const ambiguous = !(error instanceof ApiError) || error.status >= 500;
      setUncertain(ambiguous || error instanceof ApiError && (error.status === 429 || error.status === 409));
      if (!ambiguous && error instanceof ApiError && (error.status === 400 || error.status === 413 || error.status === 415)) { if (error.message !== 'INVALID_SUBMISSION') attempt.current = null;setUploadedMediaId(null); setUncertain(false); }
      if (error instanceof ApiError && ['PHOTO_EXPIRED','MEDIA_EXPIRED'].includes(error.message)) { attempt.current = null;setUploadedMediaId(null); setUncertain(false); }
      if (error instanceof ApiError && error.message === 'IDEMPOTENCY_CONFLICT' && file) {if(mediaKind==='photo')setPhotoError('conflict');else setError('conflict');setFile(null);setPreview('');uploadedFile.current=null;}
    } finally { setBusy(false); busyRef.current = false; setStage(''); }
  }
  const errorText = error==='deviceLimit'?wt.limit:error==='deviceCookie'?wt.cookie:error ? t[error as keyof typeof t] || t.unavailable : '';
  const appearance = weddingTemplate.appearance;
  return <main className="wedding" style={{ background: appearance.background, color: appearance.ink, '--wedding-accent': appearance.accent } as CSSProperties}>
    <div className="wedding-shell">
      {drawing && preview && <PhotoDrawing src={preview} initial={annotation} language={language} onCancel={()=>setDrawing(false)} onDone={a=>{setAnnotation(a);setDrawing(false);setAnnotationError(false);}}/>}
      {largePhoto && <div className="wedding-lightbox" onKeyDown={e => { if (e.key === 'Escape') setLargePhoto(null); }} role="dialog" aria-modal="true" aria-label={pt.enlarge}><button autoFocus onClick={() => setLargePhoto(null)}>{pt.back}</button><img src={apiBase+(showOriginal?largePhoto.originalUrl:largePhoto.displayUrl)} alt={pt.enlarge} /><button onClick={()=>setShowOriginal(v=>!v)}>{showOriginal?pt.enlarge:pt.originalView}</button><a href={apiBase+largePhoto.originalUrl}>{pt.original}</a></div>}
      <header><a href="/wedding">{t.heading}</a><LanguageSwitcher /></header>
      <TrialBanner trial={capability?.trial} disabled={busy||captureActive}/>
      {trialDenied&&<TrialUnavailable/>}
      {loading ? <p role="status">{t.loading}</p> : <>
        {photoError && <p className="wedding-error" role="alert">{pt[photoError]}</p>}
        {mediaError && <p className="wedding-error" role="alert">{mt[mediaError]}</p>}
        {annotationError && <p className="wedding-error" role="alert">{dt.invalid}</p>}
        {errorText && <p className="wedding-error" role="alert">{errorText}</p>}
        {guestToken ? guest && <section className="wedding-card">
          <p>{t.step}</p><h1>{guest.title}</h1><p>{guest.starts_on}</p>
          {guest.submission_start&&guest.submission_end&&<p><small>{wt.window} {time(guest.submission_start)} – {time(new Date(new Date(guest.submission_end).getTime()-1000).toISOString())}</small></p>}
          {success ? <h2 role="status">{t.success}</h2> : guest.closed && !uncertain ? <p role="status">{t.closed}</p> : ['early','ended'].includes(guest.access_state||'')&&!uncertain?<p role="status">{guest.access_state==='early'?wt.early:wt.ended}</p>: <>
            <p>{t.guestIntro}</p>
            <form onSubmit={e => { e.preventDefault(); void send(); }}>
              <div><label htmlFor="wedding-guest-name">{t.name}</label><input id="wedding-guest-name" name="guestName" autoComplete="name" required maxLength={100} value={name} disabled={busy || uncertain} onChange={e => setName(e.target.value)} /></div>
              <div><label htmlFor="wedding-guest-message">{t.message}</label><textarea id="wedding-guest-message" name="message" required={!photoRequired} maxLength={4000} rows={6} placeholder={t.prompt} value={message} disabled={busy || uncertain} onChange={e => setMessage(e.target.value)} /></div>
              {mediaCapability&&<div className="wedding-media-quota"><p>{mt.optional}</p><p>{mt.allowance}: {mt.photo} {mediaCapability.remaining.photo}/{mediaCapability.limits.photo.maxCount} · {mt.video} {mediaCapability.remaining.video}/{mediaCapability.limits.video.maxCount} · {mt.audio} {mediaCapability.remaining.audio}/{mediaCapability.limits.audio.maxCount}.</p><small>{mt.quotaNote}</small></div>}
              {uncertain&&photoRequired&&!file&&!uploadedMediaId&&<section className="wedding-upload-recovery"><p>{mt.recoveryIntro}</p><button type="button" disabled={checkingUpload||busy} onClick={()=>void recoverUpload()}>{mt.checkUpload}</button>{uploadMissing&&<><p role="status">{mt.missingUpload}</p><button type="button" disabled={checkingUpload||busy} onClick={()=>{attempt.current=null;setUploadedMediaId(null);setUncertain(false);setPhotoRequired(false);setUploadMissing(false);setPhotoError('');setMediaError('');setAnnotation(emptyAnnotation());}}>{mt.resetAttempt}</button></>}</section>}
              {photoLimit && <fieldset className="wedding-photo-picker" disabled={busy || captureActive || mediaSelecting || (uncertain && !!file)}>
                <legend>{pt.hint}</legend>
                <div className="wedding-photo-actions">
                  <label className="wedding-button">{pt.camera}<input aria-label={pt.camera} type="file" accept="image/jpeg,image/png" capture="environment" onChange={e => { selectPhoto(e.target.files?.[0]); e.target.value=''; }} /></label>
                  <label className="wedding-button">{pt.gallery}<input aria-label={pt.gallery} type="file" accept="image/jpeg,image/png" onChange={e => { selectPhoto(e.target.files?.[0]); e.target.value=''; }} /></label>
                </div>
                <small>{pt.fallback} · JPEG/PNG · {Math.round(photoLimit.maxBytes/1024/1024)} MB · {Math.round(photoLimit.maxPixels/1000000)} MP</small>
                {photoRequired && mediaKind==='photo'&&!file && <p>{uploadedMediaId?mt.uploaded:pt.reselect}</p>}
                {file && preview && mediaKind==='photo'&&<><AnnotatedPreview src={preview} layer={annotation} alt={pt.preview} onError={() => { setPhotoError('invalid'); setFile(null); setPreview(''); }} /><button type="button" disabled={busy || uncertain} onClick={()=>setDrawing(true)}>{dt.edit}</button></>}
                {photoRequired && mediaKind==='photo'&&<button type="button" disabled={busy||uncertain} onClick={() => {if(annotation.strokes.length && !window.confirm(dt.discard))return;setAnnotation(emptyAnnotation());setFile(null);setPreview('');setPhotoRequired(false);setPhotoError('');attempt.current=null;setUploadedMediaId(null);}}>{pt.remove}</button>}
              </fieldset>}
              {mediaCapability&&<GuestMediaCapture language={language} capability={mediaCapability} disabled={busy||mediaSelecting||(uncertain&&!!file)} recordingDisabled={uncertain} onRecordingChange={setCaptureActive} onSelect={(selected,kind,duration)=>void selectRecording(selected,kind,duration)}/>}
              {mediaSelecting&&<p role="status">{mt.checking}</p>}
              {photoRequired&&mediaKind!=='photo'&&<div className="wedding-recording-preview">{file&&preview?<>{mediaKind==='video'?<video src={preview} controls playsInline preload="metadata" aria-label={mt.previewVideo} onError={()=>setMediaPreviewWarning(true)}/>:<audio src={preview} controls preload="metadata" aria-label={mt.previewAudio} onError={()=>setMediaPreviewWarning(true)}/>}<p>{mediaPreviewWarning&&mt.previewUnavailable}</p><p>{file.name} · {(file.size/1024/1024).toFixed(1)} MB</p><p>{mt.rerecord}</p></>:<p>{uploadedMediaId?mt.uploaded:mt.reselect}</p>}<button type="button" disabled={busy||uncertain||captureActive||mediaSelecting} onClick={()=>{setFile(null);setPreview('');setPhotoRequired(false);setMediaError('');attempt.current=null;setUploadedMediaId(null);}}>{mt.remove}</button></div>}
              <small>{message.length} / 4000</small>
              {busy && stage && <p role="status">{mediaKind==='photo'?pt[stage]:mt[stage]}{stage==='upload' && uploadProgress!==null ? ' '+uploadProgress+'%' : ''}</p>}
              <button disabled={busy||captureActive||mediaSelecting||checkingUpload} type="submit">{busy ? t.sending : uncertain ? t.retry : t.send}</button>
            </form>
          </>}
        </section> : capability && <>
          {!capability.authenticated ? <section className="wedding-card"><p>{capability.internetPilot ? 'A tulajdonosi hozzáféréshez nyisd meg a neked adott egyszer használható meghívót. Jelszó nem szükséges.' : t.loginHint}</p>{!capability.internetPilot && <a className="wedding-button" href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}>{t.login}</a>}</section> : book ? <>
            <a href={book.package_version&&!capability.trial?'/pilot/books':'/wedding'}>{book.package_version&&!capability.trial?wt.shop:t.back}</a><h1>{book.title}</h1><p>{book.starts_on} · {t.owner}</p>
            {(capability.shopAvailable||capability.trial) && <p><a href={'/wedding/books/'+book.id+'/montage'}>Montázs, jóváhagyás és ellenőrző PDF</a></p>}
            {book.submission_start&&book.submission_end&&<p>{wt.window} {time(book.submission_start)} – {time(new Date(new Date(book.submission_end).getTime()-1000).toISOString())}</p>}
            <section className="wedding-card"><h2>{t.qr}</h2>
              {book.closed_at ? <p role="status">{t.closed}</p> : <>
                {qr && <><img className="wedding-qr" src={qr} alt={t.qr} /><a className="wedding-button" href={qr} download="vendegkonyv-qr.png">QR letöltése</a></>}{qrError && <p>{t.qrFailed}</p>}
                <label>{t.link}<input readOnly value={link} onFocus={e => e.target.select()} /></label>
                <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopyStatus('copied')).catch(() => setCopyStatus('copyFailed')); if (!navigator.clipboard) setCopyStatus('copyFailed'); }}>{t.copy}</button>
                {copyStatus && <p role="status">{copyStatus === 'copied' ? t.copied : t.copyFailed}</p>}
              </>}
            </section>
            {capability.contentReview&&<ContentReviewPanel bookId={book.id} onData={setReviewData}/>}
            <section className="wedding-card"><h2>{t.messages} ({submissions.length})</h2>
              <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const data = await api<{ book: Book; submissions: Submission[] }>(`/books/${book.id}`); setBook(data.book); setSubmissions(data.submissions); } catch (e) { report(e); } finally { setBusy(false); } }}>{t.refresh}</button>
              {!submissions.length && <p>{t.empty}</p>}
              {submissions.map(item => <article key={item.id}><h3>{item.guest_name}</h3><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(language)}</time>{item.message&&<p className="wedding-message">{item.message}</p>}{item.media?.map(photo => photo.kind&&photo.kind!=='photo'?<MediaPlayback key={photo.id+':'+(reviewData?.revision??'loading')} kind={photo.kind} language={language} src={apiBase+photo.playbackUrl} originalUrl={apiBase+photo.originalUrl} covered={!!capability.contentReview&&(!reviewData||reviewData.items.some(review=>review.mediaId===photo.id&&hasReviewFlag(review)))}/>:<ReviewImage key={photo.id+':'+(reviewData?.revision??'loading')} covered={!!capability.contentReview&&(!reviewData||reviewData.items.some(review=>review.mediaId===photo.id&&hasReviewFlag(review)))} src={apiBase+photo.previewUrl} alt={pt.enlarge}><button className="wedding-photo-open" aria-label={pt.enlarge} onClick={() => {setShowOriginal(false);setLargePhoto(photo);}}><img loading="lazy" src={apiBase+photo.previewUrl} alt={pt.enlarge} /></button></ReviewImage>)}</article>)}
            </section>
            {!book.closed_at && !capability.trial && <section className="wedding-card">
              <label className="wedding-confirm"><input type="checkbox" checked={confirmClose} onChange={e => setConfirmClose(e.target.checked)} />{t.closeQuestion}</label>
              <button disabled={busy || !confirmClose} onClick={async () => { setBusy(true); setError(''); try { const data = await api<{ book: Book }>(`/books/${book.id}/close`, {}); setBook(data.book); } catch (e) { report(e); } finally { setBusy(false); } }}>{t.close}</button>
            </section>}
          </> : !bookId && <>
            <h1>{t.heading}</h1><p>{t.intro}</p>
            {capability.canCreate&&!capability.trial ? <section className="wedding-card"><form onSubmit={async e => {
              e.preventDefault(); if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
              try { const data = await api<{ book: Book }>('/books', { names, date }); window.location.assign(`/wedding/books/${data.book.id}`); }
              catch (error) { report(error); setBusy(false); busyRef.current = false; }
            }}>
              <label>{t.names}<input required maxLength={160} value={names} onChange={e => setNames(e.target.value)} /></label>
              <label>{t.date}<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
              <button disabled={busy}>{busy ? t.sending : t.create}</button>
            </form></section> : !capability.trial&&<p>{t.pilot}</p>}
            <section className="wedding-card"><h2>{t.yourBooks}</h2>{books.map(item => <p key={item.id}><a href={`/wedding/books/${item.id}`}>{item.title} · {item.starts_on}</a></p>)}</section>
          </>}
        </>}
      </>}
    </div>
  </main>;
}
