// Authorized synthetic regression in a SEPARATE fictional book. Never a physical-phone PASS.
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {motionPhoto} from '../tests/fixtures/motion-photo';
import {loadInternetConfig,createRemoteContext,getJson,postJson,ensure,writeJson,uuid} from './mcp-internet-utils';
type Item={kind:'photo'|'video';key?:string;mediaId?:string;submissionId?:string;sha256?:string;mimeType?:string;committed?:boolean};
type Book={id:string;title:string;invite_token:string};
type Checkpoint={book:Book;items:Item[];checks:string[]};
const title='Samsung javítás – fiktív regresszió 20261122',guestName='Fiktív Samsung regresszió';
const {config}=await loadInternetConfig(process.argv.find(a=>a.endsWith('.local')));
ensure(process.argv.includes('--run'),'EXPLICIT_RUN_FLAG_REQUIRED');ensure(config.operatorStorageState,'OPERATOR_STATE_REQUIRED');
const dir=resolve('test-results/samsung-release/internet');await mkdir(dir,{recursive:true});
const checkpointPath=resolve(dir,'checkpoint.local'),guestStatePath=resolve(dir,'guest-state.local');
const owner=await createRemoteContext(config.operatorStorageState),anon=await createRemoteContext();
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,stage='scoped_fixture_book';
let checkpoint:Checkpoint|undefined;
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const save=async()=>writeJson(checkpointPath,checkpoint);
try{
  const caps=await getJson<{canCreate:boolean}>(owner,'/api/wedding/capabilities');ensure(caps.canCreate,'EXISTING_OPERATOR_CREATE_ACCESS_REQUIRED');
  const books=await getJson<{books:Book[]}>(owner,'/api/wedding/books'),existing=books.books.filter(b=>b.title===title);ensure(existing.length<=1,'AMBIGUOUS_TEST_BOOK');
  try{checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!checkpoint){const book=existing[0]||(await postJson<{book:Book}>(owner,'/api/wedding/books',{names:title,date:'2027-06-05'},[201])).book;checkpoint={book,items:[{kind:'photo'},{kind:'video'}],checks:[]};await save();}
  ensure(checkpoint.book.title===title&&checkpoint.book.id!==config.bookId&&checkpoint.book.id!==config.denyBookId,'TEST_BOOK_SCOPE_MISMATCH');
  const book=checkpoint.book,root='/api/wedding/guest/'+book.invite_token;
  const check=(name:string)=>{if(!checkpoint!.checks.includes(name))checkpoint!.checks.push(name);};
  const detail=()=>getJson<{submissions:{id:string;media:{id:string}[]}[]}>(owner,'/api/wedding/books/'+book.id);
  let guestState:string|undefined;try{await readFile(guestStatePath);guestState=guestStatePath;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;ensure(!checkpoint.items.some(i=>i.key),'GUEST_IDENTITY_LOST');}
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({baseURL:config.origin,storageState:guestState,viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'hu-HU',permissions:['camera','microphone'],serviceWorkers:'block'});
  await context.addInitScript(()=>{
    localStorage.setItem('memorybook.appLanguage','hu');
    // Exercise the actual WebM fallback used when a phone cannot record MP4.
    const supported=MediaRecorder.isTypeSupported.bind(MediaRecorder);
    MediaRecorder.isTypeSupported=(mime:string)=>!mime.startsWith('video/mp4')&&supported(mime);
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));
  let active:Item|undefined,dropUploadAck=false;
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(['blob:','data:'].includes(url.protocol)){await route.continue();return;}
    ensure(url.origin===config.origin,'EXTERNAL_BROWSER_REQUEST_DENIED');
    if(['GET','HEAD'].includes(req.method())){await route.continue();return;}
    ensure(req.method()==='POST'&&active,'UNEXPECTED_BROWSER_WRITE');
    if(url.pathname.startsWith(root+'/media/')){
      const key=url.pathname.slice((root+'/media/').length),bytes=req.postDataBuffer();
      ensure(uuid.test(key)&&bytes&&req.headers()['x-media-kind']===active.kind&&(!active.key||active.key===key),'UPLOAD_SCOPE_MISMATCH');
      const checksum=hash(bytes);ensure(!active.sha256||active.sha256===checksum,'RETRY_BYTES_CHANGED');
      active.key=key;active.sha256=checksum;await writeFile(resolve(dir,active.kind+'.bin'),bytes);await context.storageState({path:guestStatePath});await save();
      const response=await route.fetch({timeout:120000,maxRedirects:0}),body=await response.json();
      ensure([200,201].includes(response.status())&&['uploaded','attached'].includes(body.state)&&uuid.test(body.mediaId),'DURABLE_UPLOAD_ACK_REQUIRED');
      ensure(!active.mediaId||active.mediaId===body.mediaId,'MEDIA_ID_CHANGED');active.mediaId=body.mediaId;active.mimeType=body.mimeType;
      ensure(active.kind!=='video'||body.mimeType==='video/webm','WEBM_CAMERA_FALLBACK_REQUIRED');await save();
      if(dropUploadAck){dropUploadAck=false;await route.abort('failed');return;}
      await route.fulfill({response});return;
    }
    ensure(url.pathname===root+'/submissions','UNEXPECTED_GUEST_WRITE');
    const payload=req.postDataJSON();ensure(payload.name===guestName&&payload.message==='Fiktív regressziós minta.'&&payload.idempotencyKey===active.key&&payload.mediaId===active.mediaId,'SUBMISSION_SCOPE_MISMATCH');
    const response=await route.fetch({timeout:120000,maxRedirects:0}),body=await response.json();
    ensure([200,201].includes(response.status())&&body.accepted===true&&body.state==='committed'&&uuid.test(body.submissionId)&&body.mediaId===active.mediaId,'DURABLE_SUBMISSION_ACK_REQUIRED');
    active.submissionId=body.submissionId;active.committed=true;await save();await route.fulfill({response});
  });
  for(const item of checkpoint.items){
    active=item;stage='guest_'+item.kind;
    if(item.key&&!item.committed){
      const bytes=await readFile(resolve(dir,item.kind+'.bin'));ensure(hash(bytes)===item.sha256,'RECOVERY_BYTES_CHANGED');
      const upload=await context.request.post(root+'/media/'+item.key,{headers:{Origin:config.origin,'Content-Type':'application/octet-stream','X-Media-Kind':item.kind},data:bytes,timeout:120000});
      ensure([200,201].includes(upload.status()),'RECOVERY_UPLOAD_FAILED');item.mediaId=(await upload.json()).mediaId;
      const sent=await context.request.post(root+'/submissions',{headers:{Origin:config.origin},data:{name:guestName,message:'Fiktív regressziós minta.',idempotencyKey:item.key,mediaId:item.mediaId}});
      ensure([200,201].includes(sent.status()),'RECOVERY_SUBMISSION_FAILED');const receipt=await sent.json();ensure(receipt.state==='committed'&&uuid.test(receipt.submissionId),'RECOVERY_COMMIT_NOT_PROVEN');item.submissionId=receipt.submissionId;item.committed=true;check(item.kind+': interrupted verifier recovered with original key/bytes');await save();
    }
    if(!item.committed){
      await page.goto('/wedding/join/'+book.invite_token,{waitUntil:'networkidle'});await context.storageState({path:guestStatePath});
      await page.getByLabel('Neved',{exact:true}).fill(guestName);await page.getByLabel('Jókívánságod',{exact:true}).fill('Fiktív regressziós minta.');
      if(item.kind==='photo'){
        const jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#5c9270'}}).jpeg().toBuffer();
        const video=await readFile(resolve('test-results/guest-capture/internet/video.mp4'));
        await page.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles({name:'fiktiv-motion.jpg',mimeType:'image/jpeg',buffer:motionPhoto(jpeg,video)});
        dropUploadAck=true;await page.getByRole('button',{name:'Beküldés',exact:true}).click();
        await expect(page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true})).toBeEnabled({timeout:120000});
        ensure(await page.getByLabel('Neved',{exact:true}).inputValue()===guestName,'LOST_ACK_CLEARED_NAME');
        ensure(await page.getByLabel('Jókívánságod',{exact:true}).inputValue()==='Fiktív regressziós minta.','LOST_ACK_CLEARED_MESSAGE');
        await expect(page.getByRole('status').filter({hasText:'Köszönjük!'})).toHaveCount(0);
        const pending=await getJson<{attempts:{mediaId:string|null;state:string}[]}>(owner,'/api/wedding/books/'+book.id+'/media-attempts');
        ensure(pending.attempts.some(a=>a.mediaId===item.mediaId&&a.state==='uploaded'),'DURABLE_PENDING_UPLOAD_NOT_VISIBLE');
        ensure(!(await detail()).submissions.some(s=>s.media.some(m=>m.id===item.mediaId)),'UPLOAD_ALONE_MUST_NOT_BE_A_SUBMISSION');
        check('Lost upload ACK retains form and shows owner pending state without false success');
        await page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
      }else{
        await page.getByRole('button',{name:'Videó felvétele',exact:true}).click();await expect(page.getByText(/● Felvétel készül/)).toBeVisible();await page.waitForTimeout(1200);
        await page.getByRole('button',{name:'Felvétel leállítása',exact:true}).click();await expect(page.getByLabel('Kiválasztott videó',{exact:true})).toBeVisible();
        await page.getByRole('button',{name:'Beküldés',exact:true}).click();
      }
      await expect(page.getByRole('status').filter({hasText:'Köszönjük!'})).toBeVisible({timeout:120000});ensure(item.committed,'SUCCESS_WITHOUT_COMMITTED_RESPONSE');
    }
    const current=await detail();ensure(current.submissions.filter(s=>s.id===item.submissionId&&s.media.some(m=>m.id===item.mediaId)).length===1,'OWNER_ATTACHMENT_NOT_EXACTLY_ONCE');
    const quota=await getJson<{media:{used:unknown}}>(context.request,root),bytes=await readFile(resolve(dir,item.kind+'.bin'));
    const replay=await context.request.post(root+'/submissions',{headers:{Origin:config.origin},data:{name:guestName,message:'Fiktív regressziós minta.',idempotencyKey:item.key,mediaId:item.mediaId}});ensure(replay.status()===200&&(await replay.json()).submissionId===item.submissionId,'REPLAY_SUBMISSION_CHANGED');
    ensure(JSON.stringify((await getJson<{media:{used:unknown}}>(context.request,root)).media.used)===JSON.stringify(quota.media.used),'REPLAY_CONSUMED_QUOTA');
    const original='/api/wedding/media/'+item.mediaId+'/original',response=await owner.get(original);ensure(response.status()===200&&hash(await response.body())===hash(bytes),'ORIGINAL_NOT_PRESERVED');ensure((await anon.get(original)).status()===401,'ANONYMOUS_MEDIA_EXPOSED');
    check(item.kind+': durable commit, exact owner attachment, preserved original and quota-neutral retry');await save();
  }
  active=undefined;stage='owner_mobile_ui';
  const ownerContext=await browser.newContext({baseURL:config.origin,storageState:config.operatorStorageState,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await ownerContext.route('**/*',async route=>{ensure(['GET','HEAD'].includes(route.request().method()),'UNEXPECTED_OWNER_WRITE');await route.continue();});
  const ownerPage=await ownerContext.newPage();await ownerPage.goto('/wedding/books/'+book.id,{waitUntil:'networkidle',timeout:120000});
  await expect(ownerPage.getByRole('region',{name:'Feltöltések feldolgozása',exact:true})).toBeVisible();
  const photo=checkpoint.items[0],video=checkpoint.items[1];
  const thumbnail=ownerPage.locator('img[src$="/api/wedding/media/'+photo.mediaId+'/preview"]');await thumbnail.locator('..').scrollIntoViewIfNeeded();await expect.poll(()=>thumbnail.evaluate((e:HTMLImageElement)=>e.complete&&e.naturalWidth>0)).toBe(true);
  const player=ownerPage.locator('video[src$="/api/wedding/media/'+video.mediaId+'/playback"]');await expect(player).toBeVisible();ensure(await player.evaluate((e:HTMLVideoElement)=>e.paused&&!e.autoplay),'AUTOPLAY_FORBIDDEN');
  await player.evaluate(async(e:HTMLVideoElement)=>{await e.play();});await expect.poll(()=>player.evaluate((e:HTMLVideoElement)=>e.currentTime)).toBeGreaterThan(0);await player.evaluate((e:HTMLVideoElement)=>e.pause());
  await ownerPage.screenshot({path:resolve(dir,'owner-mobile.png'),fullPage:true,mask:[ownerPage.locator('input[readonly]'),ownerPage.locator('.wedding-qr')]});
  ensure(errors.length===0,'BROWSER_RUNTIME_ERROR');check('HTTPS mobile owner list loads actual photo and plays camera video without autoplay');await save();
  await writeJson(resolve(dir,'verification.json'),{status:'PASS',at:new Date().toISOString(),testBookId:book.id,checks:checkpoint.checks,physicalSamsung:'OPEN',physicalIphone:'OPEN',syntheticChromium:true,designatedBookMutated:false});
  console.log(JSON.stringify({status:'PASS',testBookId:book.id,checks:checkpoint.checks.length,physicalSamsung:'OPEN'}));
}catch(error){const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'SAMSUNG_LIVE_CHECK_FAILED';await writeJson(resolve(dir,'verification.json'),{status:'FAIL',stage,code});console.error(JSON.stringify({status:'FAIL',stage,code}));process.exitCode=1;}
finally{await browser?.close();await owner.dispose();await anon.dispose();}
