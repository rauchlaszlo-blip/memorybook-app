ALTER TABLE books
  ALTER COLUMN event_required_fields SET DEFAULT '["name"]'::jsonb;

UPDATE books
SET event_required_fields = '["name"]'::jsonb
WHERE book_type = 'event'
  AND event_required_fields = '[]'::jsonb;
