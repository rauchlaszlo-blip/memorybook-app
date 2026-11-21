// Read-only HTTPS content recovery copy and post-release comparison. Never opens the DB firewall.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { createOwnerContext, createRemoteContext, loadInternetConfig, ensure, getJson, uuid } from './mcp-internet-utils';

const canonical=(x:unknown):unknown=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
const hash=(x:unknown)=>createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(canonical(x))).digest('hex');
type RecordEntry={account:number;path:string;kind:'book'|'snapshot'|'version'|'binary'|'json';file:string;sha256:string};
function normalize(kind:RecordEntry['kind'],value:unknown){
  const v=value as Record<string,unknown>;
  if(kind==='book'&&process.argv.includes('--capture-release'))return {...v,submissions:(v.submissions as {media?:Record<string,unknown>[]}[]).map(s=>({...s,media:(s.media||[]).map(m=>({id:m.id,previewUrl:m.previewUrl,displayUrl:m.displayUrl,originalUrl:m.originalUrl}))}))};
  if(kind==='snapshot')return {id:v.id,contentHash:v.contentHash,selectedIds:v.selectedIds,sources:(v.sources as Record<string,unknown>[]).map(source=>Object.fromEntries(Object.entries(source).filter(([key])=>key!=='review')))};
  if(kind==='version')return {id:v.id,draft:v.draft,snapshotId:v.snapshotId,approved_at:v.approved_at};
  return value;
}
const {config,storagePath}=await loadInternetConfig(process.argv.find(a=>a.endsWith('.local'))),mode=process.argv.includes('--capture')?'capture':'verify';
const dir=resolve(process.argv.includes('--app-trial-release')?'test-results/app-trial/pre-release':process.argv.includes('--book-view-release')?'test-results/book-view/pre-release':process.argv.includes('--capture-release')?'test-results/guest-capture/pre-release':'test-results/content-review/pre-release'),manifestPath=resolve(dir,'manifest.local');
const contexts:APIRequestContext[]=[];
try {
  contexts.push(await createOwnerContext(config,storagePath));
  ensure(config.operatorStorageState,'EXISTING_OPERATOR_SESSION_REQUIRED');contexts.push(await createRemoteContext(config.operatorStorageState));
  if(mode==='capture') {
    try {await readFile(manifestPath);throw new Error('EXISTING_CAPTURE_MUST_NOT_BE_OVERWRITTEN');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await mkdir(dir,{recursive:true});const entries:RecordEntry[]=[],books=new Set<string>();
    const capture=async(account:number,path:string,kind:RecordEntry['kind'])=>{
      const response=await contexts[account].get(path,{maxRedirects:0});ensure(response.status()===200,'CAPTURE_HTTP_'+response.status());
      const value=kind==='binary'?await response.body():normalize(kind,await response.json());
      const file=`${entries.length}.${kind==='binary'?'bin':'local'}`;await writeFile(resolve(dir,file),Buffer.isBuffer(value)?value:JSON.stringify(value));
      entries.push({account,path,kind,file,sha256:hash(value)});return value as Record<string,unknown>;
    };
    for(let account=0;account<contexts.length;account++) {
      const list=await getJson<{books:{id:string}[]}>(contexts[account],'/api/wedding/books');
      for(const book of list.books) {
        ensure(uuid.test(book.id)&&!books.has(book.id),'INVALID_OR_DUPLICATE_BOOK');books.add(book.id);
        const detail=await capture(account,'/api/wedding/books/'+book.id,'book');
        for(const submission of detail.submissions as {media:{id:string}[]}[])for(const media of submission.media||[]) {
          ensure(uuid.test(media.id),'INVALID_MEDIA');await capture(account,'/api/wedding/media/'+media.id+'/original','binary');
          const annotation='/api/wedding/media/'+media.id+'/annotation',response=await contexts[account].get(annotation,{maxRedirects:0});
          if(response.status()===200)await capture(account,annotation,'json');else ensure(response.status()===404,'ANNOTATION_READ_FAILED');
        }
        const workflow=await getJson<{snapshots:{id:string}[];versions:{id:string}[]}>(contexts[account],'/api/book-workflow/'+book.id);
        for(const version of workflow.versions)await capture(account,`/api/book-workflow/${book.id}/versions/${version.id}`,'version');
        for(const snapshot of workflow.snapshots) {
          const captured=await capture(account,`/api/book-workflow/${book.id}/snapshots/${snapshot.id}`,'snapshot');
          // The deployed MCP original route is deliberately limited to the designated fictitious book.
          if(book.id===config.bookId)for(const source of captured.sources as {media:{id:string}[]}[])for(const media of source.media)await capture(account,`/mcp/media/${book.id}/${media.id}?snapshotId=${snapshot.id}`,'binary');
        }
        const jobs=await getJson<{exports:{id:string;status:string}[]}>(contexts[account],`/api/book-workflow/${book.id}/exports`);
        for(const job of jobs.exports.filter(job=>job.status==='complete'))await capture(account,`/api/book-workflow/${book.id}/exports/${job.id}/download`,'binary');
      }
    }
    await writeFile(manifestPath,JSON.stringify({at:new Date().toISOString(),scope:'HTTPS source content, stored drafts/snapshots and complete PDF files; not a full database backup',books:books.size,entries},null,2));
    console.log(JSON.stringify({status:'PASS',mode,books:books.size,resources:entries.length,firewallChanged:false}));
  } else {
    const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {books:number;entries:RecordEntry[]};
    for(const entry of manifest.entries) {
      const local=await readFile(resolve(dir,entry.file)),expected=entry.kind==='binary'?local:JSON.parse(local.toString());ensure(hash(expected)===entry.sha256,'LOCAL_COPY_HASH_MISMATCH');
      const response=await contexts[entry.account].get(entry.path,{maxRedirects:0});ensure(response.status()===200,'PRESERVATION_HTTP_'+response.status());
      let actual=entry.kind==='binary'?await response.body():normalize(entry.kind,await response.json());
      if(entry.kind==='book'&&entry.path==='/api/wedding/books/'+config.bookId&&process.argv.includes('--capture-release')&&process.argv.includes('--allow-new-submissions')){
        const expectedIds=new Set((expected.submissions as {id:string}[]).map(s=>s.id));
        const current=actual as {submissions:{id:string}[]};
        actual={...current,submissions:current.submissions.filter(s=>expectedIds.has(s.id))};
      }
      ensure(hash(actual)===entry.sha256,'SOURCE_OR_FROZEN_ARTIFACT_CHANGED');
    }
    const report={at:new Date().toISOString(),status:'PASS',books:manifest.books,unchangedResources:manifest.entries.length,additionalSubmissionsAllowed:process.argv.includes('--capture-release')&&process.argv.includes('--allow-new-submissions'),comparison:'All captured source fields, originals, annotations, saved drafts, snapshot content and completed PDF bytes match the pre-release HTTPS copy'};
    await writeFile(resolve(dir,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
} finally {for(const context of contexts)await context.dispose();}
