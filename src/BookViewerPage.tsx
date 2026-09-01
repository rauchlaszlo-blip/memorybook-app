import { useEffect, useState } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://' + window.location.hostname + ':3001' : '';
const PAGE_IDS = ['page-1', 'page-2'];

type PageData = {
  id: string;
  pageNumber: number;
  previewImageUrl?: string | null;
  version: number;
};

type BookViewerPageProps = {
  bookId: string;
};

export function BookViewerPage({ bookId }: BookViewerPageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentPageId = PAGE_IDS[currentIndex];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentIndex]);

  useEffect(() => {
    const loadPage = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/pages/${encodeURIComponent(currentPageId)}`
        );

        if (!response.ok) {
          throw new Error('PAGE_LOAD_FAILED');
        }

        const data = await response.json();
        setPage(data);
      } catch (err) {
        console.error(err);
        setError('This page could not be loaded.');
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, [currentPageId]);

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.topBar}>
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((index) => Math.max(0, index - 1))
            }
            disabled={currentIndex === 0}
            style={styles.button}
          >
            Previous
          </button>

          <div style={styles.pageNumber}>
            Page {currentIndex + 1} / {PAGE_IDS.length}
          </div>

          <button
            type="button"
            onClick={() =>
              setCurrentIndex((index) =>
                Math.min(PAGE_IDS.length - 1, index + 1)
              )
            }
            disabled={currentIndex === PAGE_IDS.length - 1}
            style={styles.button}
          >
            Next
          </button>
        </div>

        <div style={styles.eyebrow}>MemoryBook</div>
        <h1 style={styles.title}>12.B – Our Last Year</h1>

        <div style={styles.meta}>
          Read-only book view · {bookId}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.viewer}>
          {loading ? (
            <div style={styles.message}>Loading page...</div>
          ) : page?.previewImageUrl ? (
            <img
              src={`${API_BASE}${page.previewImageUrl}`}
              alt={`Page ${page.pageNumber}`}
              style={styles.image}
            />
          ) : (
            <div style={styles.emptyPage}>
              <div>Page {currentIndex + 1}</div>
              <div style={styles.emptyText}>This page is empty.</div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e2e8f0',
    padding: '24px 20px 40px',
    fontFamily: 'Arial, sans-serif',
  },
  container: {
    maxWidth: 850,
    margin: '0 auto',
  },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    maxWidth: 750,
    margin: '0 auto 24px',
    padding: '10px 14px',
    background: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  button: {
    padding: '10px 18px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: 'white',
    color: '#0f172a',
    fontWeight: 700,
    cursor: 'pointer',
  },
  pageNumber: {
    color: '#334155',
    fontWeight: 700,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#64748b',
  },
  title: {
    margin: '8px 0 6px',
    color: '#0f172a',
  },
  meta: {
    marginBottom: 20,
    color: '#64748b',
    fontSize: 14,
  },
  viewer: {
    width: 750,
    maxWidth: '100%',
    minHeight: 1000,
    margin: '0 auto',
    background: 'white',
    boxShadow: '0 12px 35px rgba(15, 23, 42, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
  },
  message: {
    color: '#64748b',
    fontSize: 18,
  },
  emptyPage: {
    width: '100%',
    minHeight: 1000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#94a3b8',
    fontSize: 22,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
  },
  error: {
    maxWidth: 750,
    margin: '0 auto 16px',
    padding: 12,
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
  },
};
