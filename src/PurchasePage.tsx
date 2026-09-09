import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type UserData = { id: string; name?: string; email?: string };
type Mode = 'self' | 'gift';
type BookType = 'standard' | 'event';
type Provider = 'paypal' | 'simplepay';
type PaymentCapabilities = {
  paypal?: {
    environment?: 'sandbox' | 'live';
    credentialsConfigured?: boolean;
    liveRequested?: boolean;
    liveEnabled?: boolean;
    enabled?: boolean;
    missingConfiguration?: string[];
  };
  simplepay?: { enabled?: boolean; integrationReady?: boolean };
};
type PaymentSuccess = {
  purchaseId: string;
  giftRedeemPath?: string | null;
};

export function PurchasePage() {
  const language = usePublicUiLanguage();
  const t = useCallback((key: string) => publicText(language, key), [language]);
  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);
  const initialQuery = new URLSearchParams(window.location.search);
  const [user, setUser] = useState<UserData | null>(null);
  const [mode, setMode] = useState<Mode>(initialQuery.get('mode') === 'gift' ? 'gift' : 'self');
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
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [paymentCapabilities, setPaymentCapabilities] = useState<PaymentCapabilities | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<PaymentSuccess | null>(null);

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

    fetch(`${API_BASE}/api/payment-capabilities`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => setPaymentCapabilities(data || null))
      .catch(() => setPaymentCapabilities(null));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const paypalState = query.get('paypal');
    const returnedPurchaseId = query.get('purchaseId');

    if (paypalState === 'cancel') {
      setPurchaseId(returnedPurchaseId);
      setNotice(t('A PayPal fizetés megszakadt. Nem történt terhelés.'));
      window.history.replaceState({}, '', '/purchase');
      return;
    }

    if (paypalState !== 'return') return;

    const orderId = query.get('token');
    if (!returnedPurchaseId || !orderId) {
      setError(t('A PayPal visszatérési adatai hiányosak.'));
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setNotice(t('PayPal fizetés ellenőrzése...'));

    fetch(`${API_BASE}/api/purchases/${encodeURIComponent(returnedPurchaseId)}/paypal/capture`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'PAYPAL_CAPTURE_FAILED');
        return data;
      })
      .then((data) => {
        if (!active) return;
        setPurchaseId(returnedPurchaseId);
        setPaymentSuccess({
          purchaseId: returnedPurchaseId,
          giftRedeemPath: data?.giftRedeemPath || null,
        });
        setNotice(null);
        window.history.replaceState({}, '', '/purchase');
      })
      .catch((err) => {
        if (!active) return;
        console.error(err);
        setNotice(null);
        setError(t('A PayPal fizetés lezárása nem sikerült. A vásárlást nem jelöltük kifizetettnek.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPurchaseId(null);
    setPaymentSuccess(null);
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

      const nextPurchaseId = String(data.purchase?.id || '');
      setPurchaseId(nextPurchaseId || null);
      if (!nextPurchaseId) throw new Error('PURCHASE_ID_MISSING');

      if (provider !== 'paypal') {
        setNotice(t('A SimplePay bekötése még nincs aktiválva. A vásárlási adatok elmentve.'));
        return;
      }

      if (!paymentCapabilities?.paypal?.enabled) {
        setNotice(t('A PayPal technikailag be van kötve, de a sandbox hitelesítő adatok még nincsenek beállítva.'));
        return;
      }

      const orderResponse = await fetch(
        `${API_BASE}/api/purchases/${encodeURIComponent(nextPurchaseId)}/paypal/order`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const orderData = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) {
        if (orderData?.error === 'PURCHASE_AMOUNT_NOT_READY') {
          setNotice(t('A PayPal útvonal működik, de a MemoryBook ára és pénzneme még nincs beállítva.'));
          return;
        }
        throw new Error(orderData?.error || 'PAYPAL_ORDER_CREATE_FAILED');
      }

      const approvalUrl = String(orderData?.order?.approvalUrl || '');
      if (!approvalUrl) throw new Error('PAYPAL_APPROVAL_URL_MISSING');
      window.location.assign(approvalUrl);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message === 'INCOMPLETE_PURCHASE_IDENTITY'
          ? t('Töltsd ki a számlázáshoz szükséges adatokat.')
          : t('A vásárlás előkészítése nem sikerült.')
      );
    } finally {
      setLoading(false);
    }
  };

  const paypalReady = Boolean(paymentCapabilities?.paypal?.enabled);

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.languageRow}><LanguageSwitcher /></div>
        <a href={user ? '/my-books' : '/login'} style={styles.back}>{t('← Vissza')}</a>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{t('Emlékkönyv vásárlása')}</h1>
        <p style={styles.lead}>{t('A PayPal fizetési folyamat technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.')}</p>

        <div style={styles.switcher}>
          <button type="button" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>{t('Magamnak')}</button>
          <button type="button" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>{t('Ajándékba')}</button>
        </div>

        {mode === 'self' && !user && (
          <div style={styles.notice}>
            {t('Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.')}
            <a href={`/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`} style={styles.inlineLink}> {t('Belépés / regisztráció')}</a>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>{t('Könyv típusa')}
            <select value={bookType} onChange={(event) => setBookType(event.target.value as BookType)} style={styles.input}>
              <option value="standard">{t('Normál emlékkönyv – 30 oldal')}</option>
              <option value="event">{t('Rendezvény-vendégkönyv')}</option>
            </select>
          </label>

          <label style={styles.label}>{t('Fizetési mód')}
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)} style={styles.input}>
              <option value="simplepay">SimplePay</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>

          {provider === 'paypal' && paymentCapabilities && !paypalReady && (
            <div style={styles.notice}>{t('A PayPal sandbox még nincs aktiválva. A fizetés nem indul el, amíg nincs beállítva teszt hitelesítés.')}</div>
          )}

          <div style={styles.sectionTitle}>{t('Vásárló azonosítása')}</div>
          <label style={styles.label}>{t('Név')}
            <input value={purchaserName} onChange={(event) => setPurchaserName(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>
          <label style={styles.label}>{t('E-mail')}
            <input type="email" value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>

          <div style={styles.sectionTitle}>{t('Számlázási adatok')}</div>
          <label style={styles.label}>{t('Számlázási név')}
            <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('Számlázási e-mail')}
            <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('Ország')}
            <input value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input} />
          </label>
          <div style={styles.twoCols}>
            <label style={styles.label}>{t('Irányítószám')}
              <input value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>{t('Település')}
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} />
            </label>
          </div>
          <label style={styles.label}>{t('Cím')}
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('Adószám (ha szükséges)')}
            <input value={billingTaxNumber} onChange={(event) => setBillingTaxNumber(event.target.value)} style={styles.input} />
          </label>

          {mode === 'gift' && <div style={styles.giftInfo}>{t('Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.')}</div>}
          {notice && <div style={styles.notice}>{notice}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || (mode === 'self' && !user)} style={styles.primaryButton}>
            {loading ? t('Folyamatban...') : provider === 'paypal' && paypalReady ? t('Tovább a PayPal fizetéshez') : t('Vásárlási adatok mentése')}
          </button>
        </form>

        {paymentSuccess && (
          <div style={styles.success}>
            <strong>{t('A PayPal fizetés sikeres. A könyvjogosultság létrejött.')}</strong><br />
            {f('Azonosító: {id}', { id: paymentSuccess.purchaseId })}<br />
            {paymentSuccess.giftRedeemPath ? (
              <a href={paymentSuccess.giftRedeemPath} style={styles.inlineLink}>{t('Ajándék beváltó link megnyitása')}</a>
            ) : (
              <a href="/my-books" style={styles.inlineLink}>{t('Tovább a könyveimhez')}</a>
            )}
          </div>
        )}

        {purchaseId && !paymentSuccess && (
          <div style={styles.success}>
            <strong>{t('Vásárlási alap rögzítve.')}</strong><br />
            {f('Azonosító: {id}', { id: purchaseId })}<br />
            {t('Fizetés nélkül könyvjogosultság nem keletkezik.')}
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '18px 12px 40px', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },
  card: { width: '100%', maxWidth: 640, margin: '0 auto', padding: 20, background: '#fff', borderRadius: 16, boxSizing: 'border-box', boxShadow: '0 10px 30px rgba(15,23,42,.08)' },
  back: { display: 'inline-flex', minHeight: 44, alignItems: 'center', color: '#475569', textDecoration: 'none', fontWeight: 700 },
  brand: { marginTop: 4, color: '#64748b', fontWeight: 800, fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '6px 0', color: '#0f172a', fontSize: 'clamp(25px,8vw,34px)' },
  lead: { margin: '0 0 18px', color: '#64748b', lineHeight: 1.5 },
  switcher: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16, padding: 4, background: '#e2e8f0', borderRadius: 10 },
  switchButton: { minHeight: 44, border: 0, borderRadius: 8, background: 'transparent', fontWeight: 800, color: '#475569' },
  active: { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,.12)' },
  notice: { marginBottom: 12, padding: 12, borderRadius: 9, background: '#fff7ed', color: '#9a3412', lineHeight: 1.45 },
  inlineLink: { color: '#166534', fontWeight: 800 },
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
