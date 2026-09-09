ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gift_recipient_name TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gift_recipient_email TEXT;
CREATE INDEX IF NOT EXISTS purchases_gift_recipient_email_idx
  ON purchases (gift_recipient_email)
  WHERE purchase_mode = 'gift' AND gift_recipient_email IS NOT NULL;
