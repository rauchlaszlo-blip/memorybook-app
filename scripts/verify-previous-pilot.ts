// Existing pilot only: GET preservation checks, plus explicitly requested
// normal owner sign-in. Never creates accounts, books, grants or exports.
// Run from the new checkout:
// node --import tsx scripts/verify-previous-pilot.ts --config <old-config.local>
//   --state-root <old-checkout> --output test-results/<release>/before.json
//   [--refresh-owner] [--operator-state <fresh-private-state.local>]
// For comparison use a fresh output path and --compare <before.json>.
// An unavailable account produces *.incomplete.json, never a passing baseline.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request,type APIRequestContext} from '@playwright/test';

const origin='https://memorybook-wedding-text-pilot-ukd0.onrender.com';
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const safeCode=/^[A-Z][A-Z0-9_]{1,100}$/;
type Role='owner'|'operator';
type Entry={role:Role;path:string;kind:'json'|'binary';status:number;sha256:string|null;bytes:number};
type BookRefs={id:string;role:Role;submissionIds:string[];mediaIds:string[];snapshotIds:string[];versionIds:string[];exportIds:string[]};
type Manifest={format:'previous-pilot-preservation-v1';at:string;origin:string;status:'PASS'|'INCOMPLETE'|'CHANGED';authenticationWrites:number;bookWrites:0;resources:Entry[];books:BookRefs[];aggregateHash:string;unavailableRoles:Role[];limitations:string[];counts:Record<string,number>;comparison?:{baselineHash:string;unchanged:boolean;scope:'ALL_CONFIGURED_ACCOUNTS'|'OWNER_ONLY'};errorCode?:string};
type OldConfig={origin:string;ownerStorageState:string;operatorStorageState:string;accountCredentials?:string;bookId?:string};
type Detail={book:{id:string};submissions:{id:string;media?:{id:string}[]}[]};
type Head={versions:{id:string}[];snapshots:{id:string;source_count?:number}[];submissionCount:number};
type Snapshot={selectedIds:string[];sources:{id:string;media:{id:string}[]}[]};
type Jobs={exports:{id:string;status:string;withheld?:boolean}[]};

function ensure(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;}
export const preservationHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function digestStream(stream:ReadableStream<Uint8Array>,maxBytes=256*1024*1024){
  const reader=stream.getReader(),hash=createHash('sha256');let bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;ensure(bytes<=maxBytes,'BINARY_LIMIT_EXCEEDED');hash.update(next.value);}return{bytes,sha256:hash.digest('hex')};}
  finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export function preservationFingerprint(resources:Entry[],books:BookRefs[]){return preservationHash({resources:[...resources].sort((a,b)=>(a.role+a.path).localeCompare(b.role+b.path)),books:[...books].sort((a,b)=>a.id.localeCompare(b.id))});}
const ids=(values:{id:string}[])=>values.map(value=>{ensure(uuid.test(value.id),'INVALID_RESOURCE_ID');return value.id;}).sort();
function inside(parent:string,path:string){const child=relative(parent,path);return child!==''&&!child.startsWith('..')&&!isAbsolute(child);}
async function existing(path:string){try{await readFile(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function arg(name:string){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}

async function run(){
  const configArg=arg('--config'),rootArg=arg('--state-root'),outputArg=arg('--output');
  ensure(configArg&&rootArg&&outputArg,'CONFIG_STATE_ROOT_OUTPUT_REQUIRED');
  const stateRoot=resolve(rootArg),configPath=resolve(configArg),out=resolve(outputArg),testRoot=resolve('test-results');
  ensure(configPath.endsWith('.local')&&inside(stateRoot,configPath),'CONFIG_PATH_INVALID');
  ensure(inside(testRoot,out)&&out.endsWith('.json'),'OUTPUT_MUST_BE_LOCAL_TEST_RESULT');
  ensure(!await existing(out),'OUTPUT_ALREADY_EXISTS');
  const config=JSON.parse(await readFile(configPath,'utf8')) as OldConfig;ensure(config.origin===origin,'PILOT_ORIGIN_MISMATCH');
  const input=(value:string|undefined)=>{ensure(value,'PRIVATE_INPUT_REQUIRED');const path=resolve(stateRoot,value);ensure(path.endsWith('.local')&&(inside(stateRoot,path)||inside(testRoot,path)),'PRIVATE_INPUT_PATH_INVALID');return path;};
  const ownerState=resolve(dirname(out),'previous-pilot-owner-state.local');
  const contexts:{role:Role;context:APIRequestContext;list?:{books:{id:string}[]}}[]=[];
  const manifest:Manifest={format:'previous-pilot-preservation-v1',at:new Date().toISOString(),origin,status:'INCOMPLETE',authenticationWrites:0,bookWrites:0,resources:[],books:[],aggregateHash:'',unavailableRoles:[],limitations:['HTTPS hash manifest, not a recoverable database backup. Source JSON is hashed in memory; binary streams are hashed and discarded.','Covers both configured owner identities. Internal database rows and other identities are outside the HTTPS API scope.'],counts:{books:0,submissions:0,media:0,snapshots:0,snapshotMedia:0,versions:0,exports:0,pdfs:0,binaryBytes:0}};
  const captureJson=async<T>(role:Role,ctx:APIRequestContext,path:string,optional404=false):Promise<T|null>=>{
    const res=await ctx.get(path,{maxRedirects:0});
    try{if(optional404&&res.status()===404){manifest.resources.push({role,path,kind:'json',status:404,sha256:null,bytes:0});return null;}ensure(res.status()===200,'JSON_READ_HTTP_'+res.status());const value=await res.json() as T;manifest.resources.push({role,path,kind:'json',status:200,sha256:preservationHash(value),bytes:Buffer.byteLength(JSON.stringify(canonical(value)))});return value;}
    finally{await res.dispose();}
  };
  const captureBinary=async(role:Role,ctx:APIRequestContext,path:string,optional404=false)=>{
    ensure(path.startsWith('/api/')&&!path.includes('#')&&!path.includes('://'),'BINARY_PATH_INVALID');
    const url=new URL(path,origin),state=await ctx.storageState();ensure(url.origin===origin,'BINARY_ORIGIN_MISMATCH');
    const cookie=state.cookies.filter(c=>{const domain=c.domain.replace(/^\./,'');return(url.hostname===domain||url.hostname.endsWith('.'+domain))&&url.pathname.startsWith(c.path)&&(c.expires<0||c.expires>Date.now()/1000);}).map(c=>{ensure(/^[^\s;=]+$/.test(c.name)&&!/[\r\n;]/.test(c.value),'INVALID_COOKIE');return`${c.name}=${c.value}`;}).join('; ');
    const res=await fetch(url,{headers:{Origin:origin,Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(120000)});
    if(optional404&&res.status===404){await res.body?.cancel();manifest.resources.push({role,path,kind:'binary',status:404,sha256:null,bytes:0});return false;}
    if(res.status!==200){await res.body?.cancel();throw new Error('BINARY_READ_HTTP_'+res.status);}
    ensure(res.body,'EMPTY_BINARY_RESPONSE');const result=await digestStream(res.body);manifest.resources.push({role,path,kind:'binary',status:200,...result});manifest.counts.binaryBytes+=result.bytes;return true;
  };
  try{
    for(const role of ['owner','operator'] as const){
      const storageState=role==='owner'&&await existing(ownerState)?ownerState:input(role==='owner'?config.ownerStorageState:arg('--operator-state')||config.operatorStorageState);
      const context=await request.newContext({baseURL:origin,storageState,timeout:90000,extraHTTPHeaders:{Origin:origin}});const account={role,context} as typeof contexts[number];contexts.push(account);
      let response=await context.get('/api/wedding/books',{maxRedirects:0});
      if(role==='owner'&&response.status()===401&&process.argv.includes('--refresh-owner')){
        await response.dispose();const credentials=JSON.parse(await readFile(input(config.accountCredentials),'utf8')) as {email:string;password:string};ensure(typeof credentials.email==='string'&&typeof credentials.password==='string','INVALID_OWNER_CREDENTIALS');
        const auth=await context.post('/api/auth/sign-in/email',{data:credentials,maxRedirects:0});manifest.authenticationWrites++;const status=auth.status();await auth.dispose();ensure(status===200,'OWNER_SIGNIN_HTTP_'+status);
        await mkdir(dirname(ownerState),{recursive:true});await context.storageState({path:ownerState});response=await context.get('/api/wedding/books',{maxRedirects:0});
      }
      if(response.status()===401){manifest.unavailableRoles.push(role);await response.dispose();continue;}
      ensure(response.status()===200,'BOOK_LIST_HTTP_'+response.status());account.list=await response.json();await response.dispose();ensure(Array.isArray(account.list?.books),'INVALID_BOOK_LIST');
    }
    for(const{role,context,list}of contexts){
      if(!list)continue;
      // Retain only the hash of the full owner list: names, invitation links and
      // other private source values never enter the written report.
      manifest.resources.push({role,path:'/api/wedding/books',kind:'json',status:200,sha256:preservationHash(list),bytes:Buffer.byteLength(JSON.stringify(canonical(list)))});
      for(const bookId of ids(list.books)){
        ensure(!manifest.books.some(book=>book.id===bookId),'DUPLICATE_BOOK_ACROSS_ACCOUNTS');
        const detail=(await captureJson<Detail>(role,context,`/api/wedding/books/${bookId}`))!;
        const root=`/api/book-workflow/${bookId}`,head=(await captureJson<Head>(role,context,root))!;
        ensure(detail.book.id===bookId&&detail.submissions.length===head.submissionCount,'SUBMISSION_COUNT_CHANGED_DURING_CAPTURE');
        const refs:BookRefs={id:bookId,role,submissionIds:ids(detail.submissions),mediaIds:ids(detail.submissions.flatMap(s=>s.media||[])),snapshotIds:ids(head.snapshots),versionIds:ids(head.versions),exportIds:[]};manifest.books.push(refs);
        manifest.counts.books++;manifest.counts.submissions+=refs.submissionIds.length;manifest.counts.media+=refs.mediaIds.length;manifest.counts.snapshots+=refs.snapshotIds.length;manifest.counts.versions+=refs.versionIds.length;
        await captureJson(role,context,root+'/reviews');
        for(const mediaId of refs.mediaIds){await captureBinary(role,context,`/api/wedding/media/${mediaId}/original`);await captureJson(role,context,`/api/wedding/media/${mediaId}/annotation`,true);}
        for(const versionId of refs.versionIds){await captureJson(role,context,`${root}/versions/${versionId}`);await captureJson(role,context,`${root}/versions/${versionId}/approval`);}
        for(const snapshotId of refs.snapshotIds){
          const snapshot=(await captureJson<Snapshot>(role,context,`${root}/snapshots/${snapshotId}`))!;
          const selected=new Set(snapshot.selectedIds),candidates=new Set([...ids(snapshot.sources.flatMap(s=>s.media||[])),...ids(detail.submissions.filter(s=>selected.has(s.id)).flatMap(s=>s.media||[]))]);
          for(const mediaId of [...candidates].sort())if(await captureBinary(role,context,`${root}/media/${mediaId}?snapshotId=${snapshotId}`,true))manifest.counts.snapshotMedia++;
        }
        const jobs=(await captureJson<Jobs>(role,context,root+'/exports'))!;ensure(jobs.exports.length<100,'EXPORT_LIST_MAY_BE_TRUNCATED');refs.exportIds=ids(jobs.exports);manifest.counts.exports+=refs.exportIds.length;
        for(const job of jobs.exports)if(job.status==='complete'){ensure(!job.withheld,'COMPLETED_PDF_WITHHELD_NOT_READ');await captureBinary(role,context,`${root}/exports/${job.id}/download`);manifest.counts.pdfs++;}
        // Detect edits made during the scan instead of certifying a mixed state.
        for(const[path,expected]of [[`/api/wedding/books/${bookId}`,detail],[root,head]] as const){const res=await context.get(path,{maxRedirects:0});try{ensure(res.status()===200&&preservationHash(await res.json())===preservationHash(expected),'BOOK_CHANGED_DURING_CAPTURE');}finally{await res.dispose();}}
      }
    }
    ensure(!manifest.unavailableRoles.includes('owner'),'EXISTING_OWNER_SESSION_REQUIRED');
    ensure(!manifest.unavailableRoles.includes('operator'),'EXISTING_OPERATOR_SESSION_REQUIRED');
    ensure(manifest.counts.books>0,'EMPTY_BOOK_SCOPE');manifest.status='PASS';
    manifest.aggregateHash=preservationFingerprint(manifest.resources,manifest.books);
  }catch(error){manifest.status='INCOMPLETE';manifest.errorCode=error instanceof Error&&safeCode.test(error.message)?error.message:'PRESERVATION_CHECK_INCOMPLETE';}
  finally{for(const{context}of contexts)await context.dispose();}
  manifest.aggregateHash=preservationFingerprint(manifest.resources,manifest.books);
  const comparison=arg('--compare');if(comparison){
    const before=JSON.parse(await readFile(resolve(comparison),'utf8')) as Manifest;
    const scoped=process.argv.includes('--allow-owner-only-comparison')&&before.status==='INCOMPLETE'&&manifest.status==='INCOMPLETE'&&before.errorCode==='EXISTING_OPERATOR_SESSION_REQUIRED'&&manifest.errorCode==='EXISTING_OPERATOR_SESSION_REQUIRED'&&before.unavailableRoles.join(',')==='operator'&&manifest.unavailableRoles.join(',')==='operator'&&manifest.books.length>0;
    ensure(before.format===manifest.format&&before.origin===origin&&(before.status==='PASS'&&manifest.status==='PASS'||scoped),'INVALID_BASELINE');ensure(before.aggregateHash===preservationFingerprint(before.resources,before.books),'BASELINE_HASH_MISMATCH');manifest.comparison={baselineHash:before.aggregateHash,unchanged:before.aggregateHash===manifest.aggregateHash,scope:scoped?'OWNER_ONLY':'ALL_CONFIGURED_ACCOUNTS'};if(!manifest.comparison.unchanged)manifest.status='CHANGED';
  }
  const destination=manifest.status==='INCOMPLETE'?out.replace(/\.json$/,'.incomplete.json'):out;
  await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({status:manifest.status,counts:manifest.counts,resources:manifest.resources.length,aggregateHash:manifest.aggregateHash,authenticationWrites:manifest.authenticationWrites,bookWrites:0,unavailableRoles:manifest.unavailableRoles,errorCode:manifest.errorCode,comparison:manifest.comparison}));
  if(manifest.status!=='PASS')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await run().catch(error=>{console.error(JSON.stringify({status:'INCOMPLETE',errorCode:error instanceof Error&&safeCode.test(error.message)?error.message:'PRESERVATION_INPUT_ERROR',bookWrites:0}));process.exitCode=1;});
