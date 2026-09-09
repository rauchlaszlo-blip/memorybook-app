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

-- Final page submission notifications are created inside the same database
-- transaction as the page status change. Draft/autosave updates do not match
-- this trigger condition, and event books are explicitly excluded.
CREATE OR REPLACE FUNCTION create_standard_page_submission_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id TEXT;
  current_book_type TEXT;
BEGIN
  IF NEW.invite_status <> 'submitted'
     OR OLD.invite_status = 'submitted'
     OR NEW.submitted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.owner_user_id, b.book_type
  INTO owner_id, current_book_type
  FROM books b
  WHERE b.id = NEW.book_id;

  IF current_book_type <> 'standard' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    id,
    recipient_user_id,
    book_id,
    type,
    source_page_id,
    source_submitted_at,
    actor_name,
    page_number
  )
  VALUES (
    'notification-' || gen_random_uuid()::text,
    owner_id,
    NEW.book_id,
    'standard_page_submitted',
    NEW.id,
    NEW.submitted_at,
    COALESCE(NULLIF(NEW.invite_recipient_name, ''), NULLIF(NEW.invite_recipient_email, '')),
    NEW.page_number
  )
  ON CONFLICT (source_page_id, source_submitted_at) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pages_standard_submission_notification_trigger ON pages;

CREATE TRIGGER pages_standard_submission_notification_trigger
AFTER UPDATE OF invite_status, submitted_at ON pages
FOR EACH ROW
WHEN (NEW.invite_status = 'submitted')
EXECUTE FUNCTION create_standard_page_submission_notification();

-- One-time cleanup of the obsolete email/password test account used before
-- Google OAuth was activated. The guards intentionally target only the known
-- test user, its test book, and its two unpaid draft purchases.
DO $$
DECLARE
  old_user_id TEXT := 'ZhIE1JihhmFq0FcEWSLbsIRROuC0zm8g';
BEGIN
  DELETE FROM books
  WHERE id = 'book-974f42e2-0fa7-40dc-8e51-629125d11b7c'
    AND owner_user_id = old_user_id;

  DELETE FROM purchases
  WHERE id IN (
    'purchase-2be4732e-b2f0-4810-a518-efb9c40a0ac6',
    'purchase-0de374a2-c0ee-43b3-beff-67266ae5b13e'
  )
    AND purchaser_user_id = old_user_id
    AND payment_status = 'draft';

  DELETE FROM users
  WHERE id = old_user_id
    AND email = 'rauchlaszlo@gmail.com';
END;
$$;
