import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type UserData = { id: string; name?: string; email?: string };
type BillingProfile = {
  billingName?: string;
  billingEmail?: string;
  billingCountry?: string;
  billingPostalCode?: string;
  billingCity?: string;
  billingAddress?: string;
  billingTaxNumber?: string | null;
};
type Mode = 'self' | 'gift' | 'organization';
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
  simplepay?: {
    environment?: 'sandbox' | 'live';
    credentialsConfigured?: boolean;
    liveRequested?: boolean;
    liveEnabled?: boolean;
    enabled?: boolean;
    integrationReady?: boolean;
    missingConfiguration?: string[];
  };
};
type PaymentSuccess = {
  purchaseId: string;
  provider: Provider;
  giftRedeemPath?: string | null;
};

export function PurchasePage() {
  const language = usePublicUiLanguage();
  const t = useCallback((key: string) => publicText(language, key), [language]);
  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);
  const initialQuery = new URLSearchParams(window.location.search);
  const [user, setUser] = useState<UserData | null>(null);
  const [mode, setMode] = useState<Mode>(
    initialQuery.get('mode') === 'gift'
      ? 'gift'
      : initialQuery.get('mode') === 'organization'
        ? 'organization'
        : 'self'
  );
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
    if (!user) return;

    let active = true;
    fetch(`${API_BASE}/api/my/billing-profile`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        const profile = (data?.billingProfile || null) as BillingProfile | null;
        if (!profile) return;

        setBillingName(profile.billingName || user.name || '');
        setBillingEmail(profile.billingEmail || user.email || '');
        setBillingCountry(profile.billingCountry || 'Magyarország');
        setBillingPostalCode(profile.billingPostalCode || '');
        setBillingCity(profile.billingCity || '');
        setBillingAddress(profile.billingAddress || '');
        setBillingTaxNumber(profile.billingTaxNumber || '');
      })
      .catch(() => {});

    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    const normalizedCountry = billingCountry.trim().toLocaleLowerCase('hu-HU');
    const isHungary = normalizedCountry === 'magyarország' || normalizedCountry === 'hungary' || normalizedCountry === 'hu';
    const postalCode = billingPostalCode.trim();
    if (!isHungary || !/^\d{4}$/.test(postalCode)) return;

    let active = true;
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/api/postal-lookup/HU/${encodeURIComponent(postalCode)}`)
        .then(async (response) => response.ok ? response.json() : null)
        .then((data) => {
          if (!active) return;
          const city = String(data?.city || '').trim();
          if (city) setBillingCity(city);
        })
        .catch(() => {});
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [billingCountry, billingPostalCode]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const paypalState = query.get('paypal');
    const simplePayState = query.get('simplepay');
    const returnedPurchaseId = query.get('purchaseId');

    if (simplePayState === 'return') {
      if (!returnedPurchaseId) {
        setError(t('A SimplePay visszatérési adatai hiányosak.'));
        return;
      }

      let active = true;
      let timer: number | undefined;
      setPurchaseId(returnedPurchaseId);
      setLoading(true);
      setError(null);
      setNotice(t('SimplePay fizetés ellenőrzése...'));

      const checkStatus = async (attempt: number) => {
        try {
          const response = await fetch(
            `${API_BASE}/api/purchases/${encodeURIComponent(returnedPurchaseId)}/simplepay/status`,
            { credentials: 'include' }
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || 'SIMPLEPAY_STATUS_FAILED');
          if (!active) return;

          if (data?.paymentStatus === 'paid') {
            setPaymentSuccess({
              purchaseId: returnedPurchaseId,
              provider: 'simplepay',
              giftRedeemPath: data?.giftRedeemPath || null,
            });
            setNotice(null);
            setLoading(false);
            window.history.replaceState({}, '', '/purchase');
            return;
          }

          if (attempt < 7) {
            timer = window.setTimeout(() => { void checkStatus(attempt + 1); }, 1000);
            return;
          }

          setNotice(t('A SimplePay fizetés még feldolgozás alatt van. A könyvjogosultság csak a hiteles SimplePay értesítés után jön létre.'));
          setLoading(false);
        } catch (err) {
          if (!active) return;
          console.error(err);
          setNotice(null);
          setLoading(false);
          setError(t('A SimplePay fizetés állapotának ellenőrzése nem sikerült. A vásárlást nem jelöltük kifizetettnek.'));
        }
      };

      void checkStatus(0);
      return () => {
        active = false;
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

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
          provider: 'paypal',
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
    if (mode !== 'gift' && !user) {
      const returnTo = `/purchase?mode=${mode}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
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
          purchaserName: mode === 'gift' ? billingName : purchaserName,
          purchaserEmail: mode === 'gift' ? billingEmail : purchaserEmail,
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

      if (provider === 'simplepay') {
        if (!paymentCapabilities?.simplepay?.enabled) {
          setNotice(t('A SimplePay technikailag be van kötve, de a sandbox hitelesítő adatok még nincsenek beállítva.'));
          return;
        }

        const startResponse = await fetch(
          `${API_BASE}/api/purchases/${encodeURIComponent(nextPurchaseId)}/simplepay/start`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const startData = await startResponse.json().catch(() => ({}));
        if (!startResponse.ok) {
          if (startData?.error === 'PURCHASE_AMOUNT_NOT_READY') {
            setNotice(t('A SimplePay útvonal működik, de a MemoryBook ára és pénzneme még nincs beállítva.'));
            return;
          }
          throw new Error(startData?.error || 'SIMPLEPAY_START_FAILED');
        }

        const paymentUrl = String(startData?.transaction?.paymentUrl || '');
        if (!paymentUrl) throw new Error('SIMPLEPAY_PAYMENT_URL_MISSING');
        window.location.assign(paymentUrl);
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
  const simplePayReady = Boolean(paymentCapabilities?.simplepay?.enabled);

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.topRow}>
          <a href={user ? '/my-books' : '/login'} style={styles.back}>{t('← Vissza')}</a>
          <LanguageSwitcher />
        </div>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{t('Emlékkönyv vásárlása')}</h1>

        <div style={styles.switcher}>
          <button type="button" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>{t('Magamnak')}</button>
          <button type="button" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>{t('Ajándékba')}</button>
          <button type="button" onClick={() => setMode('organization')} style={{ ...styles.switchButton, ...(mode === 'organization' ? styles.active : {}) }}>{t('Cég / szervezet')}</button>
        </div>

        {mode !== 'gift' && !user && (
          <div style={styles.notice}>
            {t('A vásárláshoz előbb be kell lépned vagy regisztrálnod.')}
            <a href={`/login?returnTo=${encodeURIComponent(`/purchase?mode=${mode}`)}`} style={styles.inlineLink}> {t('Belépés / regisztráció')}</a>
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


          <div style={styles.sectionTitle}>{t('Számlázási adatok')}</div>
          <label style={styles.label}>{t('Ország')}
            <input value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input} />
          </label>
          <div style={styles.twoCols}>
            <label style={styles.label}>{t('Irányítószám')}
              <input
                value={billingPostalCode}
                inputMode={billingCountry.trim().toLocaleLowerCase('hu-HU') === 'magyarország' ? 'numeric' : undefined}
                onChange={(event) => setBillingPostalCode(event.target.value)}
                style={styles.input}
              />
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
          <label style={styles.label}>{t('Név')}
            <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('E-mail')}
            <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} />
          </label>

          {mode === 'gift' && <div style={styles.giftInfo}>{t('Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.')}</div>}
          {notice && <div style={styles.notice}>{notice}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || (mode !== 'gift' && !user)} style={styles.primaryButton}>
            {loading
              ? t('Folyamatban...')
              : provider === 'simplepay' && simplePayReady
                ? t('Tovább a SimplePay fizetéshez')
                : provider === 'paypal' && paypalReady
                  ? t('Tovább a PayPal fizetéshez')
                  : t('Fizetés')}
          </button>
        </form>

        {paymentSuccess && (
          <div style={styles.success}>
            <strong>{t(paymentSuccess.provider === 'simplepay' ? 'A SimplePay fizetés sikeres. A könyvjogosultság létrejött.' : 'A PayPal fizetés sikeres. A könyvjogosultság létrejött.')}</strong><br />
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
  page: { minHeight: '100vh', padding: '8px 8px 24px', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 3 },
  card: { width: '100%', maxWidth: 640, margin: '0 auto', padding: 11, background: '#fff', borderRadius: 12, boxSizing: 'border-box', boxShadow: '0 8px 24px rgba(15,23,42,.07)' },
  back: { display: 'inline-flex', minHeight: 36, alignItems: 'center', color: '#475569', textDecoration: 'none', fontWeight: 700, fontSize: 14 },
  brand: { marginTop: 0, color: '#64748b', fontWeight: 800, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { margin: '3px 0', color: '#0f172a', fontSize: 'clamp(23px,7vw,32px)' },
  lead: { margin: '0 0 9px', color: '#64748b', lineHeight: 1.35, fontSize: 14 },
  switcher: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, marginBottom: 8, padding: 2, background: '#e2e8f0', borderRadius: 9 },
  switchButton: { minHeight: 38, padding: '2px', border: 0, borderRadius: 7, background: 'transparent', fontWeight: 800, color: '#475569', fontSize: 11.5, lineHeight: 1.15 },
  active: { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,.12)' },
  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },
  inlineLink: { color: '#166534', fontWeight: 800 },
  form: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { display: 'flex', flexDirection: 'column', gap: 3, color: '#334155', fontSize: 13, fontWeight: 700, minWidth: 0 },
  input: { width: '100%', minHeight: 36, padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 7, boxSizing: 'border-box', fontSize: 14, background: '#fff' },
  sectionTitle: { marginTop: 2, color: '#0f172a', fontWeight: 800, fontSize: 15 },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 6 },
  giftInfo: { padding: 9, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 13, lineHeight: 1.35 },
  error: { padding: 9, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 15 },
  success: { marginTop: 10, padding: 10, borderRadius: 9, background: '#ecfdf5', color: '#166534', lineHeight: 1.4, fontSize: 13, overflowWrap: 'anywhere' },
};
