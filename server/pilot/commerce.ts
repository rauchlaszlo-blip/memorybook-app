import { Router, json } from 'express';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { fromNodeHeaders } from 'better-auth/node';
import type { CommerceAuth } from './commerce-auth';
import { decryptTestMail } from './commerce-auth';
import { digest, getPilotSession } from './auth';
import { validateBilling } from './billing';
import { weddingPackage } from '../../shared/wedding-package';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function createCommerceRouter(pool:Pool,origin:string,config:CommerceAuth) {
  const r=Router();r.use(json({limit:'16kb'}));
  const wrap=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{try{await fn(req,res,next);}catch{res.status(503).json({error:'RETRY'});}};
  const user=async(req:Parameters<RequestHandler>[0])=>(await config.auth.api.getSession({headers:fromNodeHeaders(req.headers)}))?.user;
  const limits=new Map<string,{n:number;until:number}>();
  r.use((req,res,next)=>{const now=Date.now();for(const [k,v]of limits)if(v.until<=now)limits.delete(k);const key=(req.ip||'unknown')+':'+(req.method==='GET'?'read':req.path.startsWith('/operator')?'operator':req.path==='/orders'?'redeem':'book');let b=limits.get(key);if(!b){if(limits.size>=10000){res.sendStatus(429);return;}b={n:0,until:now+60000};limits.set(key,b);}if(++b.n>(req.method==='GET'?200:30)){res.status(429).json({error:'LIMIT'});return;}next();});
  r.get('/session',wrap(async(req,res)=>{const u=await user(req);res.json({user:u?{id:u.id,email:u.email,emailVerified:u.emailVerified}:null,operator:!!await getPilotSession(pool,req),mailMode:'operator-test-outbox',google:false,package:weddingPackage});}));
  r.post('/orders',wrap(async(req,res)=>{
    const u=await user(req);if(!u){res.sendStatus(401);return;}
    const {code,idempotencyKey,productId}=req.body||{};const billing=validateBilling(req.body?.billing,u.email);
    if(!billing || productId!==weddingPackage.id || typeof code!=='string'||!/^MB-[A-Za-z0-9_-]{32}$/.test(code)||!uuid.test(idempotencyKey||'')){res.status(400).json({error:'INVALID_ORDER'});return;}
    const client=await pool.connect();try{
      await client.query('BEGIN');
      const c=await client.query('SELECT * FROM pilot_test_codes WHERE code_hash=$1 FOR UPDATE',[digest(code)]);
      if(!c.rowCount){await client.query('ROLLBACK');res.status(400).json({error:'CODE_UNAVAILABLE'});return;}
      const previous=await client.query('SELECT id,user_id FROM pilot_test_orders WHERE code_id=$1',[c.rows[0].id]);
      if(previous.rowCount){await client.query('COMMIT');if(previous.rows[0].user_id===u.id){res.json({orderId:previous.rows[0].id,replayed:true});}else res.status(409).json({error:'CODE_UNAVAILABLE'});return;}
      if(c.rows[0].revoked_at||new Date(c.rows[0].expires_at).getTime()<=Date.now()){await client.query('ROLLBACK');res.status(400).json({error:'CODE_UNAVAILABLE'});return;}
      const sameKey=await client.query('SELECT id FROM pilot_test_orders WHERE user_id=$1 AND idempotency_key=$2',[u.id,idempotencyKey]);
      if(sameKey.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'ORDER_CONFLICT'});return;}
      const id=randomUUID();
      await client.query('INSERT INTO pilot_test_orders(id,user_id,code_id,idempotency_key,product_id,package_snapshot,billing) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,u.id,c.rows[0].id,idempotencyKey,weddingPackage.id,JSON.stringify(weddingPackage),JSON.stringify(billing)]);
      await client.query('INSERT INTO pilot_book_entitlements(order_id,user_id) VALUES($1,$2)',[id,u.id]);
      await client.query('UPDATE pilot_test_codes SET used_at=CURRENT_TIMESTAMP,used_by=$2 WHERE id=$1',[c.rows[0].id,u.id]);
      await client.query('COMMIT');res.status(201).json({orderId:id});
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }));
  r.get('/orders',wrap(async(req,res)=>{const u=await user(req);if(!u){res.sendStatus(401);return;}const result=await pool.query(`SELECT o.id,o.created_at,o.purchase_day::text,o.latest_event_day::text,e.book_id,b.title,b.starts_on::text,b.closed_at,b.finalized_at FROM pilot_test_orders o JOIN pilot_book_entitlements e ON e.order_id=o.id LEFT JOIN event_books b ON b.id=e.book_id WHERE o.user_id=$1 ORDER BY o.created_at DESC`,[u.id]);res.json({orders:result.rows});}));
  r.get('/orders/:id',wrap(async(req,res)=>{const u=await user(req);if(!u){res.sendStatus(401);return;}if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const order=await pool.query('SELECT o.id,o.billing,o.purchase_day::text,o.latest_event_day::text,e.book_id FROM pilot_test_orders o JOIN pilot_book_entitlements e ON e.order_id=o.id WHERE o.id=$1 AND o.user_id=$2',[req.params.id,u.id]);if(!order.rowCount){res.sendStatus(404);return;}
    const b=order.rows[0].book_id?await pool.query('SELECT id,title,subjects,starts_on::text,template_id,submission_start,submission_end,closed_at,finalized_at,invite_token FROM event_books WHERE id=$1 AND owner_user_id=$2',[order.rows[0].book_id,u.id]):{rows:[]};
    res.json({order:order.rows[0],book:b.rows[0]?{...b.rows[0],guest_url:origin+'/wedding/join/'+b.rows[0].invite_token}:null});
  }));
  r.post('/orders/:id/book',wrap(async(req,res)=>{const u=await user(req);if(!u){res.sendStatus(401);return;}const {title,names,date,appearance}=req.body||{};
    if(!uuid.test(String(req.params.id))||typeof title!=='string'||!title.trim()||title.length>160||typeof names!=='string'||!names.trim()||names.length>160||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||appearance!==weddingPackage.appearance){res.status(400).json({error:'INVALID_BOOK'});return;}
    const c=await pool.connect();try{await c.query('BEGIN');const entitlement=await c.query('SELECT e.book_id,o.purchase_day::text,o.latest_event_day::text FROM pilot_book_entitlements e JOIN pilot_test_orders o ON o.id=e.order_id WHERE e.order_id=$1 AND e.user_id=$2 FOR UPDATE OF e',[req.params.id,u.id]);
      if(!entitlement.rowCount){await c.query('ROLLBACK');res.sendStatus(404);return;}const e=entitlement.rows[0];
      if(date<e.purchase_day||date>e.latest_event_day){await c.query('ROLLBACK');res.status(400).json({error:'DATE_RANGE'});return;}
      const times=(await c.query("SELECT ($1::date-10)::timestamp AT TIME ZONE 'Europe/Budapest' AS start,($1::date+8)::timestamp AT TIME ZONE 'Europe/Budapest' AS finish",[date])).rows[0];
      let id=e.book_id;
      if(id){const current=(await c.query('SELECT finalized_at,first_submission_end FROM event_books WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(current.finalized_at||new Date(times.finish)>new Date(current.first_submission_end)){await c.query('ROLLBACK');res.status(409).json({error:current.finalized_at?'FINALIZED':'NO_EXTENSION'});return;}
        await c.query('UPDATE event_books SET title=$2,subjects=$3,starts_on=$4,submission_start=$5,submission_end=$6 WHERE id=$1',[id,title.trim(),JSON.stringify([{kind:'group',displayName:names.trim()}]),date,times.start,times.finish]);
      }else{id=randomUUID();await c.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,starts_on,template_id,template_version,invite_token,package_version,submission_start,submission_end,first_submission_end) VALUES($1,$2,'celebration','wedding',$3,$4,$5,'wedding-classic',1,$6,1,$7,$8,$8)`,[id,u.id,title.trim(),JSON.stringify([{kind:'group',displayName:names.trim()}]),date,randomBytes(32).toString('base64url'),times.start,times.finish]);await c.query('UPDATE pilot_book_entitlements SET book_id=$2 WHERE order_id=$1',[req.params.id,id]);}
      await c.query('COMMIT');res.json({bookId:id});
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }));
  r.post('/orders/:id/finalize',wrap(async(req,res)=>{const u=await user(req);if(!u){res.sendStatus(401);return;}if(!uuid.test(String(req.params.id))){res.sendStatus(404);return;}
    const result=await pool.query(`UPDATE event_books b SET finalized_at=COALESCE(finalized_at,CURRENT_TIMESTAMP) FROM pilot_book_entitlements e WHERE e.order_id=$1 AND e.user_id=$2 AND b.id=e.book_id AND (b.closed_at IS NOT NULL OR COALESCE(b.pilot_clock,CURRENT_TIMESTAMP)>=b.submission_end) RETURNING b.id`,[req.params.id,u.id]);if(!result.rowCount){res.status(409).json({error:'CLOSE_FIRST'});return;}res.json({finalized:true});
  }));
  // Existing invitation-backed operator access only. Buyer accounts never qualify.
  r.use('/operator',wrap(async(req,res,next)=>{if(!await getPilotSession(pool,req)){res.sendStatus(403);return;}next();}));
  r.get('/operator/codes',wrap(async(_req,res)=>{res.json({codes:(await pool.query('SELECT id,created_at,expires_at,used_at,revoked_at FROM pilot_test_codes ORDER BY created_at DESC LIMIT 100')).rows});}));
  r.post('/operator/codes',wrap(async(req,res)=>{const days=Number(req.body?.days||7);if(!Number.isInteger(days)||days<1||days>30){res.sendStatus(400);return;}const code='MB-'+randomBytes(24).toString('base64url'),id=randomUUID();const row=await pool.query("INSERT INTO pilot_test_codes(id,code_hash,expires_at) VALUES($1,$2,CURRENT_TIMESTAMP+$3*interval '1 day') RETURNING expires_at",[id,digest(code),days]);res.status(201).json({id,code,expiresAt:row.rows[0].expires_at});}));
  r.post('/operator/codes/:id/revoke',wrap(async(req,res)=>{if(!uuid.test(String(req.params.id))){res.sendStatus(400);return;}await pool.query('UPDATE pilot_test_codes SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE id=$1 AND used_at IS NULL',[req.params.id]);res.json({ok:true});}));
  r.post('/operator/clock',wrap(async(req,res)=>{const {bookId,now}=req.body||{};if(!uuid.test(bookId||'')||(now!==null&&(typeof now!=='string'||!Number.isFinite(Date.parse(now))))){res.sendStatus(400);return;}
    const updated=await pool.query('UPDATE event_books SET pilot_clock=$2 WHERE id=$1 AND package_version IS NOT NULL RETURNING id',[bookId,now]);res.status(updated.rowCount?200:404).json({ok:!!updated.rowCount});}));
  r.get('/operator/mail',wrap(async(req,res)=>{const email=String(req.query.email||'').toLowerCase();if(!email||email.length>254){res.sendStatus(400);return;}const rows=(await pool.query('SELECT id,kind,encrypted_url,created_at,expires_at FROM pilot_test_mail WHERE lower(recipient)=$1 AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 10',[email])).rows;res.json({messages:rows.map(m=>({id:m.id,kind:m.kind,url:decryptTestMail(config.secret,m.encrypted_url),expiresAt:m.expires_at})),sent:false});}));
  return r;
}

