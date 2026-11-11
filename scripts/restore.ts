import 'dotenv/config';
import { restoreDatabase } from './database-backup';
const url = process.env.RESTORE_CLUSTER_URL,
  key = process.env.BACKUP_ENCRYPTION_KEY,
  path = process.argv[2];
if (!url || !key || !path)
  throw new Error(
    'Set RESTORE_CLUSTER_URL and BACKUP_ENCRYPTION_KEY; supply an encrypted archive path',
  );
try {
  const database = await restoreDatabase(url, path, key);
  console.log(
    `Restored isolated database: ${database}. QUARANTINED: do not serve before M5 tombstone replay and release approval.`,
  );
} catch {
  console.error(
    'Database restore failed. Source is unchanged; inspect and quarantine any newly created meetwell_restore_ database.',
  );
  process.exitCode = 1;
}
