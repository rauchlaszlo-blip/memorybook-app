-- Evidence and owner decisions are append-only; originals and editions are untouched.
ALTER TABLE event_books ADD COLUMN content_review_revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE event_content_review_items (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id), logical_key TEXT NOT NULL,
 source_id UUID NOT NULL, media_id UUID, version_id UUID, element_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('text','photo','audio','video')),
 content_hash TEXT NOT NULL, evidence JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(book_id,logical_key,content_hash)
);
CREATE INDEX event_content_review_target_idx ON event_content_review_items(book_id,logical_key);
CREATE TABLE event_content_review_flags (
 id UUID PRIMARY KEY, item_id UUID NOT NULL REFERENCES event_content_review_items(id),
 category TEXT NOT NULL CHECK(category IN ('possible_sexual','possible_extremist','offensive_text')),
 origin TEXT NOT NULL CHECK(origin IN ('manual','mcp','machine')),
 reason TEXT NOT NULL, scope JSONB NOT NULL, actor_id TEXT NOT NULL, revision BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(item_id,category,origin)
);
CREATE TABLE event_content_review_decisions (
 id UUID PRIMARY KEY, item_id UUID NOT NULL REFERENCES event_content_review_items(id),
 decision TEXT NOT NULL CHECK(decision IN ('false_positive','allowed','private_only','omit')),
 note TEXT, scope JSONB NOT NULL, actor_id TEXT NOT NULL, revision BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX event_content_review_decision_idx ON event_content_review_decisions(item_id,revision DESC);
CREATE TABLE event_content_review_requests (
 book_id UUID NOT NULL REFERENCES event_books(id), action_key UUID NOT NULL,
 operation TEXT NOT NULL, request_hash TEXT NOT NULL, item_id UUID NOT NULL REFERENCES event_content_review_items(id),
 revision BIGINT NOT NULL, PRIMARY KEY(book_id,action_key)
);
CREATE TABLE event_content_review_restrictions (
 book_id UUID NOT NULL REFERENCES event_books(id), logical_key TEXT NOT NULL,
 last_restriction_revision BIGINT NOT NULL, PRIMARY KEY(book_id,logical_key)
);
CREATE TABLE event_content_release_clearances (
 book_id UUID NOT NULL REFERENCES event_books(id), version_id UUID NOT NULL REFERENCES event_montage_versions(id),
 owner_reviewed_revision BIGINT NOT NULL, actor_id TEXT NOT NULL,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(book_id,version_id)
);
CREATE TRIGGER event_content_review_item_immutable BEFORE UPDATE OR DELETE ON event_content_review_items FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE TRIGGER event_content_review_flag_immutable BEFORE UPDATE OR DELETE ON event_content_review_flags FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE TRIGGER event_content_review_decision_immutable BEFORE UPDATE OR DELETE ON event_content_review_decisions FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE TRIGGER event_content_review_request_immutable BEFORE UPDATE OR DELETE ON event_content_review_requests FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
