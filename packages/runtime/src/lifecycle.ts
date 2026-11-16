import { Pool } from 'pg';
import { resolve } from 'node:path';
import { lifecycleConfig } from '@meetwell/config/lifecycle';
import { retentionCutoffs } from '@meetwell/core/retention';
import { LifecycleStore, lifecycleTransaction } from '@meetwell/db/lifecycle';
import { refreshMetrics } from '@meetwell/db/metrics';
import { workerStore } from './accounts';
import { LifecycleArtifacts, expireBackups } from './lifecycle-artifacts';
import { mediaVersions, deletePhoto } from './media-storage';
export function lifecycleArtifacts() {
  const key = process.env.LIFECYCLE_ENCRYPTION_KEY;
  if (!key) throw Error('LIFECYCLE_ENCRYPTION_KEY is required');
  return new LifecycleArtifacts(
    process.env.DELETION_JOURNAL_DIR ?? '.local/privacy/journal',
    process.env.LEARNING_EXPORT_DIR ?? '.local/privacy/exports',
    key,
  );
}
let maintenance: Pool | undefined;
export function maintenancePool() {
  if (!maintenance) {
    if (!process.env.WORKER_DATABASE_URL) throw Error('WORKER_DATABASE_URL is required');
    maintenance = new Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 2 });
  }
  return maintenance;
}
export function lifecycleStore() {
  return new LifecycleStore(maintenancePool(), workerStore(), lifecycleArtifacts(), deletePhoto);
}
export async function refreshOutcomeMetrics() {
  return refreshMetrics(maintenancePool(), workerStore());
}
export async function retainArtifacts() {
  await lifecycleTransaction(maintenancePool(), async (db) => {
    const current = new Map(
      (
        await db.query<{ id: string; status: string }>('SELECT * FROM ops.media_inventory()')
      ).rows.map((r) => [r.id, r.status]),
    );
    const cutoff = Date.now() - lifecycleConfig.ORPHAN_GRACE_HOURS * 3600000;
    const orphanIds = new Set(
      (await mediaVersions())
        .filter(
          (v) =>
            current.get(v.key) === 'REMOVED' ||
            (!current.has(v.key) && v.modified.getTime() < cutoff),
        )
        .map((v) => v.key),
    );
    for (const id of orphanIds) await deletePhoto(id);
    await expireBackups(
      resolve(process.env.BACKUP_DIRECTORY ?? '.local/privacy/backups'),
      retentionCutoffs(new Date()).backups,
    );
  });
}
