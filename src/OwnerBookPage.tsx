import { useEffect, useMemo, useState } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type OwnerPage = {
  id: string;
  pageNumber: number;
  version: number;
  inviteStatus: 'empty' | 'invited' | 'draft' | 'submitted' | string;
  inviteToken?: string | null;
  updatedAt?: string;
};

type OwnerBookPageProps = {
  bookId: string;
};

export function OwnerBookPage({ bookId }: OwnerBookPageProps) {
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [pages, setPages] = useState<OwnerPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingPageId, setWorkingPageId] = useState<string | null>(null);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);

  const origin = useMemo(() => window.location.origin, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`,
          { credentials: 'include' }
        );

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('OWNER_PAGE_LIST_LOAD_FAILED');
        }

        const data = await response.json();
        setBookTitle(data.book?.title || 'MemoryBook');
        setPages(Array.isArray(data.pages) ? data.pages : []);
      } catch (err) {
        console.error(err);
        setError('Nem sikerült betölteni a könyv oldalait.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookId]);

  const createInvite = async (page: OwnerPage) => {
    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'PAGE_INVITE_CREATE_FAILED');
      }

      setPages((current) =>
        current.map((item) =>
          item.id === page.id
            ? {
                ...item,
                inviteToken: data.inviteToken,
                inviteStatus:
                  item.inviteStatus === 'empty' ? 'invited' : item.inviteStatus,
              }
            : item
        )
      );
    } catch (err) {
      console.error(err);
      setError('Nem sikerült létrehozni a meghívót.');
    } finally {
      setWorkingPageId(null);
    }
  };

  const copyInvite = async (page: OwnerPage) => {
    if (!page.inviteToken) return;

    const url = `${origin}/p/${page.inviteToken}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedPageId(page.id);
      window.setTimeout(() => setCopiedPageId(null), 1800);
    } catch (err) {
      console.error(err);
      window.prompt('Másold ki a meghívó linket:', url);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.topRow}>
          <div>
            <a href="/my-books" style={styles.backLink}>← Saját könyveim</a>
            <div style={styles.brand}>MemoryBook</div>
            <h1 style={styles.title}>{bookTitle}</h1>
            <p style={styles.subtitle}>
              Minden meghívó egyetlen konkrét oldalhoz tartozik.
            </p>
          </div>
        </div>

        {loading && <div style={styles.panel}>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && (
          <div style={styles.grid}>
            {pages.map((page) => {
              const hasInvite = Boolean(page.inviteToken);
              const isSubmitted = page.inviteStatus === 'submitted';

              return (
                <article key={page.id} style={styles.card}>
                  <div style={styles.cardTop}>
                    <strong style={styles.pageNumber}>Oldal {page.pageNumber}</strong>
                    <span style={styles.status}>{statusLabel(page.inviteStatus)}</span>
                  </div>

                  {!hasInvite ? (
                    <button
                      type="button"
                      onClick={() => createInvite(page)}
                      disabled={workingPageId === page.id || isSubmitted}
                      style={styles.primaryButton}
                    >
                      {workingPageId === page.id
                        ? 'Készül...'
                        : 'Meghívó létrehozása'}
                    </button>
                  ) : (
                    <>
                      <div style={styles.inviteBox}>
                        {origin}/p/{page.inviteToken}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyInvite(page)}
                        style={styles.primaryButton}
                      >
                        {copiedPageId === page.id
                          ? 'Link kimásolva'
                          : 'Meghívó link másolása'}
                      </button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case 'empty':
      return 'Üres';
    case 'invited':
      return 'Meghívva';
    case 'draft':
      return 'Szerkesztés alatt';
    case 'submitted':
      return 'Beküldve';
    default:
      return status;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '24px 18px 48px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: {
    maxWidth: 1050,
    margin: '0 auto',
  },
  topRow: {
    marginBottom: 24,
  },
  backLink: {
    display: 'inline-block',
    marginBottom: 16,
    color: '#475569',
    textDecoration: 'none',
    fontWeight: 700,
  },
  brand: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    margin: '6px 0',
    color: '#0f172a',
    fontSize: 32,
  },
  subtitle: {
    margin: 0,
    color: '#64748b',
  },
  panel: {
    padding: 24,
    borderRadius: 14,
    background: '#ffffff',
  },
  error: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    background: '#fef2f2',
    color: '#991b1b',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
    gap: 14,
  },
  card: {
    padding: 18,
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.07)',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  pageNumber: {
    color: '#0f172a',
    fontSize: 18,
  },
  status: {
    padding: '5px 8px',
    borderRadius: 999,
    background: '#e2e8f0',
    color: '#475569',
    fontSize: 12,
    fontWeight: 700,
  },
  inviteBox: {
    overflow: 'hidden',
    marginBottom: 10,
    padding: 9,
    borderRadius: 8,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 12,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  primaryButton: {
    width: '100%',
    padding: '10px 12px',
    border: 0,
    borderRadius: 8,
    background: '#0f172a',
    color: '#ffffff',
    fontWeight: 800,
    cursor: 'pointer',
  },
};
