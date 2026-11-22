// Offline metadata only, from the GET-only preservation copy. No names, text, tags or media bytes in reports.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {mediaBinaryPaths} from '../server/wedding/av-decoder';
import {ensure,loadInternetConfig,writeJson} from './mcp-internet-utils';

type Entry={path:string;kind:string;file:string;sha256:string};
type Media={id:string;kind:'photo'|'video'|'audio';mimeType:string;durationSeconds:number|null};
type Submission={id:string;created_at:string;media:Media[]};
const execute=promisify(execFile),dir=resolve('test-results/samsung-release/pre-release');
const output=resolve('test-results/samsung-release/attached-metadata.json');
const since=process.argv.find(arg=>arg.startsWith('--since='))?.slice(8)||'2026-11-21T00:00:00.000Z';
let stage='baseline';
try{
  ensure(Number.isFinite(Date.parse(since)),'INVALID_SINCE');
  const {config}=await loadInternetConfig(process.argv.find(arg=>arg.endsWith('.local')));
  const manifest=JSON.parse(await readFile(resolve(dir,'manifest.local'),'utf8')) as {at:string;books:number;entries:Entry[]};
  const entry=manifest.entries.find(item=>item.kind==='book'&&item.path==='/api/wedding/books/'+config.bookId);ensure(entry,'DESIGNATED_BOOK_BASELINE_MISSING');
  const detail=JSON.parse(await readFile(resolve(dir,entry.file),'utf8')) as {submissions:Submission[]};
  const recent=detail.submissions.filter(item=>Date.parse(item.created_at)>=Date.parse(since));
  const counts={photo:0,video:0,audio:0};for(const source of detail.submissions)for(const media of source.media||[])counts[media.kind||'photo']++;
  const submissions=[];
  for(const submission of recent){
    const mediaItems=[];
    for(const media of submission.media||[]){
      stage='local_media_metadata';
      const original=manifest.entries.find(item=>item.kind==='binary'&&item.path===`/api/wedding/media/${media.id}/original`);ensure(original,'ORIGINAL_COPY_MISSING');
      ensure(/^\d+\.bin$/.test(original.file),'INVALID_BASELINE_FILENAME');
      const path=resolve(dir,original.file),bytes=await readFile(path);ensure(createHash('sha256').update(bytes).digest('hex')===original.sha256,'LOCAL_ORIGINAL_HASH_MISMATCH');
      const signature=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'PNG':bytes[0]===255&&bytes[1]===216?'JPEG':bytes.toString('ascii',4,8)==='ftyp'?'MP4_FTYP':bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))?'WEBM_EBML':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE'?'RIFF_WAVE':bytes.toString('ascii',0,4)==='OggS'?'OGG':'UNKNOWN';
      let metadata:unknown;
      if(media.kind==='photo'){
        const image=await sharp(bytes,{limitInputPixels:100_000_000}).metadata();metadata={format:image.format,width:image.width,height:image.height,orientation:image.orientation,pages:image.pages};
      }else{
        const {stdout}=await execute(mediaBinaryPaths().ffprobe,['-v','error','-protocol_whitelist','file,pipe','-max_alloc','67108864','-threads','1','-show_entries','format=format_name,duration,size:stream=index,codec_name,codec_type,width,height,sample_rate,channels,avg_frame_rate,duration','-of','json',path],{timeout:30000,maxBuffer:1024*1024,windowsHide:true});
        metadata=JSON.parse(stdout);
      }
      mediaItems.push({mediaId:media.id,kind:media.kind,mimeType:media.mimeType,durationSeconds:media.durationSeconds,originalBytes:bytes.length,signature,sha256:original.sha256,metadata});
    }
    submissions.push({submissionId:submission.id,createdAt:submission.created_at,media:mediaItems});
  }
  const report={at:new Date().toISOString(),status:'PASS',baselineAt:manifest.at,baselineBooks:manifest.books,bookId:config.bookId,since,totalSubmissions:detail.submissions.length,totalAttachedMedia:counts,recentSubmissions:submissions,remoteWrites:0,scope:'Attached media exposed by owner HTTPS API only. Upload orphans, guest quota and media-row creation time are not exposed; createdAt is submission time. Format metadata is not a full decode or physical-phone test.'};
  await writeJson(output,report);console.log(JSON.stringify(report));
}catch(error){
  const errorCode=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'METADATA_INSPECTION_INCOMPLETE';
  const report={at:new Date().toISOString(),status:'INCOMPLETE',stage,errorCode,remoteWrites:0};await writeJson(output,report);console.error(JSON.stringify(report));process.exitCode=1;
}
