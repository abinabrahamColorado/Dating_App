import { it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { migrate } from '../../packages/db/src/migrate';

it('I-04 migration 0009 preserves unknown historical denial without inventing a blocker', async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('Isolated test database required');
  const name = `meetwell_migration_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^meetwell_migration_[a-f0-9]{32}_test$/.test(name)) throw Error('Invalid fixture name');
  const admin = new Pool({ connectionString: source });
  const target = new URL(source);
  target.pathname = `/${name}`;
  let fixture: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    fixture = new Pool({ connectionString: target.toString() });
    const dir = 'packages/db/migrations';
    for (const file of (await readdir(dir)).filter((f) => /^000[1-8]_.*\.sql$/.test(f)).sort()) {
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      await fixture.query(sql);
      await fixture.query('INSERT INTO ops.schema_migrations(name,checksum) VALUES($1,$2)', [
        file,
        createHash('sha256').update(sql).digest('hex'),
      ]);
    }
    const [a, b] = [randomUUID(), randomUUID()].sort();
    await fixture.query('INSERT INTO app.blocks(low_id,high_id) VALUES($1,$2)', [a, b]);
    await migrate(target.toString());
    expect(
      (await fixture.query('SELECT low_id,high_id FROM app.legacy_pair_denials')).rows,
    ).toEqual([{ low_id: a, high_id: b }]);
    expect((await fixture.query('SELECT * FROM app.blocks')).rows).toEqual([]);
    await fixture.query(
      'INSERT INTO app.blocks(low_id,high_id,blocker_id) VALUES($1,$2,$1),($1,$2,$2)',
      [a, b],
    );
    expect((await fixture.query('SELECT blocker_id FROM app.blocks')).rowCount).toBe(2);
    await expect(
      fixture.query('INSERT INTO app.blocks(low_id,high_id) VALUES($1,$2)', [a, b]),
    ).rejects.toMatchObject({ code: '23502' });
    expect(
      (
        await fixture.query(
          "SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='blocks_pair_lookup'",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await fixture?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
