ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS billing_country_code TEXT;

ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS invoice_language TEXT;

ALTER TABLE purchases
ADD COLUMN IF NOT EXISTS invoice_tax_code TEXT;

UPDATE purchases
SET invoice_language = 'hu'
WHERE invoice_language IS NULL
   OR invoice_language NOT IN ('hu', 'en', 'de');

UPDATE purchases
SET billing_country_code = 'HU'
WHERE billing_country_code IS NULL
  AND LOWER(TRIM(billing_country)) IN ('magyarország', 'hungary', 'ungarn');

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
  provider TEXT CHECK (provider IN ('billingo', 'szamlazzhu')),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'issuing', 'issued', 'failed', 'cancelled')),
  payload_json JSONB NOT NULL,
  provider_response_json JSONB,
  external_invoice_id TEXT,
  invoice_number TEXT,
  invoice_pdf_url TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  last_attempt_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx
ON purchase_invoices (status, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_external_id_unique
ON purchase_invoices (provider, external_invoice_id)
WHERE external_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_number_unique
ON purchase_invoices (provider, invoice_number)
WHERE invoice_number IS NOT NULL;
