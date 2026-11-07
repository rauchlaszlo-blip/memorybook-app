-- Additive photo pilot storage. Original bytes never rewritten; derivatives separate.
CREATE TABLE IF NOT EXISTS event_media (
 id UUID PRIMARY KEY,
 book_id UUID NOT NULL REFERENCES event_books(id) ON DELETE CASCADE,
 upload_key UUID NOT NULL,
 submission_id UUID REFERENCES event_submissions(id) ON DELETE CASCADE,
 mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
 original_size INTEGER NOT NULL CHECK (original_size > 0),
 sha256 TEXT NOT NULL CHECK (length(sha256)=64),
 width INTEGER NOT NULL, height INTEGER NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('uploaded','attached')),
 original_bytes BYTEA NOT NULL,
 preview_bytes BYTEA NOT NULL,
 display_bytes BYTEA NOT NULL,
 stored_size INTEGER NOT NULL CHECK (stored_size > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TIMESTAMPTZ,
 UNIQUE(book_id,upload_key),
 CHECK ((state='uploaded' AND submission_id IS NULL AND expires_at IS NOT NULL) OR
        (state='attached' AND submission_id IS NOT NULL AND expires_at IS NULL)),
 CHECK (octet_length(original_bytes)=original_size),
 CHECK (stored_size=octet_length(original_bytes)+octet_length(preview_bytes)+octet_length(display_bytes))
);
CREATE INDEX IF NOT EXISTS event_media_submission_idx ON event_media(submission_id);
CREATE INDEX IF NOT EXISTS event_media_expiry_idx ON event_media(expires_at) WHERE submission_id IS NULL;
