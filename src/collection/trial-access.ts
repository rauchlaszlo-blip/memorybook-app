import { useEffect, useState } from 'react';
export type TrialAccess = { bookId: string; expiresAt: string };
export function useCollectionTrial() {
  const [access, setAccess] = useState<{ loaded: boolean; trial: TrialAccess | null; denied: boolean }>({ loaded: false, trial: null, denied: false });
  useEffect(() => {
    let active = true, busy = false;
    const read = async () => {
      if (busy) return; busy = true;
      try {
        const response = await fetch('/api/pilot/collection-trial/session', { credentials: 'same-origin' });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (!response.ok) { setAccess({ loaded: true, trial: null, denied: body?.error === 'COLLECTION_TRIAL_DENIED' || response.headers.get('X-MemoryBook-Access') === 'collection-trial' }); return; }
        setAccess({ loaded: true, trial: body?.trial || null, denied: false });
      } catch { if (active) setAccess(current => ({ ...current, loaded: true })); }
      finally { busy = false; }
    };
    void read(); const focus = () => { if (!document.hidden) void read(); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { active = false; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, []);
  return access;
}
