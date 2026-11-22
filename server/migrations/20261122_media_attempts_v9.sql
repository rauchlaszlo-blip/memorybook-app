-- Durable, bounded quarantine. Only complete received originals enter pending_bytes.
-- No background work and no public/raw quarantine endpoint.
CREATE TABLE event_media_attempts (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id), upload_key UUID NOT NULL,
 guest_device_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('photo','audio','video')),
 source_hint TEXT NOT NULL DEFAULT 'unknown' CHECK(source_hint IN ('gallery','camera','recorder','file','unknown')),
 mime_hint TEXT CHECK(mime_hint IS NULL OR length(mime_hint)<=100),
 state TEXT NOT NULL CHECK(state IN ('receiving','processing','uploaded','attached','failed')),
 stage TEXT NOT NULL CHECK(stage IN ('receiving','validation','storage','submission','complete')),
 sha256 TEXT, byte_length INTEGER NOT NULL DEFAULT 0 CHECK(byte_length>=0 AND byte_length<=25165824),
 pending_bytes BYTEA, media_id UUID REFERENCES event_media(id),
 error_code TEXT, error_status INTEGER, diagnostic_id UUID NOT NULL,
 lease_token UUID, lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(book_id,upload_key),
 CHECK(pending_bytes IS NULL OR (sha256 IS NOT NULL AND octet_length(pending_bytes)=byte_length)),
 CHECK(sha256 IS NULL OR length(sha256)=64)
);
CREATE INDEX event_media_attempts_book_idx ON event_media_attempts(book_id,updated_at DESC);
CREATE FUNCTION memorybook_attempt_original_preserved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.upload_key IS DISTINCT FROM OLD.upload_key
    OR NEW.guest_device_id IS DISTINCT FROM OLD.guest_device_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
  RAISE EXCEPTION 'Media attempt target identity is immutable';
 END IF;
 IF OLD.sha256 IS NOT NULL AND (NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.byte_length<>OLD.byte_length) THEN
  RAISE EXCEPTION 'Media attempt original identity is immutable';
 END IF;
 IF OLD.pending_bytes IS NOT NULL AND NEW.pending_bytes IS DISTINCT FROM OLD.pending_bytes THEN
  IF NEW.pending_bytes IS NOT NULL OR NEW.media_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM event_media m WHERE m.id=NEW.media_id AND m.book_id=NEW.book_id AND m.upload_key=NEW.upload_key
    AND m.sha256=OLD.sha256 AND m.original_bytes=OLD.pending_bytes
  ) THEN RAISE EXCEPTION 'Media attempt original must remain preserved'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_media_attempt_original BEFORE UPDATE ON event_media_attempts FOR EACH ROW EXECUTE FUNCTION memorybook_attempt_original_preserved();
