// Emergency owner-visible backup only. No guest writes and no database connection.
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request,type APIRequestContext} from '@playwright/test';
import {parseStoredZip,validateCollectionHttpsConfig} from './verify-collection-https';

const privateRoot='C:/Users/Laci/MemoryBook-private-backups/20261128';
const bookId='collection-wedding-pilot-20261127';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
type File={id:string;state:string;sha256:string;byteLength:number;originalUrl:string|null;provenance?:string};
type Collection={book:{id:string};sessions:{groupId:string;files:File[]}[];settings:unknown;legacy:unknown};
function ensure(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
function inside(parent:string,file:string){const part=relative(resolve(parent),resolve(file));return part!==''&&!part.startsWith('..')&&!isAbsolute(part);}
export function collectionDataFingerprint(value:Collection){return sha(JSON.stringify(canonical({book:value.book,settings:value.settings,sessions:value.sessions,legacy:value.legacy})));}
export function verifyArchiveOriginals(collection:Collection,archive:Map<string,Buffer>){
  const verified:{fileId:string;groupId:string;bytes:number;sha256:string;entry:string;provenance:string}[]=[],used=new Set<string>();
  for(const session of collection.sessions)for(const file of session.files){
    if(file.state==='removed'||!file.originalUrl)continue;ensure(/^[a-f\d-]{36}$/i.test(file.id)&&/^[a-f\d]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.byteLength)&&file.byteLength>0,'ORIGINAL_METADATA_INVALID');
    const prefix=`originals/${sha(session.groupId).slice(0,24)}/${file.id}.`,found=[...archive.entries()].filter(([name])=>name.startsWith(prefix));
    ensure(found.length===1&&!used.has(found[0][0]),'ARCHIVE_ORIGINAL_SET_MISMATCH');const[entry,bytes]=found[0];ensure(bytes.length===file.byteLength&&sha(bytes)===file.sha256,'ARCHIVE_ORIGINAL_DIGEST_MISMATCH');used.add(entry);
    verified.push({fileId:file.id,groupId:session.groupId,bytes:bytes.length,sha256:file.sha256,entry,provenance:file.provenance||'not_specified'});
  }
  ensure([...archive.keys()].filter(name=>name.startsWith('originals/')).length===used.size,'ARCHIVE_UNEXPECTED_ORIGINAL');return verified;
}
async function main(){
  const[configArg,label,run,...extra]=process.argv.slice(2);ensure(configArg&&/^[a-z\d][a-z\d-]{5,80}$/.test(label||'')&&run==='--run'&&!extra.length,'EXPLICIT_CONFIG_LABEL_RUN_REQUIRED');
  const configPath=resolve(configArg);ensure(inside(resolve('test-results'),configPath),'CONFIG_SCOPE_MISMATCH');
  const config=validateCollectionHttpsConfig(JSON.parse(await readFile(configPath,'utf8')));ensure(config.bookId===bookId,'EXACT_COLLECTION_BOOK_REQUIRED');
  const output=resolve(privateRoot,label);ensure(inside(privateRoot,output),'BACKUP_PATH_ESCAPED');await mkdir(output,{recursive:false,mode:0o700});
  let context:APIRequestContext|undefined;
  const report:{[key:string]:unknown}={format:'collection-owner-emergency-backup-v1',at:new Date().toISOString(),status:'INCOMPLETE',bookId,authenticationWrites:0,bookWrites:0,stage:'owner_auth',limitations:['Owner-visible API backup, not a full database backup.','ZIP omits removed file bytes, incomplete upload chunks, internal worker/auth state and any data unavailable to the owner API.','External legacy references are recorded in private JSON; arbitrary external URLs are not downloaded.','Metadata is checked before/after; this is not an atomic database snapshot.']};
  try{
    context=await request.newContext({baseURL:config.baseUrl,timeout:90000,extraHTTPHeaders:{Origin:config.baseUrl}});
    const redeemed=await context.post('/api/pilot/collection-trial/redeem',{data:{key:config.ownerTrialKey},maxRedirects:0});report.authenticationWrites=1;
    ensure(redeemed.status()===200,'OWNER_REDEEM_STATUS_'+redeemed.status());const access=await redeemed.json();await redeemed.dispose();ensure(access.bookId===bookId&&access.redirectTo===`/my-books/${bookId}/materials`,'OWNER_BOOK_SCOPE_MISMATCH');
    const cookies=(await context.storageState()).cookies.filter(cookie=>cookie.name==='__Host-memorybook-collection-trial'&&cookie.domain===new URL(config.baseUrl).hostname&&cookie.secure&&cookie.path==='/');ensure(cookies.length===1&&/^[A-Za-z\d_-]{43}$/.test(cookies[0].value),'OWNER_COOKIE_INVALID');
    const root=`/api/my/books/${bookId}/collection`;
    async function download(path:string,relativeFile:string,maxBytes:number){
      ensure(path===root||path.startsWith(root+'/')||path==='/api/pilot/collection-trial/session','DOWNLOAD_SCOPE_MISMATCH');ensure(!path.includes('..')&&!path.includes('?')&&!path.includes('#')&&!path.includes('://'),'DOWNLOAD_PATH_INVALID');
      const filename=resolve(output,relativeFile);ensure(inside(output,filename),'BACKUP_PATH_ESCAPED');await mkdir(dirname(filename),{recursive:true,mode:0o700});
      const response=await fetch(config.baseUrl+path,{headers:{Cookie:`${cookies[0].name}=${cookies[0].value}`},redirect:'error',signal:AbortSignal.timeout(120000)});ensure(response.status===200&&response.body,'DOWNLOAD_STATUS_'+response.status);
      const handle=await open(filename,'wx',0o600),digest=createHash('sha256');let bytes=0;try{for await(const chunk of response.body){bytes+=chunk.length;ensure(bytes<=maxBytes,'BACKUP_RESOURCE_SIZE_LIMIT');digest.update(chunk);await handle.writeFile(chunk);}}finally{await handle.close();}
      return {file:relativeFile,bytes,sha256:digest.digest('hex')};
    }
    const trialFile=await download('/api/pilot/collection-trial/session','owner-session.local.json',1024*1024),trial=JSON.parse(await readFile(resolve(output,trialFile.file),'utf8'));ensure(trial.trial?.bookId===bookId,'OWNER_SESSION_SCOPE_MISMATCH');report.ownerExpiresAt=trial.trial.expiresAt;
    report.stage='owner_collection';const listFile=await download(root,'collection-before.local.json',64*1024*1024),collection=JSON.parse(await readFile(resolve(output,listFile.file),'utf8')) as Collection;ensure(collection.book.id===bookId&&Array.isArray(collection.sessions),'COLLECTION_SCOPE_MISMATCH');
    const manifestFile=await download(root+'/manifest.json','manifest.local.json',64*1024*1024),manifest=JSON.parse(await readFile(resolve(output,manifestFile.file),'utf8')) as Collection;ensure(collectionDataFingerprint(collection)===collectionDataFingerprint(manifest),'COLLECTION_CHANGED_DURING_MANIFEST');
    report.stage='archive';const zipFile=await download(root+'/archive.zip','originals-and-snapshots.zip',500*1024*1024),archive=parseStoredZip(await readFile(resolve(output,zipFile.file)));
    ensure(archive.has('manifest.json')&&archive.has('snapshots.json'),'ARCHIVE_METADATA_MISSING');const archived=JSON.parse(archive.get('manifest.json')!.toString('utf8')) as Collection;ensure(collectionDataFingerprint(archived)===collectionDataFingerprint(collection),'COLLECTION_CHANGED_DURING_ARCHIVE');
    const verified=verifyArchiveOriginals(collection,archive);
    for(const[name,bytes]of archive){const filename=resolve(output,'archive-expanded',name);ensure(inside(resolve(output,'archive-expanded'),filename),'ARCHIVE_PATH_ESCAPED');await mkdir(dirname(filename),{recursive:true,mode:0o700});await writeFile(filename,bytes,{flag:'wx',mode:0o600});}
    report.stage='originals';const originals=[];
    for(const entry of verified){const session=collection.sessions.find(item=>item.groupId===entry.groupId)!,file=session.files.find(item=>item.id===entry.fileId)!;ensure(file.originalUrl===`${root}/files/${entry.fileId}/original`,'ORIGINAL_PATH_SCOPE_MISMATCH');const direct=await download(file.originalUrl,`direct-originals/${entry.fileId}.bin`,100*1024*1024);ensure(direct.bytes===entry.bytes&&direct.sha256===entry.sha256,'DIRECT_ORIGINAL_CHANGED');originals.push({...entry,directSha256:direct.sha256});}
    report.stage='preservation';const afterFile=await download(root,'collection-after.local.json',64*1024*1024),after=JSON.parse(await readFile(resolve(output,afterFile.file),'utf8')) as Collection;ensure(collectionDataFingerprint(after)===collectionDataFingerprint(collection),'COLLECTION_CHANGED_DURING_BACKUP');
    const privateEvidence={originals,files:[listFile,manifestFile,zipFile,afterFile],collectionFingerprint:collectionDataFingerprint(collection)};await writeFile(resolve(output,'integrity.local.json'),JSON.stringify(privateEvidence,null,2),{flag:'wx',mode:0o600});
    report.status='PASS';report.stage='complete';report.sessions=collection.sessions.length;report.originals=originals.length;report.originalBytes=originals.reduce((sum,item)=>sum+item.bytes,0);report.archiveEntries=archive.size;report.archiveSha256=zipFile.sha256;report.archiveBytes=zipFile.bytes;report.metadataStable=true;report.originalsSha256=sha(JSON.stringify(originals.map(({fileId,sha256,bytes})=>({fileId,sha256,bytes})).sort((a,b)=>a.fileId.localeCompare(b.fileId))));report.collectionFingerprint=privateEvidence.collectionFingerprint;
  }catch(error){report.errorCode=error instanceof Error&&/^[A-Z][A-Z\d_]+$/.test(error.message)?error.message:'OWNER_BACKUP_FAILED';process.exitCode=1;}
  finally{await context?.dispose();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main().catch(error=>{console.error(JSON.stringify({status:'INCOMPLETE',errorCode:error instanceof Error&&/^[A-Z][A-Z\d_]+$/.test(error.message)?error.message:'OWNER_BACKUP_INPUT_ERROR'}));process.exitCode=1;});
