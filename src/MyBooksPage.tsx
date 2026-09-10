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

type UserData = { id: string; name?: string; email?: string };
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
  const [user, setUser] = useState<UserData | null>(null);
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
        const meData = await meResponse.json();
        setUser(meData.user ?? null);

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
      <section style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>MemoryBook</div>
            <h1 style={styles.title}>{t('Saját könyveim')}</h1>
            {user && <div style={styles.userLine}>{user.name || user.email || t('Bejelentkezett felhasználó')}</div>}
          </div>
          <div style={styles.headerActions}>
            <LanguageSwitcher />
            <button type="button" onClick={signOut} style={styles.secondaryButton}>{t('Kijelentkezés')}</button>
            <NotificationMenu />
          </div>
        </header>

        {!loading && !error && (
          <section style={styles.createCard}>
            {availableEntitlements.length > 0 ? (
              <>
                <h2 style={styles.createTitle}>{t('Új emlékkönyv létrehozása')}</h2>
                <p style={styles.createText}>
                  {f('{count} felhasználható könyvjogosultságod van. Egy jogosultság egy könyv létrehozására használható fel.', { count: availableEntitlements.length })}
                </p>
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
                          ? t('Rendezvény-vendégkönyv')
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
              </>
            ) : (
              <>
                <h2 style={styles.createTitle}>{t('Új emlékkönyv')}</h2>
                <p style={styles.createText}>
                  {t('Új könyvet vásárlási jogosultsággal lehet létrehozni. A normál könyv 30 oldallal indul, később bővíthető.')}
                </p>
                <a href="/purchase" style={styles.purchaseLink}>{t('Új könyv vásárlása')}</a>
              </>
            )}
            {availableEntitlements.length > 0 && (
              <div style={styles.purchaseMore}><a href="/purchase">{t('További könyv vásárlása vagy ajándékba vétele')}</a></div>
            )}
          </section>
        )}

        {loading && <div style={styles.panel}>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && books.length === 0 && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>{t('Még nincs emlékkönyved')}</h2>
            <p style={styles.emptyText}>
              {t('Vásárolj könyvjogosultságot, vagy válts be egy ajándékba kapott jogosultságot. A könyv csak ezután hozható létre.')}
            </p>
          </div>
        )}

        {!loading && !error && books.length > 0 && (
          <div style={styles.grid}>
            {books.map((book) => (
              <article key={book.id} style={styles.card}>
                {book.bookType !== 'event' && (
                  <a href={`/book/${encodeURIComponent(book.id)}/view`} style={styles.coverLink} aria-label={`${book.title} – ${t('Könyv megnyitása')}`}>
                    {book.coverPreviewImageUrl ? (
                      <img src={book.coverPreviewImageUrl} alt={book.title} style={styles.coverImage} />
                    ) : (
                      <div style={styles.defaultCover}>
                        <div style={styles.defaultCoverBrand}>MemoryBook</div>
                        <div style={styles.defaultCoverTitle}>{book.title}</div>
                      </div>
                    )}
                  </a>
                )}
                <h2 style={styles.bookTitle}>{book.title}</h2>
                <div style={styles.typeBadge}>{book.bookType === 'event' ? t('Rendezvény-vendégkönyv') : language === 'de' ? 'Normales Erinnerungsbuch' : language === 'en' ? 'Standard memory book' : 'Normál emlékkönyv'}</div>
                <div style={styles.meta}>{book.bookType === 'event' ? f('{count} bejegyzés', { count: book.contributionCount }) : f('{count} oldal', { count: book.pageCount })}</div>
                <div style={styles.actions}>
                  <a href={`/my-books/${encodeURIComponent(book.id)}`} style={styles.primaryLink}>
                    {book.bookType === 'event' ? t('Rendezvény kezelése') : t('Oldalak és meghívók')}
                  </a>
                  {book.bookType !== 'event' && <a href={`/book/${encodeURIComponent(book.id)}/view`} style={styles.secondaryLink}>{t('Könyv megnyitása')}</a>}
                  {book.bookType !== 'event' && <a href={`/my-books/${encodeURIComponent(book.id)}/cover`} style={styles.secondaryLink}>{language === 'de' ? 'Cover bearbeiten' : language === 'en' ? 'Edit cover' : 'Fedőlap szerkesztése'}</a>}
                  {book.bookType === 'event' && <a href={`/organizer/${encodeURIComponent(book.id)}/contributions`} style={styles.secondaryLink}>{t('Beérkezett bejegyzések')}</a>}
                </div>
              </article>
            ))}
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
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  brand: { fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: '#64748b' },
  title: { margin: '6px 0 4px', fontSize: 32, color: '#0f172a' },
  userLine: { color: '#64748b', fontSize: 14, overflowWrap: 'anywhere' },
  secondaryButton: { minHeight: 44, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#334155', fontWeight: 700, cursor: 'pointer' },
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16 },
  card: { padding: 20, background: '#ffffff', borderRadius: 14, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' },
  coverLink: { display: 'block', width: 'min(72%, 210px)', margin: '0 auto 18px', textDecoration: 'none' },
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
