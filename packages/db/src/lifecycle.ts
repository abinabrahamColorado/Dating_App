import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { deletionDeadline, retentionCutoffs } from '@meetwell/core/retention';
import { retention } from '@meetwell/config/pilot';
import { AccountStore, StoreError, type Authority } from './accounts';
import { hashToken } from './encryption';

export interface DeletionArtifacts {
  remember(t: {
    memberId: string;
    requestedAt: string;
    mediaIds: string[];
    receiptHash: string | null;
  }): Promise<void>;
  purgeSnapshots(): Promise<void>;
  writeSnapshot(id: string, at: Date, data: unknown): Promise<string>;
}
export class PrivacyStore {
  constructor(readonly accounts: AccountStore) {}
  async request(auth: Authority, key: string, version: number) {
    const token = this.accounts.lookup(`deletion-receipt:${auth.memberId}:${key}`);
    const next = await this.accounts.withSession(auth, () =>
      this.accounts.changePolicy(auth, key, { action: 'DELETE', version }, async (db) => {
        await db.query('SELECT app.request_erasure($1,$2,$3)', [
          auth.memberId,
          hashToken(token),
          retention.D9_SAFETY_AFTER_CLOSURE_MONTHS,
        ]);
      }),
    );
    return { policy: next, token };
  }
  async receipt(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new StoreError('NOT_FOUND');
    const row = (
      await this.accounts.app.query<{
        requested_at: Date;
        completed_at: Date | null;
      }>('SELECT * FROM app.erasure_receipt($1)', [hashToken(token)])
    ).rows[0];
    if (!row) throw new StoreError('NOT_FOUND');
    return {
      requestedAt: row.requested_at,
      deadline: deletionDeadline(row.requested_at),
      completedAt: row.completed_at,
      status: row.completed_at ? 'COMPLETED' : 'PENDING',
    };
  }
}

/** Independent maintenance pool. The shared runtime barrier in transaction()
 * excludes every authenticated transaction while this exclusive lease is held.
 * Never use transaction() here: it intentionally acquires a shared lease. */
export async function lifecycleTransaction<T>(
  pool: Pool,
  run: (db: PoolClient) => Promise<T>,
  quarantined = false,
) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(55,2)');
    if (!quarantined) await db.query('SELECT app.assert_serving_ready()');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
const summarySchema = z.object({
  members: z.array(z.uuid()),
  unserved: z.array(z.object({ memberId: z.uuid(), reason: z.string() })),
});
export class LifecycleStore {
  constructor(
    readonly pool: Pool,
    readonly accounts: AccountStore,
    readonly artifacts: DeletionArtifacts,
    readonly purgePhoto: (id: string) => Promise<void>,
  ) {}
  async eraseOne(quarantined = false) {
    return lifecycleTransaction(
      this.pool,
      async (db) => {
        const job = (
          await db.query<{
            member_id: string;
            requested_at: Date;
            media_ids: string[];
            receipt_hash: string | null;
          }>(
            'SELECT member_id,requested_at,media_ids,receipt_hash FROM ops.deletion_jobs WHERE completed_at IS NULL ORDER BY requested_at,member_id LIMIT 1',
          )
        ).rows[0];
        if (!job) return false;
        await this.artifacts.remember({
          memberId: job.member_id,
          requestedAt: job.requested_at.toISOString(),
          mediaIds: job.media_ids,
          receiptHash: job.receipt_hash,
        });
        await db.query('SELECT ops.mark_journaled($1)', [job.member_id]);
        // External effects first. Failures leave the job pending; all effects are
        // repeatable. The independent tombstone survives a database rollback.
        for (const id of job.media_ids) await this.purgePhoto(id);
        await this.artifacts.purgeSnapshots();
        await db.query('DELETE FROM ops.learning_exports');
        for (const b of (
          await db.query<{ id: string; summary_cipher: string }>(
            'SELECT * FROM ops.erasure_batches()',
          )
        ).rows) {
          const value = summarySchema.parse(
            this.accounts.appCipher.open(b.summary_cipher, `batch:${b.id}`),
          );
          if (
            value.members.includes(job.member_id) ||
            value.unserved.some((u) => u.memberId === job.member_id)
          ) {
            const scrubbed = {
              members: value.members.filter((x) => x !== job.member_id),
              unserved: value.unserved.filter((x) => x.memberId !== job.member_id),
            };
            await db.query('SELECT ops.scrub_erasure_batch($1,$2)', [
              b.id,
              this.accounts.appCipher.seal(scrubbed, `batch:${b.id}`),
            ]);
          }
        }
        await db.query('SELECT ops.erase_primary($1,$2)', [
          job.member_id,
          retention.D9_SAFETY_AFTER_CLOSURE_MONTHS,
        ]);
        return true;
      },
      quarantined,
    );
  }
  async retain() {
    return lifecycleTransaction(this.pool, async (db) => {
      const now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
      // Old snapshots must not preserve rows beyond a source-table TTL. A new
      // approved export can always be generated from current, retained rows.
      await this.artifacts.purgeSnapshots();
      await db.query('DELETE FROM ops.learning_exports');
      await db.query('SELECT ops.retain_until($1)', [JSON.stringify(retentionCutoffs(now))]);
      await db.query('SELECT ops.expire_rejoin_denials()');
    });
  }
  async exportLearning() {
    return lifecycleTransaction(this.pool, async (db) => {
      // Pending deletion requests are removed first; no newly requested account
      // is copied into an artifact even before its scheduled erasure completes.
      if (
        (await db.query('SELECT 1 FROM ops.deletion_jobs WHERE completed_at IS NULL LIMIT 1'))
          .rowCount
      )
        throw Error('Process pending erasures before exporting');
      const id = randomUUID(),
        now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
      const data = (await db.query('SELECT ops.learning_snapshot() AS data')).rows[0]!.data;
      const file = await this.artifacts.writeSnapshot(id, now, data);
      await db.query('INSERT INTO ops.learning_exports(id,created_at) VALUES($1,$2)', [id, now]);
      await db.query("INSERT INTO ops.lifecycle_audit(event) VALUES('EXPORT')");
      return { id, file, createdAt: now };
    });
  }
}
