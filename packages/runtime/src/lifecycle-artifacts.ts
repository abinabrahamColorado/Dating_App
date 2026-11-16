import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Envelope } from '@meetwell/db/encryption';
import { lifecycleConfig } from '@meetwell/config/lifecycle';

export type Tombstone = {
  memberId: string;
  requestedAt: string;
  mediaIds: string[];
  receiptHash: string | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Independent of pg_dump. Never place this journal inside a database backup,
 * export directory or disposable restore destination. Off-host custody is an
 * operational launch gate; this local encrypted adapter is exercised in tests. */
export class LifecycleArtifacts {
  private readonly cipher: Envelope;
  readonly journal: string;
  readonly exports: string;
  constructor(journal: string, exports: string, key: string) {
    this.journal = resolve(journal);
    this.exports = resolve(exports);
    if (
      this.journal === this.exports ||
      this.journal.startsWith(`${this.exports}\\`) ||
      this.exports.startsWith(`${this.journal}\\`) ||
      this.journal.startsWith(`${this.exports}/`) ||
      this.exports.startsWith(`${this.journal}/`)
    )
      throw Error('Separate journal and export directories required');
    this.cipher = new Envelope(key);
  }
  async initialize() {
    await mkdir(this.journal, { recursive: true, mode: 0o700 });
    await mkdir(this.exports, { recursive: true, mode: 0o700 });
    const path = join(this.journal, 'journal.v1');
    try {
      await this.atomic(path, this.cipher.seal({ version: 1 }, 'deletion-journal'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    await this.readJournal();
  }
  private async atomic(path: string, body: string) {
    // wx reserves the final name before writing. A crash leaves an invalid
    // authenticated record and fails closed, never a silently missing tombstone.
    const f = await open(path, 'wx', 0o600);
    try {
      await f.writeFile(body);
      await f.sync();
    } finally {
      await f.close();
    }
  }
  private async text(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > lifecycleConfig.ARTIFACT_MAX_BYTES)
      throw Error('Invalid lifecycle artifact');
    return readFile(path, 'utf8');
  }
  async readJournal() {
    const header = this.cipher.open<{ version: number }>(
      await this.text(join(this.journal, 'journal.v1')),
      'deletion-journal',
    );
    if (header.version !== 1) throw Error('Unsupported deletion journal');
    const entries: Tombstone[] = [];
    for (const name of (await readdir(this.journal)).sort()) {
      if (name === 'journal.v1') continue;
      if (!name.endsWith('.tombstone') || !uuid.test(name.slice(0, -10)))
        throw Error('Unexpected deletion journal file');
      const id = name.slice(0, -10);
      const t = this.cipher.open<Tombstone>(
        await this.text(join(this.journal, name)),
        `tombstone:${id}`,
      );
      if (
        t.memberId !== id ||
        !Number.isFinite(Date.parse(t.requestedAt)) ||
        !Array.isArray(t.mediaIds) ||
        t.mediaIds.some((x) => !uuid.test(x))
      )
        throw Error('Invalid tombstone');
      entries.push(t);
    }
    return { entries, digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
  }
  async remember(t: Tombstone) {
    if (!uuid.test(t.memberId) || t.mediaIds.some((x) => !uuid.test(x)))
      throw Error('Invalid tombstone');
    await this.readJournal(); // Missing/unreadable independent journal blocks erasure.
    const path = join(this.journal, `${t.memberId}.tombstone`);
    try {
      await this.atomic(path, this.cipher.seal(t, `tombstone:${t.memberId}`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const old = this.cipher.open<Tombstone>(await this.text(path), `tombstone:${t.memberId}`);
      if (JSON.stringify(old) !== JSON.stringify(t))
        throw Error('Tombstone conflict', { cause: e });
    }
  }
  async writeSnapshot(id: string, at: Date, data: unknown) {
    if (!uuid.test(id)) throw Error('Invalid snapshot');
    const name = `${at.toISOString().replaceAll(':', '-')}_${id}.snapshot`;
    const body = this.cipher.seal({ createdAt: at.toISOString(), data }, `snapshot:${id}`);
    if (Buffer.byteLength(body) > lifecycleConfig.ARTIFACT_MAX_BYTES)
      throw Error('Snapshot exceeds pilot limit');
    await this.atomic(join(this.exports, name), body);
    return name;
  }
  async purgeSnapshots() {
    for (const name of await readdir(this.exports)) {
      if (!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z_[a-f0-9-]{36}\.snapshot$/.test(name))
        throw Error('Unexpected export file');
      const path = join(this.exports, name);
      if (!(await lstat(path)).isFile()) throw Error('Invalid export artifact');
      await unlink(path);
    }
  }
}

/** Configured backup directory only; no recursive delete, no symlink traversal.
 * Restoring expired archives is refused independently by the restore command. */
export async function expireBackups(directory: string, before: Date) {
  for (const name of await readdir(resolve(directory))) {
    if (!name.endsWith('.mwbackup')) continue;
    const path = join(resolve(directory), name),
      info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid backup artifact');
    if (info.mtime < before) await unlink(path);
  }
}
