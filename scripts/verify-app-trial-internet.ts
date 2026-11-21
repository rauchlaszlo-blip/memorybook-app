// Explicit HTTPS app trial verification. Only redeem/leave may write; book/editor reads are guarded.
// Offline: node --import tsx scripts/verify-app-trial-internet.ts --check-config config.local grant.local
// Authorized live: same inputs with --run [--mobile]. Never imports owner cookies into the browser.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import type {APIRequestContext,Browser,BrowserContext,Page} from '@playwright/test';
import type {Draft} from '../shared/montage';
import type {ReviewState} from '../shared/content-review';
import {parseAppTrialGrant,appTrialCookieName} from '../server/pilot/app-trial';
import {pilotOrigin,loadInternetConfig,createRemoteContext,getJson,fictionalBook,ensure,writeJson} from './mcp-internet-utils';

const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const digest=(value:unknown)=>createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');
type Head={latestVersionId:string|null;versions:{id:string}[];snapshots:{id:string}[]};
type Version={id:string;snapshotId:string|null;approved_at:string|null;draft:Draft};
type Exports={exports:{id:string;version_id:string;status:string;withheld?:boolean}[]};
type TrialInput={version:1;url:string;bookId:string;expiresAt:string;grant:unknown};
type View={name:string;status:'RUNNING'|'PASS'|'FAIL';mobileEmulation:boolean;viewport:{width:number;height:number};redeemPosts:number;leavePosts:number;blockedWrites:number;blockedExternal:number;runtimeErrors:number;failedResponses:number;deniedReadChecks?:number;imageResponses?:number;fontLoaded?:boolean;canvasColors?:number;pageCount?:number;submissions?:number;cookiesCleared?:boolean;screenshots:string[]};
const report:{status:'RUNNING'|'PASS'|'FAIL';stage:string;startedAt:string;finishedAt?:string;bookId?:string;versionId?:string;views:View[];serverStateUnchanged?:boolean;foreignBookUnchanged?:boolean;baselineHash?:string;pdfSha256?:string;errorCode?:string;mode:string;physicalPhones:string;actualChatGpt:string}={status:'RUNNING',stage:'load_config',startedAt:new Date().toISOString(),views:[],mode:'READ_ONLY_BOOK_WITH_REDEEM_AND_LEAVE',physicalPhones:'NOT_TESTED',actualChatGpt:'NOT_TESTED'};
let browser:Browser|undefined,context:BrowserContext|undefined,page:Page|undefined,owner:APIRequestContext|undefined,operator:APIRequestContext|undefined;
const outputDirectory=resolve('test-results/app-trial/browser'),reportPath=resolve(outputDirectory,'verification.json');
let baseline:string|undefined,foreignBaseline:string|undefined,foreignContext:APIRequestContext|undefined,foreignBookId:string|undefined,foreignMediaId:string|undefined;
let readState:(()=>Promise<{head:Head;version:Version;reviews:ReviewState;exports:Exports;pdfSha256:string;book:Awaited<ReturnType<typeof fictionalBook>>}>)|undefined;
const stage=(value:string)=>{report.stage=value;console.log('App trial check: '+value);};
const safeError=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{1,90}$/.test(error.message)?error.message:'APP_TRIAL_BROWSER_CHECK_FAILED';

try{
  const files=process.argv.filter(value=>value.endsWith('.local'));
  const {config,storagePath}=await loadInternetConfig(files[0]||'test-results/mcp-internet/config.local');
  const grantPath=resolve(files[1]||'test-results/app-trial/grant.local'),relativeGrant=relative(resolve('test-results/app-trial'),grantPath);
  ensure(relativeGrant!==''&&!relativeGrant.startsWith('..')&&!isAbsolute(relativeGrant)&&grantPath.endsWith('.local'),'GRANT_INPUT_MUST_BE_IGNORED_APP_TRIAL_FILE');
  const input=JSON.parse(await readFile(grantPath,'utf8')) as TrialInput;
  const grant=parseAppTrialGrant(typeof input.grant==='string'?input.grant:JSON.stringify(input.grant));
  ensure(grant&&input.version===1&&input.bookId===config.bookId&&grant.bookId===config.bookId&&grant.expectedTitle===config.expectedTitle&&input.expiresAt===grant.expiresAt,'APP_TRIAL_GRANT_SCOPE_MISMATCH');
  const entry=new URL(input.url),fragment=new URLSearchParams(entry.hash.slice(1)),key=fragment.get('key');
  ensure(entry.origin===pilotOrigin&&entry.pathname==='/wedding/try'&&!entry.search&&!entry.username&&!entry.password&&[...fragment.keys()].length===1&&key&&/^[A-Za-z0-9_-]{43}$/.test(key)&&digest(key)===grant.tokenHash,'APP_TRIAL_ENTRY_HASH_MISMATCH');
  ensure(Date.parse(grant.authorizedAt)<=Date.now()&&Date.parse(grant.expiresAt)>Date.now(),'APP_TRIAL_GRANT_NOT_ACTIVE');
  report.bookId=config.bookId;
  if(process.argv.includes('--check-config')){console.log('PASS: exact pilot/book, ignored inputs, fragment key hash and expiry validated; no network/browser activity.');process.exit(0);}
  ensure(process.argv.includes('--run'),'EXPLICIT_RUN_FLAG_REQUIRED');
  await mkdir(outputDirectory,{recursive:true});await writeJson(reportPath,report);
  stage('owner_read_only_baseline');
  owner=await createRemoteContext(storagePath); // No sign-in, password use, storage refresh or other owner mutation.
  const root='/api/book-workflow/'+config.bookId;
  readState=async()=>{
    const book=await fictionalBook(owner!,config),head=await getJson<Head>(owner!,root);
    ensure(head.latestVersionId,'SAVED_VERSION_REQUIRED');
    const version=await getJson<Version>(owner!,root+'/versions/'+head.latestVersionId),exports=await getJson<Exports>(owner!,root+'/exports');
    const reviews=await getJson<ReviewState>(owner!,root+'/reviews?versionId='+version.id),completed=exports.exports.find(job=>job.version_id===version.id&&job.status==='complete'&&!job.withheld);
    ensure(version.approved_at&&version.snapshotId&&completed,'APPROVED_VERSION_WITH_AVAILABLE_PDF_REQUIRED');
    const pdf=await owner!.get(root+'/exports/'+completed.id+'/download',{maxRedirects:0});ensure(pdf.status()===200,'OWNER_PDF_READ_FAILED');
    return{book,head,version,reviews,exports,pdfSha256:digest(await pdf.body())};
  };
  const initial=await readState();ensure(initial.book.submissions.length===38,'EXPECTED_38_FICTIONAL_SUBMISSIONS');ensure(initial.version.draft.pages.length===16,'EXPECTED_16_SAVED_PAGES');
  baseline=digest(initial);report.baselineHash=baseline;report.pdfSha256=initial.pdfSha256;report.versionId=initial.version.id;
  // Locate a REAL foreign media id through separately authorized existing owner contexts.
  // A random/nonexistent id would not prove cross-book media isolation.
  const candidates=[owner];if(config.operatorStorageState){operator=await createRemoteContext(config.operatorStorageState);candidates.push(operator);}
  for(const candidate of candidates){
    const list=await candidate.get('/api/wedding/books',{maxRedirects:0});if(list.status()!==200)continue;
    const books=(await list.json() as {books:{id:string}[]}).books;
    for(const b of books.filter(b=>b.id!==config.bookId)){
      const detail=await getJson<Awaited<ReturnType<typeof fictionalBook>>>(candidate,'/api/wedding/books/'+b.id),media=detail.submissions.flatMap(s=>s.media||[])[0];
      if(media){foreignContext=candidate;foreignBookId=b.id;foreignMediaId=media.id;foreignBaseline=digest(detail);break;}
    }
    if(foreignMediaId)break;
  }
  ensure(foreignContext&&foreignBookId&&foreignMediaId,'REAL_FOREIGN_MEDIA_FIXTURE_REQUIRED');
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const mobile of process.argv.includes('--mobile')?[false,true]:[false]){
    const name=mobile?'mobile-emulation':'desktop',viewport=mobile?{width:390,height:844}:{width:1280,height:1000};
    const view:View={name,status:'RUNNING',mobileEmulation:mobile,viewport,redeemPosts:0,leavePosts:0,blockedWrites:0,blockedExternal:0,runtimeErrors:0,failedResponses:0,screenshots:[]};report.views.push(view);
    context=await browser.newContext({baseURL:pilotOrigin,viewport,isMobile:mobile,hasTouch:mobile,locale:'hu-HU',serviceWorkers:'block'});
    ensure((await context.cookies()).length===0,'FRESH_BROWSER_MUST_HAVE_NO_OWNER_COOKIES');
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(['data:','blob:'].includes(url.protocol)){await route.continue();return;}
      if(url.origin!==pilotOrigin){view.blockedExternal++;await route.abort('blockedbyclient');return;}
      if(!['GET','HEAD'].includes(req.method())){
        let allowed=false;
        if(req.method()==='POST'&&url.pathname==='/api/pilot/app-trial/redeem'&&view.redeemPosts===0){try{const body=req.postDataJSON() as {key?:string};allowed=Object.keys(body).length===1&&typeof body.key==='string'&&digest(body.key)===grant.tokenHash;}catch{/* Deny unrecognized writes. */}if(allowed)view.redeemPosts++;}
        if(req.method()==='POST'&&url.pathname==='/api/pilot/app-trial/leave'&&view.leavePosts===0){try{allowed=Object.keys(req.postDataJSON() as object).length===0;}catch{/* Deny unrecognized writes. */}if(allowed)view.leavePosts++;}
        if(!allowed){view.blockedWrites++;await route.abort('blockedbyclient');return;}
      }
      await route.continue();
    });
    page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);
    page.on('pageerror',()=>view.runtimeErrors++);page.on('dialog',dialog=>{view.runtimeErrors++;void dialog.dismiss();});
    const images=new Set<string>();let ignoreAfterLeave=false;
    page.on('response',response=>{const url=new URL(response.url());if(url.origin!==pilotOrigin)return;if(response.status()>=400&&!ignoreAfterLeave&&!/^\/favicon\./.test(url.pathname))view.failedResponses++;if(response.status()===200&&response.headers()['content-type']?.startsWith('image/')&&url.pathname.includes('/image/'))images.add(url.pathname);});
    stage(name+'_fragment_entry_and_book');
    await page.goto(entry.href,{waitUntil:'domcontentloaded'});await expect(page).toHaveURL(pilotOrigin+'/wedding/books/'+config.bookId);
    await expect(page.getByRole('heading',{name:config.expectedTitle,exact:true})).toBeVisible();await expect(page.getByRole('complementary',{name:'Próbamód'})).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveCount(0);ensure(!new URL(page.url()).hash,'ENTRY_FRAGMENT_MUST_BE_REMOVED');
    const cookies=await context.cookies();ensure(cookies.length===1&&cookies[0].name===appTrialCookieName&&cookies[0].secure&&cookies[0].httpOnly&&cookies[0].sameSite==='Strict','TRIAL_MUST_NOT_MINT_OWNER_SESSION');
    ensure(view.redeemPosts===1,'ENTRY_REDEEM_REQUIRED');
    const detail=await getJson<Awaited<ReturnType<typeof fictionalBook>>>(context.request,'/api/wedding/books/'+config.bookId);ensure(detail.submissions.length===38,'TRIAL_SUBMISSION_COUNT_MISMATCH');view.submissions=38;
    const listed=await getJson<{books:{id:string}[]}>(context.request,'/api/wedding/books');ensure(listed.books.length===1&&listed.books[0].id===config.bookId,'TRIAL_BOOK_LIST_LEAK');
    const caps=await getJson<{authenticated:boolean;canCreate:boolean;shopAvailable:boolean;trial?:{bookId:string}}>(context.request,'/api/wedding/capabilities');ensure(caps.authenticated&&!caps.canCreate&&!caps.shopAvailable&&caps.trial?.bookId===config.bookId,'TRIAL_CAPABILITY_SCOPE_MISMATCH');
    const reviews=await getJson<ReviewState>(context.request,root+'/reviews?versionId='+initial.version.id);ensure(digest(reviews)===digest(initial.reviews),'TRIAL_REVIEW_READ_MISMATCH');
    const photo=detail.submissions.flatMap(s=>s.media).find(m=>('kind'in m?m.kind==='photo':true));ensure(photo,'TRIAL_PHOTO_REQUIRED');
    const image=await context.request.get('/api/wedding/media/'+photo.id+'/preview',{maxRedirects:0});ensure(image.status()===200&&image.headers()['content-type']?.startsWith('image/'),'TRIAL_OWNER_IMAGE_NOT_AVAILABLE');
    await expect(page.getByRole('region',{name:'Átnézendő tartalmak',exact:true})).toBeVisible();
    const thumbnails=page.locator('.wedding-photo-open img');await thumbnails.first().scrollIntoViewIfNeeded();
    await expect.poll(()=>thumbnails.evaluateAll(nodes=>nodes.some(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)),{timeout:60000}).toBe(true);
    await page.screenshot({path:resolve(outputDirectory,name+'-book.png'),fullPage:true,mask:[page.locator('input[readonly]'),page.locator('.wedding-qr')]});view.screenshots.push(name+'-book.png');
    stage(name+'_scope_read_denials');
    const deniedPaths=['/api/wedding/books/'+foreignBookId,'/api/book-workflow/'+foreignBookId,'/api/montage/'+foreignBookId,'/api/wedding/media/'+foreignMediaId+'/original',root+'/media/'+foreignMediaId,'/api/book-workflow','/api/shop/session','/api/auth/get-session','/api/mcp/books/'+config.bookId+'/grants','/oauth/authorize','/.well-known/oauth-authorization-server','/mcp'];
    for(const path of deniedPaths){const denied=await context.request.get(path,{maxRedirects:0});ensure(denied.status()===404,'TRIAL_READ_SCOPE_NOT_DENIED');}
    view.deniedReadChecks=deniedPaths.length;
    stage(name+'_actual_overview_and_editor_navigation');
    await page.getByRole('link',{name:'Montázs, jóváhagyás és ellenőrző PDF',exact:true}).click();await expect(page.locator('.simple-book')).toBeVisible();
    await expect(page.getByText(/^16 oldal ·/)).toBeVisible();await page.getByRole('link',{name:'Tervezet megnyitása és javítása',exact:true}).click();
    await expect(page.getByRole('heading',{name:config.expectedTitle+' – montázs',exact:true})).toBeVisible();await expect(page.getByRole('complementary',{name:'Próbamód'})).toBeVisible();
    await expect(page.getByLabel('Korábbi változat')).toHaveValue(initial.version.id);await expect(page.getByRole('button',{name:/^\d+\. oldal(?: 🔒)?$/})).toHaveCount(16);view.pageCount=16;
    await expect(page.getByRole('button',{name:'Változat mentése',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Ezt a könyvváltozatot jóváhagyom',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Jóváhagyott PDF készítése',exact:true})).toBeVisible();
    const flagged=new Set(initial.reviews.items.filter(i=>i.mediaId&&i.flags.length).map(i=>i.mediaId));
    const imagePage=initial.version.draft.pages.findIndex(p=>p.elements.some(e=>e.kind==='photo'&&!flagged.has(e.mediaId)));ensure(imagePage>=0,'UNFLAGGED_IMAGE_PAGE_REQUIRED');
    if(imagePage!==0)await page.getByRole('button',{name:new RegExp('^'+(imagePage+1)+'\\. oldal(?: 🔒)?$')}).click();
    const canvas=page.locator('canvas.lower-canvas');await expect(canvas).toBeVisible();await expect.poll(()=>images.size,{timeout:60000}).toBeGreaterThan(0);
    await page.evaluate(async()=>{await document.fonts.ready;});view.fontLoaded=await page.evaluate(()=>Array.from(document.fonts).some(face=>face.family.replace(/['"]/g,'')==='DejaVu Sans'&&face.status==='loaded')&&document.fonts.check('16px "DejaVu Sans"','Árvíztűrő tükörfúrógép'));ensure(view.fontLoaded,'EDITOR_FONT_NOT_LOADED');
    const colors=()=>canvas.evaluate((element:HTMLCanvasElement)=>{const drawing=element.getContext('2d');if(!drawing)return 0;const pixels=drawing.getImageData(0,0,element.width,element.height).data,found=new Set<string>();for(let i=0;i<pixels.length;i+=4*131)found.add([pixels[i]>>4,pixels[i+1]>>4,pixels[i+2]>>4].join(','));return found.size;});
    await expect.poll(colors).toBeGreaterThan(10);view.canvasColors=await colors();view.imageResponses=images.size;
    await canvas.screenshot({path:resolve(outputDirectory,name+'-canvas.png')});await page.screenshot({path:resolve(outputDirectory,name+'-editor.png'),fullPage:true});view.screenshots.push(name+'-canvas.png',name+'-editor.png');
    ensure(view.blockedWrites===0&&view.blockedExternal===0&&view.runtimeErrors===0&&view.failedResponses===0,'UNEXPECTED_BROWSER_ACTIVITY_OR_ERROR');
    stage(name+'_leave_and_anonymous_denial');ignoreAfterLeave=true;await page.getByRole('button',{name:'Kilépés a próbából',exact:true}).click();await expect(page).toHaveURL(pilotOrigin+'/wedding');
    ensure(!(await context.cookies()).some(c=>c.name===appTrialCookieName),'TRIAL_COOKIE_NOT_CLEARED');ensure((await context.request.get('/api/wedding/books/'+config.bookId,{maxRedirects:0})).status()===401,'LEAVE_DID_NOT_REMOVE_ACCESS');
    ensure(view.leavePosts===1&&view.blockedWrites===0,'UNEXPECTED_TRIAL_WRITE');view.cookiesCleared=true;view.status='PASS';await context.close();context=undefined;page=undefined;await writeJson(reportPath,report);
  }
  stage('preservation_comparison');report.serverStateUnchanged=digest(await readState())===baseline;report.foreignBookUnchanged=digest(await getJson(foreignContext,'/api/wedding/books/'+foreignBookId))===foreignBaseline;
  ensure(report.serverStateUnchanged&&report.foreignBookUnchanged,'SERVER_BOOK_STATE_CHANGED');report.status='PASS';
}catch(error){report.status='FAIL';report.errorCode=safeError(error);process.exitCode=1;}
finally{
  // Clearing this fresh browser's scoped cookie is allowed even after a failed read check.
  if(context&&page){try{if((await context.cookies()).some(c=>c.name===appTrialCookieName))await page.evaluate(async()=>{await fetch('/api/pilot/app-trial/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});});}catch{/* Only this ephemeral context remains; never fall back to owner credentials. */}}
  await context?.close().catch(()=>undefined);await browser?.close().catch(()=>undefined);
  if(baseline&&readState&&report.serverStateUnchanged!==true){try{report.serverStateUnchanged=digest(await readState())===baseline;if(!report.serverStateUnchanged){report.status='FAIL';report.errorCode='SERVER_BOOK_STATE_CHANGED';process.exitCode=1;}}catch{report.status='FAIL';report.errorCode='PRESERVATION_CHECK_FAILED';process.exitCode=1;}}
  if(foreignBaseline&&foreignContext&&foreignBookId&&report.foreignBookUnchanged!==true){try{report.foreignBookUnchanged=digest(await getJson(foreignContext,'/api/wedding/books/'+foreignBookId))===foreignBaseline;if(!report.foreignBookUnchanged){report.status='FAIL';report.errorCode='FOREIGN_BOOK_CHANGED';process.exitCode=1;}}catch{report.status='FAIL';process.exitCode=1;}}
  await owner?.dispose();await operator?.dispose();report.finishedAt=new Date().toISOString();await writeJson(reportPath,report);
  console.log(JSON.stringify({status:report.status,stage:report.stage,errorCode:report.errorCode,views:report.views.map(v=>({name:v.name,status:v.status})),serverStateUnchanged:report.serverStateUnchanged,physicalPhones:'NOT_TESTED',actualChatGpt:'NOT_TESTED'}));
}
