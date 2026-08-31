import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const result = await pool.query(
  "SELECT id, page_number, version, updated_at FROM pages ORDER BY page_number, id"
);

console.table(result.rows);
await pool.end();
