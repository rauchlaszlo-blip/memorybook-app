import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';
import crypto from 'crypto';

dotenv.config();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const MAX_PREVIEW_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_CONTRIBUTION_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;

async function deletePreviewSafely(
  previewUrl: string | null | undefined
): Promise<void> {
  // A regi helyi preview fajlok torlese nem szukseges.
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
    public_id: `page-${pageId}-${Date.now()}`,
    resource_type: 'image',
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
    public_id: contribution--,
    resource_type: 'image',
    format: imageType === 'jpeg' ? 'jpg' : imageType,
  });

  return result.secure_url;
}
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');

    res.status(200).json({
      ok: true,
      databaseTime: result.rows[0].now,
    });
  } catch (err) {
    console.error('AdatbÄ‚Ë‡zis-kapcsolati hiba:', err);

    res.status(500).json({
      ok: false,
      error: 'DATABASE_CONNECTION_FAILED',
    });
  }
});

app.get('/api/invites/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         id,
         title
       FROM books
       WHERE invite_token = $1`,
      [token]
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
    console.error('Invite betoltesi hiba:', err);
    res.status(500).json({ error: 'INVITE_LOAD_FAILED' });
  }
});

app.get('/api/books/:bookId/contributions', async (req, res) => {
  const { bookId } = req.params;

  try {
    const bookResult = await pool.query(
      `SELECT id, title
       FROM books
       WHERE id = $1`,
      [bookId]
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
      [bookId]
    );

    res.status(200).json({
      book: {
        id: bookResult.rows[0].id,
        title: bookResult.rows[0].title,
      },
      contributions: contributionsResult.rows,
    });
  } catch (err) {
    console.error('Contributions betoltesi hiba:', err);
    res.status(500).json({ error: 'CONTRIBUTIONS_LOAD_FAILED' });
  }
});
app.post('/api/invites/:token/contributions', async (req, res) => {
  const { token } = req.params;
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
      `SELECT id
       FROM books
       WHERE invite_token = $1`,
      [token]
    );

    if (bookResult.rowCount === 0) {
      res.status(404).json({ error: 'INVITE_NOT_FOUND' });
      return;
    }

    const contributionId = `contribution-${crypto.randomUUID()}`;
    const bookId = bookResult.rows[0].id;

    if (photoDataUrl && photoDataUrl.trim()) {
      savedPhotoUrl = await processAndSaveContributionPhoto(
        contributionId,
        photoDataUrl
      );
    }

    const result = await pool.query(
      `INSERT INTO contributions (
         id,
         book_id,
         contributor_name,
         memory_text,
         photo_url
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
        bookId,
        contributorName.trim(),
        memoryText.trim(),
        savedPhotoUrl,
      ]
    );

    res.status(201).json({
      success: true,
      contribution: result.rows[0],
    });
  } catch (err: any) {
    console.error('Contribution mentes hiba:', err);

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

app.get('/api/pages', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         page_number AS "pageNumber",
         version,
         updated_at AS "updatedAt"
       FROM pages
       ORDER BY page_number ASC, id ASC`
    );

    res.status(200).json({
      pages: result.rows,
    });
  } catch (err) {
    console.error('Oldallista betĂ¶ltĂ©si hiba:', err);
    res.status(500).json({ error: 'PAGE_LIST_LOAD_FAILED' });
  }
});
app.put('/api/pages/reorder', async (req, res) => {
  const { pageIds } = req.body;

  if (
    !Array.isArray(pageIds) ||
    pageIds.length === 0 ||
    pageIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
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

    const existingResult = await client.query(
      `SELECT id
       FROM pages
       ORDER BY page_number ASC, id ASC
       FOR UPDATE`
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
         SET page_number = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [index + 1, pageIds[index]]
      );
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      pages: pageIds.map((id, index) => ({
        id,
        pageNumber: index + 1,
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Oldalsorrend mentĂ©si hiba:', err);
    res.status(500).json({ error: 'PAGE_REORDER_FAILED' });
  } finally {
    client.release();
  }
});
app.get('/api/pages/:id', async (req, res) => {
  const { id } = req.params;

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
      [id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_NOT_FOUND' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('OldalbetÄ‚Â¶ltÄ‚Â©si hiba:', err);
    res.status(500).json({ error: 'PAGE_LOAD_FAILED' });
  }
});

app.put('/api/pages/:id', async (req, res) => {
  const { id } = req.params;
  const { canvasData, previewDataUrl, expectedVersion } = req.body;

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    res.status(400).json({ error: 'INVALID_EXPECTED_VERSION' });
    return;
  }

  if (!canvasData || typeof canvasData !== 'object' || Array.isArray(canvasData)) {
    res.status(400).json({ error: 'INVALID_CANVAS_DATA' });
    return;
  }

  let newPreviewUrl: string | null = null;

  try {
    if (previewDataUrl) {
      newPreviewUrl = await processAndSavePreview(id, previewDataUrl);
    }

    const result = await pool.query(
      `WITH old_state AS (
         SELECT id, preview_image_url
         FROM pages
         WHERE id = $3 AND version = $4
       ),
       updated AS (
         UPDATE pages p
         SET
           canvas_json = $1,
           preview_image_url = COALESCE($2, p.preview_image_url),
           version = p.version + 1,
           updated_at = CURRENT_TIMESTAMP
         FROM old_state os
         WHERE p.id = os.id
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
      [canvasData, newPreviewUrl, id, expectedVersion]
    );

    if (result.rowCount === 0) {
      await deletePreviewSafely(newPreviewUrl);

      const check = await pool.query(
        'SELECT version FROM pages WHERE id = $1',
        [id]
      );

      if (check.rowCount === 0) {
        res.status(404).json({ error: 'PAGE_NOT_FOUND' });
        return;
      }

      res.status(409).json({
        error: 'PAGE_CONFLICT',
        latestRemoteVersion: check.rows[0].version,
      });
      return;
    }

    const row = result.rows[0];

    if (newPreviewUrl && row.previousPreviewUrl && row.previousPreviewUrl !== newPreviewUrl) {
      deletePreviewSafely(row.previousPreviewUrl).catch((err) => {
        console.error('RÄ‚Â©gi preview tÄ‚Â¶rlÄ‚Â©si hiba:', err);
      });
    }

    res.status(200).json({
      success: true,
      newVersion: row.version,
      previewImageUrl: row.previewImageUrl,
      updatedAt: row.updatedAt,
    });
  } catch (err: any) {
    await deletePreviewSafely(newPreviewUrl);

    console.error('MentÄ‚Â©si hiba:', err);

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
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(
    `INSERT INTO books (id, title)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    ['book-12b', '12.B â€“ Our Last Year']
  );

  await pool.query(`
    ALTER TABLE books
    ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE
  `);

  await pool.query(
    `UPDATE books
     SET invite_token = $1
     WHERE id = $2 AND invite_token IS NULL`,
    ['12b-our-last-year', 'book-12b']
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
      page_number INTEGER NOT NULL,
      canvas_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      preview_image_url TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO pages (id, page_number)
    VALUES ('page-1', 1), ('page-2', 2)
    ON CONFLICT (id) DO NOTHING
  `);

  console.log('Books, contributions es pages adatmodell rendben.');
}

async function startServer(): Promise<void> {
  try {
    await initializeDatabase();

    const port = Number(process.env.PORT) || 3001;
    app.listen(port, '0.0.0.0', () => {
      console.log('MemoryBook backend fut: http://127.0.0.1:3001');
    });
  } catch (err) {
    console.error('Backend indĂ­tĂˇsi hiba:', err);
    process.exit(1);
  }
}

startServer();









