import type { PgBoss } from 'pg-boss';
import { ExploreStore } from '@meetwell/db/explore';
import { requireSupportedClient } from '@meetwell/db/client-policy';
import { exploreConfig } from '@meetwell/config/explore';
import { launch } from '@meetwell/config/pilot';

/** Every job is classified in the I-04 architecture test. Payloads carry no people,
 * profile data or cached authority. Each store transition rechecks the locked pair. */
export async function registerExploreJobs(
  boss: PgBoss,
  db: ExploreStore,
  send: (email: string) => Promise<'SENT' | 'RETRY' | 'UNCERTAIN' | 'FAILED'>,
) {
  for (const name of ['explore.batch', 'explore.deliver', 'explore.maintain', 'explore.mail'])
    await boss.createQueue(name);
  await boss.work('explore.batch', async () => {
    await requireSupportedClient(db.accounts, 'worker/explore', 'POST', null);
    return db.generateScheduled();
  });
  await boss.work('explore.deliver', async () => {
    await requireSupportedClient(db.accounts, 'worker/explore', 'POST', null);
    return db.deliverPending();
  });
  await boss.work('explore.maintain', async () => db.maintain());
  await boss.work('explore.mail', async () => {
    await requireSupportedClient(db.accounts, 'worker/explore', 'POST', null);
    return db.sendNotifications(send);
  });
  await boss.schedule('explore.batch', exploreConfig.WEEKLY_CRON, {}, { tz: launch.timezone });
  for (const name of ['explore.deliver', 'explore.maintain', 'explore.mail'])
    await boss.schedule(name, exploreConfig.DELIVERY_CRON, {});
}
