import { useRef, useState } from 'react';
import './wedding.css';

// Fragment is not sent in HTTP requests or access logs. Remove it on first load.
const invitation = new URLSearchParams(window.location.hash.slice(1)).get('invite') || '';
if (window.location.pathname === '/wedding/owner-invite' && window.location.hash) window.history.replaceState(null, '', window.location.pathname);
export function PilotInvitePage() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  async function redeem() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/pilot/redeem', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: invitation }) });
      if (!response.ok) {
        if (response.status === 401) throw new Error('A meghívó lejárt vagy már felhasználták. Kérj új tulajdonosi meghívót.');
        throw new Error('Most nem sikerült megnyitni. Próbáld újra.');
      }
      window.location.replace('/wedding');
    } catch (e) { setError(e instanceof Error ? e.message : 'Kapcsolati hiba. Próbáld újra.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className="wedding"><div className="wedding-shell"><section className="wedding-card">
    <h1>Esküvői tesztkönyved</h1><p>Ez a meghívó a privát tulajdonosi felületet nyitja meg. Jelszó nem szükséges.</p>
    {error && <p role="alert">{error}</p>}
    {invitation ? <button disabled={busy} onClick={() => void redeem()}>{busy ? 'Megnyitás…' : 'Tulajdonosi felület megnyitása'}</button>
      : <p>Nyisd meg a neked adott teljes meghívólinket.</p>}
    <p><a href="/wedding">Már megnyitottam a könyvemet ezen az eszközön</a></p>
  </section></div></main>;
}
