-- Processing inputs, approved editions and exports are independent immutable records.
CREATE TABLE event_book_snapshots (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id), owner_id TEXT NOT NULL,
 action_key UUID NOT NULL, request_hash TEXT NOT NULL, content_hash TEXT NOT NULL,
 sources JSONB NOT NULL, selected_ids JSONB NOT NULL, explicit_selection BOOLEAN NOT NULL,
 actor_kind TEXT NOT NULL CHECK(actor_kind IN ('owner','mcp')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(book_id,action_key)
);
CREATE TABLE event_book_snapshot_media (
 snapshot_id UUID NOT NULL REFERENCES event_book_snapshots(id), media_id UUID NOT NULL,
 source_id UUID NOT NULL, mime_type TEXT NOT NULL, sha256 TEXT NOT NULL,
 original_bytes BYTEA NOT NULL, preview_bytes BYTEA NOT NULL, annotation JSONB,
 PRIMARY KEY(snapshot_id,media_id)
);
ALTER TABLE event_montage_versions ADD COLUMN snapshot_id UUID REFERENCES event_book_snapshots(id);
ALTER TABLE event_montage_versions ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'owner' CHECK(actor_kind IN ('owner','mcp'));
ALTER TABLE event_montage_versions ADD COLUMN revision BIGSERIAL;
WITH ordered AS (SELECT id,row_number() OVER(ORDER BY created_at,id) AS n FROM event_montage_versions)
UPDATE event_montage_versions v SET revision=o.n FROM ordered o WHERE v.id=o.id;
SELECT setval(pg_get_serial_sequence('event_montage_versions','revision'),COALESCE((SELECT max(revision) FROM event_montage_versions),1),(SELECT count(*)>0 FROM event_montage_versions));
CREATE INDEX event_montage_revision_idx ON event_montage_versions(book_id,revision DESC);
CREATE TABLE event_book_editions (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id),
 version_id UUID NOT NULL UNIQUE REFERENCES event_montage_versions(id),
 snapshot_id UUID NOT NULL REFERENCES event_book_snapshots(id), draft JSONB NOT NULL,
 draft_hash TEXT NOT NULL, approved_by TEXT NOT NULL,
 approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, report JSONB NOT NULL
);
CREATE TABLE event_book_export_jobs (
 id UUID PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id),
 edition_id UUID NOT NULL REFERENCES event_book_editions(id),
 version_id UUID NOT NULL REFERENCES event_montage_versions(id),
 action_key UUID NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 lease_token UUID, lease_until TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 error_code TEXT, report JSONB, pdf_bytes BYTEA,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMPTZ, UNIQUE(book_id,action_key)
);
CREATE INDEX event_book_export_work_idx ON event_book_export_jobs(status,next_attempt_at,lease_until);
CREATE TABLE event_book_export_requests (
 book_id UUID NOT NULL REFERENCES event_books(id), action_key UUID NOT NULL, request_hash TEXT NOT NULL,
 job_id UUID NOT NULL REFERENCES event_book_export_jobs(id), PRIMARY KEY(book_id,action_key)
);
CREATE TABLE event_book_audit (
 id BIGSERIAL PRIMARY KEY, book_id UUID NOT NULL REFERENCES event_books(id),
 actor_id TEXT NOT NULL, actor_kind TEXT NOT NULL CHECK(actor_kind IN ('owner','mcp','worker')),
 operation TEXT NOT NULL, target_id UUID, details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- No content/token logging: audit contains IDs, counts, hashes and operation outcomes only.
CREATE FUNCTION memorybook_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable MemoryBook processing record'; END $$;
CREATE TRIGGER event_snapshot_immutable BEFORE UPDATE OR DELETE ON event_book_snapshots FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE TRIGGER event_snapshot_media_immutable BEFORE UPDATE OR DELETE ON event_book_snapshot_media FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE TRIGGER event_edition_immutable BEFORE UPDATE OR DELETE ON event_book_editions FOR EACH ROW EXECUTE FUNCTION memorybook_immutable_record();
CREATE FUNCTION memorybook_version_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(OLD)-'approved_at'-'approved_by') IS DISTINCT FROM (to_jsonb(NEW)-'approved_at'-'approved_by') THEN
  RAISE EXCEPTION 'Immutable MemoryBook version content';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER event_version_content_immutable BEFORE UPDATE ON event_montage_versions FOR EACH ROW EXECUTE FUNCTION memorybook_version_content_immutable();
