// Local fictional demo only. No Render credentials, live databases or password bypass.
import {Pool} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {migratePilot} from '../server/pilot/auth';
import {createCommerceAuth} from '../server/pilot/commerce-auth';
import {createPilotApp} from '../server/pilot/app';
const connectionString=localDatabaseUrl(),admin=new Pool({connectionString});
await admin.query('CREATE SCHEMA IF NOT EXISTS montage_local_demo');await admin.end();
const pool=new Pool({connectionString,options:'-c search_path=montage_local_demo'});await migrateWedding(pool);await migratePilot(pool);
const origin='http://127.0.0.1:5188',commerce=await createCommerceAuth(pool,origin),email='montage@example.test';
let user=(await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
if(!user){await commerce.auth.api.signUpEmail({body:{email,password:'aaaa',name:'Fiktív tesztpár'}});user=(await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];}
let book=(await pool.query('SELECT id FROM event_books WHERE owner_user_id=$1 ORDER BY created_at LIMIT 1',[user.id])).rows[0];
if(!book){book={id:randomUUID()};await pool.query("INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,starts_on,template_id,template_version,invite_token,closed_at) VALUES($1,$2,'celebration','wedding','Anna és Bence – montázspróba','[]','2026-11-07','wedding-classic',1,$3,CURRENT_TIMESTAMP)",[book.id,user.id,randomUUID()]);
  for(let i=0;i<4;i++){
    const id=randomUUID();await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)',[id,book.id,randomUUID(),['Fiktív Éva','Fiktív Péter','Fiktív Éva','Fiktív Ágnes'][i],['Sok közös örömöt és boldogságot kívánunk! Őrizzétek meg ezt a szép napot.','Legyen minden napotokban egy kis ünnep. Árvíztűrő tükörfúrógép – ékezetpróba.','Mindig figyeljetek egymásra, és nevessetek sokat együtt!','Köszönjük, hogy veletek ünnepelhettünk.'][i],'demo-guest-'+i]);
    if(i<2){const width=i===0?900:600,height=i===0?600:900;const photo=await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="${i===0?'#d5bca2':'#b4c1b1'}"/><circle cx="${width*.5}" cy="${height*.4}" r="120" fill="#f4e7d5"/><rect x="${width*.2}" y="${height*.68}" width="${width*.6}" height="70" rx="25" fill="#987889"/></svg>`)).png().toBuffer();await pool.query("INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size) VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8,'attached',$9,$9,$9,$10)",[randomUUID(),book.id,randomUUID(),id,photo.length,createHash('sha256').update(photo).digest('hex'),width,height,photo,photo.length*3]);}
  }
}
await mkdir('test-results/montage',{recursive:true});await writeFile('test-results/montage/demo.json',JSON.stringify({origin,email,bookId:book.id,url:origin+'/wedding/books/'+book.id+'/montage'},null,2));
const server=createPilotApp(pool,origin,commerce).listen(5188,'127.0.0.1',()=>console.log('Local fictional montage demo: '+origin+'/wedding/books/'+book.id+'/montage'));
process.on('SIGTERM',()=>server.close(()=>{void pool.end();}));
