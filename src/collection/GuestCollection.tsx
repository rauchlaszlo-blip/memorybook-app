import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { AppLanguage } from '../i18n';
import { GuestCapture } from './GuestCapture';
import { guestCopy } from './guest-copy';
import { forgetLocalFile, getLocalFile, keepLocalFile } from './local-files';
import { collectionRequest, committedReceipt, fileIdentity, jsonRequest, uploadOriginal } from './uploader';
import type { CollectionData, CollectionFile, CollectionReceipt, CommitInput, FileIdentity, MediaKind } from './uploader';
import './guest.css';

type Entry = { identity: FileIdentity; file?: File; url?: string; remote?: CollectionFile; busy: boolean; error?: string; previewError?: boolean };
type Recovery = { identities: FileIdentity[]; eventIds: string[]; locationIds: string[]; commit?: CommitInput };
export type GuestCollectionRef = { addOriginal: (file: File) => Promise<string>; commit: (version: number, share: boolean, previewDataUrl: string) => Promise<CollectionReceipt> };
type Props = { token: string; pageId: string; apiBase: string; language: AppLanguage; disabled: boolean; onReady: (ready: boolean) => void; onCommitted: (receipt: CollectionReceipt) => void; onPendingCommit: (pending: boolean) => void; onRemoveAsset: (id: string) => void };

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return 'photo';
  if (file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)) return 'video';
  if (file.type.startsWith('audio/') || /\.(m4a|mp3|wav|ogg|opus)$/i.test(file.name)) return 'audio';
  return null;
}
function recoveryRead(key: string): Recovery | null {
  try { const data = JSON.parse(sessionStorage.getItem(key) || 'null'); return data && Array.isArray(data.identities) ? data : null; } catch { return null; }
}
const toIdentity = (file: CollectionFile): FileIdentity => ({ id: file.id, kind: file.kind, fileName: file.fileName, byteLength: file.byteLength, sha256: file.sha256, mimeType: file.mimeType || file.actualMimeType || 'application/octet-stream' });

export const GuestCollection = forwardRef<GuestCollectionRef, Props>(function GuestCollection({ token, pageId, apiBase, language, disabled, onReady, onCommitted, onPendingCommit, onRemoveAsset }, ref) {
  const base = `${apiBase}/api/collection/invites/${encodeURIComponent(token)}`, key = `memorybook.collection.${pageId}`, t = guestCopy[language];
  const [data, setData] = useState<CollectionData | null>(null), [entries, setEntries] = useState<Entry[]>([]), [error, setError] = useState(''), [recording, setRecording] = useState(false);
  const [events, setEvents] = useState<string[]>([]), [locations, setLocations] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(0), selectingRef = useRef(0);
  const entriesRef = useRef<Entry[]>([]), dataRef = useRef<CollectionData | null>(null), selected = useRef({ events: [] as string[], locations: [] as string[] });
  const pendingCommit = useRef<CommitInput | undefined>(undefined), mounted = useRef(true), loading = useRef(false), localUrls = useRef(new Set<string>());
  const callbacks = useRef({ onReady, onCommitted, onPendingCommit, onRemoveAsset });
  useEffect(() => { callbacks.current = { onReady, onCommitted, onPendingCommit, onRemoveAsset }; }, [onReady, onCommitted, onPendingCommit, onRemoveAsset]);
  const persist = useCallback(() => {
    const recovery: Recovery = { identities: entriesRef.current.map(entry => entry.identity), eventIds: selected.current.events, locationIds: selected.current.locations, commit: pendingCommit.current };
    try { sessionStorage.setItem(key, JSON.stringify(recovery)); } catch { /* Server status remains authoritative when browser storage is blocked. */ }
  }, [key]);
  const replace = useCallback((next: Entry[]) => {
    entriesRef.current = next; if (mounted.current) setEntries(next); persist();
  }, [persist]);
  const update = useCallback((id: string, change: Partial<Entry>) => replace(entriesRef.current.map(entry => entry.identity.id === id ? { ...entry, ...change } : entry)), [replace]);
  const load = useCallback(async (initial = false) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await collectionRequest<CollectionData>(base);
      if (!mounted.current) return;
      if (!result.enabled || result.groupId !== pageId || !result.limits || !Array.isArray(result.files)) throw new Error('COLLECTION_UNAVAILABLE');
      dataRef.current = result; setData(result);
      if (initial) {
        const saved = recoveryRead(key);
        selected.current = { events: saved?.eventIds || result.eventIds || [], locations: saved?.locationIds || result.locationIds || [] };
        pendingCommit.current = saved?.commit;
        callbacks.current.onPendingCommit(!!saved?.commit);
        setEvents(selected.current.events); setLocations(selected.current.locations);
        const restored = await Promise.all((saved?.identities || []).map(async identity => {
          const file = await getLocalFile(pageId, identity.id), url = file ? URL.createObjectURL(file) : undefined;
          if (url) localUrls.current.add(url);
          return { identity, file, url, busy: false };
        }));
        if (!mounted.current) return;
        entriesRef.current = restored;
      }
      selected.current = { events: selected.current.events.filter(id => result.events.some(option => option.id === id)), locations: selected.current.locations.filter(id => result.locations.some(option => option.id === id)) };
      setEvents(selected.current.events); setLocations(selected.current.locations);
      const remoteById = new Map(result.files.map(file => [file.id, file]));
      const next = entriesRef.current.filter(entry => remoteById.get(entry.identity.id)?.state !== 'removed').map(entry => {
        const remote = remoteById.get(entry.identity.id);
        return remote ? { ...entry, remote, ...(remote.state === 'ready' ? { error: undefined } : {}) } : entry;
      });
      for (const remote of result.files) if (remote.state !== 'removed' && !next.some(entry => entry.identity.id === remote.id)) {
        const file = remote.state === 'ready' ? undefined : await getLocalFile(pageId, remote.id), url = file ? URL.createObjectURL(file) : undefined;
        if (url) localUrls.current.add(url);
        next.push({ identity: toIdentity(remote), remote, file, url, busy: false });
      }
      if (!mounted.current) return;
      replace(next); setError('');
      if (result.state === 'submitted' && result.receipt) callbacks.current.onCommitted(committedReceipt(result.receipt, pageId));
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE'); }
    finally { loading.current = false; }
  }, [base, key, pageId, replace]);
  useEffect(() => {
    mounted.current = true; void load(true);
    const urls = localUrls.current;
    return () => { mounted.current = false; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, [load]);
  const hasProcessing = entries.some(entry => entry.remote?.state === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const schedule = () => { if (timer) clearInterval(timer); if (document.visibilityState === 'visible') timer = setInterval(() => void load(), 4000); };
    schedule(); document.addEventListener('visibilitychange', schedule);
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', schedule); };
  }, [hasProcessing, load]);
  const ready = !!data && !recording && selecting === 0 && entries.every(entry => !entry.busy && entry.remote?.state === 'ready');
  useEffect(() => { callbacks.current.onReady(ready); }, [ready]);
  async function send(entry: Entry, retry = false) {
    if (!entry.file) throw new Error('COLLECTION_RESELECT');
    update(entry.identity.id, { busy: true, error: undefined });
    try {
      const remote = await uploadOriginal(base, entry.file, entry.identity, file => update(entry.identity.id, { remote: file }), retry);
      void forgetLocalFile(pageId, entry.identity.id);
      update(entry.identity.id, { remote, busy: false, error: undefined }); return remote.id;
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE';
      update(entry.identity.id, { busy: false, error: code }); throw reason;
    }
  }
  async function add(file: File, forcedKind?: MediaKind): Promise<string> {
    selectingRef.current++; setSelecting(selectingRef.current);
    try {
    const config = dataRef.current, kind = forcedKind || kindOf(file);
    if (!config || disabled) throw new Error('COLLECTION_UNAVAILABLE');
    if (!kind) throw new Error('COLLECTION_TYPE');
    if (file.size > config.limits[kind].maxBytes || file.size === 0) throw new Error('COLLECTION_SIZE');
    const identity = await fileIdentity(file, kind);
    const duplicate = entriesRef.current.find(entry => entry.identity.sha256 === identity.sha256 && entry.identity.kind === kind && entry.identity.byteLength === identity.byteLength);
    if (duplicate) {
      if (duplicate.remote?.state === 'ready') return duplicate.identity.id;
      if (duplicate.busy) throw new Error('COLLECTION_PROCESSING');
      const entry = { ...duplicate, file }; update(entry.identity.id, { file }); return send(entry, true);
    }
    if (entriesRef.current.filter(entry => entry.identity.kind === kind).length >= config.limits[kind].maxCount) throw new Error('COLLECTION_COUNT');
    const url = URL.createObjectURL(file); localUrls.current.add(url);
    const entry: Entry = { identity, file, url, busy: true };
    replace([...entriesRef.current, entry]); await keepLocalFile(pageId, identity.id, file); return send(entry);
    } finally { selectingRef.current--; if (mounted.current) setSelecting(selectingRef.current); }
  }
  useImperativeHandle(ref, () => ({
    addOriginal: file => add(file, 'photo').catch(reason => { setError(reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE'); throw reason; }),
    commit: async (expectedVersion, authorShareApproved, previewDataUrl) => {
      if (!dataRef.current || recording || selectingRef.current > 0 || entriesRef.current.some(entry => entry.busy || entry.remote?.state !== 'ready')) throw new Error('COLLECTION_INCOMPLETE');
      if (!pendingCommit.current) pendingCommit.current = { key: crypto.randomUUID(), expectedVersion, eventIds: selected.current.events, locationIds: selected.current.locations, authorShareApproved, previewDataUrl };
      persist();
      callbacks.current.onPendingCommit(true);
      let receipt: CollectionReceipt;
      try { receipt = committedReceipt(await collectionRequest<CollectionReceipt>(`${base}/commit`, jsonRequest(pendingCommit.current)), pageId); }
      catch (reason) {
        const code = reason instanceof Error ? reason.message : '';
        if (['PAGE_CONFLICT', 'SELECTION_CHANGED', 'COLLECTION_INCOMPLETE', 'CANVAS_ASSET_UNAVAILABLE', 'STORAGE_QUOTA', 'INVALID_PREVIEW', 'EVENT_CLOSED', 'INVITE_EXPIRED'].includes(code)) { pendingCommit.current = undefined; callbacks.current.onPendingCommit(false); persist(); await load(); }
        else {
          try {
            const status = await collectionRequest<CollectionData>(base);
            if (status.state === 'submitted' && status.receipt) {
              const recovered = committedReceipt(status.receipt, pageId);
              try { sessionStorage.removeItem(key); } catch { /* Server receipt is sufficient. */ }
              return recovered;
            }
          } catch { /* Keep the same commit key and frozen input until its receipt is known. */ }
        }
        throw reason;
      }
      try { sessionStorage.removeItem(key); } catch { /* A receipt remains visible without local storage. */ }
      return receipt;
    },
  }));
  function errorText(code: string) {
    if (/DURATION/.test(code)) return t.duration;
    if (/SIZE|TOO_LARGE|BYTES/.test(code)) return t.size;
    if (/COUNT|QUOTA|LIMIT/.test(code)) return t.count;
    if (/TYPE|FORMAT|MIME|INVALID_MEDIA/.test(code)) return t.type;
    if (/MISMATCH|HASH|CONFLICT/.test(code)) return t.mismatch;
    if (/INCOMPLETE/.test(code)) return t.incomplete;
    if (/PROCESSING/.test(code)) return t.processing;
    if (/RESELECT/.test(code)) return t.missing;
    return t.unavailable;
  }
  async function remove(entry: Entry) {
    if (!window.confirm(t.removeConfirm)) return;
    try {
      if (entry.remote) await collectionRequest(`${base}/files/${entry.identity.id}`, { method: 'DELETE' });
      callbacks.current.onRemoveAsset(entry.identity.id);
      if (entry.url) { URL.revokeObjectURL(entry.url); localUrls.current.delete(entry.url); }
      void forgetLocalFile(pageId, entry.identity.id);
      replace(entriesRef.current.filter(item => item.identity.id !== entry.identity.id)); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE'); }
  }
  async function reselect(entry: Entry, file: File) {
    try {
      const identity = await fileIdentity(file, entry.identity.kind, entry.identity.id);
      if (identity.sha256 !== entry.identity.sha256 || identity.byteLength !== entry.identity.byteLength) throw new Error('COLLECTION_MISMATCH');
      const url = URL.createObjectURL(file); localUrls.current.add(url); const next = { ...entry, file, url };
      update(entry.identity.id, { file, url }); await keepLocalFile(pageId, entry.identity.id, file); await send(next, true);
    } catch (reason) { update(entry.identity.id, { error: reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE' }); }
  }
  function toggle(type: 'events' | 'locations', id: string, checked: boolean) {
    const values = checked ? [...selected.current[type], id] : selected.current[type].filter(value => value !== id);
    selected.current[type] = values; if (type === 'events') setEvents(values); else setLocations(values); persist();
  }
  const blocked = disabled || recording;
  return <section className="guest-collection" aria-label={t.title}>
    <h2>{t.title}</h2><p>{t.intro}</p>
    {!data && <p role="status">{error ? t.unavailable : t.loading}</p>}
    {error && <p role="alert" className="collection-error">{errorText(error)}</p>}
    <button type="button" onClick={() => void load()} disabled={disabled}>{t.refresh}</button>
    {data && <>
      <fieldset disabled={blocked}><legend>{t.limits}</legend><ul>{(['photo', 'audio', 'video'] as const).map(kind => <li key={kind}>{t[kind]}: {data.limits[kind].maxCount} {t.files} · {(data.limits[kind].maxBytes / 1048576).toFixed(0)} MB{kind !== 'photo' ? ` · ${data.limits[kind].maxDurationSeconds} ${t.seconds}` : ''}</li>)}</ul>
        <p>JPEG, PNG, WebP · MP4 / MOV (H.264, HEVC), WebM · M4A (AAC), WAV (PCM), Ogg / WebM (Opus, Vorbis)</p>
        <label>{t.choose}<input type="file" multiple accept="image/*,audio/*,video/*" onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; selectingRef.current++; setSelecting(selectingRef.current); void (async () => { try { for (const file of files) { try { await add(file); } catch (reason) { setError(reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE'); } } } finally { selectingRef.current--; if (mounted.current) setSelecting(selectingRef.current); } })(); }} /></label>
      </fieldset>
      {(['events', 'locations'] as const).map(type => <fieldset key={type} disabled={blocked}><legend>{type === 'events' ? t.event : t.location}</legend><label className="collection-choice"><input type="checkbox" checked={(type === 'events' ? events : locations).length === 0} onChange={() => { selected.current[type] = []; if (type === 'events') setEvents([]); else setLocations([]); persist(); }} />{t.none}</label>{data[type].map(option => <label className="collection-choice" key={option.id}><input type="checkbox" checked={(type === 'events' ? events : locations).includes(option.id)} onChange={event => toggle(type, option.id, event.target.checked)} />{option.label}</label>)}</fieldset>)}
      <GuestCapture language={language} disabled={disabled} limits={{ audio: { ...data.limits.audio, remaining: data.limits.audio.maxCount - entries.filter(entry => entry.identity.kind === 'audio').length }, video: { ...data.limits.video, remaining: data.limits.video.maxCount - entries.filter(entry => entry.identity.kind === 'video').length } }} onBusy={setRecording} onSelect={(file, kind) => { void add(file, kind).catch(reason => setError(reason instanceof Error ? reason.message : 'COLLECTION_UNAVAILABLE')); }} />
      <div className="collection-files">{entries.map(entry => {
        const { identity, remote } = entry, protectedSource = remote?.previewUrl || remote?.playbackUrl;
        const serverSource = protectedSource?.startsWith('/') ? apiBase + protectedSource : protectedSource;
        const source = remote?.state === 'ready' ? serverSource || entry.url : entry.url || serverSource;
        const progress = remote && remote.chunkCount ? Math.round(remote.receivedChunks.length / remote.chunkCount * 100) : 0;
        return <article key={identity.id} aria-label={`${t[identity.kind]}: ${identity.fileName}`}>
          <strong>{identity.fileName}</strong><p>{t[identity.kind]} · {(identity.byteLength / 1048576).toFixed(2)} MB</p>
          <p role="status">{entry.busy ? `${t.uploading} ${progress}%` : remote?.state === 'ready' ? t.ready : remote?.state === 'processing' ? t.processing : remote?.state === 'failed' || entry.error ? t.failed : t.queued}</p>
          {source && (identity.kind === 'photo' ? <img src={source} alt={t.preview} onError={() => update(identity.id, { previewError: true })} /> : identity.kind === 'video' ? <video src={source} controls playsInline preload="none" aria-label={t.preview} onError={() => update(identity.id, { previewError: true })} /> : <audio src={source} controls preload="none" aria-label={t.preview} onError={() => update(identity.id, { previewError: true })} />)}
          {entry.previewError && <p role="status">{t.previewFailed}</p>}
          {remote?.originalUrl && <p><a href={remote.originalUrl.startsWith('/') ? apiBase + remote.originalUrl : remote.originalUrl}>{t.original}</a></p>}
          {(entry.error || remote?.errorCode) && <p role="alert" className="collection-error">{errorText(entry.error || remote?.errorCode || '')}</p>}
          {!entry.file && remote?.state !== 'ready' && <p>{t.missing}</p>}
          <div className="collection-actions">{!entry.busy && remote?.state !== 'ready' && (entry.file ? <button type="button" disabled={blocked} onClick={() => void send(entry, true).catch(() => {})}>{t.retry}</button> : <label>{t.reselect}<input type="file" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void reselect(entry, file); }} /></label>)}<button type="button" disabled={blocked || entry.busy} onClick={() => void remove(entry)}>{t.remove}</button></div>
        </article>;
      })}</div>
    </>}
  </section>;
});
