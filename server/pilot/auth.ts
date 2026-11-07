import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { Request } from 'express';

export const ownerId = 'wedding-internet-pilot-owner';
export const cookieName = '__Host-memorybook-pilot';
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function migratePilot(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS pilot_owner_invites (
    token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS pilot_owner_sessions (
    token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  );`);
}
export async function issueInvite(pool: Pool, minutes = 60) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Invalid invite lifetime');
  const token = newToken();
  const result = await pool.query(`INSERT INTO pilot_owner_invites(token_hash,owner_id,expires_at)
    VALUES ($1,$2,CURRENT_TIMESTAMP + $3 * interval '1 minute') RETURNING expires_at`, [digest(token), ownerId, minutes]);
  return { token, expiresAt: result.rows[0].expires_at };
}
export async function redeemInvite(pool: Pool, token: unknown) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invite = await client.query(`UPDATE pilot_owner_invites SET used_at=CURRENT_TIMESTAMP
      WHERE token_hash=$1 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP AND owner_id=$2 RETURNING owner_id`, [digest(token), ownerId]);
    if (!invite.rowCount) { await client.query('ROLLBACK'); return null; }
    const session = newToken();
    await client.query(`INSERT INTO pilot_owner_sessions(token_hash,owner_id,expires_at)
      VALUES ($1,$2,CURRENT_TIMESTAMP + interval '7 days')`, [digest(session), ownerId]);
    await client.query('COMMIT');
    return session;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function getPilotSession(pool: Pool, request: Request) {
  const tokens = (request.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${cookieName}=`));
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice(cookieName.length + 1);
  if (!tokenPattern.test(token)) return null;
  const result = await pool.query(`SELECT owner_id FROM pilot_owner_sessions
    WHERE token_hash=$1 AND expires_at>CURRENT_TIMESTAMP AND owner_id=$2`, [digest(token), ownerId]);
  return result.rowCount ? { user: { id: result.rows[0].owner_id } } : null;
}

// Operator-provisioned hash only; no public invitation creation endpoint.
export async function seedOperatorInvite(pool: Pool, env: NodeJS.ProcessEnv) {
  const hash = env.PILOT_OWNER_INVITE_HASH;
  const expiry = env.PILOT_OWNER_INVITE_EXPIRES_AT;
  if (!hash && !expiry) return;
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !expiry || !Number.isFinite(Date.parse(expiry))) throw new Error('Invalid operator invitation');
  if (Date.parse(expiry) <= Date.now()) return;
  if (Date.parse(expiry) > Date.now() + 86400_000) throw new Error('Invitation lifetime exceeds 24 hours');
  await pool.query(`INSERT INTO pilot_owner_invites(token_hash,owner_id,expires_at)
    VALUES ($1,$2,$3) ON CONFLICT (token_hash) DO NOTHING`, [hash, ownerId, expiry]);
}
