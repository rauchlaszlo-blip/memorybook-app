ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_book_type_check;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_book_type_check
  CHECK (book_type IN ('standard', 'event', 'dedication'));

ALTER TABLE book_entitlements
  DROP CONSTRAINT IF EXISTS book_entitlements_book_type_check;

ALTER TABLE book_entitlements
  ADD CONSTRAINT book_entitlements_book_type_check
  CHECK (book_type IN ('standard', 'event', 'dedication'));
