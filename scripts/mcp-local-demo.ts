// Loopback-only, fictional pilot. Does not read .env or connect to a hosted database.
import {Pool} from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
import {localDatabaseUrl} from '../server/wedding/local-db';
import {migrateWedding} from '../server/wedding/migrate';
import {migratePilot} from '../server/pilot/auth';
import {createCommerceAuth} from '../server/pilot/commerce-auth';
import {createPilotApp} from '../server/pilot/app';
import {seedMcpBook} from '../tests/fixtures/mcp-book';
import {createExportWorker,createWorkflowService} from '../server/wedding/book-workflow';
import {randomUUID,createHash} from 'node:crypto';
import {arrange} from '../server/wedding/montage-layout';
import {defaultProfile,mockProvider} from '../shared/montage';
import type {Draft} from '../shared/montage';
import {weddingPackage} from '../shared/wedding-package';
import {migrateMcp} from '../server/mcp/schema';

const connectionString=localDatabaseUrl(),schema='mcp_fictional_demo_20261117';
const admin=new Pool({connectionString});
await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);await admin.end();
const pool=new Pool({connectionString,options:`-c search_path=${schema}`});
await migrateWedding(pool);await migratePilot(pool);await migrateMcp(pool);
const origin='http://127.0.0.1:5190',commerce=await createCommerceAuth(pool,origin),email='mcp-pilot@example.test';
let owner=(await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
if(!owner){await commerce.auth.api.signUpEmail({body:{email,password:'memorybook-pilot',name:'Fiktív könyvtulajdonos'}});owner=(await pool.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];}
let book=(await pool.query('SELECT id FROM event_books WHERE owner_user_id=$1 ORDER BY created_at LIMIT 1',[owner.id])).rows[0];
if(!book){
  const fixture=await seedMcpBook(pool,owner.id);book={id:fixture.bookId};
  await pool.query('UPDATE event_books SET closed_at=NULL WHERE id=$1',[book.id]);
  const workflow=createWorkflowService(pool),actor={ownerId:owner.id as string,kind:'owner' as const};
  const snapshot=await workflow.createSnapshot(actor,book.id,{key:randomUUID(),selectedIds:fixture.submissionIds});
  const blank:Draft={schema:1,format:'A4',spread:false,selected:fixture.submissionIds,excluded:[],profile:structuredClone(defaultProfile),pages:[{id:randomUUID(),background:'#fffaf4',locked:false,elements:[]}]};
  // Reproducible sample only, clearly not a claim that ChatGPT was connected.
  const draft=await arrange(blank,snapshot.sources,mockProvider);
  await workflow.saveVersion(actor,book.id,{key:randomUUID(),parentId:null,snapshotId:snapshot.id as string,draft});
}
// A zero-value fictional entitlement makes the seeded book appear in the
// existing account/QR journey as well. No checkout provider is invoked.
if(!(await pool.query('SELECT order_id FROM pilot_book_entitlements WHERE book_id=$1',[book.id])).rowCount){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');const codeId=randomUUID(),orderId=randomUUID();
    await client.query("INSERT INTO pilot_test_codes(id,code_hash,expires_at,used_at,used_by) VALUES($1,$2,CURRENT_TIMESTAMP+interval '30 days',CURRENT_TIMESTAMP,$3)",[codeId,createHash('sha256').update(randomUUID()).digest('hex'),owner.id]);
    await client.query("INSERT INTO pilot_test_orders(id,user_id,code_id,idempotency_key,product_id,package_snapshot,billing) VALUES($1,$2,$3,$4,'wedding',$5,$6)",[orderId,owner.id,codeId,randomUUID(),JSON.stringify(weddingPackage),JSON.stringify({kind:'person',name:'Fiktív könyvtulajdonos',email,postalCode:'0000',city:'Fiktív város',address:'Fiktív utca 1.'})]);
    await client.query('INSERT INTO pilot_book_entitlements(order_id,user_id,book_id) VALUES($1,$2,$3)',[orderId,owner.id,book.id]);
    await client.query("UPDATE event_books SET subjects='[{\"kind\":\"group\",\"displayName\":\"Lili és Márk – fiktív\"}]',submission_start='2026-11-01T00:00:00+01:00',submission_end='2026-12-18T00:00:00+01:00',first_submission_end='2026-12-18T00:00:00+01:00' WHERE id=$1 AND submission_start IS NULL",[book.id]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
const worker=createExportWorker(pool);worker.start();
const app=createPilotApp(pool,origin,commerce),server=app.listen(5190,'127.0.0.1',()=>console.log(`Fiktív MCP-pilot: ${origin}/wedding/books/${book.id}/montage`));
await mkdir('test-results/mcp-pilot',{recursive:true});
await writeFile('test-results/mcp-pilot/demo.json',JSON.stringify({origin,email,schema,bookId:book.id,url:`${origin}/wedding/books/${book.id}/montage`,accountUrl:`${origin}/pilot/account`,mcpUrl:`${origin}/mcp`,fictional:true},null,2));
let closing=false;
async function close(){if(closing)return;closing=true;await worker.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
