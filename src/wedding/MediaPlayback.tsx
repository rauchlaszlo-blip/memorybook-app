import {useState} from 'react';
import type {AppLanguage} from '../i18n';
import {mediaCopy} from './media-copy';
export function MediaPlayback({kind,src,originalUrl,covered,language}:{kind:'audio'|'video';src:string;originalUrl?:string;covered:boolean;language:AppLanguage}){
  const [revealed,setRevealed]=useState(false),t=mediaCopy[language];
  if(covered&&!revealed)return <div className="review-covered"><p>{t.covered}</p><button type="button" onClick={()=>setRevealed(true)}>{t.reveal}</button></div>;
  return <div className="wedding-media-playback">{kind==='video'?<video controls playsInline preload="none" src={src} aria-label={t.playbackVideo}/>:<audio controls preload="none" src={src} aria-label={t.playbackAudio}/>}<p>{originalUrl&&<a href={originalUrl}>{t.download}</a>}</p>{covered&&<button type="button" onClick={()=>setRevealed(false)}>{t.cover}</button>}</div>;
}
