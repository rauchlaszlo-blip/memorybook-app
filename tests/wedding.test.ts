import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Pool } from 'pg';
import type { Server } from 'node:http';
import { createWeddingRouter, canCreateWedding } from '../server/wedding/router';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';

const connectionString = localDatabaseUrl();
const schema = `m1_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
const env = { NODE_ENV: 'test', WEDDING_ENABLED: 'true', WEDDING_PILOT_CREATE_ENABLED: 'true', WEDDING_PILOT_USER_IDS: 'owner-a,owner-b' };
let server: Server;
let base = '';
type Json = { book: { id: string; invite_token: string; closed_at: string }; submissions: { message: string; guest_name: string }[]; books: unknown[]; event: Record<string, unknown>; accepted: boolean; replayed: boolean; error: string };
async function call(path: string, body?: unknown, user?: string) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as Json };
}
async function create(user = 'owner-a') {
  const result = await call('/books', { names: 'Ági és Örs', date: '2027-06-05' }, user);
  assert.equal(result.status, 201);
  return result.data.book;
}
const wish = () => ({ name: 'Őszinte Éva', message: 'Sok örömöt, egészséget! Árvíztűrő tükörfúrógép.', idempotencyKey: randomUUID() });

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrateWedding(pool);
  const app = express();
  // Fake identity is dependency-injected only in tests, never a production header bypass.
  app.use('/api/wedding', createWeddingRouter({ pool, env, getSession: async req => {
    const id = req.get('x-test-user'); return id ? { user: { id } } : null;
  } }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/wedding`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

test('local database guard rejects production, remote and unacknowledged targets', () => {
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: 'postgres://localhost/production', NODE_ENV: 'test', WEDDING_LOCAL_DATABASE_ACK: 'yes' }));
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: 'postgres://remote/memorybook_wedding_test', NODE_ENV: 'test', WEDDING_LOCAL_DATABASE_ACK: 'yes' }));
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: connectionString, NODE_ENV: 'production', WEDDING_LOCAL_DATABASE_ACK: 'yes' }));
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: connectionString, NODE_ENV: 'test' }));
});
test('creation requires a real session and explicit non-production allowlist', async () => {
  assert.equal((await call('/pilot-login', {})).status, 404);
  assert.equal((await call('/books', { names: 'A', date: '2027-01-01' })).status, 401);
  assert.equal((await call('/books', { names: 'A', date: '2027-01-01' }, 'other')).status, 403);
  assert.equal(canCreateWedding({ user: { id: 'owner-a' } }, { ...env, NODE_ENV: 'production' }), false);
  assert.equal(canCreateWedding({ user: { id: 'owner-a' } }, { ...env, WEDDING_PILOT_CREATE_ENABLED: 'false' }), false);
  await create();
});
test('guest submits Hungarian text; only the owner can list it', async () => {
  const book = await create();
  const payload = wish();
  assert.equal((await call(`/guest/${book.invite_token}/submissions`, payload)).status, 201);
  const owner = await call(`/books/${book.id}`, undefined, 'owner-a');
  assert.equal(owner.data.submissions[0].message, payload.message);
  assert.equal((await call(`/books/${book.id}`)).status, 401);
  assert.equal((await call(`/books/${book.id}`, undefined, 'owner-b')).status, 404);
  assert.equal((await call(`/books/${book.id}/close`, {}, 'owner-b')).status, 404);
  const guest = await call(`/guest/${book.invite_token}`);
  assert.deepEqual(Object.keys(guest.data.event).sort(), ['closed', 'starts_on', 'template_id', 'template_version', 'title']);
  assert.equal((await call(`/guest/${book.invite_token}/submissions`)).status, 404);
  assert.equal((await call('/books', undefined, 'owner-b')).data.books.length, 0);
  const row = await pool.query('SELECT occurred_on FROM event_submissions WHERE book_id=$1', [book.id]);
  assert.equal(row.rows[0].occurred_on, null);
});
test('invalid token and foreign product cannot be used', async () => {
  assert.equal((await call('/guest/not-a-token/submissions', wish())).status, 404);
  assert.equal((await call(`/guest/${'x'.repeat(43)}/submissions`, wish())).status, 404);
  const book = await create();
  await pool.query("UPDATE event_books SET event_type='birthday' WHERE id=$1", [book.id]);
  assert.equal((await call(`/guest/${book.invite_token}`)).status, 404);
  assert.equal((await call(`/guest/${book.invite_token}/submissions`, wish())).status, 404);
  assert.equal((await call(`/books/${book.id}`, undefined, 'owner-a')).status, 404);
});
test('parallel retry, changed payload, and replay after closure', async () => {
  const book = await create(); const payload = wish(); const url = `/guest/${book.invite_token}/submissions`;
  const results = await Promise.all(Array.from({ length: 6 }, () => call(url, payload)));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 200 && r.data.replayed).length, 5);
  assert.equal((await call(url, { ...payload, message: 'Másik szöveg' })).status, 409);
  await call(`/books/${book.id}/close`, {}, 'owner-a');
  assert.equal((await call(url, payload)).status, 200);
  assert.equal((await call(url, wish())).status, 410);
  assert.equal((await call(url, { ...payload, message: 'Megváltozott' })).status, 409);
  assert.equal((await call(`/books/${book.id}`, undefined, 'owner-a')).data.submissions.length, 1);
});
test('database unique constraint and foreign key protect submissions', async () => {
  const book = await create(); const payload = wish();
  await call(`/guest/${book.invite_token}/submissions`, payload);
  await assert.rejects(pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), book.id, payload.idempotencyKey, 'x', 'x']), { code: '23505' });
  await assert.rejects(pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), randomUUID(), randomUUID(), 'x', 'x']), { code: '23503' });
});
test('closure wins a race when it locks first; no late insert', async () => {
  const book = await create(); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE event_books SET closed_at=CURRENT_TIMESTAMP WHERE id=$1', [book.id]);
    const pending = call(`/guest/${book.invite_token}/submissions`, wish());
    await client.query('COMMIT');
    assert.equal((await pending).status, 410);
    assert.equal((await pool.query('SELECT id FROM event_submissions WHERE book_id=$1', [book.id])).rowCount, 0);
  } finally { client.release(); }
});
test('submission and owner closure concurrently serialize without duplicates', async () => {
  const book = await create(); const payload = wish();
  const [submitted, closed] = await Promise.all([
    call(`/guest/${book.invite_token}/submissions`, payload), call(`/books/${book.id}/close`, {}, 'owner-a'),
  ]);
  assert.equal(closed.status, 200); assert.ok([201, 410].includes(submitted.status));
  assert.equal((await pool.query('SELECT id FROM event_submissions WHERE book_id=$1', [book.id])).rowCount, submitted.status === 201 ? 1 : 0);
  assert.equal((await call(`/guest/${book.invite_token}/submissions`, wish())).status, 410);
});
test('bad lengths/types/dates rejected, HTML stored only as data', async () => {
  const book = await create(); const url = `/guest/${book.invite_token}/submissions`;
  for (const patch of [{ name: '' }, { name: 'x'.repeat(101) }, { message: 'x'.repeat(4001) }, { message: {} }, { message: '\u0000' }, { idempotencyKey: 'bad' }]) {
    assert.equal((await call(url, { ...wish(), ...patch })).status, 400);
  }
  const payload = { ...wish(), message: '<script>alert(1)</script>' };
  assert.equal((await call(url, payload)).status, 201);
  assert.equal((await call(`/books/${book.id}`, undefined, 'owner-a')).data.submissions[0].message, payload.message);
  assert.equal((await call('/books', { names: 'x', date: '2027-02-30' }, 'owner-a')).status, 400);
  assert.equal((await call('/books', { names: 'x', date: '0000-01-01' }, 'owner-a')).status, 400);
});
test('malformed/oversized bodies and cross-origin writes rejected', async () => {
  const malformed = await fetch(base + '/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'INVALID_SUBMISSION' });
  const huge = await fetch(base + '/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(33_000) }) });
  assert.equal(huge.status, 413);
  const cross = await fetch(base + '/books', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.invalid', 'x-test-user': 'owner-a' }, body: JSON.stringify({ names: 'x', date: '2027-01-01' }) });
  assert.equal(cross.status, 403);
});
test('feature switch blocks all read and write operations', async () => {
  env.WEDDING_ENABLED = 'false';
  try {
    for (const [path, body] of [['/capabilities', undefined], ['/books', undefined], ['/books', {}], ['/guest/invalid/submissions', wish()], [`/books/${randomUUID()}/close`, {}]] as const) {
      assert.equal((await call(path, body, 'owner-a')).status, 404);
    }
  } finally { env.WEDDING_ENABLED = 'true'; }
});
test('migration preserves legacy books on first run and on repeat', async () => {
  const legacySchema = `${schema}_legacy`;
  await admin.query(`CREATE SCHEMA ${legacySchema}`);
  const old = new Pool({ connectionString, options: `-c search_path=${legacySchema}` });
  try {
    await old.query("CREATE TABLE books(id TEXT PRIMARY KEY, book_type TEXT, title TEXT); INSERT INTO books VALUES ('legacy','standard','Régi könyv')");
    const before = await old.query('SELECT * FROM books');
    await migrateWedding(old); await migrateWedding(old);
    assert.deepEqual((await old.query('SELECT * FROM books')).rows, before.rows);
    assert.deepEqual((await old.query('SELECT version FROM wedding_schema_migrations ORDER BY version')).rows.map(row => row.version), ['20261106-v1','20261107-v2','20261107-v3','20261107-v4']);
  } finally { await old.end(); await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`); }
});
test('repeat migration preserves new data as well', async () => {
  const before = await pool.query('SELECT * FROM event_books ORDER BY id');
  await migrateWedding(pool);
  assert.deepEqual((await pool.query('SELECT * FROM event_books ORDER BY id')).rows, before.rows);
});
test('request throttling eventually rejects excess traffic', async () => {
  let limited = false;
  for (let i = 0; i < 65; i++) {
    if ((await call('/guest/invalid/submissions', wish())).status === 429) { limited = true; break; }
  }
  assert.equal(limited, true);
});
