import { useState } from 'react';
import type { AppLanguage } from '../i18n';
import { ownerLocale } from '../ownerUiI18n';
import { trialCopy } from './trial-copy';
import type { TrialAccess } from './trial-access';

export function CollectionTrialExit({ language }: { language: AppLanguage }) {
  const t = trialCopy[language], [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function leave() {
    setBusy(true); setError(false);
    try {
      const response = await fetch('/api/pilot/collection-trial/leave', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('LEAVE_FAILED');
      window.location.replace('/collection/try');
    } catch { setError(true); setBusy(false); }
  }
  return <div>{error && <p role="alert">{t.leaveFailed}</p>}<button type="button" disabled={busy} onClick={() => void leave()}>{busy ? t.leaving : t.leave}</button></div>;
}
export function CollectionTrialBanner({ language, trial, denied }: { language: AppLanguage; trial: TrialAccess | null; denied: boolean }) {
  const t = trialCopy[language];
  if (!trial && !denied) return null;
  return <aside className="collection-panel" aria-label={t.banner} style={{ border: '2px solid #b7791f', background: '#fff9e8', padding: 16, margin: '12px 0' }}>
    <strong>{t.banner}</strong><p>{denied ? t.expired : t.scope}</p>
    {trial && <p>{t.expiry}: {new Date(trial.expiresAt).toLocaleString(ownerLocale(language))}</p>}
    <CollectionTrialExit language={language} />
  </aside>;
}
