import type { AccountStore } from '../packages/db/src/accounts';
import { LifecycleStore, lifecycleTransaction } from '../packages/db/src/lifecycle';
import type { LifecycleArtifacts } from '../packages/runtime/src/lifecycle-artifacts';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
/** Only a fresh restore can be released. Caller must freeze the source and
 * independently verify its current journal digest. A database backup can never
 * supply its own "latest" deletion journal or permission to serve. */
export async function replayDeletions(
  url: string,
  accounts: AccountStore,
  artifacts: LifecycleArtifacts,
  expectedDigest: string,
  purgePhoto: (id: string) => Promise<void>,
  currentSafetySource: Pool,
) {
  const name = new URL(url).pathname.slice(1);
  if (!/^meetwell_restore_[a-f0-9]{32}$/.test(name))
    throw Error('Fresh quarantined restore required');
  const journal = await artifacts.readJournal();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || journal.digest !== expectedDigest)
    throw Error('Latest independent journal digest required');
  const pool = new Pool({ connectionString: url });
  try {
    // Operator-only recovery reads. No safety hash enters the ordinary deletion
    // journal, learning export, application role, logs or an unencrypted file.
    const sourceName = (await currentSafetySource.query('SELECT current_database() AS name'))
      .rows[0].name as string;
    if (sourceName.startsWith('meetwell_restore_'))
      throw Error('Independent current safety source required');
    const readDenials = async () =>
      (
        await currentSafetySource.query<{ email_lookup: string; expires_at: Date }>(
          'SELECT email_lookup,expires_at FROM safety.rejoin_denials ORDER BY email_lookup',
        )
      ).rows;
    const safetyRows = await readDenials();
    const safetyDigest = (rows: typeof safetyRows) =>
      createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    await lifecycleTransaction(
      pool,
      async (db) => {
        if ((await db.query('SELECT 1 FROM ops.serving_attestation')).rowCount)
          throw Error('Restore already attested; do not replay over a serving database');
        for (const t of journal.entries) {
          for (const r of (
            await db.query<{ id: string }>('SELECT id FROM app.media WHERE member_id=$1', [
              t.memberId,
            ])
          ).rows)
            await purgePhoto(r.id);
          await db.query(
            `INSERT INTO ops.deletion_jobs(member_id,requested_at,media_ids,receipt_hash) VALUES($1,$2,$3,$4)
          ON CONFLICT(member_id) DO UPDATE SET requested_at=excluded.requested_at,media_ids=excluded.media_ids,receipt_hash=excluded.receipt_hash,completed_at=NULL`,
            [t.memberId, t.requestedAt, t.mediaIds, t.receiptHash],
          );
        }
      },
      true,
    );
    const lifecycle = new LifecycleStore(pool, accounts, artifacts, purgePhoto);
    while (await lifecycle.eraseOne(true)) {
      /* bounded by the finite restored journal; no member serving */
    }
    // Invalidate snapshots even with an empty journal: stale exports are not
    // restored service state, and a fresh snapshot must use current data.
    await lifecycleTransaction(
      pool,
      async (db) => {
        if ((await artifacts.readJournal()).digest !== expectedDigest)
          throw Error('Journal changed during replay; repeat from its latest digest');
        await artifacts.purgeSnapshots();
        await db.query('DELETE FROM ops.learning_exports');
        if ((await db.query('SELECT 1 FROM ops.deletion_jobs WHERE completed_at IS NULL')).rowCount)
          throw Error('Pending erasure blocks activation');
        if (safetyDigest(await readDenials()) !== safetyDigest(safetyRows))
          throw Error('Safety source changed during replay; freeze and retry');
        // The current source is authoritative, including lifted/expired records;
        // old backup enforcement must not manufacture a new retention period.
        await db.query('DELETE FROM safety.rejoin_denials');
        for (const row of safetyRows)
          await db.query(
            'INSERT INTO safety.rejoin_denials(email_lookup,expires_at) SELECT $1,$2::timestamptz WHERE $2::timestamptz>clock_timestamp()',
            [row.email_lookup, row.expires_at],
          );
        await db.query("INSERT INTO ops.lifecycle_audit(event) VALUES('RESTORE_REPLAY')");
        await db.query(
          'INSERT INTO ops.serving_attestation(database_name,database_oid) SELECT current_database(),oid FROM pg_database WHERE datname=current_database()',
        );
      },
      true,
    );
  } finally {
    await pool.end();
  }
}
