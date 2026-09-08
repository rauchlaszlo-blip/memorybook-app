from pathlib import Path

p = Path('server/index.ts')
s = p.read_text(encoding='utf-8')

# Contribution list includes manual organization metadata.
s = s.replace(
'''         photo_url AS "photoUrl",\n         owner_status AS "ownerStatus",\n         created_at AS "createdAt"\n       FROM contributions''',
'''         photo_url AS "photoUrl",\n         owner_status AS "ownerStatus",\n         owner_group AS "ownerGroup",\n         owner_order AS "ownerOrder",\n         created_at AS "createdAt"\n       FROM contributions''',
1)

# When an item is kept, assign it the next order position if needed. Leaving kept clears order.
s = s.replace(
'''      `UPDATE contributions c\n       SET owner_status = $1\n       FROM books b''',
'''      `UPDATE contributions c\n       SET owner_status = $1,\n           owner_order = CASE\n             WHEN $1 = 'kept' THEN COALESCE(\n               c.owner_order,\n               (\n                 SELECT COALESCE(MAX(c2.owner_order), 0) + 1\n                 FROM contributions c2\n                 WHERE c2.book_id = $3\n                   AND c2.owner_status = 'kept'\n               )\n             )\n             ELSE NULL\n           END\n       FROM books b''',
1)
s = s.replace(
'''         c.photo_url AS "photoUrl",\n         c.owner_status AS "ownerStatus",\n         c.created_at AS "createdAt"`,''',
'''         c.photo_url AS "photoUrl",\n         c.owner_status AS "ownerStatus",\n         c.owner_group AS "ownerGroup",\n         c.owner_order AS "ownerOrder",\n         c.created_at AS "createdAt"`,''',
1)

anchor = "app.get('/api/books/:bookId/pages', async (req, res) => {"
if anchor not in s:
    raise SystemExit('pages route anchor missing')

organization_routes = r'''app.patch('/api/my/books/:bookId/contributions/:contributionId/group', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const rawGroup = req.body?.ownerGroup;
  if (rawGroup !== null && rawGroup !== undefined && typeof rawGroup !== 'string') {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_GROUP' });
    return;
  }

  const ownerGroup = typeof rawGroup === 'string' ? rawGroup.trim() : '';
  if (ownerGroup.length > 80) {
    res.status(400).json({ error: 'CONTRIBUTION_GROUP_TOO_LONG' });
    return;
  }

  try {
    const session = await getSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHENTICATED' });
      return;
    }

    const result = await pool.query(
      `UPDATE contributions c
       SET owner_group = $1
       FROM books b
       WHERE c.id = $2
         AND c.book_id = $3
         AND c.owner_status = 'kept'
         AND b.id = c.book_id
         AND b.owner_user_id = $4
         AND b.book_type = 'event'
       RETURNING
         c.id,
         c.contributor_name AS "contributorName",
         c.memory_text AS "memoryText",
         c.photo_url AS "photoUrl",
         c.owner_status AS "ownerStatus",
         c.owner_group AS "ownerGroup",
         c.owner_order AS "ownerOrder",
         c.created_at AS "createdAt"`,
      [ownerGroup || null, req.params.contributionId, req.params.bookId, session.user.id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'CONTRIBUTION_NOT_FOUND' });
      return;
    }

    res.status(200).json({ success: true, contribution: result.rows[0] });
  } catch (err) {
    console.error('Contribution group update error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_GROUP_UPDATE_FAILED' });
  }
});

app.put('/api/my/books/:bookId/contributions/reorder', async (req, res) => {
  if (!auth) {
    res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const contributionIds = req.body?.contributionIds;
  if (
    !Array.isArray(contributionIds) ||
    contributionIds.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(contributionIds).size !== contributionIds.length
  ) {
    res.status(400).json({ error: 'INVALID_CONTRIBUTION_ORDER' });
    return;
  }

  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookResult = await client.query(
      `SELECT id
       FROM books
       WHERE id = $1 AND owner_user_id = $2 AND book_type = 'event'
       FOR UPDATE`,
      [req.params.bookId, session.user.id]
    );

    if (bookResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'BOOK_NOT_FOUND' });
      return;
    }

    const keptResult = await client.query(
      `SELECT id
       FROM contributions
       WHERE book_id = $1 AND owner_status = 'kept'
       ORDER BY COALESCE(owner_order, 2147483647), created_at ASC, id ASC
       FOR UPDATE`,
      [req.params.bookId]
    );

    const keptIds = keptResult.rows.map((row) => String(row.id));
    const requested = new Set(contributionIds);
    if (
      keptIds.length !== contributionIds.length ||
      keptIds.some((id) => !requested.has(id))
    ) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'ORDER_MUST_INCLUDE_ALL_KEPT_CONTRIBUTIONS' });
      return;
    }

    for (let index = 0; index < contributionIds.length; index += 1) {
      await client.query(
        `UPDATE contributions
         SET owner_order = $1
         WHERE id = $2 AND book_id = $3 AND owner_status = 'kept'`,
        [index + 1, contributionIds[index], req.params.bookId]
      );
    }

    await client.query('COMMIT');
    res.status(200).json({
      success: true,
      order: contributionIds.map((id, index) => ({ id, ownerOrder: index + 1 })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Contribution reorder error:', err);
    res.status(500).json({ error: 'CONTRIBUTION_REORDER_FAILED' });
  } finally {
    client.release();
  }
});

'''
s = s.replace(anchor, organization_routes + anchor, 1)

# Database migration for manual organization metadata.
s = s.replace(
'''  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'pending'`);''',
'''  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'pending'`);\n  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_group TEXT`);\n  await pool.query(`ALTER TABLE contributions ADD COLUMN IF NOT EXISTS owner_order INTEGER`);''',
1)

p.write_text(s, encoding='utf-8')
