import { beforeAll, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../../packages/db/src/migrate';
import { startWorker, HEALTH_QUEUE } from '../../apps/worker/src/worker';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('A real isolated PostgreSQL TEST_DATABASE_URL ending in _test is required');
const pool = new Pool({ connectionString: url });
beforeAll(async () => {
  await migrate(url);
});
afterAll(async () => {
  await pool.end();
});
it('M0 PostGIS is installed on PostgreSQL 16', async () => {
  const r = await pool.query<{ version: string; postgis: string }>(
    "SELECT current_setting('server_version_num') AS version, postgis_version() AS postgis",
  );
  expect(Number(r.rows[0]?.version)).toBeGreaterThanOrEqual(160000);
  expect(Number(r.rows[0]?.version)).toBeLessThan(170000);
  expect(r.rows[0]?.postgis).toMatch(/^3\./);
});
it('M0 migration reruns preserve the immutable ledger', async () => {
  await migrate(url);
  const r = await pool.query('SELECT name FROM ops.schema_migrations');
  expect(r.rows).toEqual([{ name: '0001_boundaries.sql' }]);
});
it('I-12 M0 foundation: app and learning roles cannot read safety records', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE TABLE safety.m0_case_probe (detail text)');
    await c.query("INSERT INTO safety.m0_case_probe VALUES ('synthetic case')");
    for (const role of ['meetwell_app', 'meetwell_learning']) {
      await c.query('SAVEPOINT permission_probe');
      await c.query(`SET LOCAL ROLE ${role}`);
      await expect(c.query('SELECT detail FROM safety.m0_case_probe')).rejects.toMatchObject({
        code: '42501',
      });
      await c.query('ROLLBACK TO SAVEPOINT permission_probe');
    }
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
it('M0 runtime roles cannot create application tables, create schemas or inherit case privileges', async () => {
  const r = await pool.query<{ unsafe: boolean; safety: boolean; workerCreate: boolean }>(
    `SELECT has_schema_privilege('meetwell_app','app','CREATE') AS unsafe,
      pg_has_role('meetwell_app','meetwell_safety','MEMBER') AS safety,
      has_database_privilege('meetwell_worker',current_database(),'CREATE') AS "workerCreate"`,
  );
  expect(r.rows[0]).toEqual({ unsafe: false, safety: false, workerCreate: false });
});
it('M0 pg-boss executes a real durable infrastructure job with the worker role', async () => {
  const workerUrl = new URL(url);
  workerUrl.searchParams.set('options', '-c role=meetwell_worker');
  const boss = await startWorker(workerUrl.toString());
  try {
    const id = await boss.send(HEALTH_QUEUE, {});
    expect(id).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await pool.query<{ state: string }>('SELECT state FROM queue.job WHERE id = $1', [id]))
            .rows[0]?.state,
        { timeout: 20000 },
      )
      .toBe('completed');
  } finally {
    await boss.stop({ graceful: true });
  }
});
