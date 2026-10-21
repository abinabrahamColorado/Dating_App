import 'dotenv/config';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/web/package.json'));
const command = process.argv[2] ?? 'dev';
if (!['dev', 'start'].includes(command)) throw new Error('Expected dev or start');
const child = spawn(
  process.execPath,
  [require.resolve('next/dist/bin/next'), command, ...process.argv.slice(3)],
  {
    cwd: resolve('apps/web'),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
