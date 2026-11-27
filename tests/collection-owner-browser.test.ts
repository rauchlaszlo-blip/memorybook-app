// UI contract tests with mocked authenticated APIs; server authorization is tested separately.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import express from 'express';
import {chromium,expect} from '@playwright/test';

const bookId='owner-collection-fixture',prefix=`/api/my/books/${bookId}/collection`;
const e1='11111111-1111-4111-8111-111111111111',e2='22222222-2222-4222-8222-222222222222',l1='33333333-3333-4333-8333-333333333333';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function data(){
  const settings={revision:1,events:[{id:e1,label:'Ceremónia',order:0},{id:e2,label:'Vacsora',order:1}],locations:[{id:l1,label:'Kert',order:0}]};
  const file=(id:string,kind:string)=>({id,kind,fileName:`Fiktív ${kind}`,byteLength:12000,state:'ready',provenance:'original_bytes_verified',actualMimeType:kind==='photo'?'image/png':`${kind}/mp4`,durationSeconds:kind==='photo'?null:2,captureTime:id==='photo-a'?'2026-11-26T14:23:45':null,captureTimeSource:id==='photo-a'?'exif.local-timezone-unknown':null,uploadedAt:'2026-11-25T12:00:00Z',originalUrl:`${prefix}/files/${id}/original`,previewUrl:kind==='photo'?`${prefix}/files/${id}/preview`:null,playbackUrl:kind==='photo'?null:`${prefix}/files/${id}/playback`});
  const common={createdAt:'2026-11-25T12:00:00Z',updatedAt:'2026-11-25T12:00:00Z',guestData:{},eventIds:[e1],locationIds:[l1],events:[{id:e1,label:'Korábbi ceremónianév',order:0}],locations:settings.locations};
  return{book:{id:bookId,title:'Fiktív teljes gyűjtemény'},settings,sessions:[
    {...common,groupId:'session-a',state:'submitted',submissionId:'submitted-a',committedAt:'2026-11-25T12:01:00Z',sender:'Ágnes',canvasData:{objects:[{type:'IText',text:'Őrzött eredeti szöveg <script>nem kód</script>'}]},previewUrl:`${prefix}/sessions/session-a/preview`,files:[file('photo-a','photo'),file('video-a','video'),file('audio-a','audio')]},
    {...common,groupId:'session-b',state:'draft',sender:'Béla',canvasData:{objects:[]},previewUrl:null,files:[{...file('video-b','video'),state:'processing',playbackUrl:null,originalUrl:null}]},
    {...common,groupId:'session-c',state:'draft',sender:'Csilla',canvasData:{objects:[]},previewUrl:null,files:[{...file('photo-c','photo'),state:'failed',errorCode:'MEDIA_INVALID',previewUrl:null,retryAvailable:true}]},
  ],legacy:{pages:[{id:'legacy-page',pageNumber:4,state:'submitted',canvasData:{objects:[{type:'IText',text:'Korábbi megőrzött oldal'}]},previewUrl:`${prefix}/legacy/pages/legacy-page/preview`,updatedAt:'2026-10-12T12:00:00Z',provenance:'legacy_canvas_only'}],contributions:[{id:'legacy-memory',contributorName:'Korábbi vendég',memoryText:'Korábbi hozzájárulás',photoUrl:'https://example.invalid/legacy-compressed.jpg',createdAt:'2026-10-10T12:00:00Z',provenance:'legacy_cloudinary_only'}]}};
}
async function host(){const app=express();app.use(express.static(resolve('dist')));app.get(/^\/my-books(?:\/.*)?$/,(_req,res)=>res.sendFile(resolve('dist/index.html')));const server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));const address=server.address();assert.ok(address&&typeof address!=='string');return{origin:`http://127.0.0.1:${address.port}`,close:async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}};}

test('owner collection: mobile filters, processing states, protected downloads, provenance and settings conflict retention',{timeout:60000},async()=>{
  const fixture=await host(),browser=await chromium.launch({channel:'chrome'}),collection=data();
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,timezoneId:'America/Los_Angeles'});await context.addCookies([{name:'collection-owner-test',value:'fictional',domain:'127.0.0.1',path:'/'}]);await context.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));
    const page=await context.newPage();let unexpected=0,putCount=0,retryCount=0;const updates:unknown[]=[];
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.startsWith('/api/')){
        const headers={'Access-Control-Allow-Origin':fixture.origin,'Access-Control-Allow-Credentials':'true'};
        if(request.method()==='GET'&&url.pathname==='/api/pilot/collection-trial/session'){await route.fulfill({json:{trial:null},headers});return;}
        if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,PUT,POST','Access-Control-Allow-Headers':'content-type'}});return;}
        assert.ok((await request.allHeaders()).cookie?.includes('collection-owner-test=fictional'),'Owner requests include credentials');
        if(request.method()==='GET'&&url.pathname===prefix){await route.fulfill({json:collection,headers});return;}
        if(url.pathname===`/api/my/books/${bookId}/collection-settings`){
          if(request.method()==='GET'){await route.fulfill({json:collection.settings,headers});return;}
          if(request.method()==='PUT'){
            const body=request.postDataJSON();updates.push(body);putCount++;
            if(putCount===1){collection.settings={...collection.settings,revision:2,events:[...collection.settings.events,{id:'44444444-4444-4444-8444-444444444444',label:'Másik ablak eseménye',order:2}]};await route.fulfill({status:409,json:{error:'COLLECTION_SETTINGS_CONFLICT'},headers});return;}
            assert.equal(body.expectedRevision,2);collection.settings={revision:3,events:body.events,locations:body.locations};await route.fulfill({json:collection.settings,headers});return;
          }
        }
        if(request.method()==='POST'&&url.pathname===`${prefix}/files/photo-c/retry`){assert.deepEqual(request.postDataJSON(),{});retryCount++;const file=collection.sessions[2].files[0];Object.assign(file,{state:'ready',errorCode:null,retryAvailable:false,previewUrl:`${prefix}/files/photo-c/preview`});await route.fulfill({json:{file},headers});return;}
        if(request.method()==='GET'&&url.pathname.endsWith('/preview')&&url.pathname.startsWith(prefix+'/')){await route.fulfill({body:png,contentType:'image/png',headers});return;}
        if(request.method()==='GET'&&url.pathname===`${prefix}/manifest.json`){await route.fulfill({json:{bookId,fixture:true},headers:{...headers,'Content-Disposition':'attachment; filename="manifest.json"'}});return;}
        unexpected++;await route.abort();return;
      }
      if(url.origin!==fixture.origin){unexpected++;await route.abort();return;}await route.continue();
    });
    await page.goto(`${fixture.origin}/my-books/${bookId}/materials`);await expect(page.getByRole('heading',{name:'Beérkezett anyagok',exact:true})).toBeVisible();await expect(page.locator('[data-collection-session]')).toHaveCount(3);
    await expect(page.getByText('Őrzött eredeti szöveg <script>nem kód</script>',{exact:true})).toBeVisible();assert.equal(await page.locator('audio[autoplay],video[autoplay]').count(),0);assert.equal(await page.locator('audio[preload=none],video[preload=none]').count(),2);
    await expect(page.getByText('Eredetiség nem igazolt',{exact:false})).toHaveCount(2);await expect(page.getByRole('link',{name:'Eredeti fájl letöltése'})).toHaveCount(4);
    await expect(page.getByText(/14:23.*Ismeretlen időzóna/)).toBeVisible();
    // The server completes processing after the first response. Polling must
    // update the owner card without reload or a new guest submission.
    Object.assign(collection.sessions[1].files[0],{state:'ready',playbackUrl:`${prefix}/files/video-b/playback`});
    await expect(page.locator('[data-collection-session="session-b"] video')).toHaveCount(1,{timeout:8000});
    await page.getByLabel('Beküldő keresése',{exact:true}).fill('bela');await expect(page.locator('[data-collection-session]')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Béla',exact:true})).toBeVisible();await page.getByRole('button',{name:'Szűrők törlése',exact:true}).click();
    await page.getByLabel('Állapot',{exact:true}).selectOption('failed');await expect(page.getByRole('heading',{name:'Csilla',exact:true})).toBeVisible();await expect(page.locator('[data-collection-session]')).toHaveCount(1);await page.getByRole('button',{name:'Feldolgozás újrapróbálása',exact:true}).click();await expect(page.getByText('A fájl állapotát frissítettük.',{exact:true})).toBeVisible();await expect(page.locator('[data-collection-session]')).toHaveCount(0);assert.equal(retryCount,1);
    await page.getByRole('button',{name:'Szűrők törlése',exact:true}).click();await page.getByLabel('Esemény',{exact:true}).selectOption(e2);await expect(page.getByText('Nincs a szűrésnek megfelelő beküldés.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Szűrők törlése',exact:true}).click();
    await page.getByLabel('Dátumtól',{exact:true}).fill('2026-11-26');await expect(page.locator('[data-collection-session]')).toHaveCount(0);await page.getByRole('button',{name:'Szűrők törlése',exact:true}).click();
    await expect(page.getByRole('link',{name:'Minden anyag letöltése ZIP-ben',exact:true})).toHaveAttribute('href',new RegExp(`${prefix}/archive.zip$`));
    const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:'Fájljegyzék letöltése',exact:true}).click();const download=await downloaded;await mkdir('test-results/collection-owner',{recursive:true});await download.saveAs('test-results/collection-owner/manifest.json');assert.equal(JSON.parse(await readFile('test-results/collection-owner/manifest.json','utf8')).bookId,bookId);
    await page.getByText('Események és helyszínek',{exact:true}).click();await page.getByRole('button',{name:'Esemény hozzáadása',exact:true}).click();await page.getByLabel('Esemény neve 3',{exact:true}).fill('Új esemény');await page.getByRole('button',{name:'Előrébb: Új esemény',exact:true}).click();await expect(page.getByLabel('Esemény neve 2',{exact:true})).toHaveValue('Új esemény');await page.getByRole('button',{name:'Beállítások mentése',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Másik ablakban megváltoztak');await expect(page.getByLabel('Esemény neve 2',{exact:true})).toHaveValue('Új esemény');
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Mentett beállítások újratöltése',exact:true}).click();await expect(page.getByLabel('Esemény neve 2',{exact:true})).toHaveValue('Új esemény');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Mentett beállítások újratöltése',exact:true}).click();await expect(page.getByLabel('Esemény neve 3',{exact:true})).toHaveValue('Másik ablak eseménye');await page.getByLabel('Esemény neve 2',{exact:true}).fill('Módosított vacsora');await page.getByRole('button',{name:'Beállítások mentése',exact:true}).click();await expect(page.getByText('Beállítások mentve.',{exact:true})).toBeVisible();assert.equal(putCount,2);assert.equal(Object.keys(updates[1] as object).sort().join(','),'events,expectedRevision,locations');
    await page.getByLabel('Felület nyelve',{exact:true}).selectOption('en');await expect(page.getByRole('heading',{name:'Collected materials',exact:true})).toBeVisible();await page.getByLabel('Interface language',{exact:true}).selectOption('de');await expect(page.getByRole('heading',{name:'Gesammelte Inhalte',exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(unexpected,0);await page.screenshot({path:'test-results/collection-owner/mobile.png',fullPage:true});
  }finally{await browser.close();await fixture.close();}
});

test('owner collection does not show private content after an unauthenticated API response',{timeout:30000},async()=>{
  const fixture=await host(),browser=await chromium.launch({channel:'chrome'});
  try{const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('memorybook.appLanguage','hu'));await page.route('**/api/my/books/**',route=>route.fulfill({status:401,json:{error:'UNAUTHENTICATED'},headers:{'Access-Control-Allow-Origin':fixture.origin,'Access-Control-Allow-Credentials':'true'}}));await page.goto(`${fixture.origin}/my-books/${bookId}/materials`);await expect(page.getByRole('alert')).toContainText('jelentkezz be');await expect(page.getByRole('link',{name:'Bejelentkezés',exact:true})).toHaveAttribute('href','/login');await expect(page.locator('[data-collection-session]')).toHaveCount(0);await expect(page.getByRole('link',{name:'Minden anyag letöltése ZIP-ben',exact:true})).toHaveCount(0);}finally{await browser.close();await fixture.close();}
});
