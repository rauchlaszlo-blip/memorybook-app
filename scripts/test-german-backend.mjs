import pg from 'pg';

const { Pool } = pg;
const base = 'http://127.0.0.1:3001';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function acceptance() {
  let r = await request('/api/my/books/test/language', {
    method: 'PATCH',
    body: JSON.stringify({ language: 'de' }),
  });
  if (r.data.error === 'INVALID_BOOK_LANGUAGE') {
    throw new Error('Backend rejected German book language');
  }

  r = await request('/api/my/books/test/language', {
    method: 'PATCH',
    body: JSON.stringify({ language: 'fr' }),
  });
  if (r.response.status !== 400 || r.data.error !== 'INVALID_BOOK_LANGUAGE') {
    throw new Error(`French book language should be rejected: ${r.response.status} ${JSON.stringify(r.data)}`);
  }

  r = await request('/api/my/books/test/pages/test/invite/sent', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Anna',
      recipientEmail: '',
      deliveryMethod: 'share',
      inviteLanguage: 'de',
    }),
  });
  if (r.data.error === 'INVALID_INVITE_LANGUAGE') {
    throw new Error('Backend rejected German invite language');
  }

  r = await request('/api/my/books/test/pages/test/invite/sent', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Anna',
      recipientEmail: '',
      deliveryMethod: 'share',
      inviteLanguage: 'fr',
    }),
  });
  if (r.response.status !== 400 || r.data.error !== 'INVALID_INVITE_LANGUAGE') {
    throw new Error(`French invite language should be rejected: ${r.response.status} ${JSON.stringify(r.data)}`);
  }

  await pool.query("INSERT INTO users (id, display_name, email) VALUES ('de-user', 'Deutsch Test', 'de-user@example.test') ON CONFLICT (id) DO NOTHING");
  await pool.query("INSERT INTO books (id, owner_user_id, title, invite_token, book_type, language) VALUES ('de-book', 'de-user', 'Deutsches Buch', 'de-book-token', 'standard', 'de') ON CONFLICT (id) DO UPDATE SET language='de'");
  await pool.query("INSERT INTO pages (id, book_id, page_number, invite_status, invite_token, invite_language) VALUES ('de-page', 'de-book', 1, 'invited', 'de-page-token', 'de') ON CONFLICT (id) DO UPDATE SET invite_language='de'");

  const result = await pool.query("SELECT b.language, p.invite_language FROM books b JOIN pages p ON p.book_id=b.id WHERE b.id='de-book'");
  const row = result.rows[0];
  if (row?.language !== 'de' || row?.invite_language !== 'de') {
    throw new Error(`German values were not stored: ${JSON.stringify(row)}`);
  }

  console.log('GERMAN_BACKEND_ACCEPTANCE_PASS');
}

async function persistence() {
  const result = await pool.query("SELECT b.language, p.invite_language FROM books b JOIN pages p ON p.book_id=b.id WHERE b.id='de-book'");
  const row = result.rows[0];
  if (row?.language !== 'de' || row?.invite_language !== 'de') {
    throw new Error(`German values did not survive startup: ${JSON.stringify(row)}`);
  }
  console.log('GERMAN_STARTUP_PERSISTENCE_PASS');
}

try {
  if (process.argv.includes('--persistence-only')) {
    await persistence();
  } else {
    await acceptance();
  }
} finally {
  await pool.end();
}
