import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { LifecycleArtifacts, expireBackups } from '../../packages/runtime/src/lifecycle-artifacts';
import { lifecycleConfig } from '../../packages/config/src/lifecycle';

it('I-18 independent journal is authenticated, idempotent, and fails closed on missing or conflicting entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meetwell-artifacts-'));
  try {
    const artifacts = new LifecycleArtifacts(
      join(root, 'journal'),
      join(root, 'exports'),
      randomBytes(32).toString('base64'),
    );
    await expect(artifacts.readJournal()).rejects.toThrow();
    await artifacts.initialize();
    const t = {
      memberId: randomUUID(),
      requestedAt: new Date().toISOString(),
      mediaIds: [randomUUID()],
      receiptHash: null,
    };
    await artifacts.remember(t);
    await artifacts.remember(t);
    expect((await artifacts.readJournal()).entries).toEqual([t]);
    await expect(artifacts.remember({ ...t, mediaIds: [] })).rejects.toThrow('Tombstone conflict');
    const file = join(root, 'journal', `${t.memberId}.tombstone`);
    expect(await readFile(file, 'utf8')).not.toContain(t.memberId);
    await writeFile(file, 'corrupt synthetic journal');
    await expect(artifacts.readJournal()).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('I-18 backup expiry uses envelope creation time even when a copied archive has a fresh filesystem timestamp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meetwell-expiry-'));
  try {
    const before = new Date(Date.now() - 30 * 86400000);
    for (const [name, age] of [
      ['expired', 31],
      ['current', 1],
    ] as const) {
      const created = Buffer.alloc(8);
      created.writeBigInt64BE(BigInt(Date.now() - age * 86400000));
      const file = join(root, `${name}.mwbackup`);
      await writeFile(
        file,
        Buffer.concat([
          Buffer.from(lifecycleConfig.BACKUP_ENVELOPE_PREFIX),
          created,
          randomBytes(32),
        ]),
      );
      await utimes(file, new Date(), new Date());
    }
    await expireBackups(root, before);
    expect(await readdir(root)).toEqual(['current.mwbackup']);
    await writeFile(join(root, 'unsupported.mwbackup'), 'unsupported');
    await expect(expireBackups(root, before)).rejects.toThrow('Unsupported backup envelope');
    expect(await readdir(root)).toContain('unsupported.mwbackup');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
