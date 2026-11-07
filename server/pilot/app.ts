import express from 'express';
import type { Pool } from 'pg';
import { resolve } from 'node:path';
import { createWeddingRouter } from '../wedding/router';
import { cookieName, getPilotSession, ownerId, redeemInvite } from './auth';

export function createPilotApp(pool: Pool, origin: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/healthz', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true, pilot: 'isolated-text-v1' }); }
    catch { res.status(503).json({ ok: false }); }
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) { res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' }); return; }
    next();
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post('/api/pilot/redeem', express.json({ limit: '2kb' }), async (req, res) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    // Socket address is deliberately not derived from untrusted forwarded headers.
    const key = req.ip || 'unknown';
    const bucket = attempts.get(key) || { count: 0, until: now + 60_000 };
    if (attempts.size >= 10000 && !attempts.has(key)) { res.sendStatus(429); return; }
    attempts.set(key, bucket);
    if (++bucket.count > 30) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'RATE_LIMITED' }); return; }
    try {
      const token = await redeemInvite(pool, req.body?.token);
      if (!token) { res.status(401).json({ error: 'INVITE_INVALID_OR_EXPIRED' }); return; }
      res.cookie(cookieName, token, { secure: true, httpOnly: true, sameSite: 'strict', path: '/', maxAge: 7 * 86400_000 });
      res.json({ success: true });
    } catch { res.status(503).json({ error: 'RETRY_LATER' }); }
  });
  app.use('/api/wedding', createWeddingRouter({ pool, publicOrigin: origin, allowPilotOwner: ownerId,
    env: { NODE_ENV: 'production', WEDDING_ENABLED: 'true', PUBLIC_APP_URL: origin },
    getSession: req => getPilotSession(pool, req) }));
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  app.get('/', (_req, res) => { res.redirect('/wedding'); });
  app.get('/robots.txt', (_req, res) => { res.type('text').send('User-agent: *\nDisallow: /'); });
  app.use('/assets', express.static(resolve('dist/assets'), { fallthrough: false }));
  app.get(/^\/wedding(?:\/.*)?$/, (_req, res) => { res.sendFile(resolve('dist/index.html')); });
  app.use((_req, res) => { res.sendStatus(404); });
  app.use((( _error, _req, res, _next) => { void _next; res.status(400).json({ error: 'INVALID_REQUEST' }); }) as express.ErrorRequestHandler);
  return app;
}
