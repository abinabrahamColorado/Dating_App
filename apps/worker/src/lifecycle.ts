import type { PgBoss } from 'pg-boss';
import { FeedbackStore } from '@meetwell/db/feedback';
import { workerStore } from '@meetwell/runtime/accounts';
import {
  lifecycleStore,
  refreshOutcomeMetrics,
  retainArtifacts,
} from '@meetwell/runtime/lifecycle';
import { monitoredJob } from '@meetwell/runtime/monitoring';
import { lifecycleConfig } from '@meetwell/config/lifecycle';
export async function registerLifecycleJobs(boss: PgBoss) {
  for (const name of ['feedback.maintain', 'privacy.erase', 'privacy.retain', 'metrics.refresh'])
    await boss.createQueue(name);
  await boss.work('feedback.maintain', async () =>
    monitoredJob(() => new FeedbackStore(workerStore()).maintain()),
  );
  await boss.work('privacy.erase', async () =>
    monitoredJob(async () => {
      const store = lifecycleStore();
      for (let i = 0; i < lifecycleConfig.WORK_BATCH_SIZE; i++)
        if (!(await store.eraseOne())) break;
    }),
  );
  await boss.work('privacy.retain', async () =>
    monitoredJob(async () => {
      await lifecycleStore().retain();
      await retainArtifacts();
    }),
  );
  await boss.work('metrics.refresh', async () => monitoredJob(refreshOutcomeMetrics));
  await boss.schedule('feedback.maintain', lifecycleConfig.FEEDBACK_CRON, {});
  await boss.schedule('privacy.erase', lifecycleConfig.FEEDBACK_CRON, {});
  await boss.schedule('privacy.retain', lifecycleConfig.RETENTION_CRON, {});
  await boss.schedule('metrics.refresh', lifecycleConfig.FEEDBACK_CRON, {});
}
