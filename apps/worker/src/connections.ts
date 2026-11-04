import type { PgBoss } from 'pg-boss';
import type { ConnectionStore } from '@meetwell/db/connections';
import { requireSupportedClient } from '@meetwell/db/client-policy';
import { connectionConfig } from '@meetwell/config/connections';
export async function registerConnectionJobs(boss: PgBoss, db: ConnectionStore) {
  for (const name of ['connections.deliver', 'connections.maintain']) await boss.createQueue(name);
  await boss.work('connections.deliver', async () => {
    await requireSupportedClient(db.accounts, 'worker/connections', 'POST', null);
    return db.deliverPending();
  });
  await boss.work('connections.maintain', async () => db.maintain());
  await boss.schedule('connections.deliver', connectionConfig.DELIVERY_CRON, {});
  await boss.schedule('connections.maintain', connectionConfig.MAINTENANCE_CRON, {});
}
