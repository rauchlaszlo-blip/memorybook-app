import { useEffect, useState } from 'react';

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

        {loading && <div style={styles.panel}>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && books.length === 0 && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>Még nincs emlékkönyved</h2>
            <p style={styles.emptyText}>
              A tulajdonosi fiókod működik. A következő lépésben innen lehet
              majd új emlékkönyvet létrehozni.
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
                    href={`/book/${encodeURIComponent(book.id)}/view`}
                    style={styles.primaryLink}
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
