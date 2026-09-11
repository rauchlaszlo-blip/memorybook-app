import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth';
import { pool } from './db';
import { getInvoicingCapabilities } from './invoicing';
import { getPayPalCapabilities, PayPalAdapterError } from './payments/paypal';
import {
  capturePayPalPaymentForPurchase,
  createPayPalOrderForPurchase,
  PayPalPurchaseError,
} from './payments/paypal-purchase';
import {
  buildSimplePayIpnAcknowledgement,
  getSimplePayCapabilities,
  SimplePayAdapterError,
} from './payments/simplepay';
import {
  createSimplePayTransactionForPurchase,
  finalizeSimplePayPurchaseFromIpn,
  SimplePayPurchaseError,
} from './payments/simplepay-purchase';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

if (auth) {
  app.all('/api/auth/*splat', toNodeHandler(auth));
}

app.use(express.json({
  limit: '5mb',
  verify: (req: any, _res: any, buf: Buffer) => {
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    if (pathname === '/api/payments/simplepay/ipn') {
      req.rawBody = buf.toString('utf8');
    }
  },
}));

const MAX_PREVIEW_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRIBUTION_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const EVENT_REQUIRED_FIELDS = new Set([
  'name',
  'email',
  'phone',
  'festivalId',
  'ticketId',
]);
const DEFAULT_BOOK_PAGE_COUNT = 30;
const PAGE_INVITE_VALID_DAYS = 14;
const DEMO_BOOK_ID = 'book-12b';
const postalLookupCache = new Map<string, string>();

async function getSession(req: any) {
  if (!auth) return null;

  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
}

function getPublicAppBaseUrl(req: any): string {
  const configured = String(
    process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || ''
  ).trim().replace(/\/+$/, '');
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString().replace(/\/+$/, '');
      }
    } catch {
      throw new PayPalPurchaseError('INVALID_PUBLIC_APP_URL', 500);
    }
  }

  const host = String(req.get?.('host') || '').trim();
  const hostname = host.split(':')[0].toLowerCase();
  if (!host || (hostname !== 'localhost' && hostname !== '127.0.0.1')) {
    throw new PayPalPurchaseError('PUBLIC_APP_URL_NOT_AVAILABLE', 503);
  }
  return `http://${host}`;
}

async function ensurePurchasePaymentAccess(req: any, purchaseId: string): Promise<void> {
  const result = await pool.query(
    `SELECT
       purchase_mode AS "purchaseMode",
       purchaser_user_id AS "purchaserUserId"
     FROM purchases
     WHERE id = $1`,
    [purchaseId]
  );

  if (result.rowCount === 0) {
    throw new PayPalPurchaseError('PURCHASE_NOT_FOUND', 404);
  }

  const purchase = result.rows[0];
  const session = await getSession(req).catch(() => null);
  if (!session) {
    throw new PayPalPurchaseError('UNAUTHENTICATED', 401);
  }
  if (session.user.id !== purchase.purchaserUserId) {
    throw new PayPalPurchaseError('PURCHASE_NOT_FOUND', 404);
  }
}

function sendPayPalRouteError(res: any, err: any, fallbackCode: string): void {
  let status = 500;
  let code = fallbackCode;

  if (err instanceof PayPalPurchaseError) {
    status = err.status;
    code = err.message || fallbackCode;
  } else if (err instanceof PayPalAdapterError) {
    const configError =
      err.message.startsWith('MISSING_PAYPAL_') || err.message === 'PAYPAL_LIVE_NOT_ENABLED';
    status = configError ? 503 : 502;
    code = err.message || fallbackCode;
  }

  console.error(fallbackCode, {
    code,
    status,
    providerStatus: err instanceof PayPalAdapterError ? err.status : undefined,
    providerName: err instanceof PayPalAdapterError ? err.providerName : undefined,
    providerIssue: err instanceof PayPalAdapterError ? err.providerIssue : undefined,
  });
  res.status(status).json({ error: code });
}

function sendSimplePayRouteError(res: any, err: any, fallbackCode: string): void {
  let status = 500;
  let code = fallbackCode;

  if (err instanceof SimplePayPurchaseError || err instanceof PayPalPurchaseError) {
    status = err.status;
    code = err.message || fallbackCode;
  } else if (err instanceof SimplePayAdapterError) {
    const configError =
      err.message.startsWith('MISSING_SIMPLEPAY_') ||
      err.message === 'SIMPLEPAY_LIVE_NOT_ENABLED';
    const ipnInputError = err.message.startsWith('SIMPLEPAY_IPN_');
    status = configError ? 503 : ipnInputError ? 400 : 502;
    code = err.message || fallbackCode;
  }

  console.error(fallbackCode, {
    code,
    status,
    providerStatus: err instanceof SimplePayAdapterError ? err.status : undefined,
    providerErrorCodes: err instanceof SimplePayAdapterError ? err.providerErrorCodes : undefined,
  });
  res.status(status).json({ error: code });
}

function isPageInviteExpired(inviteCreatedAt: string | Date | null | undefined): boolean {
  if (!inviteCreatedAt) return false;
  const createdAt = new Date(inviteCreatedAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() >= createdAt + PAGE_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000;
}

async function deletePreviewSafely(
  _previewUrl: string | null | undefined
): Promise<void> {
  return;
}

async function deletePagePreviewAsset(pageId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(`memorybook/previews/page-${pageId}`, {
      resource_type: 'image',
      invalidate: true,
    });
  } catch (err) {
    console.error('Page preview delete warning:', err);
  }
}

async function processAndSavePreview(
  pageId: string,
  dataUrl: string
): Promise<string> {
  const prefix = 'data:image/jpeg;base64,';

  if (!dataUrl.startsWith(prefix)) {
    throw new Error('INVALID_PREVIEW_FORMAT');
  }

  const base64Data = dataUrl.substring(prefix.length);
  const imageBuffer = Buffer.from(base64Data, 'base64');

  const isJpeg =
    imageBuffer.length >= 3 &&
    imageBuffer[0] === 0xff &&
    imageBuffer[1] === 0xd8 &&
    imageBuffer[2] === 0xff;

  if (!isJpeg) {
    throw new Error('INVALID_PREVIEW_JPEG');
  }

  if (imageBuffer.length > MAX_PREVIEW_SIZE_BYTES) {
    throw new Error('PREVIEW_TOO_LARGE');
  }

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: 'memorybook/previews',
    public_id: `page-${pageId}`,
    resource_type: 'image',
    overwrite: true,
    invalidate: true,
  });

  return result.secure_url;
}

async function processAndSaveContributionPhoto(
  contributionId: string,
  dataUrl: string
): Promise<string> {
  const match = dataUrl.match(
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    throw new Error('INVALID_CONTRIBUTION_PHOTO_FORMAT');
  }

  const imageType = match[1];
  const base64Data = match[2];
  const imageBuffer = Buffer.from(base64Data, 'base64');

  if (imageBuffer.length > MAX_CONTRIBUTION_PHOTO_SIZE_BYTES) {
    throw new Error('CONTRIBUTION_PHOTO_TOO_LARGE');
  }

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: 'memorybook/contribution-photos',
    public_id: `contribution-${contributionId}-${Date.now()}`,
    resource_type: 'image',
    format: imageType === 'jpeg' ? 'jpg' : imageType,
  });

  return result.secure_url;
}

async function processAndSaveDedicationLayer(
  pageId: string,
  layer: 'photo' | 'signature',
  dataUrl: string
): Promise<string> {
  const match = dataUrl.match(
    /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match || (layer === 'photo' && match[1] !== 'jpeg') || (layer === 'signature' && match[1] !== 'png')) {
    throw new Error('INVALID_DEDICATION_LAYER_FORMAT');
  }

  const imageBuffer = Buffer.from(match[2], 'base64');
  if (imageBuffer.length > MAX_CONTRIBUTION_PHOTO_SIZE_BYTES) {
    throw new Error('DEDICATION_LAYER_TOO_LARGE');
  }

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder: 'memorybook/dedications',
    public_id: `page-${pageId}-${layer}`,
    resource_type: 'image',
    format: layer === 'photo' ? 'jpg' : 'png',
    overwrite: true,
    invalidate: true,
  });

  return result.secure_url;
}

async function savePageVersioned(
  pageId: string,
  canvasData: Record<string, any>,
  previewDataUrl: string | null | undefined,
  expectedVersion: number,
  inviteStatus?: string,
  requireEditable = false,
  db: any = pool
) {
  let newPreviewUrl: string | null = null;

  if (previewDataUrl) {
    newPreviewUrl = await processAndSavePreview(pageId, previewDataUrl);
  }

  const result = await db.query(
    `WITH old_state AS (
       SELECT id, preview_image_url
       FROM pages
       WHERE id = $3
         AND version = $4
         AND ($6::boolean = FALSE OR invite_status <> 'submitted')
     ),
     updated AS (
       UPDATE pages p
       SET
         canvas_json = $1,
         preview_image_url = COALESCE($2, p.preview_image_url),
         version = p.version + 1,
         invite_status = COALESCE($5, p.invite_status),
         updated_at = CURRENT_TIMESTAMP
       FROM old_state os
       WHERE p.id = os.id
         AND ($6::boolean = FALSE OR p.invite_status <> 'submitted')
       RETURNING
         p.id,
         p.version,
         p.preview_image_url,
         p.updated_at,
         os.preview_image_url AS previous_preview_url
     )
     SELECT
       id,
       version,
       preview_image_url AS "previewImageUrl",
       updated_at AS "updatedAt",
       previous_preview_url AS "previousPreviewUrl"
     FROM updated`,
    [
      canvasData,
      newPreviewUrl,
      pageId,
      expectedVersion,
      inviteStatus ?? null,
      requireEditable,
    ]
  );

  if (result.rowCount === 0) {
    await deletePreviewSafely(newPreviewUrl);

    const check = await db.query(
      `SELECT version, invite_status AS "inviteStatus"
       FROM pages
       WHERE id = $1`,
      [pageId]
    );

    if (check.rowCount === 0) {
      const error: any = new Error('PAGE_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (requireEditable && check.rows[0].inviteStatus === 'submitted') {
      const error: any = new Error('PAGE_ALREADY_SUBMITTED');
      error.status = 410;
      throw error;
    }

    const error: any = new Error('PAGE_CONFLICT');
    error.status = 409;
    error.latestRemoteVersion = check.rows[0].version;
    throw error;
  }

  const row = result.rows[0];

  if (
    newPreviewUrl &&
    row.previousPreviewUrl &&
    row.previousPreviewUrl !== newPreviewUrl
  ) {
    deletePreviewSafely(row.previousPreviewUrl).catch(() => {});
  }

  return row;
}

async function saveBookCoverVersioned(
  bookId: string,
  ownerUserId: string,
  canvasData: Record<string, any>,
  previewDataUrl: string | null | undefined,
  expectedVersion: number
) {
  let newPreviewUrl: string | null = null;
  if (previewDataUrl) {
    newPreviewUrl = await processAndSavePreview(`cover-${bookId}`, previewDataUrl);
  }

  const result = await pool.query(
    `UPDATE books
     SET cover_canvas_json = $1,
         cover_preview_image_url = COALESCE($2, cover_preview_image_url),
         cover_version = cover_version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND owner_user_id = $4 AND book_type IN ('standard', 'dedication') AND cover_version = $5
     RETURNING cover_version AS "version",
               cover_preview_image_url AS "previewImageUrl",
               updated_at AS "updatedAt"`,
    [canvasData, newPreviewUrl, bookId, ownerUserId, expectedVersion]
  );

  if (result.rowCount === 0) {
    const check = await pool.query(
      `SELECT cover_version AS "version" FROM books
       WHERE id = $1 AND owner_user_id = $2 AND book_type IN ('standard', 'dedication')`,
      [bookId, ownerUserId]
    );
    const error: any = new Error(check.rowCount === 0 ? 'BOOK_NOT_FOUND' : 'COVER_CONFLICT');
    error.status = check.rowCount === 0 ? 404 : 409;
    error.latestRemoteVersion = check.rows[0]?.version;
    throw error;
  }

  return result.rows[0];
}

app.get('/api/auth-capabilities', (_req, res) => {
  res.status(200).json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET),
  });
});

app.get('/api/postal-lookup/:country/:postalCode', async (req, res) => {
  const country = String(req.params.country || '').trim().toUpperCase();
  const postalCode = String(req.params.postalCode || '').trim();

  if (country !== 'HU' || !/^\d{4}$/.test(postalCode)) {
    res.status(400).json({ error: 'INVALID_POSTAL_LOOKUP' });
    return;
  }

  const cacheKey = `${country}:${postalCode}`;
  const cachedCity = postalLookupCache.get(cacheKey);
  if (cachedCity) {
    res.status(200).json({ country, postalCode, city: cachedCity });
    return;
  }

  try {
    const response = await fetch(`https://api.zippopotam.us/${country}/${encodeURIComponent(postalCode)}`);
    if (response.status === 404) {
      res.status(404).json({ error: 'POSTAL_CODE_NOT_FOUND' });
      return;
    }
    if (!response.ok) {
      res.status(502).json({ error: 'POSTAL_LOOKUP_FAILED' });
      return;
    }

    const data: any = await response.json();
    const cities = Array.from(
      new Set(
        (Array.isArray(data?.places) ? data.places : [])
          .map((place: any) => String(place?.['place name'] || '').trim())
          .filter(Boolean)
      )
    ) as string[];
    const city = cities[0] || '';
    if (!city) {
      res.status(404).json({ error: 'POSTAL_CODE_NOT_FOUND' });
      return;
    }

    postalLookupCache.set(cacheKey, city);
    res.status(200).json({ country, postalCode, city });
  } catch (err) {
    console.error('Postal lookup error:', err);
    res.status(502).json({ error: 'POSTAL_LOOKUP_FAILED' });
  }
});

const VIES_COUNTRIES = new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);

app.get('/api/company-lookup/:country/:taxNumber', async (req, res) => {
  const inputCountry = String(req.params.country || '').trim().toUpperCase();
  const countryCode = inputCountry === 'GR' ? 'EL' : inputCountry;
  if (!VIES_COUNTRIES.has(inputCountry) && !VIES_COUNTRIES.has(countryCode)) {
    res.status(400).json({ error: 'COMPANY_LOOKUP_NOT_SUPPORTED' });
    return;
  }
  let vatNumber = String(req.params.taxNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  if (vatNumber.startsWith(inputCountry)) vatNumber = vatNumber.slice(inputCountry.length);
  if (vatNumber.startsWith(countryCode)) vatNumber = vatNumber.slice(countryCode.length);
  if (countryCode === 'HU') {
    const digits = vatNumber.replace(/\D/g, '');
    vatNumber = digits.slice(0, 8);
  } else {
    vatNumber = vatNumber.replace(/[^A-Z0-9]/g, '');
  }
  if (!vatNumber) {
    res.status(400).json({ error: 'INVALID_TAX_NUMBER' });
    return;
  }
  try {
    const response = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: AbortSignal.timeout(8000),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: 'COMPANY_LOOKUP_FAILED' });
      return;
    }
    const valid = Boolean(data?.isValid ?? data?.valid);
    const rawName = String(data?.name || '').trim();
    const rawAddress = String(data?.address || '').trim();
    const companyName = rawName && rawName !== '---' ? rawName : null;
    const address = rawAddress && rawAddress !== '---' ? rawAddress : null;
    if (!valid) {
      res.status(404).json({ valid: false, companyName: null, address: null, source: 'VIES' });
      return;
    }
    res.status(200).json({ valid: true, companyName, address, source: 'VIES' });
  } catch (err) {
    console.error('Company lookup error:', err);
    res.status(502).json({ error: 'COMPANY_LOOKUP_FAILED' });
  }
});

app.get('/api/invoicing-capabilities', (_req, res) => {
  res.status(200).json(getInvoicingCapabilities());
});

app.get('/api/payment-capabilities', (_req, res) => {
  const paypal = getPayPalCapabilities();
  const simplepay = getSimplePayCapabilities();
  res.status(200).json({
    testPaymentEnabled: !paypal.enabled && !simplepay.enabled,
    paypal,
    simplepay: {
      ...simplepay,
      integrationReady: true,
    },
  });
});

app.get('/api/me', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);

    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    res.status(200).json({
      user: session.user,
      session: session.session,
    });
  } catch (err) {
    console.error('Session load error:', err);
    res.status(500).json({ error: 'SESSION_LOAD_FAILED' });
  }
});


app.get('/api/my/billing-profile', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const personalPurchaseResult = await pool.query(
      `SELECT
         billing_name AS "billingName",
         billing_email AS "billingEmail",
         billing_country AS "billingCountry",
         billing_postal_code AS "billingPostalCode",
         billing_city AS "billingCity",
         billing_address AS "billingAddress",
         billing_tax_number AS "billingTaxNumber",
         billing_company_name AS "billingCompanyName",
         created_at AS "updatedAt"
       FROM purchases
       WHERE purchaser_user_id = $1
         AND purchase_mode IN ('self', 'gift')
       ORDER BY created_at DESC
       LIMIT 1`,
      [session.user.id]
    );

    if (personalPurchaseResult.rowCount > 0) {
      res.status(200).json({ billingProfile: personalPurchaseResult.rows[0] });
      return;
    }

    const profileResult = await pool.query(
      `SELECT
         billing_name AS "billingName",
         billing_email AS "billingEmail",
         billing_country AS "billingCountry",
         billing_postal_code AS "billingPostalCode",
         billing_city AS "billingCity",
         billing_address AS "billingAddress",
         billing_tax_number AS "billingTaxNumber",
         billing_company_name AS "billingCompanyName",
         updated_at AS "updatedAt"
       FROM billing_profiles
       WHERE user_id = $1`,
      [session.user.id]
    );

    res.status(200).json({ billingProfile: profileResult.rows[0] || null });
  } catch (err) {
    console.error('Billing profile load error:', err);
    res.status(500).json({ error: 'BILLING_PROFILE_LOAD_FAILED' });
  }
});


app.get('/api/my/notifications', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const requestedLimit = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50;

    const [notificationsResult, unreadResult] = await Promise.all([
      pool.query(
        `SELECT
           n.id,
           n.type,
           n.book_id AS "bookId",
           b.title AS "bookTitle",
           n.source_page_id AS "pageId",
           n.actor_name AS "actorName",
           n.page_number AS "pageNumber",
           n.read_at AS "readAt",
           n.created_at AS "createdAt",
           '/my-books/' || n.book_id || '?page=' || n.source_page_id AS "targetPath"
         FROM notifications n
         JOIN books b ON b.id = n.book_id
         WHERE n.recipient_user_id = $1
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT $2`,
        [session.user.id, limit]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE recipient_user_id = $1
           AND read_at IS NULL`,
        [session.user.id]
      ),
    ]);

    res.status(200).json({
      notifications: notificationsResult.rows,
      unreadCount: Number(unreadResult.rows[0]?.count || 0),
    });
  } catch (err) {
    console.error('Notification list error:', err);
    res.status(500).json({ error: 'NOTIFICATION_LIST_FAILED' });
  }
});

app.get('/api/my/notifications/unread-count', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE recipient_user_id = $1
         AND read_at IS NULL`,
      [session.user.id]
    );

    res.status(200).json({ unreadCount: Number(result.rows[0]?.count || 0) });
  } catch (err) {
    console.error('Notification unread count error:', err);
    res.status(500).json({ error: 'NOTIFICATION_UNREAD_COUNT_FAILED' });
  }
});

app.patch('/api/my/notifications/:notificationId/read', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = $1
         AND recipient_user_id = $2
       RETURNING id, read_at AS "readAt"`,
      [req.params.notificationId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
      return;
    }

    const unreadResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE recipient_user_id = $1
         AND read_at IS NULL`,
      [session.user.id]
    );

    res.status(200).json({
      success: true,
      notification: result.rows[0],
      unreadCount: Number(unreadResult.rows[0]?.count || 0),
    });
  } catch (err) {
    console.error('Notification read-state error:', err);
    res.status(500).json({ error: 'NOTIFICATION_READ_STATE_FAILED' });
  }
});

app.get('/api/my/books', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);

    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `SELECT
         b.id,
         b.title,
         b.book_type AS "bookType",
         b.language,
         b.cover_preview_image_url AS "coverPreviewImageUrl",
         b.created_at AS "createdAt",
         COUNT(DISTINCT p.id)::int AS "pageCount",
         COUNT(DISTINCT c.id)::int AS "contributionCount"
       FROM books b
       LEFT JOIN pages p ON p.book_id = b.id
       LEFT JOIN contributions c ON c.book_id = b.id
       WHERE b.owner_user_id = $1
       GROUP BY b.id, b.title, b.book_type, b.language, b.cover_preview_image_url, b.created_at
       ORDER BY b.created_at DESC`,
      [session.user.id]
    );

    res.status(200).json({ books: result.rows });
  } catch (err) {
    console.error('Owner book list error:', err);
    res.status(500).json({ error: 'OWNER_BOOK_LIST_LOAD_FAILED' });
  }
});

app.post('/api/purchases', async (req, res) => {
  const purchaseMode =
    req.body?.purchaseMode === 'gift'
      ? 'gift'
      : req.body?.purchaseMode === 'organization'
        ? 'organization'
        : 'self';
  const bookType = req.body?.bookType === 'event'
    ? 'event'
    : req.body?.bookType === 'dedication'
      ? 'dedication'
      : 'standard';
  const paymentProvider =
    req.body?.paymentProvider === 'paypal'
      ? 'paypal'
      : req.body?.paymentProvider === 'simplepay'
        ? 'simplepay'
        : null;

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'ACCOUNT_REQUIRED_FOR_PURCHASE' });
    return;
  }

  const purchaserName = String(session.user?.name || req.body?.purchaserName || '').trim();
  const purchaserEmail = String(session.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase();
  const billingName = String(req.body?.billingName || session.user?.name || '').trim();
  const billingEmail = String(req.body?.billingEmail || '').trim().toLowerCase();
  const billingCountry = String(req.body?.billingCountry || '').trim();
  const billingPostalCode = String(req.body?.billingPostalCode || '').trim();
  const billingCity = String(req.body?.billingCity || '').trim();
  const billingAddress = String(req.body?.billingAddress || '').trim();
  const billingTaxNumber = String(req.body?.billingTaxNumber || '').trim().toUpperCase();
  const billingCompanyName = String(req.body?.billingCompanyName || '').trim();
  const purchaseBillingName = purchaseMode === 'organization' ? billingCompanyName : billingName;

  if (!paymentProvider) {
    res.status(400).json({ error: 'INVALID_PAYMENT_PROVIDER' });
    return;
  }

  const requiredValues = [
    purchaserName,
    purchaserEmail,
    billingEmail,
    billingCountry,
    billingPostalCode,
    billingCity,
    billingAddress,
    purchaseMode === 'organization' ? billingCompanyName : billingName,
    purchaseMode === 'organization' ? billingTaxNumber : 'not-required',
  ];
  if (requiredValues.some((value) => !value)) {
    res.status(400).json({ error: 'INCOMPLETE_PURCHASE_IDENTITY' });
    return;
  }
  const normalizedBillingCountry = billingCountry.trim().toLocaleLowerCase('hu-HU');
  const isHungarianBilling = ['hu', 'hungary', 'magyarország', 'ungarn'].includes(normalizedBillingCountry);
  if (purchaseMode === 'organization' && isHungarianBilling && !/^\d{8}-\d-\d{2}$/.test(billingTaxNumber)) {
    res.status(400).json({ error: 'INVALID_HUNGARIAN_TAX_NUMBER' });
    return;
  }
  if (!purchaserEmail.includes('@') || !billingEmail.includes('@')) {
    res.status(400).json({ error: 'INVALID_PURCHASE_EMAIL' });
    return;
  }
  if (
    purchaserName.length > 160 ||
    purchaserEmail.length > 240 ||
    billingName.length > 200 ||
    billingEmail.length > 240 ||
    billingCountry.length > 100 ||
    billingPostalCode.length > 30 ||
    billingCity.length > 120 ||
    billingAddress.length > 240 ||
    billingTaxNumber.length > 80 ||
    billingCompanyName.length > 200
  ) {
    res.status(400).json({ error: 'PURCHASE_IDENTITY_TOO_LONG' });
    return;
  }

  const purchaseId = `purchase-${crypto.randomUUID()}`;
  const includedPages = bookType === 'event' ? 0 : DEFAULT_BOOK_PAGE_COUNT;

  try {
    if (session) {
      await pool.query(
        `INSERT INTO billing_profiles (
           user_id,
           billing_name,
           billing_email,
           billing_country,
           billing_postal_code,
           billing_city,
           billing_address,
           billing_tax_number,
           billing_company_name,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           billing_name = EXCLUDED.billing_name,
           billing_email = EXCLUDED.billing_email,
           billing_country = EXCLUDED.billing_country,
           billing_postal_code = EXCLUDED.billing_postal_code,
           billing_city = EXCLUDED.billing_city,
           billing_address = EXCLUDED.billing_address,
           billing_tax_number = EXCLUDED.billing_tax_number,
           billing_company_name = EXCLUDED.billing_company_name,
           updated_at = CURRENT_TIMESTAMP`,
        [
          session.user.id,
          billingName,
          billingEmail,
          billingCountry,
          billingPostalCode,
          billingCity,
          billingAddress,
          billingTaxNumber,
          billingCompanyName,
        ]
      );
    }

    const result = await pool.query(
      `INSERT INTO purchases (
         id,
         purchase_mode,
         book_type,
         included_pages,
         purchaser_user_id,
         purchaser_name,
         purchaser_email,
         billing_name,
         billing_email,
         billing_country,
         billing_postal_code,
         billing_city,
         billing_address,
         billing_tax_number,
         billing_company_name,
         gift_recipient_name,
         gift_recipient_email,
         payment_provider,
         payment_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''), NULLIF($17, ''), $18, 'draft')
       RETURNING
         id,
         purchase_mode AS "purchaseMode",
         book_type AS "bookType",
         included_pages AS "includedPages",
         payment_provider AS "paymentProvider",
         payment_status AS "paymentStatus",
         created_at AS "createdAt"`,
      [
        purchaseId,
        purchaseMode,
        bookType,
        includedPages,
        session?.user?.id || null,
        purchaserName,
        purchaserEmail,
        purchaseBillingName,
        billingEmail,
        billingCountry,
        billingPostalCode,
        billingCity,
        billingAddress,
        billingTaxNumber,
        billingCompanyName,
        '',
        '',
        paymentProvider,
      ]
    );

    res.status(201).json({
      success: true,
      purchase: result.rows[0],
      paymentReady: false,
      message: 'PAYMENT_PROVIDER_INTEGRATION_PENDING',
    });
  } catch (err) {
    console.error('Purchase draft create error:', err);
    res.status(500).json({ error: 'PURCHASE_DRAFT_CREATE_FAILED' });
  }
});

app.post('/api/purchases/:purchaseId/test-complete', async (req, res) => {
  const paypal = getPayPalCapabilities();
  const simplepay = getSimplePayCapabilities();
  if (paypal.enabled || simplepay.enabled) {
    res.status(403).json({ error: 'TEST_PAYMENT_DISABLED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const purchaseId = String(req.params.purchaseId || '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const purchaseResult = await client.query(
      `SELECT
         id,
         purchase_mode AS "purchaseMode",
         book_type AS "bookType",
         included_pages AS "includedPages",
         purchaser_user_id AS "purchaserUserId",
         payment_status AS "paymentStatus"
       FROM purchases
       WHERE id = $1 AND purchaser_user_id = $2
       FOR UPDATE`,
      [purchaseId, session.user.id]
    );

    if (purchaseResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
      return;
    }

    const purchase = purchaseResult.rows[0];
    if (purchase.paymentStatus !== 'draft' && purchase.paymentStatus !== 'paid') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PURCHASE_PAYMENT_STATE_CHANGED' });
      return;
    }

    await client.query(
      `UPDATE purchases
       SET payment_status = 'paid',
           provider_reference = COALESCE(provider_reference, $2),
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [purchaseId, `test-${crypto.randomUUID()}`]
    );

    const entitlementId = `entitlement-${crypto.randomUUID()}`;
    const giftToken = purchase.purchaseMode === 'gift' ? `gift-${crypto.randomUUID()}` : null;
    await client.query(
      `INSERT INTO book_entitlements (
         id, purchase_id, assigned_user_id, gift_token,
         book_type, included_pages, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'available')
       ON CONFLICT (purchase_id) DO NOTHING`,
      [
        entitlementId,
        purchaseId,
        purchase.purchaseMode === 'self' ? session.user.id : null,
        giftToken,
        purchase.bookType,
        Number(purchase.includedPages) || 0,
      ]
    );

    const entitlementResult = await client.query(
      `SELECT id, gift_token AS "giftToken", book_type AS "bookType",
              included_pages AS "includedPages", status
       FROM book_entitlements WHERE purchase_id = $1`,
      [purchaseId]
    );
    const entitlement = entitlementResult.rows[0];
    if (!entitlement) throw new Error('TEST_ENTITLEMENT_CREATE_FAILED');

    await client.query('COMMIT');
    res.status(200).json({
      purchaseId,
      paymentStatus: 'paid',
      testPayment: true,
      giftRedeemPath: entitlement.giftToken
        ? `/gift/${encodeURIComponent(entitlement.giftToken)}`
        : null,
      entitlement,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Test purchase completion error:', err);
    res.status(500).json({ error: 'TEST_PURCHASE_COMPLETE_FAILED' });
  } finally {
    client.release();
  }
});


app.post('/api/purchases/:purchaseId/simplepay/start', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  if (!purchaseId) {
    res.status(400).json({ error: 'PURCHASE_ID_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const publicBaseUrl = getPublicAppBaseUrl(req);
    const encodedPurchaseId = encodeURIComponent(purchaseId);
    const result = await createSimplePayTransactionForPurchase(
      purchaseId,
      `${publicBaseUrl}/purchase?simplepay=return&purchaseId=${encodedPurchaseId}`
    );

    res.status(201).json({
      success: true,
      purchaseId: result.purchaseId,
      paymentStatus: result.paymentStatus,
      transaction: {
        transactionId: result.transaction.transactionId,
        paymentUrl: result.transaction.paymentUrl,
      },
    });
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_START_FAILED');
  }
});

app.get('/api/purchases/:purchaseId/simplepay/status', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  if (!purchaseId) {
    res.status(400).json({ error: 'PURCHASE_ID_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const result = await pool.query(
      `SELECT
         p.payment_status AS "paymentStatus",
         p.provider_reference AS "providerReference",
         e.id AS "entitlementId",
         e.gift_token AS "giftToken",
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status AS "entitlementStatus"
       FROM purchases p
       LEFT JOIN book_entitlements e ON e.purchase_id = p.id
       WHERE p.id = $1
         AND p.payment_provider = 'simplepay'`,
      [purchaseId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
      return;
    }

    const row = result.rows[0];
    if (row.paymentStatus === 'paid' && !row.entitlementId) {
      res.status(500).json({ error: 'PAID_PURCHASE_ENTITLEMENT_MISSING' });
      return;
    }

    res.status(200).json({
      success: true,
      purchaseId,
      paymentStatus: row.paymentStatus,
      providerReference: row.providerReference,
      entitlement: row.entitlementId
        ? {
            id: row.entitlementId,
            bookType: row.bookType,
            includedPages: row.includedPages,
            status: row.entitlementStatus,
            giftToken: row.giftToken,
          }
        : null,
      giftRedeemPath: row.giftToken ? `/gift/${encodeURIComponent(row.giftToken)}` : null,
    });
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_STATUS_FAILED');
  }
});

app.post('/api/payments/simplepay/ipn', async (req: any, res) => {
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const incomingSignature = String(req.get('Signature') || '').trim();

  if (!rawBody || !incomingSignature) {
    res.status(400).json({ error: 'SIMPLEPAY_IPN_INPUT_REQUIRED' });
    return;
  }

  try {
    const acknowledgement = buildSimplePayIpnAcknowledgement(rawBody, incomingSignature);
    await finalizeSimplePayPurchaseFromIpn(acknowledgement.message);

    res
      .status(200)
      .set('Signature', acknowledgement.responseSignature)
      .type('application/json')
      .send(acknowledgement.responseBody);
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_IPN_FAILED');
  }
});

app.post('/api/purchases/:purchaseId/paypal/order', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  if (!purchaseId) {
    res.status(400).json({ error: 'PURCHASE_ID_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const publicBaseUrl = getPublicAppBaseUrl(req);
    const encodedPurchaseId = encodeURIComponent(purchaseId);
    const result = await createPayPalOrderForPurchase(purchaseId, {
      returnUrl: `${publicBaseUrl}/purchase?paypal=return&purchaseId=${encodedPurchaseId}`,
      cancelUrl: `${publicBaseUrl}/purchase?paypal=cancel&purchaseId=${encodedPurchaseId}`,
    });

    res.status(201).json({
      success: true,
      purchaseId: result.purchaseId,
      paymentStatus: result.paymentStatus,
      order: {
        orderId: result.order.orderId,
        status: result.order.status,
        approvalUrl: result.order.approvalUrl,
      },
    });
  } catch (err) {
    sendPayPalRouteError(res, err, 'PAYPAL_ORDER_CREATE_FAILED');
  }
});

app.post('/api/purchases/:purchaseId/paypal/capture', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  const orderId = String(req.body?.orderId || '').trim();
  if (!purchaseId || !orderId) {
    res.status(400).json({ error: 'PAYPAL_CAPTURE_INPUT_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const result = await capturePayPalPaymentForPurchase(purchaseId, orderId);
    const giftToken = result.entitlement?.giftToken || null;

    res.status(200).json({
      success: true,
      purchaseId: result.purchaseId,
      paymentStatus: result.paymentStatus,
      alreadyFinalized: result.alreadyFinalized,
      entitlement: {
        id: result.entitlement?.id || null,
        bookType: result.entitlement?.bookType || null,
        includedPages: result.entitlement?.includedPages ?? null,
        status: result.entitlement?.status || null,
        giftToken,
      },
      giftRedeemPath: giftToken ? `/gift/${encodeURIComponent(giftToken)}` : null,
    });
  } catch (err) {
    sendPayPalRouteError(res, err, 'PAYPAL_CAPTURE_FAILED');
  }
});

app.get('/api/my/entitlements', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `SELECT
         e.id,
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status,
         e.gift_token IS NOT NULL AS "wasGift",
         e.claimed_at AS "claimedAt",
         e.redeemed_at AS "redeemedAt",
         e.redeemed_book_id AS "redeemedBookId",
         e.created_at AS "createdAt"
       FROM book_entitlements e
       WHERE e.assigned_user_id = $1
       ORDER BY
         CASE WHEN e.status = 'available' THEN 0 ELSE 1 END,
         e.created_at DESC`,
      [session.user.id]
    );

    res.status(200).json({ entitlements: result.rows });
  } catch (err) {
    console.error('Entitlement list error:', err);
    res.status(500).json({ error: 'ENTITLEMENT_LIST_FAILED' });
  }
});

app.get('/api/gift-entitlements/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status,
         e.assigned_user_id IS NOT NULL AS "claimed"
       FROM book_entitlements e
       JOIN purchases p ON p.id = e.purchase_id
       WHERE e.gift_token = $1
         AND p.purchase_mode = 'gift'
         AND p.payment_status = 'paid'`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'GIFT_ENTITLEMENT_NOT_FOUND' });
      return;
    }

    const row = result.rows[0];
    res.status(200).json({
      bookType: row.bookType,
      includedPages: row.includedPages,
      claimStatus:
        row.status === 'redeemed'
          ? 'redeemed'
          : row.claimed
            ? 'claimed'
            : 'available',
    });
  } catch (err) {
    console.error('Gift entitlement load error:', err);
    res.status(500).json({ error: 'GIFT_ENTITLEMENT_LOAD_FAILED' });
  }
});

app.post('/api/gift-entitlements/:token/redeem', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT
         e.id,
         e.assigned_user_id AS "assignedUserId",
         e.status,
         e.book_type AS "bookType",
         e.included_pages AS "includedPages"
       FROM book_entitlements e
       JOIN purchases p ON p.id = e.purchase_id
       WHERE e.gift_token = $1
         AND p.purchase_mode = 'gift'
         AND p.payment_status = 'paid'
       FOR UPDATE OF e`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'GIFT_ENTITLEMENT_NOT_FOUND' });
      return;
    }

    const entitlement = result.rows[0];
    if (entitlement.status !== 'available') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'GIFT_ENTITLEMENT_ALREADY_USED' });
      return;
    }

    if (entitlement.assignedUserId && entitlement.assignedUserId !== session.user.id) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'GIFT_ENTITLEMENT_ALREADY_CLAIMED' });
      return;
    }

    if (!entitlement.assignedUserId) {
      await client.query(
        `UPDATE book_entitlements
         SET assigned_user_id = $1,
             claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [session.user.id, entitlement.id]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      entitlement: {
        id: entitlement.id,
        bookType: entitlement.bookType,
        includedPages: entitlement.includedPages,
        status: 'available',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Gift entitlement redeem error:', err);
    res.status(500).json({ error: 'GIFT_ENTITLEMENT_REDEEM_FAILED' });
  } finally {
    client.release();
  }
});

app.post('/api/my/books', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const entitlementId =
    typeof req.body?.entitlementId === 'string' ? req.body.entitlementId.trim() : '';
  const requestedLanguage = req.body?.language;

  if (
    requestedLanguage !== undefined &&
    requestedLanguage !== 'hu' &&
    requestedLanguage !== 'en' &&
    requestedLanguage !== 'de'
  ) {
    res.status(400).json({ error: 'INVALID_BOOK_LANGUAGE' });
    return;
  }

  const language = requestedLanguage === 'de' ? 'de' : requestedLanguage === 'en' ? 'en' : 'hu';

  if (!title || title.length > 120) {
    res.status(400).json({ error: 'INVALID_BOOK_TITLE' });
    return;
  }
  if (!entitlementId) {
    res.status(402).json({ error: 'BOOK_ENTITLEMENT_REQUIRED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  const bookId = `book-${crypto.randomUUID()}`;
  const inviteToken = `invite-${crypto.randomUUID()}`;

  try {
    await client.query('BEGIN');

    const entitlementResult = await client.query(
      `SELECT
         id,
         book_type AS "bookType",
         included_pages AS "includedPages",
         status
       FROM book_entitlements
       WHERE id = $1
         AND assigned_user_id = $2
       FOR UPDATE`,
      [entitlementId, session.user.id]
    );

    if (entitlementResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'BOOK_ENTITLEMENT_NOT_AVAILABLE' });
      return;
    }

    const entitlement = entitlementResult.rows[0];
    if (entitlement.status !== 'available') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'BOOK_ENTITLEMENT_ALREADY_USED' });
      return;
    }

    const bookType = entitlement.bookType === 'event'
      ? 'event'
      : entitlement.bookType === 'dedication'
        ? 'dedication'
        : 'standard';
    const includedPages =
      bookType !== 'event'
        ? Math.max(1, Number(entitlement.includedPages) || DEFAULT_BOOK_PAGE_COUNT)
        : 0;

    const bookResult = await client.query(
      `INSERT INTO books (id, owner_user_id, title, invite_token, book_type, page_capacity, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id,
         title,
         book_type AS "bookType",
         page_capacity AS "pageCapacity",
         language,
         created_at AS "createdAt"`,
      [bookId, session.user.id, title, inviteToken, bookType, includedPages, language]
    );

    if (bookType !== 'event') {
      for (let pageNumber = 1; pageNumber <= includedPages; pageNumber += 1) {
        await client.query(
          `INSERT INTO pages (id, book_id, page_number)
           VALUES ($1, $2, $3)`,
          [`page-${crypto.randomUUID()}`, bookId, pageNumber]
        );
      }
    }

    await client.query(
      `UPDATE book_entitlements
       SET status = 'redeemed',
           redeemed_at = CURRENT_TIMESTAMP,
           redeemed_book_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [bookId, entitlement.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      book: {
        ...bookResult.rows[0],
        pageCount: includedPages,
        contributionCount: 0,
      },
      consumedEntitlementId: entitlement.id,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Book create error:', err);
    res.status(500).json({ error: 'BOOK_CREATE_FAILED' });
  } finally {
    client.release();
  }
});

app.patch('/api/my/books/:bookId/language', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const language = req.body?.language;
  if (language !== 'hu' && language !== 'en' && language !== 'de') {
    res.status(400).json({ error: 'INVALID_BOOK_LANGUAGE' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE books
       SET language = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND owner_user_id = $3
       RETURNING id, language`,
      [language, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, book: result.rows[0] });
  } catch (err) {
    console.error('Book language update error:', err);
    res.status(500).json({ error: 'BOOK_LANGUAGE_UPDATE_FAILED' });
  }
});

app.get('/api/my/books/:bookId/cover', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }
  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const result = await pool.query(
      `SELECT id, title, language,
              cover_canvas_json AS "canvasData",
              cover_preview_image_url AS "previewImageUrl",
              cover_version AS "version"
       FROM books
       WHERE id = $1 AND owner_user_id = $2 AND book_type IN ('standard', 'dedication')`,
      [req.params.bookId, session.user.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Book cover load error:', err);
    res.status(500).json({ error: 'BOOK_COVER_LOAD_FAILED' });
  }
});

app.put('/api/my/books/:bookId/cover', async (req, res) => {
  const { canvasData, previewDataUrl, expectedVersion } = req.body;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    res.status(400).json({ error: 'INVALID_EXPECTED_VERSION' });
    return;
  }
  if (!canvasData || typeof canvasData !== 'object' || Array.isArray(canvasData)) {
    res.status(400).json({ error: 'INVALID_CANVAS_DATA' });
    return;
  }
  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    const row = await saveBookCoverVersioned(
      req.params.bookId,
      session.user.id,
      canvasData,
      previewDataUrl,
      expectedVersion
    );
    res.status(200).json({
      success: true,
      newVersion: row.version,
      previewImageUrl: row.previewImageUrl,
      updatedAt: row.updatedAt,
    });
  } catch (err: any) {
    console.error('Book cover save error:', err);
    if (err?.status === 404) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }
    if (err?.status === 409) {
      res.status(409).json({ error: 'COVER_CONFLICT', latestRemoteVersion: err.latestRemoteVersion });
      return;
    }
    if (err?.message === 'INVALID_PREVIEW_FORMAT' || err?.message === 'INVALID_PREVIEW_JPEG' || err?.message === 'PREVIEW_TOO_LARGE') {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'BOOK_COVER_SAVE_FAILED' });
  }
});

app.get('/api/my/books/:bookId/event-settings', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `SELECT
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode",
         event_required_fields AS "requiredFields"
       FROM books
       WHERE id = $1
         AND owner_user_id = $2
         AND book_type = 'event'`,
      [req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'EVENT_BOOK_NOT_FOUND' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Event settings load error:', err);
    res.status(500).json({ error: 'EVENT_SETTINGS_LOAD_FAILED' });
  }
});

app.patch('/api/my/books/:bookId/event-settings', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const deviceLimit = Number(req.body?.deviceLimit);
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 100) {
    res.status(400).json({ error: 'INVALID_EVENT_DEVICE_LIMIT' });
    return;
  }
  const requiredFields = req.body?.requiredFields;
  if (
    !Array.isArray(requiredFields) ||
    requiredFields.some((field) => typeof field !== 'string' || !EVENT_REQUIRED_FIELDS.has(field)) ||
    new Set(requiredFields).size !== requiredFields.length
  ) {
    res.status(400).json({ error: 'INVALID_EVENT_REQUIRED_FIELDS' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE books
       SET event_device_limit = $1,
           event_required_fields = $2::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
         AND owner_user_id = $4
         AND book_type = 'event'
       RETURNING
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode",
         event_required_fields AS "requiredFields"`,
      [deviceLimit, JSON.stringify(requiredFields), req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'EVENT_BOOK_NOT_FOUND' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Event settings update error:', err);
    res.status(500).json({ error: 'EVENT_SETTINGS_UPDATE_FAILED' });
  }
});

app.get('/api/my/books/:bookId/pages', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);

    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const bookResult = await pool.query(
      `SELECT id, title, book_type AS "bookType", language, invite_token AS "eventInviteToken",
              cover_preview_image_url AS "coverPreviewImageUrl"
       FROM books
       WHERE id = $1 AND owner_user_id = $2`,
      [req.params.bookId, session.user.id]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    const pagesResult = await pool.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         version,
         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         invite_created_at AS "inviteCreatedAt",
         invite_sent_at AS "inviteSentAt",
         invite_recipient_name AS "inviteRecipientName",
         invite_recipient_email AS "inviteRecipientEmail",
         invite_delivery_method AS "inviteDeliveryMethod",
         invite_language AS "inviteLanguage",
         CASE
           WHEN invite_created_at IS NULL THEN NULL
           ELSE invite_created_at + INTERVAL '14 days'
         END AS "inviteExpiresAt",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",
         owner_note AS "ownerNote",
         author_share_approved AS "authorShareApproved",
         owner_share_approved AS "ownerShareApproved",
         public_share_token AS "publicShareToken",
         updated_at AS "updatedAt"
       FROM pages
       WHERE book_id = $1
       ORDER BY page_number ASC`,
      [req.params.bookId]
    );

    res.status(200).json({
      book: bookResult.rows[0],
      pages: pagesResult.rows,
    });
  } catch (err) {
    console.error('Owner pages load error:', err);
    res.status(500).json({ error: 'OWNER_PAGE_LIST_LOAD_FAILED' });
  }
});

app.post('/api/my/books/:bookId/dedications/:pageId/complete', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const { photoDataUrl, signatureDataUrl, previewDataUrl, signatureColor, expectedVersion } = req.body;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    res.status(400).json({ error: 'INVALID_EXPECTED_VERSION' });
    return;
  }
  if (
    typeof photoDataUrl !== 'string' ||
    typeof signatureDataUrl !== 'string' ||
    typeof previewDataUrl !== 'string' ||
    typeof signatureColor !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(signatureColor)
  ) {
    res.status(400).json({ error: 'INVALID_DEDICATION_DATA' });
    return;
  }

  const client = await pool.connect();
  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    await client.query('BEGIN');
    const pageResult = await client.query(
      `SELECT p.id, p.version, p.invite_status AS "inviteStatus"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3
         AND b.book_type = 'dedication'
       FOR UPDATE`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'DEDICATION_PAGE_NOT_FOUND' });
      return;
    }
    const page = pageResult.rows[0];
    if (page.inviteStatus !== 'empty' && page.inviteStatus !== 'submitted') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'DEDICATION_PAGE_ALREADY_COMPLETED' });
      return;
    }
    if (page.version !== expectedVersion) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_CONFLICT', latestRemoteVersion: page.version });
      return;
    }

    const photoUrl = await processAndSaveDedicationLayer(page.id, 'photo', photoDataUrl);
    const signatureUrl = await processAndSaveDedicationLayer(page.id, 'signature', signatureDataUrl);
    const previewImageUrl = await processAndSavePreview(page.id, previewDataUrl);
    const canvasData = {
      type: 'dedication',
      schemaVersion: 1,
      width: 720,
      height: 960,
      photo: { url: photoUrl, fit: 'cover', position: 'center' },
      signature: { url: signatureUrl, color: signatureColor },
    };

    const result = await client.query(
      `UPDATE pages
       SET canvas_json = $1,
           preview_image_url = $2,
           version = version + 1,
           invite_status = 'submitted',
           owner_visibility = 'active',
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING version, preview_image_url AS "previewImageUrl", submitted_at AS "submittedAt"`,
      [canvasData, previewImageUrl, page.id]
    );

    await client.query('COMMIT');
    res.status(200).json({ success: true, ...result.rows[0] });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Dedication completion error:', err);
    if (
      err?.message === 'INVALID_DEDICATION_LAYER_FORMAT' ||
      err?.message === 'DEDICATION_LAYER_TOO_LARGE' ||
      err?.message === 'INVALID_PREVIEW_FORMAT' ||
      err?.message === 'INVALID_PREVIEW_JPEG' ||
      err?.message === 'PREVIEW_TOO_LARGE'
    ) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'DEDICATION_COMPLETE_FAILED' });
  } finally {
    client.release();
  }
});

app.post('/api/my/books/:bookId/pages/:pageId/invite', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);

    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const pageResult = await pool.query(
      `SELECT
         p.id,
         p.page_number AS "pageNumber",
         p.invite_token AS "inviteToken",
         p.invite_status AS "inviteStatus"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus === 'submitted') {
      res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    const token =
      pageResult.rows[0].inviteToken || `page-invite-${crypto.randomUUID()}`;

    const inviteUpdate = await pool.query(
      `UPDATE pages
       SET invite_token = $1,
           invite_status = CASE
             WHEN invite_status = 'empty' THEN 'invited'
             ELSE invite_status
           END,
           invite_created_at = COALESCE(invite_created_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING
         invite_created_at AS "inviteCreatedAt",
         invite_sent_at AS "inviteSentAt",
         invite_created_at + INTERVAL '14 days' AS "inviteExpiresAt"`,
      [token, req.params.pageId]
    );

    res.status(200).json({
      success: true,
      pageId: req.params.pageId,
      pageNumber: pageResult.rows[0].pageNumber,
      inviteToken: token,
      invitePath: `/p/${token}`,
      inviteCreatedAt: inviteUpdate.rows[0].inviteCreatedAt,
      inviteSentAt: inviteUpdate.rows[0].inviteSentAt,
      inviteExpiresAt: inviteUpdate.rows[0].inviteExpiresAt,
      inviteValidDays: PAGE_INVITE_VALID_DAYS,
    });
  } catch (err) {
    console.error('Page invite create error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_CREATE_FAILED' });
  }
});


app.post('/api/my/books/:bookId/pages/:pageId/invite/sent', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const recipientName =
    typeof req.body?.recipientName === 'string' ? req.body.recipientName.trim() : '';
  const recipientEmail =
    typeof req.body?.recipientEmail === 'string' ? req.body.recipientEmail.trim() : '';
  const deliveryMethod =
    req.body?.deliveryMethod === 'email'
      ? 'email'
      : req.body?.deliveryMethod === 'share'
        ? 'share'
        : null;
  const rawInviteLanguage = req.body?.inviteLanguage;
  const inviteLanguage =
    rawInviteLanguage === null || rawInviteLanguage === undefined || rawInviteLanguage === ''
      ? null
      : rawInviteLanguage === 'hu' || rawInviteLanguage === 'en' || rawInviteLanguage === 'de'
        ? rawInviteLanguage
        : 'invalid';

  if (inviteLanguage === 'invalid') {
    res.status(400).json({ error: 'INVALID_INVITE_LANGUAGE' });
    return;
  }

  if (!deliveryMethod) {
    res.status(400).json({ error: 'INVALID_INVITE_DELIVERY_METHOD' });
    return;
  }
  if (recipientName.length > 120 || recipientEmail.length > 240) {
    res.status(400).json({ error: 'INVALID_INVITE_RECIPIENT' });
    return;
  }
  if (deliveryMethod === 'share' && !recipientName) {
    res.status(400).json({ error: 'INVITE_RECIPIENT_NAME_REQUIRED' });
    return;
  }
  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const existingInviteResult = await pool.query(
      `SELECT
         p.invite_recipient_name AS "inviteRecipientName",
         p.invite_recipient_email AS "inviteRecipientEmail",
         p.invite_delivery_method AS "inviteDeliveryMethod"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3
         AND p.invite_token IS NOT NULL
         AND p.invite_status IN ('invited', 'draft')`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (existingInviteResult.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    const existingInvite = existingInviteResult.rows[0];
    const savedRecipientName = String(existingInvite.inviteRecipientName || '').trim();
    const savedRecipientEmail = String(existingInvite.inviteRecipientEmail || '').trim().toLowerCase();
    const savedDeliveryMethod = String(existingInvite.inviteDeliveryMethod || '').trim();
    const recipientChanged =
      (savedRecipientName && recipientName && savedRecipientName.toLocaleLowerCase('hu-HU') !== recipientName.toLocaleLowerCase('hu-HU')) ||
      (savedRecipientEmail && recipientEmail && savedRecipientEmail !== recipientEmail.toLowerCase()) ||
      (savedDeliveryMethod && savedDeliveryMethod !== deliveryMethod);

    if (recipientChanged) {
      res.status(409).json({ error: 'PAGE_INVITE_RECIPIENT_LOCKED' });
      return;
    }

    const result = await pool.query(
      `UPDATE pages p
       SET invite_sent_at = COALESCE(p.invite_sent_at, CURRENT_TIMESTAMP),
           invite_recipient_name = COALESCE(p.invite_recipient_name, NULLIF($4, '')),
           invite_recipient_email = COALESCE(p.invite_recipient_email, NULLIF($5, '')),
           invite_delivery_method = COALESCE(p.invite_delivery_method, $6),
           invite_language = $7,
           updated_at = CURRENT_TIMESTAMP
       FROM books b
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.id = p.book_id
         AND b.owner_user_id = $3
         AND p.invite_token IS NOT NULL
         AND p.invite_status IN ('invited', 'draft')
       RETURNING
         p.invite_sent_at AS "inviteSentAt",
         p.invite_created_at AS "inviteCreatedAt",
         p.invite_created_at + INTERVAL '14 days' AS "inviteExpiresAt",
         p.invite_recipient_name AS "inviteRecipientName",
         p.invite_recipient_email AS "inviteRecipientEmail",
         p.invite_delivery_method AS "inviteDeliveryMethod",
         p.invite_language AS "inviteLanguage"`,
      [
        req.params.pageId,
        req.params.bookId,
        session.user.id,
        recipientName,
        recipientEmail,
        deliveryMethod,
        inviteLanguage,
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, ...result.rows[0] });
  } catch (err) {
    console.error('Page invite sent-state error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_SENT_STATE_FAILED' });
  }
});

app.post('/api/my/books/:bookId/pages/:pageId/invite/reassign', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pageResult = await client.query(
      `SELECT
         p.id,
         p.invite_status AS "inviteStatus",
         p.invite_created_at AS "inviteCreatedAt"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3
       FOR UPDATE OF p`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus === 'submitted') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (!isPageInviteExpired(pageResult.rows[0].inviteCreatedAt)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_INVITE_NOT_EXPIRED' });
      return;
    }

    const token = `page-invite-${crypto.randomUUID()}`;
    const result = await client.query(
      `UPDATE pages
       SET canvas_json = '{}'::jsonb,
           preview_image_url = NULL,
           version = version + 1,
           invite_token = $1,
           invite_status = 'invited',
           invite_created_at = CURRENT_TIMESTAMP,
           invite_sent_at = NULL,
           invite_recipient_name = NULL,
           invite_recipient_email = NULL,
           invite_delivery_method = NULL,
           invite_language = NULL,
           submitted_at = NULL,
           owner_note = NULL,
           owner_visibility = 'active',
           author_share_approved = FALSE,
           owner_share_approved = FALSE,
           public_share_token = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND book_id = $3
       RETURNING
         invite_created_at AS "inviteCreatedAt",
         invite_created_at + INTERVAL '14 days' AS "inviteExpiresAt"`,
      [token, req.params.pageId, req.params.bookId]
    );

    await client.query('COMMIT');
    deletePagePreviewAsset(req.params.pageId).catch(() => {});

    res.status(200).json({
      success: true,
      pageId: req.params.pageId,
      inviteToken: token,
      invitePath: `/p/${token}`,
      inviteCreatedAt: result.rows[0].inviteCreatedAt,
      inviteSentAt: null,
      inviteExpiresAt: result.rows[0].inviteExpiresAt,
      inviteRecipientName: null,
      inviteRecipientEmail: null,
      inviteDeliveryMethod: null,
      inviteLanguage: null,
      inviteValidDays: PAGE_INVITE_VALID_DAYS,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Expired page invite reassignment error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_REASSIGN_FAILED' });
  } finally {
    client.release();
  }
});

app.patch('/api/my/books/:bookId/pages/:pageId/sharing', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const approved = req.body?.approved;
  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'INVALID_SHARE_APPROVAL' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const pageResult = await pool.query(
      `SELECT
         p.id,
         p.invite_status AS "inviteStatus",
         p.author_share_approved AS "authorShareApproved",
         p.public_share_token AS "publicShareToken"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus !== 'submitted') {
      res.status(409).json({ error: 'PAGE_NOT_SUBMITTED' });
      return;
    }

    if (approved && !pageResult.rows[0].authorShareApproved) {
      res.status(409).json({ error: 'AUTHOR_SHARE_APPROVAL_REQUIRED' });
      return;
    }

    const token = pageResult.rows[0].publicShareToken || `public-${crypto.randomUUID()}`;

    const result = await pool.query(
      `UPDATE pages
       SET owner_share_approved = $1,
           public_share_token = COALESCE(public_share_token, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND book_id = $4
       RETURNING
         id,
         page_number AS "pageNumber",
         version,
         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",
         author_share_approved AS "authorShareApproved",
         owner_share_approved AS "ownerShareApproved",
         public_share_token AS "publicShareToken",
         updated_at AS "updatedAt"`,
      [approved, token, req.params.pageId, req.params.bookId]
    );

    res.status(200).json({ success: true, page: result.rows[0] });
  } catch (err) {
    console.error('Owner page sharing update error:', err);
    res.status(500).json({ error: 'OWNER_PAGE_SHARING_UPDATE_FAILED' });
  }
});

app.get('/api/public-pages/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         b.title AS "bookTitle",
         p.id,
         p.page_number AS "pageNumber",
         p.preview_image_url AS "previewImageUrl",
         p.submitted_at AS "submittedAt"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.public_share_token = $1
         AND p.invite_status = 'submitted'
         AND p.owner_visibility = 'active'
         AND p.author_share_approved = TRUE
         AND p.owner_share_approved = TRUE`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PUBLIC_PAGE_NOT_FOUND' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Public page load error:', err);
    res.status(500).json({ error: 'PUBLIC_PAGE_LOAD_FAILED' });
  }
});

app.patch('/api/my/books/:bookId/pages/:pageId/visibility', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const visibility = req.body?.visibility;

  if (!['active', 'archived'].includes(visibility)) {
    res.status(400).json({ error: 'INVALID_PAGE_VISIBILITY' });
    return;
  }

  try {
    const session = await getSession(req);

    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const pageResult = await pool.query(
      `SELECT p.id, p.invite_status AS "inviteStatus"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus !== 'submitted') {
      res.status(409).json({ error: 'PAGE_NOT_SUBMITTED' });
      return;
    }

    const result = await pool.query(
      `UPDATE pages
       SET owner_visibility = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND book_id = $3
       RETURNING
         id,
         page_number AS "pageNumber",
         version,
         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",
         author_share_approved AS "authorShareApproved",
         owner_share_approved AS "ownerShareApproved",
         public_share_token AS "publicShareToken",
         updated_at AS "updatedAt"`,
      [visibility, req.params.pageId, req.params.bookId]
    );

    res.status(200).json({ success: true, page: result.rows[0] });
  } catch (err) {
    console.error('Owner page visibility update error:', err);
    res.status(500).json({ error: 'OWNER_PAGE_VISIBILITY_UPDATE_FAILED' });
  }
});

app.delete('/api/my/books/:bookId/pages/:pageId', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const session = await getSession(req).catch(() => null);

  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pageResult = await client.query(
      `SELECT
         p.id,
         p.page_number AS "pageNumber",
         p.invite_status AS "inviteStatus"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1
         AND p.book_id = $2
         AND b.owner_user_id = $3
       FOR UPDATE OF p`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (pageResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus !== 'submitted') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_NOT_SUBMITTED' });
      return;
    }

    const result = await client.query(
      `UPDATE pages
       SET canvas_json = '{}'::jsonb,
           preview_image_url = NULL,
           version = version + 1,
           invite_token = NULL,
           invite_status = 'empty',
           invite_created_at = NULL,
           invite_sent_at = NULL,
           invite_recipient_name = NULL,
           invite_recipient_email = NULL,
           invite_delivery_method = NULL,
           invite_language = NULL,
           submitted_at = NULL,
           owner_note = NULL,
           owner_visibility = 'active',
           author_share_approved = FALSE,
           owner_share_approved = FALSE,
           public_share_token = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND book_id = $2
       RETURNING
         id,
         page_number AS "pageNumber",
         version,
         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",
         author_share_approved AS "authorShareApproved",
         owner_share_approved AS "ownerShareApproved",
         public_share_token AS "publicShareToken",
         updated_at AS "updatedAt"`,
      [req.params.pageId, req.params.bookId]
    );

    await client.query('COMMIT');
    deletePagePreviewAsset(req.params.pageId).catch(() => {});

    res.status(200).json({ success: true, page: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Owner page delete error:', err);
    res.status(500).json({ error: 'OWNER_PAGE_DELETE_FAILED' });
  } finally {
    client.release();
  }
});

app.get('/api/page-invites/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         b.id AS "bookId",
         b.title AS "bookTitle",
         p.id,
         p.page_number AS "pageNumber",
         p.canvas_json AS "canvasData",
         p.preview_image_url AS "previewImageUrl",
         p.version,
         p.invite_status AS "inviteStatus",
         p.invite_created_at AS "inviteCreatedAt",
         p.invite_created_at + INTERVAL '14 days' AS "inviteExpiresAt",
         p.invite_language AS "inviteLanguage",
         p.invite_recipient_name AS "inviteRecipientName",
         COALESCE(p.invite_language, b.language) AS "language",
         p.submitted_at AS "submittedAt"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.invite_token = $1`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    if (result.rows[0].inviteStatus === 'submitted') {
      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (isPageInviteExpired(result.rows[0].inviteCreatedAt)) {
      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });
      return;
    }

    res.status(200).json({ ...result.rows[0], inviteValidDays: PAGE_INVITE_VALID_DAYS });
  } catch (err) {
    console.error('Page invite load error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_LOAD_FAILED' });
  }
});

app.put('/api/page-invites/:token', async (req, res) => {
  const { canvasData, previewDataUrl, expectedVersion } = req.body;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    res.status(400).json({ error: 'INVALID_EXPECTED_VERSION' });
    return;
  }

  if (!canvasData || typeof canvasData !== 'object' || Array.isArray(canvasData)) {
    res.status(400).json({ error: 'INVALID_CANVAS_DATA' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const inviteResult = await client.query(
      `SELECT
         id,
         invite_status AS "inviteStatus",
         invite_created_at AS "inviteCreatedAt"
       FROM pages
       WHERE invite_token = $1
       FOR UPDATE`,
      [req.params.token]
    );

    if (inviteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    if (inviteResult.rows[0].inviteStatus === 'submitted') {
      await client.query('ROLLBACK');
      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (isPageInviteExpired(inviteResult.rows[0].inviteCreatedAt)) {
      await client.query('ROLLBACK');
      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });
      return;
    }

    const row = await savePageVersioned(
      inviteResult.rows[0].id,
      canvasData,
      previewDataUrl,
      expectedVersion,
      'draft',
      true,
      client
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      newVersion: row.version,
      previewImageUrl: row.previewImageUrl,
      updatedAt: row.updatedAt,
    });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Invite page save error:', err);

    if (err?.status === 404) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (err?.status === 409) {
      res.status(409).json({
        error: 'PAGE_CONFLICT',
        latestRemoteVersion: err.latestRemoteVersion,
      });
      return;
    }

    if (err?.status === 410 || err?.message === 'PAGE_ALREADY_SUBMITTED') {
      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (
      err?.message === 'INVALID_PREVIEW_FORMAT' ||
      err?.message === 'INVALID_PREVIEW_JPEG' ||
      err?.message === 'PREVIEW_TOO_LARGE'
    ) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: 'PAGE_SAVE_FAILED' });
  } finally {
    client.release();
  }
});

app.post('/api/page-invites/:token/submit', async (req, res) => {
  const authorShareApproved = req.body?.authorShareApproved === true;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pageResult = await client.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         invite_status AS "inviteStatus",
         invite_created_at AS "inviteCreatedAt",
         submitted_at AS "submittedAt"
       FROM pages
       WHERE invite_token = $1
       FOR UPDATE`,
      [req.params.token]
    );

    if (pageResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    if (pageResult.rows[0].inviteStatus === 'submitted') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (isPageInviteExpired(pageResult.rows[0].inviteCreatedAt)) {
      await client.query('ROLLBACK');
      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });
      return;
    }

    if (!['invited', 'draft'].includes(pageResult.rows[0].inviteStatus)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_NOT_READY_FOR_SUBMIT' });
      return;
    }

    const result = await client.query(
      `UPDATE pages
       SET invite_status = 'submitted',
           owner_visibility = 'active',
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           author_share_approved = $2,
           owner_share_approved = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
         id,
         page_number AS "pageNumber",
         submitted_at AS "submittedAt"`,
      [pageResult.rows[0].id, authorShareApproved]
    );

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      pageId: result.rows[0].id,
      pageNumber: result.rows[0].pageNumber,
      submittedAt: result.rows[0].submittedAt,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Invite page submit error:', err);
    res.status(500).json({ error: 'PAGE_SUBMIT_FAILED' });
  } finally {
    client.release();
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.status(200).json({ ok: true, databaseTime: result.rows[0].now });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ ok: false, error: 'DATABASE_CONNECTION_FAILED' });
  }
});

app.get('/api/invites/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         title,
         book_type AS "bookType",
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode"
       FROM books
       WHERE invite_token = $1`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    if (result.rows[0].bookType !== 'event' && result.rows[0].id !== DEMO_BOOK_ID) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    res.status(200).json({
      bookId: result.rows[0].id,
      title: result.rows[0].title,
      bookType: result.rows[0].bookType,
      deviceLimit: result.rows[0].deviceLimit,
      identityMode: result.rows[0].identityMode,
    });
  } catch (err) {
    console.error('Legacy invite load error:', err);
    res.status(500).json({ error: 'INVITE_LOAD_FAILED' });
  }
});

app.post('/api/invites/:token/page-session', async (req, res) => {
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
  if (deviceId.length < 8 || deviceId.length > 200) {
    res.status(400).json({ error: 'INVALID_DEVICE_ID' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookResult = await client.query(
      `SELECT
         id,
         language,
         event_device_limit AS "deviceLimit"
       FROM books
       WHERE invite_token = $1
         AND book_type = 'event'
       FOR UPDATE`,
      [req.params.token]
    );

    if (bookResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    const book = bookResult.rows[0];
    const existingDraft = await client.query(
      `SELECT invite_token AS "inviteToken"
       FROM pages
       WHERE book_id = $1
         AND event_device_id = $2
         AND invite_status IN ('invited', 'draft')
       ORDER BY invite_created_at DESC
       LIMIT 1`,
      [book.id, deviceId]
    );

    if (existingDraft.rowCount > 0) {
      await client.query('COMMIT');
      const inviteToken = existingDraft.rows[0].inviteToken;
      res.status(200).json({ inviteToken, invitePath: `/p/${inviteToken}`, resumed: true });
      return;
    }

    const usedResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM pages
       WHERE book_id = $1
         AND event_device_id = $2
         AND invite_status = 'submitted'`,
      [book.id, deviceId]
    );
    const used = Number(usedResult.rows[0]?.count || 0);
    const deviceLimit = Math.max(1, Number(book.deviceLimit) || 1);
    if (used >= deviceLimit) {
      await client.query('ROLLBACK');
      res.status(429).json({
        error: 'DEVICE_CONTRIBUTION_LIMIT_REACHED',
        deviceLimit,
        deviceSubmissionsUsed: used,
        deviceSubmissionsRemaining: 0,
      });
      return;
    }

    const pageNumberResult = await client.query(
      `SELECT COALESCE(MAX(page_number), 0)::int + 1 AS "pageNumber"
       FROM pages
       WHERE book_id = $1`,
      [book.id]
    );
    const pageId = `page-${crypto.randomUUID()}`;
    const inviteToken = `page-invite-${crypto.randomUUID()}`;
    const pageNumber = Number(pageNumberResult.rows[0].pageNumber);

    await client.query(
      `INSERT INTO pages (
         id, book_id, page_number, invite_token, invite_status,
         invite_created_at, invite_language, event_device_id
       )
       VALUES ($1, $2, $3, $4, 'invited', CURRENT_TIMESTAMP, $5, $6)`,
      [pageId, book.id, pageNumber, inviteToken, book.language, deviceId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      pageId,
      pageNumber,
      inviteToken,
      invitePath: `/p/${inviteToken}`,
      resumed: false,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Event page session create error:', err);
    res.status(500).json({ error: 'EVENT_PAGE_SESSION_CREATE_FAILED' });
  } finally {
    client.release();
  }
});

app.get('/api/books/:bookId/contributions', async (req, res) => {
  try {
    const bookResult = await pool.query(
      `SELECT id, title, book_type AS "bookType", owner_user_id AS "ownerUserId"
       FROM books
       WHERE id = $1`,
      [req.params.bookId]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    if (req.params.bookId !== DEMO_BOOK_ID) {
      const session = await getSession(req);

      if (!session) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }

      if (session.user.id !== bookResult.rows[0].ownerUserId) {
        res.status(404).json({ error: 'BOOK_NOT_FOUND' });
        return;
      }
    }

    const contributionsResult = await pool.query(
      `SELECT
         id,
         contributor_name AS "contributorName",
         memory_text AS "memoryText",
         photo_url AS "photoUrl",
         owner_status AS "ownerStatus",
         owner_group AS "ownerGroup",
         owner_order AS "ownerOrder",
         created_at AS "createdAt"
       FROM contributions
       WHERE book_id = $1
       ORDER BY created_at DESC`,
      [req.params.bookId]
    );

    const { ownerUserId: _ownerUserId, ...bookData } = bookResult.rows[0];

    res.status(200).json({
      book: bookData,
      contributions: contributionsResult.rows,
    });
  } catch (err) {
    console.error('Contribution list error:', err);
    res.status(500).json({ error: 'CONTRIBUTIONS_LOAD_FAILED' });
  }
});

app.post('/api/invites/:token/contributions', async (req, res) => {
  const { contributorName, memoryText, photoDataUrl, deviceId } = req.body;

  if (!contributorName || typeof contributorName !== 'string' || !contributorName.trim()) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTOR_NAME' });
    return;
  }

  if (!memoryText || typeof memoryText !== 'string' || !memoryText.trim()) {
    res.status(400).json({ error: 'INVALID_MEMORY_TEXT' });
    return;
  }

  if (
    photoDataUrl !== undefined &&
    photoDataUrl !== null &&
    typeof photoDataUrl !== 'string'
  ) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_PHOTO' });
    return;
  }

  if (
    deviceId !== undefined &&
    deviceId !== null &&
    (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 200)
  ) {
    res.status(400).json({ error: 'INVALID_DEVICE_ID' });
    return;
  }

  let savedPhotoUrl: string | null = null;
  let previousDeviceSubmissionCount = 0;
  let deviceLimit: number | null = null;

  try {
    const bookResult = await pool.query(
      `SELECT
         id,
         book_type AS "bookType",
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode"
       FROM books
       WHERE invite_token = $1`,
      [req.params.token]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    if (bookResult.rows[0].bookType !== 'event' && bookResult.rows[0].id !== DEMO_BOOK_ID) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    deviceLimit = Number(bookResult.rows[0].deviceLimit) || 1;

    if (
      bookResult.rows[0].bookType === 'event' &&
      typeof deviceId === 'string' &&
      deviceId.trim()
    ) {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM contributions
         WHERE book_id = $1 AND device_id = $2`,
        [bookResult.rows[0].id, deviceId.trim()]
      );
      previousDeviceSubmissionCount = Number(countResult.rows[0]?.count || 0);

      if (previousDeviceSubmissionCount >= deviceLimit) {
        res.status(429).json({
          error: 'DEVICE_CONTRIBUTION_LIMIT_REACHED',
          deviceLimit,
          deviceSubmissionsUsed: previousDeviceSubmissionCount,
          deviceSubmissionsRemaining: 0,
        });
        return;
      }
    }

    const contributionId = `contribution-${crypto.randomUUID()}`;

    if (photoDataUrl && typeof photoDataUrl === 'string' && photoDataUrl.trim()) {
      savedPhotoUrl = await processAndSaveContributionPhoto(
        contributionId,
        photoDataUrl
      );
    }

    const result = await pool.query(
      `INSERT INTO contributions (
         id, book_id, contributor_name, memory_text, photo_url, device_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id,
         book_id AS "bookId",
         contributor_name AS "contributorName",
         memory_text AS "memoryText",
         photo_url AS "photoUrl",
         owner_status AS "ownerStatus",
         created_at AS "createdAt"`,
      [
        contributionId,
        bookResult.rows[0].id,
        contributorName.trim(),
        memoryText.trim(),
        savedPhotoUrl,
        typeof deviceId === 'string' && deviceId.trim() ? deviceId.trim() : null,
      ]
    );

    const deviceSubmissionsUsed =
      typeof deviceId === 'string' && deviceId.trim()
        ? previousDeviceSubmissionCount + 1
        : null;
    const deviceSubmissionsRemaining =
      deviceSubmissionsUsed !== null && deviceLimit !== null
        ? Math.max(0, deviceLimit - deviceSubmissionsUsed)
        : null;

    res.status(201).json({
      success: true,
      contribution: result.rows[0],
      deviceLimit,
      deviceSubmissionsUsed,
      deviceSubmissionsRemaining,
    });
  } catch (err: any) {
    console.error('Contribution save error:', err);

    if (
      err?.message === 'INVALID_CONTRIBUTION_PHOTO_FORMAT' ||
      err?.message === 'CONTRIBUTION_PHOTO_TOO_LARGE'
    ) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: 'CONTRIBUTION_SAVE_FAILED' });
  }
});

app.patch('/api/my/books/:bookId/contributions/:contributionId', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const ownerStatus = req.body?.ownerStatus;
  if (!['pending', 'kept', 'rejected'].includes(ownerStatus)) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_STATUS' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE contributions c
       SET owner_status = $1,
           owner_order = CASE
             WHEN $1 = 'kept' THEN COALESCE(
               c.owner_order,
               (
                 SELECT COALESCE(MAX(c2.owner_order), 0) + 1
                 FROM contributions c2
                 WHERE c2.book_id = $3
                   AND c2.owner_status = 'kept'
               )
             )
             ELSE NULL
           END
       FROM books b
       WHERE c.id = $2
         AND c.book_id = $3
         AND b.id = c.book_id
         AND b.owner_user_id = $4
         AND b.book_type = 'event'
       RETURNING
         c.id,
         c.contributor_name AS "contributorName",
         c.memory_text AS "memoryText",
         c.photo_url AS "photoUrl",
         c.owner_status AS "ownerStatus",
         c.owner_group AS "ownerGroup",
         c.owner_order AS "ownerOrder",
         c.created_at AS "createdAt"`,
      [ownerStatus, req.params.contributionId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'CONTRIBUTION_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('Contribution moderation error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_MODERATION_FAILED' });
  }
});

app.patch('/api/my/books/:bookId/contributions/:contributionId/group', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const rawGroup = req.body?.ownerGroup;
  if (rawGroup !== null && rawGroup !== undefined && typeof rawGroup !== 'string') {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_GROUP' });
    return;
  }

  const ownerGroup = typeof rawGroup === 'string' ? rawGroup.trim() : '';
  if (ownerGroup.length > 80) {
    res.status(400).json({ error: 'CONTRIBUTION_GROUP_TOO_LONG' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE contributions c
       SET owner_group = $1
       FROM books b
       WHERE c.id = $2
         AND c.book_id = $3
         AND c.owner_status = 'kept'
         AND b.id = c.book_id
         AND b.owner_user_id = $4
         AND b.book_type = 'event'
       RETURNING
         c.id,
         c.contributor_name AS "contributorName",
         c.memory_text AS "memoryText",
         c.photo_url AS "photoUrl",
         c.owner_status AS "ownerStatus",
         c.owner_group AS "ownerGroup",
         c.owner_order AS "ownerOrder",
         c.created_at AS "createdAt"`,
      [ownerGroup || null, req.params.contributionId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'CONTRIBUTION_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('Contribution group update error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_GROUP_UPDATE_FAILED' });
  }
});

app.put('/api/my/books/:bookId/contributions/reorder', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const contributionIds = req.body?.contributionIds;
  if (
    !Array.isArray(contributionIds) ||
    contributionIds.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(contributionIds).size !== contributionIds.length
  ) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_ORDER' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookResult = await client.query(
      `SELECT id
       FROM books
       WHERE id = $1 AND owner_user_id = $2 AND book_type = 'event'
       FOR UPDATE`,
      [req.params.bookId, session.user.id]
    );

    if (bookResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    const keptResult = await client.query(
      `SELECT id
       FROM contributions
       WHERE book_id = $1 AND owner_status = 'kept'
       ORDER BY COALESCE(owner_order, 2147483647), created_at ASC, id ASC
       FOR UPDATE`,
      [req.params.bookId]
    );

    const keptIds = keptResult.rows.map((row) => String(row.id));
    const requested = new Set(contributionIds);
    if (
      keptIds.length !== contributionIds.length ||
      keptIds.some((id) => !requested.has(id))
    ) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'ORDER_MUST_INCLUDE_ALL_KEPT_CONTRIBUTIONS' });
      return;
    }

    for (let index = 0; index < contributionIds.length; index += 1) {
      await client.query(
        `UPDATE contributions
         SET owner_order = $1
         WHERE id = $2 AND book_id = $3 AND owner_status = 'kept'`,
        [index + 1, contributionIds[index], req.params.bookId]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      order: contributionIds.map((id, index) => ({ id, ownerOrder: index + 1 })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Contribution reorder error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_REORDER_FAILED' });
  } finally {
    client.release();
  }
});

app.get('/api/books/:bookId/pages', async (req, res) => {
  try {
    const bookResult = await pool.query(
      `SELECT id, title, owner_user_id AS "ownerUserId"
       FROM books
       WHERE id = $1`,
      [req.params.bookId]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    if (req.params.bookId !== DEMO_BOOK_ID) {
      const session = await getSession(req);

      if (!session) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }

      if (session.user.id !== bookResult.rows[0].ownerUserId) {
        res.status(404).json({ error: 'BOOK_NOT_FOUND' });
        return;
      }
    }

    const result = await pool.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         version,
         updated_at AS "updatedAt"
       FROM pages
       WHERE book_id = $1
         AND owner_visibility = 'active'
       ORDER BY page_number ASC, id ASC`,
      [req.params.bookId]
    );

    const { ownerUserId: _ownerUserId, ...bookData } = bookResult.rows[0];

    res.status(200).json({
      book: bookData,
      pages: result.rows,
    });
  } catch (err) {
    console.error('Page list error:', err);
    res.status(500).json({ error: 'PAGE_LIST_LOAD_FAILED' });
  }
});

app.put('/api/books/:bookId/pages/reorder', async (req, res) => {
  const { pageIds } = req.body;

  if (
    !Array.isArray(pageIds) ||
    pageIds.length === 0 ||
    pageIds.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    res.status(400).json({ error: 'INVALID_PAGE_ORDER' });
    return;
  }

  const uniqueIds = new Set(pageIds);

  if (uniqueIds.size !== pageIds.length) {
    res.status(400).json({ error: 'DUPLICATE_PAGE_ID' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const bookResult = await client.query(
      `SELECT id, owner_user_id AS "ownerUserId"
       FROM books
       WHERE id = $1
       FOR UPDATE`,
      [req.params.bookId]
    );

    if (bookResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    if (req.params.bookId !== DEMO_BOOK_ID) {
      const session = await getSession(req);

      if (!session || session.user.id !== bookResult.rows[0].ownerUserId) {
        await client.query('ROLLBACK');
        res.status(403).json({ error: 'BOOK_WRITE_FORBIDDEN' });
        return;
      }
    }

    const existingResult = await client.query(
      `SELECT id
       FROM pages
       WHERE book_id = $1
       ORDER BY page_number ASC, id ASC
       FOR UPDATE`,
      [req.params.bookId]
    );

    const existingIds = existingResult.rows.map((row) => String(row.id));

    if (
      existingIds.length !== pageIds.length ||
      existingIds.some((id) => !uniqueIds.has(id))
    ) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'PAGE_ORDER_MUST_INCLUDE_ALL_PAGES' });
      return;
    }

    for (let index = 0; index < pageIds.length; index += 1) {
      await client.query(
        `UPDATE pages
         SET page_number = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND book_id = $3`,
        [index + 1, pageIds[index], req.params.bookId]
      );
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      pages: pageIds.map((id, index) => ({ id, pageNumber: index + 1 })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Page reorder error:', err);
    res.status(500).json({ error: 'PAGE_REORDER_FAILED' });
  } finally {
    client.release();
  }
});

app.get('/api/pages/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.page_number AS "pageNumber",
         p.canvas_json AS "canvasData",
         p.preview_image_url AS "previewImageUrl",
         p.version,
         p.owner_visibility AS "ownerVisibility",
         p.invite_sent_at AS "inviteSentAt",
         p.invite_recipient_name AS "inviteRecipientName",
         p.invite_recipient_email AS "inviteRecipientEmail",
         p.invite_delivery_method AS "inviteDeliveryMethod",
         p.submitted_at AS "submittedAt",
         p.owner_note AS "ownerNote",
         p.updated_at AS "updatedAt",
         p.book_id AS "bookId",
         b.owner_user_id AS "ownerUserId"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    const row = result.rows[0];

    if (row.bookId !== DEMO_BOOK_ID) {
      const session = await getSession(req);

      if (!session) {
        res.status(401).json({ error: 'UNAUTHENTICATED' });
        return;
      }

      if (session.user.id !== row.ownerUserId) {
        res.status(404).json({ error: 'PAGE_NOT_FOUND' });
        return;
      }
    }

    const { bookId: _bookId, ownerUserId: _ownerUserId, ownerVisibility: _ownerVisibility, ...pageData } = row;
    res.status(200).json(pageData);
  } catch (err) {
    console.error('Page load error:', err);
    res.status(500).json({ error: 'PAGE_LOAD_FAILED' });
  }
});


app.patch('/api/my/books/:bookId/pages/:pageId/memory-note', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  if (typeof req.body?.ownerNote !== 'string') {
    res.status(400).json({ error: 'INVALID_OWNER_NOTE' });
    return;
  }

  const ownerNote = req.body.ownerNote.trim();
  if (ownerNote.length > 2000) {
    res.status(400).json({ error: 'OWNER_NOTE_TOO_LONG' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE pages p
       SET owner_note = NULLIF($1, ''),
           updated_at = CURRENT_TIMESTAMP
       FROM books b
       WHERE p.id = $2
         AND p.book_id = $3
         AND b.id = p.book_id
         AND b.owner_user_id = $4
       RETURNING p.owner_note AS "ownerNote"`,
      [ownerNote, req.params.pageId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, ownerNote: result.rows[0].ownerNote });
  } catch (err) {
    console.error('Owner memory note update error:', err);
    res.status(500).json({ error: 'OWNER_NOTE_UPDATE_FAILED' });
  }
});

app.put('/api/pages/:id', async (req, res) => {
  const { canvasData, previewDataUrl, expectedVersion } = req.body;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    res.status(400).json({ error: 'INVALID_EXPECTED_VERSION' });
    return;
  }

  if (!canvasData || typeof canvasData !== 'object' || Array.isArray(canvasData)) {
    res.status(400).json({ error: 'INVALID_CANVAS_DATA' });
    return;
  }

  try {
    const accessResult = await pool.query(
      `SELECT p.book_id AS "bookId", b.owner_user_id AS "ownerUserId"
       FROM pages p
       JOIN books b ON b.id = p.book_id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (accessResult.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (accessResult.rows[0].bookId !== DEMO_BOOK_ID) {
      const session = await getSession(req);

      if (!session || session.user.id !== accessResult.rows[0].ownerUserId) {
        res.status(403).json({ error: 'PAGE_WRITE_FORBIDDEN' });
        return;
      }
    }

    const row = await savePageVersioned(
      req.params.id,
      canvasData,
      previewDataUrl,
      expectedVersion
    );

    res.status(200).json({
      success: true,
      newVersion: row.version,
      previewImageUrl: row.previewImageUrl,
      updatedAt: row.updatedAt,
    });
  } catch (err: any) {
    console.error('Page save error:', err);

    if (err?.status === 404) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    if (err?.status === 409) {
      res.status(409).json({
        error: 'PAGE_CONFLICT',
        latestRemoteVersion: err.latestRemoteVersion,
      });
      return;
    }

    if (
      err?.message === 'INVALID_PREVIEW_FORMAT' ||
      err?.message === 'INVALID_PREVIEW_JPEG' ||
      err?.message === 'PREVIEW_TOO_LARGE'
    ) {
      res.status(400).json({ error: err.message });
      return;
    }

    res.status(500).json({ error: 'PAGE_SAVE_FAILED' });
  }
});

const DIST_DIR = path.join(process.cwd(), 'dist');
app.use(express.static(DIST_DIR));
app.use((_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT UNIQUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  await pool.query(
    `INSERT INTO users (id, display_name, email, email_verified)
     VALUES ($1, $2, $3, FALSE)
     ON CONFLICT (id) DO NOTHING`,
    ['user-demo-owner', 'MemoryBook Demo Owner', 'demo-owner@memorybook.local']
  );

  await pool.query(`
    UPDATE users
    SET email = id || '@memorybook.local'
    WHERE email IS NULL
  `);

  await pool.query(`ALTER TABLE users ALTER COLUMN email SET NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS owner_user_id TEXT`);

  await pool.query(
    `UPDATE books
     SET owner_user_id = $1
     WHERE owner_user_id IS NULL`,
    ['user-demo-owner']
  );

  const booksOwnerForeignKey = await pool.query(`
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'books'::regclass
      AND contype = 'f'
      AND conname = 'books_owner_user_id_fkey'
  `);

  if (booksOwnerForeignKey.rowCount === 0) {
    await pool.query(`
      ALTER TABLE books
      ADD CONSTRAINT books_owner_user_id_fkey
      FOREIGN KEY (owner_user_id)
      REFERENCES users(id)
      ON DELETE RESTRICT
    `);
  }

  await pool.query(`ALTER TABLE books ALTER COLUMN owner_user_id SET NOT NULL`);

  await pool.query(
    `INSERT INTO books (id, owner_user_id, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_BOOK_ID, 'user-demo-owner', '12.B – Our Last Year']
  );

  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS book_type TEXT NOT NULL DEFAULT 'standard'`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_device_limit INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_identity_mode TEXT NOT NULL DEFAULT 'none'`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_required_fields JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS page_capacity INTEGER NOT NULL DEFAULT 30`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'hu'`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_preview_image_url TEXT`);
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_version INTEGER NOT NULL DEFAULT 1`);
  await pool.query(`UPDATE books SET language = 'hu' WHERE language NOT IN ('hu', 'en', 'de') OR language IS NULL`);
  await pool.query(`UPDATE books SET language = 'en' WHERE id = $1`, [DEMO_BOOK_ID]);
  await pool.query(`UPDATE books SET page_capacity = 0 WHERE book_type = 'event' AND page_capacity <> 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_mode TEXT NOT NULL CHECK (purchase_mode IN ('self', 'gift', 'organization')),
      book_type TEXT NOT NULL CHECK (book_type IN ('standard', 'event', 'dedication')),
      included_pages INTEGER NOT NULL DEFAULT 30,
      purchaser_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      purchaser_name TEXT NOT NULL,
      purchaser_email TEXT NOT NULL,
      billing_name TEXT NOT NULL,
      billing_email TEXT NOT NULL,
      billing_country TEXT NOT NULL,
      billing_postal_code TEXT NOT NULL,
      billing_city TEXT NOT NULL,
      billing_address TEXT NOT NULL,
      billing_tax_number TEXT,
      payment_provider TEXT NOT NULL CHECK (payment_provider IN ('paypal', 'simplepay')),
      payment_status TEXT NOT NULL DEFAULT 'draft' CHECK (payment_status IN ('draft', 'pending', 'paid', 'cancelled', 'refunded')),
      provider_reference TEXT,
      amount_minor INTEGER,
      currency TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const billingProfilesMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_billing_profiles.sql'),
    'utf8'
  );
  await pool.query(billingProfilesMigration);

  const organizationPurchaseModeMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_organization_purchase_mode.sql'),
    'utf8'
  );
  await pool.query(organizationPurchaseModeMigration);

  const companyBillingMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_company_billing.sql'),
    'utf8'
  );
  await pool.query(companyBillingMigration);

  const giftRecipientMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_gift_recipient.sql'),
    'utf8'
  );
  await pool.query(giftRecipientMigration);

  const invoicingMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260908_invoicing_foundation.sql'),
    'utf8'
  );
  await pool.query(invoicingMigration);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS book_entitlements (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
      assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      gift_token TEXT UNIQUE,
      book_type TEXT NOT NULL CHECK (book_type IN ('standard', 'event', 'dedication')),
      included_pages INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed', 'revoked')),
      claimed_at TIMESTAMPTZ,
      redeemed_at TIMESTAMPTZ,
      redeemed_book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS book_entitlements_assigned_user_idx ON book_entitlements (assigned_user_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS purchases_purchaser_user_idx ON purchases (purchaser_user_id, created_at DESC)`);

  const dedicationBookTypeMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260911_dedication_book_type.sql'),
    'utf8'
  );
  await pool.query(dedicationBookTypeMigration);

  await pool.query(
    `UPDATE books
     SET invite_token = $1
     WHERE id = $2 AND invite_token IS NULL`,
    ['12b-our-last-year', DEMO_BOOK_ID]
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      contributor_name TEXT NOT NULL,
      memory_text TEXT NOT NULL,
      photo_url TEXT,
      owner_status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_group TEXT`);
  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_order INTEGER`);
  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS device_id TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      preview_image_url TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      invite_token TEXT UNIQUE,
      invite_status TEXT NOT NULL DEFAULT 'empty',
      invite_created_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      owner_visibility TEXT NOT NULL DEFAULT 'active',
      author_share_approved BOOLEAN NOT NULL DEFAULT FALSE,
      owner_share_approved BOOLEAN NOT NULL DEFAULT FALSE,
      public_share_token TEXT UNIQUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS book_id TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_token TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'empty'`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_recipient_name TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_recipient_email TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_delivery_method TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_language TEXT`);
  await pool.query(`UPDATE pages SET invite_language = NULL WHERE invite_language IS NOT NULL AND invite_language NOT IN ('hu', 'en', 'de')`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_note TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_visibility TEXT NOT NULL DEFAULT 'active'`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS author_share_approved BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_share_approved BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS public_share_token TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS event_device_id TEXT`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pages_event_device_idx
    ON pages(book_id, event_device_id, invite_status)
    WHERE event_device_id IS NOT NULL
  `);

  await pool.query(
    `UPDATE pages SET book_id = $1 WHERE book_id IS NULL`,
    [DEMO_BOOK_ID]
  );

  const pagesBookForeignKey = await pool.query(`
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'pages'::regclass
      AND contype = 'f'
      AND conname = 'pages_book_id_fkey'
  `);

  if (pagesBookForeignKey.rowCount === 0) {
    await pool.query(`
      ALTER TABLE pages
      ADD CONSTRAINT pages_book_id_fkey
      FOREIGN KEY (book_id)
      REFERENCES books(id)
      ON DELETE CASCADE
    `);
  }

  await pool.query(`ALTER TABLE pages ALTER COLUMN book_id SET NOT NULL`);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pages_book_page_number_unique
    ON pages(book_id, page_number)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pages_invite_token_unique
    ON pages(invite_token)
    WHERE invite_token IS NOT NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS pages_public_share_token_unique
    ON pages(public_share_token)
    WHERE public_share_token IS NOT NULL
  `);

  await pool.query(
    `INSERT INTO pages (id, book_id, page_number)
     VALUES ('page-1', $1, 1), ('page-2', $1, 2)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_BOOK_ID]
  );

  const ownerNotificationsMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260908_owner_notifications.sql'),
    'utf8'
  );
  await pool.query(ownerNotificationsMigration);

  console.log('Users, books, contributions, pages, notifications, invoices and owner page controls ready.');
}

async function startServer(): Promise<void> {
  try {
    await initializeDatabase();

    if (auth) {
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
    }

    const port = Number(process.env.PORT) || 3001;

    app.listen(port, '0.0.0.0', () => {
      console.log(`MemoryBook backend running on port ${port}`);
    });
  } catch (err) {
    console.error('Backend startup error:', err);
    process.exit(1);
  }
}

startServer();
