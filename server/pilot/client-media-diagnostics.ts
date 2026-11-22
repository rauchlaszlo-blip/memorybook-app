import {Router,json} from 'express';
import type {Pool} from 'pg';
import {guestDevice} from '../wedding/access-window';
const codes=new Set(['CLIENT_PHOTO_TYPE','CLIENT_PHOTO_SIZE','CLIENT_PHOTO_PREVIEW','CLIENT_MEDIA_SIZE','CLIENT_MEDIA_DURATION','CLIENT_MEDIA_INVALID','CLIENT_MEDIA_PREVIEW','CAPTURE_UNSUPPORTED','CAPTURE_PERMISSION_DENIED','CAPTURE_DEVICE_MISSING','CAPTURE_DEVICE_BUSY','CAPTURE_FAILED','CAPTURE_EMPTY']);
const mimes=new Set(['image/jpeg','image/png','image/heic','image/heif','image/webp','image/avif','image/gif','video/mp4','video/quicktime','video/webm','video/3gpp','audio/mp4','audio/webm','audio/ogg','audio/wav','audio/mpeg','audio/aac','application/octet-stream']);
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Diagnostic={event:'guest_media_client_failure';diagnosticId:string;bookId:string;stage:string;kind:string;source:string;mimeType:string;byteLength:number|null;errorCode:string;at:string};
/** Bounded, explicitly untrusted client observations. They never create/approve a submission. */
export function createClientMediaDiagnostics(pool:Pool,origin:string,log:(value:Diagnostic)=>void=value=>console.info(JSON.stringify(value))){
  const router=Router(),buckets=new Map<string,{count:number;until:number;ids:Set<string>}>();
  router.post('/api/wedding/guest/:token/media-diagnostics',json({limit:'2kb'}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.get('origin')!==origin){res.status(403).json({error:'ORIGIN_REQUIRED'});return;}
    const device=guestDevice(req);if(!device){res.status(428).json({error:'GUEST_SESSION_REQUIRED'});return;}
    const value=req.body as Record<string,unknown>|null,allowed=['diagnosticId','stage','kind','source','mimeType','byteLength','errorCode'];
    if(!/^[A-Za-z\d_-]{43}$/.test(String(req.params.token))||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||typeof value.diagnosticId!=='string'||!uuid.test(value.diagnosticId)||!['selection','capture'].includes(String(value.stage))||!['photo','video','audio'].includes(String(value.kind))||!['gallery','camera','recorder','file','unknown'].includes(String(value.source))||!codes.has(String(value.errorCode))||value.mimeType!==undefined&&(typeof value.mimeType!=='string'||value.mimeType.length>100)||value.byteLength!==undefined&&(!Number.isSafeInteger(value.byteLength)||Number(value.byteLength)<0||Number(value.byteLength)>1024**3)){
      res.status(400).json({error:'INVALID_DIAGNOSTIC'});return;
    }
    try{
      const found=await pool.query("SELECT id FROM event_books WHERE invite_token=$1 AND product='celebration' AND event_type='wedding' AND title ILIKE '%fiktív%'",[req.params.token]);
      if(!found.rowCount){res.status(404).json({error:'NOT_FOUND'});return;}
      const bookId=found.rows[0].id as string,now=Date.now();for(const [key,bucket] of buckets)if(bucket.until<=now)buckets.delete(key);
      const bucketKey=bookId+':'+device,prior=buckets.get(bucketKey);
      if(!prior&&buckets.size>=2000){res.status(429).json({error:'RATE_LIMITED'});return;}
      const bucket=prior||{count:0,until:now+60000,ids:new Set<string>()};buckets.set(bucketKey,bucket);
      if(bucket.ids.has(value.diagnosticId)){res.status(202).json({recorded:true,diagnosticId:value.diagnosticId});return;}
      if(bucket.count>=10){res.setHeader('Retry-After','60');res.status(429).json({error:'RATE_LIMITED'});return;}
      bucket.count++;bucket.ids.add(value.diagnosticId);
      const mime=String(value.mimeType||'').trim().toLowerCase();
      log({event:'guest_media_client_failure',diagnosticId:value.diagnosticId,bookId,stage:String(value.stage),kind:String(value.kind),source:String(value.source),mimeType:mimes.has(mime)?mime:'unknown',byteLength:value.byteLength===undefined?null:Number(value.byteLength),errorCode:String(value.errorCode),at:new Date().toISOString()});
      res.status(202).json({recorded:true,diagnosticId:value.diagnosticId});
    }catch{res.status(503).json({error:'DIAGNOSTIC_UNAVAILABLE'});}
  });
  return router;
}
