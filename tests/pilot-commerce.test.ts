import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { migratePilot, issueInvite, digest, cookieName } from '../server/pilot/auth';
import { createCommerceAuth, decryptTestMail } from '../server/pilot/commerce-auth';
import type { CommerceAuth } from '../server/pilot/commerce-auth';
import { createPilotApp } from '../server/pilot/app';
const connectionString=localDatabaseUrl(),schema='commerce_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
let server:Server,base:string,operator:string,a:string,b:string,config:CommerceAuth;
const password='Fiktiv-Jelszo-'+randomUUID();
const bill={kind:'person',name:'Fiktív Tesztelő',postalCode:'1111',city:'Tesztváros',address:'Minta utca 1.'};
const cookies=(r:Response)=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function call(path:string,data?:unknown,cookie=''){return fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:base,...(data===undefined?{}:{'Content-Type':'application/json'}),Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});}
async function code(){const r=await call('/api/shop/operator/codes',{days:7},operator);assert.equal(r.status,201);return r.json();}
async function order(codeValue:string,cookie=a,key=randomUUID()){return call('/api/shop/orders',{code:codeValue,idempotencyKey:key,productId:'wedding',billing:bill},cookie);}
async function bought(){const c=await code(),r=await order(c.code);assert.equal(r.status,201);return (await r.json()).orderId as string;}
async function details(id:string,cookie=a){return (await call('/api/shop/orders/'+id,undefined,cookie)).json();}
async function makeBook(id:string,date?:string){const d=await details(id);const r=await call('/api/shop/orders/'+id+'/book',{title:'Fiktív könyv',names:'Anna és Bence',date:date||d.order.purchase_day,appearance:'wedding-classic'},a);assert.equal(r.status,200);return (await details(id)).book;}
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrateWedding(pool);await migratePilot(pool);const app=express();server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');base='http://127.0.0.1:'+addr.port;config=await createCommerceAuth(pool,base);app.use(createPilotApp(pool,base,config));
  const invite=await issueInvite(pool),redemption=await call('/api/pilot/redeem',{token:invite.token});operator=cookies(redemption);assert.ok(operator.startsWith(cookieName));
  for(const email of ['a@example.test','b@example.test']){const r=await call('/api/auth/sign-up/email',{name:'Fiktív',email,password});assert.equal(r.status,200,await r.clone().text());if(email.startsWith('a'))a=cookies(r);else b=cookies(r);}
});
after(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('existing Better Auth accounts, private operator tools and test-only email verification/reset',async()=>{
  assert.equal((await call('/api/shop/operator/codes',undefined,a)).status,403);assert.equal((await call('/api/shop/operator/codes',{days:7})).status,403);
  assert.equal((await order((await code()).code,'')).status,401);
  assert.equal((await call('/api/wedding/books',{names:'Free bypass',date:'2027-01-01'},a)).status,403);
  assert.equal((await call('/api/shop/operator/mail?email=a@example.test',undefined,a)).status,403);
  const verification=(await pool.query("SELECT encrypted_url FROM pilot_test_mail WHERE recipient='a@example.test' AND kind='verification'")).rows[0];assert.ok(verification);
  assert.ok(!verification.encrypted_url.includes('http'));
  const verifyUrl=decryptTestMail(config.secret,verification.encrypted_url);assert.ok(verifyUrl.startsWith(base));
  const verified=await fetch(verifyUrl,{redirect:'manual'});assert.ok([200,302].includes(verified.status));
  assert.equal((await pool.query("SELECT email_verified FROM users WHERE email='a@example.test'")).rows[0].email_verified,true);
  const request=await call('/api/auth/request-password-reset',{email:'b@example.test',redirectTo:base+'/pilot/account'});assert.equal(request.status,200);
  const reset=(await pool.query("SELECT encrypted_url FROM pilot_test_mail WHERE recipient='b@example.test' AND kind='reset'")).rows[0];assert.ok(reset);
  const link=await fetch(decryptTestMail(config.secret,reset.encrypted_url),{redirect:'manual'});const location=link.headers.get('location')!;const token=new URL(location,base).searchParams.get('token');assert.ok(token);
  const change=await call('/api/auth/reset-password',{token,newPassword:password+'-new'});assert.equal(change.status,200);
  assert.equal((await call('/api/auth/reset-password',{token,newPassword:password})).status,400);
  assert.equal((await call('/api/shop/orders',undefined,b)).status,401);
  const login=await call('/api/auth/sign-in/email',{email:'b@example.test',password:password+'-new'});assert.equal(login.status,200);b=cookies(login);
});
test('pilot password: rejects three, accepts four identical characters, repeat login and longer passwords',async()=>{
  const email='short@example.test';
  const rejected=await call('/api/auth/sign-up/email',{name:'Fiktív',email,password:'aaa'});
  assert.equal(rejected.status,400);assert.equal((await rejected.json()).code,'PASSWORD_TOO_SHORT');
  const registered=await call('/api/auth/sign-up/email',{name:'Fiktív',email,password:'aaaa'});assert.equal(registered.status,200);
  assert.equal((await call('/api/auth/sign-out',{},cookies(registered))).status,200);
  for(let i=0;i<2;i++)assert.equal((await call('/api/auth/sign-in/email',{email,password:'aaaa'})).status,200);
  assert.equal((await call('/api/auth/sign-in/email',{email:'a@example.test',password})).status,200);
});
test('valid, expired, revoked, replayed and competing code claims; one entitlement',async()=>{
  const c=await code(),k=randomUUID();const results=await Promise.all([order(c.code,a,k),order(c.code,a,k)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);const ids=await Promise.all(results.map(r=>r.json()));assert.equal(ids[0].orderId,ids[1].orderId);
  assert.equal((await order(c.code,b)).status,409);assert.equal((await order(c.code,a)).status,200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM pilot_book_entitlements WHERE order_id=$1',[ids[0].orderId])).rows[0].n,1);
  const duel=await code();const competing=await Promise.all([order(duel.code,a),order(duel.code,b)]);assert.deepEqual(competing.map(r=>r.status).sort(),[201,409]);
  const expired=await code();await pool.query("UPDATE pilot_test_codes SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE id=$1",[expired.id]);assert.equal((await order(expired.code)).status,400);
  const revoked=await code();await call('/api/shop/operator/codes/'+revoked.id+'/revoke',{},operator);assert.equal((await order(revoked.code)).status,400);
  assert.equal((await order('MB-'+'x'.repeat(32))).status,400);
  assert.equal((await pool.query('SELECT code_hash FROM pilot_test_codes WHERE id=$1',[c.id])).rows[0].code_hash,digest(c.code));
});
test('purchase recovery, exactly one personalized book, user isolation and immutable maximum date',async()=>{
  const id=await bought(),d=await details(id);assert.equal(d.book,null);
  assert.ok((await(await call('/api/shop/orders',undefined,a)).json()).orders.some((o:{id:string})=>o.id===id));
  assert.equal((await call('/api/shop/orders/'+id,undefined,b)).status,404);
  const body={title:'Egyetlen könyv',names:'Fiktív pár',date:d.order.purchase_day,appearance:'wedding-classic'};
  const rr=await Promise.all([call('/api/shop/orders/'+id+'/book',body,a),call('/api/shop/orders/'+id+'/book',body,a)]);assert.deepEqual(rr.map(r=>r.status),[200,200]);const ids=await Promise.all(rr.map(r=>r.json()));assert.equal(ids[0].bookId,ids[1].bookId);
  assert.equal((await call('/api/wedding/books/'+ids[0].bookId,undefined,b)).status,404);
  assert.equal((await call('/api/shop/orders/'+id+'/book',{...body,date:'2099-01-01'},a)).status,400);
  const nextDay=new Date(Date.parse(d.order.purchase_day)+86400000).toISOString().slice(0,10);assert.equal((await call('/api/shop/orders/'+id+'/book',{...body,date:nextDay},a)).status,409);
  await call('/api/wedding/books/'+ids[0].bookId+'/close',{},a);
  assert.equal((await call('/api/shop/orders/'+id+'/book',{...body,title:'Javított cím'},a)).status,200);
  assert.equal((await call('/api/shop/orders/'+id+'/finalize',{},a)).status,200);
  assert.equal((await call('/api/shop/orders/'+id+'/book',body,a)).status,409);
});
test('Budapest inclusive start/exclusive end, daylight saving, operator clock and legacy preservation',async()=>{
  const id=await bought(),d=await details(id);const year=Number(d.order.purchase_day.slice(0,4))+1;const date=year+'-03-28';const book=await makeBook(id,date);
  assert.equal(new Date(book.submission_start).toISOString(),year+'-03-17T23:00:00.000Z');assert.equal(new Date(book.submission_end).toISOString(),year+'-04-04T22:00:00.000Z');
  const endpoint='/api/wedding/guest/'+book.guest_url.split('/').pop();
  assert.equal((await call('/api/shop/operator/clock',{bookId:book.id,now:book.submission_start},a)).status,403);
  for(const [now,state]of [[new Date(new Date(book.submission_start).getTime()-1).toISOString(),'early'],[book.submission_start,'open'],[book.submission_end,'ended']]){
    assert.equal((await call('/api/shop/operator/clock',{bookId:book.id,now},operator)).status,200);const guest=await call(endpoint);assert.equal((await guest.json()).event.access_state,state);
    const submit=await call(endpoint+'/submissions',{name:'Fiktív',message:'Időpróba',idempotencyKey:randomUUID()},cookies(guest));assert.equal(submit.status,state==='open'?201:410);
  }
  await call('/api/wedding/books/'+book.id+'/close',{},a);await call('/api/shop/operator/clock',{bookId:book.id,now:book.submission_start},operator);assert.equal((await(await call(endpoint)).json()).event.access_state,'closed');
});
test('ten photo quota per guest browser, retries free, text remains possible',async()=>{
  const id=await bought(),book=await makeBook(id);const endpoint='/api/wedding/guest/'+book.guest_url.split('/').pop();const guest=await call(endpoint);const device=cookies(guest);assert.ok(device.includes('memorybook-guest-device'));
  const bytes=await sharp({create:{width:20,height:20,channels:3,background:'#abcdef'}}).png().toBuffer();
  for(let i=0;i<11;i++){
    const key=randomUUID();const uploaded=await fetch(base+endpoint+'/media/'+key,{method:'POST',headers:{Origin:base,'Content-Type':'application/octet-stream',Cookie:device},body:new Uint8Array(bytes)});assert.equal(uploaded.status,201);
    const body={name:'Fiktív',message:'Fotó '+i,idempotencyKey:key,mediaId:(await uploaded.json()).mediaId};const sent=await call(endpoint+'/submissions',body,device);assert.equal(sent.status,i<10?201:413);
    if(i===0)assert.equal((await call(endpoint+'/submissions',body,device)).status,200);
  }
  assert.equal((await call(endpoint+'/submissions',{name:'Fiktív',message:'Csak szöveg',idempotencyKey:randomUUID()},device)).status,201);
});

test('company manual billing, server-owned account email/zero HUF and invalid product never consume code',async()=>{
  const c=await code(),idempotencyKey=randomUUID();
  const body={code:c.code,idempotencyKey,productId:'graduation',amount:24900,currency:'EUR',billing:{...bill,kind:'company',taxNumber:'12345678-1-12',email:'forged@example.test',country:'US'}};
  assert.equal((await call('/api/shop/orders',body,a)).status,400);
  assert.equal((await call('/api/shop/orders',{...body,productId:'wedding',billing:{...body.billing,taxNumber:'wrong'}},a)).status,400);
  assert.equal((await pool.query('SELECT used_at FROM pilot_test_codes WHERE id=$1',[c.id])).rows[0].used_at,null);
  const ok=await call('/api/shop/orders',{...body,productId:'wedding'},a);assert.equal(ok.status,201);const id=(await ok.json()).orderId;
  const stored=(await pool.query('SELECT billing,amount,currency,status,package_snapshot FROM pilot_test_orders WHERE id=$1',[id])).rows[0];
  assert.equal(stored.billing.email,'a@example.test');assert.equal(stored.billing.country,'HU');assert.equal(stored.amount,0);assert.equal(stored.currency,'HUF');assert.equal(stored.status,'test_completed');assert.equal(stored.package_snapshot.perDevice.photos,10);
});
