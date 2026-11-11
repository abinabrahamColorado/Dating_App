import { it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from '../../packages/db/src/migrate';
import { Envelope } from '../../packages/db/src/encryption';
import { backupDatabase, restoreDatabase } from '../../scripts/database-backup';
it('I-12 I-18 P22 encrypted backup restores data, migration ledger and role boundaries into a fresh quarantined database without changing the source', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw Error('Isolated test database required');
  const sourceName = `meetwell_backup_${randomUUID().replaceAll('-', '')}_test`;
  const sourceUrl = new URL(url);
  sourceUrl.pathname = `/${sourceName}`;
  const cluster = new Pool({ connectionString: url });
  const directory = await mkdtemp(join(tmpdir(), 'meetwell-backup-test-'));
  const archive = join(directory, 'synthetic.mwbackup');
  const backupKey = randomBytes(32).toString('base64'),
    envelope = new Envelope(randomBytes(32).toString('base64'));
  let source: Pool | undefined, restored: Pool | undefined, restoredName: string | undefined;
  try {
    await cluster.query(`CREATE DATABASE "${sourceName}"`);
    await migrate(sourceUrl.toString());
    source = new Pool({ connectionString: sourceUrl.toString() });
    await source.query('CREATE TABLE safety.backup_probe (cipher text NOT NULL)');
    await source.query('GRANT SELECT ON safety.backup_probe TO meetwell_safety');
    const ciphertext = envelope.seal({ detail: 'synthetic restoration canary' }, 'backup-probe');
    await source.query('INSERT INTO safety.backup_probe(cipher) VALUES($1)', [ciphertext]);
    const ledger = (
      await source.query('SELECT name,checksum FROM ops.schema_migrations ORDER BY name')
    ).rows;
    await backupDatabase(sourceUrl.toString(), archive, backupKey);
    const encrypted = await readFile(archive);
    expect(encrypted.includes(Buffer.from('synthetic restoration canary'))).toBe(false);
    expect(encrypted.includes(Buffer.from(ciphertext))).toBe(false);
    await expect(backupDatabase(sourceUrl.toString(), archive, backupKey)).rejects.toThrow();
    expect(await readFile(archive)).toEqual(encrypted);
    const before = (
      await cluster.query(
        "SELECT datname FROM pg_database WHERE datname LIKE 'meetwell_restore_%' ORDER BY datname",
      )
    ).rows;
    const corrupt = Buffer.from(encrypted);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await writeFile(join(directory, 'tampered.mwbackup'), corrupt);
    await expect(
      restoreDatabase(url, join(directory, 'tampered.mwbackup'), backupKey),
    ).rejects.toThrow('authentication failed');
    await expect(restoreDatabase(url, archive, randomBytes(32).toString('base64'))).rejects.toThrow(
      'authentication failed',
    );
    expect(
      (
        await cluster.query(
          "SELECT datname FROM pg_database WHERE datname LIKE 'meetwell_restore_%' ORDER BY datname",
        )
      ).rows,
    ).toEqual(before);
    restoredName = await restoreDatabase(url, archive, backupKey);
    expect(restoredName).not.toBe(sourceName);
    const target = new URL(url);
    target.pathname = `/${restoredName}`;
    restored = new Pool({ connectionString: target.toString() });
    const rows = await restored.query('SELECT cipher FROM safety.backup_probe');
    expect(rows.rows).toEqual([{ cipher: ciphertext }]);
    expect(envelope.open(rows.rows[0].cipher, 'backup-probe')).toEqual({
      detail: 'synthetic restoration canary',
    });
    await migrate(target.toString());
    expect(
      (await restored.query('SELECT name,checksum FROM ops.schema_migrations ORDER BY name')).rows,
    ).toEqual(ledger);
    const client = await restored.connect();
    try {
      for (const role of ['meetwell_app', 'meetwell_learning']) {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        await expect(client.query('SELECT cipher FROM safety.backup_probe')).rejects.toMatchObject({
          code: '42501',
        });
        await client.query('ROLLBACK');
      }
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE meetwell_safety');
      expect((await client.query('SELECT cipher FROM safety.backup_probe')).rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (await restored.query("SELECT has_schema_privilege('meetwell_app','app','CREATE') AS unsafe"))
        .rows[0].unsafe,
    ).toBe(false);
    expect((await source.query('SELECT cipher FROM safety.backup_probe')).rows).toEqual([
      { cipher: ciphertext },
    ]);
    expect(
      (await source.query('SELECT name,checksum FROM ops.schema_migrations ORDER BY name')).rows,
    ).toEqual(ledger);
  } finally {
    await source?.end();
    await restored?.end();
    for (const name of [restoredName, sourceName])
      if (name) {
        expect(name).toMatch(/^meetwell_(restore_[a-f0-9]{32}|backup_[a-f0-9]{32}_test)$/);
        await cluster.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
    await cluster.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
