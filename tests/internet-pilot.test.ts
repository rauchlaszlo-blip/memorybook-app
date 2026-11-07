import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Server } from 'node:http';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { migrateWedding } from '../server/wedding/migrate';
import { migratePilot, issueInvite, digest, cookieName, seedOperatorInvite, newToken } from '../server/pilot/auth';
import { createPilotApp } from '../server/pilot/app';
import { pilotConfig } from '../server/pilot/config';
const connectionString = localDatabaseUrl();
const schema = `internet_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
const origin = 'https://isolated-pilot.onrender.com';
let server: Server;
let base: string;
let cookie: string;
async function call(path: string, body?: unknown, session?: string, requestOrigin: string | null = origin) {
  return fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(session ? { Cookie: session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); await migrateWedding(pool); await migratePilot(pool);
  server = createPilotApp(pool, origin).listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
});
test('dedicated runtime fails closed for wrong DB, origin and local bypass flags', () => {
  const env = { MEMORYBOOK_INTERNET_PILOT: 'isolated-text-v1', PILOT_DATABASE_ACK: 'isolated-fictional-only', DATABASE_URL: 'postgresql://db/memorybook_wedding_internet_pilot', PUBLIC_APP_URL: origin };
  assert.equal(pilotConfig(env).origin, origin);
  for (const patch of [{DATABASE_URL:'postgresql://db/production'}, {PUBLIC_APP_URL:'http://localhost:3001'}, {WEDDING_PILOT_PASSWORDLESS:'true'}, {PILOT_DATABASE_ACK:''}]) assert.throws(() => pilotConfig({...env,...patch}));
});
test('guest, legacy login and pilot=1 cannot confer owner access', async () => {
  assert.equal((await call('/api/wedding/books')).status, 401);
  assert.equal((await call('/api/wedding/pilot-login', {})).status, 404);
  assert.equal((await call('/api/auth/sign-up/email', {})).status, 404);
  assert.equal((await (await call('/api/wedding/capabilities?pilot=1')).json()).authenticated, false);
  assert.equal((await call('/api/pilot/redeem', {token:'x'.repeat(43)})).status, 401);
});
test('expired invite, cross-origin and missing Origin are rejected', async () => {
  const invite = await issueInvite(pool);
  assert.equal((await call('/api/pilot/redeem', {token:invite.token}, undefined, 'https://evil.example')).status, 403);
  assert.equal((await call('/api/pilot/redeem', {token:invite.token}, undefined, null)).status, 403);
  await pool.query("UPDATE pilot_owner_invites SET expires_at=CURRENT_TIMESTAMP - interval '1 second' WHERE token_hash=$1", [digest(invite.token)]);
  assert.equal((await call('/api/pilot/redeem', {token:invite.token})).status, 401);
});
test('GET cannot consume invite; concurrent redemption creates only one secure session', async () => {
  const invite = await issueInvite(pool);
  assert.equal((await call('/api/pilot/redeem')).status, 404);
  const results = await Promise.all([call('/api/pilot/redeem',{token:invite.token}),call('/api/pilot/redeem',{token:invite.token})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
  const setCookie = results.find(r=>r.status===200)!.headers.get('set-cookie')!;
  for(const marker of ['HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(setCookie.includes(marker));
  cookie=setCookie.split(';')[0];
  assert.ok(cookie.startsWith(cookieName+'='));
  assert.equal((await (await call('/api/wedding/capabilities',undefined,cookie)).json()).canCreate,true);
  assert.equal((await call('/api/wedding/books',undefined,cookie+'tampered')).status,401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_owner_sessions')).rows[0].n,1);
});
test('HTTPS canonical guest URL, anonymous writes, private list, dedup and close', async () => {
  const created=await call('/api/wedding/books',{names:'Fiktív Ági és Örs',date:'2027-06-05'},cookie);
  assert.equal(created.status,201);const {book}=await created.json();
  assert.equal(book.guest_url,`${origin}/wedding/join/${book.invite_token}`);
  const path=`/api/wedding/guest/${book.invite_token}/submissions`;
  const wish={name:'Teszt Éva',message:'Árvíztűrő tükörfúrógép – sok örömöt!',idempotencyKey:randomUUID()};
  const results=await Promise.all([call(path,wish),call(path,wish)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  assert.equal((await call(`/api/wedding/books/${book.id}`)).status,401);
  const detail=await (await call(`/api/wedding/books/${book.id}`,undefined,cookie)).json();
  assert.equal(detail.submissions.length,1); assert.equal(detail.submissions[0].message,wish.message);
  assert.equal((await call(`/api/wedding/books/${book.id}/close`,{},cookie)).status,200);
  assert.equal((await call(path,{...wish,idempotencyKey:randomUUID()})).status,410);
  assert.equal((await call(path,wish)).status,200);
  await pool.query("UPDATE pilot_owner_sessions SET expires_at=CURRENT_TIMESTAMP - interval '1 second'");
  assert.equal((await call('/api/wedding/books',undefined,cookie)).status,401);
});

test('operator hash bootstrap is idempotent and never revives a consumed invite', async () => {
  const token = newToken();
  const env = { PILOT_OWNER_INVITE_HASH: digest(token), PILOT_OWNER_INVITE_EXPIRES_AT: new Date(Date.now()+3600000).toISOString() };
  await seedOperatorInvite(pool, env);
  assert.equal((await call('/api/pilot/redeem',{token})).status,200);
  await seedOperatorInvite(pool, env);
  assert.equal((await call('/api/pilot/redeem',{token})).status,401);
  await assert.rejects(seedOperatorInvite(pool,{...env,PILOT_OWNER_INVITE_EXPIRES_AT:new Date(Date.now()+2*86400000).toISOString()}));
});
