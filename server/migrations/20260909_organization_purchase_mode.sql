ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_purchase_mode_check;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_purchase_mode_check
  CHECK (purchase_mode IN ('self', 'gift', 'organization'));
