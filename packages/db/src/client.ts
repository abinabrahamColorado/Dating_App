import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
export function openDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL is required');
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  return { pool, db: drizzle(pool), close: () => pool.end() };
}
