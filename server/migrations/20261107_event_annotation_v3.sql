-- Separate immutable annotation/composite rows; existing original media is untouched.
CREATE TABLE IF NOT EXISTS event_media_annotations (
 media_id UUID PRIMARY KEY REFERENCES event_media(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK (version=1),
 layer JSONB NOT NULL CHECK (jsonb_typeof(layer)='object'),
 layer_hash TEXT NOT NULL CHECK (length(layer_hash)=64),
 preview_bytes BYTEA NOT NULL,
 display_bytes BYTEA NOT NULL,
 stored_size INTEGER NOT NULL CHECK (stored_size=octet_length(preview_bytes)+octet_length(display_bytes)+octet_length(layer::text)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
