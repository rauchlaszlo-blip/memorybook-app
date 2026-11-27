import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import sharp from 'sharp';
import { initializeCollectionFixture, seedCollectionPage } from './collection-fixture';
import { createCollectionService } from '../server/collection/service';

test('real PostgreSQL dump/restore preserves originals, partial chunks, relations and editable snapshots', { skip: !process.env.COLLECTION_TEST_DATABASE_URL || !process.env.COLLECTION_PG_BIN }, async () => {
  const url = new URL(process.env.COLLECTION_TEST_DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only a local test server is allowed');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12), sourceName = `collection_backup_${suffix}`, targetName = `collection_restore_${suffix}`;
  const admin = new Pool({ connectionString: url.href }), pools: Pool[] = [], created: string[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'memorybook-backup-test-'));
  try {
    for (const name of [sourceName, targetName]) {
      assert.match(name, /^collection_(?:backup|restore)_[a-f0-9]{12}$/);
      await admin.query(`CREATE DATABASE "${name}"`); created.push(name);
      const address = new URL(url); address.pathname = '/' + name;
      pools.push(new Pool({ connectionString: address.href }));
    }
    const [source, restored] = pools;
    await initializeCollectionFixture(source);
    const page = await seedCollectionPage(source), service = createCollectionService(source), actor = { token: page.token };
    const original = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aa44cc' } }).jpeg().toBuffer();
    const digest = createHash('sha256').update(original).digest('hex'), fileId = randomUUID();
    await service.begin(actor, { id: fileId, kind: 'photo', fileName: 'fictitious.jpg', mimeType: 'image/jpeg', byteLength: original.length, sha256: digest });
    await service.chunk(actor, fileId, 0, original); await service.complete(actor, fileId);
    const receipt = await service.commit(actor, { key: randomUUID(), expectedVersion: 1, eventIds: [], locationIds: [], authorShareApproved: false, previewDataUrl: 'data:image/jpeg;base64,' + original.toString('base64') });
    const partialPage = await seedCollectionPage(source, { bookId: page.bookId });
    const incomplete = Buffer.alloc(300_000, 19), partialId = randomUUID();
    await service.begin({ token: partialPage.token }, { id: partialId, kind: 'audio', fileName: 'interrupted.wav', mimeType: 'audio/wav', byteLength: incomplete.length, sha256: createHash('sha256').update(incomplete).digest('hex') });
    await service.chunk({ token: partialPage.token }, partialId, 0, incomplete.subarray(0, 262144));
    const filename = join(directory, 'synthetic.dump');
    const executable = (name: string) => join(process.env.COLLECTION_PG_BIN!, name + (process.platform === 'win32' ? '.exe' : ''));
    const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
    await promisify(execFile)(executable('pg_dump'), ['--format=custom', '--no-owner', '--no-acl', '--file', filename, sourceName], { env, windowsHide: true, timeout: 60_000 });
    await promisify(execFile)(executable('pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', targetName, filename], { env, windowsHide: true, timeout: 60_000 });
    const restarted = createCollectionService(restored);
    const downloaded = await restarted.bytes({ ownerId: page.ownerId, bookId: page.bookId }, fileId, 'original');
    assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), digest);
    const recovered = await restarted.bootstrap(actor);
    assert.equal(recovered.receipt!.submissionId, receipt.submissionId);
    const list = await restarted.ownerList({ ownerId: page.ownerId, bookId: page.bookId });
    assert.equal(list.sessions[0].canvasData.objects[0].text, 'Árvíztűrő üzenet');
    assert.equal(list.sessions[0].canvasData.objects[1].type, 'Path');
    assert.deepEqual((await restarted.status({ token: partialPage.token }, partialId)).file.receivedChunks, [0]);
    assert.equal((await restored.query('SELECT count(*)::int n FROM collection_files')).rows[0].n, 2);
  } finally {
    await Promise.all(pools.map(pool => pool.end()));
    for (const name of created.reverse()) {
      assert.match(name, /^collection_(?:backup|restore)_[a-f0-9]{12}$/);
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
    if (resolve(dirname(directory)) === resolve(tmpdir()) && basename(directory).startsWith('memorybook-backup-test-')) await rm(directory, { recursive: true, force: true });
  }
});
