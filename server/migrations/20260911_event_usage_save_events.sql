ALTER TABLE event_usage_events
  DROP CONSTRAINT IF EXISTS event_usage_events_event_type_check;

ALTER TABLE event_usage_events
  ADD CONSTRAINT event_usage_events_event_type_check CHECK (
    event_type IN (
      'qr_opened',
      'editor_session_started',
      'editor_session_resumed',
      'page_saved',
      'page_save_failed',
      'page_submitted',
      'page_submit_failed'
    )
  );
