import 'dotenv/config';
import { Pool } from 'pg';
import { AccountStore } from '../packages/db/src/accounts';
import { lifecycleArtifacts } from '../packages/runtime/src/lifecycle';
import { deletePhoto } from '../packages/runtime/src/media-storage';
import { replayDeletions } from './replay-deletions';
const url = process.env.RESTORE_DATABASE_URL,
  digest = process.argv[2];
if (!url || !digest)
  throw Error(
    'Set RESTORE_DATABASE_URL to the quarantined database; supply the independently verified current journal digest',
  );
const pool = new Pool({ connectionString: url });
try {
  const accounts = new AccountStore({
    app: pool,
    identity: pool,
    ops: pool,
    appKey: process.env.APP_ENCRYPTION_KEY ?? '',
    identityKey: process.env.IDENTITY_ENCRYPTION_KEY ?? '',
    lookupKey: process.env.LOOKUP_KEY ?? '',
  });
  await replayDeletions(url, accounts, lifecycleArtifacts(), digest, deletePhoto);
  process.stdout.write(
    'Deletion replay verified. Database readiness attested; deployment and traffic changes still require founder approval.\n',
  );
} catch {
  process.stderr.write(
    'Restore replay failed. Keep the target quarantined; no traffic change is authorized.\n',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
