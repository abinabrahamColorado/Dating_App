import 'dotenv/config';
import { startWorker, writeOperationalEvent } from './worker';
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
