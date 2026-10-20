import 'dotenv/config';
import { openDatabase } from '../packages/db/src/client';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('This grant script is restricted to local development');
}
const { pool, close } = openDatabase(url);
try {
  await pool.query('GRANT meetwell_worker TO meetwell_worker_dev');
} finally {
  await close();
}
