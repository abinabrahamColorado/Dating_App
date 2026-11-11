import 'dotenv/config';
import { operationalEvent, probeUptime } from '../packages/runtime/src/monitoring';
const origin = process.env.APP_ORIGIN;
if (!origin) throw new Error('APP_ORIGIN is required');
let previous: boolean | undefined;
async function check() {
  const up = await probeUptime(origin!);
  if (up !== previous) operationalEvent(up ? 'uptime.up' : 'uptime.down');
  previous = up;
  return up;
}
if (process.argv.includes('--once')) process.exitCode = (await check()) ? 0 : 1;
else {
  await check();
  const timer = setInterval(() => {
    void check();
  }, 60000);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => clearInterval(timer));
}
