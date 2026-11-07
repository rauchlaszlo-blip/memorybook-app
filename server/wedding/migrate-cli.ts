import { Pool } from 'pg';
import { localDatabaseUrl } from './local-db';
import { migrateWedding } from './migrate';

const pool = new Pool({ connectionString: localDatabaseUrl() });
try {
  await migrateWedding(pool);
  console.log('Wedding migration complete.');
} finally { await pool.end(); }
