/** Metadata inspection never plays the file. Server decoding remains authoritative. */
export function mediaDuration(file:File,kind:'audio'|'video'):Promise<number>{return new Promise((resolve,reject)=>{
  const element=document.createElement(kind==='video'?'video':'audio'),url=URL.createObjectURL(file);let finished=false;
  const done=(duration?:number)=>{if(finished)return;finished=true;clearTimeout(timeout);element.removeAttribute('src');element.load();URL.revokeObjectURL(url);if(duration!==undefined)resolve(duration);else reject(new Error('invalid'));};
  const timeout=setTimeout(()=>done(),10000);element.preload='metadata';element.onloadedmetadata=()=>{if(Number.isFinite(element.duration)&&element.duration>0)done(element.duration);else{element.ontimeupdate=()=>{if(Number.isFinite(element.duration)&&element.duration>0)done(element.duration);};element.currentTime=1e10;}};element.onerror=()=>done();element.src=url;
});}
