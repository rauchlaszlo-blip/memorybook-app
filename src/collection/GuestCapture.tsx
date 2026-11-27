import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppLanguage } from '../i18n';
import { guestCopy } from './guest-copy';

type Kind = 'audio' | 'video';
type Reason = 'stop' | 'limit' | 'hidden' | 'discard' | 'error' | 'unmount';
type Capture = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; reason: Reason; stopping: boolean; finished: boolean; timer: ReturnType<typeof setTimeout>; ticker: ReturnType<typeof setInterval>; finish?: () => void };
const formats = {
  video: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'],
  audio: ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'],
};

export function GuestCapture({ language, disabled, limits, onSelect, onBusy }: {
  language: AppLanguage; disabled: boolean; limits: Record<Kind, { maxDurationSeconds: number; remaining: number }>;
  onSelect: (file: File, kind: Kind) => void; onBusy: (busy: boolean) => void;
}) {
  const t = guestCopy[language];
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording'>('idle');
  const [kind, setKind] = useState<Kind>('video');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<keyof typeof t | ''>('');
  const live = useRef<HTMLVideoElement>(null), capture = useRef<Capture | null>(null), generation = useRef(0), mounted = useRef(true);
  const phaseRef = useRef(phase), callbacks = useRef({ onSelect, onBusy });
  useEffect(() => { callbacks.current = { onSelect, onBusy }; }, [onSelect, onBusy]);
  const shutdown = useCallback((reason: Reason) => {
    generation.current++;
    const current = capture.current;
    if (!current) {
      if (phaseRef.current !== 'idle') {
        phaseRef.current = 'idle';
        if (mounted.current) { setPhase('idle'); callbacks.current.onBusy(false); }
      }
      return;
    }
    if (current.stopping) { if (['discard', 'error', 'unmount'].includes(reason)) current.reason = reason; return; }
    current.stopping = true; current.reason = reason;
    clearTimeout(current.timer); clearInterval(current.ticker);
    try { if (current.recorder.state !== 'inactive') current.recorder.stop(); else queueMicrotask(() => current.finish?.()); }
    catch { current.reason = 'error'; queueMicrotask(() => current.finish?.()); }
    current.stream.getTracks().forEach(track => track.stop());
    if (live.current) live.current.srcObject = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.visibilityState === 'hidden') shutdown('hidden'); };
    const leave = () => shutdown('hidden');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => { mounted.current = false; shutdown('unmount'); callbacks.current.onBusy(false); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave); };
  }, [shutdown]);
  useEffect(() => {
    if (phase === 'recording' && kind === 'video' && live.current && capture.current) {
      live.current.srcObject = capture.current.stream; void live.current.play().catch(() => {});
    }
  }, [phase, kind]);
  async function start(next: Kind) {
    if (disabled || phaseRef.current !== 'idle' || capture.current || limits[next].remaining <= 0) return;
    setMessage(''); setKind(next); setElapsed(0);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') { setMessage('unsupported'); return; }
    const mimeType = formats[next].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setMessage('unsupported'); return; }
    const attempt = ++generation.current, maxSeconds = limits[next].maxDurationSeconds;
    phaseRef.current = 'permission'; setPhase('permission'); callbacks.current.onBusy(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia(next === 'video' ? { audio: true, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 30 } } } : { audio: true });
      if (!mounted.current || attempt !== generation.current || document.visibilityState === 'hidden') {
        stream.getTracks().forEach(track => track.stop());
        if (mounted.current && attempt === generation.current) { phaseRef.current = 'idle'; setPhase('idle'); callbacks.current.onBusy(false); setMessage('interrupted'); }
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96_000, ...(next === 'video' ? { videoBitsPerSecond: 1_500_000 } : {}) });
      const current: Capture = {
        // eslint-disable-next-line react-hooks/purity -- start runs only after an explicit recording-button click.
        recorder, stream, chunks: [], startedAt: performance.now(), reason: 'stop', stopping: false, finished: false,
        timer: setTimeout(() => shutdown('limit'), Math.max(0.5, maxSeconds - 0.5) * 1000),
        ticker: setInterval(() => setElapsed(Math.min(maxSeconds, (performance.now() - current.startedAt) / 1000)), 100),
      };
      capture.current = current;
      recorder.ondataavailable = event => { if (event.data.size) current.chunks.push(event.data); };
      recorder.onerror = () => shutdown('error');
      current.finish = () => {
        if (current.finished) return;
        current.finished = true; clearTimeout(current.timer); clearInterval(current.ticker); current.stream.getTracks().forEach(track => track.stop());
        if (capture.current === current) capture.current = null;
        phaseRef.current = 'idle'; if (!mounted.current) return;
        setPhase('idle'); callbacks.current.onBusy(false); if (live.current) live.current.srcObject = null;
        if (['discard', 'error', 'unmount'].includes(current.reason)) { if (current.reason === 'error') setMessage('captureFailed'); return; }
        const blob = new Blob(current.chunks, { type: recorder.mimeType || mimeType });
        if (!blob.size) { setMessage('captureFailed'); return; }
        const extension = blob.type.includes('mp4') ? (next === 'audio' ? 'm4a' : 'mp4') : blob.type.includes('ogg') ? 'ogg' : 'webm';
        callbacks.current.onSelect(new File([blob], `memorybook-${next}.${extension}`, { type: blob.type }), next);
        setMessage(current.reason === 'hidden' ? 'interrupted' : current.reason === 'limit' ? 'limited' : 'captured');
      };
      recorder.onstop = current.finish;
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (!current.stopping) shutdown('error'); }, { once: true }));
      recorder.start(250); phaseRef.current = 'recording'; setPhase('recording');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (!mounted.current || attempt !== generation.current) return;
      const current = capture.current;
      if (current && current.stream === stream) { clearTimeout(current.timer); clearInterval(current.ticker); capture.current = null; }
      phaseRef.current = 'idle'; setPhase('idle'); callbacks.current.onBusy(false);
      const name = error instanceof DOMException ? error.name : '';
      setMessage(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'noDevice' : name === 'NotReadableError' ? 'inUse' : 'captureFailed');
    }
  }
  return <section className="collection-capture" aria-label={t.recordVideo + ' / ' + t.recordAudio}>
    <p>{t.captureHint}</p>
    {message && <p role="status">{t[message]}</p>}
    {phase === 'idle' ? <fieldset disabled={disabled}>
      <div className="collection-actions">{(['video', 'audio'] as const).map(type => <button key={type} type="button" disabled={limits[type].remaining <= 0} onClick={() => void start(type)}>{type === 'video' ? t.recordVideo : t.recordAudio}</button>)}</div>
      <p>{t.fallback}</p>
      <div className="collection-actions">{(['video', 'audio'] as const).map(type => <label key={type}>{type === 'video' ? t.nativeVideo : t.nativeAudio}<input type="file" accept={type + '/*'} capture={type === 'video' ? 'environment' : 'user'} disabled={limits[type].remaining <= 0} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onSelect(file, type); }} /></label>)}</div>
    </fieldset> : <div>
      <p role="status">{phase === 'permission' ? t.requesting : `● ${t.recording} · ${elapsed.toFixed(1)} / ${limits[kind].maxDurationSeconds} s`}</p>
      {phase === 'recording' && kind === 'video' && <video ref={live} muted playsInline aria-label={t.recordVideo} />}
      <div className="collection-actions">{phase === 'recording' && <button type="button" onClick={() => shutdown('stop')}>{t.stop}</button>}<button type="button" onClick={() => shutdown('discard')}>{t.discard}</button></div>
    </div>}
  </section>;
}
