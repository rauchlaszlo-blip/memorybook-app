CREATE TABLE event_montage_versions (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id),
 parent_id UUID REFERENCES event_montage_versions(id), owner_id TEXT NOT NULL,
 action_key UUID NOT NULL, request_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('mock','manual')),
 draft JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 approved_at TIMESTAMPTZ, approved_by TEXT, UNIQUE(book_id,action_key)
);
CREATE INDEX event_montage_book_idx ON event_montage_versions(book_id,created_at);
-- Guest identity is the existing opaque device identifier, never the display name.
-- Legacy submissions with no device are conservatively treated as distinct guests.
