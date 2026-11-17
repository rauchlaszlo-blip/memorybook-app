import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {request} from '@playwright/test';
import type {APIRequestContext,APIResponse} from '@playwright/test';

export const pilotOrigin='https://memorybook-wedding-text-pilot-ukd0.onrender.com';
export const callbackUri='https://chatgpt.com/connector_platform_oauth_redirect';
export const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type InternetConfig={origin:string;ownerStorageState:string;accountCredentials?:string;operatorStorageState?:string;testCodeFile?:string;bookId?:string;expectedTitle?:string;denyBookId:string;acknowledgement:'ONLY_DESIGNATED_FICTIONAL_BOOK';outputDirectory?:string;exportWaitMs?:number};
export const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function ensure(condition:unknown,code:string):asserts condition{if(!condition)throw new Error(code);}
function inside(parent:string,path:string){const remainder=relative(parent,path);return remainder!==''&&!remainder.startsWith('..')&&!isAbsolute(remainder);}
export async function loadInternetConfig(path:string|undefined,needsBook=true){
  ensure(path,'CONFIG_REQUIRED');const configPath=resolve(path);ensure(inside(resolve('.'),configPath)&&configPath.endsWith('.local'),'CONFIG_MUST_BE_IGNORED_LOCAL_FILE');
  const config=JSON.parse(await readFile(configPath,'utf8')) as InternetConfig;
  ensure(config.origin===pilotOrigin&&config.acknowledgement==='ONLY_DESIGNATED_FICTIONAL_BOOK','REMOTE_SCOPE_NOT_ACKNOWLEDGED');
  ensure(typeof config.denyBookId==='string'&&uuid.test(config.denyBookId),'DENY_BOOK_REQUIRED');
  const storagePath=resolve(config.ownerStorageState||'');ensure(inside(resolve('.'),storagePath)&&storagePath.endsWith('.local'),'OWNER_STORAGE_MUST_BE_IGNORED_LOCAL_FILE');
  await readFile(storagePath); // Fail before any remote action if the existing owner session is absent.
  for(const optional of [config.accountCredentials,config.operatorStorageState,config.testCodeFile])if(optional){const optionalPath=resolve(optional);ensure(inside(resolve('.'),optionalPath)&&optionalPath.endsWith('.local'),'OPTIONAL_INPUT_MUST_BE_IGNORED_LOCAL_FILE');await readFile(optionalPath);}
  if(needsBook)ensure(config.bookId&&uuid.test(config.bookId)&&config.bookId!==config.denyBookId&&typeof config.expectedTitle==='string'&&/fiktív/i.test(config.expectedTitle),'DESIGNATED_FICTIONAL_BOOK_REQUIRED');
  const outputDirectory=resolve(config.outputDirectory||'test-results/mcp-internet');ensure(inside(resolve('test-results'),outputDirectory),'OUTPUT_MUST_STAY_IN_TEST_RESULTS');
  ensure(config.exportWaitMs===undefined||Number.isInteger(config.exportWaitMs)&&config.exportWaitMs>=1000&&config.exportWaitMs<=300000,'INVALID_EXPORT_WAIT');
  return {config,configPath,storagePath,outputDirectory};
}
export async function writeJson(path:string,value:unknown){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2));}
export async function readOptionalJson<T>(path:string):Promise<T|null>{try{return JSON.parse(await readFile(path,'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export function pathFor(url:string){const parsed=new URL(url,pilotOrigin);ensure(parsed.origin===pilotOrigin&&!parsed.username&&!parsed.password,'REMOTE_ORIGIN_CHANGED');return parsed.pathname+parsed.search;}
export async function createRemoteContext(storageState?:string){return request.newContext({baseURL:pilotOrigin,storageState,timeout:60000,extraHTTPHeaders:{Origin:pilotOrigin}});}
export async function createOwnerContext(config:InternetConfig,storagePath:string){
  const owner=await createRemoteContext(storagePath);
  try{
    let session=await getJson<{user:{id:string}|null;operator:boolean}>(owner,'/api/shop/session');
    if(!session.user&&!session.operator&&config.accountCredentials){
      const credentials=JSON.parse(await readFile(resolve(config.accountCredentials),'utf8')) as {email:string;password:string};
      ensure(typeof credentials.email==='string'&&typeof credentials.password==='string','INVALID_EXISTING_CREDENTIAL_FILE');
      await postJson(owner,'/api/auth/sign-in/email',credentials,[200]);
      await owner.storageState({path:storagePath});session=await getJson(owner,'/api/shop/session');
    }
    ensure(session.user||session.operator,'EXISTING_OWNER_SESSION_REQUIRED');return owner;
  }catch(error){await owner.dispose();throw error;}
}
export async function getJson<T>(context:APIRequestContext,path:string,status=200):Promise<T>{const response=await context.get(pathFor(path),{maxRedirects:0});ensure(response.status()===status,'HTTP_READ_FAILED');return response.json() as Promise<T>;}
export async function postJson<T>(context:APIRequestContext,path:string,data:unknown,statuses=[200,201]):Promise<T>{const response=await context.post(pathFor(path),{data,maxRedirects:0});ensure(statuses.includes(response.status()),'HTTP_WRITE_FAILED');return response.json() as Promise<T>;}
export function safeStatus(response:APIResponse,status:number,code:string){ensure(response.status()===status,code);}
export type OwnerBookDetail={book:{id:string;title:string;invite_token:string;closed_at:string|null};submissions:{id:string;guest_name:string;message:string;media:{id:string}[]}[]};
export async function fictionalBook(owner:APIRequestContext,config:InternetConfig){ensure(config.bookId&&uuid.test(config.bookId),'DESIGNATED_BOOK_REQUIRED');const detail=await getJson<OwnerBookDetail>(owner,'/api/wedding/books/'+config.bookId);ensure(detail.book.id===config.bookId&&detail.book.title===config.expectedTitle&&/fiktív/i.test(detail.book.title),'FICTIONAL_BOOK_TITLE_MISMATCH');return detail;}
