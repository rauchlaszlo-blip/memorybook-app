import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { NotificationMenu } from './NotificationMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getAppLanguage, type AppLanguage } from './i18n';
import { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type BookSummary = {
  id: string;
  title: string;
  pageCount: number;
  contributionCount: number;
  bookType?: 'standard' | 'event' | string;
  language?: AppLanguage;
  coverPreviewImageUrl?: string | null;
  createdAt: string;
};
type Entitlement = {
  id: string;
  bookType: 'standard' | 'event' | string;
  includedPages: number;
  status: 'available' | 'redeemed' | 'revoked' | string;
  wasGift?: boolean;
};

export function MyBooksPage() {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [selectedEntitlementId, setSelectedEntitlementId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const availableEntitlements = useMemo(
    () => entitlements.filter((item) => item.status === 'available'),
    [entitlements]
  );

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const meResponse = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
        if (meResponse.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!meResponse.ok) throw new Error('SESSION_LOAD_FAILED');
        await meResponse.json();

        const [booksResponse, entitlementsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/my/books`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/my/entitlements`, { credentials: 'include' }),
        ]);
        if (!booksResponse.ok || !entitlementsResponse.ok) throw new Error('OWNER_DATA_LOAD_FAILED');
        const booksData = await booksResponse.json();
        const entitlementData = await entitlementsResponse.json();
        setBooks(Array.isArray(booksData.books) ? booksData.books : []);
        const nextEntitlements = Array.isArray(entitlementData.entitlements)
          ? entitlementData.entitlements
          : [];
        setEntitlements(nextEntitlements);
        const firstAvailable = nextEntitlements.find((item: Entitlement) => item.status === 'available');
        setSelectedEntitlementId(firstAvailable?.id || '');
      } catch (err) {
        console.error(err);
        setError(t('Nem sikerült betölteni a könyveidet.'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const createBook = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    const title = newBookTitle.trim();
    if (!title) {
      setCreateError(t('Adj nevet az emlékkönyvnek.'));
      return;
    }
    if (!selectedEntitlementId) {
      setCreateError(t('A könyv létrehozásához felhasználható vásárlási jogosultság kell.'));
      return;
    }

    try {
      setCreating(true);
      const response = await fetch(`${API_BASE}/api/my/books`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          entitlementId: selectedEntitlementId,
          language: getAppLanguage(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'BOOK_CREATE_FAILED');
      if (data.book) setBooks((current) => [data.book, ...current]);
      setEntitlements((current) =>
        current.map((item) =>
          item.id === selectedEntitlementId ? { ...item, status: 'redeemed' } : item
        )
      );
      setNewBookTitle('');
      const remaining = availableEntitlements.find((item) => item.id !== selectedEntitlementId);
      setSelectedEntitlementId(remaining?.id || '');
    } catch (err: any) {
      console.error(err);
      setCreateError(
        err?.message === 'BOOK_ENTITLEMENT_REQUIRED'
          ? t('A könyv létrehozásához vásárlási jogosultság szükséges.')
          : t('Nem sikerült létrehozni az emlékkönyvet.')
      );
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/sign-out`, { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <main style={styles.page}>
      <style>{`
        .my-books-grid {
          width: min(100%, 660px);
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 300px));
          justify-content: center;
          gap: 24px;
        }
        .my-books-cover-link {
          display: block;
          width: 100%;
          text-decoration: none;
        }
        @media (max-width: 700px) {
          .my-books-grid {
            width: 100%;
            grid-template-columns: minmax(0, min(72%, 300px));
            gap: 18px;
          }
        }
      `}</style>
      <section style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>MemoryBook</div>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>{t('Saját könyveim')}</h1>
            </div>
          </div>
          <div style={styles.headerActions}>
            <a href="/purchase" style={styles.headerPurchaseLink}>{t('Új könyv vásárlása')}</a>
            <LanguageSwitcher compact />
            <button type="button" onClick={signOut} style={styles.secondaryButton}>{t('Kijelentkezés')}</button>
            <NotificationMenu />
          </div>
        </header>

        {!loading && !error && availableEntitlements.length > 0 && (
          <section style={styles.createCard}>
            <h2 style={styles.createTitle}>{t('Új emlékkönyv létrehozása')}</h2>
            <form onSubmit={createBook} style={styles.createForm}>
                  <select
                    value={selectedEntitlementId}
                    onChange={(event) => setSelectedEntitlementId(event.target.value)}
                    disabled={creating}
                    style={styles.select}
                    aria-label={t('Vásárlási jogosultság')}
                  >
                    {availableEntitlements.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.bookType === 'event'
                          ? t('QR-kódos vendégkönyv')
                          : item.bookType === 'dedication'
                            ? f('Dedikálás – {count} oldal', { count: item.includedPages })
                            : f('Normál emlékkönyv – {count} oldal', { count: item.includedPages })}
                        {item.wasGift ? ` ${t('· ajándék')}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newBookTitle}
                    onChange={(event) => setNewBookTitle(event.target.value)}
                    placeholder={t('Például: Anna 40. születésnapja')}
                    maxLength={120}
                    disabled={creating}
                    style={styles.input}
                  />
                  <button type="submit" disabled={creating} style={styles.createButton}>
                    {creating ? t('Létrehozás...') : t('Emlékkönyv létrehozása')}
                  </button>
            </form>
            {createError && <div style={styles.createError}>{createError}</div>}
          </section>
        )}

        {loading && <div style={styles.panel}>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && books.length === 0 && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>{t('Még nincs emlékkönyved')}</h2>
          </div>
        )}

        {!loading && !error && books.length > 0 && (
          <div className="my-books-grid">
            {books.map((book) => {
              const openPath = `/book/${encodeURIComponent(book.id)}/view`;
              return (
                  <a key={book.id} href={openPath} className="my-books-cover-link" aria-label={`${book.title} – ${t('Könyv megnyitása')}`}>
                    {book.coverPreviewImageUrl ? (
                      <img src={book.coverPreviewImageUrl} alt={book.title} style={styles.coverImage} />
                    ) : (
                      <div style={styles.defaultCover}>
                        <div style={styles.defaultCoverBrand}>MemoryBook</div>
                        <div style={styles.defaultCoverTitle}>{book.title}</div>
                      </div>
                    )}
                  </a>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '24px 18px 48px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  container: { width: '100%', maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  headerActions: { width: '100%', display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 6 },
  brand: { fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: '#64748b' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title: { margin: '6px 0 4px', fontSize: 32, color: '#0f172a' },
  headerPurchaseLink: { minHeight: 40, padding: '6px 8px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', borderRadius: 8, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap' },
  secondaryButton: { minHeight: 40, padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#334155', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
  createCard: { marginBottom: 22, padding: 20, background: '#ffffff', borderRadius: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' },
  createTitle: { margin: '0 0 5px', color: '#0f172a', fontSize: 21 },
  createText: { margin: '0 0 16px', color: '#64748b', lineHeight: 1.5 },
  createForm: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  select: { flex: '1 1 240px', minHeight: 46, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 15, background: '#ffffff', boxSizing: 'border-box' },
  input: { flex: '1 1 280px', minWidth: 0, minHeight: 46, padding: '12px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 16, boxSizing: 'border-box' },
  createButton: { minHeight: 46, border: 0, borderRadius: 9, padding: '12px 16px', background: '#0f172a', color: '#ffffff', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  createError: { marginTop: 12, padding: 11, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 14 },
  purchaseLink: { display: 'inline-flex', alignItems: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800 },
  purchaseMore: { marginTop: 14, fontSize: 14 },
  panel: { padding: 24, background: '#ffffff', borderRadius: 14, color: '#64748b' },
  error: { padding: 14, borderRadius: 10, background: '#fef2f2', color: '#991b1b' },
  emptyState: { padding: '42px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 16, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' },
  emptyTitle: { margin: '0 0 8px', color: '#0f172a' },
  emptyText: { maxWidth: 560, margin: '0 auto', color: '#64748b', lineHeight: 1.6 },
  grid: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 },
  coverLink: { display: 'block', width: 'min(72%, 300px)', textDecoration: 'none' },
  coverImage: { display: 'block', width: '100%', aspectRatio: '750 / 1064', objectFit: 'cover', borderRadius: 8, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.2)' },
  defaultCover: { width: '100%', aspectRatio: '750 / 1064', padding: 18, boxSizing: 'border-box', borderRadius: 8, background: 'linear-gradient(145deg, #0f172a, #334155)', color: '#ffffff', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  defaultCoverBrand: { position: 'absolute', opacity: 0, pointerEvents: 'none' },
  defaultCoverTitle: { fontSize: 20, lineHeight: 1.25, fontWeight: 800, overflowWrap: 'anywhere' },
  bookTitle: { margin: '0 0 8px', color: '#0f172a', fontSize: 21, overflowWrap: 'anywhere' },
  typeBadge: { display: 'inline-block', marginBottom: 7, padding: '4px 8px', borderRadius: 999, background: '#e2e8f0', color: '#475569', fontSize: 12, fontWeight: 800 },
  meta: { color: '#64748b', fontSize: 14 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  primaryLink: { textDecoration: 'none', padding: '9px 12px', borderRadius: 8, background: '#0f172a', color: '#ffffff', fontWeight: 700, fontSize: 14 },
  secondaryLink: { textDecoration: 'none', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', color: '#334155', fontWeight: 700, fontSize: 14 },
};
