import { useEffect, useMemo, useState } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://' + window.location.hostname + ':3001' : '';

type OwnerStatus = 'pending' | 'kept' | 'rejected';
type Contribution = {
  id: string;
  contributorName: string;
  memoryText: string;
  photoUrl: string | null;
  ownerStatus?: OwnerStatus;
  createdAt: string;
};
type ContributionsResponse = {
  book: { id: string; title: string; bookType?: string };
  contributions: Contribution[];
};
type Props = { bookId: string };

export function OrganizerContributionsPage({ bookId }: Props) {
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | OwnerStatus>('pending');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`, { credentials: 'include' });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (!response.ok) throw new Error('LOAD_FAILED');
        setData(await response.json());
      } catch (err) {
        console.error(err);
        setError('A beérkezett bejegyzéseket nem sikerült betölteni.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [bookId]);

  const counts = useMemo(() => {
    const list = data?.contributions ?? [];
    return {
      all: list.length,
      pending: list.filter((c) => (c.ownerStatus || 'pending') === 'pending').length,
      kept: list.filter((c) => c.ownerStatus === 'kept').length,
      rejected: list.filter((c) => c.ownerStatus === 'rejected').length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.contributions ?? [];
    return filter === 'all' ? list : list.filter((c) => (c.ownerStatus || 'pending') === filter);
  }, [data, filter]);

  const setStatus = async (contribution: Contribution, ownerStatus: OwnerStatus) => {
    try {
      setWorkingId(contribution.id);
      setError(null);
      const response = await fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/contributions/${encodeURIComponent(contribution.id)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerStatus }),
      });
      if (response.status === 401) { window.location.href = '/login'; return; }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.contribution) throw new Error('UPDATE_FAILED');
      setData((current) => current ? { ...current, contributions: current.contributions.map((item) => item.id === contribution.id ? result.contribution : item) } : current);
    } catch (err) {
      console.error(err);
      setError('A bejegyzés állapotát nem sikerült módosítani.');
    } finally {
      setWorkingId(null);
    }
  };

  if (loading) return <div style={styles.message}>Bejegyzések betöltése...</div>;
  if (error && !data) return <div style={styles.message}>{error}</div>;
  if (!data) return <div style={styles.message}>A könyv nem található.</div>;

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <a href={`/my-books/${encodeURIComponent(bookId)}`} style={styles.back}>← Vissza a könyvhöz</a>
        <div style={styles.eyebrow}>MemoryBook · rendezvény</div>
        <h1 style={styles.title}>{data.book.title}</h1>
        <p style={styles.intro}>Itt te döntöd el, mely vendégbejegyzéseket tartod meg. A megtartott anyagokból később kézzel vagy AI-segítséggel lehet a végleges könyv oldalait megszervezni.</p>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.filters}>
          <FilterButton active={filter === 'pending'} onClick={() => setFilter('pending')}>Új ({counts.pending})</FilterButton>
          <FilterButton active={filter === 'kept'} onClick={() => setFilter('kept')}>Megtartott ({counts.kept})</FilterButton>
          <FilterButton active={filter === 'rejected'} onClick={() => setFilter('rejected')}>Elutasított ({counts.rejected})</FilterButton>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>Összes ({counts.all})</FilterButton>
        </div>

        {visible.length === 0 ? (
          <div style={styles.empty}>Ebben a csoportban nincs bejegyzés.</div>
        ) : (
          <div style={styles.list}>
            {visible.map((contribution) => {
              const status = contribution.ownerStatus || 'pending';
              const working = workingId === contribution.id;
              return (
                <article key={contribution.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <strong style={styles.name}>{contribution.contributorName}</strong>
                    <span style={styles.status}>{statusLabel(status)}</span>
                  </div>
                  <div style={styles.date}>{new Date(contribution.createdAt).toLocaleString('hu-HU')}</div>
                  <p style={styles.memory}>{contribution.memoryText}</p>
                  {contribution.photoUrl && <img src={contribution.photoUrl} alt={`${contribution.contributorName} fotója`} style={styles.photo} />}
                  <div style={styles.actions}>
                    <button type="button" disabled={working || status === 'kept'} onClick={() => setStatus(contribution, 'kept')} style={styles.keepButton}>{working ? 'Folyamatban...' : 'Megtartom'}</button>
                    <button type="button" disabled={working || status === 'rejected'} onClick={() => setStatus(contribution, 'rejected')} style={styles.rejectButton}>Elutasítom</button>
                    {status !== 'pending' && <button type="button" disabled={working} onClick={() => setStatus(contribution, 'pending')} style={styles.resetButton}>Vissza az új bejegyzésekhez</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} style={active ? { ...styles.filterButton, ...styles.filterActive } : styles.filterButton}>{children}</button>;
}
function statusLabel(status: OwnerStatus) {
  if (status === 'kept') return 'Megtartva';
  if (status === 'rejected') return 'Elutasítva';
  return 'Új';
}
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '18px 12px 40px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  container: { width: '100%', maxWidth: 860, margin: '0 auto' },
  back: { display: 'inline-flex', alignItems: 'center', minHeight: 44, marginBottom: 10, color: '#475569', textDecoration: 'none', fontWeight: 800 },
  eyebrow: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: '#64748b' },
  title: { margin: '7px 0', color: '#0f172a', fontSize: 'clamp(26px, 8vw, 38px)', lineHeight: 1.12, overflowWrap: 'anywhere' },
  intro: { maxWidth: 740, margin: '0 0 20px', color: '#475569', lineHeight: 1.55 },
  error: { marginBottom: 14, padding: 12, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  filterButton: { minHeight: 44, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 999, background: '#ffffff', color: '#334155', fontWeight: 800, cursor: 'pointer' },
  filterActive: { background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' },
  empty: { padding: 24, borderRadius: 14, background: '#ffffff', color: '#64748b', textAlign: 'center' },
  list: { display: 'grid', gap: 14 },
  card: { padding: 16, borderRadius: 14, background: '#ffffff', boxShadow: '0 6px 20px rgba(15,23,42,.07)', overflow: 'hidden' },
  cardHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { color: '#0f172a', fontSize: 18 },
  status: { padding: '4px 8px', borderRadius: 999, background: '#e2e8f0', color: '#475569', fontSize: 12, fontWeight: 800 },
  date: { marginTop: 5, color: '#94a3b8', fontSize: 12 },
  memory: { margin: '14px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#334155', lineHeight: 1.6 },
  photo: { display: 'block', width: '100%', maxHeight: 420, marginTop: 14, borderRadius: 10, objectFit: 'contain', background: '#f8fafc' },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8, marginTop: 16 },
  keepButton: { minHeight: 46, border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  rejectButton: { minHeight: 46, border: '1px solid #fecaca', borderRadius: 8, background: '#fff7f7', color: '#b91c1c', fontWeight: 800, cursor: 'pointer' },
  resetButton: { minHeight: 46, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#334155', fontWeight: 800, cursor: 'pointer' },
  message: { padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' },
};
