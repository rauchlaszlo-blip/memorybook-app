import type { Pool } from 'pg';

/** Additive isolated pilot OAuth storage. Only digests of bearer secrets are stored. */
export async function migrateMcp(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(61117,6)');
    await client.query(`
    CREATE TABLE IF NOT EXISTS memorybook_mcp_clients (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS memorybook_mcp_pending (
      digest TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS memorybook_mcp_grants (
      id UUID PRIMARY KEY, owner_id TEXT NOT NULL,
      client_id TEXT NOT NULL REFERENCES memorybook_mcp_clients(id),
      book_ids UUID[] NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS memorybook_mcp_grants_owner ON memorybook_mcp_grants(owner_id);
    CREATE TABLE IF NOT EXISTS memorybook_mcp_codes (
      digest TEXT PRIMARY KEY, grant_id UUID NOT NULL REFERENCES memorybook_mcp_grants(id),
      redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS memorybook_mcp_tokens (
      digest TEXT PRIMARY KEY, grant_id UUID NOT NULL REFERENCES memorybook_mcp_grants(id),
      kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS memorybook_mcp_audit (
      id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      owner_id TEXT, grant_id UUID, action TEXT NOT NULL, book_id UUID,
      outcome TEXT NOT NULL
    );
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
