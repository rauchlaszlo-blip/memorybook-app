import { useEffect, useState } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://' + window.location.hostname + ':3001' : '';

type Contribution = {
  id: string;
  contributorName: string;
  memoryText: string;
  photoUrl: string | null;
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

export function OrganizerContributionsPage({
  bookId,
}: OrganizerContributionsPageProps) {
  const [data, setData] = useState<ContributionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError('The contributions could not be loaded.');
      } finally {
        setLoading(false);
      }
    };

    loadContributions();
  }, [bookId]);

  if (loading) {
    return <div style={styles.message}>Loading contributions...</div>;
  }

  if (error) {
    return <div style={styles.message}>{error}</div>;
  }

  if (!data) {
    return <div style={styles.message}>Book not found.</div>;
  }

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.eyebrow}>MemoryBook organizer</div>

        <h1 style={styles.title}>{data.book.title}</h1>

        <p style={styles.count}>
          {data.contributions.length} contributions
        </p>

        <div style={styles.list}>
          {data.contributions.map((contribution) => (
            <article key={contribution.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <strong>{contribution.contributorName}</strong>
                <span style={styles.date}>
                  {new Date(contribution.createdAt).toLocaleString()}
                </span>
              </div>

              <p style={styles.memory}>
                {contribution.memoryText}
              </p>

              {contribution.photoUrl && (
                <img
                  src={`${API_BASE}${contribution.photoUrl}`}
                  alt={`Memory from ${contribution.contributorName}`}
                  style={styles.photo}
                />
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '40px 20px',
    fontFamily: 'Arial, sans-serif',
  },
  container: {
    maxWidth: 820,
    margin: '0 auto',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#64748b',
  },
  title: {
    marginBottom: 8,
    color: '#0f172a',
  },
  count: {
    marginBottom: 28,
    color: '#64748b',
  },
  list: {
    display: 'grid',
    gap: 18,
  },
  card: {
    background: 'white',
    padding: 22,
    borderRadius: 14,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
    color: '#0f172a',
  },
  date: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: 400,
  },
  memory: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.6,
    color: '#334155',
  },
  photo: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 360,
    marginTop: 18,
    borderRadius: 10,
    objectFit: 'cover',
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};
