import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';
const MAX_PHOTO_SIZE_BYTES = 3 * 1024 * 1024;

type InviteData = { bookId: string; title: string };
type JoinPageProps = { token: string };

export function JoinPage({ token }: JoinPageProps) {
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [memory, setMemory] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const loadInvite = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/invites/${encodeURIComponent(token)}`);
        if (!response.ok) throw new Error('INVITE_LOAD_FAILED');
        setInvite(await response.json());
      } catch (err) {
        console.error(err);
        setError('Ez a vendégkönyv-meghívó nem érhető el.');
      } finally {
        setLoading(false);
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
      setError('JPG, PNG vagy WEBP képet válassz.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setError('A kép legfeljebb 3 MB lehet.');
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
      setError('A képet nem sikerült beolvasni.');
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
        body: JSON.stringify({ contributorName: name.trim(), memoryText: memory.trim(), photoDataUrl }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.error === 'CONTRIBUTION_PHOTO_TOO_LARGE') throw new Error('PHOTO_TOO_LARGE');
        if (data?.error === 'INVALID_CONTRIBUTION_PHOTO_FORMAT') throw new Error('INVALID_PHOTO');
        throw new Error('CONTRIBUTION_SAVE_FAILED');
      }
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message === 'PHOTO_TOO_LARGE') setError('A kép legfeljebb 3 MB lehet.');
      else if (err instanceof Error && err.message === 'INVALID_PHOTO') setError('JPG, PNG vagy WEBP képet válassz.');
      else setError('Az üzenetet nem sikerült elküldeni. Próbáld újra.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={styles.message}>Vendégkönyv betöltése...</div>;
  if (error && !invite) return <div style={styles.message}>{error}</div>;
  if (!invite) return <div style={styles.message}>A vendégkönyv nem található.</div>;

  if (submitted) {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <div style={styles.eyebrow}>MemoryBook vendégkönyv</div>
          <h1 style={styles.title}>{invite.title}</h1>
          <h2 style={styles.thankYou}>Köszönjük, {name.trim()}!</h2>
          <p style={styles.intro}>Az üzeneted bekerült a rendezvény vendégkönyvébe.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.eyebrow}>MemoryBook vendégkönyv</div>
        <h1 style={styles.title}>{invite.title}</h1>
        <p style={styles.intro}>Írj egy üzenetet vagy emléket a rendezvény vendégkönyvébe.</p>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>
            Neved
            <input value={name} onChange={(e) => setName(e.target.value)} style={styles.input} maxLength={100} autoComplete="name" required />
          </label>
          <label style={styles.label}>
            Üzeneted
            <textarea value={memory} onChange={(e) => setMemory(e.target.value)} style={styles.textarea} maxLength={3000} required />
          </label>
          <label style={styles.label}>
            Fotó (opcionális)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} style={styles.fileInput} />
          </label>
          {photoName && <div style={styles.photoInfo}>Kiválasztott kép: {photoName}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={submitting} style={styles.button}>{submitting ? 'Küldés...' : 'Bejegyzés elküldése'}</button>
        </form>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '20px 12px 40px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 620, margin: '0 auto', background: '#ffffff', padding: 'clamp(20px, 6vw, 32px)', boxSizing: 'border-box', borderRadius: 16, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' },
  eyebrow: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: '#64748b' },
  title: { margin: '8px 0', color: '#0f172a', fontSize: 'clamp(26px, 8vw, 38px)', lineHeight: 1.12, overflowWrap: 'anywhere' },
  thankYou: { margin: '22px 0 8px', color: '#0f172a' },
  intro: { color: '#475569', marginBottom: 26, lineHeight: 1.55 },
  label: { display: 'block', marginBottom: 20, fontWeight: 700, color: '#1e293b' },
  input: { display: 'block', width: '100%', minHeight: 48, boxSizing: 'border-box', marginTop: 8, padding: 12, fontSize: 16, border: '1px solid #cbd5e1', borderRadius: 8 },
  textarea: { display: 'block', width: '100%', minHeight: 160, boxSizing: 'border-box', marginTop: 8, padding: 12, fontSize: 16, lineHeight: 1.5, border: '1px solid #cbd5e1', borderRadius: 8, resize: 'vertical' },
  fileInput: { display: 'block', width: '100%', minHeight: 44, marginTop: 8, fontSize: 15 },
  photoInfo: { marginTop: -8, marginBottom: 20, padding: 10, background: '#f1f5f9', color: '#334155', borderRadius: 8, fontSize: 14 },
  button: { width: '100%', minHeight: 50, padding: '13px 18px', border: 0, borderRadius: 8, background: '#0f172a', color: '#ffffff', fontSize: 16, fontWeight: 800, cursor: 'pointer', touchAction: 'manipulation' },
  error: { marginBottom: 16, padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8 },
  message: { padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' },
};
