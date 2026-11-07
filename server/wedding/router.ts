import { Router, json } from 'express';
import type { Request, RequestHandler, ErrorRequestHandler } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { weddingTemplate } from '../../shared/event-templates';
import { localDatabaseUrl } from './local-db';

export type WeddingSession = { user: { id: string; email?: string | null } } | null;
export interface WeddingOptions {
  pool: Pool;
  getSession: (request: Request) => Promise<WeddingSession>;
  env?: NodeJS.ProcessEnv;
  loginPilot?: () => Promise<Response>;
  publicOrigin?: string;
  allowPilotOwner?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const productFilter = "product = 'celebration' AND event_type = 'wedding' AND template_id = 'wedding-classic' AND template_version = 1";
const ownerColumns = 'id, title, subjects, starts_on::text, ends_on::text, template_id, template_version, closed_at, created_at, invite_token';

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || Array.from(text).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) return null;
  return text;
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function canCreateWedding(session: WeddingSession, env: NodeJS.ProcessEnv): boolean {
  return !!session && ['development', 'test'].includes(env.NODE_ENV || '') &&
    env.WEDDING_PILOT_CREATE_ENABLED === 'true' &&
    (env.WEDDING_PILOT_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(session.user.id);
}

export function createWeddingRouter({ pool, getSession, env = process.env, loginPilot, publicOrigin, allowPilotOwner }: WeddingOptions) {
  const router = Router();
  const canCreate = (session: WeddingSession) => canCreateWedding(session, env) ||
    (!!allowPilotOwner && session?.user.id === allowPilotOwner);
  const withLink = (book: Record<string, unknown>) => publicOrigin
    ? { ...book, guest_url: publicOrigin + '/wedding/join/' + book.invite_token } : book;
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (env.WEDDING_ENABLED !== 'true') { res.status(404).json({ error: 'WEDDING_DISABLED' }); return; }
    next();
  });
  router.use(json({ limit: '32kb' }));
  router.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = new Set([`${req.protocol}://${req.get('host')}`, env.PUBLIC_APP_URL, env.BETTER_AUTH_URL]);
    if (['development', 'test'].includes(env.NODE_ENV || '')) {
      allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173');
    }
    if (req.method !== 'GET' && origin && !allowed.has(origin)) {
      res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' }); return;
    }
    next();
  });
  // Bound memory; shared IPs get a generous read budget, writes have a separate budget.
  const buckets = new Map<string, { count: number; until: number }>();
  router.use((req, res, next) => {
    const now = Date.now();
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    const key = `${req.ip}:${req.method === 'GET' ? 'read' : 'write'}`;
    const entry = buckets.get(key) || { count: 0, until: now + 60_000 };
    if (!buckets.has(key) && buckets.size >= 10_000) { res.status(429).json({ error: 'RATE_LIMITED' }); return; }
    buckets.set(key, entry);
    entry.count++;
    if (entry.count > (req.method === 'GET' ? 300 : 60)) {
      res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
      res.status(429).json({ error: 'RATE_LIMITED' }); return;
    }
    next();
  });
  const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await fn(req, res, next); } catch {
      // Never log guest text, tokens, database connection strings or session data.
      res.status(500).json({ error: 'WEDDING_REQUEST_FAILED' });
    }
  };
  router.post('/pilot-login', handle(async (_req, res) => {
    if (env.WEDDING_PILOT_PASSWORDLESS !== 'true' || !env.WEDDING_PILOT_PASSWORD || !loginPilot) {
      res.status(404).json({ error: 'NOT_FOUND' }); return;
    }
    try { localDatabaseUrl(env); } catch { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    const owner = await pool.query('SELECT id FROM users WHERE email=$1', ['wedding-pilot@example.test']);
    if (owner.rowCount !== 1 || !canCreateWedding({ user: { id: owner.rows[0].id } }, env)) {
      res.status(403).json({ error: 'PILOT_ACCESS_REQUIRED' }); return;
    }
    const response = await loginPilot();
    if (!response.ok) { res.status(503).json({ error: 'PILOT_LOGIN_FAILED' }); return; }
    const cookies = response.headers.getSetCookie();
    if (!cookies.length) { res.status(503).json({ error: 'PILOT_LOGIN_FAILED' }); return; }
    res.setHeader('Set-Cookie', cookies);
    res.json({ success: true });
  }));
  router.get('/capabilities', handle(async (req, res) => {
    const session = await getSession(req);
    res.json({ enabled: true, authenticated: !!session, internetPilot: !!allowPilotOwner, canCreate: canCreate(session) });
  }));
  router.get('/books', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    const result = await pool.query(`SELECT ${ownerColumns} FROM event_books WHERE owner_user_id = $1 AND ${productFilter} ORDER BY created_at DESC`, [session.user.id]);
    res.json({ books: result.rows.map(withLink) });
  }));
  router.post('/books', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!canCreate(session)) { res.status(403).json({ error: 'PILOT_ACCESS_REQUIRED' }); return; }
    const names = cleanText(req.body?.names, 160);
    const date = req.body?.date;
    if (!names || !validDate(date)) { res.status(400).json({ error: 'INVALID_BOOK' }); return; }
    const result = await pool.query(`INSERT INTO event_books
      (id, owner_user_id, product, event_type, title, subjects, starts_on, template_id, template_version, invite_token)
      VALUES ($1,$2,'celebration',$7,$3,$4,$5,$8,$9,$6) RETURNING ${ownerColumns}`,
    [randomUUID(), session.user.id, names, JSON.stringify([{ displayName: names, kind: 'group' }]), date, randomBytes(32).toString('base64url'), weddingTemplate.eventType, weddingTemplate.id, weddingTemplate.version]);
    res.status(201).json({ book: withLink(result.rows[0]) });
  }));
  router.get('/books/:id', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!uuid.test(String(req.params.id))) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    const book = await pool.query(`SELECT ${ownerColumns} FROM event_books WHERE id=$1 AND owner_user_id=$2 AND ${productFilter}`, [req.params.id, session.user.id]);
    if (!book.rowCount) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    const submissions = await pool.query('SELECT id, guest_name, message, created_at, occurred_on::text FROM event_submissions WHERE book_id=$1 ORDER BY created_at DESC, id', [req.params.id]);
    res.json({ book: withLink(book.rows[0]), submissions: submissions.rows });
  }));
  router.post('/books/:id/close', handle(async (req, res) => {
    const session = await getSession(req);
    if (!session) { res.status(401).json({ error: 'UNAUTHENTICATED' }); return; }
    if (!uuid.test(String(req.params.id))) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    // UPDATE takes the same row lock as submission; whichever obtains it first wins.
    const result = await pool.query(`UPDATE event_books SET closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP)
      WHERE id=$1 AND owner_user_id=$2 AND ${productFilter} RETURNING ${ownerColumns}`, [req.params.id, session.user.id]);
    if (!result.rowCount) { res.status(404).json({ error: 'BOOK_NOT_FOUND' }); return; }
    res.json({ book: withLink(result.rows[0]) });
  }));
  router.get('/guest/:token', handle(async (req, res) => {
    if (!tokenPattern.test(String(req.params.token))) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    const result = await pool.query(`SELECT title, starts_on::text, template_id, template_version, closed_at IS NOT NULL AS closed
      FROM event_books WHERE invite_token=$1 AND ${productFilter}`, [req.params.token]);
    if (!result.rowCount) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    res.json({ event: result.rows[0] });
  }));
  router.post('/guest/:token/submissions', handle(async (req, res) => {
    const name = cleanText(req.body?.name, 100);
    const message = cleanText(req.body?.message, 4000);
    const key: unknown = req.body?.idempotencyKey;
    if (!tokenPattern.test(String(req.params.token))) { res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
    if (!name || !message || typeof key !== 'string' || !uuid.test(key)) { res.status(400).json({ error: 'INVALID_SUBMISSION' }); return; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const book = await client.query(`SELECT id, closed_at FROM event_books WHERE invite_token=$1 AND ${productFilter} FOR UPDATE`, [req.params.token]);
      if (!book.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'INVITE_NOT_FOUND' }); return; }
      const prior = await client.query('SELECT guest_name, message FROM event_submissions WHERE book_id=$1 AND idempotency_key=$2', [book.rows[0].id, key]);
      if (prior.rowCount) {
        await client.query('COMMIT');
        if (prior.rows[0].guest_name !== name || prior.rows[0].message !== message) {
          res.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' }); return;
        }
        // A committed request can be acknowledged even after closure; no new write.
        res.json({ accepted: true, replayed: true }); return;
      }
      if (book.rows[0].closed_at) { await client.query('ROLLBACK'); res.status(410).json({ error: 'SUBMISSIONS_CLOSED' }); return; }
      await client.query(`INSERT INTO event_submissions(id,book_id,idempotency_key,guest_name,message)
        VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), book.rows[0].id, key, name, message]);
      await client.query('COMMIT');
      res.status(201).json({ accepted: true, replayed: false });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }));
  router.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  const invalidBody: ErrorRequestHandler = (error: { status?: number }, _req, res, _next) => {
    void _next;
    res.status(error.status === 413 ? 413 : 400).json({ error: 'INVALID_SUBMISSION' });
  };
  router.use(invalidBody);
  return router;
}
