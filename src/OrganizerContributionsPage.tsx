import { useEffect, useMemo, useState } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type ContributionStatus = 'pending' | 'approved' | 'rejected';

type Contribution = {
  id: string;
  contributorName: string;
  memoryText: string;
  photoUrl: string | null;
  ownerStatus: ContributionStatus;
  reviewedAt: string | null;
  createdAt: string;
};

type ContributionsResponse = {
  book: {
    id: string;
    title: string;
  };
  contributions: Contribution[];
};

type OrganizerContributionsPageProps = {
  bookId: string;
};

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

export function OrganizerContributionsPage({
  bookId,
}: OrganizerContributionsPageProps) {
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');

  useEffect(() => {
    const loadContributions = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/books/${encodeURIComponent(bookId)}/contributions`,
          { credentials: 'include' }
        );

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('CONTRIBUTIONS_LOAD_FAILED');
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        console.error(err);
        setError('A vendégbejegyzéseket nem sikerült betölteni.');
      } finally {
        setLoading(false);
      }
    };

    loadContributions();
  }, [bookId]);

  const counts = useMemo(() => {
    const items = data?.contributions ?? [];
    return {
      pending: items.filter((item) => item.ownerStatus === 'pending').length,
      approved: items.filter((item) => item.ownerStatus === 'approved').length,
      rejected: items.filter((item) => item.ownerStatus === 'rejected').length,
      all: items.length,
    };
  }, [data]);

  const visibleContributions = useMemo(() => {
    const items = data?.contributions ?? [];
    return filter === 'all'
      ? items
      : items.filter((item) => item.ownerStatus === filter);
  }, [data, filter]);

  const updateStatus = async (
    contribution: Contribution,
    status: ContributionStatus
  ) => {
    if (contribution.ownerStatus === status) return;

    try {
      setWorkingId(contribution.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/contributions/${encodeURIComponent(contribution.id)}/status`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.contribution) {
        throw new Error(result?.error || 'CONTRIBUTION_STATUS_UPDATE_FAILED');
      }

      setData((current) =>
        current
          ? {
              ...current,
              contributions: current.contributions.map((item) =>
                item.id === contribution.id ? result.contribution : item
              ),
            }
          : current
      );
    } catch (err) {
      console.error(err);
      setError('A bejegyzés állapotát nem sikerült módosítani.');
    } finally {
      setWorkingId(null);
    }
  };

  if (loading) {
    return <div style={styles.message}>Vendégbejegyzések betöltése...</div>;
  }

  if (!data) {
    return <div style={styles.message}>{error || 'A könyv nem található.'}</div>;
  }

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <a href={`/my-books/${encodeURIComponent(bookId)}`} style={styles.backLink}>
          ← Vissza a könyvhöz
        </a>

        <div style={styles.eyebrow}>MemoryBook rendezvény vendégkönyv</div>
        <h1 style={styles.title}>{data.book.title}</h1>
        <p style={styles.intro}>
          Itt döntöd el, mely vendégbejegyzések kerüljenek be a kész könyvbe.
          A jóváhagyott bejegyzések automatikusan megjelennek a könyv végén.
        </p>

        <div style={styles.topActions}>
          <a href={`/book/${encodeURIComponent(bookId)}/view`} style={styles.bookLink}>
            Kész könyv megnyitása
          </a>
          <a href={`/my-books/${encodeURIComponent(bookId)}/event-qr`} style={styles.secondaryLink}>
            QR-kód megnyitása
          </a>
        </div>

        <div style={styles.filters} role="tablist" aria-label="Vendégbejegyzések szűrése">
          {(
            [
              ['pending', `Új (${counts.pending})`],
              ['approved', `Könyvben (${counts.approved})`],
              ['rejected', `Elutasított (${counts.rejected})`],
              ['all', `Mind (${counts.all})`],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              style={filter === value ? styles.filterActive : styles.filterButton}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {visibleContributions.length === 0 ? (
          <div style={styles.emptyState}>
            {filter === 'pending'
              ? 'Nincs új, elbírálásra váró vendégbejegyzés.'
              : 'Ebben a kategóriában nincs bejegyzés.'}
          </div>
        ) : (
          <div style={styles.list}>
            {visibleContributions.map((contribution) => {
              const isWorking = workingId === contribution.id;

              return (
                <article key={contribution.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <div>
                      <strong style={styles.name}>{contribution.contributorName}</strong>
                      <div style={styles.date}>
                        {new Date(contribution.createdAt).toLocaleString('hu-HU')}
                      </div>
                    </div>
                    <span style={statusStyle(contribution.ownerStatus)}>
                      {statusLabel(contribution.ownerStatus)}
                    </span>
                  </div>

                  <p style={styles.memory}>{contribution.memoryText}</p>

                  {contribution.photoUrl && (
                    <img
                      src={contribution.photoUrl}
                      alt={`${contribution.contributorName} vendégkönyv-fotója`}
                      style={styles.photo}
                    />
                  )}

                  <div style={styles.actions}>
                    <button
                      type="button"
                      onClick={() => updateStatus(contribution, 'approved')}
                      disabled={isWorking || contribution.ownerStatus === 'approved'}
                      style={styles.approveButton}
                    >
                      {isWorking ? 'Mentés...' : contribution.ownerStatus === 'approved' ? 'Könyvben van' : 'Könyvbe teszem'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateStatus(contribution, 'rejected')}
                      disabled={isWorking || contribution.ownerStatus === 'rejected'}
                      style={styles.rejectButton}
                    >
                      {contribution.ownerStatus === 'rejected' ? 'Elutasítva' : 'Elutasítom'}
                    </button>

                    {contribution.ownerStatus !== 'pending' && (
                      <button
                        type="button"
                        onClick={() => updateStatus(contribution, 'pending')}
                        disabled={isWorking}
                        style={styles.pendingButton}
                      >
                        Vissza az új bejegyzésekhez
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

function statusLabel(status: ContributionStatus) {
  switch (status) {
    case 'approved':
      return 'Könyvben';
    case 'rejected':
      return 'Elutasítva';
    default:
      return 'Új';
  }
}

function statusStyle(status: ContributionStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  };

  if (status === 'approved') {
    return { ...base, background: '#dcfce7', color: '#166534' };
  }

  if (status === 'rejected') {
    return { ...base, background: '#fee2e2', color: '#991b1b' };
  }

  return { ...base, background: '#fef3c7', color: '#92400e' };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '16px 12px 36px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: {
    width: '100%',
    maxWidth: 820,
    margin: '0 auto',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 10,
    color: '#475569',
    textDecoration: 'none',
    fontWeight: 700,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#64748b',
  },
  title: {
    margin: '8px 0',
    color: '#0f172a',
    fontSize: 'clamp(25px, 8vw, 36px)',
    lineHeight: 1.12,
    overflowWrap: 'anywhere',
  },
  intro: {
    maxWidth: 700,
    margin: '0 0 18px',
    color: '#475569',
    lineHeight: 1.55,
    fontSize: 14,
  },
  topActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  bookLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    padding: '10px 14px',
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 800,
  },
  secondaryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    background: '#ffffff',
    color: '#334155',
    textDecoration: 'none',
    fontWeight: 800,
  },
  filters: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
    marginBottom: 16,
  },
  filterButton: {
    minHeight: 44,
    padding: '9px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    background: '#ffffff',
    color: '#475569',
    fontWeight: 800,
    cursor: 'pointer',
  },
  filterActive: {
    minHeight: 44,
    padding: '9px 10px',
    border: '1px solid #0f172a',
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontWeight: 800,
    cursor: 'pointer',
  },
  list: {
    display: 'grid',
    gap: 14,
  },
  card: {
    background: '#ffffff',
    padding: 16,
    borderRadius: 14,
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.07)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  name: {
    display: 'block',
    color: '#0f172a',
    fontSize: 18,
    overflowWrap: 'anywhere',
  },
  date: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748b',
  },
  memory: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    lineHeight: 1.6,
    color: '#334155',
  },
  photo: {
    display: 'block',
    width: '100%',
    maxHeight: 380,
    marginTop: 14,
    borderRadius: 10,
    objectFit: 'contain',
    background: '#f8fafc',
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 8,
    marginTop: 16,
  },
  approveButton: {
    minHeight: 46,
    padding: '10px 12px',
    border: 0,
    borderRadius: 8,
    background: '#166534',
    color: '#ffffff',
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  rejectButton: {
    minHeight: 46,
    padding: '10px 12px',
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fff7f7',
    color: '#b91c1c',
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  pendingButton: {
    minHeight: 46,
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  error: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
  },
  emptyState: {
    padding: 24,
    borderRadius: 14,
    background: '#ffffff',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};
