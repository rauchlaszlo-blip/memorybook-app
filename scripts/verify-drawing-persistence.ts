import { webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const {origin,phoneBook}=JSON.parse(await readFile('test-results/internet-verification.json','utf8'));
assert.match(origin,/^https:\/\/memorybook-wedding-text-pilot-[a-z0-9]+\.onrender\.com$/);
const saved=JSON.parse(await readFile('test-results/drawing-verification.json','utf8'));
const browser=await webkit.launch();
try {
  const owner=await browser.newContext({locale:'hu-HU',storageState:'test-results/internet-owner-state.local'});
  for(const [variant,hash] of [['original',saved.originalSha256],['display',saved.displaySha256]]){
    const r=await owner.request.get(`${origin}/api/wedding/media/${saved.mediaId}/${variant}`);assert.equal(r.status(),200);assert.equal(createHash('sha256').update(await r.body()).digest('hex'),hash);
  }
  const layer=await owner.request.get(`${origin}/api/wedding/media/${saved.mediaId}/annotation`);assert.equal(layer.status(),200);assert.deepEqual(await layer.json(),saved.layer);
  const detail=await(await owner.request.get(`${origin}/api/wedding/books/${saved.bookId}`)).json();assert.equal(detail.submissions.length,1);assert.equal(detail.submissions[0].media[0].id,saved.mediaId);
  const anon=await browser.newContext({locale:'hu-HU',viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await anon.newPage();await p.goto(phoneBook.guest_url);
  await expect(p.getByLabel('Neved',{exact:true})).toBeVisible();
  const image=await owner.request.get(`${origin}/api/wedding/media/${saved.mediaId}/original`);
  await p.getByLabel('Kép kiválasztása',{exact:true}).setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:await image.body()});
  await p.getByRole('button',{name:'Írás / rajzolás a képre',exact:true}).click();await expect(p.getByRole('button',{name:'Fekete',exact:true})).toBeFocused();
  await expect(p.getByRole('button',{name:'Fekete',exact:true})).toBeInViewport();
  await p.getByRole('button',{name:'Mégse',exact:true}).click();await expect(p.getByRole('dialog')).toHaveCount(0);
  console.log('PASS: original checksum, composite checksum, editable layer and single submission persist across real Render redeploy; existing guest link and editor focus work. No new submission made.');
}finally{await browser.close();}
