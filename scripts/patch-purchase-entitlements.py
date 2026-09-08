from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, path: str) -> str:
    if old not in text:
        raise SystemExit(f'Marker not found in {path}: {old[:120]!r}')
    return text.replace(old, new, 1)


# --- server/index.ts ---
server_path = 'server/index.ts'
server = read(server_path)

schema_anchor = "  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS event_identity_mode TEXT NOT NULL DEFAULT 'none'`);"
schema_insert = schema_anchor + """
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS page_capacity INTEGER NOT NULL DEFAULT 30`);
  await pool.query(`UPDATE books SET page_capacity = 0 WHERE book_type = 'event' AND page_capacity <> 0`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_mode TEXT NOT NULL CHECK (purchase_mode IN ('self', 'gift')),
      book_type TEXT NOT NULL CHECK (book_type IN ('standard', 'event')),
      included_pages INTEGER NOT NULL DEFAULT 30,
      purchaser_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      purchaser_name TEXT NOT NULL,
      purchaser_email TEXT NOT NULL,
      billing_name TEXT NOT NULL,
      billing_email TEXT NOT NULL,
      billing_country TEXT NOT NULL,
      billing_postal_code TEXT NOT NULL,
      billing_city TEXT NOT NULL,
      billing_address TEXT NOT NULL,
      billing_tax_number TEXT,
      payment_provider TEXT NOT NULL CHECK (payment_provider IN ('paypal', 'simplepay')),
      payment_status TEXT NOT NULL DEFAULT 'draft' CHECK (payment_status IN ('draft', 'pending', 'paid', 'cancelled', 'refunded')),
      provider_reference TEXT,
      amount_minor INTEGER,
      currency TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS book_entitlements (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
      assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      gift_token TEXT UNIQUE,
      book_type TEXT NOT NULL CHECK (book_type IN ('standard', 'event')),
      included_pages INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'redeemed', 'revoked')),
      claimed_at TIMESTAMPTZ,
      redeemed_at TIMESTAMPTZ,
      redeemed_book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS book_entitlements_assigned_user_idx ON book_entitlements (assigned_user_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS purchases_purchaser_user_idx ON purchases (purchaser_user_id, created_at DESC)`);"""
server = replace_once(server, schema_anchor, schema_insert, server_path)

start_marker = "app.post('/api/my/books', async (req, res) => {"
end_marker = "app.get('/api/my/books/:bookId/event-settings', async (req, res) => {"
start = server.find(start_marker)
end = server.find(end_marker)
if start == -1 or end == -1 or end <= start:
    raise SystemExit('Could not locate book creation block')

replacement = r"""app.post('/api/purchases', async (req, res) => {
  const purchaseMode = req.body?.purchaseMode === 'gift' ? 'gift' : 'self';
  const bookType = req.body?.bookType === 'event' ? 'event' : 'standard';
  const paymentProvider =
    req.body?.paymentProvider === 'paypal'
      ? 'paypal'
      : req.body?.paymentProvider === 'simplepay'
        ? 'simplepay'
        : null;

  const session = await getSession(req).catch(() => null);
  if (purchaseMode === 'self' && !session) {
    res.status(401).json({ error: 'ACCOUNT_REQUIRED_FOR_SELF_PURCHASE' });
    return;
  }

  const purchaserName =
    purchaseMode === 'self'
      ? String(session?.user?.name || req.body?.purchaserName || '').trim()
      : String(req.body?.purchaserName || '').trim();
  const purchaserEmail =
    purchaseMode === 'self'
      ? String(session?.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase()
      : String(req.body?.purchaserEmail || '').trim().toLowerCase();
  const billingName = String(req.body?.billingName || '').trim();
  const billingEmail = String(req.body?.billingEmail || '').trim().toLowerCase();
  const billingCountry = String(req.body?.billingCountry || '').trim();
  const billingPostalCode = String(req.body?.billingPostalCode || '').trim();
  const billingCity = String(req.body?.billingCity || '').trim();
  const billingAddress = String(req.body?.billingAddress || '').trim();
  const billingTaxNumber = String(req.body?.billingTaxNumber || '').trim();

  if (!paymentProvider) {
    res.status(400).json({ error: 'INVALID_PAYMENT_PROVIDER' });
    return;
  }

  const requiredValues = [
    purchaserName,
    purchaserEmail,
    billingName,
    billingEmail,
    billingCountry,
    billingPostalCode,
    billingCity,
    billingAddress,
  ];
  if (requiredValues.some((value) => !value)) {
    res.status(400).json({ error: 'INCOMPLETE_PURCHASE_IDENTITY' });
    return;
  }
  if (!purchaserEmail.includes('@') || !billingEmail.includes('@')) {
    res.status(400).json({ error: 'INVALID_PURCHASE_EMAIL' });
    return;
  }
  if (
    purchaserName.length > 160 ||
    purchaserEmail.length > 240 ||
    billingName.length > 200 ||
    billingEmail.length > 240 ||
    billingCountry.length > 100 ||
    billingPostalCode.length > 30 ||
    billingCity.length > 120 ||
    billingAddress.length > 240 ||
    billingTaxNumber.length > 80
  ) {
    res.status(400).json({ error: 'PURCHASE_IDENTITY_TOO_LONG' });
    return;
  }

  const purchaseId = `purchase-${crypto.randomUUID()}`;
  const includedPages = bookType === 'standard' ? DEFAULT_BOOK_PAGE_COUNT : 0;

  try {
    const result = await pool.query(
      `INSERT INTO purchases (
         id,
         purchase_mode,
         book_type,
         included_pages,
         purchaser_user_id,
         purchaser_name,
         purchaser_email,
         billing_name,
         billing_email,
         billing_country,
         billing_postal_code,
         billing_city,
         billing_address,
         billing_tax_number,
         payment_provider,
         payment_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), $15, 'draft')
       RETURNING
         id,
         purchase_mode AS "purchaseMode",
         book_type AS "bookType",
         included_pages AS "includedPages",
         payment_provider AS "paymentProvider",
         payment_status AS "paymentStatus",
         created_at AS "createdAt"`,
      [
        purchaseId,
        purchaseMode,
        bookType,
        includedPages,
        session?.user?.id || null,
        purchaserName,
        purchaserEmail,
        billingName,
        billingEmail,
        billingCountry,
        billingPostalCode,
        billingCity,
        billingAddress,
        billingTaxNumber,
        paymentProvider,
      ]
    );

    res.status(201).json({
      success: true,
      purchase: result.rows[0],
      paymentReady: false,
      message: 'PAYMENT_PROVIDER_INTEGRATION_PENDING',
    });
  } catch (err) {
    console.error('Purchase draft create error:', err);
    res.status(500).json({ error: 'PURCHASE_DRAFT_CREATE_FAILED' });
  }
});

app.get('/api/my/entitlements', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `SELECT
         e.id,
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status,
         e.gift_token IS NOT NULL AS "wasGift",
         e.claimed_at AS "claimedAt",
         e.redeemed_at AS "redeemedAt",
         e.redeemed_book_id AS "redeemedBookId",
         e.created_at AS "createdAt"
       FROM book_entitlements e
       WHERE e.assigned_user_id = $1
       ORDER BY
         CASE WHEN e.status = 'available' THEN 0 ELSE 1 END,
         e.created_at DESC`,
      [session.user.id]
    );

    res.status(200).json({ entitlements: result.rows });
  } catch (err) {
    console.error('Entitlement list error:', err);
    res.status(500).json({ error: 'ENTITLEMENT_LIST_FAILED' });
  }
});

app.get('/api/gift-entitlements/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status,
         e.assigned_user_id IS NOT NULL AS "claimed"
       FROM book_entitlements e
       JOIN purchases p ON p.id = e.purchase_id
       WHERE e.gift_token = $1
         AND p.purchase_mode = 'gift'
         AND p.payment_status = 'paid'`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'GIFT_ENTITLEMENT_NOT_FOUND' });
      return;
    }

    const row = result.rows[0];
    res.status(200).json({
      bookType: row.bookType,
      includedPages: row.includedPages,
      claimStatus:
        row.status === 'redeemed'
          ? 'redeemed'
          : row.claimed
            ? 'claimed'
            : 'available',
    });
  } catch (err) {
    console.error('Gift entitlement load error:', err);
    res.status(500).json({ error: 'GIFT_ENTITLEMENT_LOAD_FAILED' });
  }
});

app.post('/api/gift-entitlements/:token/redeem', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT
         e.id,
         e.assigned_user_id AS "assignedUserId",
         e.status,
         e.book_type AS "bookType",
         e.included_pages AS "includedPages"
       FROM book_entitlements e
       JOIN purchases p ON p.id = e.purchase_id
       WHERE e.gift_token = $1
         AND p.purchase_mode = 'gift'
         AND p.payment_status = 'paid'
       FOR UPDATE OF e`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'GIFT_ENTITLEMENT_NOT_FOUND' });
      return;
    }

    const entitlement = result.rows[0];
    if (entitlement.status !== 'available') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'GIFT_ENTITLEMENT_ALREADY_USED' });
      return;
    }

    if (entitlement.assignedUserId && entitlement.assignedUserId !== session.user.id) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'GIFT_ENTITLEMENT_ALREADY_CLAIMED' });
      return;
    }

    if (!entitlement.assignedUserId) {
      await client.query(
        `UPDATE book_entitlements
         SET assigned_user_id = $1,
             claimed_at = COALESCE(claimed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [session.user.id, entitlement.id]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      entitlement: {
        id: entitlement.id,
        bookType: entitlement.bookType,
        includedPages: entitlement.includedPages,
        status: 'available',
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Gift entitlement redeem error:', err);
    res.status(500).json({ error: 'GIFT_ENTITLEMENT_REDEEM_FAILED' });
  } finally {
    client.release();
  }
});

app.post('/api/my/books', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const entitlementId =
    typeof req.body?.entitlementId === 'string' ? req.body.entitlementId.trim() : '';

  if (!title || title.length > 120) {
    res.status(400).json({ error: 'INVALID_BOOK_TITLE' });
    return;
  }
  if (!entitlementId) {
    res.status(402).json({ error: 'BOOK_ENTITLEMENT_REQUIRED' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  const bookId = `book-${crypto.randomUUID()}`;
  const inviteToken = `invite-${crypto.randomUUID()}`;

  try {
    await client.query('BEGIN');

    const entitlementResult = await client.query(
      `SELECT
         id,
         book_type AS "bookType",
         included_pages AS "includedPages",
         status
       FROM book_entitlements
       WHERE id = $1
         AND assigned_user_id = $2
       FOR UPDATE`,
      [entitlementId, session.user.id]
    );

    if (entitlementResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'BOOK_ENTITLEMENT_NOT_AVAILABLE' });
      return;
    }

    const entitlement = entitlementResult.rows[0];
    if (entitlement.status !== 'available') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'BOOK_ENTITLEMENT_ALREADY_USED' });
      return;
    }

    const bookType = entitlement.bookType === 'event' ? 'event' : 'standard';
    const includedPages =
      bookType === 'standard'
        ? Math.max(1, Number(entitlement.includedPages) || DEFAULT_BOOK_PAGE_COUNT)
        : 0;

    const bookResult = await client.query(
      `INSERT INTO books (id, owner_user_id, title, invite_token, book_type, page_capacity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id,
         title,
         book_type AS "bookType",
         page_capacity AS "pageCapacity",
         created_at AS "createdAt"`,
      [bookId, session.user.id, title, inviteToken, bookType, includedPages]
    );

    if (bookType === 'standard') {
      for (let pageNumber = 1; pageNumber <= includedPages; pageNumber += 1) {
        await client.query(
          `INSERT INTO pages (id, book_id, page_number)
           VALUES ($1, $2, $3)`,
          [`page-${crypto.randomUUID()}`, bookId, pageNumber]
        );
      }
    }

    await client.query(
      `UPDATE book_entitlements
       SET status = 'redeemed',
           redeemed_at = CURRENT_TIMESTAMP,
           redeemed_book_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [bookId, entitlement.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      book: {
        ...bookResult.rows[0],
        pageCount: includedPages,
        contributionCount: 0,
      },
      consumedEntitlementId: entitlement.id,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Book create error:', err);
    res.status(500).json({ error: 'BOOK_CREATE_FAILED' });
  } finally {
    client.release();
  }
});

"""
server = server[:start] + replacement + server[end:]
write(server_path, server)

# --- src/MyBooksPage.tsx ---
mybooks = r"""import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type UserData = { id: string; name?: string; email?: string };
type BookSummary = {
  id: string;
  title: string;
  pageCount: number;
  contributionCount: number;
  bookType?: 'standard' | 'event' | string;
  createdAt: string;
};
type Entitlement = {
  id: string;
  bookType: 'standard' | 'event' | string;
  includedPages: number;
  status: 'available' | 'redeemed' | 'revoked' | string;
  wasGift?: boolean;
};

export function MyBooksPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [selectedEntitlementId, setSelectedEntitlementId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const availableEntitlements = useMemo(
    () => entitlements.filter((item) => item.status === 'available'),
    [entitlements]
  );

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const meResponse = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
        if (meResponse.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!meResponse.ok) throw new Error('SESSION_LOAD_FAILED');
        const meData = await meResponse.json();
        setUser(meData.user ?? null);

        const [booksResponse, entitlementsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/my/books`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/my/entitlements`, { credentials: 'include' }),
        ]);
        if (!booksResponse.ok || !entitlementsResponse.ok) throw new Error('OWNER_DATA_LOAD_FAILED');
        const booksData = await booksResponse.json();
        const entitlementData = await entitlementsResponse.json();
        setBooks(Array.isArray(booksData.books) ? booksData.books : []);
        const nextEntitlements = Array.isArray(entitlementData.entitlements)
          ? entitlementData.entitlements
          : [];
        setEntitlements(nextEntitlements);
        const firstAvailable = nextEntitlements.find((item: Entitlement) => item.status === 'available');
        setSelectedEntitlementId(firstAvailable?.id || '');
      } catch (err) {
        console.error(err);
        setError('Nem sikerült betölteni a könyveidet.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const createBook = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    const title = newBookTitle.trim();
    if (!title) {
      setCreateError('Adj nevet az emlékkönyvnek.');
      return;
    }
    if (!selectedEntitlementId) {
      setCreateError('A könyv létrehozásához felhasználható vásárlási jogosultság kell.');
      return;
    }

    try {
      setCreating(true);
      const response = await fetch(`${API_BASE}/api/my/books`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, entitlementId: selectedEntitlementId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'BOOK_CREATE_FAILED');
      if (data.book) setBooks((current) => [data.book, ...current]);
      setEntitlements((current) =>
        current.map((item) =>
          item.id === selectedEntitlementId ? { ...item, status: 'redeemed' } : item
        )
      );
      setNewBookTitle('');
      const remaining = availableEntitlements.find((item) => item.id !== selectedEntitlementId);
      setSelectedEntitlementId(remaining?.id || '');
    } catch (err: any) {
      console.error(err);
      setCreateError(
        err?.message === 'BOOK_ENTITLEMENT_REQUIRED'
          ? 'A könyv létrehozásához vásárlási jogosultság szükséges.'
          : 'Nem sikerült létrehozni az emlékkönyvet.'
      );
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/sign-out`, { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/login';
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>MemoryBook</div>
            <h1 style={styles.title}>Saját könyveim</h1>
            {user && <div style={styles.userLine}>{user.name || user.email || 'Bejelentkezett felhasználó'}</div>}
          </div>
          <button type="button" onClick={signOut} style={styles.secondaryButton}>Kijelentkezés</button>
        </header>

        {!loading && !error && (
          <section style={styles.createCard}>
            {availableEntitlements.length > 0 ? (
              <>
                <h2 style={styles.createTitle}>Új emlékkönyv létrehozása</h2>
                <p style={styles.createText}>
                  {availableEntitlements.length} felhasználható könyvjogosultságod van. Egy jogosultság egy könyv létrehozására használható fel.
                </p>
                <form onSubmit={createBook} style={styles.createForm}>
                  <select
                    value={selectedEntitlementId}
                    onChange={(event) => setSelectedEntitlementId(event.target.value)}
                    disabled={creating}
                    style={styles.select}
                    aria-label="Vásárlási jogosultság"
                  >
                    {availableEntitlements.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.bookType === 'event'
                          ? 'Rendezvény-vendégkönyv'
                          : `Normál emlékkönyv – ${item.includedPages} oldal`}
                        {item.wasGift ? ' · ajándék' : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newBookTitle}
                    onChange={(event) => setNewBookTitle(event.target.value)}
                    placeholder="Például: Anna 40. születésnapja"
                    maxLength={120}
                    disabled={creating}
                    style={styles.input}
                  />
                  <button type="submit" disabled={creating} style={styles.createButton}>
                    {creating ? 'Létrehozás...' : 'Emlékkönyv létrehozása'}
                  </button>
                </form>
                {createError && <div style={styles.createError}>{createError}</div>}
              </>
            ) : (
              <>
                <h2 style={styles.createTitle}>Új emlékkönyv</h2>
                <p style={styles.createText}>
                  Új könyvet vásárlási jogosultsággal lehet létrehozni. A normál könyv 30 oldallal indul, később bővíthető.
                </p>
                <a href="/purchase" style={styles.purchaseLink}>Új könyv vásárlása</a>
              </>
            )}
            {availableEntitlements.length > 0 && (
              <div style={styles.purchaseMore}><a href="/purchase">További könyv vásárlása vagy ajándékba vétele</a></div>
            )}
          </section>
        )}

        {loading && <div style={styles.panel}>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && books.length === 0 && (
          <div style={styles.emptyState}>
            <h2 style={styles.emptyTitle}>Még nincs emlékkönyved</h2>
            <p style={styles.emptyText}>
              Vásárolj könyvjogosultságot, vagy válts be egy ajándékba kapott jogosultságot. A könyv csak ezután hozható létre.
            </p>
          </div>
        )}

        {!loading && !error && books.length > 0 && (
          <div style={styles.grid}>
            {books.map((book) => (
              <article key={book.id} style={styles.card}>
                <h2 style={styles.bookTitle}>{book.title}</h2>
                <div style={styles.typeBadge}>{book.bookType === 'event' ? 'Rendezvény-vendégkönyv' : 'Normál emlékkönyv'}</div>
                <div style={styles.meta}>{book.bookType === 'event' ? `${book.contributionCount} bejegyzés` : `${book.pageCount} oldal`}</div>
                <div style={styles.actions}>
                  <a href={`/my-books/${encodeURIComponent(book.id)}`} style={styles.primaryLink}>
                    {book.bookType === 'event' ? 'Rendezvény kezelése' : 'Oldalak és meghívók'}
                  </a>
                  {book.bookType !== 'event' && <a href={`/book/${encodeURIComponent(book.id)}/view`} style={styles.secondaryLink}>Könyv megnyitása</a>}
                  {book.bookType === 'event' && <a href={`/organizer/${encodeURIComponent(book.id)}/contributions`} style={styles.secondaryLink}>Beérkezett bejegyzések</a>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '24px 18px 48px', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  container: { width: '100%', maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24 },
  brand: { fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: '#64748b' },
  title: { margin: '6px 0 4px', fontSize: 32, color: '#0f172a' },
  userLine: { color: '#64748b', fontSize: 14, overflowWrap: 'anywhere' },
  secondaryButton: { minHeight: 44, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#ffffff', color: '#334155', fontWeight: 700, cursor: 'pointer' },
  createCard: { marginBottom: 22, padding: 20, background: '#ffffff', borderRadius: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' },
  createTitle: { margin: '0 0 5px', color: '#0f172a', fontSize: 21 },
  createText: { margin: '0 0 16px', color: '#64748b', lineHeight: 1.5 },
  createForm: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  select: { flex: '1 1 240px', minHeight: 46, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 15, background: '#ffffff', boxSizing: 'border-box' },
  input: { flex: '1 1 280px', minWidth: 0, minHeight: 46, padding: '12px 13px', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 16, boxSizing: 'border-box' },
  createButton: { minHeight: 46, border: 0, borderRadius: 9, padding: '12px 16px', background: '#0f172a', color: '#ffffff', fontSize: 15, fontWeight: 800, cursor: 'pointer' },
  createError: { marginTop: 12, padding: 11, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 14 },
  purchaseLink: { display: 'inline-flex', alignItems: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800 },
  purchaseMore: { marginTop: 14, fontSize: 14 },
  panel: { padding: 24, background: '#ffffff', borderRadius: 14, color: '#64748b' },
  error: { padding: 14, borderRadius: 10, background: '#fef2f2', color: '#991b1b' },
  emptyState: { padding: '42px 28px', textAlign: 'center', background: '#ffffff', borderRadius: 16, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)' },
  emptyTitle: { margin: '0 0 8px', color: '#0f172a' },
  emptyText: { maxWidth: 560, margin: '0 auto', color: '#64748b', lineHeight: 1.6 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16 },
  card: { padding: 20, background: '#ffffff', borderRadius: 14, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' },
  bookTitle: { margin: '0 0 8px', color: '#0f172a', fontSize: 21, overflowWrap: 'anywhere' },
  typeBadge: { display: 'inline-block', marginBottom: 7, padding: '4px 8px', borderRadius: 999, background: '#e2e8f0', color: '#475569', fontSize: 12, fontWeight: 800 },
  meta: { color: '#64748b', fontSize: 14 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  primaryLink: { textDecoration: 'none', padding: '9px 12px', borderRadius: 8, background: '#0f172a', color: '#ffffff', fontWeight: 700, fontSize: 14 },
  secondaryLink: { textDecoration: 'none', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', color: '#334155', fontWeight: 700, fontSize: 14 },
};
"""
write('src/MyBooksPage.tsx', mybooks)

# --- src/PurchasePage.tsx ---
purchase_page = r"""import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type UserData = { id: string; name?: string; email?: string };
type Mode = 'self' | 'gift';
type BookType = 'standard' | 'event';
type Provider = 'paypal' | 'simplepay';

export function PurchasePage() {
  const query = new URLSearchParams(window.location.search);
  const [user, setUser] = useState<UserData | null>(null);
  const [mode, setMode] = useState<Mode>(query.get('mode') === 'gift' ? 'gift' : 'self');
  const [bookType, setBookType] = useState<BookType>('standard');
  const [provider, setProvider] = useState<Provider>('simplepay');
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [billingName, setBillingName] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [billingCountry, setBillingCountry] = useState('Magyarország');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingCity, setBillingCity] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [billingTaxNumber, setBillingTaxNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me`, { credentials: 'include' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        const nextUser = data?.user || null;
        setUser(nextUser);
        if (nextUser) {
          setPurchaserName(nextUser.name || '');
          setPurchaserEmail(nextUser.email || '');
          setBillingName((current) => current || nextUser.name || '');
          setBillingEmail((current) => current || nextUser.email || '');
        }
      })
      .catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPurchaseId(null);
    if (mode === 'self' && !user) {
      window.location.href = `/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`;
      return;
    }
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/purchases`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseMode: mode,
          bookType,
          paymentProvider: provider,
          purchaserName,
          purchaserEmail,
          billingName,
          billingEmail,
          billingCountry,
          billingPostalCode,
          billingCity,
          billingAddress,
          billingTaxNumber,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'PURCHASE_DRAFT_CREATE_FAILED');
      setPurchaseId(data.purchase?.id || null);
    } catch (err: any) {
      console.error(err);
      setError(err?.message === 'INCOMPLETE_PURCHASE_IDENTITY' ? 'Töltsd ki a számlázáshoz szükséges adatokat.' : 'A vásárlás előkészítése nem sikerült.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href={user ? '/my-books' : '/login'} style={styles.back}>← Vissza</a>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>Emlékkönyv vásárlása</h1>
        <p style={styles.lead}>A fizetési alapfolyamat elkészült. A PayPal és SimplePay tényleges fizetési indítása a következő integrációs lépés.</p>

        <div style={styles.switcher}>
          <button type="button" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>Magamnak</button>
          <button type="button" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>Ajándékba</button>
        </div>

        {mode === 'self' && !user && (
          <div style={styles.notice}>
            Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.
            <a href={`/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`} style={styles.inlineLink}> Belépés / regisztráció</a>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>Könyv típusa
            <select value={bookType} onChange={(event) => setBookType(event.target.value as BookType)} style={styles.input}>
              <option value="standard">Normál emlékkönyv – 30 oldal</option>
              <option value="event">Rendezvény-vendégkönyv</option>
            </select>
          </label>

          <label style={styles.label}>Fizetési mód
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)} style={styles.input}>
              <option value="simplepay">SimplePay</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>

          <div style={styles.sectionTitle}>Vásárló azonosítása</div>
          <label style={styles.label}>Név
            <input value={purchaserName} onChange={(event) => setPurchaserName(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>
          <label style={styles.label}>E-mail
            <input type="email" value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.target.value)} style={styles.input} disabled={mode === 'self' && Boolean(user)} />
          </label>

          <div style={styles.sectionTitle}>Számlázási adatok</div>
          <label style={styles.label}>Számlázási név
            <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Számlázási e-mail
            <input type="email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Ország
            <input value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input} />
          </label>
          <div style={styles.twoCols}>
            <label style={styles.label}>Irányítószám
              <input value={billingPostalCode} onChange={(event) => setBillingPostalCode(event.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>Település
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} />
            </label>
          </div>
          <label style={styles.label}>Cím
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>Adószám (ha szükséges)
            <input value={billingTaxNumber} onChange={(event) => setBillingTaxNumber(event.target.value)} style={styles.input} />
          </label>

          {mode === 'gift' && <div style={styles.giftInfo}>Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.</div>}
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading || (mode === 'self' && !user)} style={styles.primaryButton}>
            {loading ? 'Mentés...' : 'Vásárlási adatok mentése'}
          </button>
        </form>

        {purchaseId && (
          <div style={styles.success}>
            <strong>Vásárlási alap rögzítve.</strong><br />
            Azonosító: {purchaseId}<br />
            Még nem történt fizetés, ezért könyvjogosultság sem keletkezett. A következő lépésben ehhez kötjük a PayPal és SimplePay fizetést.
          </div>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '18px 12px 40px', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 640, margin: '0 auto', padding: 20, background: '#fff', borderRadius: 16, boxSizing: 'border-box', boxShadow: '0 10px 30px rgba(15,23,42,.08)' },
  back: { display: 'inline-flex', minHeight: 44, alignItems: 'center', color: '#475569', textDecoration: 'none', fontWeight: 700 },
  brand: { marginTop: 4, color: '#64748b', fontWeight: 800, fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '6px 0', color: '#0f172a', fontSize: 'clamp(25px,8vw,34px)' },
  lead: { margin: '0 0 18px', color: '#64748b', lineHeight: 1.5 },
  switcher: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16, padding: 4, background: '#e2e8f0', borderRadius: 10 },
  switchButton: { minHeight: 44, border: 0, borderRadius: 8, background: 'transparent', fontWeight: 800, color: '#475569' },
  active: { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(15,23,42,.12)' },
  notice: { marginBottom: 16, padding: 12, borderRadius: 9, background: '#fff7ed', color: '#9a3412', lineHeight: 1.45 },
  inlineLink: { color: '#9a3412', fontWeight: 800 },
  form: { display: 'flex', flexDirection: 'column', gap: 13 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, color: '#334155', fontSize: 14, fontWeight: 700, minWidth: 0 },
  input: { width: '100%', minHeight: 46, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 9, boxSizing: 'border-box', fontSize: 16, background: '#fff' },
  sectionTitle: { marginTop: 6, color: '#0f172a', fontWeight: 800, fontSize: 17 },
  twoCols: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 },
  giftInfo: { padding: 12, borderRadius: 9, background: '#f8fafc', color: '#475569', fontSize: 13, lineHeight: 1.5 },
  error: { padding: 11, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 16 },
  success: { marginTop: 16, padding: 14, borderRadius: 10, background: '#ecfdf5', color: '#166534', lineHeight: 1.5, overflowWrap: 'anywhere' },
};
"""
write('src/PurchasePage.tsx', purchase_page)

# --- src/GiftRedeemPage.tsx ---
gift_page = r"""import { useEffect, useState } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type GiftInfo = { bookType: 'standard' | 'event' | string; includedPages: number; claimStatus: 'available' | 'claimed' | 'redeemed' | string };

export function GiftRedeemPage({ token }: { token: string }) {
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
      .catch(() => setError('Ez az ajándék-jogosultság nem található vagy még nincs kifizetve.'))
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
      setError(err?.message === 'GIFT_ENTITLEMENT_ALREADY_CLAIMED' ? 'Ezt az ajándékot már másik fiók beváltotta.' : 'Az ajándék beváltása nem sikerült.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>Ajándék emlékkönyv</h1>
        {loading && <div>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}
        {!loading && info && (
          <>
            <p style={styles.text}>
              {info.bookType === 'event' ? 'Rendezvény-vendégkönyv' : `Normál emlékkönyv – ${info.includedPages} oldal`}
            </p>
            {info.claimStatus === 'available' ? (
              loggedIn ? (
                <button type="button" onClick={redeem} disabled={working} style={styles.primaryButton}>{working ? 'Beváltás...' : 'Ajándék beváltása'}</button>
              ) : (
                <a href={`/login?returnTo=${encodeURIComponent(`/gift/${token}`)}`} style={styles.primaryLink}>Belépés / regisztráció a beváltáshoz</a>
              )
            ) : (
              <div style={styles.notice}>{info.claimStatus === 'redeemed' ? 'Ezzel a jogosultsággal a könyvet már létrehozták.' : 'Ezt az ajándékot már egy fiókhoz hozzárendelték.'}</div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, background: '#f1f5f9', fontFamily: 'Arial, sans-serif', boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 500, padding: 24, background: '#fff', borderRadius: 16, boxSizing: 'border-box', boxShadow: '0 12px 34px rgba(15,23,42,.1)' },
  brand: { color: '#64748b', fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '7px 0 10px', color: '#0f172a', fontSize: 30 },
  text: { color: '#475569', lineHeight: 1.5 },
  error: { marginTop: 12, padding: 12, borderRadius: 9, background: '#fef2f2', color: '#991b1b' },
  notice: { padding: 12, borderRadius: 9, background: '#f8fafc', color: '#475569' },
  primaryButton: { width: '100%', minHeight: 48, border: 0, borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 16 },
  primaryLink: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 14px', borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800, textDecoration: 'none', textAlign: 'center' },
};
"""
write('src/GiftRedeemPage.tsx', gift_page)

# --- src/AuthPage.tsx ---
auth_path = 'src/AuthPage.tsx'
auth_text = read(auth_path)
auth_text = replace_once(
    auth_text,
    "export function AuthPage() {\n  const [mode, setMode] = useState<Mode>('login');",
    "export function AuthPage() {\n  const requestedReturnTo = new URLSearchParams(window.location.search).get('returnTo');\n  const returnTo =\n    requestedReturnTo && requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')\n      ? requestedReturnTo\n      : '/my-books';\n  const [mode, setMode] = useState<Mode>('login');",
    auth_path,
)
auth_text = replace_once(auth_text, "      window.location.href = '/my-books';", "      window.location.href = returnTo;", auth_path)
write(auth_path, auth_text)

# --- src/main.tsx ---
main = r"""import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'
import { OwnerBookPage } from './OwnerBookPage.tsx'
import { PageInviteEditorPage } from './PageInviteEditorPage.tsx'
import { PublicPage } from './PublicPage.tsx'
import { JoinPage } from './JoinPage.tsx'
import { OrganizerContributionsPage } from './OrganizerContributionsPage.tsx'
import { BookViewerPage } from './BookViewerPage.tsx'
import { InviteCtaPage } from './InviteCtaPage.tsx'
import { EventGuestbookQrPage } from './EventGuestbookQrPage.tsx'
import { PurchasePage } from './PurchasePage.tsx'
import { GiftRedeemPage } from './GiftRedeemPage.tsx'

const path = window.location.pathname
const ownerBookMatch = path.match(/^\/my-books\/([^/]+)$/)
const pageInviteMatch = path.match(/^\/p\/([^/]+)$/)
const publicPageMatch = path.match(/^\/share\/([^/]+)$/)
const joinMatch = path.match(/^\/join\/([^/]+)$/)
const organizerMatch = path.match(/^\/organizer\/([^/]+)\/contributions$/)
const bookViewMatch = path.match(/^\/book\/([^/]+)\/view$/)
const eventQrMatch = path.match(/^\/my-books\/([^/]+)\/event-qr$/)
const giftMatch = path.match(/^\/gift\/([^/]+)$/)

const root = path === '/login'
  ? <AuthPage />
  : path === '/purchase'
    ? <PurchasePage />
  : path === '/nekem-is-kell'
    ? <InviteCtaPage />
  : giftMatch
    ? <GiftRedeemPage token={decodeURIComponent(giftMatch[1])} />
  : eventQrMatch
    ? <EventGuestbookQrPage bookId={decodeURIComponent(eventQrMatch[1])} />
  : path === '/' || path === '/my-books'
    ? <MyBooksPage />
    : ownerBookMatch
      ? <OwnerBookPage bookId={decodeURIComponent(ownerBookMatch[1])} />
      : pageInviteMatch
        ? <PageInviteEditorPage token={decodeURIComponent(pageInviteMatch[1])} />
        : publicPageMatch
          ? <PublicPage token={decodeURIComponent(publicPageMatch[1])} />
          : joinMatch
            ? <JoinPage token={decodeURIComponent(joinMatch[1])} />
            : organizerMatch
              ? <OrganizerContributionsPage bookId={decodeURIComponent(organizerMatch[1])} />
              : bookViewMatch
                ? <BookViewerPage bookId={decodeURIComponent(bookViewMatch[1])} />
                : path === '/demo'
                  ? <App />
                  : <MyBooksPage />

createRoot(document.getElementById('root')!).render(root)
"""
write('src/main.tsx', main)

print('Purchase entitlement foundation patch applied.')
