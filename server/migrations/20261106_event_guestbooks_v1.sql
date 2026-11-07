-- Independent product tables: legacy books/pages are deliberately untouched.
CREATE TABLE IF NOT EXISTS event_books (
  id UUID PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product = 'celebration'),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  subjects JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(subjects) = 'array'),
  starts_on DATE,
  ends_on DATE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version > 0),
  invite_token TEXT NOT NULL UNIQUE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS event_books_owner_idx ON event_books(owner_user_id, created_at);
CREATE TABLE IF NOT EXISTS event_submissions (
  id UUID PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES event_books(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  guest_name TEXT NOT NULL CHECK (char_length(guest_name) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  occurred_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (book_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS event_submissions_book_idx ON event_submissions(book_id, created_at);
