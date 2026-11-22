import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Pool} from 'pg';
import express from 'express';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {createWeddingRouter} from '../server/wedding/router';
import {mediaLimits} from '../server/wedding/media';
import {createMediaAttemptService} from '../server/wedding/media-attempts';

test('guest delivery: incomplete acknowledgements never show success; exact retry commits once and returning owner sees the media',{timeout:90000},async()=>{
  const connectionString=localDatabaseUrl(),schema='guest_delivery_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});
  await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,server:ReturnType<typeof express.application.listen>|undefined;
  try{
    await migrateWedding(pool);const bookId=randomUUID(),token=randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,starts_on,template_id,template_version,invite_token) VALUES($1,'delivery-owner','celebration','wedding','Fiktív kézbesítési próba','[]','2026-11-22','wedding-classic',1,$2)",[bookId,token]);
    const app=express();app.use('/api/wedding',createWeddingRouter({pool,media:mediaLimits(),getSession:async request=>request.get('x-owner')==='delivery-owner'?{user:{id:'delivery-owner'}}:null,env:{NODE_ENV:'test',WEDDING_ENABLED:'true'}}));
    app.use(express.static(resolve('dist')));app.get(/^\/wedding(?:\/.*)?$/,(_request,response)=>response.sendFile(resolve('dist/index.html')));
    server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server!.once('listening',done));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
    browser=await chromium.launch({channel:'chrome'});const owner=await browser.newContext({extraHTTPHeaders:{'x-owner':'delivery-owner'}}),ownerPage=await owner.newPage();
    await ownerPage.goto(base+'/wedding/books/'+bookId);await expect(ownerPage.getByText('Még nem érkezett jókívánság.',{exact:true})).toBeVisible();
    const guest=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'hu-HU'}),page=await guest.newPage();
    await page.goto(base+'/wedding/join/'+token);await page.getByLabel('Neved',{exact:true}).fill('Fiktív telefonos vendég');await page.getByLabel('Jókívánságod',{exact:true}).fill('Megőrzendő szöveg és fotó.');
    let diagnostic:Record<string,unknown>|undefined;
    await page.route('**/media-diagnostics',async route=>{diagnostic=route.request().postDataJSON();await route.fulfill({status:202,json:{recorded:true,diagnosticId:diagnostic!.diagnosticId}});});
    await page.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles({name:'NEVER-LOG-THIS-NAME.heic',mimeType:'image/heic',buffer:Buffer.from('fake')});
    await expect(page.locator('form [role=alert]')).toContainText('képtípus most nem támogatott');
    await expect.poll(()=>diagnostic?.errorCode).toBe('CLIENT_PHOTO_TYPE');
    assert.equal(diagnostic!.source,'gallery');assert.equal(diagnostic!.mimeType,'image/heic');assert.equal(diagnostic!.byteLength,4);
    assert.equal(JSON.stringify(diagnostic).includes('NEVER-LOG'),false);assert.equal(JSON.stringify(diagnostic).includes('telefonos vendég'),false);assert.equal(JSON.stringify(diagnostic).includes(token),false);
    await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toHaveCount(0);
    const buffer=await sharp({create:{width:160,height:120,channels:3,background:'#648e75'}}).jpeg().toBuffer();
    await page.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles({name:'fictional-gallery.jpg',mimeType:'image/jpeg',buffer});
    let uploads=0,submits=0,firstBody='',uploadKey='';
    await page.route('**/api/wedding/guest/*/media/*',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}uploads++;
      const key=route.request().url().split('/').pop()!;if(!uploadKey)uploadKey=key;else assert.equal(key,uploadKey);
      assert.equal(route.request().headers()['x-media-source'],'gallery');assert.equal(route.request().headers()['x-media-mime'],'image/jpeg');
      if(uploads===1){const response=await route.fetch();const result=await response.json();await route.fulfill({status:202,json:{...result,state:'processing'}});}else await route.continue();
    });
    await page.route('**/api/wedding/guest/*/submissions',async route=>{
      submits++;const body=route.request().postData()!;if(!firstBody)firstBody=body;else assert.equal(body,firstBody);
      if(submits===1)await route.fulfill({status:202,json:{accepted:false,state:'processing'}});
      else if(submits===2)await route.fulfill({status:200,json:{accepted:true,state:'committed',submissionId:randomUUID(),mediaId:null}});
      else await route.continue();
    });
    await page.getByRole('button',{name:'Beküldés',exact:true}).click();
    await expect(page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true})).toBeVisible();assert.equal(submits,0);
    await ownerPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const pending=ownerPage.getByRole('region',{name:'Feltöltések feldolgozása',exact:true});await expect(pending.getByRole('heading',{name:'Fotó · Feltöltve, vendégbeküldésre vár',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
    await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true})).toBeVisible();
    await expect(page.getByLabel('Neved',{exact:true})).toHaveValue('Fiktív telefonos vendég');await expect(page.getByAltText('Kiválasztott fotó',{exact:true})).toBeVisible();
    await expect(page.locator('form [role=alert]')).toContainText('Nem kaptunk biztos választ');
    await mkdir('test-results/guest-delivery',{recursive:true});await page.screenshot({path:'test-results/guest-delivery/mobile-unconfirmed.png',fullPage:true});
    assert.equal(Number((await pool.query('SELECT count(*) n FROM event_submissions')).rows[0].n),0);
    await page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
    await expect(page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true})).toBeEnabled();
    await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
    await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toBeVisible();
    const rows=(await pool.query('SELECT id FROM event_submissions')).rows;assert.equal(rows.length,1);assert.equal(uploads,2);assert.equal(submits,3);
    await expect(page.getByText(rows[0].id,{exact:true})).toBeVisible();
    assert.equal(Number((await pool.query("SELECT count(*) n FROM event_media WHERE state='attached'")).rows[0].n),1);
    // This owner page remains open while another guest context submits. No focus,
    // reload or manual refresh is used: the visible-page interval must find it.
    await expect(ownerPage.getByRole('heading',{name:'Fiktív telefonos vendég',exact:true})).toBeVisible({timeout:15000});
    await expect(ownerPage.getByRole('img',{name:'Fotó nagyobb nézetben',exact:true})).toBeVisible();
    const caps=await (await guest.request.get(base+'/api/wedding/guest/'+token)).json();assert.equal(caps.media.used.photo,1);assert.equal(caps.media.remaining.photo,9);
    // Inject a real, durably stored processing interruption. The owner UI retries
    // through the actual API/decoder; it must never invent a guest submission.
    const device=(await pool.query('SELECT guest_device_id FROM event_submissions WHERE id=$1',[rows[0].id])).rows[0].guest_device_id;
    let interrupt:(reason:Error)=>void=()=>{};
    const decoding=new Promise<never>((_resolve,reject)=>{interrupt=reject;});
    const attempts=createMediaAttemptService(pool,mediaLimits(),async()=>decoding);
    const retryKey=randomUUID(),lease=await attempts.begin(bookId,retryKey,device,'photo',{source:'gallery',mime:'image/jpeg'});
    const processing=attempts.process(lease,buffer);const interrupted=assert.rejects(processing);
    await expect.poll(async()=>(await pool.query('SELECT state FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0].state).toBe('processing');
    await ownerPage.getByRole('button',{name:'Feltöltési állapotok frissítése',exact:true}).click();
    await expect(pending.getByRole('heading',{name:'Fotó · Feldolgozás alatt',exact:true})).toBeVisible();
    interrupt(new Error('synthetic decoder interruption'));await interrupted;
    assert.equal((await pool.query('SELECT state FROM event_media_attempts WHERE id=$1',[lease.id])).rows[0].state,'failed');
    await expect(pending.getByRole('heading',{name:'Fotó · A feldolgozás nem sikerült',exact:true})).toBeVisible({timeout:6000});
    await pending.screenshot({path:'test-results/guest-delivery/owner-failed-attempt.png'});
    await pending.getByRole('button',{name:'Feldolgozás újrapróbálása',exact:true}).click();
    await expect(pending.getByRole('status')).toContainText('A vendégnek még véglegesítenie kell');
    await expect(pending.getByRole('heading',{name:'Fotó · Feltöltve, vendégbeküldésre vár',exact:true})).toBeVisible();
    const retried=(await pool.query('SELECT a.id,a.state,m.original_bytes FROM event_media_attempts a JOIN event_media m ON m.id=a.media_id WHERE a.id=$1',[lease.id])).rows[0];
    assert.equal(retried.id,lease.id);assert.equal(retried.state,'uploaded');assert.ok(retried.original_bytes.equals(buffer));
    assert.equal(Number((await pool.query('SELECT count(*) n FROM event_submissions')).rows[0].n),1);
    const recovered=await (await guest.request.get(base+'/api/wedding/guest/'+token+'/media/'+retryKey)).json();assert.equal(recovered.state,'uploaded');
  }finally{
    await browser?.close();if(server){server.closeAllConnections();await new Promise<void>(done=>server!.close(()=>done()));}
    await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
