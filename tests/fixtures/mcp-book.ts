import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import sharp from 'sharp';
import {attachAnnotation} from '../../server/wedding/annotation';
import {mediaLimits} from '../../server/wedding/media';

/** Entirely synthetic: ten stable contributor identities, thirty generated images.
 * The repeated names deliberately belong to different contributors. No network or AI. */
export async function seedMcpBook(pool:Pool,ownerId='owner-mcp'){
  const bookId=randomUUID(),inviteToken=Buffer.from(randomUUID()+randomUUID()).toString('base64url').slice(0,43);
  await pool.query("INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,starts_on,template_id,template_version,invite_token,closed_at) VALUES($1,$2,'celebration','wedding','Lili és Márk – fiktív MCP-próbakönyv','[]','2026-11-17','wedding-classic',1,$3,CURRENT_TIMESTAMP)",[bookId,ownerId,inviteToken]);
  const mediaIds:string[]=[],submissionIds:string[]=[];
  const colors=['#b76446','#577e69','#7c6594','#437c9c','#bc8b31'];
  for(let guest=0;guest<10;guest++){
    const submissionId=randomUUID();submissionIds.push(submissionId);
    const message=guest===9?' ':guest===2?'Őrizzétek az együtt töltött idő örömét! Árvíztűrő tükörfúrógép, ősz, üdvözlet és boldogság. '.repeat(24):`Fiktív üzenet ${guest+1}. Őszinte örömöt, sok közös élményt és boldogságot kívánunk Lilinek és Márknak!`;
    await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[submissionId,bookId,randomUUID(),guest<2?'Fiktív Éva':`Fiktív vendég ${guest+1}`,message,`fictional-person-${guest+1}`]);
    for(let picture=0;picture<3;picture++){
      const index=guest*3+picture,portrait=index%2===0,width=portrait?900:1200,height=portrait?1200:800;
      const background=colors[guest%colors.length];
      // Label, corner markers and asymmetric shapes make rotation/crop/order inspectable.
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><rect x="20" y="20" width="${width-40}" height="${height-40}" rx="28" fill="#f8f0dd"/><circle cx="${width*.28}" cy="${height*.36}" r="${width*.16}" fill="${background}"/><path d="M ${width*.55} ${height*.25} L ${width*.83} ${height*.59} L ${width*.45} ${height*.59} Z" fill="#dfae63"/><rect x="35" y="35" width="50" height="50" fill="#df3030"/><text x="${width*.12}" y="${height*.79}" font-family="DejaVu Sans" font-size="${width*.065}" fill="#302b33">FIKTIV ${guest+1} / ${picture+1}</text><text x="${width*.12}" y="${height*.87}" font-family="DejaVu Sans" font-size="${width*.035}" fill="#302b33">${portrait?'ALLO':'FEKVO'} TESZTKEP ${index+1}</text></svg>`;
      const bytes=await sharp(Buffer.from(svg)).png().toBuffer(),preview=await sharp(bytes).resize({width:480,height:480,fit:'inside'}).jpeg({quality:80}).toBuffer();
      const mediaId=randomUUID();mediaIds.push(mediaId);
      await pool.query("INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size) VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8,'attached',$9,$10,$9,$11)",[mediaId,bookId,randomUUID(),submissionId,bytes.length,createHash('sha256').update(bytes).digest('hex'),width,height,bytes,preview,bytes.length*2+preview.length]);
      if(index===0||index===4){
        const c=await pool.connect();
        try{await attachAnnotation(c,mediaId,bookId,bytes,{version:1,space:'exif-oriented-normalized',strokes:[{color:'#d62828',width:.014,points:[[.15,.2],[.22,.42],[.3,.19],[.38,.42],[.46,.2],[.54,.42]]},{color:'#1764c0',width:.007,points:[[.18,.53],[.35,.62],[.53,.53],[.68,.64],[.8,.53]]}]},mediaLimits());}finally{c.release();}
      }
    }
  }
  return {bookId,inviteToken,mediaIds,submissionIds,ownerId};
}
