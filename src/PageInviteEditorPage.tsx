import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MemoryBookEditor,
  type MemoryBookEditorRef,
  type PageData,
} from './MemoryBookEditor';

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
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [page, setPage] = useState<InvitePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [authorShareApproved, setAuthorShareApproved] = useState(false);

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

  const submitPage = async () => {
    if (submitting) return;

    const confirmed = window.confirm(
      'Beküldés után ezt az oldalt már nem tudod módosítani. Biztosan beküldöd?'
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError(null);

      await editorRef.current?.flush();

      const response = await fetch(
        `${API_BASE}/api/page-invites/${encodeURIComponent(token)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ authorShareApproved }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data?.error === 'PAGE_ALREADY_SUBMITTED') {
          setSubmitted(true);
          return;
        }
        throw new Error(data?.error || 'PAGE_SUBMIT_FAILED');
      }

      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && err.message === 'PAGE_CONFLICT'
          ? 'Az oldal közben megváltozott. Frissítsd az oldalt, majd próbáld újra.'
          : 'A beküldés nem sikerült. A szerkesztés még nincs lezárva.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <main style={styles.page}>
        <section style={styles.header}>
          <div style={styles.brand}>MemoryBook</div>
          <h1 style={styles.title}>{page?.bookTitle || 'MemoryBook'}</h1>
          <div style={styles.successBox}>Az oldalad elküldve. Köszönjük!</div>
          <p style={styles.note}>
            A beküldött oldal már nem módosítható ezen a meghívón keresztül.
          </p>
          <p style={styles.note}>
            {authorShareApproved
              ? 'Hozzájárultál a nyilvános megosztáshoz. Az oldal csak akkor válik nyilvánossá, ha a könyv tulajdonosa is jóváhagyja.'
              : 'Nem adtál engedélyt nyilvános megosztásra.'}
          </p>
        </section>
      </main>
    );
  }

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
        <div style={styles.subtitle}>A te oldalad: {page.pageNumber}. oldal</div>
        <p style={styles.note}>
          Ezzel a meghívóval csak ezt az egy oldalt tudod szerkeszteni. A módosítások automatikusan mentődnek.
        </p>
        <label style={styles.shareConsent}>
          <input
            type="checkbox"
            checked={authorShareApproved}
            onChange={(event) => setAuthorShareApproved(event.target.checked)}
          />
          <span>
            Hozzájárulok ahhoz, hogy ezt az oldalt nyilvánosan is meg lehessen osztani.
            A nyilvános megosztáshoz a könyv tulajdonosának külön jóváhagyása is szükséges.
          </span>
        </label>
        <div style={styles.submitArea}>
          <button
            type="button"
            onClick={submitPage}
            disabled={submitting}
            style={styles.submitButton}
          >
            {submitting ? 'Beküldés...' : 'Oldal beküldése'}
          </button>
          <div style={styles.submitWarning}>
            Beküldés után az oldal végleg lezárul számodra.
          </div>
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </section>

      <MemoryBookEditor ref={editorRef} page={page} onSavePage={savePage} />
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
  shareConsent: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.45,
    cursor: 'pointer',
  },
  submitArea: {
    marginTop: 16,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  submitButton: {
    padding: '11px 16px',
    border: 0,
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
  },
  submitWarning: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: 700,
  },
  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
  },
  successBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    background: '#ecfdf5',
    color: '#065f46',
    fontWeight: 800,
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};
