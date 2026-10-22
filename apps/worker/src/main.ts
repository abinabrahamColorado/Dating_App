import 'dotenv/config';
import { startWorker, writeOperationalEvent } from './worker';
import { deliverAuthMail, sendIntroductionMail } from '@meetwell/runtime/mail';
import { workerStore } from '@meetwell/runtime/accounts';
import { ExploreStore } from '@meetwell/db/explore';
import { registerExploreJobs } from './explore';
import { accountConfig } from '@meetwell/config/accounts';
const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error('WORKER_DATABASE_URL is required');
const boss = await startWorker(url);
await boss.createQueue('auth.deliver');
await boss.work('auth.deliver', async () => deliverAuthMail(workerStore()));
await boss.schedule('auth.deliver', accountConfig.AUTH_OUTBOX_CRON, {});
await registerExploreJobs(boss, new ExploreStore(workerStore()), sendIntroductionMail);
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
