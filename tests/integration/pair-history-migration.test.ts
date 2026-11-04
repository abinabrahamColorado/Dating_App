import { it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { migrate } from '../../packages/db/src/migrate';

it('I-05 migration 0012 repairs premature exclusions and retains historical attempts and exposures', async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw Error('Isolated test database required');
  const name = `meetwell_pair_migration_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^meetwell_pair_migration_[a-f0-9]{32}_test$/.test(name))
    throw Error('Invalid fixture name');
  const cluster = new Pool({ connectionString: source });
  const target = new URL(source);
  target.pathname = `/${name}`;
  let fixture: Pool | undefined;
  try {
    await cluster.query(`CREATE DATABASE "${name}"`);
    fixture = new Pool({ connectionString: target.toString() });
    for (const file of (await readdir('packages/db/migrations'))
      .filter((f) => /^\d+.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 11)
      .sort()) {
      const sql = await readFile(`packages/db/migrations/${file}`, 'utf8');
      await fixture.query(sql);
      await fixture.query('INSERT INTO ops.schema_migrations(name,checksum) VALUES($1,$2)', [
        file,
        createHash('sha256').update(sql).digest('hex'),
      ]);
    }
    const batch = randomUUID();
    await fixture.query(
      "INSERT INTO app.explore_batches(id,seed,policy,summary_cipher) VALUES($1,'synthetic','operator','synthetic')",
      [batch],
    );
    const scenarios = [
      { state: 'RESERVED', delivered: false, connection: false, permanent: false },
      { state: 'CANCELLED', delivered: false, connection: false, permanent: false },
      { state: 'CANCELLED', delivered: true, connection: false, permanent: false },
      { state: 'EXPIRED', delivered: false, connection: false, permanent: false },
      { state: 'EXPIRED', delivered: true, connection: false, permanent: true },
      { state: 'PASSED', delivered: true, connection: false, permanent: true },
      { state: 'BLOCKED', delivered: false, connection: false, permanent: true },
      { state: 'RESTRICTED', delivered: false, connection: false, permanent: true },
      { state: 'CLOSED', delivered: true, connection: true, permanent: true },
      { state: 'CLOSED', delivered: false, connection: false, permanent: false },
    ].map((c) => ({ ...c, id: randomUUID(), pair: [randomUUID(), randomUUID()].sort() }));
    for (const c of scenarios) {
      await fixture.query(
        `INSERT INTO app.opportunities(id,batch_id,low_id,high_id,state,slot_held,
      reserved_week,reserve_expires_at,proposed_at,closed_at,policy,policy_version,feature_version,
      feature_snapshot,retrieval_source,feasible_size,seed,step,q,branch)
      VALUES($1,$2,$3,$4,$5,$6,current_date,now(),CASE WHEN $7 THEN now() END,
      CASE WHEN $6 THEN NULL ELSE now() END,'operator','test','test','test','test',1,'test',0,NULL,'OPERATOR')`,
        [c.id, batch, ...c.pair, c.state, c.state === 'RESERVED', c.delivered],
      );
      if (c.connection)
        await fixture.query('INSERT INTO app.connections(id,closed_at) VALUES($1,now())', [c.id]);
      if (c.delivered)
        await fixture.query(
          `INSERT INTO learning.introduction_exposure
      (opportunity_id,low_id,high_id,policy,policy_version,feature_version,feature_snapshot,retrieval_source,
      feasible_size,seed,step,q,branch,delivered_at) VALUES($1,$2,$3,'operator','test','test','test','test',1,'test',0,NULL,'OPERATOR',now())`,
          [c.id, ...c.pair],
        );
    }
    expect((await fixture.query('SELECT 1 FROM app.pair_history')).rowCount).toBe(scenarios.length);
    await migrate(target.toString());
    await migrate(target.toString());
    for (const c of scenarios) {
      expect(
        (
          await fixture.query(
            'SELECT 1 FROM app.pair_history WHERE low_id=$1 AND high_id=$2',
            c.pair,
          )
        ).rowCount,
      ).toBe(c.permanent ? 1 : 0);
      expect(
        (await fixture.query('SELECT 1 FROM app.opportunities WHERE id=$1', [c.id])).rowCount,
      ).toBe(1);
    }
    expect((await fixture.query('SELECT 1 FROM learning.introduction_exposure')).rowCount).toBe(
      scenarios.filter((c) => c.delivered).length,
    );
    expect((await fixture.query('SELECT 1 FROM app.opportunity_closures')).rowCount).toBe(
      scenarios.length - 1,
    );
    expect(
      (
        await fixture.query(
          "SELECT 1 FROM app.opportunity_closures WHERE reason='LEGACY_CANCELLED'",
        )
      ).rowCount,
    ).toBe(2);
  } finally {
    await fixture?.end();
    await cluster.query(`DROP DATABASE IF EXISTS "${name}"`);
    await cluster.end();
  }
});
