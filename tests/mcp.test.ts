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
import {createMemorybookMcpRouter} from '../server/mcp/server';
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
    const tools=await client.listTools();assert.equal(tools.tools.length,13);assert.equal(tools.tools.some(t=>/approve|shell|sql|fetch_url/.test(t.name)),false);
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
    const exportBody={bookId:fixture.bookId,key:randomUUID(),versionId:version.id};const job=parsed(await call('start_pdf_export',exportBody));assert.equal(parsed(await call('start_pdf_export',exportBody)).id,job.id);
    const worker=createExportWorker(pool);await worker.runOnce();await worker.stop();const status=parsed(await call('get_export',{bookId:fixture.bookId,jobId:job.id}));assert.equal(status.status,'complete');
    const download=status.downloadUrl.replace(origin,base);assert.equal((await fetch(download)).status,401);assert.equal((await fetch(download,{headers:{'x-test-owner':'other-owner'}})).status,404);const pdf=await fetch(download,{headers:{Authorization:'Bearer '+accessToken}});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type')?.split(';')[0],'application/pdf');await writeFile('test-results/mcp/approved-mcp-export.pdf',Buffer.from(await pdf.arrayBuffer()));
  }finally{await client.close();}
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
