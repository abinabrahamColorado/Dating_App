import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './client';
/** Infrastructure-only migrations. Advisory lock prevents concurrent schema application. */
export async function migrate(connectionString: string) {
  const { pool, close } = openDatabase(connectionString);
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('meetwell.schema_migrations'))");
      const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
      const files = (await readdir(directory)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
      for (const file of files) {
        const sql = await readFile(`${directory}/${file}`, 'utf8');
        const digest = createHash('sha256').update(sql).digest('hex');
        const exists = await client.query<{ name: string | null }>(
          "SELECT to_regclass('ops.schema_migrations')::text AS name",
        );
        const previous = exists.rows[0]?.name
          ? await client.query<{ checksum: string }>(
              'SELECT checksum FROM ops.schema_migrations WHERE name = $1',
              [file],
            )
          : null;
        if (previous?.rows[0]) {
          if (previous.rows[0].checksum !== digest)
            throw new Error('Applied migration checksum changed');
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO ops.schema_migrations (name, checksum) VALUES ($1, $2)', [
            file,
            digest,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      // Closing the dedicated session releases its advisory lock even if a
      // failed connection can no longer execute an explicit unlock query.
      client.release(true);
    }
  } finally {
    await close();
  }
}
