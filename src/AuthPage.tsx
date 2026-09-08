import { useState } from 'react';
import type { FormEvent } from 'react';
import { authClient } from './authClient';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type Mode = 'login' | 'register';

export function AuthPage() {
  const params = new URLSearchParams(window.location.search);
  const requestedReturnTo = params.get('returnTo');
  const returnTo =
    requestedReturnTo && requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/my-books';
  const oauthError = params.get('oauthError');

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    oauthError === 'google' ? 'A Google-belépés nem sikerült. Próbáld újra.' : null
  );

  const signInWithGoogle = async () => {
    setError(null);
    setLoading(true);

    const errorCallbackURL = `/login?oauthError=google&returnTo=${encodeURIComponent(returnTo)}`;

    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: returnTo,
        newUserCallbackURL: returnTo,
        errorCallbackURL,
      });

      if (result?.error) {
        throw new Error(result.error.message || 'GOOGLE_SIGN_IN_FAILED');
      }
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message === 'GOOGLE_SIGN_IN_FAILED'
          ? 'A Google-belépés nem sikerült.'
          : err?.message || 'A Google-belépés nem sikerült.'
      );
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (mode === 'register' && name.trim().length < 2) {
      setError('Add meg a neved.');
      return;
    }

    if (!email.trim()) {
      setError('Add meg az e-mail-címed.');
      return;
    }

    if (password.length < 8) {
      setError('A tesztjelszó legalább 8 karakter legyen.');
      return;
    }

    try {
      setLoading(true);

      const endpoint =
        mode === 'register'
          ? '/api/auth/sign-up/email'
          : '/api/auth/sign-in/email';

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          mode === 'register'
            ? {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                password,
              }
            : {
                email: email.trim().toLowerCase(),
                password,
              }
        ),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          data?.message ||
          data?.error?.message ||
          (mode === 'register'
            ? 'A tesztregisztráció nem sikerült.'
            : 'A tesztbelépés nem sikerült.');
        throw new Error(message);
      }

      window.location.href = returnTo;
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Hiba történt.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>Belépés vagy regisztráció</h1>
        <p style={styles.subtitle}>
          Google-fiókkal egy lépésben beléphetsz. Ha még nincs MemoryBook-fiókod,
          az első Google-belépéskor automatikusan létrejön.
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          style={styles.googleButton}
          disabled={loading}
          aria-label="Folytatás Google-fiókkal"
        >
          <span style={styles.googleMark} aria-hidden="true">G</span>
          {loading ? 'Kapcsolódás...' : 'Folytatás Google-fiókkal'}
        </button>

        {error && <div style={styles.error}>{error}</div>}

        <details style={styles.testDetails}>
          <summary style={styles.testSummary}>Teszt / fejlesztői belépés e-maillel</summary>
          <div style={styles.testPanel}>
            <p style={styles.testText}>
              Ez a lehetőség az automatizált tesztek és a fejlesztés miatt marad meg.
              A végleges felhasználói belépés elsődleges módja a Google.
            </p>

            <div style={styles.switcher}>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                style={{
                  ...styles.switchButton,
                  ...(mode === 'login' ? styles.switchButtonActive : {}),
                }}
              >
                Belépés
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                style={{
                  ...styles.switchButton,
                  ...(mode === 'register' ? styles.switchButtonActive : {}),
                }}
              >
                Tesztregisztráció
              </button>
            </div>

            <form onSubmit={submit} style={styles.form}>
              {mode === 'register' && (
                <label style={styles.label}>
                  Név
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    style={styles.input}
                    placeholder="Neved"
                    disabled={loading}
                  />
                </label>
              )}

              <label style={styles.label}>
                E-mail
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  style={styles.input}
                  placeholder="nev@email.hu"
                  disabled={loading}
                />
              </label>

              <label style={styles.label}>
                Tesztjelszó
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  style={styles.input}
                  placeholder="Legalább 8 karakter"
                  disabled={loading}
                />
              </label>

              <button type="submit" style={styles.secondaryAction} disabled={loading}>
                {loading
                  ? 'Folyamatban...'
                  : mode === 'login'
                    ? 'Teszt belépés'
                    : 'Tesztfiók létrehozása'}
              </button>
            </form>
          </div>
        </details>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    background: '#f1f5f9',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    background: '#ffffff',
    borderRadius: 18,
    padding: 28,
    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.12)',
    boxSizing: 'border-box',
  },
  brand: {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#475569',
  },
  title: {
    margin: '8px 0 6px',
    fontSize: 30,
    color: '#0f172a',
  },
  subtitle: {
    margin: '0 0 22px',
    color: '#64748b',
    lineHeight: 1.5,
  },
  googleButton: {
    width: '100%',
    minHeight: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    padding: '12px 16px',
    background: '#ffffff',
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 800,
    cursor: 'pointer',
  },
  googleMark: {
    width: 25,
    height: 25,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    border: '1px solid #cbd5e1',
    fontWeight: 900,
    fontSize: 15,
  },
  error: {
    marginTop: 14,
    padding: 11,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
    fontSize: 14,
  },
  testDetails: {
    marginTop: 22,
    borderTop: '1px solid #e2e8f0',
    paddingTop: 16,
  },
  testSummary: {
    cursor: 'pointer',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 700,
  },
  testPanel: {
    marginTop: 14,
  },
  testText: {
    margin: '0 0 14px',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.45,
  },
  switcher: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
    padding: 4,
    borderRadius: 10,
    background: '#e2e8f0',
    marginBottom: 16,
  },
  switchButton: {
    border: 0,
    borderRadius: 8,
    padding: '10px 12px',
    background: 'transparent',
    cursor: 'pointer',
    fontWeight: 700,
    color: '#475569',
  },
  switchButtonActive: {
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.12)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    color: '#334155',
    fontSize: 14,
    fontWeight: 700,
  },
  input: {
    width: '100%',
    padding: '12px 13px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    fontSize: 16,
    boxSizing: 'border-box',
  },
  secondaryAction: {
    border: 0,
    borderRadius: 9,
    padding: '12px 16px',
    background: '#334155',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
  },
};
