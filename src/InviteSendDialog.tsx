import { useMemo, useState } from 'react';
import type { AppLanguage } from './i18n';
import { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

type InviteSendDialogProps = {
  bookTitle: string;
  pageNumber: number;
  pageUrl: string;
  bookLanguage: AppLanguage;
  savedInviteLanguage?: AppLanguage | null;
  isResend?: boolean;
  savedRecipientName?: string | null;
  savedRecipientEmail?: string | null;
  savedDeliveryMethod?: 'share' | 'email' | null;
  onSent: (metadata: {
    recipientName: string;
    recipientEmail: string;
    deliveryMethod: 'share' | 'email';
    inviteLanguage: AppLanguage | null;
  }) => Promise<void>;
  onClose: () => void;
};

type SendPlatform = 'share' | 'email';
type InviteLanguageChoice = 'inherit' | AppLanguage;

function languageLabel(language: AppLanguage) {
  if (language === 'de') return 'Deutsch';
  return language === 'en' ? 'English' : 'Magyar';
}

function buildGreeting(language: AppLanguage, recipientName: string) {
  const name = recipientName.trim();
  if (language === 'de') return name ? `Hallo, ${name}!` : 'Hallo!';
  if (language === 'en') return name ? `Hi, ${name}!` : 'Hi!';
  return name ? `Szia, ${name}!` : 'Szia!';
}

function buildInviteTitle(language: AppLanguage, bookTitle: string) {
  if (language === 'de') return `MemoryBook-Einladung – ${bookTitle}`;
  if (language === 'en') return `MemoryBook invitation – ${bookTitle}`;
  return `MemoryBook meghívás – ${bookTitle}`;
}

function buildMessage(
  pageUrl: string,
  language: AppLanguage,
  recipientName = ''
) {
  if (language === 'de') {
    return [
      buildGreeting(language, recipientName),
      '',
      'Ich habe ein MemoryBook erstellt. Ich würde mich freuen, wenn du eine eigene Seite dafür gestaltest.',
      '',
      'Deine Seite findest du hier:',
      pageUrl,
      '',
      'Dieser Link gehört nur zu deiner Seite. Wenn du fertig bist, reiche sie unten auf der Seite ein.',
      'Die Einladung ist 14 Tage gültig.',
    ].join('\n');
  }

  if (language === 'en') {
    return [
      buildGreeting(language, recipientName),
      '',
      'I created a MemoryBook. I would like you to create your own page for it.',
      '',
      'Open your page here:',
      pageUrl,
      '',
      'This link belongs only to your page. When you are finished, submit it at the bottom of the page.',
      'The invitation is valid for 14 days.',
    ].join('\n');
  }

  return [
    buildGreeting(language, recipientName),
    '',
    'Készítettem egy MemoryBook emlékkönyvet. Szeretném, ha te is készítenél bele egy saját oldalt.',
    '',
    'A saját oldalad itt éred el:',
    pageUrl,
    '',
    'A link csak a te oldaladhoz tartozik. Ha elkészültél, az oldal alján küldd be.',
    'A meghívó 14 napig használható.',
  ].join('\n');
}

export function InviteSendDialog({
  bookTitle,
  pageNumber,
  pageUrl,
  bookLanguage,
  savedInviteLanguage = null,
  isResend = false,
  savedRecipientName = null,
  savedRecipientEmail = null,
  onSent,
  onClose,
}: InviteSendDialogProps) {
  const uiLanguage = useOwnerUiLanguage();
  const t = (key: string) => ownerText(uiLanguage, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(uiLanguage, key, values);
  const hasSavedIdentity = Boolean(savedRecipientName || savedRecipientEmail);
  const identityLocked = isResend && hasSavedIdentity;
  const lockedRecipientLabel = savedRecipientName || savedRecipientEmail || '';
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [recipientName, setRecipientName] = useState(savedRecipientName || '');
  const [inviteLanguageChoice, setInviteLanguageChoice] = useState<InviteLanguageChoice>(
    savedInviteLanguage || 'inherit'
  );
  const effectiveInviteLanguage: AppLanguage =
    inviteLanguageChoice === 'inherit' ? bookLanguage : inviteLanguageChoice;
  const [message, setMessage] = useState(() =>
    buildMessage(
      pageUrl,
      savedInviteLanguage || bookLanguage,
      savedRecipientName || ''
    )
  );
  const [sendError, setSendError] = useState<string | null>(null);

  const nativeShareAvailable = useMemo(
    () => typeof navigator.share === 'function',
    []
  );

  const updateRecipientName = (value: string) => {
    setRecipientName(value);
    setMessage((current) =>
      current.replace(/^[^\n]*/, buildGreeting(effectiveInviteLanguage, value))
    );
  };

  const updateInviteLanguage = (choice: InviteLanguageChoice) => {
    setInviteLanguageChoice(choice);
    const language = choice === 'inherit' ? bookLanguage : choice;
    setMessage(buildMessage(pageUrl, language, recipientName));
  };

  const send = async (selectedPlatform: SendPlatform) => {
    setSendMenuOpen(false);
    setSendError(null);

    if (selectedPlatform === 'share' && !recipientName.trim()) {
      setSendError(t('Megosztásnál add meg a címzett nevét, hogy az emlék később is azonosítható legyen.'));
      return;
    }
    const metadata = {
      recipientName: recipientName.trim(),
      recipientEmail: '',
      deliveryMethod: selectedPlatform,
      inviteLanguage: inviteLanguageChoice === 'inherit' ? null : inviteLanguageChoice,
    } as const;

    if (identityLocked && lockedRecipientLabel) {
      const confirmed = window.confirm(
        f('Ez az aktív meghívó {name} részére van lefoglalva. Csak ugyanennek a személynek küldd újra. Folytatod?', { name: lockedRecipientLabel })
      );
      if (!confirmed) return;
    }

    if (selectedPlatform === 'email') {
      try {
        const subject = buildInviteTitle(effectiveInviteLanguage, bookTitle);
        const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
        await onSent(metadata);
        window.location.href = mailto;
        onClose();
      } catch (err) {
        console.error(err);
        setSendError(
          err instanceof Error && err.message === 'PAGE_INVITE_RECIPIENT_LOCKED'
            ? t('A meghívó címzettje nem módosítható a 14 napos időablak alatt.')
            : t('Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.')
        );
      }
      return;
    }

    if (!nativeShareAvailable) {
      setSendError(t('Ezen az eszközön a rendszer megosztás nem érhető el. Válaszd az E-mail lehetőséget.'));
      return;
    }

    try {
      await navigator.share({
        title: buildInviteTitle(effectiveInviteLanguage, bookTitle),
        text: message,
      });
      await onSent(metadata);
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
      setSendError(
        err instanceof Error && err.message === 'PAGE_INVITE_RECIPIENT_LOCKED'
          ? t('A meghívó címzettje nem módosítható a 14 napos időablak alatt.')
          : t('Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.')
      );
    }
  };

  return (
    <div style={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-send-title"
        style={styles.dialog}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.dialogTop}>
          <div>
            <div style={styles.eyebrow}>{f('Oldal {page}', { page: pageNumber })}</div>
            <h2 id="invite-send-title" style={styles.title}>{isResend ? t('Meghívó újraküldése') : t('Meghívás küldése')}</h2>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label={t('Bezárás')}>×</button>
        </div>

        {isResend && (
          <div style={styles.resendWarning}>
            {lockedRecipientLabel
              ? f('Ez az oldal jelenleg {name} részére van lefoglalva. A 14 napos időablak alatt csak neki küldhető újra.', { name: lockedRecipientLabel })
              : t('Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.')}
          </div>
        )}
        <label style={styles.inlineLabel}>
          <span>{t('Megszólítás')}</span>
          <select
            value={inviteLanguageChoice}
            onChange={(event) => updateInviteLanguage(event.target.value as InviteLanguageChoice)}
            style={styles.inlineInput}
            aria-label={t('Meghívó nyelve')}
          >
            <option value="inherit">{f('Automatikus – {language}', { language: languageLabel(bookLanguage) })}</option>
            <option value="hu">Magyar</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>

        <label style={styles.inlineLabel}>
          {t('Megszólítás')}
          <input
            value={recipientName}
            onChange={(event) => updateRecipientName(event.target.value)}
            placeholder={t('pl. Virág')}
            style={styles.inlineInput}
            maxLength={120}
            readOnly={identityLocked}
          />
        </label>

        <label style={styles.label}>
          {t('Meghívó üzenet')}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            style={styles.textarea}
            rows={11}
            readOnly={identityLocked}
          />
        </label>

        {identityLocked && (
          <div style={styles.identityNote}>
            {t('A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.')}
          </div>
        )}
        {sendError && <div style={styles.error}>{sendError}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>{t('Mégse')}</button>
          <div style={styles.sendMenuWrap}>
            {!nativeShareAvailable && sendMenuOpen && (
              <div style={styles.sendMenu} role="menu">
                <button type="button" onClick={() => void send('share')} style={styles.sendMenuButton} role="menuitem">
                  <strong>{t('Megosztás…')}</strong>
                  <span style={styles.platformHint}>{t('Messenger, WhatsApp, SMS és más telepített app')}</span>
                </button>
                <button type="button" onClick={() => void send('email')} style={styles.sendMenuButton} role="menuitem">
                  <strong>E-mail</strong>
                  <span style={styles.platformHint}>{t('Közvetlenül a levelező alkalmazásban')}</span>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (nativeShareAvailable) {
                  void send('share');
                } else {
                  setSendMenuOpen((open) => !open);
                }
              }}
              style={styles.primaryButton}
              aria-expanded={!nativeShareAvailable && sendMenuOpen}
            >
              {t('Küldés')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'grid',
    placeItems: 'center',
    padding: 12,
    background: 'rgba(15, 23, 42, 0.55)',
    boxSizing: 'border-box',
  },
  dialog: {
    width: '100%',
    maxWidth: 620,
    maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto',
    padding: 18,
    boxSizing: 'border-box',
    borderRadius: 16,
    background: '#ffffff',
    boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
    fontFamily: 'Arial, sans-serif',
  },
  dialogTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  eyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  title: { margin: '4px 0 0', color: '#0f172a', fontSize: 24 },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    background: '#ffffff',
    color: '#475569',
    fontSize: 28,
    lineHeight: 1,
  },
  stepLabel: { margin: '16px 0 8px', color: '#334155', fontSize: 13, fontWeight: 800 },
  platformButton: {
    minHeight: 70,
    padding: 12,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    background: '#ffffff',
    color: '#334155',
    textAlign: 'left',
    fontSize: 15,
    fontWeight: 800,
  },
  platformActive: {
    minHeight: 70,
    padding: 12,
    border: '2px solid #0f172a',
    borderRadius: 10,
    background: '#f8fafc',
    color: '#0f172a',
    textAlign: 'left',
    fontSize: 15,
    fontWeight: 800,
  },
  platformHint: { display: 'block', marginTop: 5, color: '#64748b', fontSize: 12, fontWeight: 500, lineHeight: 1.35 },
  label: { display: 'block', marginTop: 12, color: '#334155', fontSize: 13, fontWeight: 800 },
  inlineLabel: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    color: '#334155',
    fontSize: 13,
    fontWeight: 800,
  },
  inlineInput: {
    width: '100%',
    minHeight: 44,
    padding: '8px 10px',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    fontSize: 16,
  },
  input: {
    width: '100%',
    minHeight: 46,
    marginTop: 6,
    padding: '10px 12px',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 16,
  },
  textarea: {
    width: '100%',
    marginTop: 6,
    padding: 12,
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 15,
    lineHeight: 1.45,
    resize: 'vertical',
  },
  resendWarning: { marginBottom: 10, padding: 12, borderRadius: 8, background: '#fff7ed', color: '#9a3412', fontSize: 13, lineHeight: 1.45, fontWeight: 700 },
  expiryNote: { marginBottom: 12, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, lineHeight: 1.45 },
  identityNote: { marginTop: 10, padding: 10, borderRadius: 8, background: '#ecfeff', color: '#155e75', fontSize: 12, lineHeight: 1.45, fontWeight: 700 },
  note: { marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, lineHeight: 1.45 },
  error: { marginTop: 10, padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 },
  actions: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 10, marginTop: 16 },
  sendMenuWrap: { position: 'relative' },
  sendMenu: {
    position: 'absolute',
    right: 0,
    bottom: 'calc(100% + 8px)',
    zIndex: 2,
    width: 'min(320px, calc(100vw - 48px))',
    padding: 6,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    background: '#ffffff',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
  },
  sendMenuButton: {
    display: 'block',
    width: '100%',
    minHeight: 58,
    padding: '10px 12px',
    border: 0,
    borderRadius: 7,
    background: '#ffffff',
    color: '#0f172a',
    textAlign: 'left',
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 48,
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
  },
  primaryButton: {
    width: '100%',
    minHeight: 48,
    padding: '10px 12px',
    border: 0,
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontWeight: 800,
  },
};
