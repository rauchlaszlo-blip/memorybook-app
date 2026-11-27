import {Router,json,raw} from 'express';
import type {Request,Response,RequestHandler,ErrorRequestHandler} from 'express';
import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {CollectionError,collectionLimits,createCollectionService} from './service';
import type {CollectionActor,CollectionLimits} from './service';
import {streamCollectionZip} from './archive';

type Session={user:{id:string}}|null;
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','audio/mp4':'m4a','audio/webm':'webm','audio/ogg':'ogg','audio/wav':'wav'};
function sendBytes(req:Request,res:Response,bytes:Buffer,mime:string,name?:string){
  res.setHeader('Content-Type',mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Accept-Ranges','bytes');
  if(name)res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
  const range=req.get('range');if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start:number,end=bytes.length-1;
    if(!match||!match[1]&&!match[2]){res.setHeader('Content-Range',`bytes */${bytes.length}`);res.sendStatus(416);return;}
    if(!match[1])start=Math.max(0,bytes.length-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=bytes.length||end<start){res.setHeader('Content-Range',`bytes */${bytes.length}`);res.sendStatus(416);return;}
    res.status(206).setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);res.setHeader('Content-Length',end-start+1);res.end(bytes.subarray(start,end+1));return;
  }
  res.setHeader('Content-Length',bytes.length);res.end(bytes);
}
/** Mounted at root; every collection handler has independent book/invite authorization. */
export function createCollectionRouter({pool,getSession,env=process.env,limits=collectionLimits(env)}:{pool:Pool;getSession:(req:Request)=>Promise<Session>;env?:NodeJS.ProcessEnv;limits?:CollectionLimits}){
  const router=Router(),service=createCollectionService(pool,limits);let active=0;
  const paths=['/api/collection','/api/my/books/:bookId/collection','/api/my/books/:bookId/collection-settings'];
  router.use(paths,(req,res,next)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){const allowed=new Set([`${req.protocol}://${req.get('host')}`,env.PUBLIC_APP_URL,env.BETTER_AUTH_URL]);if(['test','development'].includes(env.NODE_ENV||'')){allowed.add('http://localhost:5173');allowed.add('http://127.0.0.1:5173');}if(!req.get('origin')||!allowed.has(req.get('origin'))){res.status(403).json({error:'ORIGIN_NOT_ALLOWED'});return;}}
    next();
  });
  router.use(paths,json({limit:'5mb'}));
  const wrap=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch(error){if(res.headersSent){res.destroy();return;}res.status(error instanceof CollectionError?error.status:503).json({error:error instanceof CollectionError?error.code:'COLLECTION_RETRY_REQUIRED'});}};
  const guest=(req:Request):CollectionActor=>({token:String(req.params.token)});
  const owner=async(req:Request):Promise<CollectionActor>=>{const session=await getSession(req);if(!session)throw new CollectionError('UNAUTHENTICATED',401);return{ownerId:session.user.id,bookId:String(req.params.bookId)};};
  const empty=(body:unknown)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new CollectionError('INVALID_INPUT');};
  const process=async(actor:CollectionActor,fileId:string)=>{if(active>=2)throw new CollectionError('PROCESSING_BUSY',429);active++;try{return await service.complete(actor,fileId);}finally{active--;}};
  const base='/api/collection/invites/:token',owned='/api/my/books/:bookId/collection';
  router.get(base,wrap(async(req,res)=>{res.json(await service.bootstrap(guest(req)));}));
  router.get(base+'/page-preview',wrap(async(req,res)=>{sendBytes(req,res,await service.groupPreview(guest(req)),'image/jpeg');}));
  router.post(base+'/files',wrap(async(req,res)=>{const result=await service.begin(guest(req),req.body);res.status(result.replayed?200:201).json(result);}));
  router.get(base+'/files/:id',wrap(async(req,res)=>{res.json(await service.status(guest(req),String(req.params.id)));}));
  router.put(base+'/files/:id/chunks/:index',raw({type:'application/octet-stream',limit:limits.chunkBytes}),wrap(async(req,res)=>{if(!Buffer.isBuffer(req.body)||!/^\d+$/.test(String(req.params.index)))throw new CollectionError('INVALID_CHUNK');res.json(await service.chunk(guest(req),String(req.params.id),Number(req.params.index),req.body));}));
  router.post(base+'/files/:id/complete',wrap(async(req,res)=>{empty(req.body);res.json(await process(guest(req),String(req.params.id)));}));
  router.post(base+'/files/:id/retry',wrap(async(req,res)=>{empty(req.body);res.json(await process(guest(req),String(req.params.id)));}));
  router.delete(base+'/files/:id',wrap(async(req,res)=>{res.json(await service.remove(guest(req),String(req.params.id)));}));
  router.post(base+'/commit',wrap(async(req,res)=>{res.json(await service.commit(guest(req),req.body));}));
  const variant=(value:unknown)=>{if(!['original','preview','playback'].includes(String(value)))throw new CollectionError('FILE_NOT_FOUND',404);return value as 'original'|'preview'|'playback';};
  router.get(base+'/files/:id/:variant',wrap(async(req,res)=>{const v=variant(req.params.variant),result=await service.bytes(guest(req),String(req.params.id),v);sendBytes(req,res,result.bytes,result.mimeType,v==='original'?`${result.file.id}.${extensions[result.mimeType]||'bin'}`:undefined);}));
  router.get('/api/my/books/:bookId/collection-settings',wrap(async(req,res)=>{res.json(await service.getSettings(await owner(req)));}));
  router.put('/api/my/books/:bookId/collection-settings',wrap(async(req,res)=>{res.json(await service.saveSettings(await owner(req),req.body));}));
  router.get(owned,wrap(async(req,res)=>{res.json(await service.ownerList(await owner(req)));}));
  router.post(owned+'/files/:id/retry',wrap(async(req,res)=>{empty(req.body);res.json(await process(await owner(req),String(req.params.id)));}));
  router.get(owned+'/files/:id/:variant',wrap(async(req,res)=>{const v=variant(req.params.variant),result=await service.bytes(await owner(req),String(req.params.id),v);sendBytes(req,res,result.bytes,result.mimeType,v==='original'?`${result.file.id}.${extensions[result.mimeType]||'bin'}`:undefined);}));
  router.get(owned+'/groups/:pageId/preview',wrap(async(req,res)=>{sendBytes(req,res,await service.groupPreview(await owner(req),String(req.params.pageId)),'image/jpeg');}));
  async function manifest(actor:CollectionActor){const data=await service.ownerList(actor);return{format:'memorybook-collection',version:1,exportedAt:new Date().toISOString(),...data};}
  router.get(owned+'/manifest.json',wrap(async(req,res)=>{res.setHeader('Content-Disposition','attachment; filename="manifest.json"');res.json(await manifest(await owner(req)));}));
  router.get(owned+'/archive.zip',wrap(async(req,res)=>{
    const actor=await owner(req),data=await manifest(actor);
    async function* entries(){
      yield{name:'manifest.json',bytes:Buffer.from(JSON.stringify(data,null,2))};
      yield{name:'snapshots.json',bytes:Buffer.from(JSON.stringify(data.sessions.map(s=>({groupId:s.groupId,submissionId:s.submissionId,canvasData:s.canvasData,guestData:s.guestData,events:s.events,locations:s.locations})),null,2))};
      for(const session of data.sessions){const folder=createHash('sha256').update(session.groupId).digest('hex').slice(0,24);
        for(const file of session.files){if(!file.originalUrl||file.state==='removed')continue;const original=await service.bytes(actor,file.id,'original');yield{name:`originals/${folder}/${file.id}.${extensions[original.mimeType]||'bin'}`,bytes:original.bytes};}
        if(session.previewUrl)yield{name:`previews/${folder}.jpg`,bytes:await service.groupPreview(actor,session.groupId)};
      }
    }
    res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition','attachment; filename="memorybook-originals.zip"');await streamCollectionZip(entries(),res);
  }));
  const errors:ErrorRequestHandler=(error,_req,res,next)=>{void next;if(res.headersSent){res.destroy();return;}res.status(error.status===413?413:400).json({error:error.status===413?'REQUEST_TOO_LARGE':'INVALID_REQUEST'});};router.use(paths,errors);
  return router;
}
