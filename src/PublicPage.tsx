import { useEffect, useState } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type PublicPageData = {
  bookTitle: string;
  id: string;
  pageNumber: number;
  previewImageUrl?: string | null;
  submittedAt?: string | null;
};

type PublicPageProps = {
  token: string;
};

export function PublicPage({ token }: PublicPageProps) {
  const [page, setPage] = useState<PublicPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/public-pages/${encodeURIComponent(token)}`
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.error || 'PUBLIC_PAGE_LOAD_FAILED');
        }

        setPage(data);
      } catch (err) {
        console.error(err);
        setError('Ez az oldal nem nyilvános vagy már nem érhető el.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  if (loading) {
    return <div style={styles.message}>Oldal betöltése...</div>;
  }

  if (error || !page) {
    return <div style={styles.message}>{error || 'Az oldal nem található.'}</div>;
  }

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{page.bookTitle}</h1>
        <div style={styles.subtitle}>Nyilvánosan megosztott oldal · {page.pageNumber}. oldal</div>
      </section>

      <section style={styles.viewer}>
        {page.previewImageUrl ? (
          <img
            src={page.previewImageUrl}
            alt={`MemoryBook ${page.pageNumber}. oldal`}
            style={styles.image}
          />
        ) : (
          <div style={styles.message}>Ehhez az oldalhoz nincs előnézeti kép.</div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e2e8f0',
    padding: '24px 12px 48px',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    maxWidth: 750,
    margin: '0 auto 18px',
    padding: '18px 20px',
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  brand: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    margin: '6px 0 4px',
    color: '#0f172a',
    fontSize: 26,
  },
  subtitle: {
    color: '#475569',
    fontSize: 14,
  },
  viewer: {
    width: 750,
    maxWidth: '100%',
    margin: '0 auto',
    background: '#ffffff',
    boxShadow: '0 10px 30px rgba(0,0,0,.12)',
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
    color: '#475569',
  },
};
