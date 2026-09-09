from pathlib import Path


def rep(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Marker not found: {label}')
    return text.replace(old, new, 1)

# --- InviteSendDialog ---
p = Path('src/InviteSendDialog.tsx')
text = p.read_text(encoding='utf-8')

text = rep(text,
"""  const identityLocked = isResend && hasSavedIdentity;
  const [platform, setPlatform] = useState<SendPlatform>(""",
"""  const identityLocked = isResend && hasSavedIdentity;
  const lockedRecipientLabel = savedRecipientName || savedRecipientEmail || '';
  const [platform, setPlatform] = useState<SendPlatform>(""",
'locked recipient label')

text = rep(text,
"""    if (platform === 'email') {
      try {""",
"""    if (identityLocked && lockedRecipientLabel) {
      const confirmed = window.confirm(
        f('Ez az aktív meghívó {name} részére van lefoglalva. Csak ugyanennek a személynek küldd újra. Folytatod?', { name: lockedRecipientLabel })
      );
      if (!confirmed) return;
    }

    if (platform === 'email') {
      try {""",
'resend confirmation')

text = rep(text,
"""      } catch (err) {
        console.error(err);
        setSendError(t('Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.'));
      }
      return;
    }""",
"""      } catch (err) {
        console.error(err);
        setSendError(
          err instanceof Error && err.message === 'PAGE_INVITE_RECIPIENT_LOCKED'
            ? t('A meghívó címzettje nem módosítható a 14 napos időablak alatt.')
            : t('Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.')
        );
      }
      return;
    }""",
'email locked error')

text = rep(text,
"""      await onSent(metadata);
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
      setSendError(t('Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.'));
    }""",
"""      await onSent(metadata);
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
      setSendError(
        err instanceof Error && err.message === 'PAGE_INVITE_RECIPIENT_LOCKED'
          ? t('A meghívó címzettje nem módosítható a 14 napos időablak alatt.')
          : t('Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.')
      );
    }""",
'share locked error')

text = rep(text,
"""        {isResend && (
          <div style={styles.resendWarning}>
            {t('Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.')}
          </div>
        )}""",
"""        {isResend && (
          <div style={styles.resendWarning}>
            {lockedRecipientLabel
              ? f('Ez az oldal jelenleg {name} részére van lefoglalva. A 14 napos időablak alatt csak neki küldhető újra.', { name: lockedRecipientLabel })
              : t('Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.')}
          </div>
        )}""",
'clear resend warning')

text = rep(text,
"""          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            style={styles.textarea}
            rows={11}
          />""",
"""          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            style={styles.textarea}
            rows={11}
            readOnly={identityLocked}
          />""",
'lock resend message')

p.write_text(text, encoding='utf-8')

# --- OwnerBookPage ---
p = Path('src/OwnerBookPage.tsx')
text = p.read_text(encoding='utf-8')

text = rep(text,
"""                      {hasInvite && page.inviteExpiresAt && (
                        <div style={styles.inviteMeta}>
                          {isInviteExpired(page)
                            ? t('A meghívó lejárt. Az oldal új címzettnek kiadható.')
                            : f('A meghívó 14 napig használható. Lejár: {date}', { date: formatInviteExpiry(page.inviteExpiresAt, uiLanguage) })}
                        </div>
                      )}""",
"""                      {hasInvite && page.inviteExpiresAt && (
                        <div style={styles.inviteMeta}>
                          {isInviteExpired(page)
                            ? t('A meghívó lejárt. Az oldal új címzettnek kiadható.')
                            : f('A meghívó 14 napig használható. Lejár: {date}', { date: formatInviteExpiry(page.inviteExpiresAt, uiLanguage) })}
                          {!isInviteExpired(page) && page.inviteSentAt && (page.inviteRecipientName || page.inviteRecipientEmail) && (
                            <><br /><strong>{f('Aktív címzett: {name}', { name: page.inviteRecipientName || page.inviteRecipientEmail || '' })}</strong></>
                          )}
                        </div>
                      )}""",
'active recipient summary')

text = rep(text,
"""                              : page.inviteSentAt
                                ? t('Meghívó újraküldése')
                                : t('Meghívás folytatása')}""",
"""                              : page.inviteSentAt
                                ? (page.inviteRecipientName || page.inviteRecipientEmail
                                    ? f('Újraküldés: {name}', { name: page.inviteRecipientName || page.inviteRecipientEmail || '' })
                                    : t('Meghívó újraküldése'))
                                : t('Meghívás folytatása')}""",
'resend button label')

p.write_text(text, encoding='utf-8')

# --- owner UI translations ---
p = Path('src/ownerUiI18n.ts')
text = p.read_text(encoding='utf-8')
anchor = "  'Meghívó újraküldése': { en: 'Resend invitation', de: 'Einladung erneut senden' },"
extra = """
  'Aktív címzett: {name}': { en: 'Active recipient: {name}', de: 'Aktiver Empfänger: {name}' },
  'Újraküldés: {name}': { en: 'Resend to: {name}', de: 'Erneut senden an: {name}' },"""
text = rep(text, anchor, anchor + extra, 'owner active recipient translations')
anchor2 = "  'Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.': { en: 'You already sent this invitation. Resending is intended for the same person.', de: 'Diese Einladung wurde bereits gesendet. Das erneute Senden ist für dieselbe Person gedacht.' },"
extra2 = """
  'Ez az oldal jelenleg {name} részére van lefoglalva. A 14 napos időablak alatt csak neki küldhető újra.': { en: 'This page is currently assigned to {name}. During the 14-day window it can only be resent to that person.', de: 'Diese Seite ist derzeit {name} zugeordnet. Während des 14-Tage-Zeitraums darf sie nur an diese Person erneut gesendet werden.' },
  'Ez az aktív meghívó {name} részére van lefoglalva. Csak ugyanennek a személynek küldd újra. Folytatod?': { en: 'This active invitation is assigned to {name}. Resend it only to the same person. Continue?', de: 'Diese aktive Einladung ist {name} zugeordnet. Sende sie nur an dieselbe Person erneut. Fortfahren?' },
  'A meghívó címzettje nem módosítható a 14 napos időablak alatt.': { en: 'The invitation recipient cannot be changed during the 14-day window.', de: 'Der Empfänger der Einladung kann während des 14-Tage-Zeitraums nicht geändert werden.' },"""
text = rep(text, anchor2, anchor2 + extra2, 'owner resend guard translations')
p.write_text(text, encoding='utf-8')

# --- Page invite editor ---
p = Path('src/PageInviteEditorPage.tsx')
text = p.read_text(encoding='utf-8')
text = rep(text,
"""  inviteStatus: string;
  language: AppLanguage;
};""",
"""  inviteStatus: string;
  inviteRecipientName?: string | null;
  language: AppLanguage;
};""",
'guest recipient type')
text = rep(text,
"""        <div style={styles.subtitle}>{copy.pageLabel(page.pageNumber)}</div>
        <p style={styles.note}>{copy.instructions}</p>""",
"""        <div style={styles.subtitle}>{copy.pageLabel(page.pageNumber)}</div>
        {page.inviteRecipientName && (
          <div style={styles.recipientBanner}>{copy.recipientNotice(page.inviteRecipientName)}</div>
        )}
        <p style={styles.note}>{copy.instructions}</p>""",
'guest recipient banner')
text = rep(text,
"""  brand: {
    color: '#64748b',""",
"""  recipientBanner: {
    margin: '12px 0',
    padding: '10px 12px',
    borderRadius: 10,
    background: '#fff7ed',
    color: '#9a3412',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  brand: {
    color: '#64748b',""",
'guest recipient style')
p.write_text(text, encoding='utf-8')

# --- invite editor translations ---
p = Path('src/inviteEditorI18n.ts')
text = p.read_text(encoding='utf-8')
text = rep(text,
"""      pageLabel: (pageNumber: number) => `A te oldalad: ${pageNumber}. oldal`,
      instructions:""",
"""      pageLabel: (pageNumber: number) => `A te oldalad: ${pageNumber}. oldal`,
      recipientNotice: (name: string) => `Ez a meghívó ${name} részére szól. Ha nem te vagy ${name}, kérj saját meghívót a könyv tulajdonosától.`,
      instructions:""",
'hu recipient notice')
text = rep(text,
"""      pageLabel: (pageNumber: number) => `Your page: Page ${pageNumber}`,
      instructions:""",
"""      pageLabel: (pageNumber: number) => `Your page: Page ${pageNumber}`,
      recipientNotice: (name: string) => `This invitation is for ${name}. If you are not ${name}, ask the book owner for your own invitation.`,
      instructions:""",
'en recipient notice')
text = rep(text,
"""      pageLabel: (pageNumber: number) => `Deine Seite: Seite ${pageNumber}`,
      instructions:""",
"""      pageLabel: (pageNumber: number) => `Deine Seite: Seite ${pageNumber}`,
      recipientNotice: (name: string) => `Diese Einladung ist für ${name}. Wenn du nicht ${name} bist, bitte den Bucheigentümer um eine eigene Einladung.`,
      instructions:""",
'de recipient notice')
p.write_text(text, encoding='utf-8')

# --- Backend ---
p = Path('server/index.ts')
text = p.read_text(encoding='utf-8')

# Add explicit recipient identity check before updating sent metadata.
marker = """    const result = await pool.query(
      `UPDATE pages p
       SET invite_sent_at = COALESCE(p.invite_sent_at, CURRENT_TIMESTAMP),"""
precheck = """    const existingInviteResult = await pool.query(
      `SELECT
         p.invite_recipient_name AS \"inviteRecipientName\",
         p.invite_recipient_email AS \"inviteRecipientEmail\",
         p.invite_delivery_method AS \"inviteDeliveryMethod\"
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

"""
text = rep(text, marker, precheck + marker, 'backend recipient precheck')

# Include intended recipient in guest invite payload.
text = rep(text,
"""         p.invite_language AS \"inviteLanguage\",
         COALESCE(p.invite_language, b.language) AS \"language\",""",
"""         p.invite_language AS \"inviteLanguage\",
         p.invite_recipient_name AS \"inviteRecipientName\",
         COALESCE(p.invite_language, b.language) AS \"language\",""",
'guest recipient select')

p.write_text(text, encoding='utf-8')
