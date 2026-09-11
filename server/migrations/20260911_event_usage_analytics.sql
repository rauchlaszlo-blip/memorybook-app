CREATE TABLE IF NOT EXISTS event_usage_events (
  id BIGSERIAL PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'qr_opened',
      'editor_session_started',
      'editor_session_resumed',
      'page_submitted',
      'page_submit_failed'
    )
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  payload_bytes INTEGER CHECK (payload_bytes IS NULL OR payload_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS event_usage_events_book_created_idx
  ON event_usage_events (book_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_usage_events_book_type_created_idx
  ON event_usage_events (book_id, event_type, created_at DESC);
