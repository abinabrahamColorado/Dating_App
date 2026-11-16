import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { lifecycleArtifacts } from '../packages/runtime/src/lifecycle';
const artifacts = lifecycleArtifacts();
if (process.argv.includes('--initialize')) {
  await artifacts.initialize();
  await mkdir(process.env.BACKUP_DIRECTORY ?? '.local/privacy/backups', {
    recursive: true,
    mode: 0o700,
  });
}
const journal = await artifacts.readJournal();
process.stdout.write(
  `Verified journal: ${journal.entries.length} tombstones; digest ${journal.digest}\n`,
);
