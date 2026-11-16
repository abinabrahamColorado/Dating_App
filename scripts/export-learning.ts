import 'dotenv/config';
import { lifecycleStore, maintenancePool } from '../packages/runtime/src/lifecycle';
import { workerStore } from '../packages/runtime/src/accounts';
try {
  const result = await lifecycleStore().exportLearning();
  process.stdout.write(`Encrypted learning snapshot: ${result.file}\n`);
} catch {
  process.stderr.write('Learning export failed. No plaintext was emitted.\n');
  process.exitCode = 1;
} finally {
  await Promise.all(
    [maintenancePool(), workerStore().identity, workerStore().app].map((p) => p.end()),
  );
}
