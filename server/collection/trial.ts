import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, json } from 'express';
import type { Request, Response, ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';

export const collectionTrialCookie = '__Host-memorybook-collection-trial';
export type CollectionTrialGrant = { bookId: string; ownerId: string; title: string; expiresAt: string; tokenHash: string };
type Environment = { COLLECTION_PILOT_ENABLED?: string; COLLECTION_PILOT_TRIAL?: string; PUBLIC_APP_URL?: string; RENDER_EXTERNAL_URL?: string; NODE_ENV?: string };
type Access = { grant: CollectionTrialGrant; configured: string; cookie: string };
type Permission = 'owner' | 'guest' | 'html' | 'session';
const opaqueId = /^[A-Za-z0-9_-]{1,200}$/, tokenPattern = /^[A-Za-z0-9_-]{43}$/, uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const cookieOptions = { secure: true, httpOnly: true, sameSite: 'strict' as const, path: '/' };
const digest = (value: string) => createHash('sha256').update(value).digest();
const entry = '/collection/try', api = '/api/pilot/collection-trial';
const pathname = (req: Request) => req.originalUrl.split('?')[0];
function cookies(req: Request) { return (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.split('=', 1)[0].trim() === collectionTrialCookie); }
export function parseCollectionTrialGrant(raw: string | undefined): CollectionTrialGrant | null {
  if (!raw?.trim()) return null;
  let data: unknown; try { data = JSON.parse(raw); } catch { throw new Error('INVALID_COLLECTION_TRIAL_CONFIG'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_COLLECTION_TRIAL_CONFIG');
  const grant = data as Record<string, unknown>, keys = ['bookId', 'ownerId', 'title', 'expiresAt', 'tokenHash'];
  if (Object.keys(grant).length !== keys.length || Object.keys(grant).some(key => !keys.includes(key)) || typeof grant.bookId !== 'string' || !opaqueId.test(grant.bookId) || typeof grant.ownerId !== 'string' || !opaqueId.test(grant.ownerId) || typeof grant.title !== 'string' || grant.title.length > 200 || !/fiktív/i.test(grant.title) || typeof grant.tokenHash !== 'string' || !/^[a-f\d]{64}$/.test(grant.tokenHash) || typeof grant.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(grant.expiresAt) || !Number.isFinite(Date.parse(grant.expiresAt))) throw new Error('INVALID_COLLECTION_TRIAL_CONFIG');
  return grant as CollectionTrialGrant;
}
function publicAsset(req: Request) {
  return ['GET', 'HEAD'].includes(req.method) && (pathname(req) === entry || /^\/(?:assets|fonts|cover-backgrounds)\/[A-Za-z\d_./-]+$/.test(pathname(req)) || /^\/favicon\.(ico|png|svg)$/.test(pathname(req)));
}

/** Mount before auth/APIs/SPA. A trial cookie never falls back to a full owner session. */
export function createCollectionTrialAccess(pool: Pool, env: Environment = process.env) {
  parseCollectionTrialGrant(env.COLLECTION_PILOT_TRIAL);
  const router = Router(), cache = new WeakMap<Request, { access: Access; permission: Permission }>();
  const hasTrialCookie = (req: Request) => cookies(req).length > 0;
  const deny = (res: Response) => { res.status(404).json({ error: 'COLLECTION_TRIAL_DENIED' }); };
  const noStore = (res: Response) => res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-MemoryBook-Access': 'collection-trial' });
  function sameOrigin(req: Request) {
    const configured = env.PUBLIC_APP_URL || env.RENDER_EXTERNAL_URL;
    try { return req.get('origin') === (configured ? new URL(configured).origin : `${req.protocol}://${req.get('host')}`); } catch { return false; }
  }
  async function resolve(req: Request, supplied?: string): Promise<Access | null> {
    if (env.COLLECTION_PILOT_ENABLED !== 'yes') return null;
    const configured = env.COLLECTION_PILOT_TRIAL, grant = parseCollectionTrialGrant(configured);
    if (!grant || Date.parse(grant.expiresAt) <= Date.now()) return null;
    const list = cookies(req), cookie = supplied ?? (list.length === 1 ? list[0].slice(collectionTrialCookie.length + 1) : '');
    if (!tokenPattern.test(cookie) || !timingSafeEqual(digest(cookie), Buffer.from(grant.tokenHash, 'hex'))) return null;
    const book = await pool.query("SELECT id FROM books WHERE id=$1 AND owner_user_id=$2 AND title=$3 AND book_type='event'", [grant.bookId, grant.ownerId, grant.title]);
    if (!book.rowCount || env.COLLECTION_PILOT_TRIAL !== configured || Date.parse(grant.expiresAt) <= Date.now()) return null;
    return { grant, configured: configured!, cookie };
  }
  async function permission(req: Request, access: Access): Promise<Permission | null> {
    const path = pathname(req), read = req.method === 'GET' || req.method === 'HEAD', bookId = access.grant.bookId;
    if (path.includes('%') || path.includes('\\') || path.split('/').some(part => part === '.' || part === '..') || Object.keys(req.query).length) return null;
    if (read && path === api + '/session') return 'session';
    if (read && (path === '/' || path === `/my-books/${bookId}/materials`)) return 'html';
    const root = `/api/my/books/${bookId}/collection`;
    if (read && [root, root + '/manifest.json', root + '/archive.zip', root + '-settings'].includes(path)) return 'owner';
    if (req.method === 'PUT' && path === root + '-settings') return 'owner';
    if (path.startsWith(root + '/')) {
      const parts = path.slice(root.length + 1).split('/');
      if (parts.length === 3 && parts[0] === 'files' && uuid.test(parts[1]) && (read && ['original', 'preview', 'playback'].includes(parts[2]) || req.method === 'POST' && parts[2] === 'retry')) return 'owner';
      if (read && parts.length === 3 && parts[0] === 'groups' && opaqueId.test(parts[1]) && parts[2] === 'preview') return 'owner';
    }
    // Guest editing stays public-capability based, but this cookie may only use
    // invite tokens belonging to its designated fictional book.
    const join = /^\/join\/([A-Za-z\d_-]+)$/.exec(path);
    const invite = /^\/api\/invites\/([A-Za-z\d_-]+)(\/page-session)?$/.exec(path);
    if (join && read || invite && (read && !invite[2] || req.method === 'POST' && invite[2] === '/page-session')) {
      const value = join?.[1] || invite![1];
      return (await pool.query('SELECT id FROM books WHERE id=$1 AND invite_token=$2', [bookId, value])).rowCount ? 'guest' : null;
    }
    const page = /^\/p\/([A-Za-z\d_-]+)$/.exec(path);
    const legacy = /^\/api\/page-invites\/([A-Za-z\d_-]+)(\/submit)?$/.exec(path);
    const collection = /^\/api\/collection\/invites\/([A-Za-z\d_-]+)(.*)$/.exec(path);
    let pageToken: string | undefined;
    if (page && read) pageToken = page[1];
    if (legacy && (read && !legacy[2] || req.method === 'PUT' && !legacy[2] || req.method === 'POST' && legacy[2] === '/submit')) pageToken = legacy[1];
    if (collection) {
      const suffix = collection[2], parts = suffix.split('/').slice(1);
      if (read && ['', '/page-preview'].includes(suffix) || req.method === 'POST' && ['/files', '/commit'].includes(suffix)) pageToken = collection[1];
      if (parts[0] === 'files' && uuid.test(parts[1] || '') && (parts.length === 2 && (read || req.method === 'DELETE') || parts.length === 3 && (read && ['original', 'preview', 'playback'].includes(parts[2]) || req.method === 'POST' && ['complete', 'retry'].includes(parts[2])) || parts.length === 4 && parts[2] === 'chunks' && /^\d+$/.test(parts[3]) && req.method === 'PUT')) pageToken = collection[1];
    }
    if (pageToken && (await pool.query('SELECT id FROM pages WHERE book_id=$1 AND invite_token=$2', [bookId, pageToken])).rowCount) return 'guest';
    return null;
  }
  router.post(api + '/redeem', json({ limit: '1kb' }), async (req, res) => {
    noStore(res);
    if (!sameOrigin(req)) { res.status(403).json({ error: 'ORIGIN_REQUIRED' }); return; }
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length !== 1 || typeof req.body.key !== 'string' || Object.keys(req.query).length) { deny(res); return; }
    try {
      const access = await resolve(req, req.body.key); if (!access) { deny(res); return; }
      res.cookie(collectionTrialCookie, access.cookie, { ...cookieOptions, maxAge: Date.parse(access.grant.expiresAt) - Date.now() });
      res.json({ success: true, bookId: access.grant.bookId, redirectTo: `/my-books/${access.grant.bookId}/materials` });
    } catch { res.status(503).json({ error: 'COLLECTION_TRIAL_UNAVAILABLE' }); }
  });
  router.post(api + '/leave', (req, res) => {
    noStore(res); if (!sameOrigin(req)) { res.status(403).json({ error: 'ORIGIN_REQUIRED' }); return; }
    res.clearCookie(collectionTrialCookie, cookieOptions); res.json({ success: true });
  });
  router.get(api + '/session', (req, res, next) => { if (hasTrialCookie(req)) { next(); return; } noStore(res); res.json({ trial: null }); });
  router.use(async (req, res, next) => {
    if (!hasTrialCookie(req) || publicAsset(req)) { next(); return; }
    noStore(res);
    try {
      const access = await resolve(req), allowed = access ? await permission(req, access) : null;
      if (!access || !allowed) { deny(res); return; }
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) { res.status(403).json({ error: 'ORIGIN_REQUIRED' }); return; }
      cache.set(req, { access, permission: allowed });
      if (allowed === 'session') { res.json({ trial: { bookId: access.grant.bookId, expiresAt: access.grant.expiresAt } }); return; }
      if (pathname(req) === '/') { res.redirect(303, `/my-books/${access.grant.bookId}/materials`); return; }
      next();
    } catch { res.status(503).json({ error: 'COLLECTION_TRIAL_UNAVAILABLE' }); }
  });
  const parseError: ErrorRequestHandler = (_error, _req, res, _next) => { void _error; void _req; void _next; noStore(res); res.status(400).json({ error: 'INVALID_TRIAL_REQUEST' }); };
  router.use(api, parseError);
  async function getCollectionTrialSession(req: Request) {
    const cached = cache.get(req);
    if (env.COLLECTION_PILOT_ENABLED === 'yes' && cached && cached.permission === 'owner' && cached.access.configured === env.COLLECTION_PILOT_TRIAL && Date.parse(cached.access.grant.expiresAt) > Date.now()) return { user: { id: cached.access.grant.ownerId } };
    // Also safe when called independently; route scope is never inferred from a cookie alone.
    const access = await resolve(req); if (!access || await permission(req, access) !== 'owner') return null;
    return { user: { id: access.grant.ownerId } };
  }
  return { router, hasTrialCookie, getCollectionTrialSession };
}
