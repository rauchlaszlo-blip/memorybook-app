import { useEffect, useState } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type PageData = {
  id: string;
  pageNumber: number;
  previewImageUrl?: string | null;
  version: number;
  inviteSentAt?: string | null;
  inviteRecipientName?: string | null;
  inviteRecipientEmail?: string | null;
  inviteDeliveryMethod?: string | null;
  submittedAt?: string | null;
  ownerNote?: string | null;
};

type BookPageSummary = {
  id: string;
  pageNumber: number;
  version: number;
  inviteStatus: string;
  ownerVisibility?: string;
};

type BookViewerPageProps = {
  bookId: string;
};

export function BookViewerPage({ bookId }: BookViewerPageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerNote, setOwnerNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const currentPageId = pageIds[currentIndex];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentIndex]);

  useEffect(() => {
    const loadBookPages = async () => {
      try {
        setLoading(true);
        setError(null);
        setCurrentIndex(0);

        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`,
          { credentials: 'include' }
        );

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('BOOK_PAGES_LOAD_FAILED');
        }

        const data = await response.json();
        const visiblePages = Array.isArray(data.pages)
          ? data.pages
              .filter(
                (item: BookPageSummary) =>
                  item.inviteStatus === 'submitted' &&
                  item.ownerVisibility !== 'archived'
              )
              .sort(
                (a: BookPageSummary, b: BookPageSummary) =>
                  a.pageNumber - b.pageNumber
              )
          : [];
        const ids = visiblePages.map((item: BookPageSummary) => String(item.id));

        setPageIds(ids);
        setBookTitle(data.book?.title || 'MemoryBook');
        setPage(null);
      } catch (err) {
        console.error(err);
        setError('A könyvet nem sikerült betölteni.');
        setPageIds([]);
        setPage(null);
      } finally {
        setLoading(false);
      }
    };

    loadBookPages();
  }, [bookId]);

  useEffect(() => {
    if (!currentPageId) {
      return;
    }

    const loadPage = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/pages/${encodeURIComponent(currentPageId)}`,
          { credentials: 'include' }
        );

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('PAGE_LOAD_FAILED');
        }

        const data = await response.json();
        setPage(data);
        setOwnerNote(data.ownerNote || '');
        setNoteSaved(false);
      } catch (err) {
        console.error(err);
        setError('Az oldalt nem sikerült betölteni.');
        setPage(null);
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, [currentPageId]);


  const saveOwnerNote = async () => {
    if (!page) return;
    try {
      setNoteSaving(true);
      setNoteSaved(false);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/memory-note`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerNote }),
        }
      );
      if (!response.ok) throw new Error('OWNER_NOTE_SAVE_FAILED');
      const data = await response.json();
      setPage((current) => current ? { ...current, ownerNote: data.ownerNote || null } : current);
      setOwnerNote(data.ownerNote || '');
      setNoteSaved(true);
    } catch (err) {
      console.error(err);
      setError('A saját megjegyzést nem sikerült elmenteni.');
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <a href="/my-books" style={styles.backLink}>
          ← Saját könyveim
        </a>

        <div style={styles.eyebrow}>MemoryBook</div>
        <h1 style={styles.title}>{bookTitle}</h1>
        <div style={styles.meta}>Csak olvasható könyvnézet</div>

        <div style={styles.topBar}>
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((index) => Math.max(0, index - 1))
            }
            disabled={currentIndex === 0 || pageIds.length === 0}
            style={styles.button}
            aria-label="Előző oldal"
          >
            ← Előző
          </button>

          <div style={styles.pageNumber}>
            {pageIds.length > 0
              ? `${currentIndex + 1} / ${pageIds.length} oldal`
              : 'Nincs oldal'}
          </div>

          <button
            type="button"
            onClick={() =>
              setCurrentIndex((index) =>
                Math.min(pageIds.length - 1, index + 1)
              )
            }
            disabled={
              pageIds.length === 0 ||
              currentIndex === pageIds.length - 1
            }
            style={styles.button}
            aria-label="Következő oldal"
          >
            Következő →
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.viewer} data-memory-content="true">
          {loading ? (
            <div style={styles.message}>Oldal betöltése...</div>
          ) : pageIds.length === 0 ? (
            <div style={styles.emptyPage}>
              <div>Még nincs beküldött oldal ebben a könyvben.</div>
            </div>
          ) : page?.previewImageUrl ? (
            <img
              src={page.previewImageUrl}
              alt={`${page.pageNumber}. oldal`}
              style={styles.image}
            />
          ) : (
            <div style={styles.emptyPage}>
              <div>{currentIndex + 1}. oldal</div>
              <div style={styles.emptyText}>Ehhez az oldalhoz nincs előnézeti kép.</div>
            </div>
          )}
        </div>

        {!loading && page && (
          <section style={styles.identityPanel} data-memory-metadata="true">
            <div style={styles.identityEyebrow}>Az emlék adatai</div>
            <h2 style={styles.identityTitle}>
              {page.inviteRecipientName || page.inviteRecipientEmail || 'Nincs azonosítva'}
            </h2>
            <div style={styles.identityGrid}>
              {page.inviteRecipientName && page.inviteRecipientEmail && (
                <div><span style={styles.identityLabel}>E-mail</span>{page.inviteRecipientEmail}</div>
              )}
              <div>
                <span style={styles.identityLabel}>Küldési mód</span>
                {page.inviteDeliveryMethod === 'email'
                  ? 'E-mail'
                  : page.inviteDeliveryMethod === 'share'
                    ? 'Megosztás'
                    : 'Nincs rögzítve'}
              </div>
              <div>
                <span style={styles.identityLabel}>Meghívás dátuma</span>
                {formatDate(page.inviteSentAt)}
              </div>
              <div>
                <span style={styles.identityLabel}>Beküldés dátuma</span>
                {formatDate(page.submittedAt)}
              </div>
            </div>

            <label style={styles.noteLabel}>
              Saját megjegyzés
              <textarea
                value={ownerNote}
                onChange={(event) => { setOwnerNote(event.target.value); setNoteSaved(false); }}
                maxLength={2000}
                rows={4}
                placeholder="Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…"
                style={styles.noteInput}
              />
            </label>
            <button type="button" onClick={saveOwnerNote} disabled={noteSaving} style={styles.noteButton}>
              {noteSaving ? 'Mentés…' : noteSaved ? 'Megjegyzés elmentve' : 'Megjegyzés mentése'}
            </button>
            <div style={styles.printHint}>
              Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function formatDate(value?: string | null) {
  if (!value) return 'Nincs rögzítve';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e2e8f0',
    padding: '12px 12px 28px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: {
    width: '100%',
    maxWidth: 850,
    margin: '0 auto',
  },
  backLink: {
    display: 'inline-block',
    margin: '2px 0 12px',
    color: '#475569',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 700,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#64748b',
  },
  title: {
    margin: '6px 0 4px',
    color: '#0f172a',
    fontSize: 'clamp(24px, 7vw, 34px)',
    lineHeight: 1.15,
    overflowWrap: 'anywhere',
  },
  meta: {
    marginBottom: 12,
    color: '#64748b',
    fontSize: 13,
  },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    width: '100%',
    maxWidth: 750,
    margin: '0 auto 12px',
    padding: '8px 0',
    background: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    boxSizing: 'border-box',
  },
  button: {
    minHeight: 44,
    minWidth: 92,
    padding: '8px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    background: 'white',
    color: '#0f172a',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  pageNumber: {
    flex: 1,
    minWidth: 0,
    color: '#334155',
    fontSize: 14,
    fontWeight: 700,
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  viewer: {
    width: '100%',
    maxWidth: 750,
    aspectRatio: '750 / 1064',
    margin: '0 auto',
    background: 'white',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  message: {
    padding: 20,
    color: '#64748b',
    fontSize: 16,
    textAlign: 'center',
  },
  emptyPage: {
    width: '100%',
    height: '100%',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    color: '#94a3b8',
    fontSize: 18,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 8,
    fontSize: 14,
  },
  error: {
    maxWidth: 750,
    margin: '0 auto 12px',
    padding: 12,
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: 8,
  },
  identityPanel: {
    width: '100%',
    maxWidth: 750,
    margin: '16px auto 0',
    padding: 16,
    boxSizing: 'border-box',
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
  },
  identityEyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 },
  identityTitle: { margin: '6px 0 14px', color: '#0f172a', fontSize: 21, overflowWrap: 'anywhere' },
  identityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12, color: '#334155', fontSize: 14, lineHeight: 1.45 },
  identityLabel: { display: 'block', marginBottom: 3, color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' },
  noteLabel: { display: 'block', marginTop: 16, color: '#334155', fontSize: 13, fontWeight: 800 },
  noteInput: { width: '100%', marginTop: 6, padding: 12, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 16, lineHeight: 1.45, resize: 'vertical' },
  noteButton: { width: '100%', minHeight: 46, marginTop: 10, padding: '10px 14px', border: 0, borderRadius: 9, background: '#0f172a', color: '#ffffff', fontSize: 14, fontWeight: 800 },
  printHint: { marginTop: 10, color: '#64748b', fontSize: 12, lineHeight: 1.45 },
};
