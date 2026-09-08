from pathlib import Path

server_path = Path('server/index.ts')
owner_path = Path('src/OwnerBookPage.tsx')

server = server_path.read_text(encoding='utf-8')
owner = owner_path.read_text(encoding='utf-8')

# Owner page: import + settings panel
old = "import { InviteSendDialog } from './InviteSendDialog.tsx';\n"
new = old + "import { EventBookSettings } from './EventBookSettings.tsx';\n"
if old not in owner:
    raise SystemExit('owner import anchor not found')
owner = owner.replace(old, new, 1)

old = """      )}\n\n        {loading && <div style={styles.panel}>Betöltés...</div>}\n"""
new = """      )}\n\n        {bookType === 'event' && <EventBookSettings bookId={bookId} />}\n\n        {loading && <div style={styles.panel}>Betöltés...</div>}\n"""
if old not in owner:
    raise SystemExit('owner render anchor not found')
owner = owner.replace(old, new, 1)

# Backend: event settings endpoints before pages endpoint
anchor = "app.get('/api/my/books/:bookId/pages', async (req, res) => {"
if anchor not in server:
    raise SystemExit('pages endpoint anchor not found')
settings_routes = r'''app.get('/api/my/books/:bookId/event-settings', async (req, res) => {
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
         event_identity_mode AS "identityMode"
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

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE books
       SET event_device_limit = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND owner_user_id = $3
         AND book_type = 'event'
       RETURNING
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode"`,
      [deviceLimit, req.params.bookId, session.user.id]
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

'''
server = server.replace(anchor, settings_routes + anchor, 1)

# Invite lookup exposes per-book rules
old = '''      `SELECT id, title, book_type AS "bookType"
       FROM books
       WHERE invite_token = $1`,'''
new = '''      `SELECT
         id,
         title,
         book_type AS "bookType",
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode"
       FROM books
       WHERE invite_token = $1`,'''
if old not in server:
    raise SystemExit('invite select anchor not found')
server = server.replace(old, new, 1)

old = '''      bookType: result.rows[0].bookType,
    });'''
new = '''      bookType: result.rows[0].bookType,
      deviceLimit: result.rows[0].deviceLimit,
      identityMode: result.rows[0].identityMode,
    });'''
if old not in server:
    raise SystemExit('invite response anchor not found')
server = server.replace(old, new, 1)

# Contribution submission: accept device id and enforce per-book limit
old = "  const { contributorName, memoryText, photoDataUrl } = req.body;"
new = "  const { contributorName, memoryText, photoDataUrl, deviceId } = req.body;"
if old not in server:
    raise SystemExit('contribution destructure anchor not found')
server = server.replace(old, new, 1)

old = '''  if (
    photoDataUrl !== undefined &&
    photoDataUrl !== null &&
    typeof photoDataUrl !== 'string'
  ) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_PHOTO' });
    return;
  }

  let savedPhotoUrl: string | null = null;'''
new = '''  if (
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
  let deviceLimit: number | null = null;'''
if old not in server:
    raise SystemExit('photo validation anchor not found')
server = server.replace(old, new, 1)

old = '''      `SELECT id, book_type AS "bookType" FROM books WHERE invite_token = $1`,'''
new = '''      `SELECT
         id,
         book_type AS "bookType",
         event_device_limit AS "deviceLimit",
         event_identity_mode AS "identityMode"
       FROM books
       WHERE invite_token = $1`,'''
if old not in server:
    raise SystemExit('contribution book select anchor not found')
server = server.replace(old, new, 1)

old = '''    const contributionId = `contribution-${crypto.randomUUID()}`;

    if (photoDataUrl && typeof photoDataUrl === 'string' && photoDataUrl.trim()) {'''
new = '''    deviceLimit = Number(bookResult.rows[0].deviceLimit) || 1;

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

    if (photoDataUrl && typeof photoDataUrl === 'string' && photoDataUrl.trim()) {'''
if old not in server:
    raise SystemExit('contribution id anchor not found')
server = server.replace(old, new, 1)

old = '''      `INSERT INTO contributions (
         id, book_id, contributor_name, memory_text, photo_url
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING'''
new = '''      `INSERT INTO contributions (
         id, book_id, contributor_name, memory_text, photo_url, device_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING'''
if old not in server:
    raise SystemExit('contribution insert anchor not found')
server = server.replace(old, new, 1)

old = '''        memoryText.trim(),
        savedPhotoUrl,
      ]
    );

    res.status(201).json({ success: true, contribution: result.rows[0] });'''
new = '''        memoryText.trim(),
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
    });'''
if old not in server:
    raise SystemExit('contribution response anchor not found')
server = server.replace(old, new, 1)

# Database columns
old = "  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS book_type TEXT NOT NULL DEFAULT 'standard'`);"
new = old + "\n  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_device_limit INTEGER NOT NULL DEFAULT 1`);\n  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_identity_mode TEXT NOT NULL DEFAULT 'none'`);"
if old not in server:
    raise SystemExit('books schema anchor not found')
server = server.replace(old, new, 1)

old = "  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_order INTEGER`);"
new = old + "\n  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS device_id TEXT`);"
if old not in server:
    raise SystemExit('contributions schema anchor not found')
server = server.replace(old, new, 1)

server_path.write_text(server, encoding='utf-8')
owner_path.write_text(owner, encoding='utf-8')
print('Event device limit patch applied')
