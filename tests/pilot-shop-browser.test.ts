import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import express from 'express';
import { chromium, webkit, expect } from '@playwright/test';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { migratePilot, issueInvite, redeemInvite, cookieName } from '../server/pilot/auth';
import { createCommerceAuth } from '../server/pilot/commerce-auth';
import { createPilotApp } from '../server/pilot/app';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
const {PNG}=createRequire(import.meta.url)('pngjs');
for(const engine of ['chromium','webkit'] as const)test(`${engine}: mobile store, account, lost checkout reply, resumed book, QR and anonymous guest submission`,async()=>{
  const connectionString=localDatabaseUrl(),schema='shop_ui_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});await migrateWedding(pool);await migratePilot(pool);
  const app=express(),server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base='http://127.0.0.1:'+addr.port;const auth=await createCommerceAuth(pool,base);app.use(createPilotApp(pool,base,auth));
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'hu-HU'}),p=await context.newPage();
    const invite=await issueInvite(pool),opToken=await redeemInvite(pool,invite.token);const codeResponse=await context.request.post(base+'/api/shop/operator/codes',{headers:{Origin:base,Cookie:cookieName+'='+opToken},data:{days:7}});assert.equal(codeResponse.status(),201);const {code}=await codeResponse.json();
    await p.goto(base);await expect(p.getByRole('heading',{name:/Az esküvőtök története/})).toBeVisible();await p.screenshot({path:`test-results/shop-${engine}-mobile.png`,fullPage:true});
    if(engine==='chromium'){await p.setViewportSize({width:1280,height:900});await p.screenshot({path:'test-results/shop-desktop.png',fullPage:true});await p.setViewportSize({width:390,height:844});}
    await p.getByRole('link',{name:/Esküvői könyvet választok/}).click();await expect(p.getByText('Kiválasztva: Esküvői emlékkönyv · tesztvásárlás 0 Ft')).toBeVisible();await p.getByRole('button',{name:'Új fiókot hozok létre',exact:true}).click();
    const email='shop-'+randomUUID()+'@example.test',password='Fiktiv-'+randomUUID();await p.getByLabel('E-mail',{exact:true}).fill(email);await p.getByLabel('Jelszó',{exact:true}).fill(password);await p.getByRole('button',{name:'Regisztrálok',exact:true}).click();
    await expect(p.getByRole('heading',{name:'Legyen saját könyvetek',exact:true})).toBeVisible();
    await p.getByLabel('Számlázási név',{exact:true}).fill('Fiktív Anna');await p.getByLabel('Irányítószám',{exact:true}).fill('1111');await p.getByLabel('Település',{exact:true}).fill('Tesztváros');await p.getByLabel('Utca, házszám',{exact:true}).fill('Minta utca 1.');await p.getByLabel('Egyszer használható tesztkód',{exact:true}).fill(code);await p.getByRole('checkbox').check();await p.screenshot({path:`test-results/shop-${engine}-checkout.png`,fullPage:true});
    let dropped=false;await p.route('**/api/shop/orders',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort();}else await route.continue();});
    await p.getByRole('button',{name:'Tesztvásárlás befejezése',exact:true}).click({clickCount:2});await expect(p.getByRole('alert')).toBeVisible();
    await p.getByRole('button',{name:'Tesztvásárlás befejezése',exact:true}).click();await expect(p.getByRole('heading',{name:'Tedd személyessé',exact:true})).toBeVisible();
    assert.equal((await pool.query('SELECT count(*)::int n FROM pilot_test_orders')).rows[0].n,1);
    await p.goto(base+'/pilot/books');await p.getByRole('link',{name:'Személyre szabás folytatása',exact:true}).click();
    await p.getByLabel('Könyv neve',{exact:true}).fill('Anna és Bence tesztkönyve');await p.getByLabel('A pár megjelenített nevei',{exact:true}).fill('Anna és Bence');await p.screenshot({path:`test-results/shop-${engine}-setup.png`,fullPage:true});
    let bookDropped=false;await p.route('**/api/shop/orders/*/book',async route=>{if(!bookDropped){bookDropped=true;await route.fetch();await route.abort();}else await route.continue();});
    await p.getByRole('button',{name:'Könyv mentése és QR megnyitása',exact:true}).click();await expect(p.getByRole('alert')).toBeVisible();await p.getByRole('button',{name:'Könyv mentése és QR megnyitása',exact:true}).click();
    await expect(p.getByRole('img',{name:'Vendégoldal QR-kódja',exact:true})).toBeVisible();const link=await p.getByLabel('Vendégoldal linkje',{exact:true}).inputValue();assert.ok(link.startsWith(base+'/wedding/join/'));assert.equal(new URL(link).search,'');
    const actual=await p.getByRole('img',{name:'Vendégoldal QR-kódja',exact:true}).getAttribute('src'),expected=await QRCode.toDataURL(link,{width:640,margin:4,errorCorrectionLevel:'M'});
    assert.ok(PNG.sync.read(Buffer.from(actual!.split(',')[1],'base64')).data.equals(PNG.sync.read(Buffer.from(expected.split(',')[1],'base64')).data));
    const download=p.waitForEvent('download');await p.getByRole('link',{name:'QR letöltése',exact:true}).click();assert.equal((await download).suggestedFilename(),'memorybook-vendeg-qr.png');
    await p.emulateMedia({media:'print'});await expect(p.locator('.shop-print-sheet')).toBeVisible();await expect(p.locator('.shop-nav')).toBeHidden();await p.emulateMedia({media:'screen'});
    const anon=await browser.newContext({locale:'hu-HU'}),guest=await anon.newPage();await guest.goto(link);await guest.getByLabel('Neved',{exact:true}).fill('Fiktív Vendég');await guest.getByLabel('Jókívánságod',{exact:true}).fill('Az új könyv első emléke.');await guest.getByRole('button',{name:'Beküldés',exact:true}).click();await expect(guest.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toBeVisible();
    await p.getByRole('link',{name:'Beérkezett emlékek megnyitása',exact:true}).click();await expect(p.getByText('Az új könyv első emléke.',{exact:true})).toBeVisible();assert.equal((await pool.query('SELECT count(*)::int n FROM event_books')).rows[0].n,1);
    const second=await browser.newContext({locale:'hu-HU'}),other=await second.newPage();await other.goto(base+'/pilot/account');await other.getByLabel('E-mail',{exact:true}).fill(email);await other.getByLabel('Jelszó',{exact:true}).fill(password);await other.getByRole('button',{name:'Belépek',exact:true}).click();await expect(other.getByRole('heading',{name:'Anna és Bence tesztkönyve',exact:true})).toBeVisible();
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
