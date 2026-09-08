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

export function MyBooksPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`${API_BASE}/api/me`, {
          credentials: 'include',
        });

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('SESSION_LOAD_FAILED');
        }

        const data = await response.json();
        setUser(data.user ?? null);
      } catch (err) {
        console.error(err);
        setError('Nem sikerült betölteni a fiókodat.');
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

        {!loading && !error && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>Még nincs emlékkönyved</h2>
            <p style={styles.emptyText}>
              A tulajdonosi fiókod működik. A következő lépésben ide kötjük az
              új könyv létrehozását és a saját könyvek tényleges listáját.
            </p>
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
};
