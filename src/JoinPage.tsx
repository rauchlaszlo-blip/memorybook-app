import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';
const MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;
const DEVICE_ID_STORAGE_KEY = 'memorybook-event-device-id';

type InviteData = {
  bookId: string;
  title: string;
  bookType?: string;
  deviceLimit?: number;
  identityMode?: string;
  requiredFields?: RequiredField[];
};
type JoinPageProps = { token: string };
type RequiredField = 'name' | 'email' | 'phone' | 'festivalId' | 'ticketId';

const REQUIRED_FIELD_OPTIONS: Record<RequiredField, { label: string; type: string; autoComplete?: string }> = {
  name: { label: 'Név', type: 'text', autoComplete: 'name' },
  email: { label: 'E-mail-cím', type: 'email', autoComplete: 'email' },
  phone: { label: 'Telefonszám', type: 'tel', autoComplete: 'tel' },
  festivalId: { label: 'Fesztiválazonosító', type: 'text' },
  ticketId: { label: 'Belépőjegy-azonosító', type: 'text' },
};

function getOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;

    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `device-${crypto.randomUUID()}`
        : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return `device-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function JoinPage({ token }: JoinPageProps) {
  const language = usePublicUiLanguage();
  const t = (key: string) => publicText(language, key);
  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [memory, setMemory] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [guestData, setGuestData] = useState<Record<string, string>>({});
  const [startingEditor, setStartingEditor] = useState(false);

  const openEventEditor = async (data: Record<string, string>) => {
    setStartingEditor(true);
    setError(null);
    try {
      const sessionResponse = await fetch(
        `${API_BASE}/api/invites/${encodeURIComponent(token)}/page-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getOrCreateDeviceId(), guestData: data }),
        }
      );
      const sessionData = await sessionResponse.json().catch(() => null);
      if (!sessionResponse.ok) {
        if (sessionData?.error === 'EVENT_GUESTBOOK_CLOSED') throw new Error('EVENT_CLOSED');
        if (sessionResponse.status === 429) throw new Error('RATE_LIMITED');
        if (sessionData?.error === 'DEVICE_CONTRIBUTION_LIMIT_REACHED') {
          throw new Error('DEVICE_LIMIT_REACHED');
        }
        if (sessionData?.error === 'INVALID_EVENT_GUEST_EMAIL') {
          throw new Error('INVALID_EMAIL');
        }
        throw new Error('PAGE_SESSION_CREATE_FAILED');
      }
      if (typeof sessionData?.invitePath !== 'string') {
        throw new Error('PAGE_SESSION_CREATE_FAILED');
      }
      window.location.replace(sessionData.invitePath);
      return true;
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && err.message === 'DEVICE_LIMIT_REACHED'
          ? t('Erről az eszközről már elküldted az engedélyezett számú bejegyzést.')
          : err instanceof Error && err.message === 'INVALID_EMAIL'
            ? t('Adj meg érvényes e-mail-címet.')
            : err instanceof Error && err.message === 'EVENT_CLOSED'
              ? t('Ez a vendégkönyv már lezárult.')
              : err instanceof Error && err.message === 'RATE_LIMITED'
                ? t('Túl sok kérés érkezett. Várj egy percet, majd próbáld újra.')
                : t('A rajzlapot nem sikerült megnyitni. Próbáld újra.')
      );
      setStartingEditor(false);
      return false;
    }
  };

  useEffect(() => {
    const loadInvite = async () => {
      let redirectingToEditor = false;
      try {
        const response = await fetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}`);
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          if (data?.error === 'EVENT_GUESTBOOK_CLOSED') throw new Error('EVENT_CLOSED');
          if (response.status === 429) throw new Error('RATE_LIMITED');
          throw new Error('INVITE_LOAD_FAILED');
        }
        const data: InviteData = await response.json();
        setInvite(data);

        if (data.bookType === 'event') {
          const requiredFields = Array.isArray(data.requiredFields) ? data.requiredFields : [];
          if (requiredFields.length === 0) {
            redirectingToEditor = await openEventEditor({});
          }
          return;
        }
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error && err.message === 'DEVICE_LIMIT_REACHED'
            ? t('Erről az eszközről már elküldted az engedélyezett számú bejegyzést.')
            : err instanceof Error && err.message === 'EVENT_CLOSED'
              ? t('Ez a vendégkönyv már lezárult.')
              : err instanceof Error && err.message === 'RATE_LIMITED'
                ? t('Túl sok kérés érkezett. Várj egy percet, majd próbáld újra.')
                : t('Ez a vendégkönyv-meghívó nem érhető el.')
        );
      } finally {
        if (!redirectingToEditor) setLoading(false);
      }
    };
    loadInvite();
  }, [token]);

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setPhotoDataUrl(null);
      setPhotoName('');
      return;
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError(t('JPG, PNG vagy WEBP képet válassz.'));
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setError(t('A kép legfeljebb 3 MB lehet.'));
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
        setPhotoName(file.name);
        setError(null);
      }
    };
    reader.onerror = () => {
      setPhotoDataUrl(null);
      setPhotoName('');
      setError(t('A képet nem sikerült beolvasni.'));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !memory.trim()) return;
    try {
      setSubmitting(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}/contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contributorName: name.trim(),
          memoryText: memory.trim(),
          photoDataUrl,
          deviceId: getOrCreateDeviceId(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (data?.error === 'DEVICE_CONTRIBUTION_LIMIT_REACHED') {
          setRemaining(0);
          throw new Error('DEVICE_LIMIT_REACHED');
        }
        if (data?.error === 'CONTRIBUTION_PHOTO_TOO_LARGE') throw new Error('PHOTO_TOO_LARGE');
        if (data?.error === 'INVALID_CONTRIBUTION_PHOTO_FORMAT') throw new Error('INVALID_PHOTO');
        throw new Error('CONTRIBUTION_SAVE_FAILED');
      }
      setRemaining(
        typeof data?.deviceSubmissionsRemaining === 'number'
          ? data.deviceSubmissionsRemaining
          : null
      );
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message === 'DEVICE_LIMIT_REACHED') {
        setError(t('Erről az eszközről már elküldted az engedélyezett számú bejegyzést.'));
      } else if (err instanceof Error && err.message === 'PHOTO_TOO_LARGE') {
        setError(t('A kép legfeljebb 3 MB lehet.'));
      } else if (err instanceof Error && err.message === 'INVALID_PHOTO') {
        setError(t('JPG, PNG vagy WEBP képet válassz.'));
      } else {
        setError(t('Az üzenetet nem sikerült elküldeni. Próbáld újra.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = () => {
    setSubmitted(false);
    setMemory('');
    setPhotoDataUrl(null);
    setPhotoName('');
    setError(null);
  };

  if (loading) return <div style={styles.message}>{t('Vendégkönyv betöltése...')}</div>;
  if (error && !invite) return <div style={styles.message}>{error}</div>;
  if (!invite) return <div style={styles.message}>{t('A vendégkönyv nem található.')}</div>;

  const deviceLimit = Math.max(1, Number(invite.deviceLimit) || 1);

  if (invite.bookType === 'event') {
    const requiredFields = Array.isArray(invite.requiredFields) ? invite.requiredFields : [];
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <div style={styles.languageRow}><LanguageSwitcher /></div>
          <div style={styles.eyebrow}>{t('MemoryBook vendégkönyv')}</div>
          <h1 style={styles.title}>{invite.title}</h1>
          <p style={styles.intro}>{t('Add meg a szervező által kért adatokat, majd nyisd meg a rajzlapot.')}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void openEventEditor(guestData);
            }}
          >
            {requiredFields.map((field) => {
              const option = REQUIRED_FIELD_OPTIONS[field];
              if (!option) return null;
              return (
                <label key={field} style={styles.label}>
                  {t(option.label)}
                  <input
                    type={option.type}
                    autoComplete={option.autoComplete}
                    value={guestData[field] || ''}
                    onChange={(event) => setGuestData((current) => ({ ...current, [field]: event.target.value }))}
                    style={styles.input}
                    maxLength={field === 'email' ? 254 : field === 'phone' ? 50 : 200}
                    required
                  />
                </label>
              );
            })}
            {error && <div style={styles.error}>{error}</div>}
            <button type="submit" disabled={startingEditor} style={styles.button}>
              {startingEditor ? t('Rajzlap megnyitása...') : t('Rajzlap megnyitása')}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (submitted) {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <div style={styles.languageRow}><LanguageSwitcher /></div>
          <div style={styles.eyebrow}>{t('MemoryBook vendégkönyv')}</div>
          <h1 style={styles.title}>{invite.title}</h1>
          <h2 style={styles.thankYou}>{f('Köszönjük, {name}!', { name: name.trim() })}</h2>
          <p style={styles.intro}>{t('Az üzeneted bekerült a rendezvény vendégkönyvébe.')}</p>
          {remaining !== null && remaining > 0 && (
            <>
              <div style={styles.remaining}>{f('Erről az eszközről még {count} bejegyzést küldhetsz.', { count: remaining })}</div>
              <button type="button" onClick={startAnother} style={styles.button}>{t('Újabb bejegyzés')}</button>
            </>
          )}
          {remaining === 0 && (
            <div style={styles.remaining}>{t('Erről az eszközről elérted a rendezvényhez engedélyezett bejegyzésszámot.')}</div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.languageRow}><LanguageSwitcher /></div>
        <div style={styles.eyebrow}>{t('MemoryBook vendégkönyv')}</div>
        <h1 style={styles.title}>{invite.title}</h1>
        <p style={styles.intro}>{t('Írj egy üzenetet vagy emléket a rendezvény vendégkönyvébe.')}</p>
        <div style={styles.limitInfo}>
          {f('Erről az eszközről legfeljebb {count} bejegyzés küldhető ebbe a vendégkönyvbe.', { count: deviceLimit })}
        </div>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>
            {t('Neved')}
            <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} maxLength={100} autoComplete="name" required />
          </label>
          <label style={styles.label}>
            {t('Üzeneted')}
            <textarea value={memory} onChange={(e) => setMemory(e.target.value)} style={styles.textarea} maxLength={3000} required />
          </label>
          <label style={styles.label}>
            {t('Fotó (opcionális)')}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} style={styles.fileInput} />
          </label>
          {photoName && <div style={styles.photoInfo}>{f('Kiválasztott kép: {name}', { name: photoName })}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={submitting} style={styles.button}>{submitting ? t('Küldés...') : t('Bejegyzés elküldése')}</button>
        </form>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '20px 12px 40px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },
  card: { width: '100%', maxWidth: 620, margin: '0 auto', background: '#ffffff', padding: 'clamp(20px, 6vw, 32px)', boxSizing: 'border-box', borderRadius: 16, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' },
  eyebrow: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: '#64748b' },
  title: { margin: '8px 0', color: '#0f172a', fontSize: 'clamp(26px, 8vw, 38px)', lineHeight: 1.12, overflowWrap: 'anywhere' },
  thankYou: { margin: '22px 0 8px', color: '#0f172a' },
  intro: { color: '#475569', marginBottom: 18, lineHeight: 1.55 },
  limitInfo: { marginBottom: 22, padding: 12, borderRadius: 10, background: '#f8fafc', color: '#334155', lineHeight: 1.45 },
  remaining: { margin: '14px 0', padding: 12, borderRadius: 10, background: '#f8fafc', color: '#334155', lineHeight: 1.45 },
  label: { display: 'block', marginBottom: 20, fontWeight: 700, color: '#1e293b' },
  input: { display: 'block', width: '100%', minHeight: 48, boxSizing: 'border-box', marginTop: 8, padding: 12, fontSize: 16, border: '1px solid #cbd5e1', borderRadius: 8 },
  textarea: { display: 'block', width: '100%', minHeight: 160, boxSizing: 'border-box', marginTop: 8, padding: 12, fontSize: 16, lineHeight: 1.5, border: '1px solid #cbd5e1', borderRadius: 8, resize: 'vertical' },
  fileInput: { display: 'block', width: '100%', minHeight: 44, marginTop: 8, fontSize: 15 },
  photoInfo: { marginTop: -8, marginBottom: 20, padding: 10, background: '#f1f5f9', color: '#334155', borderRadius: 8, fontSize: 14 },
  button: { width: '100%', minHeight: 50, padding: '13px 18px', border: 0, borderRadius: 8, background: '#0f172a', color: '#ffffff', fontSize: 16, fontWeight: 800, cursor: 'pointer', touchAction: 'manipulation' },
  error: { marginBottom: 16, padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8 },
  message: { padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' },
};
