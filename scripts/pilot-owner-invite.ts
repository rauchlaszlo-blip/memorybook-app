import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { pilotConfig } from '../server/pilot/config';
import { issueInvite } from '../server/pilot/auth';

// DATABASE_URL must be supplied securely for this dedicated test database only.
// External Render connections require certificate-verified TLS.
const config = pilotConfig(process.env);
const host = new URL(config.databaseUrl).hostname;
const pool = new Pool({ connectionString: config.databaseUrl,
  ssl: host.endsWith('.render.com') ? { rejectUnauthorized: true } : undefined, max: 1 });
try {
  const invite = await issueInvite(pool, 60);
  await writeFile('pilot-owner-invite.local', JSON.stringify({
    url: `${config.origin}/wedding/owner-invite#invite=${invite.token}`,
    expiresAt: invite.expiresAt,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  console.log('One-hour invitation saved to ignored pilot-owner-invite.local. Do not publish or commit it.');
} finally { await pool.end(); }
