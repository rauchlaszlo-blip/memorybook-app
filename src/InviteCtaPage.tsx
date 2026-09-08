export function InviteCtaPage() {
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>Nekem is kell emlékkönyv</h1>
        <p style={styles.text}>
          Készíts saját online emlékkönyvet, hívd meg azokat, akik fontosak neked,
          és gyűjtsd össze az emlékeiteket egy közös könyvbe.
        </p>
        <a href="/login" style={styles.button}>Saját MemoryBook létrehozása</a>
        <p style={styles.note}>A létrehozás regisztrációval indul.</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: '24px 16px',
    boxSizing: 'border-box',
    background: '#f1f5f9',
    fontFamily: 'Arial, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    padding: '32px 24px',
    boxSizing: 'border-box',
    borderRadius: 18,
    background: '#ffffff',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10)',
    textAlign: 'center',
  },
  brand: {
    marginBottom: 10,
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    margin: '0 0 16px',
    color: '#0f172a',
    fontSize: 'clamp(28px, 8vw, 40px)',
    lineHeight: 1.1,
  },
  text: {
    margin: '0 auto 24px',
    color: '#475569',
    fontSize: 17,
    lineHeight: 1.6,
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 50,
    padding: '12px 18px',
    boxSizing: 'border-box',
    borderRadius: 10,
    background: '#0f172a',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 800,
  },
  note: {
    margin: '14px 0 0',
    color: '#64748b',
    fontSize: 13,
  },
};
