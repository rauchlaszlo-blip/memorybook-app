from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Marker not found in {path}: {old[:160]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


server = 'server/index.ts'
reassign_endpoint = r'''app.post('/api/my/books/:bookId/pages/:pageId/invite/reassign', async (req, res) => {
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

'''
replace_once(
    server,
    "app.patch('/api/my/books/:bookId/pages/:pageId/sharing', async (req, res) => {",
    reassign_endpoint + "app.patch('/api/my/books/:bookId/pages/:pageId/sharing', async (req, res) => {",
)

owner = 'src/OwnerBookPage.tsx'
replace_once(
    owner,
'''  const openInviteComposer = (page: OwnerPage) => {
    if (!page.inviteToken) {
      void createInvite(page);
      return;
    }

    setInviteComposerPage(page);
  };
''',
'''  const openInviteComposer = (page: OwnerPage) => {
    if (!page.inviteToken) {
      void createInvite(page);
      return;
    }

    if (isInviteExpired(page)) {
      void reassignExpiredInvite(page);
      return;
    }

    setInviteComposerPage(page);
  };

  const reassignExpiredInvite = async (page: OwnerPage) => {
    try {
      setWorkingPageId(page.id);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/reassign`,
        { method: 'POST', credentials: 'include' }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'PAGE_INVITE_REASSIGN_FAILED');
      }

      const reassignedPage: OwnerPage = {
        ...page,
        version: page.version + 1,
        inviteStatus: 'invited',
        inviteToken: data.inviteToken,
        inviteCreatedAt: data.inviteCreatedAt || null,
        inviteSentAt: null,
        inviteExpiresAt: data.inviteExpiresAt || null,
        inviteRecipientName: null,
        inviteRecipientEmail: null,
        inviteDeliveryMethod: null,
        submittedAt: null,
        ownerNote: null,
      };

      setPages((current) => current.map((item) => item.id === page.id ? reassignedPage : item));
      setInviteComposerPage(reassignedPage);
    } catch (err) {
      console.error(err);
      setError('Nem sikerült új címzettnek megnyitni az oldalt.');
    } finally {
      setWorkingPageId(null);
    }
  };
''')

replace_once(
    owner,
'''                      {hasInvite && page.inviteExpiresAt && (
                        <div style={styles.inviteMeta}>
                          A meghívó 14 napig használható. Lejár: {formatInviteExpiry(page.inviteExpiresAt)}
                        </div>
                      )}''',
'''                      {hasInvite && page.inviteExpiresAt && (
                        <div style={styles.inviteMeta}>
                          {isInviteExpired(page)
                            ? 'A meghívó lejárt. Az oldal új címzettnek kiadható.'
                            : <>A meghívó 14 napig használható. Lejár: {formatInviteExpiry(page.inviteExpiresAt)}</>}
                        </div>
                      )}''')

replace_once(
    owner,
'''                          : !hasInvite
                            ? 'Meghívás'
                            : page.inviteSentAt
                              ? 'Meghívó újraküldése'
                              : 'Meghívás folytatása'}''',
'''                          : !hasInvite
                            ? 'Meghívás'
                            : isInviteExpired(page)
                              ? 'Új címzett meghívása'
                              : page.inviteSentAt
                                ? 'Meghívó újraküldése'
                                : 'Meghívás folytatása'}''')

replace_once(
    owner,
'''  if (page.inviteStatus === 'invited' && page.inviteSentAt) {
    return 'Meghívó kiküldve';
  }

  return statusLabel(page.inviteStatus);''',
'''  if (isInviteExpired(page)) {
    return 'Meghívó lejárt';
  }
  if (page.inviteStatus === 'invited' && page.inviteSentAt) {
    return 'Meghívó kiküldve';
  }

  return statusLabel(page.inviteStatus);''')

replace_once(
    owner,
'''function formatInviteExpiry(value: string) {''',
'''function isInviteExpired(page: OwnerPage) {
  if (page.inviteStatus === 'submitted' || !page.inviteExpiresAt) return false;
  const expires = new Date(page.inviteExpiresAt).getTime();
  return Number.isFinite(expires) && expires <= Date.now();
}

function formatInviteExpiry(value: string) {''')

# Clarify that identity is locked only during the active 14-day window.
dialog = 'src/InviteSendDialog.tsx'
replace_once(
    dialog,
    'A címzett az első kiküldéskor ehhez az oldalhoz rögzült. Újraküldéskor nem változtatható meg.',
    'A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.',
)

print('Expired invite reassignment patch applied.')
