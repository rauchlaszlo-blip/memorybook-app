import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { Pool } from 'pg';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { deploymentMcpBookIds, allowedMcpBookIds, deploymentAllowsMcpBook } from '../server/mcp/book-policy';
import { createMemorybookMcpRouter } from '../server/mcp/server';
import { migrateWedding } from '../server/wedding/migrate';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { createWorkflowService, createExportWorker, WorkflowError } from '../server/wedding/book-workflow';
import { arrange } from '../server/wedding/montage-layout';
import { defaultProfile, mockProvider } from '../shared/montage';

test('MCP deployment allowlist: production is closed by default and configuration accepts only explicit UUIDs', () => {
  const one = randomUUID(), two = randomUUID();
  assert.deepEqual(deploymentMcpBookIds({ NODE_ENV: 'production' }), []);
  assert.deepEqual(deploymentMcpBookIds({}), []);
  assert.equal(deploymentMcpBookIds({ NODE_ENV: 'test' }), null);
  assert.equal(deploymentMcpBookIds({ NODE_ENV: 'development' }), null);
  assert.deepEqual(deploymentMcpBookIds({ NODE_ENV: 'test', MEMORYBOOK_MCP_ALLOWED_BOOK_IDS: '  ' }), []);
  assert.deepEqual(deploymentMcpBookIds({ NODE_ENV: 'production', MEMORYBOOK_MCP_ALLOWED_BOOK_IDS: ` ${one.toUpperCase()} , ${one}` }), [one]);
  assert.deepEqual(allowedMcpBookIds([one, two], { NODE_ENV: 'production', MEMORYBOOK_MCP_ALLOWED_BOOK_IDS: one }), [one]);
  assert.equal(deploymentAllowsMcpBook(two, { NODE_ENV: 'production', MEMORYBOOK_MCP_ALLOWED_BOOK_IDS: one }), false);
  for (const value of ['*', `${one},`, 'all', 'not-a-uuid', 'https://example.test', Array.from({ length: 101 }, () => randomUUID()).join(',')]) {
    assert.throws(() => deploymentMcpBookIds({ NODE_ENV: 'production', MEMORYBOOK_MCP_ALLOWED_BOOK_IDS: value }), /INVALID_MCP_BOOK_ALLOWLIST/);
  }
});

test('MCP deployment allowlist excludes a second owned book from consent, old grants, tokens, tools and both download identities', async () => {
  const connectionString = localDatabaseUrl(), schema = 'mcp_allowlist_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const priorPolicy = process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS;
  const origin = 'https://memorybook-allowlist.example.test', callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const owner = { ownerId: 'fictional-allowlist-owner', kind: 'owner' as const };
  const service = createWorkflowService(pool), worker = createExportWorker(pool);
  let server: ReturnType<typeof express.application.listen> | undefined, client: Client | undefined;
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  try {
    await migrateWedding(pool);
    const books: { id: string; sourceId: string; mediaId: string; versionId: string; snapshotId: string; jobId: string }[] = [];
    const image = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#b9d1b6' } }).png().toBuffer();
    for (let i = 0; i < 2; i++) {
      const id = randomUUID(), sourceId = randomUUID(), mediaId = randomUUID();
      await pool.query(`INSERT INTO event_books(id,owner_user_id,product,event_type,title,subjects,template_id,template_version,invite_token,closed_at)
        VALUES($1,$2,'celebration','wedding',$3,'[]','wedding-classic',1,$4,CURRENT_TIMESTAMP)`, [id, owner.ownerId, `Fiktív engedélylista próba ${i + 1}`, randomUUID()]);
      await pool.query('INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message,guest_device_id) VALUES($1,$2,$3,$4,$5,$6)', [sourceId, id, randomUUID(), 'Fiktív vendég', 'Őszinte örömöt kívánunk!', 'fictional-' + i]);
      await pool.query(`INSERT INTO event_media(id,book_id,upload_key,submission_id,mime_type,original_size,sha256,width,height,state,original_bytes,preview_bytes,display_bytes,stored_size)
        VALUES($1,$2,$3,$4,'image/png',$5,$6,300,200,'attached',$7,$7,$7,$8)`, [mediaId, id, randomUUID(), sourceId, image.length, createHash('sha256').update(image).digest('hex'), image, image.length * 3]);
      const snapshot = await service.createSnapshot(owner, id, { key: randomUUID() });
      const draft = await arrange({ schema: 1, format: 'A4', spread: false, selected: [sourceId], excluded: [], profile: structuredClone(defaultProfile), pages: [{ id: randomUUID(), background: '#ffffff', locked: false, elements: [] }] }, snapshot.sources, mockProvider);
      const version = await service.saveVersion(owner, id, { key: randomUUID(), parentId: null, snapshotId: snapshot.id, draft });
      await service.approveVersion(owner, id, version.id);
      const job = await service.startExport(owner, id, { key: randomUUID(), versionId: version.id });
      await worker.runOnce(); assert.equal((await service.getExport(owner, id, job.id)).status, 'complete');
      books.push({ id, sourceId, mediaId, versionId: version.id, snapshotId: snapshot.id, jobId: job.id });
    }
    const [allowed, excluded] = books;
    process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS = allowed.id;
    const app = express(); app.use(createMemorybookMcpRouter(pool, origin, async req => req.get('x-test-owner') === owner.ownerId ? { user: { id: owner.ownerId } } : null));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
    const form = async (path: string, body: Record<string, string | string[]>, withOwner = false) => {
      const data = new URLSearchParams(); for (const [key, values] of Object.entries(body)) for (const value of Array.isArray(values) ? values : [values]) data.append(key, value);
      return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(withOwner ? { 'x-test-owner': owner.ownerId, Origin: origin } : {}) }, body: data, redirect: 'manual' });
    };
    const registered = await fetch(base + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none' }) });
    assert.equal(registered.status, 201); const clientId = (await registered.json()).client_id as string;
    const verifier = randomBytes(48).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', resource: origin + '/mcp', scope: 'memorybook:edit offline_access', state: randomUUID(), code_challenge: challenge, code_challenge_method: 'S256' });
    const response = await fetch(base + '/oauth/authorize?' + query, { headers: { 'x-test-owner': owner.ownerId } });
    assert.equal(response.status, 200); const html = await response.text();
    assert.ok(html.includes(allowed.id)); assert.ok(!html.includes(excluded.id), 'consent never offers the other owned book');
    const consent = /name="consent" value="([A-Za-z0-9_-]+)"/.exec(html)![1];
    assert.equal((await form('/oauth/authorize', { consent, bookIds: [excluded.id], decision: 'allow' }, true)).status, 403);
    assert.equal((await form('/oauth/authorize', { consent, bookIds: [allowed.id, excluded.id], decision: 'allow' }, true)).status, 403);
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM memorybook_mcp_grants')).rows[0].n), 0);
    const consentResponse = await form('/oauth/authorize', { consent, bookIds: [allowed.id], decision: 'allow' }, true);
    assert.equal(consentResponse.status, 303); const code = new URL(consentResponse.headers.get('location')!).searchParams.get('code')!;
    const tokenBody = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback, resource: origin + '/mcp', code, code_verifier: verifier };
    process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS = '';
    assert.equal((await form('/oauth/token', tokenBody)).status, 400, 'policy is rechecked when exchanging a previously issued code');
    process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS = allowed.id;
    const tokenResponse = await form('/oauth/token', tokenBody); assert.equal(tokenResponse.status, 200); const tokens = await tokenResponse.json();

    // Simulate grants/tokens issued before the deployment was narrowed to one test book.
    async function historicalGrant(bookIds: string[]) {
      const grantId = randomUUID(), access = randomBytes(32).toString('base64url'), refresh = randomBytes(32).toString('base64url'), oldCode = randomBytes(32).toString('base64url');
      await pool.query(`INSERT INTO memorybook_mcp_grants(id,owner_id,client_id,book_ids,scope,resource,expires_at)
        VALUES($1,$2,$3,$4,'memorybook:edit offline_access',$5,CURRENT_TIMESTAMP+interval '1 day')`, [grantId, owner.ownerId, clientId, bookIds, origin + '/mcp']);
      for (const [value, kind] of [[access, 'access'], [refresh, 'refresh']]) await pool.query("INSERT INTO memorybook_mcp_tokens(digest,grant_id,kind,expires_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP+interval '1 day')", [digest(value), grantId, kind]);
      await pool.query("INSERT INTO memorybook_mcp_codes(digest,grant_id,redirect_uri,challenge,expires_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP+interval '5 minutes')", [digest(oldCode), grantId, callback, challenge]);
      return { access, refresh, code: oldCode };
    }
    const broad = await historicalGrant([allowed.id, excluded.id]), denied = await historicalGrant([excluded.id]);
    assert.equal((await form('/oauth/token', { ...tokenBody, code: denied.code })).status, 400);
    assert.equal((await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, resource: origin + '/mcp', refresh_token: denied.refresh })).status, 400);
    const rpc = (access: string) => fetch(base + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + access, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal((await rpc(denied.access)).status, 401);
    client = new Client({ name: 'allowlist-test', version: '1.0.0' }); await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + broad.access } } }));
    const call = (name: string, args: Record<string, unknown> = {}) => client!.callTool({ name, arguments: args }) as Promise<CallToolResult>;
    const listed = await call('list_books'); assert.equal(listed.isError, undefined); assert.equal(listed.content[0].type, 'text');
    const listText = (listed.content[0] as { text: string }).text; assert.ok(listText.includes(allowed.id)); assert.ok(!listText.includes(excluded.id));
    assert.equal((await call('get_book', { bookId: allowed.id })).isError, undefined);
    for (const [name, args] of [
      ['get_book', { bookId: excluded.id }],
      ['list_content_flags', { bookId: excluded.id }],
      ['create_content_flag', { bookId: excluded.id, key: randomUUID(), sourceId: excluded.sourceId, categories: ['offensive_text'], reason: 'Fiktív bizonytalan kézi ellenőrzési jelzés.', scope: { kind: 'unspecified' } }],
      ['list_submissions', { bookId: excluded.id }],
      ['get_submission', { bookId: excluded.id, submissionId: excluded.sourceId }],
      ['get_media', { bookId: excluded.id, mediaId: excluded.mediaId }],
      ['get_snapshot', { bookId: excluded.id, snapshotId: excluded.snapshotId }],
      ['create_snapshot', { bookId: excluded.id, key: randomUUID() }],
      ['get_draft', { bookId: excluded.id, versionId: excluded.versionId }],
      ['get_approval', { bookId: excluded.id, versionId: excluded.versionId }],
      ['start_pdf_export', { bookId: excluded.id, versionId: excluded.versionId, key: randomUUID() }],
      ['get_export', { bookId: excluded.id, jobId: excluded.jobId }],
    ] as [string, Record<string, unknown>][]) assert.equal((await call(name, args)).isError, true, name + ' must reject a nonallowlisted owned book');
    const broadActor = { ownerId: owner.ownerId, kind: 'mcp' as const, allowedBookIds: [allowed.id, excluded.id] };
    assert.deepEqual((await service.listBooks(broadActor)).books.map(b => b.id), [allowed.id]);
    await assert.rejects(service.getBook(broadActor, excluded.id), error => error instanceof WorkflowError && error.code === 'BOOK_NOT_FOUND');
    const excludedDraft = await service.getVersion(owner, excluded.id, excluded.versionId);
    await assert.rejects(service.saveVersion(broadActor, excluded.id, { key: randomUUID(), parentId: excluded.versionId, snapshotId: excluded.snapshotId, draft: excludedDraft.draft }), error => error instanceof WorkflowError && error.code === 'BOOK_NOT_FOUND');
    for (const identity of [{ Authorization: 'Bearer ' + broad.access }, { 'x-test-owner': owner.ownerId }] as Record<string,string>[]) {
      assert.equal((await fetch(base + `/mcp/media/${allowed.id}/${allowed.mediaId}`, { headers: identity })).status, 200);
      assert.equal((await fetch(base + `/mcp/media/${excluded.id}/${excluded.mediaId}`, { headers: identity })).status, 404);
      assert.equal((await fetch(base + `/mcp/exports/${allowed.id}/${allowed.jobId}`, { headers: identity })).status, 200);
      assert.equal((await fetch(base + `/mcp/exports/${excluded.id}/${excluded.jobId}`, { headers: identity })).status, 404);
    }
    assert.equal((await fetch(base + `/api/mcp/books/${excluded.id}/grants`, { headers: { 'x-test-owner': owner.ownerId } })).status, 404);
    assert.equal((await service.getBook(owner, excluded.id)).book.id, excluded.id, 'normal owner book access is preserved');
    process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS = '';
    assert.equal((await rpc(tokens.access_token)).status, 401, 'already issued access token is disabled immediately by the deployment gate');
    assert.equal((await form('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, resource: origin + '/mcp', refresh_token: tokens.refresh_token })).status, 400);
    assert.deepEqual((await service.listBooks(broadActor)).books, []);
  } finally {
    if (client) await client.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await worker.stop();
    if (priorPolicy === undefined) delete process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS; else process.env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS = priorPolicy;
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
