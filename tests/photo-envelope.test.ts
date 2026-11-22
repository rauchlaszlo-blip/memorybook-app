import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
import {photoEnvelope} from '../server/wedding/photo-envelope';
import {decodePhoto,mediaLimits} from '../server/wedding/media';
import {decodeAv,mediaBinaryPaths} from '../server/wedding/av-decoder';
import {motionPhoto,motionPhotoXmp,withXmp} from './fixtures/motion-photo';

let folder:string,jpeg:Buffer,video:Buffer;
before(async()=>{
  folder=await mkdtemp(join(tmpdir(),'memorybook-motion-test-'));
  jpeg=await sharp({create:{width:80,height:60,channels:3,background:'#537c60'}}).jpeg().toBuffer();
  const file=join(folder,'clip.mp4');
  await promisify(execFile)(mediaBinaryPaths().ffmpeg,['-v','error','-nostdin','-y','-f','lavfi','-i','color=c=green:s=160x120:r=15:d=0.6','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','0.6','-c:v','libx264','-threads','1','-c:a','aac','-movflags','+faststart',file],{windowsHide:true,timeout:30000});
  video=await readFile(file);
  const output=resolve('test-results/samsung-release/fixtures');await mkdir(output,{recursive:true});
  const motion=motionPhoto(jpeg,video);await writeFile(join(output,'synthetic-motion.jpg'),motion);await writeFile(join(output,'still.jpg'),jpeg);await writeFile(join(output,'clip.mp4'),video);
  await writeFile(join(output,'manifest.json'),JSON.stringify({source:'Synthetic color image and short silent color clip, no person or user content',motion:{file:'synthetic-motion.jpg',bytes:motion.length,sha256:createHash('sha256').update(motion).digest('hex')},video:{file:'clip.mp4',bytes:video.length},still:{file:'still.jpg',bytes:jpeg.length}},null,2));
});
after(async()=>{if(folder&&resolve(dirname(folder))===resolve(tmpdir())&&basename(folder).startsWith('memorybook-motion-test-'))await rm(resolve(folder),{recursive:true,force:true});});

test('plain and progressive JPEG markers, escaped entropy and embedded EOI in metadata remain valid',async()=>{
  assert.deepEqual(await photoEnvelope(jpeg),jpeg);
  const progressive=await sharp({create:{width:512,height:512,channels:3,background:'#b87562'}}).jpeg({progressive:true}).toBuffer();
  assert.deepEqual(await photoEnvelope(progressive),progressive);
  const segment=Buffer.from([255,226,0,6,12,255,217,13]),embedded=Buffer.concat([jpeg.subarray(0,2),segment,jpeg.subarray(2)]);
  assert.deepEqual(await photoEnvelope(embedded),embedded);
  await assert.rejects(photoEnvelope(Buffer.concat([jpeg,jpeg])),{code:'PHOTO_INVALID'});
  await assert.rejects(photoEnvelope(jpeg.subarray(0,jpeg.length-2)),{code:'PHOTO_INVALID'});
});

test('declared Motion Photo v1 validates both genuine parts and renders only its still; original buffer unchanged',async()=>{
  for(const xml of [motionPhotoXmp(video.length),motionPhotoXmp(video.length).replaceAll('Camera:','GCamera:').replaceAll('xmlns:Camera=','xmlns:GCamera='),motionPhotoXmp(video.length).replace('Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1"','').replace('<Container:Directory>','<Camera:MotionPhoto>1</Camera:MotionPhoto><Camera:MotionPhotoVersion>1</Camera:MotionPhotoVersion><Container:Directory>')]){
    const bytes=motionPhoto(jpeg,video,xml),saved=Buffer.from(bytes),primary=withXmp(jpeg,xml);
    assert.deepEqual(await photoEnvelope(bytes),primary);
    const decoded=await decodePhoto(bytes,mediaLimits());assert.equal(decoded.mime,'image/jpeg');assert.equal(decoded.width,80);assert.equal(decoded.height,60);
    assert.deepEqual(decoded.display,(await decodePhoto(primary,mediaLimits())).display);assert.deepEqual(bytes,saved);
  }
  const padded=motionPhoto(jpeg,video,motionPhotoXmp(video.length,32),32);assert.deepEqual(await photoEnvelope(padded),withXmp(jpeg,motionPhotoXmp(video.length,32)));
});

test('Motion Photo refuses arbitrary/polyglot trailers, false lengths, namespaces, DTDs and malformed or extra clips',async()=>{
  const xml=motionPhotoXmp(video.length),valid=motionPhoto(jpeg,video);
  const invalid=[Buffer.concat([jpeg,video]),Buffer.concat([valid,Buffer.from('PK\x03\x04harmless-test')]),motionPhoto(jpeg,video,xml.replace(`Item:Length="${video.length}"`,`Item:Length="${video.length+1}"`)),motionPhoto(jpeg,video,xml.replace('photos/1.0/container/item/','example.invalid/item/')),motionPhoto(jpeg,video,xml.replace('Camera:MotionPhoto="1"','Camera:MotionPhoto="0"')),motionPhoto(jpeg,video,xml.replace('Item:Mime="video/mp4"','Item:Mime="image/jpeg"')),motionPhoto(jpeg,video,'<!DOCTYPE x [<!ENTITY external SYSTEM "file:///never-read">]>'+xml),motionPhoto(jpeg,video,xml.replace('<Container:Directory>','<Container:Directory>&external;')),motionPhoto(jpeg,video.subarray(0,video.length-20),motionPhotoXmp(video.length-20)),motionPhoto(jpeg,Buffer.concat([video,video]),motionPhotoXmp(video.length*2)),motionPhoto(withXmp(jpeg,xml),video,xml)];
  const wrongPadding=motionPhoto(jpeg,video,motionPhotoXmp(video.length,2),2);wrongPadding[withXmp(jpeg,motionPhotoXmp(video.length,2)).length]=1;invalid.push(wrongPadding);
  for(const [index,bytes] of invalid.entries())await assert.rejects(photoEnvelope(bytes),`invalid synthetic case ${index}`);
});

test('photo size and pixel limits still apply before returning display bytes',async()=>{
  const bytes=motionPhoto(jpeg,video);await assert.rejects(decodePhoto(bytes,{...mediaLimits(),maxBytes:bytes.length-1}),{code:'PHOTO_TOO_LARGE'});
  await assert.rejects(decodePhoto(bytes,{...mediaLimits(),maxPixels:100}),{code:'PHOTO_PIXELS'});
});

test('real local Chromium MediaRecorder MP4 and chunked WebM are completely decoded, no phone claim',{timeout:90000},async()=>{
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Local synthetic recorder</title>');}).listen(0,'127.0.0.1');
  await new Promise<void>(done=>server.once('listening',done));const address=server.address();assert.ok(address&&typeof address!=='string');
  const browser=await chromium.launch({channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const report=[];
  try{
    const context=await browser.newContext({permissions:['camera','microphone']});
    await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==`http://127.0.0.1:${address.port}`)await route.abort();else await route.continue();});
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${address.port}`);
    const cases=[{mime:'video/mp4;codecs=avc1.42E01E,mp4a.40.2',recordMs:1600},{mime:'video/webm;codecs=vp8,opus',recordMs:1600},{mime:'video/webm;codecs=vp9,opus',recordMs:1600},{mime:'',recordMs:1600},{mime:'video/webm;codecs=vp8,opus',recordMs:20200}];
    for(const {mime,recordMs} of cases){
      const capture=await page.evaluate(async({requested,recordMs})=>{
        if(requested&&!MediaRecorder.isTypeSupported(requested))return{unsupported:true};
        const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30}},audio:true});
        const recorder=new MediaRecorder(stream,{...(requested?{mimeType:requested}:{}),videoBitsPerSecond:1500000,audioBitsPerSecond:96000}),chunks:Blob[]=[];
        const completed=new Promise<void>((done,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onstop=()=>done();recorder.onerror=()=>reject(new Error('LOCAL_RECORDER_ERROR'));});
        recorder.start(250);await new Promise(done=>setTimeout(done,recordMs));recorder.stop();stream.getTracks().forEach(track=>track.stop());await completed;
        const bytes=new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
        return{unsupported:false,mimeType:recorder.mimeType,chunks:chunks.length,stopped:stream.getTracks().every(track=>track.readyState==='ended'),base64:btoa(binary)};
      },{requested:mime,recordMs});
      assert.equal(capture.unsupported,false,`Required installed Chromium codec: ${mime}`);assert.ok(capture.stopped&&capture.chunks!>1);
      const bytes=Buffer.from(capture.base64!,'base64');await mkdir('test-results/samsung-release',{recursive:true});await writeFile(`test-results/samsung-release/local-recorder-${report.length}.bin`,bytes);
      try{const decoded=await decodeAv(bytes,'video');assert.ok(recordMs<20000&&decoded.durationSeconds>0&&decoded.durationSeconds<=20);report.push({requested:mime||'browser-default',actual:capture.mimeType,chunks:capture.chunks,bytes:bytes.length,decodedDuration:decoded.durationSeconds,status:'PASS'});}
      catch(error){const code=(error as {code?:string}).code||'LOCAL_DECODE_ERROR';report.push({requested:mime||'browser-default',actual:capture.mimeType,chunks:capture.chunks,bytes:bytes.length,status:recordMs>20000&&code==='MEDIA_DURATION'?'PASS':'REJECTED',expectedOver20s:recordMs>20000,code});}
    }
    await mkdir('test-results/samsung-release',{recursive:true});await writeFile('test-results/samsung-release/local-recorder-formats.json',JSON.stringify({physicalSamsung:'NOT_TESTED',remoteWrites:0,cases:report},null,2));
    assert.ok(report.every(item=>item.status==='PASS'),JSON.stringify(report));
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
