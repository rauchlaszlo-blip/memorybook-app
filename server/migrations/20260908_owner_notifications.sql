-- MemoryBook owner notification foundation
-- Standard books: one in-app notification per final page submission.
-- Event books: no per-contribution notification rows; the organizer badge is
-- derived from pending contributions instead.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('standard_page_submitted')),
  source_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source_submitted_at TIMESTAMPTZ NOT NULL,
  actor_name TEXT,
  page_number INTEGER NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_page_id, source_submitted_at)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
ON notifications (recipient_user_id, created_at DESC)
WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_book_unread_idx
ON notifications (book_id, created_at DESC)
WHERE read_at IS NULL;

-- Event guestbooks can receive hundreds or thousands of submissions in a short
-- window. Their badge is the count of contributions still awaiting organizer
-- review, not a separate notification stream.
CREATE INDEX IF NOT EXISTS contributions_book_pending_idx
ON contributions (book_id, created_at DESC)
WHERE owner_status = 'pending';
