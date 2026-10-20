import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { startWorker, writeOperationalEvent } from './worker';
// pnpm runs this package in apps/worker; local configuration lives at the workspace root.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error('WORKER_DATABASE_URL is required');
const boss = await startWorker(url);
writeOperationalEvent('worker.started');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await boss.stop({ graceful: true });
  writeOperationalEvent('worker.stopped');
}
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
