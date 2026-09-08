import { useMemo, useState } from 'react';

type InviteSendDialogProps = {
  bookTitle: string;
  pageNumber: number;
  pageUrl: string;
  ctaUrl: string;
  isResend?: boolean;
  expiresAt?: string | null;
  savedRecipientName?: string | null;
  savedRecipientEmail?: string | null;
  savedDeliveryMethod?: 'share' | 'email' | null;
  onSent: (metadata: {
    recipientName: string;
    recipientEmail: string;
    deliveryMethod: 'share' | 'email';
  }) => Promise<void>;
  onClose: () => void;
};

type SendPlatform = 'share' | 'email';

function buildMessage(bookTitle: string, pageUrl: string, ctaUrl: string) {
  return [
    'Szia!',
    '',
    `Készítettem egy MemoryBook emlékkönyvet: „${bookTitle}”. Szeretném, ha te is készítenél bele egy saját oldalt.`,
    '',
    'A saját oldalad itt éred el:',
    pageUrl,
    '',
    'A link csak a te oldaladhoz tartozik. Ha elkészültél, az oldal alján küldd be.',
    'A meghívó 14 napig használható.',
    '',
    `👉 Nekem is kell emlékkönyv: ${ctaUrl}`,
  ].join('\n');
}

export function InviteSendDialog({
  bookTitle,
  pageNumber,
  pageUrl,
  ctaUrl,
  isResend = false,
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
  const [email, setEmail] = useState(savedRecipientEmail || '');
  const [message, setMessage] = useState(() => buildMessage(bookTitle, pageUrl, ctaUrl));
  const [sendError, setSendError] = useState<string | null>(null);

  const nativeShareAvailable = useMemo(
    () => typeof navigator.share === 'function',
    []
  );

  const updateRecipientName = (value: string) => {
    setRecipientName(value);
    setMessage((current) => {
      const greeting = value.trim() ? `Szia, ${value.trim()}!` : 'Szia!';
      return current.replace(/^Szia(?:, [^!]+)?!/, greeting);
    });
  };

  const send = async () => {
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
      } catch (err) {
        console.error(err);
        setSendError('Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.');
      }
      return;
    }

    if (!nativeShareAvailable) {
      setSendError(
        'Ezen az eszközön a rendszer megosztás nem érhető el. Válaszd az E-mail lehetőséget.'
      );
      return;
    }

    try {
      await navigator.share({
        title: `MemoryBook meghívás – ${bookTitle}`,
        text: message,
      });
      await onSent(metadata);
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
      setSendError('Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.');
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
            <div style={styles.eyebrow}>Oldal {pageNumber}</div>
            <h2 id="invite-send-title" style={styles.title}>{isResend ? 'Meghívó újraküldése' : 'Meghívás küldése'}</h2>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Bezárás">×</button>
        </div>

        {isResend && (
          <div style={styles.resendWarning}>
            Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.
          </div>
        )}
        <div style={styles.expiryNote}>
          A meghívó 14 napig használható{expiresAt ? `, lejár: ${new Date(expiresAt).toLocaleDateString('hu-HU')}` : ''}.
        </div>

        <div style={styles.stepLabel}>1. Küldési mód</div>
        <div style={styles.platformGrid}>
          <button
            type="button"
            onClick={() => !identityLocked && setPlatform('share')}
            disabled={identityLocked}
            style={platform === 'share' ? styles.platformActive : styles.platformButton}
          >
            Megosztás…
            <span style={styles.platformHint}>Messenger, WhatsApp, SMS, e-mail és más telepített app</span>
          </button>
          <button
            type="button"
            onClick={() => !identityLocked && setPlatform('email')}
            disabled={identityLocked}
            style={platform === 'email' ? styles.platformActive : styles.platformButton}
          >
            E-mail
            <span style={styles.platformHint}>Közvetlenül a levelező alkalmazásban</span>
          </button>
        </div>

        <div style={styles.stepLabel}>2. Személyre szabás</div>
        <label style={styles.label}>
          Címzett neve {platform === 'share' ? '(kötelező)' : '(opcionális)'}
          <input
            value={recipientName}
            onChange={(event) => updateRecipientName(event.target.value)}
            placeholder="pl. Rubinszky Gertrúd"
            style={styles.input}
            maxLength={120}
            readOnly={identityLocked}
          />
        </label>

        {platform === 'email' && (
          <label style={styles.label}>
            E-mail cím (kötelező)
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nev@example.com"
              style={styles.input}
              readOnly={identityLocked}
            />
          </label>
        )}

        <label style={styles.label}>
          Meghívó üzenet
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            style={styles.textarea}
            rows={11}
          />
        </label>

        {identityLocked && (
          <div style={styles.identityNote}>
            A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.
          </div>
        )}
        <div style={styles.note}>
          A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.
        </div>

        {sendError && <div style={styles.error}>{sendError}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.secondaryButton}>Mégse</button>
          <button type="button" onClick={send} style={styles.primaryButton}>
            {platform === 'email' ? 'E-mail megnyitása' : 'Címzett és app kiválasztása'}
          </button>
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
  platformGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 },
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
    minHeight: 48,
    padding: '10px 12px',
    border: 0,
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontWeight: 800,
  },
};
