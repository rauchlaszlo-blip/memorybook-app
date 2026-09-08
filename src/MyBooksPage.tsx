import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type UserData = {
  id: string;
  name?: string;
  email?: string;
};

type BookSummary = {
  id: string;
  title: string;
  pageCount: number;
  contributionCount: number;
  createdAt: string;
};

export function MyBooksPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const meResponse = await fetch(`${API_BASE}/api/me`, {
          credentials: 'include',
        });

        if (meResponse.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!meResponse.ok) {
          throw new Error('SESSION_LOAD_FAILED');
        }

        const meData = await meResponse.json();
        setUser(meData.user ?? null);

        const booksResponse = await fetch(`${API_BASE}/api/my/books`, {
          credentials: 'include',
        });

        if (booksResponse.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!booksResponse.ok) {
          throw new Error('BOOK_LIST_LOAD_FAILED');
        }

        const booksData = await booksResponse.json();
        setBooks(Array.isArray(booksData.books) ? booksData.books : []);
      } catch (err) {
        console.error(err);
        setError('Nem sikerült betölteni a könyveidet.');
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
      setCreateError('Adj nevet az emlékkönyvnek.');
      return;
    }

    if (title.length > 120) {
      setCreateError('A könyv neve legfeljebb 120 karakter lehet.');
      return;
    }

    try {
      setCreating(true);

      const response = await fetch(`${API_BASE}/api/my/books`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'BOOK_CREATE_FAILED');
      }

      if (data.book) {
        setBooks((current) => [data.book, ...current]);
      }

      setNewBookTitle('');
    } catch (err) {
      console.error(err);
      setCreateError('Nem sikerült létrehozni az emlékkönyvet.');
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/sign-out`, {
        method: 'POST',
        credentials: 'include',
      });
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
            <h1 style={styles.title}>Saját könyveim</h1>
            {user && (
              <div style={styles.userLine}>
                {user.name || user.email || 'Bejelentkezett felhasználó'}
                {user.email && user.name ? ` · ${user.email}` : ''}
              </div>
            )}
          </div>

          <button type="button" onClick={signOut} style={styles.secondaryButton}>
            Kijelentkezés
          </button>
        </header>

        {!loading && !error && (
          <section style={styles.createCard}>
            <div>
              <h2 style={styles.createTitle}>Új emlékkönyv</h2>
              <p style={styles.createText}>
                Az új könyv 30 üres oldallal indul. Később további oldalak
                vásárolhatók hozzá.
              </p>
            </div>

            <form onSubmit={createBook} style={styles.createForm}>
              <input
                type="text"
                value={newBookTitle}
                onChange={(event) => setNewBookTitle(event.target.value)}
                placeholder="Például: Anna 40. születésnapja"
                maxLength={120}
                disabled={creating}
                style={styles.input}
              />
              <button
                type="submit"
                disabled={creating}
                style={styles.createButton}
              >
                {creating ? 'Létrehozás...' : 'Emlékkönyv létrehozása'}
              </button>
            </form>

            {createError && <div style={styles.createError}>{createError}</div>}
          </section>
        )}

        {loading && <div style={styles.panel}>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && books.length === 0 && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>Még nincs emlékkönyved</h2>
            <p style={styles.emptyText}>
              Adj nevet az első könyvednek a fenti mezőben. A létrehozás után
              azonnal megjelenik itt.
            </p>
          </div>
        )}

        {!loading && !error && books.length > 0 && (
          <div style={styles.grid}>
            {books.map((book) => (
              <article key={book.id} style={styles.card}>
                <h2 style={styles.bookTitle}>{book.title}</h2>
                <div style={styles.meta}>
                  {book.pageCount} oldal · {book.contributionCount} beküldés
                </div>
                <div style={styles.actions}>
                  <a
                    href={`/my-books/${encodeURIComponent(book.id)}`}
                    style={styles.primaryLink}
                  >
                    Oldalak és meghívók
                  </a>
                  <a
                    href={`/book/${encodeURIComponent(book.id)}/view`}
                    style={styles.secondaryLink}
                  >
                    Könyv megnyitása
                  </a>
                  <a
                    href={`/organizer/${encodeURIComponent(book.id)}/contributions`}
                    style={styles.secondaryLink}
                  >
                    Beküldések
                  </a>
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
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '24px 18px 48px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: {
    width: '100%',
    maxWidth: 980,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 24,
  },
  brand: {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  title: {
    margin: '6px 0 4px',
    fontSize: 32,
    color: '#0f172a',
  },
  userLine: {
    color: '#64748b',
    fontSize: 14,
  },
  secondaryButton: {
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 700,
    cursor: 'pointer',
  },
  createCard: {
    marginBottom: 22,
    padding: 20,
    background: '#ffffff',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  createTitle: {
    margin: '0 0 5px',
    color: '#0f172a',
    fontSize: 21,
  },
  createText: {
    margin: '0 0 16px',
    color: '#64748b',
    lineHeight: 1.5,
  },
  createForm: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  input: {
    flex: '1 1 280px',
    minWidth: 0,
    padding: '12px 13px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    fontSize: 16,
    boxSizing: 'border-box',
  },
  createButton: {
    border: 0,
    borderRadius: 9,
    padding: '12px 16px',
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
  },
  createError: {
    marginTop: 12,
    padding: 11,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
    fontSize: 14,
  },
  panel: {
    padding: 24,
    background: '#ffffff',
    borderRadius: 14,
    color: '#64748b',
  },
  error: {
    padding: 14,
    borderRadius: 10,
    background: '#fef2f2',
    color: '#991b1b',
  },
  emptyState: {
    padding: '42px 28px',
    textAlign: 'center',
    background: '#ffffff',
    borderRadius: 16,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
  },
  emptyTitle: {
    margin: '0 0 8px',
    color: '#0f172a',
  },
  emptyText: {
    maxWidth: 560,
    margin: '0 auto',
    color: '#64748b',
    lineHeight: 1.6,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 16,
  },
  card: {
    padding: 20,
    background: '#ffffff',
    borderRadius: 14,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  bookTitle: {
    margin: '0 0 8px',
    color: '#0f172a',
    fontSize: 21,
  },
  meta: {
    color: '#64748b',
    fontSize: 14,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  primaryLink: {
    textDecoration: 'none',
    padding: '9px 12px',
    borderRadius: 8,
    background: '#0f172a',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 14,
  },
  secondaryLink: {
    textDecoration: 'none',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    color: '#334155',
    fontWeight: 700,
    fontSize: 14,
  },
};
