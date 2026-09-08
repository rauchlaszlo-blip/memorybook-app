import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type UserData = { id: string; name?: string; email?: string };
type Mode = 'self' | 'gift';
type BookType = 'standard' | 'event';
type Provider = 'paypal' | 'simplepay';

export function PurchasePage() {
  const query = new URLSearchParams(window.location.search);
  const [user, setUser] = useState<UserData | null>(null);
  const [mode, setMode] = useState<Mode>(query.get('mode') === 'gift' ? 'gift' : 'self');
  const [bookType, setBookType] = useState<BookType>('standard');
  const [provider, setProvider] = useState<Provider>('simplepay');
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [billingCountry, setBillingCountry] = useState('Magyarország');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingTaxNumber, setBillingTaxNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        const nextUser = data?.user || null;
        setUser(nextUser);
        if (nextUser) {
          setPurchaserName(nextUser.name || '');
          setPurchaserEmail(nextUser.email || '');
          setBillingName((current) => current || nextUser.name || '');
          setBillingEmail((current) => current || nextUser.email || '');
        }
      })
      .catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPurchaseId(null);
    if (mode === 'self' && !user) {
      window.location.href = `/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`;
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/purchases`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseMode: mode,
          bookType,
          paymentProvider: provider,
          purchaserName,
          purchaserEmail,
          billingName,
          billingEmail,
          billingCountry,
          billingPostalCode,
          billingCity,
          billingAddress,
          billingTaxNumber,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'PURCHASE_DRAFT_CREATE_FAILED');
      setPurchaseId(data.purchase?.id || null);
    } catch (err: any) {
      console.error(err);
      setError(err?.message === 'INCOMPLETE_PURCHASE_IDENTITY' ? 'Töltsd ki a számlázáshoz szükséges adatokat.' : 'A vásárlás előkészítése nem sikerült.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href={user ? '/my-books' : '/login'} style={styles.back}>← Vissza</a>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>Emlékkönyv vásárlása</h1>
        <p style={styles.lead}>A fizetési alapfolyamat elkészült. A PayPal és SimplePay tényleges fizetési indítása a következő integrációs lépés.</p>

        <div style={styles.switcher}>
          <button type="button" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>Magamnak</button>
          <button type="button" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>Ajándékba</button>
        </div>

        {mode === 'self' && !user && (
          <div style={styles.notice}>
            Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.
            <a href={`/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`} style={styles.inlineLink}> Belépés / regisztráció</a>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>Könyv típusa
            <select value={bookType} onChange={(event) => setBookType(event.target.value as BookType)} style={styles.input}>
              <option value="standard">Normál emlékkönyv – 30 oldal</option>
              <option value="event">Rendezvény-vendégkönyv</option>
            </select>
          </label>

          <label style={styles.label}>Fizetési mód
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)} style={styles.input}>
              <option value="simplepay">SimplePay</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>

          <div style={styles.sectionTitle}>Vásárló azonosítása</div>
          <label style={styles.label}>Név
            <input value={purchaserName} onChange={(event) => setPurchaserName(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>
          <label style={styles.label}>E-mail
            <input type="email" value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>

          <div style={styles.sectionTitle}>Számlázási adatok</div>
          <label style={styles.label}>Számlázási név
            <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Számlázási e-mail
            <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Ország
            <input value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input} />
          </label>
          <div style={styles.twoCols}>
            <label style={styles.label}>Irányítószám
              <input value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>Település
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} />
            </label>
          </div>
          <label style={styles.label}>Cím
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Adószám (ha szükséges)
            <input value={billingTaxNumber} onChange={(event) => setBillingTaxNumber(event.target.value)} style={styles.input} />
          </label>

          {mode === 'gift' && <div style={styles.giftInfo}>Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || (mode === 'self' && !user)} style={styles.primaryButton}>
            {loading ? 'Mentés...' : 'Vásárlási adatok mentése'}
          </button>
        </form>

        {purchaseId && (
          <div style={styles.success}>
            <strong>Vásárlási alap rögzítve.</strong><br />
            Azonosító: {purchaseId}<br />
            Még nem történt fizetés, ezért könyvjogosultság sem keletkezett. A következő lépésben ehhez kötjük a PayPal és SimplePay fizetést.
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '18px 12px 40px', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 640, margin: '0 auto', padding: 20, background: '#fff', borderRadius: 16, boxSizing: 'border-box', boxShadow: '0 10px 30px rgba(15,23,42,.08)' },
  back: { display: 'inline-flex', minHeight: 44, alignItems: 'center', color: '#475569', textDecoration: 'none', fontWeight: 700 },
  brand: { marginTop: 4, color: '#64748b', fontWeight: 800, fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '6px 0', color: '#0f172a', fontSize: 'clamp(25px,8vw,34px)' },
  lead: { margin: '0 0 18px', color: '#64748b', lineHeight: 1.5 },
  switcher: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16, padding: 4, background: '#e2e8f0', borderRadius: 10 },
  switchButton: { minHeight: 44, border: 0, borderRadius: 8, background: 'transparent', fontWeight: 800, color: '#475569' },
  active: { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,.12)' },
  notice: { marginBottom: 16, padding: 12, borderRadius: 9, background: '#fff7ed', color: '#9a3412', lineHeight: 1.45 },
  inlineLink: { color: '#9a3412', fontWeight: 800 },
  form: { display: 'flex', flexDirection: 'column', gap: 13 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: '#334155', fontSize: 14, fontWeight: 700, minWidth: 0 },
  input: { width: '100%', minHeight: 46, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, boxSizing: 'border-box', fontSize: 16, background: '#fff' },
  sectionTitle: { marginTop: 6, color: '#0f172a', fontWeight: 800, fontSize: 17 },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 },
  giftInfo: { padding: 12, borderRadius: 9, background: '#f8fafc', color: '#475569', fontSize: 13, lineHeight: 1.5 },
  error: { padding: 11, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 16 },
  success: { marginTop: 16, padding: 14, borderRadius: 10, background: '#ecfdf5', color: '#166534', lineHeight: 1.5, overflowWrap: 'anywhere' },
};
