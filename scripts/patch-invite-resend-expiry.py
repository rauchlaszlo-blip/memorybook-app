from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing patch target: {label}')
    return text.replace(old, new, 1)

# --- backend ---
server_path = Path('server/index.ts')
server = server_path.read_text(encoding='utf-8')

server = replace_once(
    server,
    "const DEFAULT_BOOK_PAGE_COUNT = 30;\nconst DEMO_BOOK_ID = 'book-12b';",
    "const DEFAULT_BOOK_PAGE_COUNT = 30;\nconst PAGE_INVITE_VALID_DAYS = 14;\nconst DEMO_BOOK_ID = 'book-12b';",
    'invite validity constant',
)

server = replace_once(
    server,
    "async function getSession(req: any) {\n  if (!auth) return null;\n\n  return auth.api.getSession({\n    headers: fromNodeHeaders(req.headers),\n  });\n}\n",
    "async function getSession(req: any) {\n  if (!auth) return null;\n\n  return auth.api.getSession({\n    headers: fromNodeHeaders(req.headers),\n  });\n}\n\nfunction isPageInviteExpired(inviteCreatedAt: string | Date | null | undefined): boolean {\n  if (!inviteCreatedAt) return false;\n  const createdAt = new Date(inviteCreatedAt).getTime();\n  if (!Number.isFinite(createdAt)) return false;\n  return Date.now() >= createdAt + PAGE_INVITE_VALID_DAYS * 24 * 60 * 60 * 1000;\n}\n",
    'invite expiry helper',
)

server = replace_once(
    server,
    "         invite_status AS \"inviteStatus\",\n         invite_token AS \"inviteToken\",\n         owner_visibility AS \"ownerVisibility\",",
    "         invite_status AS \"inviteStatus\",\n         invite_token AS \"inviteToken\",\n         invite_created_at AS \"inviteCreatedAt\",\n         invite_sent_at AS \"inviteSentAt\",\n         CASE\n           WHEN invite_created_at IS NULL THEN NULL\n           ELSE invite_created_at + INTERVAL '14 days'\n         END AS \"inviteExpiresAt\",\n         owner_visibility AS \"ownerVisibility\",",
    'owner page invite metadata',
)

old_invite_update = """    await pool.query(\n      `UPDATE pages\n       SET invite_token = $1,\n           invite_status = CASE\n             WHEN invite_status = 'empty' THEN 'invited'\n             ELSE invite_status\n           END,\n           invite_created_at = COALESCE(invite_created_at, CURRENT_TIMESTAMP),\n           updated_at = CURRENT_TIMESTAMP\n       WHERE id = $2`,\n      [token, req.params.pageId]\n    );\n\n    res.status(200).json({\n      success: true,\n      pageId: req.params.pageId,\n      pageNumber: pageResult.rows[0].pageNumber,\n      inviteToken: token,\n      invitePath: `/p/${token}`,\n    });\n"""
new_invite_update = """    const inviteUpdate = await pool.query(\n      `UPDATE pages\n       SET invite_token = $1,\n           invite_status = CASE\n             WHEN invite_status = 'empty' THEN 'invited'\n             ELSE invite_status\n           END,\n           invite_created_at = COALESCE(invite_created_at, CURRENT_TIMESTAMP),\n           updated_at = CURRENT_TIMESTAMP\n       WHERE id = $2\n       RETURNING\n         invite_created_at AS \"inviteCreatedAt\",\n         invite_sent_at AS \"inviteSentAt\",\n         invite_created_at + INTERVAL '14 days' AS \"inviteExpiresAt\"`,\n      [token, req.params.pageId]\n    );\n\n    res.status(200).json({\n      success: true,\n      pageId: req.params.pageId,\n      pageNumber: pageResult.rows[0].pageNumber,\n      inviteToken: token,\n      invitePath: `/p/${token}`,\n      inviteCreatedAt: inviteUpdate.rows[0].inviteCreatedAt,\n      inviteSentAt: inviteUpdate.rows[0].inviteSentAt,\n      inviteExpiresAt: inviteUpdate.rows[0].inviteExpiresAt,\n      inviteValidDays: PAGE_INVITE_VALID_DAYS,\n    });\n"""
server = replace_once(server, old_invite_update, new_invite_update, 'invite create response')

sent_endpoint = """
app.post('/api/my/books/:bookId/pages/:pageId/invite/sent', async (req, res) => {
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
});

"""
server = replace_once(
    server,
    "app.patch('/api/my/books/:bookId/pages/:pageId/sharing', async (req, res) => {",
    sent_endpoint + "app.patch('/api/my/books/:bookId/pages/:pageId/sharing', async (req, res) => {",
    'invite sent endpoint',
)

server = replace_once(
    server,
    "         p.version,\n         p.invite_status AS \"inviteStatus\",\n         p.submitted_at AS \"submittedAt\"\n       FROM pages p",
    "         p.version,\n         p.invite_status AS \"inviteStatus\",\n         p.invite_created_at AS \"inviteCreatedAt\",\n         p.invite_created_at + INTERVAL '14 days' AS \"inviteExpiresAt\",\n         p.submitted_at AS \"submittedAt\"\n       FROM pages p",
    'guest invite load metadata',
)

server = replace_once(
    server,
    "    if (result.rows[0].inviteStatus === 'submitted') {\n      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    res.status(200).json(result.rows[0]);",
    "    if (result.rows[0].inviteStatus === 'submitted') {\n      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    if (isPageInviteExpired(result.rows[0].inviteCreatedAt)) {\n      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });\n      return;\n    }\n\n    res.status(200).json({ ...result.rows[0], inviteValidDays: PAGE_INVITE_VALID_DAYS });",
    'guest invite load expiry',
)

server = replace_once(
    server,
    "      `SELECT id, invite_status AS \"inviteStatus\"\n       FROM pages\n       WHERE invite_token = $1\n       FOR UPDATE`,",
    "      `SELECT\n         id,\n         invite_status AS \"inviteStatus\",\n         invite_created_at AS \"inviteCreatedAt\"\n       FROM pages\n       WHERE invite_token = $1\n       FOR UPDATE`,",
    'guest invite save metadata',
)

server = replace_once(
    server,
    "    if (inviteResult.rows[0].inviteStatus === 'submitted') {\n      await client.query('ROLLBACK');\n      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    const row = await savePageVersioned(",
    "    if (inviteResult.rows[0].inviteStatus === 'submitted') {\n      await client.query('ROLLBACK');\n      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    if (isPageInviteExpired(inviteResult.rows[0].inviteCreatedAt)) {\n      await client.query('ROLLBACK');\n      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });\n      return;\n    }\n\n    const row = await savePageVersioned(",
    'guest invite save expiry',
)

server = replace_once(
    server,
    "         page_number AS \"pageNumber\",\n         invite_status AS \"inviteStatus\",\n         submitted_at AS \"submittedAt\"\n       FROM pages",
    "         page_number AS \"pageNumber\",\n         invite_status AS \"inviteStatus\",\n         invite_created_at AS \"inviteCreatedAt\",\n         submitted_at AS \"submittedAt\"\n       FROM pages",
    'guest invite submit metadata',
)

server = replace_once(
    server,
    "    if (pageResult.rows[0].inviteStatus === 'submitted') {\n      await client.query('ROLLBACK');\n      res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    if (!['invited', 'draft'].includes(pageResult.rows[0].inviteStatus)) {",
    "    if (pageResult.rows[0].inviteStatus === 'submitted') {\n      await client.query('ROLLBACK');\n      res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });\n      return;\n    }\n\n    if (isPageInviteExpired(pageResult.rows[0].inviteCreatedAt)) {\n      await client.query('ROLLBACK');\n      res.status(410).json({ error: 'PAGE_INVITE_EXPIRED' });\n      return;\n    }\n\n    if (!['invited', 'draft'].includes(pageResult.rows[0].inviteStatus)) {",
    'guest invite submit expiry',
)

server = replace_once(
    server,
    "  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);\n  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);",
    "  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);\n  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_sent_at TIMESTAMPTZ`);\n  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);",
    'invite sent schema',
)

server_path.write_text(server, encoding='utf-8')

# --- owner page ---
owner_path = Path('src/OwnerBookPage.tsx')
owner = owner_path.read_text(encoding='utf-8')

owner = replace_once(
    owner,
    "  inviteToken?: string | null;\n  ownerVisibility?: 'active' | 'archived' | string;",
    "  inviteToken?: string | null;\n  inviteCreatedAt?: string | null;\n  inviteSentAt?: string | null;\n  inviteExpiresAt?: string | null;\n  ownerVisibility?: 'active' | 'archived' | string;",
    'owner page invite fields',
)

owner = replace_once(
    owner,
    "        inviteToken: data.inviteToken,\n        inviteStatus: page.inviteStatus === 'empty' ? 'invited' : page.inviteStatus,",
    "        inviteToken: data.inviteToken,\n        inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,\n        inviteSentAt: data.inviteSentAt || page.inviteSentAt || null,\n        inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,\n        inviteStatus: page.inviteStatus === 'empty' ? 'invited' : page.inviteStatus,",
    'owner invite create metadata',
)

owner = replace_once(
    owner,
    "  const updateVisibility = async (\n",
    "  const markInviteSent = async (page: OwnerPage) => {\n    const response = await fetch(\n      `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/sent`,\n      { method: 'POST', credentials: 'include' }\n    );\n\n    if (response.status === 401) {\n      window.location.href = '/login';\n      throw new Error('UNAUTHENTICATED');\n    }\n\n    const data = await response.json().catch(() => ({}));\n    if (!response.ok || !data.inviteSentAt) {\n      throw new Error(data?.error || 'PAGE_INVITE_SENT_STATE_FAILED');\n    }\n\n    const updatedPage: OwnerPage = {\n      ...page,\n      inviteSentAt: data.inviteSentAt,\n      inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,\n      inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,\n    };\n\n    setPages((current) =>\n      current.map((item) => (item.id === page.id ? updatedPage : item))\n    );\n    setInviteComposerPage((current) =>\n      current?.id === page.id ? updatedPage : current\n    );\n  };\n\n  const updateVisibility = async (\n",
    'owner invite sent function',
)

owner = replace_once(
    owner,
    "                  ) : (\n                    <button\n                      type=\"button\"\n                      onClick={() => openInviteComposer(page)}\n                      disabled={isWorking}\n                      style={styles.primaryButton}\n                    >\n                      {isWorking\n                        ? 'Készül...'\n                        : hasInvite\n                          ? 'Meghívás küldése'\n                          : 'Meghívás'}\n                    </button>\n                  )}",
    "                  ) : (\n                    <div>\n                      {hasInvite && page.inviteExpiresAt && (\n                        <div style={styles.inviteMeta}>\n                          A meghívó 14 napig használható. Lejár: {formatInviteExpiry(page.inviteExpiresAt)}\n                        </div>\n                      )}\n                      <button\n                        type=\"button\"\n                        onClick={() => openInviteComposer(page)}\n                        disabled={isWorking}\n                        style={styles.primaryButton}\n                      >\n                        {isWorking\n                          ? 'Készül...'\n                          : !hasInvite\n                            ? 'Meghívás'\n                            : page.inviteSentAt\n                              ? 'Meghívó újraküldése'\n                              : 'Meghívás folytatása'}\n                      </button>\n                    </div>\n                  )}",
    'owner invite button and expiry text',
)

owner = replace_once(
    owner,
    "          ctaUrl={`${origin}/nekem-is-kell`}\n          onClose={() => setInviteComposerPage(null)}",
    "          ctaUrl={`${origin}/nekem-is-kell`}\n          isResend={Boolean(inviteComposerPage.inviteSentAt)}\n          expiresAt={inviteComposerPage.inviteExpiresAt || null}\n          onSent={() => markInviteSent(inviteComposerPage)}\n          onClose={() => setInviteComposerPage(null)}",
    'invite dialog props',
)

owner = replace_once(
    owner,
    "function displayStatusLabel(page: OwnerPage) {\n  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {\n    return 'Archiválva';\n  }\n\n  return statusLabel(page.inviteStatus);\n}\n",
    "function displayStatusLabel(page: OwnerPage) {\n  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {\n    return 'Archiválva';\n  }\n  if (page.inviteStatus === 'invited' && page.inviteSentAt) {\n    return 'Meghívó kiküldve';\n  }\n\n  return statusLabel(page.inviteStatus);\n}\n\nfunction formatInviteExpiry(value: string) {\n  const date = new Date(value);\n  return Number.isNaN(date.getTime())\n    ? value\n    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });\n}\n",
    'owner invite status and formatter',
)

owner = replace_once(
    owner,
    "  panel: {\n    padding: 24,",
    "  inviteMeta: { marginBottom: 10, color: '#64748b', fontSize: 12, lineHeight: 1.45 },\n  panel: {\n    padding: 24,",
    'owner invite meta style',
)

owner_path.write_text(owner, encoding='utf-8')

# --- invite dialog ---
dialog_path = Path('src/InviteSendDialog.tsx')
dialog = dialog_path.read_text(encoding='utf-8')

dialog = replace_once(
    dialog,
    "  ctaUrl: string;\n  onClose: () => void;",
    "  ctaUrl: string;\n  isResend?: boolean;\n  expiresAt?: string | null;\n  onSent: () => Promise<void>;\n  onClose: () => void;",
    'dialog props type',
)

dialog = replace_once(
    dialog,
    "    'A link csak a te oldaladhoz tartozik. Ha elkészültél, az oldal alján küldd be.',\n    '',\n    `👉 Nekem is kell emlékkönyv: ${ctaUrl}`,",
    "    'A link csak a te oldaladhoz tartozik. Ha elkészültél, az oldal alján küldd be.',\n    'A meghívó 14 napig használható.',\n    '',\n    `👉 Nekem is kell emlékkönyv: ${ctaUrl}`,",
    'dialog 14 day message',
)

dialog = replace_once(
    dialog,
    "  ctaUrl,\n  onClose,\n}: InviteSendDialogProps) {",
    "  ctaUrl,\n  isResend = false,\n  expiresAt = null,\n  onSent,\n  onClose,\n}: InviteSendDialogProps) {",
    'dialog destructuring',
)

dialog = replace_once(
    dialog,
    "    if (platform === 'email') {\n      const subject = `MemoryBook meghívás – ${bookTitle}`;\n      const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;\n      window.location.href = mailto;\n      return;\n    }",
    "    if (platform === 'email') {\n      try {\n        const subject = `MemoryBook meghívás – ${bookTitle}`;\n        const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;\n        await onSent();\n        window.location.href = mailto;\n        onClose();\n      } catch (err) {\n        console.error(err);\n        setSendError('Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.');\n      }\n      return;\n    }",
    'dialog email sent state',
)

dialog = replace_once(
    dialog,
    "      await navigator.share({\n        title: `MemoryBook meghívás – ${bookTitle}`,\n        text: message,\n      });\n      onClose();",
    "      await navigator.share({\n        title: `MemoryBook meghívás – ${bookTitle}`,\n        text: message,\n      });\n      await onSent();\n      onClose();",
    'dialog native share sent state',
)

dialog = replace_once(
    dialog,
    "            <h2 id=\"invite-send-title\" style={styles.title}>Meghívás küldése</h2>",
    "            <h2 id=\"invite-send-title\" style={styles.title}>{isResend ? 'Meghívó újraküldése' : 'Meghívás küldése'}</h2>",
    'dialog title',
)

dialog = replace_once(
    dialog,
    "        <div style={styles.stepLabel}>1. Küldési mód</div>",
    "        {isResend && (\n          <div style={styles.resendWarning}>\n            Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.\n          </div>\n        )}\n        <div style={styles.expiryNote}>\n          A meghívó 14 napig használható{expiresAt ? `, lejár: ${new Date(expiresAt).toLocaleDateString('hu-HU')}` : ''}.\n        </div>\n\n        <div style={styles.stepLabel}>1. Küldési mód</div>",
    'dialog warning and expiry note',
)

dialog = replace_once(
    dialog,
    "  note: { marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, lineHeight: 1.45 },",
    "  resendWarning: { marginBottom: 10, padding: 12, borderRadius: 8, background: '#fff7ed', color: '#9a3412', fontSize: 13, lineHeight: 1.45, fontWeight: 700 },\n  expiryNote: { marginBottom: 12, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.45 },\n  note: { marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, lineHeight: 1.45 },",
    'dialog warning styles',
)

dialog_path.write_text(dialog, encoding='utf-8')

print('Invite resend + 14-day expiry patch applied.')
