import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import type {Server as HttpServer} from 'node:http';
import express from 'express';
import {Pool} from 'pg';
import sharp from 'sharp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {migrateWedding} from '../server/wedding/migrate';
import {migrateMcp} from '../server/mcp/schema';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {createMemorybookMcpRouter,safeReviewErrorDetails} from '../server/mcp/server';
import {createWorkflowService,createExportWorker} from '../server/wedding/book-workflow';
import {seedMcpBook} from './fixtures/mcp-book';
import {arrange} from '../server/wedding/montage-layout';
import {mockProvider,defaultProfile} from '../shared/montage';
import type {Draft} from '../shared/montage';

const connectionString=localDatabaseUrl(),schema='mcp_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const origin='https://memorybook-mcp.example.test',redirectUri='https://chatgpt.com/connector_platform_oauth_redirect';
let server:HttpServer,base:string,fixture:Awaited<ReturnType<typeof seedMcpBook>>,foreign:Awaited<ReturnType<typeof seedMcpBook>>;
let clientId:string,accessToken:string,refreshToken:string,grantId:string;
const json=async(path:string,body:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),redirect:'manual'});
const form=async(path:string,body:Record<string,string|string[]>,owner?:string)=>{const params=new URLSearchParams();for(const[k,v]of Object.entries(body))for(const entry of Array.isArray(v)?v:[v])params.append(k,entry);return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...(owner?{'x-test-owner':owner,Origin:origin}:{})},body:params,redirect:'manual'});};
const owner={ownerId:'owner-mcp',kind:'owner' as const};
const service=createWorkflowService(pool);
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrateWedding(pool);await migrateMcp(pool);fixture=await seedMcpBook(pool);foreign=await seedMcpBook(pool,'other-owner');const app=express();app.use(createMemorybookMcpRouter(pool,origin,async req=>req.get('x-test-owner')?{user:{id:req.get('x-test-owner')!}}:null));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}`;});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});

async function authorization(ownerId='owner-mcp'){
  const verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',resource:origin+'/mcp',scope:'memorybook:edit offline_access',state:randomUUID(),code_challenge:challenge,code_challenge_method:'S256'});
  const response=await fetch(base+'/oauth/authorize?'+query,{headers:{'x-test-owner':ownerId},redirect:'manual'});assert.equal(response.status,200);const html=await response.text();const consent=/name="consent" value="([A-Za-z0-9_-]+)"/.exec(html)![1];return {consent,verifier,query,html};
}
test('OAuth discovery, exact callback allowlist, owner consent, PKCE, audience and one-use code',async()=>{
  const unauth=await json('/mcp',{});assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate')!,/oauth-protected-resource\/mcp/);
  assert.equal((await json('/mcp',{}, {Authorization:'Bearer '+fixture.inviteToken})).status,401,'guest token is never an MCP access token');
  const metadata=await(await fetch(base+'/.well-known/oauth-authorization-server')).json();assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);assert.equal(metadata.authorization_response_iss_parameter_supported,true);
  assert.equal((await json('/oauth/register',{redirect_uris:['https://evil.example/callback']})).status,400);
  const registered=await json('/oauth/register',{client_name:'MCP SDK test',redirect_uris:[redirectUri],token_endpoint_auth_method:'none'});assert.equal(registered.status,201);clientId=(await registered.json()).client_id;
  const auth=await authorization();assert.ok(!auth.html.includes(' checked'),'no book consent is preselected');
  assert.equal((await fetch(base+'/oauth/authorize?'+auth.query,{redirect:'manual'})).status,401);
  assert.equal((await form('/oauth/authorize',{consent:auth.consent,bookIds:[foreign.bookId],decision:'allow'},'owner-mcp')).status,403);
  assert.equal((await form('/oauth/authorize',{consent:auth.consent,bookIds:[fixture.bookId],decision:'allow'},'other-owner')).status,400);
  const accepted=await form('/oauth/authorize',{consent:auth.consent,bookIds:[fixture.bookId],decision:'allow'},'owner-mcp');assert.equal(accepted.status,303);const callback=new URL(accepted.headers.get('location')!);assert.equal(callback.searchParams.get('iss'),origin);assert.equal(callback.searchParams.get('state'),auth.query.get('state'));
  assert.equal((await form('/oauth/authorize',{consent:auth.consent,bookIds:[fixture.bookId],decision:'allow'},'owner-mcp')).status,400);
  const tokenBody={grant_type:'authorization_code',client_id:clientId,redirect_uri:redirectUri,resource:origin+'/mcp',code:callback.searchParams.get('code')!,code_verifier:auth.verifier};
  assert.equal((await form('/oauth/token',{...tokenBody,code_verifier:'z'.repeat(64)})).status,400);
  assert.equal((await form('/oauth/token',{...tokenBody,resource:'https://other-resource.example/mcp'})).status,400);
  const token=await form('/oauth/token',tokenBody);assert.equal(token.status,200);const tokens=await token.json();accessToken=tokens.access_token;refreshToken=tokens.refresh_token;assert.ok(refreshToken);assert.equal((await form('/oauth/token',tokenBody)).status,400);
  const grants=await(await fetch(base+`/api/mcp/books/${fixture.bookId}/grants`,{headers:{'x-test-owner':'owner-mcp'}})).json();assert.equal(grants.grants.length,1);grantId=grants.grants[0].id;assert.equal(JSON.stringify(grants).includes(accessToken),false);
});

test('official SDK client: initialize, list/call tools, pagination, visible image, snapshot/version/save and protected PDF',async()=>{
  const client=new Client({name:'memorybook-integration-test',version:'1.0.0'}),transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+accessToken}}});await client.connect(transport);
  const call=async(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args}) as Promise<CallToolResult>;
  const parsed=(result:CallToolResult)=>{assert.equal(result.isError,undefined,JSON.stringify(result.content));assert.equal(result.content[0].type,'text');return JSON.parse((result.content[0] as {text:string}).text);};
  try{
    const tools=await client.listTools();assert.equal(tools.tools.length,15);assert.equal(tools.tools.some(t=>/approve|resolve|decide|shell|sql|fetch_url/.test(t.name)),false);
    const listed=parsed(await call('list_books'));assert.equal(JSON.stringify(listed).includes(fixture.bookId),true);assert.equal(JSON.stringify(listed).includes(foreign.bookId),false);
    assert.equal((await call('get_book',{bookId:foreign.bookId})).isError,true);
    assert.equal((await call('get_book',{bookId:fixture.bookId,ownerId:'other-owner'})).isError,true,'arguments cannot inject an actor');
    assert.equal((await call('get_media',{bookId:fixture.bookId,mediaId:'not-an-id'})).isError,true);
    assert.equal((await call('approve_version',{bookId:fixture.bookId})).isError,true,'MCP cannot manufacture owner approval');
    assert.equal(parsed(await call('get_book',{bookId:fixture.bookId})).defaultProfile.minDpi,200);
    const snap=parsed(await call('create_snapshot',{bookId:fixture.bookId,key:randomUUID()}));assert.ok(snap.id);assert.equal(snap.sourceCount,10);
    const first=parsed(await call('list_submissions',{bookId:fixture.bookId,snapshotId:snap.id,limit:4}));assert.equal(first.submissions.length,4);assert.equal(first.nextOffset,4);const second=parsed(await call('list_submissions',{bookId:fixture.bookId,snapshotId:snap.id,limit:4,offset:4}));assert.equal(second.submissions.length,4);
    const image=await call('get_media',{bookId:fixture.bookId,snapshotId:snap.id,mediaId:fixture.mediaIds[0]});assert.equal(image.isError,undefined);assert.equal(image.content[1].type,'image');const block=image.content[1] as {data:string;mimeType:string};assert.equal(block.mimeType,'image/png');const bytes=Buffer.from(block.data,'base64'),meta=await sharp(bytes).metadata();assert.ok(meta.width!<=1600&&meta.height!<=1600);assert.ok(bytes.length>100);await mkdir('test-results/mcp',{recursive:true});await writeFile('test-results/mcp/client-visible-image.png',bytes);
    assert.equal((await call('get_media',{bookId:fixture.bookId,mediaId:foreign.mediaIds[0]})).isError,true);
    const originalUrl=parsed({...image,content:[image.content[0]]}).originalDownloadUrl.replace(origin,base);assert.equal((await fetch(originalUrl)).status,401);assert.equal((await fetch(originalUrl,{headers:{Authorization:'Bearer '+accessToken}})).status,200);
    const snapshot=await service.getSnapshot(owner,fixture.bookId,snap.id);const draft=await arrange({schema:1,format:'A4',spread:false,selected:snapshot.sources.map(s=>s.id),excluded:[],profile:structuredClone(defaultProfile),pages:[{id:randomUUID(),background:'#fffaf4',locked:false,elements:[]}]} as Draft,snapshot.sources,mockProvider);
    const body={bookId:fixture.bookId,key:randomUUID(),parentId:null,snapshotId:snap.id,draft};const version=parsed(await call('save_draft',body));assert.ok(version.id);assert.equal(parsed(await call('save_draft',body)).id,version.id);
    assert.equal((await call('save_draft',{...body,draft:{...draft,spread:true}})).isError,true);
    assert.equal(parsed(await call('get_draft',{bookId:fixture.bookId,versionId:version.id})).draft.format,'A4');
    assert.equal((await call('start_pdf_export',{bookId:fixture.bookId,key:randomUUID(),versionId:version.id})).isError,true);
    await service.approveVersion(owner,fixture.bookId,version.id);
    const exportBody={bookId:fixture.bookId,key:randomUUID(),versionId:version.id};const job=parsed(await call('start_pdf_export',exportBody));assert.equal(job.downloadUrl,null,'queued exports do not advertise a download URL');assert.equal(parsed(await call('start_pdf_export',exportBody)).id,job.id);
    const worker=createExportWorker(pool);await worker.runOnce();await worker.stop();const status=parsed(await call('get_export',{bookId:fixture.bookId,jobId:job.id}));assert.equal(status.status,'complete');
    const download=status.downloadUrl.replace(origin,base);assert.equal((await fetch(download)).status,401);assert.equal((await fetch(download,{headers:{'x-test-owner':'other-owner'}})).status,404);const pdf=await fetch(download,{headers:{Authorization:'Bearer '+accessToken}});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type')?.split(';')[0],'application/pdf');await writeFile('test-results/mcp/approved-mcp-export.pdf',Buffer.from(await pdf.arrayBuffer()));
  }finally{await client.close();}
});

test('MCP content flags: uncertain grouped reports, idempotent multi-flags, strict arguments and no owner decisions',async()=>{
  const client=new Client({name:'memorybook-review-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+accessToken}}}));
  const call=(name:string,args:Record<string,unknown>={})=>client.callTool({name,arguments:args}) as Promise<CallToolResult>;
  const parsed=(result:CallToolResult)=>{assert.equal(result.isError,undefined,JSON.stringify(result.content));assert.equal(result.content[0].type,'text');return JSON.parse((result.content[0] as {text:string}).text);};
  const rejected=async(name:string,args:Record<string,unknown>,code?:string)=>{const result=await call(name,args);assert.equal(result.isError,true,`${name} must reject`);const details=JSON.parse((result.content[0] as {text:string}).text);if(code)assert.equal(details.error,code);return details;};
  try{
    const catalog=await client.listTools(),create=catalog.tools.find(t=>t.name==='create_content_flag')!,list=catalog.tools.find(t=>t.name==='list_content_flags')!;
    assert.equal(create.annotations?.readOnlyHint,false);assert.equal(create.annotations?.idempotentHint,true);assert.equal(list.annotations?.readOnlyHint,true);
    assert.equal(create.inputSchema.additionalProperties,false);assert.equal('origin'in(create.inputSchema.properties||{}),false);assert.equal('decision'in(create.inputSchema.properties||{}),false);
    const initial=parsed(await call('list_content_flags',{bookId:fixture.bookId,status:'all'}));assert.equal(initial.pendingCount,0);assert.ok(initial.items.length>=10);
    const original=await service.getSubmission(owner,fixture.bookId,fixture.submissionIds[0]);assert.ok(original.submission);assert.ok(original.submission.message.trim());
    const body={bookId:fixture.bookId,key:randomUUID(),sourceId:fixture.submissionIds[0],categories:['possible_sexual','offensive_text'],reason:'Fiktív bizonytalan észrevétel, tulajdonosi kézi ellenőrzés szükséges.',scope:{kind:'unspecified',note:'Nem történt gépi minősítés.'}};
    const first=parsed(await call('create_content_flag',body));assert.equal(first.replayed,false);assert.ok(first.item.id);assert.equal(first.item.flags.length,2);assert.ok(first.item.flags.every((f:{origin:string})=>f.origin==='mcp'));assert.equal(Object.hasOwn(first.item,'text'),false);assert.equal(Object.hasOwn(first.item,'previewUrl'),false);assert.equal(JSON.stringify(first).includes(original.submission.message),false,'create results sanitize source bodies too');
    const firstIds=first.item.flags.map((f:{id:string})=>f.id).sort();const replay=parsed(await call('create_content_flag',body));assert.equal(replay.replayed,true);assert.equal(replay.item.id,first.item.id);assert.deepEqual(replay.item.flags.map((f:{id:string})=>f.id).sort(),firstIds);
    await rejected('create_content_flag',{...body,reason:'Eltérő kérés ugyanazzal a kulccsal.'},'IDEMPOTENCY_CONFLICT');
    const multiple=parsed(await call('create_content_flag',{...body,key:randomUUID(),categories:['possible_extremist'],scope:{kind:'partial',note:'Csak a megjelölt rész, nem végleges állítás.'}}));assert.equal(multiple.item.id,first.item.id);assert.equal(multiple.item.flags.length,3);assert.deepEqual([...multiple.item.categories].sort(),['offensive_text','possible_extremist','possible_sexual']);
    const additional=parsed(await call('create_content_flag',{...body,key:randomUUID(),categories:['offensive_text']}));assert.equal(additional.item.flags.length,3,'the same target hash, category and origin do not duplicate a flag');assert.equal(additional.replayed,true);assert.equal(additional.revision,multiple.revision);
    const media=parsed(await call('create_content_flag',{...body,key:randomUUID(),mediaId:fixture.mediaIds[0],categories:['possible_sexual']}));assert.notEqual(media.item.id,first.item.id,'a media target is distinct from source text');assert.equal(Object.hasOwn(media.item,'previewUrl'),false);
    const sameName=parsed(await call('create_content_flag',{...body,key:randomUUID(),sourceId:fixture.submissionIds[1],categories:['offensive_text']}));assert.notEqual(sameName.item.id,first.item.id,'same display names never merge source targets');
    const pending=parsed(await call('list_content_flags',{bookId:fixture.bookId,status:'pending'}));assert.equal(pending.pendingCount,3);assert.deepEqual([...pending.pendingIds].sort(),[first.item.id,media.item.id,sameName.item.id].sort());assert.equal(pending.items.length,3);
    const filtered=parsed(await call('list_content_flags',{bookId:fixture.bookId,sourceId:fixture.submissionIds[0],category:'possible_extremist'}));assert.deepEqual(filtered.items.map((item:{id:string})=>item.id),[first.item.id]);
    assert.equal(JSON.stringify(pending).includes(original.submission.message),false,'MCP review metadata must not expose a blocked source body');assert.equal(JSON.stringify(pending).includes('/api/wedding/media/'),false,'review media URLs are owner-only');
    const heldJob=(await service.listExports(owner,fixture.bookId)).exports[0];assert.ok(heldJob);const heldExport=parsed(await call('get_export',{bookId:fixture.bookId,jobId:heldJob.id}));assert.equal(heldExport.withheld,true);assert.equal(heldExport.downloadUrl,null,'withheld exports do not advertise a download URL');assert.equal(heldExport.downloadPath,null);
    for(const extra of [{origin:'manual'},{origin:'machine'},{decision:'keep'},{status:'resolved'},{ownerId:'other-owner'},{scope:{kind:'full',decision:'keep'}},{toString:'inherited-property'}])await rejected('create_content_flag',{...body,key:randomUUID(),...extra},'INVALID_ARGUMENTS');
    for(const bad of [{categories:[]},{categories:['other']},{categories:['offensive_text','offensive_text']},{reason:' '},{reason:'x'.repeat(1001)},{sourceId:'not-a-uuid'},{scope:{kind:'partial',startSeconds:20,endSeconds:10}},{scope:{kind:'full',startSeconds:86401}},{scope:{kind:'unspecified',note:'x'.repeat(1001)}},{scope:{kind:'unknown'}},{versionId:randomUUID()},{elementId:'missing_version'},{versionId:randomUUID(),elementId:'bad element'}])await rejected('create_content_flag',{...body,key:randomUUID(),...bad},'INVALID_ARGUMENTS');
    for(const bad of [{sourceId:[fixture.submissionIds[0]]},{scope:{kind:['full']}},{scope:{kind:'full',startSeconds:0}},{mediaId:fixture.mediaIds[0],versionId:randomUUID(),elementId:'element'}])await rejected('create_content_flag',{...body,key:randomUUID(),...bad},'INVALID_ARGUMENTS');
    for(const bad of [{status:'keep'},{category:'other'},{sourceId:'not-a-uuid'},{origin:'machine'},{decision:'omit'},{toString:'extra'}])await rejected('list_content_flags',{bookId:fixture.bookId,...bad},'INVALID_ARGUMENTS');
    await rejected('create_content_flag',{...body,key:randomUUID(),sourceId:fixture.submissionIds[0],mediaId:fixture.mediaIds[3]});
    await rejected('list_content_flags',{bookId:foreign.bookId});await rejected('create_content_flag',{...body,bookId:foreign.bookId,key:randomUUID(),sourceId:foreign.submissionIds[0]});
    for(const name of ['resolve_content_flag','decide_content_flag','approve_content_flag','delete_content_flag'])await rejected(name,{bookId:fixture.bookId,id:first.item.id,decision:'keep'},'UNKNOWN_TOOL');
    assert.equal((await json('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_content_flag',arguments:body}},{Authorization:'Bearer '+fixture.inviteToken,Accept:'application/json, text/event-stream'})).status,401,'guest invite never becomes review authority');
    assert.equal(parsed(await call('list_content_flags',{bookId:fixture.bookId,status:'pending'})).pendingCount,3,'invalid calls cannot change review state');
  }finally{await client.close();}
});

test('MCP review errors disclose only bounded counts, UUIDs and page numbers',()=>{
  const id=randomUUID();
  assert.deepEqual(safeReviewErrorDetails('CONTENT_REVIEW_BLOCKED',{pendingCount:2,pendingIds:[id,'sensitive text'],affectedPages:[1,3,0,301,'secret'],revision:4,sourceId:id,reason:'private',sql:'SELECT',content:{text:'private'},token:'secret'}),{pendingCount:2,pendingIds:[id],affectedPages:[1,3],revision:4,sourceId:id});
  assert.equal(safeReviewErrorDetails('UNEXPECTED_DATABASE_ERROR',{pendingCount:2,reason:'private'}),undefined);
  assert.equal(safeReviewErrorDetails('CONTENT_REVIEW_BLOCKED',{pendingCount:Infinity,revision:'private',reason:'private'}),undefined);
  assert.equal((safeReviewErrorDetails('CONTENT_REVIEW_BLOCKED',{pendingIds:Array(300).fill(id)})!.pendingIds as string[]).length,200);
});

test('transport origin, tools argument validation, refresh rotation/replay and owner revocation',async()=>{
  const rpc={jsonrpc:'2.0',id:1,method:'tools/list'};assert.equal((await json('/mcp',rpc,{Authorization:'Bearer '+accessToken,Origin:'https://evil.example',Accept:'application/json, text/event-stream'})).status,403);
  const rotated=await form('/oauth/token',{grant_type:'refresh_token',client_id:clientId,resource:origin+'/mcp',refresh_token:refreshToken});assert.equal(rotated.status,200);const next=await rotated.json();
  assert.equal((await form('/oauth/token',{grant_type:'refresh_token',client_id:clientId,resource:origin+'/mcp',refresh_token:refreshToken})).status,400);
  assert.equal((await json('/mcp',rpc,{Authorization:'Bearer '+next.access_token,Accept:'application/json, text/event-stream'})).status,401,'refresh replay revokes the grant family');
  assert.equal((await fetch(base+`/api/mcp/grants/${grantId}/revoke`,{method:'POST',headers:{'x-test-owner':'other-owner',Origin:origin}})).status,404);
  assert.equal((await fetch(base+`/api/mcp/grants/${grantId}/revoke`,{method:'POST',headers:{'x-test-owner':'owner-mcp',Origin:origin}})).status,200);
  const stored=(await pool.query('SELECT digest FROM memorybook_mcp_tokens')).rows;assert.ok(stored.every(row=>/^[a-f0-9]{64}$/.test(row.digest)));const audit=JSON.stringify((await pool.query('SELECT * FROM memorybook_mcp_audit')).rows);assert.equal(audit.includes(accessToken),false);assert.equal(audit.includes(refreshToken),false);assert.ok(audit.includes('get_media'));
});
