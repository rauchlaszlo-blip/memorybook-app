import type {Pool} from 'pg';

/** Additive schema: existing pages, book types and payment tables keep their contracts. */
export async function migrateCollection(pool:Pool){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(61126,1)');
    await db.query(`CREATE TABLE IF NOT EXISTS collection_schema_migrations(version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    if(!(await db.query("SELECT 1 FROM collection_schema_migrations WHERE version='20261126-v1'")).rowCount){
      await db.query(`
        CREATE TABLE collection_settings(book_id TEXT PRIMARY KEY REFERENCES books(id),revision INTEGER NOT NULL DEFAULT 0,
          events JSONB NOT NULL DEFAULT '[]',locations JSONB NOT NULL DEFAULT '[]');
        CREATE TABLE collection_groups(page_id TEXT PRIMARY KEY REFERENCES pages(id),book_id TEXT NOT NULL REFERENCES books(id),
          state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN('draft','submitted')),submission_id UUID UNIQUE,commit_key UUID,commit_hash TEXT,
          canvas_json JSONB,guest_data JSONB,event_labels JSONB,location_labels JSONB,author_share_approved BOOLEAN NOT NULL DEFAULT FALSE,
          page_version INTEGER,preview_bytes BYTEA,stored_size INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,committed_at TIMESTAMPTZ,
          CHECK((state='submitted')=(submission_id IS NOT NULL)));
        CREATE TABLE collection_files(id UUID PRIMARY KEY,page_id TEXT NOT NULL REFERENCES collection_groups(page_id),book_id TEXT NOT NULL REFERENCES books(id),
          kind TEXT NOT NULL CHECK(kind IN('photo','audio','video')),file_name TEXT NOT NULL,mime_hint TEXT NOT NULL,
          byte_length INTEGER NOT NULL CHECK(byte_length>0),sha256 TEXT NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),actual_sha256 TEXT,
          state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN('uploading','processing','ready','failed','removed')),chunk_count INTEGER NOT NULL CHECK(chunk_count>0),
          original_bytes BYTEA,preview_bytes BYTEA,playback_bytes BYTEA,actual_mime TEXT,playback_mime TEXT,width INTEGER,height INTEGER,duration_seconds DOUBLE PRECISION,
          captured_at TEXT,capture_time_source TEXT,error_code TEXT,lease_token UUID,lease_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK(original_bytes IS NULL OR octet_length(original_bytes)=byte_length));
        CREATE INDEX collection_files_book_idx ON collection_files(book_id,page_id);
        CREATE TABLE collection_chunks(file_id UUID NOT NULL REFERENCES collection_files(id),chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
          bytes BYTEA NOT NULL CHECK(octet_length(bytes)>0 AND octet_length(bytes)<=262144),sha256 TEXT NOT NULL,PRIMARY KEY(file_id,chunk_index));
        CREATE FUNCTION collection_preserve_original() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.id IS DISTINCT FROM OLD.id OR NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.book_id IS DISTINCT FROM OLD.book_id OR NEW.kind IS DISTINCT FROM OLD.kind
             OR NEW.byte_length IS DISTINCT FROM OLD.byte_length OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.mime_hint IS DISTINCT FROM OLD.mime_hint
             OR (OLD.original_bytes IS NOT NULL AND NEW.original_bytes IS DISTINCT FROM OLD.original_bytes) THEN RAISE EXCEPTION 'Collection original is immutable'; END IF;
          RETURN NEW; END $$;
        CREATE TRIGGER collection_original_immutable BEFORE UPDATE ON collection_files FOR EACH ROW EXECUTE FUNCTION collection_preserve_original();
        CREATE FUNCTION collection_preserve_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.state='submitted' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Collection submission is immutable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER collection_submission_immutable BEFORE UPDATE ON collection_groups FOR EACH ROW EXECUTE FUNCTION collection_preserve_submission();
        INSERT INTO collection_schema_migrations(version) VALUES('20261126-v1');
      `);
    }
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
