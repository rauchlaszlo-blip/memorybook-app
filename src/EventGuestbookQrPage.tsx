import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://' + window.location.hostname + ':3001' : '';
type EventGuestbookQrPageProps = { bookId: string };

export function EventGuestbookQrPage({ bookId }: EventGuestbookQrPageProps) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const [title, setTitle] = useState('MemoryBook');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = useMemo(() => window.location.origin, []);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`, { credentials: 'include' });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (!response.ok) throw new Error('LOAD_FAILED');
        const data = await response.json();
        if (data.book?.bookType !== 'event') throw new Error('NOT_EVENT_BOOK');
        setTitle(data.book?.title || 'MemoryBook');
        setInviteToken(data.book?.eventInviteToken || null);
      } catch (err) {
        console.error(err);
        setError(t('Nem sikerült betölteni a rendezvény QR-kódját.'));
      }
    };
    load();
  }, [bookId]);

  useEffect(() => {
    if (!inviteToken) return;
    QRCode.toDataURL(`${origin}/join/${inviteToken}`, { width: 900, margin: 3, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch((err) => { console.error(err); setError(t('Nem sikerült elkészíteni a QR-kódot.')); });
  }, [inviteToken, origin]);

  if (error) return <main style={styles.center}>{error}</main>;
  if (!inviteToken || !qrDataUrl) return <main style={styles.center}>{t('QR-kód készítése...')}</main>;

  return (
    <main style={styles.page}>
      <a href={`/book/${encodeURIComponent(bookId)}/view`} style={styles.back}>{t('← Vissza a könyvhöz')}</a>
      <section style={styles.card}>
        <div style={styles.brand}>{t('MemoryBook vendégkönyv')}</div>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.lead}>{t('Olvasd be a QR-kódot, és írj a vendégkönyvbe!')}</p>
        <img src={qrDataUrl} alt={t('QR-kódos vendégkönyv QR-kódja')} style={styles.qr} />
        <p style={styles.hint}>{t('A QR-kód ugyanarra a közös vendégkönyvre visz minden vendéget.')}</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '18px 14px 36px', boxSizing: 'border-box', background: '#f1f5f9', fontFamily: 'Arial, sans-serif' },
  back: { display: 'inline-flex', alignItems: 'center', minHeight: 44, marginBottom: 10, color: '#475569', fontWeight: 800, textDecoration: 'none' },
  card: { width: '100%', maxWidth: 760, margin: '0 auto', padding: 'clamp(22px, 6vw, 48px)', boxSizing: 'border-box', borderRadius: 20, background: '#ffffff', textAlign: 'center', boxShadow: '0 12px 40px rgba(15, 23, 42, 0.10)' },
  brand: { color: '#64748b', fontSize: 13, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase' },
  title: { margin: '10px 0', color: '#0f172a', fontSize: 'clamp(30px, 8vw, 52px)', lineHeight: 1.08, overflowWrap: 'anywhere' },
  lead: { margin: '0 auto 20px', color: '#334155', fontSize: 'clamp(18px, 4vw, 24px)', lineHeight: 1.4 },
  qr: { display: 'block', width: 'min(100%, 520px)', height: 'auto', margin: '0 auto', imageRendering: 'pixelated' },
  hint: { margin: '20px auto 0', maxWidth: 560, color: '#64748b', lineHeight: 1.5 },
  center: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Arial, sans-serif' },
};
