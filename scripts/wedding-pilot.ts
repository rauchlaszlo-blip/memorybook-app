import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { localDatabaseUrl } from '../server/wedding/local-db';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';

const connectionString = localDatabaseUrl();
const lanOrigin = process.argv.find(arg => arg.startsWith('--lan-origin='))?.slice('--lan-origin='.length);
let origin = 'http://localhost:3001';
let bindHost = '127.0.0.1';
if (lanOrigin) {
  const url = new URL(lanOrigin);
  const parts = url.hostname.split('.').map(Number);
  const privateAddress = isIP(url.hostname) === 4 &&
    (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  if (!privateAddress || url.protocol !== 'http:' || url.port !== '3001' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('LAN origin must be http://<private IPv4 address>:3001');
  }
  origin = url.origin; bindHost = url.hostname;
}
const grantEmail = process.argv.find(arg => arg.startsWith('--grant-email='))?.slice('--grant-email='.length).trim().toLowerCase();
let ownerId = '';
const passwordless = process.argv.includes('--passwordless-test');
let pilotPassword = '';
if (passwordless) {
  if (grantEmail !== 'wedding-pilot@example.test') throw new Error('PASSWORDLESS_REQUIRES_FICTIONAL_PILOT_ACCOUNT');
  const saved = await readFile(new URL('../../pilot-state/pilot-login.local.txt', import.meta.url), 'utf8');
  pilotPassword = saved.match(/Jelszó: (.+)/)?.[1].trim() || '';
  if (!pilotPassword) throw new Error('LOCAL_PILOT_CREDENTIALS_MISSING');
}
if (grantEmail) {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query('SELECT id FROM users WHERE lower(email)=$1', [grantEmail]);
    if (result.rowCount !== 1) throw new Error('Register the local pilot account first, then restart with --grant-email.');
    ownerId = result.rows[0].id;
  } finally { await pool.end(); }
}

// No inherited payment, Cloudinary, OAuth, external database or .env secrets.
// dotenv cannot override the explicitly provided empty values below.
const childEnv: NodeJS.ProcessEnv = {};
for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
Object.assign(childEnv, {
  NODE_ENV: 'development', DATABASE_URL: connectionString,
  DOTENV_CONFIG_PATH: '__wedding_no_env_file__',
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  BETTER_AUTH_URL: origin, PUBLIC_APP_URL: origin,
  RENDER_EXTERNAL_URL: '', PORT: '3001', BIND_HOST: bindHost,
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
  PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_LIVE_ENABLED: 'false',
  SIMPLEPAY_MERCHANT_ID: '', SIMPLEPAY_SECRET_KEY: '', SIMPLEPAY_LIVE_ENABLED: 'false',
  TEST_PAYMENT_ALLOWED_EMAILS: '',
  WEDDING_ENABLED: process.env.WEDDING_ENABLED === 'false' ? 'false' : 'true',
  WEDDING_PILOT_CREATE_ENABLED: ownerId ? 'true' : 'false', WEDDING_PILOT_USER_IDS: ownerId,
  WEDDING_LOCAL_DATABASE_ACK: 'yes',
  WEDDING_PILOT_PASSWORDLESS: passwordless ? 'true' : 'false',
  WEDDING_PILOT_PASSWORD: pilotPassword,
});
// Prevent even incidental dotenv reads from introducing other provider keys.
// server/db and server/index call dotenv.config directly; override its config path
// through a preload in this isolated child, leaving normal app startup unchanged.
const child = spawn(process.execPath, ['--import', 'tsx', '--import', './scripts/wedding-no-dotenv.ts', 'server/index.ts'], {
  env: childEnv, stdio: 'inherit', windowsHide: true,
});
console.log(`Local pilot: ${origin}/wedding`);
if (passwordless) console.log(`Passwordless local test: ${origin}/wedding?pilot=1`);
console.log(ownerId ? 'Explicit pilot creation grant enabled. Sign in again after restart.' : 'Creation disabled. Register locally, then restart with --grant-email=<local account email>.');
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
