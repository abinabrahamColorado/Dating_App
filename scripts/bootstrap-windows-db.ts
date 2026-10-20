import { Pool } from 'pg';

// Fixed local bootstrap target, never derived from production environment values.
const pool = new Pool({
  connectionString: 'postgresql://meetwell_dev:local-development-only@127.0.0.1:55432/postgres',
  connectionTimeoutMillis: 5000,
});
try {
  for (const name of ['meetwell_dev', 'meetwell_test']) {
    const exists = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      // Names are fixed constants above; CREATE DATABASE cannot parameterize identifiers.
      await pool.query(`CREATE DATABASE "${name}" OWNER meetwell_dev`);
    }
  }
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meetwell_worker_dev') THEN
        CREATE ROLE meetwell_worker_dev LOGIN PASSWORD 'local-worker-only'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END IF;
    END $$;
  `);
  process.stdout.write('Development/test databases and restricted worker login are ready.\n');
} finally {
  await pool.end();
}
