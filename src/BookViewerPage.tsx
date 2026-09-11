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
  inviteStatus?: string;
  eventGuestData?: {
    name?: string;
    email?: string;
    phone?: string;
    festivalId?: string;
    ticketId?: string;
  } | null;
  ownerNote?: string | null;
  canvasData?: {
    type?: string;
  };
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
  const [bookType, setBookType] = useState<'standard' | 'event' | 'dedication'>('standard');
  const [coverPreviewImageUrl, setCoverPreviewImageUrl] = useState<string | null>(null);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerNote, setOwnerNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [ownMemoryOpening, setOwnMemoryOpening] = useState(false);
  const touchStartXRef = useRef<number | null>(null);
  const suppressCoverClickRef = useRef(false);

  const isCover = currentIndex === 0;
  const totalItems = pageIds.length + 1;
  const currentPageId = isCover ? undefined : pageIds[currentIndex - 1];
  const guestData = page?.eventGuestData || {};

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    suppressCoverClickRef.current = false;
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
    suppressCoverClickRef.current = true;

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
        const statusOrder: Record<string, number> = {
          submitted: 0,
          owner: 0,
          draft: 1,
          invited: 2,
          empty: 3,
        };
        const loadedBookType = data.book?.bookType === 'dedication'
          ? 'dedication'
          : data.book?.bookType === 'event'
            ? 'event'
            : 'standard';
        const visiblePages = Array.isArray(data.pages)
          ? data.pages
              .filter(
                (item: BookPageSummary) =>
                  item.ownerVisibility !== 'archived' &&
                  item.inviteStatus !== 'owner_draft' &&
                  (loadedBookType !== 'event' || ['submitted', 'owner'].includes(item.inviteStatus))
              )
              .sort((a: BookPageSummary, b: BookPageSummary) => {
                const statusDifference =
                  (statusOrder[a.inviteStatus] ?? 4) -
                  (statusOrder[b.inviteStatus] ?? 4);
                return statusDifference || a.pageNumber - b.pageNumber;
              })
          : [];
        const ids = visiblePages.map((item: BookPageSummary) => String(item.id));

        setPageIds(ids);
        setBookTitle(data.book?.title || 'MemoryBook');
        setBookType(loadedBookType);
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

  const openOwnMemory = async () => {
    if (ownMemoryOpening) return;
    try {
      setOwnMemoryOpening(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/own-memory`,
        { method: 'POST', credentials: 'include' }
      );
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pageId) throw new Error(data.error || 'OWNER_MEMORY_OPEN_FAILED');
      window.location.href = `/my-books/${encodeURIComponent(bookId)}/memory/${encodeURIComponent(data.pageId)}`;
    } catch (err) {
      console.error(err);
      setError(t('A saját emléklapot nem sikerült megnyitni.'));
      setOwnMemoryOpening(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.viewerStage}>
        <div style={styles.bookActions}>
          <a href="/my-books" style={styles.backLink}>
            {t('← Saját könyveim')}
          </a>
          <a href={`/my-books/${encodeURIComponent(bookId)}?nextEmpty=1`} style={styles.inviteLink}>
            {language === 'de' ? 'Einladen' : language === 'en' ? 'Invite' : 'Meghívó'}
          </a>
        </div>
          <div style={styles.pageNumber}>
            {isCover
              ? (language === 'de' ? `Cover · 1 / ${totalItems}` : language === 'en' ? `Cover · 1 / ${totalItems}` : `Fedőlap · 1 / ${totalItems}`)
              : f('{current} / {total} oldal', { current: currentIndex + 1, total: totalItems })}
          </div>
          <div className="book-navigation-arrows" style={styles.topBar}>
            <button
              type="button"
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
              disabled={currentIndex === 0 || loading}
              style={{ ...styles.arrowButton, ...styles.arrowLeft }}
              aria-label={t('Előző oldal')}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setCurrentIndex((index) => Math.min(totalItems - 1, index + 1))}
              disabled={loading || currentIndex === totalItems - 1}
              style={{ ...styles.arrowButton, ...styles.arrowRight }}
              aria-label={t('Következő oldal')}
            >
              →
            </button>
          </div>
        <div
          style={isCover ? { ...styles.viewer, ...styles.editableCover } : styles.viewer}
          data-memory-content="true"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={() => {
            if (suppressCoverClickRef.current) {
              suppressCoverClickRef.current = false;
              return;
            }
            if (isCover) window.location.href = `/my-books/${encodeURIComponent(bookId)}/cover`;
          }}
          onKeyDown={(event) => {
            if (isCover && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              window.location.href = `/my-books/${encodeURIComponent(bookId)}/cover`;
            }
          }}
          role={isCover ? 'button' : undefined}
          tabIndex={isCover ? 0 : undefined}
          aria-label={isCover ? (language === 'de' ? 'Cover bearbeiten' : language === 'en' ? 'Edit cover' : 'Fedőlap szerkesztése') : undefined}
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
        </div>

        {!loading && bookType === 'standard' && (
          <button type="button" onClick={openOwnMemory} disabled={ownMemoryOpening} style={styles.ownMemoryButton}>
            {ownMemoryOpening ? t('Megnyitás…') : t('Saját emlék létrehozása')}
          </button>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {!loading && page && !isCover && (
          <section style={styles.identityPanel} data-memory-metadata="true">
            {bookType === 'dedication' && page.canvasData?.type === 'dedication' && (
              <a
                href={`/my-books/${encodeURIComponent(bookId)}/dedication/${encodeURIComponent(page.id)}`}
                style={styles.editSignatureLink}
              >
                {t('Aláírás szerkesztése')}
              </a>
            )}
            <div style={styles.identityEyebrow}>{t('Az emlék adatai')}</div>
            {bookType !== 'event' && (
              <h2 style={styles.identityTitle}>
                {page.inviteStatus === 'owner' ? t('Saját emlék') : page.inviteRecipientName || page.inviteRecipientEmail || t('Nincs azonosítva')}
              </h2>
            )}
            <div style={styles.identityGrid}>
              {guestData.name && (
                <div><span style={styles.identityLabel}>{t('Név')}</span>{guestData.name}</div>
              )}
              {guestData.email && (
                <div><span style={styles.identityLabel}>E-mail</span>{guestData.email}</div>
              )}
              {guestData.phone && (
                <div><span style={styles.identityLabel}>{t('Telefonszám')}</span>{guestData.phone}</div>
              )}
              {guestData.festivalId && (
                <div><span style={styles.identityLabel}>{t('Fesztiválazonosító')}</span>{guestData.festivalId}</div>
              )}
              {guestData.ticketId && (
                <div><span style={styles.identityLabel}>{t('Belépőjegy-azonosító')}</span>{guestData.ticketId}</div>
              )}
              {page.inviteRecipientName && page.inviteRecipientEmail && (
                <div><span style={styles.identityLabel}>E-mail</span>{page.inviteRecipientEmail}</div>
              )}
              {bookType !== 'event' && page.inviteStatus !== 'owner' && (
                <>
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
                </>
              )}
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
    color: '#475569',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 700,
  },
  bookActions: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: 0, zIndex: 4 },
  inviteLink: { minHeight: 38, padding: '7px 11px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', borderRadius: 8, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontSize: 14, fontWeight: 800 },
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
  viewerStage: { position: 'relative', width: '100%', maxWidth: 760, margin: '0 auto', paddingTop: 48, boxSizing: 'border-box' },
  topBar: { position: 'absolute', top: 48, bottom: 0, left: 0, right: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' },
  arrowButton: { pointerEvents: 'auto', width: 48, height: 64, border: '1px solid #cbd5e1', borderRadius: 12, background: 'rgba(255,255,255,0.92)', color: '#0f172a', fontSize: 30, lineHeight: 1, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 12px rgba(15,23,42,0.16)', touchAction: 'manipulation' },
  arrowLeft: { marginLeft: -2 },
  arrowRight: { marginRight: -2 },
  pageNumber: { maxWidth: 640, margin: '0 auto 6px', color: '#334155', fontSize: 14, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' },
  viewer: {
    width: 'min(100%, 560px, calc(70.5svh - 120px))',
    height: 'auto',
    maxWidth: 640,
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
  editableCover: { cursor: 'pointer' },
  editSignatureLink: { display: 'flex', minHeight: 46, marginBottom: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontSize: 16, fontWeight: 800 },
  ownMemoryButton: { display: 'block', width: 'min(100%, 560px)', minHeight: 46, margin: '12px auto 0', padding: '10px 14px', border: 0, borderRadius: 10, background: '#0f172a', color: '#ffffff', fontSize: 15, fontWeight: 800 },
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
