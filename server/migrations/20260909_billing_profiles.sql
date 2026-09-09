CREATE TABLE IF NOT EXISTS billing_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  billing_name TEXT NOT NULL,
  billing_email TEXT NOT NULL,
  billing_country TEXT NOT NULL,
  billing_postal_code TEXT NOT NULL,
  billing_city TEXT NOT NULL,
  billing_address TEXT NOT NULL,
  billing_tax_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO billing_profiles (
  user_id,
  billing_name,
  billing_email,
  billing_country,
  billing_postal_code,
  billing_city,
  billing_address,
  billing_tax_number,
  created_at,
  updated_at
)
SELECT DISTINCT ON (p.purchaser_user_id)
  p.purchaser_user_id,
  p.billing_name,
  p.billing_email,
  p.billing_country,
  p.billing_postal_code,
  p.billing_city,
  p.billing_address,
  p.billing_tax_number,
  p.created_at,
  p.updated_at
FROM purchases p
WHERE p.purchaser_user_id IS NOT NULL
ORDER BY p.purchaser_user_id, p.created_at DESC
ON CONFLICT (user_id) DO NOTHING;
