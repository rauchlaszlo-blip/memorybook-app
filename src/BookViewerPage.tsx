import { useEffect, useRef, useState } from 'react';
import { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';
import type { AppLanguage } from './i18n';

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
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [coverPreviewImageUrl, setCoverPreviewImageUrl] = useState<string | null>(null);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerNote, setOwnerNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const isCover = currentIndex === 0;
  const totalItems = pageIds.length + 1;
  const currentPageId = isCover ? undefined : pageIds[currentIndex - 1];

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX === null) return;

    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) return;
    const distance = endX - startX;
    if (Math.abs(distance) < 50) return;

    setCurrentIndex((index) =>
      distance < 0
        ? Math.min(totalItems - 1, index + 1)
        : Math.max(0, index - 1)
    );
  };

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
        setCoverPreviewImageUrl(data.book?.coverPreviewImageUrl || null);
        setPage(null);
      } catch (err) {
        console.error(err);
        setError(t('A könyvet nem sikerült betölteni.'));
        setPageIds([]);
        setPage(null);
      } finally {
        setLoading(false);
      }
    };

    loadBookPages();
  }, [bookId]);

  useEffect(() => {
    if (isCover) {
      return;
    }
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
        setError(t('Az oldalt nem sikerült betölteni.'));
        setPage(null);
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, [currentPageId, isCover]);


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
      setError(t('A saját megjegyzést nem sikerült elmenteni.'));
    } finally {
      setNoteSaving(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <a href="/my-books" style={styles.backLink}>
          {t('← Saját könyveim')}
        </a>

        <div style={styles.eyebrow}>MemoryBook</div>
        <h1 style={styles.title}>{bookTitle}</h1>
        <div style={styles.topBar}>
          <div style={styles.pageNumber}>
            {isCover
              ? (language === 'de' ? `Cover · 1 / ${totalItems}` : language === 'en' ? `Cover · 1 / ${totalItems}` : `Fedőlap · 1 / ${totalItems}`)
              : f('{current} / {total} oldal', { current: currentIndex + 1, total: totalItems })}
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div
          style={styles.viewer}
          data-memory-content="true"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {!isCover && loading ? (
            <div style={styles.message}>{t('Oldal betöltése...')}</div>
          ) : isCover ? (
            coverPreviewImageUrl ? (
              <img src={coverPreviewImageUrl} alt={bookTitle} style={styles.image} />
            ) : (
              <div style={styles.defaultCover}>
                <div style={styles.coverBrand}>MemoryBook</div>
                <div style={styles.coverTitle}>{bookTitle}</div>
              </div>
            )
          ) : page?.previewImageUrl ? (
            <img
              src={page.previewImageUrl}
              alt={f('{page}. oldal', { page: page.pageNumber })}
              style={styles.image}
            />
          ) : (
            <div style={styles.emptyPage}>
              <div>{f('{page}. oldal', { page: currentIndex + 1 })}</div>
              <div style={styles.emptyText}>{t('Ehhez az oldalhoz nincs előnézeti kép.')}</div>
            </div>
          )}
        </div>

        {!loading && page && !isCover && (
          <section style={styles.identityPanel} data-memory-metadata="true">
            <div style={styles.identityEyebrow}>{t('Az emlék adatai')}</div>
            <h2 style={styles.identityTitle}>
              {page.inviteRecipientName || page.inviteRecipientEmail || t('Nincs azonosítva')}
            </h2>
            <div style={styles.identityGrid}>
              {page.inviteRecipientName && page.inviteRecipientEmail && (
                <div><span style={styles.identityLabel}>E-mail</span>{page.inviteRecipientEmail}</div>
              )}
              <div>
                <span style={styles.identityLabel}>{t('Küldési mód')}</span>
                {page.inviteDeliveryMethod === 'email'
                  ? 'E-mail'
                  : page.inviteDeliveryMethod === 'share'
                    ? t('Megosztás')
                    : t('Nincs rögzítve')}
              </div>
              <div>
                <span style={styles.identityLabel}>{t('Meghívás dátuma')}</span>
                {formatDate(page.inviteSentAt, language)}
              </div>
              <div>
                <span style={styles.identityLabel}>{t('Beküldés dátuma')}</span>
                {formatDate(page.submittedAt, language)}
              </div>
            </div>

            <label style={styles.noteLabel}>
              {t('Saját megjegyzés')}
              <textarea
                value={ownerNote}
                onChange={(event) => { setOwnerNote(event.target.value); setNoteSaved(false); }}
                maxLength={2000}
                rows={4}
                placeholder={t('Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…')}
                style={styles.noteInput}
              />
            </label>
            <button type="button" onClick={saveOwnerNote} disabled={noteSaving} style={styles.noteButton}>
              {noteSaving ? t('Mentés…') : noteSaved ? t('Megjegyzés elmentve') : t('Megjegyzés mentése')}
            </button>
            <div style={styles.printHint}>
              {t('Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.')}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function formatDate(value: string | null | undefined, language: AppLanguage) {
  if (!value) return ownerText(language, 'Nincs rögzítve');
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(ownerLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit' });
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
    justifyContent: 'center',
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
    overflow: 'visible',
    touchAction: 'pan-y',
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
  defaultCover: {
    width: '100%',
    height: '100%',
    padding: '10%',
    boxSizing: 'border-box',
    background: 'linear-gradient(145deg, #0f172a, #334155)',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  coverBrand: { marginBottom: 28, fontSize: 14, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.7 },
  coverTitle: { maxWidth: 620, fontSize: 'clamp(30px, 8vw, 58px)', lineHeight: 1.15, fontWeight: 800, overflowWrap: 'anywhere' },
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
