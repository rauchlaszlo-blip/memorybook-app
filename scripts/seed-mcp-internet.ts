// Explicit HTTP-only fictional seed. Never opens PostgreSQL or edits an old book.
// node --import tsx scripts/seed-mcp-internet.ts --seed test-results/mcp-internet/config.local
// Optional config: accountCredentials (.local), operatorStorageState (.local), testCodeFile (.local).
// Existing commerce account may be reauthenticated; a new 0-Ft test order is used if needed.
import {randomUUID} from 'node:crypto';
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import type {APIRequestContext,APIResponse} from '@playwright/test';
import {weddingPackage} from '../shared/wedding-package';
import {loadInternetConfig,createRemoteContext,createOwnerContext,getJson,postJson,fictionalBook,hash,ensure,readOptionalJson,writeJson} from './mcp-internet-utils';
import type {OwnerBookDetail} from './mcp-internet-utils';

type SeedCheckpoint={runId:string;title:string;orderKey:string;baselineOrderIds?:string[];orderId?:string;bookId?:string;uploadKeys:string[];done:number[]};
let stage='load_config',owner:APIRequestContext|undefined,operator:APIRequestContext|undefined,outputDirectory:string|undefined;
const report:{status:string;stage:string;bookId?:string;contributors:number;images:number;mediaOnlyViaHttp:boolean;existingBooksUnchanged?:boolean}={status:'RUNNING',stage,contributors:0,images:0,mediaOnlyViaHttp:false};
async function seedResponse(action:()=>Promise<APIResponse>){let response=await action();if(response.status()===429){const seconds=Math.min(60,Math.max(1,Number(response.headers()['retry-after']||'60')));await new Promise(r=>setTimeout(r,seconds*1000));response=await action();}return response;}
try{
  const loaded=await loadInternetConfig(process.argv.find(a=>a.endsWith('.local')),false),{config}=loaded;outputDirectory=loaded.outputDirectory;
  if(process.argv.includes('--check-config')){console.log('PASS: seed scope and ignored input files validated; no remote request.');process.exit(0);}
  ensure(process.argv.includes('--seed'),'EXPLICIT_SEED_FLAG_REQUIRED');
  owner=await createOwnerContext(config,loaded.storagePath);
  stage='existing_books_baseline';const existing=await getJson<{books:OwnerBookDetail['book'][]}>(owner,'/api/wedding/books');ensure(existing.books.some(b=>b.id===config.denyBookId),'DENY_BOOK_MUST_EXIST_AND_BE_OWNED');
  const before=new Map<string,string>();for(const book of existing.books)if(book.id!==config.bookId)before.set(book.id,hash(await getJson(owner,'/api/wedding/books/'+book.id)));
  const checkpointPath=resolve(outputDirectory,'seed-checkpoint.local');let checkpoint=await readOptionalJson<SeedCheckpoint>(checkpointPath);
  if(!checkpoint){const runId=randomUUID();checkpoint={runId,title:`MCP internetpilot – fiktív ${runId.slice(0,8)}`,orderKey:randomUUID(),uploadKeys:Array.from({length:30},()=>randomUUID()),done:[]};await writeJson(checkpointPath,checkpoint);}
  if(config.bookId){ensure(checkpoint.bookId===config.bookId,'SEED_CANNOT_ADOPT_EXISTING_BOOK');}
  if(!checkpoint.bookId){
    stage='create_new_fictional_book';const candidate=existing.books.filter(b=>b.title===checkpoint!.title);ensure(candidate.length<=1,'AMBIGUOUS_NEW_TEST_BOOK');
    if(candidate.length===1)checkpoint.bookId=candidate[0].id;
    else {
      const capabilities=await getJson<{canCreate:boolean}>(owner,'/api/wedding/capabilities');
      if(capabilities.canCreate){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const created=await postJson<{book:{id:string}}>(owner,'/api/wedding/books',{names:checkpoint.title,date},[201]);checkpoint.bookId=created.book.id;}
      else {
        stage='new_zero_cost_test_order';const codePath=resolve(outputDirectory,'seed-test-code.local');let code=await readOptionalJson<{code:string}>(codePath);
        if(!checkpoint.baselineOrderIds){const orders=await getJson<{orders:{id:string}[]}>(owner,'/api/shop/orders');checkpoint.baselineOrderIds=orders.orders.map(order=>order.id);await writeJson(checkpointPath,checkpoint);}
        if(!code&&config.testCodeFile){code=JSON.parse(await readFile(resolve(config.testCodeFile),'utf8')) as {code:string};await writeJson(codePath,code);}
        if(!code){ensure(config.operatorStorageState,'FRESH_OPERATOR_SESSION_OR_TEST_CODE_REQUIRED');operator=await createRemoteContext(resolve(config.operatorStorageState));code=await postJson<{code:string}>(operator,'/api/shop/operator/codes',{days:7},[201]);await writeJson(codePath,code);}
        ensure(/^MB-[A-Za-z0-9_-]{32}$/.test(code.code),'INVALID_TEST_CODE_FILE');
        if(!checkpoint.orderId){const order=await postJson<{orderId:string}>(owner,'/api/shop/orders',{code:code.code,idempotencyKey:checkpoint.orderKey,productId:'wedding',billing:{kind:'person',name:'Fiktív MCP-próba',postalCode:'0000',city:'Fiktív város',address:'Fiktív utca 1.'}});ensure(!checkpoint.baselineOrderIds.includes(order.orderId),'SEED_CANNOT_ADOPT_PREEXISTING_ORDER');checkpoint.orderId=order.orderId;await writeJson(checkpointPath,checkpoint);}
        const detail=await getJson<{order:{purchase_day:string};book:{id:string;title:string}|null}>(owner,'/api/shop/orders/'+checkpoint.orderId);
        // A replayed operator code must never give permission to modify an earlier book.
        if(detail.book){ensure(detail.book.title===checkpoint.title,'TEST_CODE_ALREADY_BELONGS_TO_ANOTHER_BOOK');checkpoint.bookId=detail.book.id;}
        else {const created=await postJson<{bookId:string}>(owner,'/api/shop/orders/'+checkpoint.orderId+'/book',{title:checkpoint.title,names:'Fiktív Lili és Márk',date:detail.order.purchase_day,appearance:weddingPackage.appearance},[200]);checkpoint.bookId=created.bookId;}
      }
    }
    await writeJson(checkpointPath,checkpoint);
  }
  ensure(checkpoint.bookId!==config.denyBookId,'SEED_SCOPE_COLLISION');config.bookId=checkpoint.bookId;config.expectedTitle=checkpoint.title;await writeJson(loaded.configPath,config);report.bookId=config.bookId;
  const book=await fictionalBook(owner,config);ensure(!book.book.closed_at,'SEED_BOOK_ALREADY_CLOSED');ensure(book.submissions.every(s=>/^Fiktív/.test(s.guest_name)),'SEED_BOOK_CONTAINS_UNEXPECTED_SOURCES');
  for(let guestIndex=0;guestIndex<10;guestIndex++){
    stage=`seed_fictional_guest_${guestIndex+1}`;const statePath=resolve(outputDirectory,`seed-guest-${guestIndex+1}.local`);let stateExists=false;try{await access(statePath);stateExists=true;}catch{/* New technical guest. */}
    const guest=await createRemoteContext(stateExists?statePath:undefined);
    try{
      const guestPath='/api/wedding/guest/'+book.book.invite_token;await getJson(guest,guestPath);await guest.storageState({path:statePath});
      for(let picture=0;picture<3;picture++){
        const index=guestIndex*3+picture;if(checkpoint.done.includes(index))continue;const portrait=index%2===0,width=portrait?900:1200,height=portrait?1200:800;
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8eddb"/><circle cx="${width*.3}" cy="${height*.38}" r="${width*.19}" fill="${['#b76446','#577e69','#7c6594','#437c9c','#bc8b31'][guestIndex%5]}"/><path d="M${width*.55} ${height*.2}L${width*.85} ${height*.64}L${width*.45} ${height*.64}Z" fill="#d7a653"/><rect x="25" y="25" width="60" height="60" fill="#d72e35"/><text x="${width*.12}" y="${height*.85}" font-family="sans-serif" font-size="${width*.055}" fill="#332d30">FIKTIV ${guestIndex+1} / ${picture+1}</text></svg>`;
        const bytes=await sharp(Buffer.from(svg)).png().toBuffer(),key=checkpoint.uploadKeys[index];const uploaded=await seedResponse(()=>guest.post(guestPath+'/media/'+key,{headers:{'Content-Type':'application/octet-stream'},data:bytes,maxRedirects:0}));ensure([200,201].includes(uploaded.status()),'SEED_UPLOAD_REJECTED');const {mediaId}=await uploaded.json() as {mediaId:string};
        const message=guestIndex===2&&picture===0?'Őrizzétek az együtt töltött idő örömét! Árvíztűrő tükörfúrógép, ősz, üdvözlet és boldogság. '.repeat(24):`Fiktív üzenet ${guestIndex+1}/${picture+1}. Őszinte örömöt, sok közös élményt és boldogságot kívánunk!`;
        const annotation=index===0||index===4?{version:1,space:'exif-oriented-normalized',strokes:[{color:'#c82731',width:.012,points:[[.15,.2],[.22,.42],[.3,.19],[.38,.42],[.46,.2],[.54,.42]]},{color:'#263c98',width:.008,points:[[.18,.53],[.35,.62],[.53,.53],[.68,.64],[.8,.53]]}]}:undefined;
        const sent=await seedResponse(()=>guest.post(guestPath+'/submissions',{data:{name:guestIndex<2?'Fiktív Éva':`Fiktív vendég ${guestIndex+1}`,message,idempotencyKey:key,mediaId,...(annotation?{annotation}:{})},maxRedirects:0}));ensure([200,201].includes(sent.status()),'SEED_SUBMISSION_REJECTED');checkpoint.done.push(index);await writeJson(checkpointPath,checkpoint);
      }
    }finally{await guest.dispose();}
    report.contributors=guestIndex+1;report.images=checkpoint.done.length;report.stage=stage;await writeJson(resolve(outputDirectory,'seed-verification.json'),report);console.log(`Fictional seed progress: ${report.contributors}/10 guest groups, ${report.images}/30 images.`);
  }
  stage='verify_new_sources_and_preserve_old_books';const complete=await fictionalBook(owner,config);ensure(complete.submissions.length===30&&complete.submissions.reduce((n,s)=>n+s.media.length,0)===30,'SEED_COUNTS_MISMATCH');
  for(const [id,fingerprint] of before)if(id!==config.bookId)ensure(hash(await getJson(owner,'/api/wedding/books/'+id))===fingerprint,'PREEXISTING_BOOK_CHANGED');report.existingBooksUnchanged=true;report.status='PASS';
}catch(error){report.status='FAIL';report.stage=stage;process.exitCode=1;console.log(`Seed stopped safely: ${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'SEED_FAILED'}. No secrets printed.`);}
finally{await owner?.dispose();await operator?.dispose();if(outputDirectory)await writeJson(resolve(outputDirectory,'seed-verification.json'),report);console.log(`${report.status}: HTTP-only fictional seed; bookId=${report.bookId||'not-created'}; no database connection or paid service used.`);}
