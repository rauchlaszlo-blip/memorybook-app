import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { migrateMcp } from '../mcp/schema';

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
    const annotationFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261107-v3'");
    if (!annotationFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261107_event_annotation_v3.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261107-v3')");
    }
    const commerceFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261107-v4'");
    if (!commerceFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261107_event_commerce_v4.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261107-v4')");
    }
    const montageFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261107-v5'");
    if (!montageFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261107_event_montage_v5.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261107-v5')");
    }
    const workflowFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261117-v6'");
    if (!workflowFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261117_book_workflow_v6.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261117-v6')");
    }
    const reviewFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261117-v7'");
    if (!reviewFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261117_content_review_v7.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261117-v7')");
    }
    const avFound = await client.query("SELECT version FROM wedding_schema_migrations WHERE version = '20261117-v8'");
    if (!avFound.rowCount) {
      await client.query(await readFile(new URL('../migrations/20261117_event_av_v8.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO wedding_schema_migrations(version) VALUES ('20261117-v8')");
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  await migrateMcp(pool);
}
