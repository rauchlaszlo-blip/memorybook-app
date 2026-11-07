ALTER TABLE event_books ADD COLUMN IF NOT EXISTS package_version INTEGER;
ALTER TABLE event_books ADD COLUMN IF NOT EXISTS submission_start TIMESTAMPTZ;
ALTER TABLE event_books ADD COLUMN IF NOT EXISTS submission_end TIMESTAMPTZ;
ALTER TABLE event_books ADD COLUMN IF NOT EXISTS first_submission_end TIMESTAMPTZ;
ALTER TABLE event_books ADD COLUMN IF NOT EXISTS pilot_clock TIMESTAMPTZ;
ALTER TABLE event_books ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE event_submissions ADD COLUMN IF NOT EXISTS guest_device_id TEXT;
CREATE INDEX IF NOT EXISTS event_submissions_device_idx ON event_submissions(book_id,guest_device_id);
CREATE TABLE IF NOT EXISTS pilot_commerce_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pilot_test_codes (
 id UUID PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, used_at TIMESTAMPTZ, used_by TEXT
);
CREATE TABLE IF NOT EXISTS pilot_test_orders (
 id UUID PRIMARY KEY, user_id TEXT NOT NULL, code_id UUID NOT NULL UNIQUE REFERENCES pilot_test_codes(id),
 idempotency_key UUID NOT NULL, status TEXT NOT NULL DEFAULT 'test_completed' CHECK(status='test_completed'),
 amount INTEGER NOT NULL DEFAULT 0 CHECK(amount=0), currency TEXT NOT NULL DEFAULT 'HUF' CHECK(currency='HUF'),
 product_id TEXT NOT NULL CHECK(product_id='wedding'), package_snapshot JSONB NOT NULL,
 billing JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 purchase_day DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date,
 latest_event_day DATE NOT NULL DEFAULT (((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Budapest')::date+interval '12 months')::date),
 UNIQUE(user_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pilot_book_entitlements (
 order_id UUID PRIMARY KEY REFERENCES pilot_test_orders(id), user_id TEXT NOT NULL,
 book_id UUID UNIQUE REFERENCES event_books(id), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pilot_test_mail (
 id UUID PRIMARY KEY, recipient TEXT NOT NULL, kind TEXT NOT NULL, encrypted_url TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMPTZ NOT NULL
);
