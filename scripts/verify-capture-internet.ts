// Harmless synthetic uploads to the explicitly configured fictional pilot book only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {mediaBinaryPaths} from '../server/wedding/av-decoder';
import {loadInternetConfig,createOwnerContext,createRemoteContext,fictionalBook,getJson,ensure,writeJson} from './mcp-internet-utils';

const execute=promisify(execFile),{config,storagePath}=await loadInternetConfig(process.argv.find(x=>x.endsWith('.local')));
const dir=resolve('test-results/guest-capture/internet');await mkdir(dir,{recursive:true});
const checkpointFile=resolve(dir,'checkpoint.local');
type Item={kind:'photo'|'video'|'audio';file:string;key:string;mediaId?:string};
let checkpoint:{bookId:string;items:Item[]};
try{checkpoint=JSON.parse(await readFile(checkpointFile,'utf8'));ensure(checkpoint.bookId===config.bookId,'CHECKPOINT_BOOK_CHANGED');}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;checkpoint={bookId:config.bookId!,items:[{kind:'photo',file:'photo.png',key:randomUUID()},{kind:'video',file:'video.mp4',key:randomUUID()},{kind:'audio',file:'audio.wav',key:randomUUID()}]};await writeJson(checkpointFile,checkpoint);}
await writeFile(resolve(dir,'photo.png'),await sharp({create:{width:100,height:80,channels:3,background:'#52765a'}}).png().toBuffer());
const create=async(name:string,args:string[])=>{try{await readFile(resolve(dir,name));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await execute(mediaBinaryPaths().ffmpeg,['-hide_banner','-v','error','-nostdin','-y',...args,resolve(dir,name)],{timeout:30000,windowsHide:true});}};
await create('audio.wav',['-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=0.8','-c:a','pcm_s16le']);
await create('video.mp4',['-f','lavfi','-i','color=c=green:s=160x120:r=10:d=0.8','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','0.8','-c:v','libx264','-threads','1','-c:a','aac','-movflags','+faststart']);
await create('too-long.wav',['-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','20.1','-c:a','pcm_s16le']);
const owner=await createOwnerContext(config,storagePath),anon=await createRemoteContext(),guestState=resolve(dir,'guest-state.local');
let existingState:string|undefined;try{await readFile(guestState);existingState=guestState;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const guest=await createRemoteContext(existingState),foreign=config.operatorStorageState?await createRemoteContext(config.operatorStorageState):null;
const checks:{name:string;status:'PASS'}[]=[];const pass=(name:string)=>checks.push({name,status:'PASS'});
try{
  const before=await fictionalBook(owner,config);ensure(!before.book.closed_at,'FICTIONAL_BOOK_CLOSED');
  const root='/api/wedding/guest/'+before.book.invite_token;
  const quota=async()=>getJson<{media:{remaining:{photo:number;video:number;audio:number};used:{photo:number;video:number;audio:number};maxDurationSeconds:number}}>(guest,root);
  const initial=await quota();await guest.storageState({path:guestState});ensure(initial.media?.maxDurationSeconds===20,'NEW_CAPTURE_RELEASE_REQUIRED');pass('HTTPS guest capabilities and20s server limit');
  const upload=async(kind:string,key:string,bytes:Buffer,ctx=guest)=>ctx.post(root+'/media/'+key,{data:bytes,headers:{'Content-Type':'application/octet-stream','X-Media-Kind':kind},maxRedirects:0,timeout:120000});
  const anonymous=await upload('audio',randomUUID(),await readFile(resolve(dir,'audio.wav')),anon);ensure(anonymous.status()===428,'ANONYMOUS_UPLOAD_MUST_REQUIRE_GUEST_ID');pass('Upload requires guest cookie identity');
  for(const [kind,file,status] of [['audio','photo.png',415],['audio','too-long.wav',413]] as const){const r=await upload(kind,randomUUID(),await readFile(resolve(dir,file)));ensure(r.status()===status,'REJECT_INVALID_'+file+'_'+r.status());}
  ensure(JSON.stringify((await quota()).media.used)===JSON.stringify(initial.media.used),'INVALID_ATTEMPT_USED_QUOTA');pass('Actual type andover20s rejection preserve guest quota');
  for(const item of checkpoint.items){
    const bytes=await readFile(resolve(dir,item.file)),u=await upload(item.kind,item.key,bytes);ensure([200,201].includes(u.status()),'UPLOAD_'+item.kind+'_'+u.status());
    const uploaded=await u.json();ensure(uploaded.kind===item.kind,'ACTUAL_KIND');item.mediaId=uploaded.mediaId;await writeJson(checkpointFile,checkpoint);
    ensure(uploaded.mimeType===({photo:'image/png',video:'video/mp4',audio:'audio/wav'}[item.kind]),'ACTUAL_MIME');
    if(item.kind!=='photo')ensure(Number(uploaded.durationSeconds)>0&&Number(uploaded.durationSeconds)<=20,'DECODED_DURATION');
    const recovered=await getJson<{mediaId:string;kind:string}>(guest,root+'/media/'+item.key);ensure(recovered.mediaId===item.mediaId&&recovered.kind===item.kind,'LOST_UPLOAD_ACK_RECOVERY');
    ensure((await anon.get(root+'/media/'+item.key,{maxRedirects:0})).status()===404,'ANONYMOUS_RECOVERY_DENIED');
    const payload={idempotencyKey:item.key,mediaId:item.mediaId,name:'Fiktív HTTPS kamera/mikrofon próba',message:item.kind==='photo'?'Ártalmatlan színminta, kamera- és mikrofonpilot.':''};
    const sent=await guest.post(root+'/submissions',{data:payload,maxRedirects:0});ensure([200,201].includes(sent.status()),'COMMIT_'+item.kind+'_'+sent.status());
    const usedBeforeRetry=(await quota()).media.used;
    const again=await upload(item.kind,item.key,bytes);ensure(again.status()===200&&(await again.json()).mediaId===item.mediaId,'UPLOAD_REPLAY');
    const retry=await guest.post(root+'/submissions',{data:payload,maxRedirects:0});ensure(retry.status()===200&&(await retry.json()).replayed,'SUBMISSION_REPLAY');
    ensure(JSON.stringify((await quota()).media.used)===JSON.stringify(usedBeforeRetry),'RETRY_USED_QUOTA');
    const original='/api/wedding/media/'+item.mediaId+'/original',read=await owner.get(original,{maxRedirects:0});ensure(read.status()===200,'OWNER_ORIGINAL');
    ensure(read.headers()['content-type']?.split(';')[0]===uploaded.mimeType,'ORIGINAL_CONTENT_TYPE');
    ensure(createHash('sha256').update(await read.body()).digest('hex')===createHash('sha256').update(bytes).digest('hex'),'ORIGINAL_BYTES_CHANGED');
    ensure((await anon.get(original,{maxRedirects:0})).status()===401,'ANON_ORIGINAL');
    if(foreign)ensure((await foreign.get(original,{maxRedirects:0})).status()===404,'OTHER_OWNER_ORIGINAL');
    if(item.kind!=='photo'){
      const path='/api/wedding/media/'+item.mediaId+'/playback',partial=await owner.get(path,{headers:{Range:'bytes=0-15'},maxRedirects:0});
      ensure(partial.status()===206&&(await partial.body()).equals(bytes.subarray(0,16)),'RANGE_PLAYBACK');
      ensure(partial.headers()['content-type']?.split(';')[0]===uploaded.mimeType,'PLAYBACK_CONTENT_TYPE');
      ensure((await anon.get(path,{maxRedirects:0})).status()===401,'ANON_PLAYBACK');
      ensure((await owner.get('/api/wedding/media/'+item.mediaId+'/preview',{maxRedirects:0})).status()===404,'AV_IMAGE_PATH');
      pass(item.kind+' protected playback range, original bytes, no photo derivative');
    }
    pass(item.kind+' successful submit andidempotent retry');
  }
  const detail=await fictionalBook(owner,config);for(const item of checkpoint.items)ensure(detail.submissions.filter(s=>s.media.some(m=>m.id===item.mediaId)).length===1,'DUPLICATE_SUBMISSION');
  pass('All three fictional media submissions appear exactly once');
  const result={at:new Date().toISOString(),checks,physicalSamsung:'OPEN',physicalIphone:'OPEN',chatgpt:'NOT_TESTED',newPaidService:false,modelCalls:0,addedMedia:checkpoint.items.map(({kind,mediaId})=>({kind,mediaId}))};
  await writeJson(resolve(dir,'verification.json'),result);console.log(JSON.stringify({status:'PASS',checks:checks.length,physicalSamsung:'OPEN',physicalIphone:'OPEN'}));
}finally{await Promise.all([owner.dispose(),anon.dispose(),guest.dispose(),foreign?.dispose()]);}
