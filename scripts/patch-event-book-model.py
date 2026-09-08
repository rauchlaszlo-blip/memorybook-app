from pathlib import Path

# Backend: book types + event contribution moderation.
p = Path('server/index.ts')
s = p.read_text(encoding='utf-8')

# Owner book list returns type.
s = s.replace(
'''         b.title,\n         b.created_at AS "createdAt",''',
'''         b.title,\n         b.book_type AS "bookType",\n         b.created_at AS "createdAt",''',
1)
s = s.replace(
'''       GROUP BY b.id, b.title, b.created_at''',
'''       GROUP BY b.id, b.title, b.book_type, b.created_at''',
1)

# Create book supports standard/event. Standard starts with 30 pages, event with none.
s = s.replace(
'''  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';\n\n  if (!title || title.length > 120) {''',
'''  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';\n  const bookType = req.body?.bookType === 'event' ? 'event' : 'standard';\n\n  if (!title || title.length > 120) {''',
1)
s = s.replace(
'''      `INSERT INTO books (id, owner_user_id, title, invite_token)\n       VALUES ($1, $2, $3, $4)\n       RETURNING id, title, created_at AS "createdAt"`,\n      [bookId, session.user.id, title, inviteToken]''',
'''      `INSERT INTO books (id, owner_user_id, title, invite_token, book_type)\n       VALUES ($1, $2, $3, $4, $5)\n       RETURNING id, title, book_type AS "bookType", created_at AS "createdAt"`,\n      [bookId, session.user.id, title, inviteToken, bookType]''',
1)
s = s.replace(
'''    for (let pageNumber = 1; pageNumber <= DEFAULT_BOOK_PAGE_COUNT; pageNumber += 1) {\n      await client.query(\n        `INSERT INTO pages (id, book_id, page_number)\n         VALUES ($1, $2, $3)`,\n        [`page-${crypto.randomUUID()}`, bookId, pageNumber]\n      );\n    }''',
'''    if (bookType === 'standard') {\n      for (let pageNumber = 1; pageNumber <= DEFAULT_BOOK_PAGE_COUNT; pageNumber += 1) {\n        await client.query(\n          `INSERT INTO pages (id, book_id, page_number)\n           VALUES ($1, $2, $3)`,\n          [`page-${crypto.randomUUID()}`, bookId, pageNumber]\n        );\n      }\n    }''',
1)
s = s.replace(
'''        pageCount: DEFAULT_BOOK_PAGE_COUNT,\n        contributionCount: 0,''',
'''        pageCount: bookType === 'standard' ? DEFAULT_BOOK_PAGE_COUNT : 0,\n        contributionCount: 0,''',
1)

# Owner page response includes book type.
s = s.replace(
'''      `SELECT id, title, invite_token AS "eventInviteToken"\n       FROM books''',
'''      `SELECT id, title, book_type AS "bookType", invite_token AS "eventInviteToken"\n       FROM books''',
1)

# Event join token is available only for event books (plus demo compatibility).
s = s.replace(
'''      `SELECT id, title\n       FROM books\n       WHERE invite_token = $1`,''',
'''      `SELECT id, title, book_type AS "bookType"\n       FROM books\n       WHERE invite_token = $1`,''',
1)
s = s.replace(
'''    res.status(200).json({\n      bookId: result.rows[0].id,\n      title: result.rows[0].title,\n    });''',
'''    if (result.rows[0].bookType !== 'event' && result.rows[0].id !== DEMO_BOOK_ID) {\n      res.status(404).json({ error: 'INVITE_NOT_FOUND' });\n      return;\n    }\n\n    res.status(200).json({\n      bookId: result.rows[0].id,\n      title: result.rows[0].title,\n      bookType: result.rows[0].bookType,\n    });''',
1)

# Contribution list returns moderation status + book type.
s = s.replace(
'''      `SELECT id, title, owner_user_id AS "ownerUserId"\n       FROM books''',
'''      `SELECT id, title, book_type AS "bookType", owner_user_id AS "ownerUserId"\n       FROM books''',
1)
s = s.replace(
'''         photo_url AS "photoUrl",\n         created_at AS "createdAt"''',
'''         photo_url AS "photoUrl",\n         owner_status AS "ownerStatus",\n         created_at AS "createdAt"''',
1)

# Contribution creation requires event book (demo remains compatible) and returns status.
s = s.replace(
'''      `SELECT id FROM books WHERE invite_token = $1`,''',
'''      `SELECT id, book_type AS "bookType" FROM books WHERE invite_token = $1`,''',
1)
s = s.replace(
'''    const contributionId = `contribution-${crypto.randomUUID()}`;''',
'''    if (bookResult.rows[0].bookType !== 'event' && bookResult.rows[0].id !== DEMO_BOOK_ID) {\n      res.status(404).json({ error: 'INVITE_NOT_FOUND' });\n      return;\n    }\n\n    const contributionId = `contribution-${crypto.randomUUID()}`;''',
1)
s = s.replace(
'''         photo_url AS "photoUrl",\n         created_at AS "createdAt"`,''',
'''         photo_url AS "photoUrl",\n         owner_status AS "ownerStatus",\n         created_at AS "createdAt"`,''',
1)

# Owner moderation endpoint, inserted before generic pages route.
anchor = "app.get('/api/books/:bookId/pages', async (req, res) => {"
if anchor not in s:
    raise SystemExit('pages route anchor missing')
moderation = r'''app.patch('/api/my/books/:bookId/contributions/:contributionId', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const ownerStatus = req.body?.ownerStatus;
  if (!['pending', 'kept', 'rejected'].includes(ownerStatus)) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_STATUS' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE contributions c
       SET owner_status = $1
       FROM books b
       WHERE c.id = $2
         AND c.book_id = $3
         AND b.id = c.book_id
         AND b.owner_user_id = $4
         AND b.book_type = 'event'
       RETURNING
         c.id,
         c.contributor_name AS "contributorName",
         c.memory_text AS "memoryText",
         c.photo_url AS "photoUrl",
         c.owner_status AS "ownerStatus",
         c.created_at AS "createdAt"`,
      [ownerStatus, req.params.contributionId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'CONTRIBUTION_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('Contribution moderation error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_MODERATION_FAILED' });
  }
});

'''
s = s.replace(anchor, moderation + anchor, 1)

# Database migrations.
s = s.replace(
'''  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE`);''',
'''  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE`);\n  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS book_type TEXT NOT NULL DEFAULT 'standard'`);''',
1)
s = s.replace(
'''  await pool.query(`\n    CREATE TABLE IF NOT EXISTS contributions (\n      id TEXT PRIMARY KEY,\n      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,\n      contributor_name TEXT NOT NULL,\n      memory_text TEXT NOT NULL,\n      photo_url TEXT,\n      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP\n    )\n  `);''',
'''  await pool.query(`\n    CREATE TABLE IF NOT EXISTS contributions (\n      id TEXT PRIMARY KEY,\n      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,\n      contributor_name TEXT NOT NULL,\n      memory_text TEXT NOT NULL,\n      photo_url TEXT,\n      owner_status TEXT NOT NULL DEFAULT 'pending',\n      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP\n    )\n  `);\n\n  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'pending'`);''',
1)

p.write_text(s, encoding='utf-8')

# MyBooksPage: user chooses book type, event books don't claim 30 pages.
p = Path('src/MyBooksPage.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace("  contributionCount: number;\n  createdAt: string;", "  contributionCount: number;\n  bookType?: 'standard' | 'event' | string;\n  createdAt: string;")
s = s.replace("  const [newBookTitle, setNewBookTitle] = useState('');", "  const [newBookTitle, setNewBookTitle] = useState('');\n  const [newBookType, setNewBookType] = useState<'standard' | 'event'>('standard');")
s = s.replace("body: JSON.stringify({ title }),", "body: JSON.stringify({ title, bookType: newBookType }),")
s = s.replace("      setNewBookTitle('');", "      setNewBookTitle('');\n      setNewBookType('standard');")
s = s.replace(
'''              <p style={styles.createText}>\n                Az új könyv 30 üres oldallal indul. Később további oldalak\n                vásárolhatók hozzá.\n              </p>''',
'''              <p style={styles.createText}>\n                Normál emlékkönyv: 30 oldallal indul és később bővíthető.\n                Rendezvény-vendégkönyv: QR-kóddal gyűjti a vendégek bejegyzéseit,\n                a végleges oldalak számáról később te döntesz.\n              </p>''')
s = s.replace(
'''            <form onSubmit={createBook} style={styles.createForm}>\n              <input''',
'''            <form onSubmit={createBook} style={styles.createForm}>\n              <select\n                value={newBookType}\n                onChange={(event) => setNewBookType(event.target.value as 'standard' | 'event')}\n                disabled={creating}\n                style={styles.select}\n                aria-label="Könyv típusa"\n              >\n                <option value="standard">Normál emlékkönyv – 30 oldal</option>\n                <option value="event">Rendezvény-vendégkönyv – QR-kódos</option>\n              </select>\n              <input''')
s = s.replace(
'''                <div style={styles.meta}>\n                  {book.pageCount} oldal · {book.contributionCount} beküldés\n                </div>''',
'''                <div style={styles.typeBadge}>\n                  {book.bookType === 'event' ? 'Rendezvény-vendégkönyv' : 'Normál emlékkönyv'}\n                </div>\n                <div style={styles.meta}>\n                  {book.bookType === 'event'\n                    ? `${book.contributionCount} bejegyzés`\n                    : `${book.pageCount} oldal`}\n                </div>''')
s = s.replace(
'''                  <a\n                    href={`/my-books/${encodeURIComponent(book.id)}`}\n                    style={styles.primaryLink}\n                  >\n                    Oldalak és meghívók\n                  </a>\n                  <a\n                    href={`/book/${encodeURIComponent(book.id)}/view`}\n                    style={styles.secondaryLink}\n                  >\n                    Könyv megnyitása\n                  </a>\n                  <a\n                    href={`/organizer/${encodeURIComponent(book.id)}/contributions`}\n                    style={styles.secondaryLink}\n                  >\n                    Beküldések\n                  </a>''',
'''                  <a\n                    href={`/my-books/${encodeURIComponent(book.id)}`}\n                    style={styles.primaryLink}\n                  >\n                    {book.bookType === 'event' ? 'Rendezvény kezelése' : 'Oldalak és meghívók'}\n                  </a>\n                  {book.bookType !== 'event' && (\n                    <a\n                      href={`/book/${encodeURIComponent(book.id)}/view`}\n                      style={styles.secondaryLink}\n                    >\n                      Könyv megnyitása\n                    </a>\n                  )}\n                  {book.bookType === 'event' && (\n                    <a\n                      href={`/organizer/${encodeURIComponent(book.id)}/contributions`}\n                      style={styles.secondaryLink}\n                    >\n                      Beérkezett bejegyzések\n                    </a>\n                  )}''')
s = s.replace(
'''  input: {\n    flex: '1 1 280px',''',
'''  select: {\n    flex: '1 1 240px',\n    minHeight: 46,\n    padding: '10px 12px',\n    border: '1px solid #cbd5e1',\n    borderRadius: 9,\n    fontSize: 15,\n    background: '#ffffff',\n    boxSizing: 'border-box',\n  },\n  input: {\n    flex: '1 1 280px',''')
s = s.replace(
'''  meta: {\n    color: '#64748b',''',
'''  typeBadge: {\n    display: 'inline-block',\n    marginBottom: 7,\n    padding: '4px 8px',\n    borderRadius: 999,\n    background: '#e2e8f0',\n    color: '#475569',\n    fontSize: 12,\n    fontWeight: 800,\n  },\n  meta: {\n    color: '#64748b',''')
p.write_text(s, encoding='utf-8')

# OwnerBookPage: QR and contribution inbox only for event books; page grid only for standard books.
p = Path('src/OwnerBookPage.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace("  const [eventInviteToken, setEventInviteToken] = useState<string | null>(null);", "  const [eventInviteToken, setEventInviteToken] = useState<string | null>(null);\n  const [bookType, setBookType] = useState<'standard' | 'event'>('standard');")
s = s.replace("        setEventInviteToken(data.book?.eventInviteToken || null);", "        setEventInviteToken(data.book?.eventInviteToken || null);\n        setBookType(data.book?.bookType === 'event' ? 'event' : 'standard');")
s = s.replace(
'''            <p style={styles.subtitle}>\n              Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött\n              oldalakat megtarthatod, archiválhatod vagy végleg törölheted.\n            </p>''',
'''            <p style={styles.subtitle}>\n              {bookType === 'event'\n                ? 'A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.'\n                : 'Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött oldalakat megtarthatod, archiválhatod vagy végleg törölheted.'}\n            </p>''')
s = s.replace("      {eventInviteToken && (", "      {bookType === 'event' && eventInviteToken && (")
s = s.replace(
'''          <a href={`/my-books/${encodeURIComponent(bookId)}/event-qr`} style={styles.eventQrButton}>QR-kód megnyitása</a>''',
'''          <div style={styles.eventActions}>\n            <a href={`/my-books/${encodeURIComponent(bookId)}/event-qr`} style={styles.eventQrButton}>QR-kód megnyitása</a>\n            <a href={`/organizer/${encodeURIComponent(bookId)}/contributions`} style={styles.eventSecondaryButton}>Beérkezett bejegyzések</a>\n          </div>''')
s = s.replace("        {!loading && (\n          <div style={styles.grid}>", "        {!loading && bookType === 'standard' && (\n          <div style={styles.grid}>")
s = s.replace(
"  eventQrButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap' },",
"  eventActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },\n  eventQrButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap' },\n  eventSecondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap' },")
p.write_text(s, encoding='utf-8')

# Event QR page refuses standard books.
p = Path('src/EventGuestbookQrPage.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace("        setTitle(data.book?.title || 'MemoryBook vendégkönyv');\n        setInviteToken(data.book?.eventInviteToken || null);", "        if (data.book?.bookType !== 'event') throw new Error('NOT_EVENT_BOOK');\n        setTitle(data.book?.title || 'MemoryBook vendégkönyv');\n        setInviteToken(data.book?.eventInviteToken || null);")
p.write_text(s, encoding='utf-8')

# Contributions owner inbox with keep/reject decisions.
Path('src/OrganizerContributionsPage.tsx').write_text(r'''import { useEffect, useMemo, useState } from 'react';

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
''', encoding='utf-8')

print('event book model patch applied')
