ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS billing_company_name TEXT;

ALTER TABLE billing_profiles
  ADD COLUMN IF NOT EXISTS billing_company_name TEXT;
