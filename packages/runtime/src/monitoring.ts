import { randomUUID } from 'node:crypto';
const events = new Set([
  'web.started',
  'web.request.failed',
  'worker.started',
  'worker.stopped',
  'worker.error',
  'worker.heartbeat',
  'worker.job.failed',
  'uptime.up',
  'uptime.down',
]);
export type OperationalEvent =
  | 'web.started'
  | 'web.request.failed'
  | 'worker.started'
  | 'worker.stopped'
  | 'worker.error'
  | 'worker.heartbeat'
  | 'worker.job.failed'
  | 'uptime.up'
  | 'uptime.down';
/** I-12/I-17: no arbitrary fields, error objects, URLs, bodies or member identifiers. */
export function operationalEvent(
  event: OperationalEvent,
  write: (line: string) => void = (line: string) => {
    process.stdout.write(line);
  },
) {
  if (!events.has(event)) throw new Error('Unknown operational event');
  write(
    `${JSON.stringify({ event, requestId: randomUUID(), timestamp: new Date().toISOString() })}\n`,
  );
}
export async function monitoredJob<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    operationalEvent('worker.job.failed');
    // pg-boss persists thrown errors. Replace arbitrary DB/provider details before that sink.
    throw new Error('JOB_FAILED');
  }
}
export async function probeUptime(origin: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(origin);
  } catch {
    // URL's native TypeError retains its input, which may contain private values.
    throw new Error('Invalid monitor origin');
  }
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/' ||
    !['http:', 'https:'].includes(target.protocol)
  )
    throw new Error('Invalid monitor origin');
  if (target.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
    throw new Error('Monitor requires HTTPS outside loopback');
  try {
    const response = await fetch(new URL('/api/v1/health', target), {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}
