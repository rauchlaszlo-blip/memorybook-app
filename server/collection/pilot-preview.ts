import type {Pool,PoolClient} from 'pg';
import {collectionPilotBook} from './database-isolation';
import {assertCollectionQuota,collectionLimits,CollectionError} from './service';
import {validateCollectionMedia} from './validation';

/** Caller uses the same quota-before-page lock order as collection commit/upload. */
export async function lockCollectionPilotSave(db:PoolClient,env:NodeJS.ProcessEnv=process.env){
  if(env.COLLECTION_PILOT_ENABLED==='yes')await db.query('SELECT pg_advisory_xact_lock(61126,2)');
}

/** A narrow alternative for the designated pilot; all other books retain the Cloudinary path. */
export async function saveCollectionPilotPreview(pool:Pool,db:Pool|PoolClient,pageId:string,canvasData:Record<string,unknown>,previewDataUrl:string|null|undefined,expectedVersion:number,inviteStatus?:string,env:NodeJS.ProcessEnv=process.env){
  if(env.COLLECTION_PILOT_ENABLED!=='yes')return null;
  const match=await db.query("SELECT p.id FROM pages p JOIN books b ON b.id=p.book_id WHERE p.id=$1 AND b.id=$2 AND b.owner_user_id=$3 AND b.book_type='event'",[pageId,collectionPilotBook.id,collectionPilotBook.ownerId]);
  if(!match.rowCount)return null;
  let preview:Buffer|null=null;
  if(previewDataUrl){
    if(typeof previewDataUrl!=='string'||previewDataUrl.length>3*1024*1024||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(previewDataUrl))throw new CollectionError('INVALID_PREVIEW_FORMAT');
    preview=Buffer.from(previewDataUrl.slice(23),'base64');
    if(preview.length>2*1024*1024)throw new CollectionError('PREVIEW_TOO_LARGE');
    try{const result=await validateCollectionMedia(preview,'photo',{maxBytes:2*1024*1024,maxDurationSeconds:20,maxPixels:40_000_000});if(result.mimeType!=='image/jpeg')throw new Error();}catch{throw new CollectionError('INVALID_PREVIEW_JPEG');}
  }
  const ownTransaction=db===pool,client=ownTransaction?await pool.connect():db as PoolClient;
  try{
    if(ownTransaction){await client.query('BEGIN');await lockCollectionPilotSave(client,env);}
    const page=(await client.query('SELECT p.* FROM pages p JOIN books b ON b.id=p.book_id WHERE p.id=$1 AND b.id=$2 AND b.owner_user_id=$3 FOR UPDATE OF p',[pageId,collectionPilotBook.id,collectionPilotBook.ownerId])).rows[0];
    if(!page)throw new CollectionError('PAGE_NOT_FOUND',404);
    if(page.invite_status==='submitted')throw new CollectionError('PAGE_ALREADY_SUBMITTED',410);
    if(page.version!==expectedVersion){const error=new CollectionError('PAGE_CONFLICT',409) as CollectionError&{latestRemoteVersion:number};error.latestRemoteVersion=page.version;throw error;}
    const group=(await client.query('SELECT preview_bytes,stored_size FROM collection_groups WHERE page_id=$1',[pageId])).rows[0];
    const finalPreview=preview??group?.preview_bytes??null,storedSize=Buffer.byteLength(JSON.stringify(canvasData))+(finalPreview?.length||0);
    await assertCollectionQuota(client,page.book_id,storedSize-Number(group?.stored_size||0),collectionLimits(env));
    const previewUrl=finalPreview?`/api/collection/invites/${encodeURIComponent(page.invite_token)}/page-preview`:null;
    const row=(await client.query(`UPDATE pages SET canvas_json=$2,preview_image_url=$3,version=version+1,invite_status=COALESCE($4,invite_status),updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND version=$5 RETURNING id,version,preview_image_url AS "previewImageUrl",updated_at AS "updatedAt"`,[pageId,canvasData,previewUrl,inviteStatus??null,expectedVersion])).rows[0];
    if(!row)throw new CollectionError('PAGE_CONFLICT',409);
    await client.query(`INSERT INTO collection_groups(page_id,book_id,preview_bytes,stored_size) VALUES($1,$2,$3,$4) ON CONFLICT(page_id) DO UPDATE SET preview_bytes=$3,stored_size=$4,updated_at=CURRENT_TIMESTAMP`,[pageId,page.book_id,finalPreview,storedSize]);
    if(ownTransaction)await client.query('COMMIT');return row;
  }catch(error){if(ownTransaction)await client.query('ROLLBACK');throw error;}finally{if(ownTransaction)client.release();}
}
