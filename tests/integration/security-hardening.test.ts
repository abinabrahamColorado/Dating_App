import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { smtpOptions } from '../../packages/config/src/security';
import { probeUptime } from '../../packages/runtime/src/monitoring';
import { monitoredJob } from '../../packages/runtime/src/monitoring';
import { migrate } from '../../packages/db/src/migrate';
import { Pool } from 'pg';
import { startWorker } from '../../apps/worker/src/worker';
const require = createRequire(resolve('packages/runtime/package.json'));
const nodemailer = require('nodemailer') as typeof import('nodemailer');
it('I-12 queue error monitoring persists only a generic failure, never private exception content', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw Error('Isolated test database required');
  await migrate(url);
  const pool = new Pool({ connectionString: url });
  const worker = new URL(url);
  worker.searchParams.set('options', '-c role=meetwell_worker');
  const boss = await startWorker(worker.toString());
  try {
    await boss.createQueue('security.monitor-fixture');
    await boss.work('security.monitor-fixture', () =>
      monitoredJob(async () => {
        throw Error('synthetic-private-email-message-token-sentinel');
      }),
    );
    const id = await boss.send('security.monitor-fixture', {}, { retryLimit: 0 });
    await expect
      .poll(
        async () =>
          (await pool.query('SELECT state FROM queue.job WHERE id=$1', [id])).rows[0]?.state,
        { timeout: 15000 },
      )
      .toBe('failed');
    const output = JSON.stringify(
      (await pool.query('SELECT output FROM queue.job WHERE id=$1', [id])).rows[0]?.output,
    );
    expect(output).toContain('JOB_FAILED');
    expect(output).not.toContain('sentinel');
  } finally {
    await boss.stop({ graceful: true });
    await pool.end();
  }
});
it('I-12 P22 mandatory STARTTLS refuses a downgrade before AUTH or DATA', async () => {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('220 synthetic.invalid SMTP\r\n');
    socket.on('data', (data) => {
      const command = data.toString().trim();
      commands.push(command);
      socket.write(
        command.startsWith('EHLO') ? '250 synthetic.invalid\r\n' : '502 TLS unavailable\r\n',
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No fixture port');
  const transport = nodemailer.createTransport({
    ...smtpOptions({
      APP_MODE: 'production',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(address.port),
      SMTP_TLS: 'starttls',
    }),
    connectionTimeout: 3000,
  });
  try {
    await expect(
      transport.sendMail({
        from: 'a@synthetic.invalid',
        to: 'b@synthetic.invalid',
        text: 'synthetic',
      }),
    ).rejects.toBeTruthy();
    expect(commands.some((c) => c.startsWith('STARTTLS'))).toBe(true);
    expect(commands.some((c) => /^(AUTH|MAIL|DATA)/.test(c))).toBe(false);
  } finally {
    transport.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
it('I-12 I-17 uptime probe detects up, down and redirect without reading or retaining personal response data', async () => {
  let code = 200;
  const server = httpServer((_req, res) => {
    res.writeHead(code, { Location: 'https://outside.invalid' });
    res.end('private sentinel response');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    expect(await probeUptime(origin)).toBe(true);
    code = 503;
    expect(await probeUptime(origin)).toBe(false);
    code = 302;
    expect(await probeUptime(origin)).toBe(false);
    await expect(probeUptime(origin + '/?email=private')).rejects.toThrow('Invalid monitor origin');
    await expect(probeUptime('private-origin-sentinel')).rejects.toMatchObject({
      message: 'Invalid monitor origin',
    });
    const error = await probeUptime('private-origin-sentinel').catch((value: unknown) => value);
    expect(JSON.stringify(error)).not.toContain('sentinel');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
  expect(await probeUptime(origin)).toBe(false);
});
