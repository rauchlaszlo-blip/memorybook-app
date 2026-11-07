import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export async function migrateWedding(pool: Pool) {
  const sql = await readFile(new URL('../migrations/20261106_event_guestbooks_v1.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(61106, 1)");
    await client.query(`CREATE TABLE IF NOT EXISTS wedding_schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const found = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261106-v1'");
    if (!found.rowCount) {
      await client.query(sql);
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261106-v1')");
    }
    const mediaFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261107-v2'");
    if (!mediaFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261107_event_media_v2.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261107-v2')");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
