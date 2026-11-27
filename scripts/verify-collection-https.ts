// One fictional collection in the NEW pilot only. Default preparation is local;
// --run explicitly enables HTTPS. Never calls the old pilot, billing or models.
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {chromium,expect,request,type APIRequestContext,type APIResponse,type Browser} from '@playwright/test';
import {validateCollectionMedia} from '../server/collection/validation';

export const collectionPilotOrigin='https://memorybook-collection-pilot-20261127.onrender.com';
const opaque=/^[A-Za-z\d_-]{8,200}$/,uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Config={baseUrl:string;guestToken:string;ownerTrialKey:string;bookId:string;ownerId?:string;title?:string;expiresAt?:string;ownerTokenHash?:string};
type Kind='photo'|'audio'|'video';
type Asset={id:string;kind:Kind;fileName:string;mimeType:string;bytes:Buffer;sha256:string};
type FileView={id:string;kind:Kind;sha256:string;byteLength:number;state:string;receivedChunks:number[];chunkCount:number;chunkBytes:number;originalUrl:string|null;previewUrl:string|null;playbackUrl:string|null;durationSeconds:number|null};
type Receipt={accepted:boolean;state:string;groupId:string;submissionId:string;replayed:boolean};
type Bootstrap={groupId:string;bookId:string;pageVersion:number;state:string;files:FileView[];receipt?:Receipt;events:{id:string}[];locations:{id:string}[]};
type Session={groupId:string;state:string;submissionId:string|null;canvasData:unknown;previewUrl:string|null;files:FileView[]};
type Collection={book:{id:string;title:string};sessions:Session[];settings:unknown;legacy:unknown};
type Checkpoint={version:1;origin:string;bookId:string;deviceId:string;commitKey:string;fileIds:Record<Kind,string>;fixtureHashes?:Record<Kind,string>;pageToken?:string;pageId?:string;canvasHash?:string;commit?:{key:string;expectedVersion:number;eventIds:string[];locationIds:string[];authorShareApproved:false;previewDataUrl:string};otherSessionsHash?:string;submissionId?:string};
type Report={status:'PREPARED'|'RUNNING'|'PASS'|'INCOMPLETE';stage:string;at:string;bookId:string;checks:Record<string,unknown>;physicalPhones:'NOT_TESTED';paidCalls:0;oldPilotRequests:0;errorCode?:string};
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const fingerprint=(value:unknown)=>sha(JSON.stringify(canonical(value)));
function ensure(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
function inside(parent:string,path:string){const child=relative(parent,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);}
export function validateCollectionHttpsConfig(value:unknown):Config{
  const c=value as Config;ensure(c&&typeof c==='object'&&Object.keys(c).every(key=>['baseUrl','bookId','guestToken','ownerTrialKey','ownerId','title','expiresAt','ownerTokenHash'].includes(key)),'CONFIG_INVALID');
  ensure(c.baseUrl===collectionPilotOrigin&&opaque.test(c.bookId)&&opaque.test(c.guestToken)&&/^[A-Za-z\d_-]{43}$/.test(c.ownerTrialKey),'EXACT_NEW_PILOT_CONFIG_REQUIRED');
  ensure(c.ownerTokenHash===undefined||c.ownerTokenHash===sha(c.ownerTrialKey),'OWNER_KEY_HASH_MISMATCH');return c;
}
export function parseStoredZip(zip:Buffer):Map<string,Buffer>{
  ensure(zip.length>=22,'ZIP_INVALID');const end=zip.length-22;ensure(zip.readUInt32LE(end)===0x06054b50&&zip.readUInt16LE(end+20)===0,'ZIP_END_INVALID');
  const count=zip.readUInt16LE(end+10),directory=zip.readUInt32LE(end+16);ensure(directory+zip.readUInt32LE(end+12)===end&&zip.readUInt16LE(end+4)===0&&zip.readUInt16LE(end+6)===0&&zip.readUInt16LE(end+8)===count,'ZIP_DIRECTORY_INVALID');
  const files=new Map<string,Buffer>(),records:{offset:number;name:string;size:number;crc:number}[]=[];let cursor=0;
  for(let index=0;index<count;index++){
    ensure(cursor+30<=directory&&zip.readUInt32LE(cursor)===0x04034b50&&zip.readUInt16LE(cursor+8)===0&&!(zip.readUInt16LE(cursor+6)&8),'ZIP_ENTRY_INVALID');
    const size=zip.readUInt32LE(cursor+18),length=zip.readUInt16LE(cursor+26),extra=zip.readUInt16LE(cursor+28),start=cursor+30+length+extra;
    ensure(size===zip.readUInt32LE(cursor+22)&&start+size<=directory,'ZIP_SIZE_INVALID');const name=zip.toString('utf8',cursor+30,cursor+30+length);
    ensure(/^[A-Za-z\d_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').includes('..')&&!files.has(name),'ZIP_PATH_INVALID');
    const bytes=zip.subarray(start,start+size);let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}ensure(((crc^0xffffffff)>>>0)===zip.readUInt32LE(cursor+14),'ZIP_CRC_INVALID');
    records.push({offset:cursor,name,size,crc:zip.readUInt32LE(cursor+14)});files.set(name,bytes);cursor=start+size;
  }
  ensure(cursor===directory,'ZIP_ENTRY_COUNT_INVALID');
  for(const record of records){ensure(cursor+46<=end&&zip.readUInt32LE(cursor)===0x02014b50&&zip.readUInt16LE(cursor+10)===0,'ZIP_CENTRAL_ENTRY_INVALID');const nameLength=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32);ensure(cursor+46+nameLength+extra+comment<=end&&zip.toString('utf8',cursor+46,cursor+46+nameLength)===record.name&&zip.readUInt32LE(cursor+16)===record.crc&&zip.readUInt32LE(cursor+20)===record.size&&zip.readUInt32LE(cursor+24)===record.size&&zip.readUInt32LE(cursor+42)===record.offset,'ZIP_CENTRAL_MISMATCH');cursor+=46+nameLength+extra+comment;}
  ensure(cursor===end,'ZIP_CENTRAL_COUNT_INVALID');return files;
}
async function optional<T>(path:string):Promise<T|null>{try{return JSON.parse(await readFile(path,'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
async function fixtures(dir:string,checkpoint:Checkpoint):Promise<Asset[]>{
  await mkdir(dir,{recursive:true});const definitions=[['photo','fictional-pattern.jpg','image/jpeg'],['audio','fictional-tone.wav','audio/wav'],['video','fictional-pattern.mp4','video/mp4']] as const;
  for(const[kind,name]of definitions){const path=resolve(dir,name);try{await readFile(path);continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(kind==='photo'){const pixels=Buffer.alloc(960*640*3);let seed=9173;for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=(seed>>>24);}await sharp(pixels,{raw:{width:960,height:640,channels:3}}).jpeg({quality:93}).toFile(path);}
    else{ensure(typeof ffmpeg==='string','LOCAL_FFMPEG_UNAVAILABLE');const input=kind==='audio'?['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-af','volume=0.03','-ac','2','-c:a','pcm_s16le']:['-f','lavfi','-i','testsrc2=size=320x240:rate=15','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-t','2','-af','volume=0.03','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart'];await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-nostdin',...input,'-threads','1','-y',path],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});}
  }
  const assets:Asset[]=[];for(const[kind,fileName,mimeType]of definitions){const bytes=await readFile(resolve(dir,fileName));ensure(bytes.length>100&&bytes.length<2*1024*1024,'FIXTURE_SIZE_INVALID');assets.push({id:checkpoint.fileIds[kind],kind,fileName,mimeType,bytes,sha256:sha(bytes)});}return assets;
}
async function main(){
  const configArg=process.argv.find(value=>value.endsWith('.local.json'));ensure(configArg,'LOCAL_CONFIG_REQUIRED');const configPath=resolve(configArg);ensure(inside(resolve('test-results'),configPath),'CONFIG_MUST_STAY_IN_TEST_RESULTS');
  const config=validateCollectionHttpsConfig(JSON.parse(await readFile(configPath,'utf8'))),dir=dirname(configPath),checkpointPath=resolve(dir,'https-checkpoint.local'),reportPath=resolve(dir,'https-verification.json');
  const checkpoint=await optional<Checkpoint>(checkpointPath)||{version:1,origin:config.baseUrl,bookId:config.bookId,deviceId:'fictional-https-'+randomUUID(),commitKey:randomUUID(),fileIds:{photo:randomUUID(),audio:randomUUID(),video:randomUUID()}};
  ensure(checkpoint.version===1&&checkpoint.origin===config.baseUrl&&checkpoint.bookId===config.bookId&&Object.values(checkpoint.fileIds).every(id=>uuid.test(id)),'CHECKPOINT_SCOPE_MISMATCH');
  const save=()=>writeFile(checkpointPath,JSON.stringify(checkpoint,null,2));
  const report:Report={status:'PREPARED',stage:'local_fixtures',at:new Date().toISOString(),bookId:config.bookId,checks:{},physicalPhones:'NOT_TESTED',paidCalls:0,oldPilotRequests:0};
  const contexts:APIRequestContext[]=[];let browser:Browser|undefined;
  const stage=(value:string)=>{report.stage=value;console.log(JSON.stringify({stage:value}));};
  const json=async<T>(res:APIResponse,statuses=[200])=>{try{if(!statuses.includes(res.status())){const error=await res.json().catch(()=>null);throw new Error(`HTTP_${res.status()}_${typeof error?.error==='string'&&/^[A-Z_]{2,60}$/.test(error.error)?error.error:'REQUEST_REJECTED'}`);}return await res.json() as T;}finally{await res.dispose();}};
  const binary=async(res:APIResponse,status=200)=>{try{ensure(res.status()===status,'BINARY_STATUS_'+res.status());return await res.body();}finally{await res.dispose();}};
  const boundedPath=(value:string|null,root:string)=>{ensure(value&&value.startsWith(root+'/')&&!value.includes('..')&&!value.includes('://')&&!value.includes('?'),'RESPONSE_MEDIA_SCOPE_MISMATCH');return value;};
  try{
    const assets=await fixtures(resolve(dir,'fixtures'),checkpoint),fixtureHashes=Object.fromEntries(assets.map(a=>[a.kind,a.sha256])) as Record<Kind,string>;
    ensure(!checkpoint.fixtureHashes||fingerprint(checkpoint.fixtureHashes)===fingerprint(fixtureHashes),'FIXTURE_HASH_CHANGED');checkpoint.fixtureHashes=fixtureHashes;await save();report.checks.fixtures=assets.map(({kind,sha256,bytes})=>({kind,sha256,bytes:bytes.length}));
    const decoded=[];for(const asset of assets){const media=await validateCollectionMedia(asset.bytes,asset.kind,{maxBytes:2*1024*1024,maxDurationSeconds:20,maxPixels:40000000});ensure(sha(asset.bytes)===asset.sha256,'LOCAL_DECODER_CHANGED_ORIGINAL');decoded.push({kind:asset.kind,mimeType:media.mimeType,durationSeconds:media.durationSeconds,width:media.width,height:media.height});}report.checks.localDecoders=decoded;
    if(!process.argv.includes('--run')){ensure(process.argv.includes('--prepare-only'),'EXPLICIT_RUN_OR_PREPARE_REQUIRED');return;}
    report.status='RUNNING';stage('scope_preflight');
    for(let i=0;i<3;i++)contexts.push(await request.newContext({baseURL:config.baseUrl,timeout:90000,extraHTTPHeaders:{Origin:config.baseUrl}}));const[guest,owner,anonymous]=contexts;
    const invite=await json<{bookId:string;title:string;bookType:string;requiredFields:string[]}>(await guest.get('/api/invites/'+config.guestToken,{maxRedirects:0}));ensure(invite.bookId===config.bookId&&invite.bookType==='event'&&/fiktív/i.test(invite.title)&&(!config.title||config.title===invite.title),'FICTIONAL_BOOK_SCOPE_MISMATCH');
    const redeemed=await json<{success:boolean;bookId:string;redirectTo:string}>(await owner.post('/api/pilot/collection-trial/redeem',{data:{key:config.ownerTrialKey},maxRedirects:0}));ensure(redeemed.success&&redeemed.bookId===config.bookId&&redeemed.redirectTo===`/my-books/${config.bookId}/materials`,'TRIAL_SCOPE_MISMATCH');
    const ownerRoot=`/api/my/books/${config.bookId}/collection`,ownerList=()=>owner.get(ownerRoot,{maxRedirects:0}).then(res=>json<Collection>(res));
    stage('guest_session');
    if(!checkpoint.pageToken){
      const fields:Record<string,string>={name:'Fiktív HTTPS vendég',email:'fictional-https@example.invalid',phone:'+36000000000'};ensure(invite.requiredFields.every(field=>field in fields),'UNKNOWN_REQUIRED_GUEST_FIELD');
      const session=await json<{inviteToken:string}>(await guest.post(`/api/invites/${config.guestToken}/page-session`,{data:{deviceId:checkpoint.deviceId,guestData:fields},maxRedirects:0}),[200,201]);ensure(opaque.test(session.inviteToken),'INVALID_PAGE_TOKEN');checkpoint.pageToken=session.inviteToken;await save();
    }
    const base=`/api/collection/invites/${checkpoint.pageToken}`;let bootstrap=await json<Bootstrap>(await guest.get(base,{maxRedirects:0}));ensure(bootstrap.bookId===config.bookId&&(!checkpoint.pageId||checkpoint.pageId===bootstrap.groupId),'PAGE_SCOPE_MISMATCH');checkpoint.pageId=bootstrap.groupId;await save();
    const others=(data:Collection)=>fingerprint({...data,sessions:data.sessions.filter(s=>s.groupId!==checkpoint.pageId)}),initial=await ownerList();ensure(initial.book.id===config.bookId,'OWNER_BOOK_MISMATCH');if(!checkpoint.otherSessionsHash){checkpoint.otherSessionsHash=others(initial);await save();}else ensure(checkpoint.otherSessionsHash===others(initial),'PREEXISTING_BOOK_DATA_CHANGED');
    const wasCommitted=bootstrap.state==='submitted',observed=new Set<string>();let chunkReplay=false,resumeVerified=false;
    if(bootstrap.state!=='submitted'){
      stage('original_upload_resume');
      for(const asset of assets){
        const input={id:asset.id,kind:asset.kind,fileName:asset.fileName,mimeType:asset.mimeType,byteLength:asset.bytes.length,sha256:asset.sha256};
        let file=(await json<{file:FileView}>(await guest.post(base+'/files',{data:input,maxRedirects:0}),[200,201])).file;ensure(file.id===asset.id&&file.sha256===asset.sha256&&file.byteLength===asset.bytes.length,'UPLOAD_IDENTITY_MISMATCH');
        ensure(file.chunkBytes>0&&file.chunkBytes<=1048576&&file.chunkCount===Math.ceil(asset.bytes.length/file.chunkBytes),'UPLOAD_CHUNK_CONTRACT_INVALID');
        const repeated=await json<{file:FileView;replayed:boolean}>(await guest.post(base+'/files',{data:input,maxRedirects:0}),[200]);ensure(repeated.replayed&&repeated.file.id===asset.id,'UPLOAD_BEGIN_REPLAY_FAILED');
        if(file.state==='uploading')for(let index=0;index<file.chunkCount;index++){
          if(file.receivedChunks.includes(index))continue;const bytes=asset.bytes.subarray(index*file.chunkBytes,Math.min((index+1)*file.chunkBytes,asset.bytes.length));
          file=(await json<{file:FileView}>(await guest.put(`${base}/files/${asset.id}/chunks/${index}`,{data:bytes,headers:{'Content-Type':'application/octet-stream'},maxRedirects:0}))).file;
          if(index===0){const replay=await json<{file:FileView}>(await guest.put(`${base}/files/${asset.id}/chunks/${index}`,{data:bytes,headers:{'Content-Type':'application/octet-stream'},maxRedirects:0}));ensure(replay.file.receivedChunks.filter(i=>i===index).length===1,'CHUNK_REPLAY_DUPLICATED');chunkReplay=true;
            const state=(await json<{file:FileView}>(await guest.get(`${base}/files/${asset.id}`,{maxRedirects:0}))).file;ensure(state.receivedChunks.includes(index),'CHUNK_STATUS_RECOVERY_FAILED');resumeVerified=true;
            const listed=(await ownerList()).sessions.find(s=>s.groupId===checkpoint.pageId)?.files.find(f=>f.id===asset.id);ensure(listed?.state==='uploading','OWNER_MISSING_PARTIAL_UPLOAD');observed.add('uploading');}
        }
        if(file.state!=='ready'){
          let settled=false;const work=guest.post(`${base}/files/${asset.id}/complete`,{data:{},maxRedirects:0}).then(res=>json<{file:FileView}>(res)).then(result=>({result}),(error:unknown)=>({error:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'MEDIA_COMPLETION_FAILED'})).finally(()=>{settled=true;});
          const until=Date.now()+60000;while(!settled&&Date.now()<until){const state=(await ownerList()).sessions.find(s=>s.groupId===checkpoint.pageId)?.files.find(f=>f.id===asset.id)?.state;if(state)observed.add(state);await new Promise(r=>setTimeout(r,150));}
          const finished=await work;if('error'in finished)throw new Error(finished.error);file=finished.result.file;
        }
        ensure(file.state==='ready'&&file.sha256===asset.sha256,'MEDIA_NOT_READY');observed.add('ready');
      }
      report.checks.upload={chunkReplay,resumeVerified,ownerStates:[...observed]};
      stage('editable_canvas');
      const page=await json<{id:string;bookId:string;version:number;canvasData:{objects?:unknown[]}}>(await guest.get('/api/page-invites/'+checkpoint.pageToken,{maxRedirects:0}));ensure(page.id===checkpoint.pageId&&page.bookId===config.bookId,'CANVAS_PAGE_MISMATCH');
      const photo=assets.find(a=>a.kind==='photo')!,imagePreview=await sharp(photo.bytes).resize(320,210,{fit:'cover'}).jpeg({quality:80}).toBuffer(),imageDataUrl='data:image/jpeg;base64,'+imagePreview.toString('base64');
      const preview=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#fffaf2"/><text x="30" y="55" font-family="sans-serif" font-size="28" fill="#263c30">Fiktív HTTPS emlék</text><text x="30" y="89" font-family="sans-serif" font-size="28" fill="#263c30">Árvíztűrő tükörfúrógép</text><path d="M35 125 Q115 190 195 125 Q275 60 355 125" stroke="#2f7d62" stroke-width="6" fill="none"/><image href="${imageDataUrl}" x="45" y="180" width="320" height="210"/></svg>`)).jpeg({quality:85}).toBuffer(),previewDataUrl='data:image/jpeg;base64,'+preview.toString('base64');
      const canvas={version:'7.4.0',background:'#fffaf2',objects:[{type:'Textbox',version:'7.4.0',left:30,top:30,width:480,fontSize:28,fill:'#263c30',text:'Fiktív HTTPS emlék\nÁrvíztűrő tükörfúrógép'},{type:'Path',version:'7.4.0',left:35,top:95,stroke:'#2f7d62',strokeWidth:6,fill:null,path:[['M',0,0],['Q',80,65,160,0],['Q',240,-65,320,0]]},{type:'Image',version:'7.4.0',left:45,top:180,width:320,height:210,src:imageDataUrl,collectionAssetId:photo.id}]};
      const wanted=fingerprint(canvas);ensure(!checkpoint.canvasHash||checkpoint.canvasHash===wanted,'CANVAS_FIXTURE_CHANGED');
      if(fingerprint(page.canvasData)!==wanted){ensure(!page.canvasData.objects?.length,'EXISTING_CANVAS_MUST_NOT_BE_OVERWRITTEN');const saved=await json<{success:boolean;newVersion:number;previewImageUrl:string}>(await guest.put('/api/page-invites/'+checkpoint.pageToken,{data:{canvasData:canvas,previewDataUrl,expectedVersion:page.version},maxRedirects:0}));ensure(saved.success&&saved.newVersion===page.version+1&&saved.previewImageUrl===base+'/page-preview','PRIVATE_CANVAS_SAVE_FAILED');page.version=saved.newVersion;}
      checkpoint.canvasHash=wanted;checkpoint.commit??={key:checkpoint.commitKey,expectedVersion:page.version,eventIds:bootstrap.events.slice(0,1).map(e=>e.id),locationIds:bootstrap.locations.slice(0,1).map(e=>e.id),authorShareApproved:false,previewDataUrl};await save();
      ensure(sha(await binary(await guest.get(base+'/page-preview',{maxRedirects:0})))===sha(preview),'PRIVATE_CANVAS_PREVIEW_CHANGED');report.checks.privateCanvas={editableText:true,editablePath:true,boundOriginal:true,cloudUpload:false};
    }else{ensure(checkpoint.commit&&checkpoint.canvasHash,'UNEXPECTED_PREEXISTING_COMMIT');report.checks.upload={recoveredPriorCommittedRun:true};}
    stage('guest_mobile_preview');browser=await chromium.launch({channel:'chrome'});const guestBrowser=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'hu-HU'});let unexpectedWrites=0,externalRequests=0,runtimeErrors=0;
    const guard=async(context:Awaited<ReturnType<Browser['newContext']>>,allowTrial=false)=>context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==config.baseUrl&&!url.protocol.startsWith('data')){externalRequests++;await route.abort();return;}if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!(allowTrial&&req.method()==='POST'&&['/api/pilot/collection-trial/redeem','/api/pilot/collection-trial/leave'].includes(url.pathname))){unexpectedWrites++;await route.abort();return;}await route.continue();});
    await guard(guestBrowser);const guestPage=await guestBrowser.newPage();guestPage.on('pageerror',()=>runtimeErrors++);await guestPage.goto(config.baseUrl+'/p/'+checkpoint.pageToken,{waitUntil:'domcontentloaded'});
    if(bootstrap.state!=='submitted'){await expect(guestPage.getByRole('region',{name:'Csatolt eredeti fájlok',exact:true})).toBeVisible();await expect(guestPage.locator('canvas').first()).toBeVisible();await expect(guestPage.getByText('Eredeti fájl átvéve',{exact:true})).toHaveCount(3);await guestPage.screenshot({path:resolve(dir,'guest-mobile-ready.png'),fullPage:true});}
    stage('explicit_commit');ensure(checkpoint.commit,'COMMIT_CHECKPOINT_REQUIRED');const receipt=await json<Receipt>(await guest.post(base+'/commit',{data:checkpoint.commit,maxRedirects:0}));ensure(receipt.accepted&&receipt.state==='committed'&&receipt.groupId===checkpoint.pageId&&uuid.test(receipt.submissionId),'COMMIT_ACK_INVALID');
    const replay=await json<Receipt>(await guest.post(base+'/commit',{data:checkpoint.commit,maxRedirects:0}));ensure(replay.replayed&&replay.submissionId===receipt.submissionId,'COMMIT_REPLAY_DUPLICATED');checkpoint.submissionId=receipt.submissionId;await save();
    bootstrap=await json<Bootstrap>(await guest.get(base,{maxRedirects:0}));ensure(bootstrap.state==='submitted'&&bootstrap.receipt?.submissionId===receipt.submissionId,'DURABLE_COMMIT_RECOVERY_FAILED');await guestPage.reload();await expect(guestPage.getByText('Az oldalad elküldve. Köszönjük!',{exact:true})).toBeVisible();await guestPage.screenshot({path:resolve(dir,'guest-mobile-receipt.png'),fullPage:true});report.checks.commit={exactlyOne:true,replayed:true,receiptRecoveredAfterReload:true};
    stage('originals_manifest_archive');const collection=await ownerList(),session=collection.sessions.find(s=>s.groupId===checkpoint.pageId);ensure(session?.state==='submitted'&&session.submissionId===receipt.submissionId&&session.files.length===3&&fingerprint(session.canvasData)===checkpoint.canvasHash,'OWNER_FROZEN_SUBMISSION_MISMATCH');
    const fileResults=[];for(const asset of assets){const file=session.files.find(f=>f.id===asset.id);ensure(file&&file.state==='ready','OWNER_FILE_MISSING');const original=boundedPath(file.originalUrl,ownerRoot);ensure(sha(await binary(await owner.get(original,{maxRedirects:0})))===asset.sha256,'ORIGINAL_BYTES_CHANGED');const denied=await anonymous.get(original,{maxRedirects:0});ensure(denied.status()===401,'ANONYMOUS_ORIGINAL_EXPOSED');await denied.dispose();
      if(asset.kind!=='photo'){const playback=boundedPath(file.playbackUrl,ownerRoot),range=await owner.get(playback,{headers:{Range:'bytes=0-63'},maxRedirects:0});ensure(range.status()===206&&/^bytes 0-63\/\d+$/.test(range.headers()['content-range']),'AV_RANGE_FAILED');ensure((await binary(range,206)).length===64,'AV_RANGE_LENGTH_FAILED');ensure((await binary(await owner.get(playback,{maxRedirects:0}))).length>100,'AV_FULL_RESPONSE_FAILED');}
      fileResults.push({kind:asset.kind,sha256:asset.sha256,bytes:asset.bytes.length,originalMatches:true,range:asset.kind==='photo'?'NOT_APPLICABLE':'PASS'});
    }
    const manifest=await json<Collection>(await owner.get(ownerRoot+'/manifest.json',{maxRedirects:0}));ensure(manifest.book.id===config.bookId&&manifest.sessions.some(s=>s.submissionId===receipt.submissionId),'MANIFEST_SUBMISSION_MISSING');const manifestText=JSON.stringify(manifest);ensure(!manifestText.includes(config.guestToken)&&!manifestText.includes(checkpoint.pageToken!),'MANIFEST_CONTAINS_GUEST_CAPABILITY');
    const zipBytes=await binary(await owner.get(ownerRoot+'/archive.zip',{maxRedirects:0})),archive=parseStoredZip(zipBytes),folder=sha(checkpoint.pageId!).slice(0,24);ensure(archive.has('manifest.json')&&archive.has('snapshots.json'),'ARCHIVE_MANIFEST_MISSING');
    for(const asset of assets){const file=[...archive.entries()].find(([name])=>name.startsWith(`originals/${folder}/${asset.id}.`));ensure(file&&sha(file[1])===asset.sha256,'ARCHIVE_ORIGINAL_CHANGED');}ensure(!zipBytes.includes(Buffer.from(config.guestToken))&&!zipBytes.includes(Buffer.from(checkpoint.pageToken!)),'ARCHIVE_CONTAINS_GUEST_CAPABILITY');
    report.checks.downloads={files:fileResults,manifestSha256:sha(manifestText),archiveSha256:sha(zipBytes),archiveEntries:archive.size,archiveCrcVerified:true};
    stage('scope_denials');const deniedPaths=[`/api/my/books/outside-${randomUUID()}/collection`,'/api/my/books','/api/auth/get-session','/api/auth/sign-in/email','/api/shop/session','/api/payments','/api/admin','/mcp'];
    for(const path of deniedPaths){const denied=await owner.get(path,{maxRedirects:0});ensure(denied.status()===404&&(await denied.json()).error==='COLLECTION_TRIAL_DENIED','TRIAL_SCOPE_ESCAPED');await denied.dispose();}report.checks.scopeDenials={trialPaths:deniedPaths.length,anonymousOriginals:3};
    stage('owner_mobile_playback');const ownerBrowser=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'hu-HU'});await ownerBrowser.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));await guard(ownerBrowser,true);const ownerPage=await ownerBrowser.newPage();ownerPage.on('pageerror',()=>runtimeErrors++);
    await ownerPage.goto(config.baseUrl+'/collection/try#key='+config.ownerTrialKey,{waitUntil:'domcontentloaded'});await expect(ownerPage).toHaveURL(config.baseUrl+`/my-books/${config.bookId}/materials`);ensure(!ownerPage.url().includes('#'),'TRIAL_FRAGMENT_RETAINED');await expect(ownerPage.getByRole('heading',{name:'Beérkezett anyagok',exact:true})).toBeVisible();await expect(ownerPage.locator(`[data-collection-session="${checkpoint.pageId}"]`)).toBeVisible();
    const card=ownerPage.locator(`[data-collection-session="${checkpoint.pageId}"]`);await expect(card.getByRole('link',{name:'Eredeti fájl letöltése',exact:true})).toHaveCount(3);ensure(await ownerPage.locator('[autoplay]').count()===0,'UNREQUESTED_AUTOPLAY');
    const playback=[];for(const kind of ['audio','video'] as const){stage('owner_mobile_playback_'+kind);const element=card.locator(kind);await expect(element).toHaveCount(1);await element.scrollIntoViewIfNeeded();const result=await element.evaluate(async node=>{const media=node as HTMLMediaElement;media.muted=true;media.load();await new Promise<void>((ok,no)=>{if(media.readyState>=1){ok();return;}const timer=setTimeout(()=>no(Error('MEDIA_METADATA_TIMEOUT')),15000);media.addEventListener('loadedmetadata',()=>{clearTimeout(timer);ok();},{once:true});media.addEventListener('error',()=>{clearTimeout(timer);no(Error('MEDIA_DECODE_FAILED'));},{once:true});});await media.play();const deadline=performance.now()+5000;while(media.currentTime<0.1&&!media.error&&performance.now()<deadline)await new Promise(r=>setTimeout(r,100));const result={duration:media.duration,advanced:media.currentTime>=0.1,autoplay:media.autoplay};media.pause();return result;});report.checks.lastPlayback={kind,...result};ensure(result.duration>0&&result.duration<=20&&result.advanced&&!result.autoplay,'BROWSER_PLAYBACK_FAILED');playback.push({kind,...result});}
    report.checks.playback=playback;stage('owner_mobile_screenshot');ensure(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'MOBILE_OVERFLOW');await ownerPage.screenshot({path:resolve(dir,'owner-mobile-ready.png'),fullPage:true});
    stage('owner_leave');await ownerPage.getByRole('button',{name:'Kilépés a próbából',exact:true}).click();await expect(ownerPage).toHaveURL(config.baseUrl+'/collection/try');const afterLeave=await ownerBrowser.request.get(config.baseUrl+ownerRoot);ensure(afterLeave.status()===401,'TRIAL_LEAVE_DID_NOT_REVOKE');await afterLeave.dispose();
    ensure(unexpectedWrites===0&&externalRequests===0&&runtimeErrors===0,'BROWSER_UNEXPECTED_ACTIVITY');report.checks.browser={viewport:'390x844',guestPreview:wasCommitted?'PRIOR_COMMITTED_RUN_RECOVERED':true,guestReceipt:true,ownerTrial:true,fragmentRemoved:true,playback,leave:true,unexpectedWrites,externalRequests,runtimeErrors};
    stage('preservation_comparison');const final=await ownerList();ensure(others(final)===checkpoint.otherSessionsHash,'OTHER_SUBMISSIONS_CHANGED');ensure(final.sessions.filter(s=>s.groupId===checkpoint.pageId).length===1,'SUBMISSION_DUPLICATED');report.checks.otherDataPreserved=true;report.status='PASS';report.stage='complete';
  }catch(error){report.status='INCOMPLETE';report.errorCode=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'HTTPS_SMOKE_INCOMPLETE';}
  finally{await browser?.close();for(const ctx of contexts)await ctx.dispose();await mkdir(dir,{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.status==='INCOMPLETE')process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main().catch(error=>{console.error(JSON.stringify({status:'INCOMPLETE',errorCode:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'HTTPS_SMOKE_INPUT_ERROR'}));process.exitCode=1;});
