// Read-only evidence from authenticated, explicitly scoped pilot metadata. No content/token output.
import {resolve} from 'node:path';
import {loadInternetConfig,createRemoteContext,getJson,ensure,writeJson} from './mcp-internet-utils';
const {config,storagePath}=await loadInternetConfig(process.argv.find(a=>a.endsWith('.local')));
const owner=await createRemoteContext(storagePath);
type Diagnostic={bookId:string;at:string;submissions:{id:string;created_at:string;media_count:number}[];media:{id:string;created_at:string;state:string;kind:string;mime_type:string;signature:string;original_size:number;duration_seconds:number|null;original_size_matches:boolean;original_hash_matches:boolean;owner_visible:boolean;submission_link_valid:boolean}[];attempts:{id:string;state:string;kind:string;error_code:string|null;pending_hash_matches:boolean|null}[];usage:{bytes:number;pendingBytes:number;limitBytes:number;files:number;unattached:number};guestUsage:{guest_group:number;kind:'photo'|'video'|'audio';used:number}[];limitations:string[]};
try{
  const result=await getJson<Diagnostic>(owner,'/api/pilot/books/'+config.bookId+'/media-diagnostics');
  ensure(result.bookId===config.bookId,'DIAGNOSTIC_BOOK_SCOPE_MISMATCH');
  ensure(result.media.every(m=>m.original_size_matches&&m.original_hash_matches),'ORIGINAL_INTEGRITY_MISMATCH');
  ensure(result.attempts.every(a=>a.pending_hash_matches!==false),'PENDING_ORIGINAL_INTEGRITY_MISMATCH');
  const brokenLinks=result.media.filter(m=>m.state==='attached'&&!m.submission_link_valid);
  const report={at:result.at,bookId:result.bookId,submissions:result.submissions.length,visibleMedia:result.media.filter(m=>m.owner_visible).length,
    orphanUploads:result.media.filter(m=>m.state==='uploaded').map(m=>({id:m.id,createdAt:m.created_at,kind:m.kind,mime:m.mime_type,bytes:m.original_size,duration:m.duration_seconds})),
    brokenAttachmentLinks:brokenLinks.length,originalIntegrity:'PASS',usage:result.usage,attempts:result.attempts.map(({id,state,kind,error_code})=>({id,state,kind,errorCode:error_code})),
    guestsAtQuota:result.guestUsage.filter(g=>g.used>=({photo:10,video:2,audio:2}[g.kind])),remoteWrites:0,limitations:result.limitations};
  await writeJson(resolve('test-results/samsung-release/database-metadata.json'),result);
  await writeJson(resolve('test-results/samsung-release/database-summary.json'),report);
  console.log(JSON.stringify(report));ensure(!brokenLinks.length,'ATTACHED_MEDIA_WITHOUT_MATCHING_SUBMISSION');
}finally{await owner.dispose();}
