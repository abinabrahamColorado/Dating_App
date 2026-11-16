import 'dotenv/config';
import { backupDatabase } from './database-backup';
const url = process.env.BACKUP_DATABASE_URL,
  key = process.env.BACKUP_ENCRYPTION_KEY,
  path = process.argv[2];
if (!url || !key || !path)
  throw new Error('Set BACKUP_DATABASE_URL and BACKUP_ENCRYPTION_KEY; supply a new archive path');
try {
  await backupDatabase(url, path, key);
  console.log('Encrypted database backup created.');
} catch {
  console.error(
    'Database backup failed. Check configuration, privileges, output path and the 256 MiB limit.',
  );
  process.exitCode = 1;
}
