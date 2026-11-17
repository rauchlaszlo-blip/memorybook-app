// Desktop Chromium's synthetic devices over real HTTPS. Never a physical-phone PASS.
// Checkpoints retain only this helper's harmless samples. Restart reuses exact uploads.
import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {loadInternetConfig,createOwnerContext,createRemoteContext,fictionalBook,ensure,writeJson,uuid} from './mcp-internet-utils';

type Kind='video'|'audio'|'photo';
type Payload={name:string;message:string;idempotencyKey:string;mediaId?:string};
type Item={kind:Kind;key?:string;mediaId?:string;mimeType?:string;sha256?:string;payload?:Payload;committed?:boolean};
type Checkpoint={bookId:string;origin:string;items:Item[];checks:string[]};
const guestName='Fiktív HTTPS böngészőfelvétel',photoMessage='Fiktív színminta HTTPS-feltöltéssel.';
const ownerOnly=process.argv.includes('--owner-only');
const {config,storagePath}=await loadInternetConfig(process.argv.find(x=>x.endsWith('.local')));
const dir=resolve('test-results/guest-capture/internet-browser');await mkdir(dir,{recursive:true});
const checkpointPath=resolve(dir,'checkpoint.local'),guestStatePath=resolve(dir,'guest-state.local');
let checkpoint:Checkpoint;
try{
  checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));
  ensure(checkpoint.bookId===config.bookId&&checkpoint.origin===config.origin,'CHECKPOINT_SCOPE_CHANGED');
  ensure(checkpoint.items.length===3&&checkpoint.items.map(i=>i.kind).join(',')==='video,audio,photo','CHECKPOINT_ITEMS_CHANGED');
  for(const item of checkpoint.items)ensure(!item.key||uuid.test(item.key)&&item.payload?.idempotencyKey===item.key&&item.payload.name===guestName&&item.payload.message===(item.kind==='photo'?photoMessage:''),'CHECKPOINT_ATTEMPT_CHANGED');
}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  checkpoint={bookId:config.bookId!,origin:config.origin,items:[{kind:'video'},{kind:'audio'},{kind:'photo'}],checks:[]};
}
async function save(){const temporary=checkpointPath+'.tmp';await writeFile(temporary,JSON.stringify(checkpoint,null,2));await rename(temporary,checkpointPath);}
const pass=(name:string)=>{if(!checkpoint.checks.includes(name))checkpoint.checks.push(name);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
await save();
let guestState:string|undefined;
try{await readFile(guestStatePath);guestState=guestStatePath;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;ensure(!checkpoint.items.some(i=>i.key),'GUEST_IDENTITY_LOST_STOP_FOR_RECOVERY');}
const owner=ownerOnly?await createRemoteContext(storagePath):await createOwnerContext(config,storagePath);
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let stage='owner_book_validation';
try{
  let detail=await fictionalBook(owner,config);ensure(!detail.book.closed_at,'BOOK_CLOSED');
  if(ownerOnly)for(const item of checkpoint.items)ensure(item.committed&&uuid.test(item.mediaId||'')&&item.mimeType&&detail.submissions.filter(s=>s.media.some(m=>m.id===item.mediaId)).length===1,'OWNER_ONLY_REQUIRES_ALL_THREE_COMMITTED');
  stage='browser_launch';
  browser=await chromium.launch({channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({storageState:guestState,viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone'],locale:'hu-HU'});
  await context.addInitScript(()=>{
    localStorage.setItem('memorybook.appLanguage','hu');
    const state=window as unknown as {__captureTracks:MediaStreamTrack[]};state.__captureTracks=[];
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);state.__captureTracks.push(...stream.getTracks());return stream;};
  });
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));
  const guestRoot='/api/wedding/guest/'+detail.book.invite_token,route=config.origin+'/wedding/join/'+detail.book.invite_token;
  let active:Item|undefined;
  await page.route('**/api/wedding/guest/**',async routed=>{
    const request=routed.request();if(request.method()!=='POST'){await routed.continue();return;}
    ensure(active,'UNEXPECTED_GUEST_WRITE');const path=new URL(request.url());ensure(path.origin===config.origin,'REMOTE_ORIGIN_CHANGED');
    if(path.pathname.startsWith(guestRoot+'/media/')){
      const key=path.pathname.slice((guestRoot+'/media/').length),bytes=request.postDataBuffer();
      ensure(uuid.test(key)&&bytes&&request.headers()['x-media-kind']===active.kind,'UPLOAD_SCOPE_CHANGED');
      ensure(!active.key||active.key===key,'UPLOAD_KEY_CHANGED');
      active.key=key;active.payload={name:guestName,message:active.kind==='photo'?photoMessage:'',idempotencyKey:key};
      active.sha256=hash(bytes);await writeFile(resolve(dir,active.kind+'-request.bin'),bytes);
      await context.storageState({path:guestStatePath});await save(); // Finish checkpoint before the remote write.
    }else{
      ensure(path.pathname===guestRoot+'/submissions','UNEXPECTED_GUEST_WRITE');
      const payload=request.postDataJSON() as Payload;
      ensure(payload.idempotencyKey===active.key&&payload.name===guestName&&payload.message===(active.kind==='photo'?photoMessage:'')&&uuid.test(payload.mediaId||''),'SUBMISSION_SCOPE_CHANGED');
      active.mediaId=payload.mediaId;active.payload=payload;await save();
    }
    await routed.continue();
  });
  for(const item of ownerOnly?[]:checkpoint.items){
    stage='guest_'+item.kind;
    active=item;
    if(item.key){
      // An interrupted run reuses its cookie, key and exact file; never records a replacement.
      detail=await fictionalBook(owner,config);
      if(!item.mimeType||!item.mediaId||!detail.submissions.some(s=>s.media.some(m=>m.id===item.mediaId))){
        const recovered=await context.request.get(config.origin+guestRoot+'/media/'+item.key,{maxRedirects:0});
        if(recovered.status()===200){
          const result=await recovered.json();ensure(uuid.test(result.mediaId)&&result.kind===item.kind&&(!item.mediaId||item.mediaId===result.mediaId),'RECOVERED_MEDIA_CHANGED');item.mediaId=result.mediaId;item.mimeType=result.mimeType;
        }else{
          ensure(recovered.status()===404&&!item.committed,'RECOVERY_UNCERTAIN_STOP');
          const bytes=await readFile(resolve(dir,item.kind+'-request.bin'));ensure(hash(bytes)===item.sha256,'RECOVERY_BYTES_CHANGED');
          const uploaded=await context.request.post(config.origin+guestRoot+'/media/'+item.key,{data:bytes,headers:{Origin:config.origin,'Content-Type':'application/octet-stream','X-Media-Kind':item.kind},maxRedirects:0,timeout:120000});
          ensure([200,201].includes(uploaded.status()),'RECOVERY_UPLOAD_'+uploaded.status());const result=await uploaded.json();ensure(uuid.test(result.mediaId)&&result.kind===item.kind,'RECOVERY_KIND_CHANGED');item.mediaId=result.mediaId;item.mimeType=result.mimeType;
        }
        item.payload={...item.payload!,mediaId:item.mediaId};await save();
        detail=await fictionalBook(owner,config);
        if(!detail.submissions.some(s=>s.media.some(m=>m.id===item.mediaId))){
          const response=await context.request.post(config.origin+guestRoot+'/submissions',{data:item.payload,headers:{Origin:config.origin},maxRedirects:0,timeout:120000});ensure([200,201].includes(response.status()),'RECOVERY_COMMIT_'+response.status());
        }
      }
      detail=await fictionalBook(owner,config);ensure(detail.submissions.filter(s=>s.media.some(m=>m.id===item.mediaId)).length===1,'RECOVERY_COMMIT_NOT_PROVEN');
      item.committed=true;pass(item.kind+': separate HTTPS submission and success');await save();continue;
    }
    await page.goto(route,{waitUntil:'networkidle',timeout:120000});
    await context.storageState({path:guestStatePath});
    await page.getByLabel('Neved',{exact:true}).fill(guestName);
    if(item.kind==='photo'){
      const buffer=await sharp({create:{width:100,height:80,channels:3,background:'#427aa3'}}).png().toBuffer();
      await page.locator('input[type=file][accept="image/jpeg,image/png"]:not([capture])').setInputFiles({name:'fiktiv-foto.png',mimeType:'image/png',buffer});
      await page.getByLabel('Jókívánságod',{exact:true}).fill(photoMessage);
    }else{
      await page.getByRole('button',{name:item.kind==='video'?'Videó felvétele':'Hangfelvétel indítása',exact:true}).click();
      await expect(page.getByText(/● Felvétel készül/)).toBeVisible();await page.waitForTimeout(1200);
      await page.getByRole('button',{name:'Felvétel leállítása',exact:true}).click();
      const preview=page.getByLabel(item.kind==='video'?'Kiválasztott videó':'Kiválasztott hangfelvétel',{exact:true});await expect(preview).toBeVisible();
      ensure(await preview.evaluate((e:HTMLMediaElement)=>e.paused&&!e.autoplay),'NO_PREVIEW_AUTOPLAY');
      ensure(await page.evaluate(()=>(window as unknown as {__captureTracks:MediaStreamTrack[]}).__captureTracks.every(t=>t.readyState==='ended')),'TRACKS_MUST_STOP');
      await preview.evaluate(async(e:HTMLMediaElement)=>{await e.play();});
      await expect.poll(()=>preview.evaluate((e:HTMLMediaElement)=>e.currentTime)).toBeGreaterThan(0);await preview.evaluate((e:HTMLMediaElement)=>e.pause());
      pass(item.kind+': real synthetic getUserMedia/MediaRecorder, stopped tracks, explicit playback');
    }
    ensure(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');
    await page.screenshot({path:resolve(dir,item.kind+'-before-send.png'),fullPage:true});await save();
    const uploaded=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.startsWith(guestRoot+'/media/'),{timeout:120000});
    await page.getByRole('button',{name:'Beküldés',exact:true}).click();
    const u=await uploaded;ensure([200,201].includes(u.status()),'REMOTE_UPLOAD_'+item.kind+'_'+u.status());const result=await u.json();ensure(uuid.test(result.mediaId)&&result.kind===item.kind,'ACTUAL_KIND_CHANGED');item.mediaId=result.mediaId;item.mimeType=result.mimeType;
    await expect(page.getByRole('status').filter({hasText:'Köszönjük!'})).toBeVisible({timeout:120000});
    detail=await fictionalBook(owner,config);ensure(detail.submissions.filter(s=>s.media.some(m=>m.id===item.mediaId)).length===1,'OWNER_SUBMISSION_ONCE');
    item.committed=true;pass(item.kind+': separate HTTPS submission and success');await save();
  }
  active=undefined;
  stage='owner_playback';
  const ownerContext=await browser.newContext({storageState:storagePath,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  let blockedOwnerWrites=0;
  await ownerContext.route('**/*',async routed=>{
    const request=routed.request(),url=new URL(request.url());
    if(url.origin!==config.origin||!['GET','HEAD'].includes(request.method())){blockedOwnerWrites++;await routed.abort('blockedbyclient');return;}
    await routed.continue();
  });
  await ownerContext.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));
  const ownerPage=await ownerContext.newPage();ownerPage.on('pageerror',e=>errors.push(e.name));
  await ownerPage.goto(config.origin+'/wedding/books/'+config.bookId,{waitUntil:'networkidle',timeout:120000});
  for(const item of checkpoint.items.filter(i=>i.kind!=='photo')){
    const path='/api/wedding/media/'+item.mediaId+'/playback';
    const player=ownerPage.locator(item.kind+'[src$="'+path+'"]');await expect(player).toBeVisible();
    const response=await owner.get(path,{headers:{Range:'bytes=0-15'},maxRedirects:0});ensure(response.status()===206&&response.headers()['content-type']?.split(';')[0]===item.mimeType,'OWNER_PLAYBACK_MIME');
    ensure(await player.evaluate((e:HTMLMediaElement)=>e.paused&&!e.autoplay),'OWNER_NO_AUTOPLAY');
    await player.evaluate(async(e:HTMLMediaElement)=>{await e.play();});
    await expect.poll(()=>player.evaluate((e:HTMLMediaElement)=>e.currentTime)).toBeGreaterThan(0);await player.evaluate((e:HTMLMediaElement)=>e.pause());
  }
  stage='owner_photo';
  const photo=checkpoint.items.find(i=>i.kind==='photo')!;
  const image=ownerPage.locator('img[src$="/api/wedding/media/'+photo.mediaId+'/preview"]');
  // This gallery uses native lazy loading. The image can be zero-sized until its
  // visible button reaches the viewport; asserting image visibility first deadlocks.
  await image.locator('..').scrollIntoViewIfNeeded();
  await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);await expect(image).toBeVisible();
  await ownerPage.screenshot({path:resolve(dir,'owner-playback.png'),fullPage:true});pass('Authenticated owner exact video/audio playback and photo over HTTPS');
  ensure(!errors.length,'BROWSER_RUNTIME_ERROR');ensure(blockedOwnerWrites===0,'OWNER_VIEW_ATTEMPTED_WRITE_OR_EXTERNAL_REQUEST');await save();
  await writeJson(resolve(dir,'verification.json'),{at:new Date().toISOString(),status:'PASS',mode:ownerOnly?'OWNER_ONLY_RECHECK_ALL_WRITES_BLOCKED':'CAPTURE_AND_OWNER_CHECK',checks:checkpoint.checks,mediaIds:checkpoint.items.map(i=>i.mediaId),devices:'Desktop Chromium synthetic camera/microphone,390px mobile emulation; photo file injection',physicalSamsung:'OPEN',physicalIphone:'OPEN',chatgpt:'NOT_TESTED'});
  console.log(JSON.stringify({status:'PASS',checks:checkpoint.checks.length,physicalSamsung:'OPEN',physicalIphone:'OPEN'}));
}catch(error){
  // Playwright assertion messages can include the private guest invite in an
  // accessibility snapshot. Never print/store that raw error or its stack.
  const code=error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'BROWSER_CHECK_FAILED';
  await writeJson(resolve(dir,'verification.json'),{at:new Date().toISOString(),status:'FAIL',stage,code,mode:ownerOnly?'OWNER_ONLY_RECHECK_ALL_WRITES_BLOCKED':'CAPTURE_AND_OWNER_CHECK',mediaIds:checkpoint.items.map(i=>i.mediaId)});
  console.error(JSON.stringify({status:'FAIL',stage,code}));process.exitCode=1;
}finally{await browser?.close();await owner.dispose();}
