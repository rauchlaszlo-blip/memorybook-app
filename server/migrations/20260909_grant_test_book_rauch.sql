DO $$
DECLARE
  target_user_id TEXT;
BEGIN
  SELECT id INTO target_user_id
  FROM users
  WHERE lower(email) = lower('rauchlaszlo@gmail.com')
  LIMIT 1;

  IF target_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM books WHERE id = 'test-book-rauchlaszlo-20260909') THEN
    INSERT INTO books (
      id, owner_user_id, title, invite_token, book_type, page_capacity, language
    ) VALUES (
      'test-book-rauchlaszlo-20260909',
      target_user_id,
      'TESZT – Saját emlékkönyv',
      NULL,
      'standard',
      30,
      'hu'
    );

    INSERT INTO pages (id, book_id, page_number)
    SELECT
      'test-book-rauchlaszlo-20260909-page-' || page_number,
      'test-book-rauchlaszlo-20260909',
      page_number
    FROM generate_series(1, 30) AS page_number;
  END IF;
END $$;
