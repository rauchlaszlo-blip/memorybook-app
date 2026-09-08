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
  ownerVisibility?: 'active' | 'archived' | string;
  submittedAt?: string | null;
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

  const updateVisibility = async (
    page: OwnerPage,
    visibility: 'active' | 'archived'
  ) => {
    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/visibility`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ visibility }),
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.page) {
        throw new Error(data?.error || 'OWNER_PAGE_VISIBILITY_UPDATE_FAILED');
      }

      setPages((current) =>
        current.map((item) => (item.id === page.id ? data.page : item))
      );
    } catch (err) {
      console.error(err);
      setError('Nem sikerült módosítani az oldal állapotát.');
    } finally {
      setWorkingPageId(null);
    }
  };

  const deleteSubmittedPage = async (page: OwnerPage) => {
    const confirmed = window.confirm(
      `Biztosan végleg törlöd a(z) ${page.pageNumber}. oldal beküldött tartalmát?\n\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.`
    );

    if (!confirmed) return;

    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.page) {
        throw new Error(data?.error || 'OWNER_PAGE_DELETE_FAILED');
      }

      setPages((current) =>
        current.map((item) => (item.id === page.id ? data.page : item))
      );
    } catch (err) {
      console.error(err);
      setError('Nem sikerült törölni a beküldött oldalt.');
    } finally {
      setWorkingPageId(null);
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
              Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött
              oldalakat megtarthatod, archiválhatod vagy végleg törölheted.
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
              const isArchived = page.ownerVisibility === 'archived';
              const isWorking = workingPageId === page.id;

              return (
                <article
                  key={page.id}
                  style={
                    isArchived
                      ? { ...styles.card, ...styles.archivedCard }
                      : styles.card
                  }
                >
                  <div style={styles.cardTop}>
                    <strong style={styles.pageNumber}>Oldal {page.pageNumber}</strong>
                    <span style={styles.status}>
                      {displayStatusLabel(page)}
                    </span>
                  </div>

                  {isSubmitted ? (
                    <div>
                      <div style={styles.managementState}>
                        {isArchived
                          ? 'Elrejtve a könyvből, a tartalom megőrizve.'
                          : 'Könyvben marad.'}
                      </div>

                      <div style={styles.managementActions}>
                        <button
                          type="button"
                          onClick={() =>
                            updateVisibility(
                              page,
                              isArchived ? 'active' : 'archived'
                            )
                          }
                          disabled={isWorking}
                          style={styles.secondaryButton}
                        >
                          {isWorking
                            ? 'Folyamatban...'
                            : isArchived
                              ? 'Vissza a könyvbe'
                              : 'Elrejtés / archiválás'}
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteSubmittedPage(page)}
                          disabled={isWorking}
                          style={styles.dangerButton}
                        >
                          Végleges törlés
                        </button>
                      </div>
                    </div>
                  ) : !hasInvite ? (
                    <button
                      type="button"
                      onClick={() => createInvite(page)}
                      disabled={isWorking}
                      style={styles.primaryButton}
                    >
                      {isWorking ? 'Készül...' : 'Meghívó létrehozása'}
                    </button>
                  ) : (
                    <>
                      <div style={styles.inviteBox}>
                        {origin}/p/{page.inviteToken}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyInvite(page)}
                        disabled={isWorking}
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

function displayStatusLabel(page: OwnerPage) {
  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {
    return 'Archiválva';
  }

  return statusLabel(page.inviteStatus);
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
    maxWidth: 760,
    margin: 0,
    color: '#64748b',
    lineHeight: 1.5,
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
  archivedCard: {
    background: '#f8fafc',
    border: '1px dashed #94a3b8',
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
  managementState: {
    marginBottom: 12,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.45,
  },
  managementActions: {
    display: 'grid',
    gap: 8,
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
  secondaryButton: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
  },
  dangerButton: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fff7f7',
    color: '#b91c1c',
    fontWeight: 800,
    cursor: 'pointer',
  },
};
