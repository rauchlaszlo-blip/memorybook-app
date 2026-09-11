ALTER TABLE books
  ALTER COLUMN event_required_fields SET DEFAULT '["name"]'::jsonb;

UPDATE books
SET event_device_limit = 1,
    event_required_fields = '["name"]'::jsonb
WHERE book_type = 'event'
  AND updated_at < TIMESTAMPTZ '2026-09-11 12:10:00+00'
  AND (event_device_limit <> 1 OR event_required_fields <> '["name"]'::jsonb);
