import { useEffect, useState } from 'react';
import { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3001`
    : '';

type DedicationCapturePageProps = {
  bookId: string;
  pageId: string;
};

export function DedicationCapturePage({ bookId, pageId }: DedicationCapturePageProps) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) =>
    ownerFormat(language, key, values);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`,
          { credentials: 'include' }
        );
        if (response.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.book?.bookType !== 'dedication') {
          throw new Error('DEDICATION_BOOK_NOT_FOUND');
        }
        const page = Array.isArray(data.pages)
          ? data.pages.find((item: { id?: string }) => item.id === pageId)
          : null;
        if (!page || page.inviteStatus !== 'empty') {
          throw new Error('DEDICATION_PAGE_NOT_AVAILABLE');
        }
        setBookTitle(data.book.title || 'MemoryBook');
        setPageNumber(Number(page.pageNumber));
      } catch (loadError) {
        console.error(loadError);
        setError(t('A dedikálási oldal nem nyitható meg.'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, pageId]);

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href={`/my-books/${encodeURIComponent(bookId)}`} style={styles.back}>
          {t('← Vissza a könyvhöz')}
        </a>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{bookTitle}</h1>

        {loading && <div style={styles.message}>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && pageNumber !== null && (
          <>
            <div style={styles.pageNumber}>{f('{page}. dedikálási oldal', { page: pageNumber })}</div>
            <h2 style={styles.question}>{t('Honnan választasz fényképet?')}</h2>
            <div style={styles.actions}>
              <button type="button" style={styles.primaryButton} disabled>
                {t('Kamera')}
              </button>
              <button type="button" style={styles.secondaryButton} disabled>
                {t('Galéria')}
              </button>
            </div>
            <div style={styles.hint}>{t('A fénykép bevitelét a következő lépésben kapcsoljuk be.')}</div>
          </>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '16px', boxSizing: 'border-box', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', display: 'grid', placeItems: 'center' },
  card: { width: '100%', maxWidth: 520, padding: '20px', boxSizing: 'border-box', borderRadius: 18, background: '#ffffff', boxShadow: '0 12px 34px rgba(15, 23, 42, 0.12)' },
  back: { display: 'inline-block', marginBottom: 18, color: '#475569', textDecoration: 'none', fontWeight: 700 },
  brand: { color: '#64748b', fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '6px 0 8px', color: '#0f172a', fontSize: 28, overflowWrap: 'anywhere' },
  pageNumber: { marginBottom: 24, color: '#64748b', fontWeight: 700 },
  question: { margin: '0 0 18px', color: '#0f172a', fontSize: 21, textAlign: 'center' },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  primaryButton: { minHeight: 74, border: 0, borderRadius: 13, background: '#0f172a', color: '#ffffff', fontSize: 18, fontWeight: 800 },
  secondaryButton: { minHeight: 74, border: '2px solid #0f172a', borderRadius: 13, background: '#ffffff', color: '#0f172a', fontSize: 18, fontWeight: 800 },
  hint: { marginTop: 16, color: '#64748b', fontSize: 13, lineHeight: 1.45, textAlign: 'center' },
  message: { padding: 20, color: '#64748b', textAlign: 'center' },
  error: { padding: 14, borderRadius: 10, background: '#fef2f2', color: '#991b1b', textAlign: 'center' },
};
