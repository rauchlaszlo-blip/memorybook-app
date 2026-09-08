import { useEffect, useMemo, useState } from 'react';
import { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type OwnerStatus = 'pending' | 'kept' | 'rejected';
type Contribution = {
  id: string;
  contributorName: string;
  memoryText: string;
  photoUrl: string | null;
  ownerStatus?: OwnerStatus;
  ownerGroup?: string | null;
  ownerOrder?: number | null;
  createdAt: string;
};
type ContributionsResponse = {
  book: { id: string; title: string; bookType?: string };
  contributions: Contribution[];
};
type Props = { bookId: string };

export function OrganizerContributionsPage({ bookId }: Props) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [filter, setFilter] = useState<'all' | OwnerStatus>('pending');
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`,
          { credentials: 'include' }
        );
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!response.ok) throw new Error('LOAD_FAILED');
        const result = await response.json();
        setData(result);
        setGroupDrafts(
          Object.fromEntries(
            (result.contributions || []).map((item: Contribution) => [
              item.id,
              item.ownerGroup || '',
            ])
          )
        );
      } catch (err) {
        console.error(err);
        setError(t('A beérkezett bejegyzéseket nem sikerült betölteni.'));
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

  const keptSorted = useMemo(() => {
    return (data?.contributions ?? [])
      .filter((c) => c.ownerStatus === 'kept')
      .slice()
      .sort((a, b) => {
        const ao = a.ownerOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.ownerOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.contributions ?? [];
    if (filter === 'kept') return keptSorted;
    return filter === 'all'
      ? list
      : list.filter((c) => (c.ownerStatus || 'pending') === filter);
  }, [data, filter, keptSorted]);

  const replaceContribution = (updated: Contribution) => {
    setData((current) =>
      current
        ? {
            ...current,
            contributions: current.contributions.map((item) =>
              item.id === updated.id ? updated : item
            ),
          }
        : current
    );
    setGroupDrafts((current) => ({
      ...current,
      [updated.id]: updated.ownerGroup || '',
    }));
  };

  const setStatus = async (
    contribution: Contribution,
    ownerStatus: OwnerStatus
  ) => {
    try {
      setWorkingId(contribution.id);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/contributions/${encodeURIComponent(contribution.id)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerStatus }),
        }
      );
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.contribution) throw new Error('UPDATE_FAILED');
      replaceContribution(result.contribution);
    } catch (err) {
      console.error(err);
      setError(t('A bejegyzés állapotát nem sikerült módosítani.'));
    } finally {
      setWorkingId(null);
    }
  };

  const saveGroup = async (contribution: Contribution) => {
    try {
      setWorkingId(contribution.id);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/contributions/${encodeURIComponent(contribution.id)}/group`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerGroup: groupDrafts[contribution.id] || '' }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.contribution) throw new Error('GROUP_UPDATE_FAILED');
      replaceContribution(result.contribution);
    } catch (err) {
      console.error(err);
      setError(t('A csoport/tematika mentése nem sikerült.'));
    } finally {
      setWorkingId(null);
    }
  };

  const moveKept = async (contributionId: string, delta: -1 | 1) => {
    const index = keptSorted.findIndex((item) => item.id === contributionId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= keptSorted.length) return;

    const orderedIds = keptSorted.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];

    try {
      setReordering(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/contributions/reorder`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contributionIds: orderedIds }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.order)) {
        throw new Error('REORDER_FAILED');
      }

      const orderMap = new Map(
        result.order.map((item: { id: string; ownerOrder: number }) => [
          item.id,
          item.ownerOrder,
        ])
      );
      setData((current) =>
        current
          ? {
              ...current,
              contributions: current.contributions.map((item) =>
                orderMap.has(item.id)
                  ? { ...item, ownerOrder: orderMap.get(item.id) as number }
                  : item
              ),
            }
          : current
      );
    } catch (err) {
      console.error(err);
      setError(t('A sorrend mentése nem sikerült.'));
    } finally {
      setReordering(false);
    }
  };

  if (loading) return <div style={styles.message}>{t('Bejegyzések betöltése...')}</div>;
  if (error && !data) return <div style={styles.message}>{error}</div>;
  if (!data) return <div style={styles.message}>{t('A könyv nem található.')}</div>;

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <a
          href={`/my-books/${encodeURIComponent(bookId)}`}
          style={styles.back}
        >
          {t('← Vissza a könyvhöz')}
        </a>
        <div style={styles.eyebrow}>{t('MemoryBook · rendezvény')}</div>
        <h1 style={styles.title}>{data.book.title}</h1>
        <p style={styles.intro}>
          {t('Itt te döntöd el, mely vendégbejegyzéseket tartod meg. A megtartott anyagokat kézzel rendezheted; később az AI javasolhat csoportokat és sorrendet, de nem dönt helyetted.')}
        </p>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.filters}>
          <FilterButton active={filter === 'pending'} onClick={() => setFilter('pending')}>
            {t('Új')} ({counts.pending})
          </FilterButton>
          <FilterButton active={filter === 'kept'} onClick={() => setFilter('kept')}>
            {t('Megtartott')} ({counts.kept})
          </FilterButton>
          <FilterButton active={filter === 'rejected'} onClick={() => setFilter('rejected')}>
            {t('Elutasított')} ({counts.rejected})
          </FilterButton>
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            {t('Összes')} ({counts.all})
          </FilterButton>
        </div>

        {filter === 'kept' && (
          <section style={styles.organizationPanel}>
            <div>
              <strong style={styles.organizationTitle}>{t('Megtartott bejegyzések rendezése')}</strong>
              <div style={styles.organizationText}>
                {t('A ↑ / ↓ gombokkal állítsd be a sorrendet. A „Csoport / tematika” mezővel például Család, Barátok, Kollégák vagy Esti pillanatok csoportot adhatsz meg.')}
              </div>
            </div>
            <div style={styles.aiBox}>
              <strong>{t('AI-rendszerezési javaslat – később')}</strong>
              <span>
                {t('Az AI csak javasolhat csoportokat és sorrendet. Minden változtatást a tulajdonos hagy jóvá.')}
              </span>
            </div>
          </section>
        )}

        {visible.length === 0 ? (
          <div style={styles.empty}>{t('Ebben a csoportban nincs bejegyzés.')}</div>
        ) : (
          <div style={styles.list}>
            {visible.map((contribution) => {
              const status = contribution.ownerStatus || 'pending';
              const working = workingId === contribution.id;
              const keptIndex = keptSorted.findIndex(
                (item) => item.id === contribution.id
              );
              return (
                <article key={contribution.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <div style={styles.nameRow}>
                      <strong style={styles.name}>{contribution.contributorName}</strong>
                      {status === 'kept' && (
                        <span style={styles.orderBadge}>
                          #{contribution.ownerOrder ?? keptIndex + 1}
                        </span>
                      )}
                    </div>
                    <span style={styles.status}>{statusLabel(status, language)}</span>
                  </div>
                  <div style={styles.date}>
                    {new Date(contribution.createdAt).toLocaleString(ownerLocale(language))}
                  </div>
                  <p style={styles.memory}>{contribution.memoryText}</p>
                  {contribution.photoUrl && (
                    <img
                      src={contribution.photoUrl}
                      alt={f('{name} fotója', { name: contribution.contributorName })}
                      style={styles.photo}
                    />
                  )}

                  {status === 'kept' && (
                    <div style={styles.organizeCard}>
                      <label style={styles.groupLabel}>
                        {t('Csoport / tematika')}
                        <input
                          type="text"
                          maxLength={80}
                          value={groupDrafts[contribution.id] ?? contribution.ownerGroup ?? ''}
                          onChange={(event) =>
                            setGroupDrafts((current) => ({
                              ...current,
                              [contribution.id]: event.target.value,
                            }))
                          }
                          placeholder={t('Például: Család')}
                          style={styles.groupInput}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => saveGroup(contribution)}
                        disabled={working}
                        style={styles.groupSaveButton}
                      >
                        {t('Tematika mentése')}
                      </button>
                      <div style={styles.orderActions}>
                        <button
                          type="button"
                          aria-label={t('Bejegyzés feljebb')}
                          onClick={() => moveKept(contribution.id, -1)}
                          disabled={reordering || keptIndex <= 0}
                          style={styles.orderButton}
                        >
                          {t('↑ Feljebb')}
                        </button>
                        <button
                          type="button"
                          aria-label={t('Bejegyzés lejjebb')}
                          onClick={() => moveKept(contribution.id, 1)}
                          disabled={reordering || keptIndex < 0 || keptIndex >= keptSorted.length - 1}
                          style={styles.orderButton}
                        >
                          {t('↓ Lejjebb')}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={styles.actions}>
                    <button
                      type="button"
                      disabled={working || status === 'kept'}
                      onClick={() => setStatus(contribution, 'kept')}
                      style={styles.keepButton}
                    >
                      {working ? t('Folyamatban...') : t('Megtartom')}
                    </button>
                    <button
                      type="button"
                      disabled={working || status === 'rejected'}
                      onClick={() => setStatus(contribution, 'rejected')}
                      style={styles.rejectButton}
                    >
                      {t('Elutasítom')}
                    </button>
                    {status !== 'pending' && (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => setStatus(contribution, 'pending')}
                        style={styles.resetButton}
                      >
                        {t('Vissza az új bejegyzésekhez')}
                      </button>
                    )}
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

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={
        active ? { ...styles.filterButton, ...styles.filterActive } : styles.filterButton
      }
    >
      {children}
    </button>
  );
}

function statusLabel(status: OwnerStatus, language: import('./i18n').AppLanguage) {
  if (status === 'kept') return ownerText(language, 'Megtartva');
  if (status === 'rejected') return ownerText(language, 'Elutasítva');
  return ownerText(language, 'Új');
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '18px 12px 40px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: { width: '100%', maxWidth: 860, margin: '0 auto' },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 10,
    color: '#475569',
    textDecoration: 'none',
    fontWeight: 800,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#64748b',
  },
  title: {
    margin: '7px 0',
    color: '#0f172a',
    fontSize: 'clamp(26px, 8vw, 38px)',
    lineHeight: 1.12,
    overflowWrap: 'anywhere',
  },
  intro: {
    maxWidth: 740,
    margin: '0 0 20px',
    color: '#475569',
    lineHeight: 1.55,
  },
  error: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
  },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  filterButton: {
    minHeight: 44,
    padding: '8px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 999,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
  },
  filterActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  organizationPanel: {
    display: 'grid',
    gap: 12,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 20px rgba(15,23,42,.06)',
  },
  organizationTitle: { display: 'block', color: '#0f172a', fontSize: 17 },
  organizationText: { marginTop: 5, color: '#475569', lineHeight: 1.5, fontSize: 14 },
  aiBox: {
    display: 'grid',
    gap: 4,
    padding: 12,
    borderRadius: 10,
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.45,
  },
  empty: {
    padding: 24,
    borderRadius: 14,
    background: '#ffffff',
    color: '#64748b',
    textAlign: 'center',
  },
  list: { display: 'grid', gap: 14 },
  card: {
    padding: 16,
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 20px rgba(15,23,42,.07)',
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  name: { color: '#0f172a', fontSize: 18 },
  orderBadge: {
    padding: '3px 7px',
    borderRadius: 999,
    background: '#dbeafe',
    color: '#1e40af',
    fontSize: 12,
    fontWeight: 800,
  },
  status: {
    padding: '4px 8px',
    borderRadius: 999,
    background: '#e2e8f0',
    color: '#475569',
    fontSize: 12,
    fontWeight: 800,
  },
  date: { marginTop: 5, color: '#94a3b8', fontSize: 12 },
  memory: {
    margin: '14px 0 0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: '#334155',
    lineHeight: 1.6,
  },
  photo: {
    display: 'block',
    width: '100%',
    maxHeight: 420,
    marginTop: 14,
    borderRadius: 10,
    objectFit: 'contain',
    background: '#f8fafc',
  },
  organizeCard: {
    display: 'grid',
    gap: 8,
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    background: '#f8fafc',
  },
  groupLabel: {
    display: 'grid',
    gap: 6,
    color: '#475569',
    fontSize: 13,
    fontWeight: 800,
  },
  groupInput: {
    width: '100%',
    minHeight: 46,
    padding: '10px 11px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#0f172a',
    fontSize: 16,
    boxSizing: 'border-box',
  },
  groupSaveButton: {
    minHeight: 46,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
  },
  orderActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  orderButton: {
    minHeight: 46,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 8,
    marginTop: 16,
  },
  keepButton: {
    minHeight: 46,
    border: 0,
    borderRadius: 8,
    background: '#0f172a',
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  },
  rejectButton: {
    minHeight: 46,
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fff7f7',
    color: '#b91c1c',
    fontWeight: 800,
    cursor: 'pointer',
  },
  resetButton: {
    minHeight: 46,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
  },
  message: { padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' },
};
