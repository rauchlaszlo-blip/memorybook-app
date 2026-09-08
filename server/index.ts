import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';
import crypto from 'crypto';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth';
import { pool } from './db';

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

app.use(express.json({ limit: '5mb' }));

const MAX_PREVIEW_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRIBUTION_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const DEFAULT_BOOK_PAGE_COUNT = 30;
const DEMO_BOOK_ID = 'book-12b';

async function getSession(req: any) {
  if (!auth) return null;

  return auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
}

async function deletePreviewSafely(
  _previewUrl: string | null | undefined
): Promise<void> {
  return;
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
         b.created_at AS "createdAt",
         COUNT(DISTINCT p.id)::int AS "pageCount",
         COUNT(DISTINCT c.id)::int AS "contributionCount"
       FROM books b
       LEFT JOIN pages p ON p.book_id = b.id
       LEFT JOIN contributions c ON c.book_id = b.id
       WHERE b.owner_user_id = $1
       GROUP BY b.id, b.title, b.created_at
       ORDER BY b.created_at DESC`,
      [session.user.id]
    );

    res.status(200).json({ books: result.rows });
  } catch (err) {
    console.error('Owner book list error:', err);
    res.status(500).json({ error: 'OWNER_BOOK_LIST_LOAD_FAILED' });
  }
});

app.post('/api/my/books', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

  if (!title || title.length > 120) {
    res.status(400).json({ error: 'INVALID_BOOK_TITLE' });
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

    const bookResult = await client.query(
      `INSERT INTO books (id, owner_user_id, title, invite_token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, created_at AS "createdAt"`,
      [bookId, session.user.id, title, inviteToken]
    );

    for (let pageNumber = 1; pageNumber <= DEFAULT_BOOK_PAGE_COUNT; pageNumber += 1) {
      await client.query(
        `INSERT INTO pages (id, book_id, page_number)
         VALUES ($1, $2, $3)`,
        [`page-${crypto.randomUUID()}`, bookId, pageNumber]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      book: {
        ...bookResult.rows[0],
        pageCount: DEFAULT_BOOK_PAGE_COUNT,
        contributionCount: 0,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Book create error:', err);
    res.status(500).json({ error: 'BOOK_CREATE_FAILED' });
  } finally {
    client.release();
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
      `SELECT id, title
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
         submitted_at AS "submittedAt",
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

    await pool.query(
      `UPDATE pages
       SET invite_token = $1,
           invite_status = CASE
             WHEN invite_status = 'empty' THEN 'invited'
             ELSE invite_status
           END,
           invite_created_at = COALESCE(invite_created_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [token, req.params.pageId]
    );

    res.status(200).json({
      success: true,
      pageId: req.params.pageId,
      pageNumber: pageResult.rows[0].pageNumber,
      inviteToken: token,
      invitePath: `/p/${token}`,
    });
  } catch (err) {
    console.error('Page invite create error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_CREATE_FAILED' });
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

    res.status(200).json(result.rows[0]);
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
      `SELECT id, invite_status AS "inviteStatus"
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
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pageResult = await client.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         invite_status AS "inviteStatus",
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

    if (!['invited', 'draft'].includes(pageResult.rows[0].inviteStatus)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'PAGE_NOT_READY_FOR_SUBMIT' });
      return;
    }

    const result = await client.query(
      `UPDATE pages
       SET invite_status = 'submitted',
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
         id,
         page_number AS "pageNumber",
         submitted_at AS "submittedAt"`,
      [pageResult.rows[0].id]
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
      `SELECT id, title
       FROM books
       WHERE invite_token = $1`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    res.status(200).json({
      bookId: result.rows[0].id,
      title: result.rows[0].title,
    });
  } catch (err) {
    console.error('Legacy invite load error:', err);
    res.status(500).json({ error: 'INVITE_LOAD_FAILED' });
  }
});

app.get('/api/books/:bookId/contributions', async (req, res) => {
  try {
    const bookResult = await pool.query(
      `SELECT id, title FROM books WHERE id = $1`,
      [req.params.bookId]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    const contributionsResult = await pool.query(
      `SELECT
         id,
         contributor_name AS "contributorName",
         memory_text AS "memoryText",
         photo_url AS "photoUrl",
         created_at AS "createdAt"
       FROM contributions
       WHERE book_id = $1
       ORDER BY created_at DESC`,
      [req.params.bookId]
    );

    res.status(200).json({
      book: bookResult.rows[0],
      contributions: contributionsResult.rows,
    });
  } catch (err) {
    console.error('Contribution list error:', err);
    res.status(500).json({ error: 'CONTRIBUTIONS_LOAD_FAILED' });
  }
});

app.post('/api/invites/:token/contributions', async (req, res) => {
  const { contributorName, memoryText, photoDataUrl } = req.body;

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

  let savedPhotoUrl: string | null = null;

  try {
    const bookResult = await pool.query(
      `SELECT id FROM books WHERE invite_token = $1`,
      [req.params.token]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
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
         id, book_id, contributor_name, memory_text, photo_url
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         book_id AS "bookId",
         contributor_name AS "contributorName",
         memory_text AS "memoryText",
         photo_url AS "photoUrl",
         created_at AS "createdAt"`,
      [
        contributionId,
        bookResult.rows[0].id,
        contributorName.trim(),
        memoryText.trim(),
        savedPhotoUrl,
      ]
    );

    res.status(201).json({ success: true, contribution: result.rows[0] });
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

app.get('/api/books/:bookId/pages', async (req, res) => {
  try {
    const bookResult = await pool.query(
      `SELECT id, title FROM books WHERE id = $1`,
      [req.params.bookId]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    const result = await pool.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         version,
         updated_at AS "updatedAt"
       FROM pages
       WHERE book_id = $1
       ORDER BY page_number ASC, id ASC`,
      [req.params.bookId]
    );

    res.status(200).json({
      book: bookResult.rows[0],
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
         id,
         page_number AS "pageNumber",
         canvas_json AS "canvasData",
         preview_image_url AS "previewImageUrl",
         version,
         updated_at AS "updatedAt"
       FROM pages
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Page load error:', err);
    res.status(500).json({ error: 'PAGE_LOAD_FAILED' });
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS book_id TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_token TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'empty'`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);

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

  await pool.query(
    `INSERT INTO pages (id, book_id, page_number)
     VALUES ('page-1', $1, 1), ('page-2', $1, 2)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_BOOK_ID]
  );

  console.log('Users, books, contributions, pages and page invites ready.');
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
