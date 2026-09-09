import { useEffect, useState } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type GiftInfo = {
  bookType: 'standard' | 'event' | string;
  includedPages: number;
  claimStatus: 'available' | 'claimed' | 'redeemed' | string;
  recipientName?: string | null;
  recipientEmailMasked?: string | null;
};

export function GiftRedeemPage({ token }: { token: string }) {
  const language = usePublicUiLanguage();
  const t = (key: string) => publicText(language, key);
  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);
  const [info, setInfo] = useState<GiftInfo | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/gift-entitlements/${encodeURIComponent(token)}`).then(async (response) => {
        if (!response.ok) throw new Error('GIFT_NOT_FOUND');
        return response.json();
      }),
      fetch(`${API_BASE}/api/me`, { credentials: 'include' }).then((response) => response.ok),
    ])
      .then(([gift, isLoggedIn]) => { setInfo(gift); setLoggedIn(isLoggedIn); })
      .catch(() => setError(t('Ez az ajándék-jogosultság nem található vagy még nincs kifizetve.')))
      .finally(() => setLoading(false));
  }, [token]);

  const redeem = async () => {
    try {
      setWorking(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/gift-entitlements/${encodeURIComponent(token)}/redeem`, { method: 'POST', credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.href = `/login?returnTo=${encodeURIComponent(`/gift/${token}`)}`;
        return;
      }
      if (!response.ok) throw new Error(data?.error || 'REDEEM_FAILED');
      window.location.href = '/my-books';
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message === 'GIFT_RECIPIENT_ACCOUNT_MISMATCH'
          ? t('Ezt az ajándékot másik e-mail címhez rendelték. A megadott Google-fiókkal lépj be.')
          : err?.message === 'GIFT_ENTITLEMENT_ALREADY_CLAIMED'
            ? t('Ezt az ajándékot már másik fiók beváltotta.')
            : t('Az ajándék beváltása nem sikerült.')
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.languageRow}><LanguageSwitcher /></div>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{t('Ajándék emlékkönyv')}</h1>
        {loading && <div>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}
        {!loading && info && (
          <>
            <p style={styles.text}>
              {info.bookType === 'event' ? t('Rendezvény-vendégkönyv') : f('Normál emlékkönyv – {count} oldal', { count: info.includedPages })}
            </p>
            {info.recipientName && <p style={styles.text}><strong>{f('Ajándékozott: {name}', { name: info.recipientName })}</strong></p>}
            {info.recipientEmailMasked && <p style={styles.text}>{f('A megadott Google-fiókkal váltható be: {email}', { email: info.recipientEmailMasked })}</p>}
            {info.claimStatus === 'available' ? (
              loggedIn ? (
                <button type="button" onClick={redeem} disabled={working} style={styles.primaryButton}>{working ? t('Beváltás...') : t('Ajándék beváltása')}</button>
              ) : (
                <a href={`/login?returnTo=${encodeURIComponent(`/gift/${token}`)}`} style={styles.primaryLink}>{t('Belépés / regisztráció a beváltáshoz')}</a>
              )
            ) : (
              <div style={styles.notice}>{info.claimStatus === 'redeemed' ? t('Ezzel a jogosultsággal a könyvet már létrehozták.') : t('Ezt az ajándékot már egy fiókhoz hozzárendelték.')}</div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },
  card: { width: '100%', maxWidth: 500, padding: 24, background: '#fff', borderRadius: 16, boxSizing: 'border-box', boxShadow: '0 12px 34px rgba(15,23,42,.1)' },
  brand: { color: '#64748b', fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '7px 0 10px', color: '#0f172a', fontSize: 30 },
  text: { color: '#475569', lineHeight: 1.5 },
  error: { marginTop: 12, padding: 12, borderRadius: 9, background: '#fef2f2', color: '#991b1b' },
  notice: { padding: 12, borderRadius: 9, background: '#f8fafc', color: '#475569' },
  primaryButton: { width: '100%', minHeight: 48, border: 0, borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 16 },
  primaryLink: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 14px', borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, textDecoration: 'none', textAlign: 'center' },
};
