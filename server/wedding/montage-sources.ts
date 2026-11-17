import type {Pool} from 'pg';
import type {Source} from '../../shared/montage';
import type {Annotation} from '../../shared/photo-annotation';
import sharp from 'sharp';
const dimensions=new Map<string,{width:number;height:number}>();
export async function montageSources(pool:Pick<Pool,'query'>,bookId:string, options:{ids?:string[];offset?:number;limit?:number}={}):Promise<Source[]>{
  const rows=(await pool.query(`SELECT s.id,s.guest_name,s.message,COALESCE(s.guest_device_id,s.id::text) AS guest_id,
    COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'width',m.width,'height',m.height,'annotated',a.media_id IS NOT NULL,'layer',a.layer)) FILTER(WHERE m.id IS NOT NULL),'[]') AS media
    FROM event_submissions s LEFT JOIN event_media m ON m.submission_id=s.id AND m.book_id=s.book_id AND m.state='attached'
    LEFT JOIN event_media_annotations a ON a.media_id=m.id WHERE s.book_id=$1 AND ($2::uuid[] IS NULL OR s.id=ANY($2::uuid[])) GROUP BY s.id ORDER BY s.created_at,s.id OFFSET $3 LIMIT $4`,[bookId,options.ids??null,options.offset??0,options.limit??2000])).rows;
  const sources:Source[]=[];
  for(const row of rows){const media:Source['media']=[];for(const m of row.media){
    let size=dimensions.get(m.id);if(!size){const original=(await pool.query('SELECT original_bytes FROM event_media WHERE id=$1 AND book_id=$2',[m.id,bookId])).rows[0];const metadata=await sharp(original.original_bytes).metadata();const swap=(metadata.orientation||0)>=5;size={width:(swap?metadata.height:metadata.width)!,height:(swap?metadata.width:metadata.height)!};if(dimensions.size>=1000)dimensions.clear();dimensions.set(m.id,size);}
    const points=(m.layer as Annotation|null)?.strokes.flatMap(s=>s.points)||[];let inkBounds;
    if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);inkBounds={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
    media.push({id:m.id,...size,annotated:m.annotated,...(inkBounds?{inkBounds}:{})});
  }sources.push({id:row.id,guestId:row.guest_id,name:row.guest_name,message:row.message,media});}return sources;
}
