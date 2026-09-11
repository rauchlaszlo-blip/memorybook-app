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
  billingCompanyName?: string | null;
};
type Mode = 'self' | 'gift' | 'organization';
type BookType = 'standard' | 'event' | 'dedication';
type Provider = 'paypal' | 'simplepay';
type PaymentCapabilities = {
  testPaymentEnabled?: boolean;
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
  provider: Provider | 'test';
  giftRedeemPath?: string | null;
};

type CompanyLookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'invalid' | 'error';

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

const EU_COUNTRY_ALIASES = new Set([
  'AT','AUSTRIA','AUSZTRIA','ÖSTERREICH','BE','BELGIUM','BELGIEN','BELGIQUE','BELGIUM','BG','BULGARIA','BULGÁRIA','CY','CYPRUS','CIPRUS','CZ','CZECHIA','CZECH REPUBLIC','CSEHORSZÁG','TSCHECHIEN','DE','GERMANY','NÉMETORSZÁG','DEUTSCHLAND','DK','DENMARK','DÁNIA','DÄNEMARK','EE','ESTONIA','ÉSZTORSZÁG','ESTLAND','EL','GR','GREECE','GÖRÖGORSZÁG','GRIECHENLAND','ES','SPAIN','SPANYOLORSZÁG','SPANIEN','FI','FINLAND','FINNORSZÁG','FR','FRANCE','FRANCIAORSZÁG','FRANKREICH','HR','CROATIA','HORVÁTORSZÁG','KROATIEN','HU','HUNGARY','MAGYARORSZÁG','UNGARN','IE','IRELAND','ÍRORSZÁG','IRLAND','IT','ITALY','OLASZORSZÁG','ITALIEN','LT','LITHUANIA','LITVÁNIA','LITAUEN','LU','LUXEMBOURG','LUXEMBURG','LV','LATVIA','LETTORSZÁG','LETTLAND','MT','MALTA','NL','NETHERLANDS','HOLLANDIA','NIEDERLANDE','PL','POLAND','LENGYELORSZÁG','POLEN','PT','PORTUGAL','PORTUGÁLIA','RO','ROMANIA','ROMÁNIA','RUMÄNIEN','SE','SWEDEN','SVÉDORSZÁG','SCHWEDEN','SI','SLOVENIA','SZLOVÉNIA','SLOWENIEN','SK','SLOVAKIA','SZLOVÁKIA','SLOWAKEI'
]);

function normalizedCountry(value: string): string {
  return value.trim().toLocaleUpperCase('hu-HU');
}

function isHungarianCountry(value: string): boolean {
  return ['HU', 'HUNGARY', 'MAGYARORSZÁG', 'UNGARN'].includes(normalizedCountry(value));
}

function isEuCountry(value: string): boolean {
  return EU_COUNTRY_ALIASES.has(normalizedCountry(value));
}

function companyTaxLabel(country: string): string {
  if (isHungarianCountry(country)) return 'Adószám';
  if (isEuCountry(country)) return 'Közösségi adószám / VAT ID';
  return 'Adóazonosító / Tax ID';
}

function companyTaxPlaceholder(country: string): string {
  if (isHungarianCountry(country)) return '12345678-2-42';
  if (isEuCountry(country)) return 'DE123456789';
  return '';
}

function normalizeCountryCode(value: string): string {
  const normalized = normalizedCountry(value);
  const legacy: Record<string, string> = {
    'MAGYARORSZÁG': 'HU', HUNGARY: 'HU', UNGARN: 'HU',
    GERMANY: 'DE', 'NÉMETORSZÁG': 'DE', DEUTSCHLAND: 'DE',
    AUSTRIA: 'AT', AUSZTRIA: 'AT', 'ÖSTERREICH': 'AT',
  };
  const mapped = legacy[normalized] || normalized;
  return COUNTRY_CODES.includes(mapped) ? mapped : 'HU';
}

function countryLabel(code: string, language: string): string {
  try {
    const displayNames = new (Intl as any).DisplayNames([language], { type: 'region' });
    return String(displayNames.of(code) || code);
  } catch {
    return code;
  }
}

function parseCompanyLookupAddress(rawAddress: string, country: string): {
  postalCode?: string;
  city?: string;
  address?: string;
} {
  const normalized = rawAddress.replace(/\r/g, '').trim();
  if (!normalized) return {};

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (isHungarianCountry(country)) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\d{4})\s+(.+)$/);
      if (!match) continue;
      const street = lines.filter((_, lineIndex) => lineIndex !== index).join(', ').trim();
      return {
        postalCode: match[1],
        city: match[2].replace(/[;,]+$/, '').trim(),
        address: street || undefined,
      };
    }

    const postalThenStreet = normalized.match(/^(\d{4})\s+([^,;]+)[,;]\s*(.+)$/);
    if (postalThenStreet) {
      return {
        postalCode: postalThenStreet[1],
        city: postalThenStreet[2].trim(),
        address: postalThenStreet[3].trim(),
      };
    }

    const streetThenPostal = normalized.match(/^(.+?)[,;]\s*(\d{4})\s+([^,;]+)$/);
    if (streetThenPostal) {
      return {
        postalCode: streetThenPostal[2],
        city: streetThenPostal[3].trim(),
        address: streetThenPostal[1].trim(),
      };
    }
  }

  return { address: lines.join(', ') };
}

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
  const [billingCountry, setBillingCountry] = useState('HU');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingTaxNumber, setBillingTaxNumber] = useState('');
  const [billingCompanyName, setBillingCompanyName] = useState('');
  const [companyLookupStatus, setCompanyLookupStatus] = useState<CompanyLookupStatus>('idle');
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
    if (!user || mode === 'organization') return;

    let active = true;
    fetch(`${API_BASE}/api/my/billing-profile`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        const profile = (data?.billingProfile || null) as BillingProfile | null;
        if (!profile) return;

        setBillingName(profile.billingName || user.name || '');
        setBillingEmail(profile.billingEmail || user.email || '');
        setBillingCountry(normalizeCountryCode(profile.billingCountry || 'HU'));
        setBillingPostalCode(profile.billingPostalCode || '');
        setBillingCity(profile.billingCity || '');
        setBillingAddress(profile.billingAddress || '');
        setBillingTaxNumber(profile.billingTaxNumber || '');
        setBillingCompanyName(profile.billingCompanyName || '');
      })
      .catch(() => {});

    return () => { active = false; };
  }, [user, mode]);

  useEffect(() => {
    const postalCode = billingPostalCode.trim();
    if (billingCountry !== 'HU' || !/^\d{4}$/.test(postalCode)) return;

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
    if (mode !== 'organization' || !isEuCountry(billingCountry)) {
      setCompanyLookupStatus('idle');
      return;
    }
    const rawTaxNumber = billingTaxNumber.trim();
    const compact = rawTaxNumber.replace(/[^A-Za-z0-9]/g, '');
    const enough = billingCountry === 'HU' ? compact.replace(/^HU/i, '').length >= 8 : compact.length >= 4;
    if (!enough) {
      setCompanyLookupStatus('idle');
      return;
    }
    let active = true;
    setCompanyLookupStatus('loading');
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/api/company-lookup/${encodeURIComponent(billingCountry)}/${encodeURIComponent(rawTaxNumber)}`)
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!active) return;
          if (response.status === 404 || data?.valid === false) {
            setCompanyLookupStatus('invalid');
            return;
          }
          if (!response.ok) {
            setCompanyLookupStatus('error');
            return;
          }
          const companyName = String(data?.companyName || '').trim();
          const companyAddress = String(data?.address || '').trim();
          if (companyName) setBillingCompanyName(companyName);
          if (companyAddress) {
            const parsedAddress = parseCompanyLookupAddress(companyAddress, billingCountry);
            if (parsedAddress.postalCode) setBillingPostalCode(parsedAddress.postalCode);
            if (parsedAddress.city) setBillingCity(parsedAddress.city);
            if (parsedAddress.address) setBillingAddress(parsedAddress.address);
          }
          if (companyName || companyAddress) {
            setCompanyLookupStatus('found');
          } else {
            setCompanyLookupStatus('not-found');
          }
        })
        .catch(() => { if (active) setCompanyLookupStatus('error'); });
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mode, billingCountry, billingTaxNumber]);

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
    if (!user) {
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
          purchaserName,
          purchaserEmail,
          billingName,
          billingEmail,
          billingCountry,
          billingPostalCode,
          billingCity,
          billingAddress,
          billingTaxNumber,
          billingCompanyName,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'PURCHASE_DRAFT_CREATE_FAILED');

      const nextPurchaseId = String(data.purchase?.id || '');
      setPurchaseId(nextPurchaseId || null);
      if (!nextPurchaseId) throw new Error('PURCHASE_ID_MISSING');

      if (paymentCapabilities?.testPaymentEnabled) {
        const testResponse = await fetch(
          `${API_BASE}/api/purchases/${encodeURIComponent(nextPurchaseId)}/test-complete`,
          { method: 'POST', credentials: 'include' }
        );
        const testData = await testResponse.json().catch(() => ({}));
        if (!testResponse.ok) throw new Error(testData?.error || 'TEST_PURCHASE_COMPLETE_FAILED');
        setPaymentSuccess({
          purchaseId: nextPurchaseId,
          provider: 'test',
          giftRedeemPath: testData?.giftRedeemPath || null,
        });
        setPurchaseId(nextPurchaseId);
        return;
      }

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
  const testPaymentEnabled = Boolean(paymentCapabilities?.testPaymentEnabled);

  return (
    <main style={styles.page}>
      <section style={{ ...styles.card, ...(mode === 'gift' ? styles.giftCard : {}) }}>
        <div style={{ ...styles.topRow, ...(mode === 'gift' ? styles.giftTopRow : {}) }}>
          <a href={user ? '/my-books' : '/login'} style={styles.back}>{t('← Vissza')}</a>
          <LanguageSwitcher compact={mode === 'gift'} />
        </div>
        <div style={{ ...styles.brand, ...(mode === 'gift' ? styles.giftBrand : {}) }}>MemoryBook</div>
        <h1 style={{ ...styles.title, ...(mode === 'gift' ? styles.giftTitle : {}) }}>{t('Emlékkönyv vásárlása')}</h1>

        <div style={{ ...styles.switcher, ...(mode === 'gift' ? styles.giftSwitcher : {}) }}>
          <button type="button" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.giftSwitchButton : {}), ...(mode === 'self' ? styles.active : {}) }}>{t('Magamnak')}</button>
          <button type="button" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.giftSwitchButton : {}), ...(mode === 'gift' ? styles.active : {}) }}>{t('Ajándékba')}</button>
          <button type="button" onClick={() => setMode('organization')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.giftSwitchButton : {}), ...(mode === 'organization' ? styles.active : {}) }}>{t('Cég / szervezet')}</button>
        </div>

        {!user && (
          <div style={styles.notice}>
            {t('A vásárláshoz jelentkezz be Google-fiókkal.')}
            <a href={`/login?returnTo=${encodeURIComponent(`/purchase?mode=${mode}`)}`} style={styles.inlineLink}> {t('Belépés Google-fiókkal')}</a>
          </div>
        )}

        {user && (
          <div style={{ ...styles.accountInfo, ...(mode === 'gift' ? styles.giftAccountInfo : {}) }}>
            <strong>{t(mode === 'organization' ? 'Kapcsolattartó' : 'Vásárló')}</strong>
            <span>{user.name || purchaserName}</span>
            <span>{user.email || purchaserEmail}</span>
          </div>
        )}

        {testPaymentEnabled && (
          <div style={styles.testNotice}>{t('Tesztverzió: a fizetési gomb nem terhel pénzt, hanem azonnal létrehozza a könyvjogosultságot.')}</div>
        )}

        <form onSubmit={submit} style={{ ...styles.form, ...(mode === 'gift' ? styles.giftForm : {}) }}>
          <label style={styles.label}>{t('Könyv típusa')}
            <select value={bookType} onChange={(event) => setBookType(event.target.value as BookType)} style={styles.input}>
              <option value="standard">{t('Normál emlékkönyv – 30 oldal')}</option>
              <option value="event">{t('QR-kódos vendégkönyv')}</option>
              <option value="dedication">{t('Dedikálás – 30 oldal')}</option>
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
            <select value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input}>
              {COUNTRY_CODES
                .map((code) => ({ code, label: countryLabel(code, language) }))
                .sort((a, b) => a.label.localeCompare(b.label, language))
                .map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
            </select>
          </label>

          {mode === 'organization' && (
            <>
              <label style={styles.label}>{t(companyTaxLabel(billingCountry))}
                <input
                  value={billingTaxNumber}
                  onChange={(event) => setBillingTaxNumber(event.target.value.toUpperCase())}
                  placeholder={companyTaxPlaceholder(billingCountry)}
                  pattern={isHungarianCountry(billingCountry) ? '[0-9]{8}-[0-9]-[0-9]{2}' : undefined}
                  title={isHungarianCountry(billingCountry) ? t('A magyar adószám formátuma: 12345678-2-42.') : undefined}
                  style={styles.input}
                  required
                />
              </label>
              <label style={styles.label}>{t('Cégnév')}
                <input value={billingCompanyName} onChange={(event) => setBillingCompanyName(event.target.value)} style={styles.input} required />
                {companyLookupStatus === 'loading' && <span style={styles.fieldHint}>{t('Cégadat ellenőrzése...')}</span>}
                {companyLookupStatus === 'found' && <span style={styles.fieldHint}>{t('A cég neve és a rendelkezésre álló címadatok automatikusan kitöltve a VIES adatai alapján.')}</span>}
                {companyLookupStatus === 'not-found' && <span style={styles.fieldHint}>{t('Az adószám érvényes, de a VIES nem adott vissza cégnevet. Add meg kézzel.')}</span>}
                {companyLookupStatus === 'invalid' && <span style={styles.fieldError}>{t('Ez az adószám nem érvényes a VIES rendszerben, vagy nem közösségi adószám.')}</span>}
                {companyLookupStatus === 'error' && <span style={styles.fieldHint}>{t('A cégadat most nem kérdezhető le. A cégnév kézzel is megadható.')}</span>}
              </label>
            </>
          )}

          <div style={styles.twoCols}>
            <label style={styles.label}>{t('Irányítószám')}
              <input
                value={billingPostalCode}
                inputMode={isHungarianCountry(billingCountry) ? 'numeric' : undefined}
                onChange={(event) => setBillingPostalCode(event.target.value)}
                style={styles.input}
                required
              />
            </label>
            <label style={styles.label}>{t('Település')}
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} required />
            </label>
          </div>
          <label style={styles.label}>{t('Cím')}
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} required />
          </label>

          {mode !== 'organization' && (
            <>
              <label style={styles.label}>{t('Számlázási név')}
                <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} required />
              </label>
              <label style={styles.label}>{t('Számlázási e-mail')}
                <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} required />
              </label>
            </>
          )}

          {mode === 'gift' && <div style={{ ...styles.giftInfo, ...styles.giftInfoCompact }}>{t('Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.')}</div>}
          {notice && <div style={styles.notice}>{notice}</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || !user} style={styles.primaryButton}>
            {loading
              ? t('Folyamatban...')
              : testPaymentEnabled
                ? t('Tesztfizetés – könyvjogosultság létrehozása')
              : provider === 'simplepay' && simplePayReady
                ? t('Tovább a SimplePay fizetéshez')
                : provider === 'paypal' && paypalReady
                  ? t('Tovább a PayPal fizetéshez')
                  : t('Fizetés')}
          </button>
        </form>

        {paymentSuccess && (
          <div style={styles.success}>
            <strong>{t(paymentSuccess.provider === 'test' ? 'A tesztfizetés sikeres. A könyvjogosultság létrejött.' : paymentSuccess.provider === 'simplepay' ? 'A SimplePay fizetés sikeres. A könyvjogosultság létrejött.' : 'A PayPal fizetés sikeres. A könyvjogosultság létrejött.')}</strong><br />
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
  giftCard: { padding: 7 },
  giftTopRow: { marginBottom: 0 },
  back: { display: 'inline-flex', minHeight: 36, alignItems: 'center', color: '#475569', textDecoration: 'none', fontWeight: 700, fontSize: 14 },
  brand: { marginTop: 0, color: '#64748b', fontWeight: 800, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  giftBrand: { lineHeight: 1.1 },
  title: { margin: '3px 0', color: '#0f172a', fontSize: 'clamp(23px,7vw,32px)' },
  giftTitle: { margin: '1px 0', fontSize: 'clamp(22px,6.5vw,29px)', lineHeight: 1.1 },
  lead: { margin: '0 0 9px', color: '#64748b', lineHeight: 1.35, fontSize: 14 },
  switcher: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, marginBottom: 8, padding: 2, background: '#e2e8f0', borderRadius: 9 },
  giftSwitcher: { marginBottom: 5 },
  switchButton: { minHeight: 38, padding: '2px', border: 0, borderRadius: 7, background: 'transparent', fontWeight: 800, color: '#475569', fontSize: 11.5, lineHeight: 1.15 },
  giftSwitchButton: { minHeight: 34 },
  active: { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,.12)' },
  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },
  testNotice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#eff6ff', color: '#1e40af', lineHeight: 1.35, fontSize: 13, fontWeight: 700 },
  giftRecipientBox: { display: 'grid', gap: 6, padding: 9, borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0' },
  fieldHint: { gridColumn: '2', display: 'block', marginTop: 2, color: '#64748b', fontSize: 11.5, lineHeight: 1.3, fontWeight: 500 },
  fieldError: { gridColumn: '2', display: 'block', marginTop: 2, color: '#b91c1c', fontSize: 11.5, lineHeight: 1.3, fontWeight: 600 },
  accountInfo: { display: 'flex', flexWrap: 'wrap', gap: '2px 8px', marginBottom: 6, padding: '6px 8px', borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, overflowWrap: 'anywhere' },
  giftAccountInfo: { marginBottom: 4, padding: '4px 7px' },
  inlineLink: { color: '#166534', fontWeight: 800 },
  form: { display: 'flex', flexDirection: 'column', gap: 5 },
  giftForm: { gap: 4 },
  label: { display: 'grid', gridTemplateColumns: 'minmax(105px, 38%) minmax(0, 1fr)', alignItems: 'center', gap: '3px 8px', color: '#334155', fontSize: 12.5, lineHeight: 1.15, fontWeight: 700, minWidth: 0 },
  input: { width: '100%', minHeight: 34, padding: '4px 7px', border: '1px solid #cbd5e1', borderRadius: 7, boxSizing: 'border-box', fontSize: 14, background: '#fff' },
  sectionTitle: { marginTop: 2, color: '#0f172a', fontWeight: 800, fontSize: 15 },
  twoCols: { display: 'grid', gridTemplateColumns: '1fr', gap: 5 },
  giftInfo: { padding: 9, borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 13, lineHeight: 1.35 },
  giftInfoCompact: { padding: 6, fontSize: 12, lineHeight: 1.25 },
  error: { padding: 9, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 15 },
  success: { marginTop: 10, padding: 10, borderRadius: 9, background: '#ecfdf5', color: '#166534', lineHeight: 1.4, fontSize: 13, overflowWrap: 'anywhere' },
};
