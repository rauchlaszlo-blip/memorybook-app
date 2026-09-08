from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Marker not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# --- server/index.ts ---
server = 'server/index.ts'

replace_once(server,
'''         invite_sent_at AS "inviteSentAt",
         CASE
           WHEN invite_created_at IS NULL THEN NULL
           ELSE invite_created_at + INTERVAL '14 days'
         END AS "inviteExpiresAt",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",''',
'''         invite_sent_at AS "inviteSentAt",
         invite_recipient_name AS "inviteRecipientName",
         invite_recipient_email AS "inviteRecipientEmail",
         invite_delivery_method AS "inviteDeliveryMethod",
         CASE
           WHEN invite_created_at IS NULL THEN NULL
           ELSE invite_created_at + INTERVAL '14 days'
         END AS "inviteExpiresAt",
         owner_visibility AS "ownerVisibility",
         submitted_at AS "submittedAt",
         owner_note AS "ownerNote",''')

old_sent = '''app.post('/api/my/books/:bookId/pages/:pageId/invite/sent', async (req, res) => {
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
      `UPDATE pages p
       SET invite_sent_at = COALESCE(p.invite_sent_at, CURRENT_TIMESTAMP),
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
         p.invite_created_at + INTERVAL '14 days' AS "inviteExpiresAt"`,
      [req.params.pageId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
      return;
    }

    res.status(200).json({
      success: true,
      inviteSentAt: result.rows[0].inviteSentAt,
      inviteCreatedAt: result.rows[0].inviteCreatedAt,
      inviteExpiresAt: result.rows[0].inviteExpiresAt,
    });
  } catch (err) {
    console.error('Page invite sent-state error:', err);
    res.status(500).json({ error: 'PAGE_INVITE_SENT_STATE_FAILED' });
  }
});'''

new_sent = '''app.post('/api/my/books/:bookId/pages/:pageId/invite/sent', async (req, res) => {
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
  if (deliveryMethod === 'email' && !recipientEmail) {
    res.status(400).json({ error: 'INVITE_RECIPIENT_EMAIL_REQUIRED' });
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
       SET invite_sent_at = COALESCE(p.invite_sent_at, CURRENT_TIMESTAMP),
           invite_recipient_name = COALESCE(p.invite_recipient_name, NULLIF($4, '')),
           invite_recipient_email = COALESCE(p.invite_recipient_email, NULLIF($5, '')),
           invite_delivery_method = COALESCE(p.invite_delivery_method, $6),
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
         p.invite_delivery_method AS "inviteDeliveryMethod"`,
      [
        req.params.pageId,
        req.params.bookId,
        session.user.id,
        recipientName,
        recipientEmail,
        deliveryMethod,
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
});'''
replace_once(server, old_sent, new_sent)

replace_once(server,
'''           invite_status = 'empty',
           invite_created_at = NULL,
           submitted_at = NULL,
           owner_visibility = 'active',''',
'''           invite_status = 'empty',
           invite_created_at = NULL,
           invite_sent_at = NULL,
           invite_recipient_name = NULL,
           invite_recipient_email = NULL,
           invite_delivery_method = NULL,
           submitted_at = NULL,
           owner_note = NULL,
           owner_visibility = 'active',''')

replace_once(server,
'''         p.version,
         p.owner_visibility AS "ownerVisibility",
         p.updated_at AS "updatedAt",
         p.book_id AS "bookId",''',
'''         p.version,
         p.owner_visibility AS "ownerVisibility",
         p.invite_sent_at AS "inviteSentAt",
         p.invite_recipient_name AS "inviteRecipientName",
         p.invite_recipient_email AS "inviteRecipientEmail",
         p.invite_delivery_method AS "inviteDeliveryMethod",
         p.submitted_at AS "submittedAt",
         p.owner_note AS "ownerNote",
         p.updated_at AS "updatedAt",
         p.book_id AS "bookId",''')

note_endpoint = '''
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

'''
replace_once(server, "app.put('/api/pages/:id', async (req, res) => {", note_endpoint + "app.put('/api/pages/:id', async (req, res) => {")

replace_once(server,
'''  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);''',
'''  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_recipient_name TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_recipient_email TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_delivery_method TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS owner_note TEXT`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);''')

# --- src/InviteSendDialog.tsx ---
dialog = 'src/InviteSendDialog.tsx'
replace_once(dialog,
'''  isResend?: boolean;
  expiresAt?: string | null;
  onSent: () => Promise<void>;
  onClose: () => void;''',
'''  isResend?: boolean;
  expiresAt?: string | null;
  savedRecipientName?: string | null;
  savedRecipientEmail?: string | null;
  savedDeliveryMethod?: 'share' | 'email' | null;
  onSent: (metadata: {
    recipientName: string;
    recipientEmail: string;
    deliveryMethod: 'share' | 'email';
  }) => Promise<void>;
  onClose: () => void;''')

replace_once(dialog,
'''  isResend = false,
  expiresAt = null,
  onSent,
  onClose,
}: InviteSendDialogProps) {
  const [platform, setPlatform] = useState<SendPlatform>('share');
  const [recipientName, setRecipientName] = useState('');
  const [email, setEmail] = useState('');''',
'''  isResend = false,
  expiresAt = null,
  savedRecipientName = null,
  savedRecipientEmail = null,
  savedDeliveryMethod = null,
  onSent,
  onClose,
}: InviteSendDialogProps) {
  const hasSavedIdentity = Boolean(savedRecipientName || savedRecipientEmail);
  const identityLocked = isResend && hasSavedIdentity;
  const [platform, setPlatform] = useState<SendPlatform>(
    savedDeliveryMethod === 'email' ? 'email' : 'share'
  );
  const [recipientName, setRecipientName] = useState(savedRecipientName || '');
  const [email, setEmail] = useState(savedRecipientEmail || '');''')

replace_once(dialog,
'''  const send = async () => {
    setSendError(null);

    if (platform === 'email') {
      try {
        const subject = `MemoryBook meghívás – ${bookTitle}`;
        const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        await onSent();
        window.location.href = mailto;
        onClose();
      } catch (err) {''',
'''  const send = async () => {
    setSendError(null);

    if (platform === 'share' && !recipientName.trim()) {
      setSendError('Megosztásnál add meg a címzett nevét, hogy az emlék később is azonosítható legyen.');
      return;
    }
    if (platform === 'email' && !email.trim()) {
      setSendError('E-mail küldésnél add meg a címzett e-mail címét.');
      return;
    }

    const metadata = {
      recipientName: recipientName.trim(),
      recipientEmail: email.trim(),
      deliveryMethod: platform,
    } as const;

    if (platform === 'email') {
      try {
        const subject = `MemoryBook meghívás – ${bookTitle}`;
        const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        await onSent(metadata);
        window.location.href = mailto;
        onClose();
      } catch (err) {''')

replace_once(dialog,
'''      await navigator.share({
        title: `MemoryBook meghívás – ${bookTitle}`,
        text: message,
      });
      await onSent();
      onClose();''',
'''      await navigator.share({
        title: `MemoryBook meghívás – ${bookTitle}`,
        text: message,
      });
      await onSent(metadata);
      onClose();''')

replace_once(dialog,
'''            onClick={() => setPlatform('share')}
            style={platform === 'share' ? styles.platformActive : styles.platformButton}''',
'''            onClick={() => !identityLocked && setPlatform('share')}
            disabled={identityLocked}
            style={platform === 'share' ? styles.platformActive : styles.platformButton}''')
replace_once(dialog,
'''            onClick={() => setPlatform('email')}
            style={platform === 'email' ? styles.platformActive : styles.platformButton}''',
'''            onClick={() => !identityLocked && setPlatform('email')}
            disabled={identityLocked}
            style={platform === 'email' ? styles.platformActive : styles.platformButton}''')

replace_once(dialog,
'''          Címzett neve (opcionális)
          <input
            value={recipientName}
            onChange={(event) => updateRecipientName(event.target.value)}
            placeholder="pl. Anna"
            style={styles.input}
            maxLength={80}
          />''',
'''          Címzett neve {platform === 'share' ? '(kötelező)' : '(opcionális)'}
          <input
            value={recipientName}
            onChange={(event) => updateRecipientName(event.target.value)}
            placeholder="pl. Rubinszky Gertrúd"
            style={styles.input}
            maxLength={120}
            readOnly={identityLocked}
          />''')
replace_once(dialog,
'''            E-mail cím (opcionális)
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nev@example.com"
              style={styles.input}
            />''',
'''            E-mail cím (kötelező)
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nev@example.com"
              style={styles.input}
              readOnly={identityLocked}
            />''')

replace_once(dialog,
'''        <div style={styles.note}>
          A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.
        </div>''',
'''        {identityLocked && (
          <div style={styles.identityNote}>
            A címzett az első kiküldéskor ehhez az oldalhoz rögzült. Újraküldéskor nem változtatható meg.
          </div>
        )}
        <div style={styles.note}>
          A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.
        </div>''')
replace_once(dialog,
'''  note: { marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, lineHeight: 1.45 },''',
'''  identityNote: { marginTop: 10, padding: 10, borderRadius: 8, background: '#ecfeff', color: '#155e75', fontSize: 12, lineHeight: 1.45, fontWeight: 700 },
  note: { marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, lineHeight: 1.45 },''')

# --- src/OwnerBookPage.tsx ---
owner = 'src/OwnerBookPage.tsx'
replace_once(owner,
'''  inviteCreatedAt?: string | null;
  inviteSentAt?: string | null;
  inviteExpiresAt?: string | null;
  ownerVisibility?: 'active' | 'archived' | string;''',
'''  inviteCreatedAt?: string | null;
  inviteSentAt?: string | null;
  inviteExpiresAt?: string | null;
  inviteRecipientName?: string | null;
  inviteRecipientEmail?: string | null;
  inviteDeliveryMethod?: 'share' | 'email' | string | null;
  ownerNote?: string | null;
  ownerVisibility?: 'active' | 'archived' | string;''')

replace_once(owner,
'''  const markInviteSent = async (page: OwnerPage) => {
    const response = await fetch(
      `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/sent`,
      { method: 'POST', credentials: 'include' }
    );''',
'''  const markInviteSent = async (
    page: OwnerPage,
    metadata: {
      recipientName: string;
      recipientEmail: string;
      deliveryMethod: 'share' | 'email';
    }
  ) => {
    const response = await fetch(
      `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/sent`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      }
    );''')

replace_once(owner,
'''      inviteSentAt: data.inviteSentAt,
      inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,
      inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,
    };''',
'''      inviteSentAt: data.inviteSentAt,
      inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,
      inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,
      inviteRecipientName: data.inviteRecipientName || page.inviteRecipientName || null,
      inviteRecipientEmail: data.inviteRecipientEmail || page.inviteRecipientEmail || null,
      inviteDeliveryMethod: data.inviteDeliveryMethod || page.inviteDeliveryMethod || null,
    };''')

replace_once(owner,
'''                      <div style={styles.managementState}>
                        {isArchived
                          ? 'Elrejtve a könyvből, a tartalom megőrizve.'
                          : 'Könyvben marad.'}
                      </div>

                      <div style={styles.shareState}>''',
'''                      <div style={styles.managementState}>
                        {isArchived
                          ? 'Elrejtve a könyvből, a tartalom megőrizve.'
                          : 'Könyvben marad.'}
                      </div>

                      {(page.inviteRecipientName || page.inviteRecipientEmail || page.submittedAt) && (
                        <div style={styles.memoryIdentitySummary}>
                          <strong>Emlék:</strong>{' '}
                          {page.inviteRecipientName || page.inviteRecipientEmail || 'Nincs azonosítva'}
                          {page.submittedAt ? ` · ${formatInviteExpiry(page.submittedAt)}` : ''}
                        </div>
                      )}

                      <div style={styles.shareState}>''')

replace_once(owner,
'''          isResend={Boolean(inviteComposerPage.inviteSentAt)}
          expiresAt={inviteComposerPage.inviteExpiresAt || null}
          onSent={() => markInviteSent(inviteComposerPage)}
          onClose={() => setInviteComposerPage(null)}''',
'''          isResend={Boolean(inviteComposerPage.inviteSentAt)}
          expiresAt={inviteComposerPage.inviteExpiresAt || null}
          savedRecipientName={inviteComposerPage.inviteRecipientName || null}
          savedRecipientEmail={inviteComposerPage.inviteRecipientEmail || null}
          savedDeliveryMethod={
            inviteComposerPage.inviteDeliveryMethod === 'email'
              ? 'email'
              : inviteComposerPage.inviteDeliveryMethod === 'share'
                ? 'share'
                : null
          }
          onSent={(metadata) => markInviteSent(inviteComposerPage, metadata)}
          onClose={() => setInviteComposerPage(null)}''')

replace_once(owner,
'''  inviteMeta: { marginBottom: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.4 },''',
'''  inviteMeta: { marginBottom: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.4 },
  memoryIdentitySummary: { margin: '8px 0 10px', padding: 10, borderRadius: 8, background: '#f8fafc', color: '#334155', fontSize: 13, lineHeight: 1.45 },''')

# --- src/BookViewerPage.tsx ---
viewer = 'src/BookViewerPage.tsx'
replace_once(viewer,
'''type PageData = {
  id: string;
  pageNumber: number;
  previewImageUrl?: string | null;
  version: number;
};''',
'''type PageData = {
  id: string;
  pageNumber: number;
  previewImageUrl?: string | null;
  version: number;
  inviteSentAt?: string | null;
  inviteRecipientName?: string | null;
  inviteRecipientEmail?: string | null;
  inviteDeliveryMethod?: string | null;
  submittedAt?: string | null;
  ownerNote?: string | null;
};''')

replace_once(viewer,
'''  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);''',
'''  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerNote, setOwnerNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);''')

replace_once(viewer,
'''        const data = await response.json();
        setPage(data);''',
'''        const data = await response.json();
        setPage(data);
        setOwnerNote(data.ownerNote || '');
        setNoteSaved(false);''')

insert_before_return = '''
  const saveOwnerNote = async () => {
    if (!page) return;
    try {
      setNoteSaving(true);
      setNoteSaved(false);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/memory-note`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerNote }),
        }
      );
      if (!response.ok) throw new Error('OWNER_NOTE_SAVE_FAILED');
      const data = await response.json();
      setPage((current) => current ? { ...current, ownerNote: data.ownerNote || null } : current);
      setOwnerNote(data.ownerNote || '');
      setNoteSaved(true);
    } catch (err) {
      console.error(err);
      setError('A saját megjegyzést nem sikerült elmenteni.');
    } finally {
      setNoteSaving(false);
    }
  };

'''
replace_once(viewer, '''  return (\n    <main style={styles.page}>''', insert_before_return + '''  return (\n    <main style={styles.page}>''')

replace_once(viewer,
'''        <div style={styles.viewer}>
          {loading ? (
            <div style={styles.message}>Oldal betöltése...</div>
          ) : pageIds.length === 0 ? (
            <div style={styles.emptyPage}>
              <div>Még nincs beküldött oldal ebben a könyvben.</div>
            </div>
          ) : page?.previewImageUrl ? (
            <img
              src={page.previewImageUrl}
              alt={`${page.pageNumber}. oldal`}
              style={styles.image}
            />
          ) : (
            <div style={styles.emptyPage}>
              <div>{currentIndex + 1}. oldal</div>
              <div style={styles.emptyText}>Ehhez az oldalhoz nincs előnézeti kép.</div>
            </div>
          )}
        </div>
      </section>''',
'''        <div style={styles.viewer} data-memory-content="true">
          {loading ? (
            <div style={styles.message}>Oldal betöltése...</div>
          ) : pageIds.length === 0 ? (
            <div style={styles.emptyPage}>
              <div>Még nincs beküldött oldal ebben a könyvben.</div>
            </div>
          ) : page?.previewImageUrl ? (
            <img
              src={page.previewImageUrl}
              alt={`${page.pageNumber}. oldal`}
              style={styles.image}
            />
          ) : (
            <div style={styles.emptyPage}>
              <div>{currentIndex + 1}. oldal</div>
              <div style={styles.emptyText}>Ehhez az oldalhoz nincs előnézeti kép.</div>
            </div>
          )}
        </div>

        {!loading && page && (
          <section style={styles.identityPanel} data-memory-metadata="true">
            <div style={styles.identityEyebrow}>Az emlék adatai</div>
            <h2 style={styles.identityTitle}>
              {page.inviteRecipientName || page.inviteRecipientEmail || 'Nincs azonosítva'}
            </h2>
            <div style={styles.identityGrid}>
              {page.inviteRecipientName && page.inviteRecipientEmail && (
                <div><span style={styles.identityLabel}>E-mail</span>{page.inviteRecipientEmail}</div>
              )}
              <div>
                <span style={styles.identityLabel}>Küldési mód</span>
                {page.inviteDeliveryMethod === 'email'
                  ? 'E-mail'
                  : page.inviteDeliveryMethod === 'share'
                    ? 'Megosztás'
                    : 'Nincs rögzítve'}
              </div>
              <div>
                <span style={styles.identityLabel}>Meghívás dátuma</span>
                {formatDate(page.inviteSentAt)}
              </div>
              <div>
                <span style={styles.identityLabel}>Beküldés dátuma</span>
                {formatDate(page.submittedAt)}
              </div>
            </div>

            <label style={styles.noteLabel}>
              Saját megjegyzés
              <textarea
                value={ownerNote}
                onChange={(event) => { setOwnerNote(event.target.value); setNoteSaved(false); }}
                maxLength={2000}
                rows={4}
                placeholder="Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…"
                style={styles.noteInput}
              />
            </label>
            <button type="button" onClick={saveOwnerNote} disabled={noteSaving} style={styles.noteButton}>
              {noteSaving ? 'Mentés…' : noteSaved ? 'Megjegyzés elmentve' : 'Megjegyzés mentése'}
            </button>
            <div style={styles.printHint}>
              Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.
            </div>
          </section>
        )}
      </section>''')

replace_once(viewer,
'''const styles: Record<string, React.CSSProperties> = {''',
'''function formatDate(value?: string | null) {
  if (!value) return 'Nincs rögzítve';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const styles: Record<string, React.CSSProperties> = {''')

replace_once(viewer,
'''  error: {
    maxWidth: 750,
    margin: '0 auto 12px',
    padding: 12,
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
  },
};''',
'''  error: {
    maxWidth: 750,
    margin: '0 auto 12px',
    padding: 12,
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
  },
  identityPanel: {
    width: '100%',
    maxWidth: 750,
    margin: '16px auto 0',
    padding: 16,
    boxSizing: 'border-box',
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
  },
  identityEyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 },
  identityTitle: { margin: '6px 0 14px', color: '#0f172a', fontSize: 21, overflowWrap: 'anywhere' },
  identityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12, color: '#334155', fontSize: 14, lineHeight: 1.45 },
  identityLabel: { display: 'block', marginBottom: 3, color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' },
  noteLabel: { display: 'block', marginTop: 16, color: '#334155', fontSize: 13, fontWeight: 800 },
  noteInput: { width: '100%', marginTop: 6, padding: 12, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 16, lineHeight: 1.45, resize: 'vertical' },
  noteButton: { width: '100%', minHeight: 46, marginTop: 10, padding: '10px 14px', border: 0, borderRadius: 9, background: '#0f172a', color: '#ffffff', fontSize: 14, fontWeight: 800 },
  printHint: { marginTop: 10, color: '#64748b', fontSize: 12, lineHeight: 1.45 },
};''')

print('Memory identity metadata patch applied.')
