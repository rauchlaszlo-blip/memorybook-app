import { useEffect, useState } from 'react';
import { useOwnerUiLanguage } from '../ownerUiI18n';
import { trialCopy } from './trial-copy';
import { CollectionTrialExit } from './CollectionTrialBanner';
import './owner-collection.css';

function captureKey() {
  if (window.location.pathname !== '/collection/try') return '';
  const key = new URLSearchParams(window.location.hash.slice(1)).get('key') || '';
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  return key;
}
let key = captureKey(), generation = 0;
let redemption: Promise<string> | undefined;
function redeem() {
  redemption ??= (async () => {
    if (!/^[A-Za-z\d_-]{43}$/.test(key)) throw new Error('INVALID_LINK');
    const secret = key; key = '';
    const response = await fetch('/api/pilot/collection-trial/redeem', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: secret }) });
    if (!response.ok) throw new Error([401, 403, 404, 410].includes(response.status) ? 'INVALID_LINK' : 'UNAVAILABLE');
    const result = await response.json();
    if (result.success !== true || typeof result.bookId !== 'string' || !/^[A-Za-z\d_-]{1,200}$/.test(result.bookId) || result.redirectTo !== `/my-books/${result.bookId}/materials`) throw new Error('INVALID_REPLY');
    return result.redirectTo as string;
  })();
  return redemption;
}
export function CollectionTrialPage() {
  const language = useOwnerUiLanguage(), t = trialCopy[language], [error, setError] = useState<'invalid' | 'failed' | null>(null);
  useEffect(() => {
    let active = true;
    function start() {
      const attempt = generation;
      void redeem().then(path => { if (active && attempt === generation) window.location.replace(path); }).catch(reason => { if (active && attempt === generation) setError(reason instanceof Error && reason.message === 'INVALID_LINK' ? 'invalid' : 'failed'); });
    }
    const reopen = () => { if (!window.location.hash) return; key = captureKey(); redemption = undefined; generation++; setError(null); start(); };
    start(); window.addEventListener('hashchange', reopen);
    return () => { active = false; window.removeEventListener('hashchange', reopen); };
  }, []);
  return <main className="collection-owner" lang={language}><section className="collection-panel"><h1>{t.heading}</h1>{error ? <><p role="alert">{t[error]}</p><CollectionTrialExit language={language} /></> : <p role="status">{t.opening}</p>}</section></main>;
}
