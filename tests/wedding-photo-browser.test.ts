import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import express from 'express';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { createWeddingRouter } from '../server/wedding/router';
import { mediaLimits } from '../server/wedding/media';

test('photo browser: camera/gallery controls, preview/remove, lost upload and submit replies, reuse, private owner display, reload reselection',async()=>{
  const connectionString=localDatabaseUrl(),schema='photo_ui_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({connectionString,options:`-c search_path=${schema}`});await migrateWedding(pool);
  const app=express();app.use('/api/wedding',createWeddingRouter({pool,media:mediaLimits(),env:{NODE_ENV:'test',WEDDING_ENABLED:'true',WEDDING_PILOT_CREATE_ENABLED:'true',WEDDING_PILOT_USER_IDS:'a'},getSession:async req=>req.get('x-owner')==='a'?{user:{id:'a'}}:null}));
  app.use(express.static(resolve('dist')));app.get(/^\/wedding(?:\/.*)?$/,(_req,res)=>res.sendFile(resolve('dist/index.html')));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
  const browser=await chromium.launch({channel:'chrome'});
  try{
    const owner=await browser.newContext({extraHTTPHeaders:{'x-owner':'a'}});await owner.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));
    const page=await owner.newPage();await page.goto(base+'/wedding');await page.getByLabel('Megjelenített nevek').fill('Fotós böngészőpróba');await page.getByLabel('Az esküvő dátuma').fill('2027-06-05');await page.getByRole('button',{name:'Vendégkönyv létrehozása',exact:true}).click();
    const link=await page.getByLabel('Beküldési link',{exact:true}).inputValue();
    const anon=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await anon.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));
    const guest=await anon.newPage();await guest.goto(link);
    await expect(guest.getByLabel('Fotó készítése',{exact:true})).toHaveAttribute('capture','environment');
    const bytes=await sharp({create:{width:80,height:40,channels:3,background:'#af4567'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const photo={name:'portrait.jpg',mimeType:'image/jpeg',buffer:bytes};
    await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(photo);
    await expect(guest.getByAltText('Kiválasztott fotó')).toBeVisible();
    await guest.getByRole('button',{name:'Kép eltávolítása',exact:true}).click();await expect(guest.getByAltText('Kiválasztott fotó')).toHaveCount(0);
    await guest.getByLabel('Fotó készítése',{exact:true}).setInputFiles(photo); // File injection, not a physical camera test.
    await guest.getByLabel('Neved',{exact:true}).fill('Teszt Éva');await guest.getByLabel('Jókívánságod',{exact:true}).fill('Fotó és árvíztűrő jókívánság');
    let uploads=0,submits=0;
    await guest.route('**/api/wedding/guest/*/media/*',async route=>{uploads++;if(uploads===1){await route.fetch();await route.abort();}else await route.continue();});
    await guest.route('**/api/wedding/guest/*/submissions',async route=>{submits++;if(submits===1){await route.fetch();await route.abort();}else await route.continue();});
    await guest.getByRole('button',{name:'Beküldés',exact:true}).click({clickCount:2});
    await expect(guest.getByRole('alert')).toContainText('Nem kaptunk biztos választ');await expect(guest.getByAltText('Kiválasztott fotó')).toBeVisible();
    await guest.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
    await expect(guest.getByRole('button',{name:'Beküldés újrapróbálása',exact:true})).toBeEnabled();
    await guest.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();
    await expect(guest.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toBeVisible();assert.equal(uploads,2);assert.equal(submits,2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_submissions')).rows[0].n,1);
    await page.getByRole('button',{name:'Frissítés',exact:true}).click();await expect(page.getByText('Fotó és árvíztűrő jókívánság',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Fotó nagyobb nézetben'}).click();await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'Vissza az üzenetekhez'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
    await guest.unrouteAll();await guest.reload();await guest.getByLabel('Neved',{exact:true}).fill('Második Éva');await guest.getByLabel('Jókívánságod',{exact:true}).fill('Megőrzött szöveg');await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(photo);
    await anon.setOffline(true);await guest.getByRole('button',{name:'Beküldés',exact:true}).click();await expect(guest.getByRole('alert')).toContainText('Nem kaptunk biztos választ');
    await anon.setOffline(false);await guest.reload();await expect(guest.getByText('A böngésző már nem őrzi a kiválasztott fájlt. Válaszd ki újra ugyanazt a képet az újrapróbáláshoz.',{exact:true})).toBeVisible();
    await expect(guest.getByLabel('Jókívánságod',{exact:true})).toHaveValue('Megőrzött szöveg');
    await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(photo);await guest.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();await expect(guest.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toBeVisible();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM event_media')).rows[0].n,2);
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
