from pathlib import Path

p = Path('server/index.ts')
text = p.read_text(encoding='utf-8')
block = """  const testBookGrantMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_grant_test_book_rauch.sql'),
    'utf8'
  );
  await pool.query(testBookGrantMigration);

"""
if block not in text:
    raise SystemExit('test-book grant loader not found')
p.write_text(text.replace(block, '', 1), encoding='utf-8')
Path('server/migrations/20260909_grant_test_book_rauch.sql').unlink()
