import { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
export const HEALTH_QUEUE = 'system.healthcheck';
export function workerOptions(connectionString: string) {
  if (!/^postgres(ql)?:/.test(connectionString)) throw new Error('PostgreSQL is required');
  // The migration administrator creates the schema. The runtime worker has
  // CREATE only inside queue, never CREATE on the database (Spec P22).
  return {
    connectionString,
    schema: 'queue',
    createSchema: false,
    application_name: 'meetwell-worker',
  };
}
export function writeOperationalEvent(event: 'worker.started' | 'worker.stopped' | 'worker.error') {
  // Spec P22 / I-12 / I-17: fixed event names, opaque request IDs, no arbitrary payloads.
  process.stdout.write(`${JSON.stringify({ event, requestId: randomUUID() })}\n`);
}
export async function startWorker(connectionString: string) {
  const boss = new PgBoss(workerOptions(connectionString));
  boss.on('error', () => writeOperationalEvent('worker.error'));
  await boss.start();
  await boss.createQueue(HEALTH_QUEUE);
  await boss.work(HEALTH_QUEUE, async () => ({ status: 'ok' }));
  return boss;
}
