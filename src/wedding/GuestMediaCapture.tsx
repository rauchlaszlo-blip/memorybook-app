import {useCallback,useEffect,useRef,useState} from 'react';
import type {AppLanguage} from '../i18n';
import {mediaCopy} from './media-copy';
import type {GuestMediaCapability,MediaKind} from './media-copy';

type RecordingKind=Exclude<MediaKind,'photo'>;
type StopReason='manual'|'limit'|'hidden'|'discard'|'error'|'unmount';
type Capture={recorder:MediaRecorder;stream:MediaStream;chunks:Blob[];startedAt:number;kind:RecordingKind;reason:StopReason;timer:ReturnType<typeof setTimeout>;ticker:ReturnType<typeof setInterval>;stopping:boolean;finished:boolean;finish?:()=>void};
const formats={video:['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'],audio:['audio/mp4;codecs=mp4a.40.2','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']};

export function GuestMediaCapture({language,disabled,recordingDisabled,capability,onSelect,onRecordingChange}:{language:AppLanguage;disabled:boolean;recordingDisabled:boolean;capability:GuestMediaCapability;onSelect:(file:File,kind:RecordingKind,durationSeconds?:number)=>void;onRecordingChange:(recording:boolean)=>void}){
  const t=mediaCopy[language],[phase,setPhase]=useState<'idle'|'permission'|'recording'>('idle'),[kind,setKind]=useState<RecordingKind>('video'),[elapsed,setElapsed]=useState(0),[notice,setNotice]=useState<keyof typeof t|''>(''),[error,setError]=useState<keyof typeof t|''>('');
  const phaseRef=useRef<'idle'|'permission'|'recording'>('idle'),capture=useRef<Capture|null>(null),generation=useRef(0),mounted=useRef(true),live=useRef<HTMLVideoElement|null>(null),callbacks=useRef({onSelect,onRecordingChange});
  useEffect(()=>{callbacks.current={onSelect,onRecordingChange};},[onSelect,onRecordingChange]);
  const shutdown=useCallback((reason:StopReason)=>{
    generation.current++;const current=capture.current;
    if(!current){if(phaseRef.current==='idle')return;phaseRef.current='idle';if(mounted.current){setPhase('idle');callbacks.current.onRecordingChange(false);if(reason==='hidden')setNotice('interrupted');}return;}
    if(current.stopping){if(['discard','error','unmount'].includes(reason))current.reason=reason;return;}current.stopping=true;current.reason=reason;clearTimeout(current.timer);clearInterval(current.ticker);
    try{if(current.recorder.state!=='inactive')current.recorder.stop();else queueMicrotask(()=>current.finish?.());}catch{current.reason='error';queueMicrotask(()=>current.finish?.());}
    current.stream.getTracks().forEach(track=>track.stop());if(live.current)live.current.srcObject=null;
  },[]);
  useEffect(()=>{
    mounted.current=true;const hidden=()=>{if(document.visibilityState==='hidden')shutdown('hidden');},leave=()=>shutdown('hidden');
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);
    return()=>{mounted.current=false;shutdown('unmount');document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);callbacks.current.onRecordingChange(false);};
  },[shutdown]);
  useEffect(()=>{if(phase==='recording'&&kind==='video'&&live.current&&capture.current){live.current.srcObject=capture.current.stream;void live.current.play().catch(()=>{});}},[phase,kind]);
  async function start(nextKind:RecordingKind){
    if(disabled||recordingDisabled||capture.current||phaseRef.current!=='idle')return;setError('');setNotice('');setKind(nextKind);setElapsed(0);
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'||typeof MediaRecorder.isTypeSupported!=='function'){setError('unsupported');return;}
    const mimeType=formats[nextKind].find(type=>MediaRecorder.isTypeSupported(type));if(!mimeType){setError('unsupported');return;}
    const attempt=++generation.current;phaseRef.current='permission';setPhase('permission');callbacks.current.onRecordingChange(true);let stream:MediaStream|undefined;
    try{
      stream=await navigator.mediaDevices.getUserMedia(nextKind==='video'?{audio:true,video:{facingMode:{ideal:'environment'},width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:24,max:30}}}:{audio:true});
      if(!mounted.current||attempt!==generation.current||document.visibilityState==='hidden'){stream.getTracks().forEach(track=>track.stop());if(mounted.current&&attempt===generation.current){phaseRef.current='idle';setPhase('idle');setNotice('interrupted');callbacks.current.onRecordingChange(false);}return;}
      const recorder=new MediaRecorder(stream,{mimeType,...(nextKind==='video'?{videoBitsPerSecond:1_500_000,audioBitsPerSecond:96_000}:{audioBitsPerSecond:96_000})});
      const current:Capture={recorder,stream,chunks:[],startedAt:performance.now(),kind:nextKind,reason:'manual',timer:setTimeout(()=>shutdown('limit'),Math.max(0.5,Math.min(20,capability.maxDurationSeconds)-0.5)*1000),ticker:setInterval(()=>setElapsed(Math.min(20,(performance.now()-current.startedAt)/1000)),100),stopping:false,finished:false};capture.current=current;
      recorder.ondataavailable=event=>{if(event.data.size)current.chunks.push(event.data);};
      recorder.onerror=()=>{shutdown('error');if(mounted.current)setError('failed');};
      const finish=()=>{if(current.finished)return;current.finished=true;
        clearTimeout(current.timer);clearInterval(current.ticker);current.stream.getTracks().forEach(track=>track.stop());if(capture.current===current)capture.current=null;
        phaseRef.current='idle';if(!mounted.current)return;setPhase('idle');callbacks.current.onRecordingChange(false);if(live.current)live.current.srcObject=null;
        if(['discard','error','unmount'].includes(current.reason)){if(current.reason==='error')setError(previous=>previous||'failed');return;}
        const duration=Math.min(20,(performance.now()-current.startedAt)/1000),blob=new Blob(current.chunks,{type:recorder.mimeType||mimeType});if(!blob.size){setError('empty');return;}
        const extension=blob.type.includes('mp4')?(nextKind==='audio'?'m4a':'mp4'):blob.type.includes('ogg')?'ogg':'webm';
        callbacks.current.onSelect(new File([blob],`memorybook-${nextKind}.${extension}`,{type:blob.type}),nextKind,duration);setNotice(current.reason==='hidden'?'interrupted':current.reason==='limit'?'limited':'ready');
      };
      current.finish=finish;recorder.onstop=finish;
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(!current.stopping)shutdown('error');},{once:true}));
      recorder.start(250);phaseRef.current='recording';setPhase('recording');
    }catch(reason){
      stream?.getTracks().forEach(track=>track.stop());
      if(!mounted.current||attempt!==generation.current)return;
      const current=capture.current;if(current&&current.stream===stream){clearTimeout(current.timer);clearInterval(current.ticker);capture.current=null;}
      phaseRef.current='idle';setPhase('idle');callbacks.current.onRecordingChange(false);
      const name=reason instanceof DOMException?reason.name:'';setError(name==='NotAllowedError'||name==='SecurityError'?'denied':name==='NotFoundError'||name==='OverconstrainedError'?'missing':name==='NotReadableError'?'inUse':name==='NotSupportedError'?'unsupported':'failed');
    }
  }
  return <section className="wedding-capture" aria-label={language==='hu'?'Hang és videó felvétele':language==='de'?'Audio und Video aufnehmen':'Record audio and video'}>
    <p>{t.recordHint}</p>{error&&<p className="wedding-error" role="alert">{t[error]}</p>}{notice&&<p role="status">{t[notice]}</p>}
    {phase==='idle'?<fieldset disabled={disabled}><div className="wedding-photo-actions"><button type="button" disabled={recordingDisabled||capability.remaining.video<=0} onClick={()=>void start('video')}>{t.recordVideo}</button><button type="button" disabled={recordingDisabled||capability.remaining.audio<=0} onClick={()=>void start('audio')}>{t.recordAudio}</button></div><p>{t.fallback}</p><div className="wedding-photo-actions">{(['video','audio'] as const).map(type=><span key={type}><label className="wedding-button">{type==='video'?t.nativeVideo:t.nativeAudio}<input type="file" aria-label={type==='video'?t.nativeVideo:t.nativeAudio} accept={type+'/*'} capture={type==='video'?'environment':'user'} disabled={capability.remaining[type]<=0} onChange={event=>{const file=event.target.files?.[0];if(file)onSelect(file,type);event.target.value='';}}/></label><label className="wedding-button">{type==='video'?t.chooseVideo:t.chooseAudio}<input type="file" aria-label={type==='video'?t.chooseVideo:t.chooseAudio} accept={type+'/*'} onChange={event=>{const file=event.target.files?.[0];if(file)onSelect(file,type);event.target.value='';}}/></label></span>)}</div></fieldset>:<div className="wedding-recording"><p role="status">{phase==='permission'?t.requesting:`● ${t.recording} · ${t[kind]} · ${elapsed.toFixed(1)} / 20 s`}</p>{phase==='recording'&&kind==='video'&&<video ref={live} muted playsInline aria-label={t.recordVideo}/>}<div className="wedding-photo-actions">{phase==='recording'&&<button type="button" onClick={()=>shutdown('manual')}>{t.stop}</button>}<button type="button" onClick={()=>shutdown('discard')}>{t.cancel}</button></div></div>}
  </section>;
}
