import { useCallback, useEffect, useState } from 'react';
import { MemoryBookEditor, type PageData } from './MemoryBookEditor';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type InvitePageData = PageData & {
  bookId: string;
  bookTitle: string;
  inviteStatus: string;
};

type PageInviteEditorPageProps = {
  token: string;
};

export function PageInviteEditorPage({ token }: PageInviteEditorPageProps) {
  const [page, setPage] = useState<InvitePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/page-invites/${encodeURIComponent(token)}`
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (data?.error === 'PAGE_ALREADY_SUBMITTED') {
            throw new Error('PAGE_ALREADY_SUBMITTED');
          }
          throw new Error('PAGE_INVITE_LOAD_FAILED');
        }

        setPage(data);
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error && err.message === 'PAGE_ALREADY_SUBMITTED'
            ? 'Ez az oldal már be lett küldve, ezért nem szerkeszthető.'
            : 'Ez a meghívó nem érhető el.'
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  const savePage = useCallback(
    async (
      _pageId: string,
      canvasJson: Record<string, any>,
      previewDataUrl: string,
      expectedVersion: number
    ) => {
      const response = await fetch(
        `${API_BASE}/api/page-invites/${encodeURIComponent(token)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            canvasData: canvasJson,
            previewDataUrl,
            expectedVersion,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error: any = new Error(data?.error || 'PAGE_SAVE_FAILED');
        error.status = response.status;
        throw error;
      }

      setPage((current) =>
        current
          ? {
              ...current,
              version: data.newVersion,
              previewImageUrl: data.previewImageUrl,
              inviteStatus: 'draft',
            }
          : current
      );

      return { newVersion: data.newVersion };
    },
    [token]
  );

  if (loading) {
    return <div style={styles.message}>Meghívó betöltése...</div>;
  }

  if (error || !page) {
    return <div style={styles.message}>{error || 'Meghívó nem található.'}</div>;
  }

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{page.bookTitle}</h1>
        <div style={styles.subtitle}>
          A te oldalad: {page.pageNumber}. oldal
        </div>
        <p style={styles.note}>
          Ezzel a meghívóval csak ezt az egy oldalt tudod szerkeszteni. A módosítások automatikusan mentődnek.
        </p>
      </section>

      <MemoryBookEditor page={page} onSavePage={savePage} />
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e2e8f0',
    padding: '20px 12px 40px',
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
    color: '#334155',
    fontWeight: 800,
  },
  note: {
    margin: '10px 0 0',
    color: '#64748b',
    lineHeight: 1.5,
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};
