import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import express from 'express';
import sharp from 'sharp';
import { chromium, webkit, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { createWeddingRouter } from '../server/wedding/router';
import { mediaLimits } from '../server/wedding/media';

async function stroke(page:Page) {
  const area=page.getByRole('img',{name:'Rajzfelület',exact:true});await area.scrollIntoViewIfNeeded();const b=await area.boundingBox();assert.ok(b);
  await page.mouse.move(b.x+b.width*.2,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.8,b.y+b.height*.7,{steps:6});await page.mouse.up();
}
for(const engine of ['chromium','webkit'] as const) test(`${engine}: drawing tools, cancel/reopen, resize, replacement, retry, owner Refresh loads composite without navigation`,async()=>{
  const connectionString=localDatabaseUrl(),schema='ink_ui_'+randomUUID().replaceAll('-','');
  const admin=new Pool({connectionString});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema}`});await migrateWedding(pool);
  const app=express();app.use('/api/wedding',createWeddingRouter({pool,media:mediaLimits(),env:{NODE_ENV:'test',WEDDING_ENABLED:'true',WEDDING_PILOT_CREATE_ENABLED:'true',WEDDING_PILOT_USER_IDS:'a'},getSession:async req=>req.get('x-owner')==='a'?{user:{id:'a'}}:null}));
  app.use(express.static(resolve('dist')));app.get(/^\/wedding(?:\/.*)?$/,(_req,res)=>res.sendFile(resolve('dist/index.html')));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base='http://127.0.0.1:'+addr.port;
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try{
    const owner=await browser.newContext({locale:'hu-HU',extraHTTPHeaders:{'x-owner':'a'}}),page=await owner.newPage();await page.goto(base+'/wedding');await page.getByLabel('Megjelenített nevek').fill('Rajzos próba');await page.getByLabel('Az esküvő dátuma').fill('2027-06-05');await page.getByRole('button',{name:'Vendégkönyv létrehozása',exact:true}).click();
    const link=await page.getByLabel('Beküldési link',{exact:true}).inputValue();
    const ctx=await browser.newContext({locale:'hu-HU',viewport:{width:390,height:844},isMobile:true,hasTouch:true});const guest=await ctx.newPage();await guest.goto(link);
    const jpeg=await sharp({create:{width:800,height:400,channels:3,background:'#aaaaaa'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const portrait={name:'portrait.jpg',mimeType:'image/jpeg',buffer:jpeg};
    await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(portrait);
    await guest.getByRole('button',{name:'Írás / rajzolás a képre',exact:true}).click();
    const area=guest.getByRole('img',{name:'Rajzfelület',exact:true});await expect(area).toHaveCSS('touch-action','none');
    await guest.getByRole('button',{name:'Piros',exact:true}).click();await guest.getByRole('button',{name:'Vastag',exact:true}).click();await stroke(guest);
    await expect(area.locator('path')).toHaveCount(1);const path=await area.locator('path').getAttribute('d');
    const start=path!.match(/^M([\d.]+) ([\d.]+)/)!;
    // WebKit rounds synthetic mouse coordinates to CSS pixels.
    assert.ok(Math.abs(Number(start[1])-200)<4 && Math.abs(Number(start[2])-600)<4);
    await guest.screenshot({path:`test-results/drawing-${engine}-editor.png`,fullPage:false});
    await guest.setViewportSize({width:844,height:390});assert.equal(await area.locator('path').getAttribute('d'),path);
    await guest.getByRole('button',{name:'Visszavonás',exact:true}).click();await expect(area.locator('path')).toHaveCount(0);
    await guest.getByRole('button',{name:'Újra',exact:true}).click();await expect(area.locator('path')).toHaveCount(1);
    await guest.getByRole('button',{name:'Kész',exact:true}).click();await expect(guest.getByRole('dialog')).toHaveCount(0);await expect(guest.locator('.wedding-annotated-preview path')).toHaveCount(1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM event_submissions')).rows[0].n,0);
    await guest.getByRole('button',{name:'Írás / rajzolás a képre',exact:true}).click();await stroke(guest);await expect(area.locator('path')).toHaveCount(2);await guest.getByRole('button',{name:'Mégse',exact:true}).click();await expect(guest.locator('.wedding-annotated-preview path')).toHaveCount(1);
    await guest.getByRole('button',{name:'Írás / rajzolás a képre',exact:true}).click();guest.once('dialog',d=>d.dismiss());await guest.getByRole('button',{name:'Rajz törlése',exact:true}).click();await expect(area.locator('path')).toHaveCount(1);
    guest.once('dialog',d=>d.accept());await guest.getByRole('button',{name:'Rajz törlése',exact:true}).click();await expect(area.locator('path')).toHaveCount(0);await guest.getByRole('button',{name:'Visszavonás',exact:true}).click();await guest.getByRole('button',{name:'Kész',exact:true}).click();
    const png=await sharp({create:{width:800,height:400,channels:3,background:'#aaaaaa'}}).png().toBuffer(),landscape={name:'landscape.png',mimeType:'image/png',buffer:png};
    guest.once('dialog',d=>d.dismiss());await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(landscape);await expect(guest.locator('.wedding-annotated-preview path')).toHaveCount(1);
    guest.once('dialog',d=>d.accept());await guest.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles(landscape);await expect(guest.locator('.wedding-annotated-preview path')).toHaveCount(0);
    await guest.setViewportSize({width:390,height:844});await guest.getByRole('button',{name:'Írás / rajzolás a képre',exact:true}).click();await stroke(guest);await guest.getByRole('button',{name:'Kész',exact:true}).click();
    await guest.getByLabel('Neved',{exact:true}).fill('Fiktív Rajzoló');await guest.getByLabel('Jókívánságod',{exact:true}).fill('Rajzos árvíztűrő üzenet');
    let uploads=0,sends=0;guest.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/media/'))uploads++;});
    await guest.route('**/submissions',async route=>{sends++;if(sends===1){await route.fetch();await route.abort();}else await route.continue();});
    await guest.getByRole('button',{name:'Beküldés',exact:true}).click({clickCount:2});await expect(guest.getByRole('alert')).toContainText('Nem kaptunk biztos választ');
    await expect(guest.getByLabel('Jókívánságod',{exact:true})).toHaveValue('Rajzos árvíztűrő üzenet');await expect(guest.locator('.wedding-annotated-preview path')).toHaveCount(1);
    await guest.getByRole('button',{name:'Beküldés újrapróbálása',exact:true}).click();await expect(guest.getByText('Köszönjük! A jókívánságod megérkezett.',{exact:true})).toBeVisible();assert.equal(uploads,1);assert.equal(sends,2);
    let navigations=0;page.on('framenavigated',()=>navigations++);await page.getByRole('button',{name:'Frissítés',exact:true}).click();await expect(page.getByText('Rajzos árvíztűrő üzenet',{exact:true})).toBeVisible();
    const image=page.locator('.wedding-photo-open img');await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(0);assert.equal(navigations,0);
    await page.getByRole('button',{name:'Fotó nagyobb nézetben',exact:true}).click();await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();await page.getByRole('button',{name:'Eredeti fotó megtekintése',exact:true}).click();await expect(page.getByRole('dialog').getByRole('img')).toHaveAttribute('src',/\/original$/);
    const stored=(await pool.query('SELECT m.original_bytes,a.layer FROM event_media m JOIN event_media_annotations a ON a.media_id=m.id')).rows;assert.equal(stored.length,1);assert.deepEqual(stored[0].original_bytes,png);assert.equal(stored[0].layer.strokes.length,1);
    await guest.screenshot({path:`test-results/drawing-${engine}-success.png`,fullPage:true});
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

