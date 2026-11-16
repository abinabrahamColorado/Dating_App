import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  assertRuntimeSecurity,
  smtpOptions,
  exampleSecrets,
} from '../../packages/config/src/security';
import { contentSecurityPolicy, securityHeaders } from '../../apps/web/security-headers';
import { proxy } from '../../apps/web/proxy';
import { operationalEvent, monitoredJob } from '../../packages/runtime/src/monitoring';
function valid() {
  const env: Record<string, string> = {
    APP_MODE: 'production',
    APP_ORIGIN: 'https://meetwell.invalid',
    SMTP_TLS: 'starttls',
    SMTP_HOST: 'smtp.synthetic.invalid',
    SMTP_PORT: '587',
    MEDIA_ACCESS_KEY: 'synthetic-media-access',
    MEDIA_SECRET_KEY: randomBytes(32).toString('base64'),
  };
  for (const key of [
    'IDENTITY_ENCRYPTION_KEY',
    'APP_ENCRYPTION_KEY',
    'MEDIA_ENCRYPTION_KEY',
    'SAFETY_ENCRYPTION_KEY',
    'LOOKUP_KEY',
  ])
    env[key] = randomBytes(32).toString('base64');
  for (const key of [
    'IDENTITY_DATABASE_URL',
    'APP_DATABASE_URL',
    'OPS_DATABASE_URL',
    'SAFETY_DATABASE_URL',
    'WORKER_DATABASE_URL',
  ])
    env[key] = `postgresql://synthetic:${randomBytes(24).toString('hex')}@localhost/synthetic`;
  return env;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('I-19 P22 nonce CSP rejects caller-controlled policy and differs per request; existing headers and nonlocal HSTS remain', () => {
  vi.stubEnv('APP_MODE', 'production');
  const request = new Request('https://meetwell.invalid/', {
    headers: { 'x-nonce': 'attacker', 'Content-Security-Policy': "script-src 'unsafe-inline'" },
  });
  const a = proxy(request as Parameters<typeof proxy>[0]),
    b = proxy(request as Parameters<typeof proxy>[0]);
  const policy = a.headers.get('content-security-policy')!;
  expect(policy).not.toBe(b.headers.get('content-security-policy'));
  expect(policy).not.toContain('attacker');
  expect(policy.split('; ').find((p) => p.startsWith('script-src '))).not.toMatch(
    /unsafe-inline|unsafe-eval/,
  );
  expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  expect(a.headers.get('cache-control')).toContain('no-store');
  for (const h of securityHeaders('production')) expect(a.headers.get(h.key)).toBe(h.value);
  expect(securityHeaders('local').some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
  expect(securityHeaders('test').some((h) => h.key === 'Strict-Transport-Security')).toBe(true);
  expect(() => contentSecurityPolicy("' unsafe-inline")).toThrow();
});
it('I-19 P22 startup accepts independent strong secrets and rejects every template secret, short/reused/malformed keys and encoded passwords', () => {
  expect(() => assertRuntimeSecurity(valid(), 'web')).not.toThrow();
  for (const key of [
    'IDENTITY_ENCRYPTION_KEY',
    'APP_ENCRYPTION_KEY',
    'MEDIA_ENCRYPTION_KEY',
    'SAFETY_ENCRYPTION_KEY',
    'LOOKUP_KEY',
  ]) {
    for (const value of [
      'short',
      Buffer.alloc(32).toString('base64'),
      randomBytes(32).toString('base64') + '!',
    ]) {
      const env = valid();
      env[key] = value;
      expect(() => assertRuntimeSecurity(env, 'web')).toThrow(key);
    }
  }
  const reused = valid();
  reused.APP_ENCRYPTION_KEY = reused.IDENTITY_ENCRYPTION_KEY!;
  expect(() => assertRuntimeSecurity(reused, 'web')).toThrow('APP_ENCRYPTION_KEY');
  for (const query of [
    'password=local-development-only',
    'pass%77ord=local-development-only',
    'user=postgres',
    'host=other.invalid',
    'options=-c%20role%3Dpostgres',
  ]) {
    const env = valid();
    env.APP_DATABASE_URL += '?' + query;
    expect(() => assertRuntimeSecurity(env, 'web')).toThrow('APP_DATABASE_URL');
  }
  const tls = valid();
  tls.APP_DATABASE_URL += '?sslmode=verify-full';
  expect(() => assertRuntimeSecurity(tls, 'web')).not.toThrow();
  const template = readFileSync('.env.example', 'utf8');
  for (const value of exampleSecrets) {
    expect(template).toContain(value);
    const env = valid();
    env.MEDIA_SECRET_KEY = value;
    expect(() => assertRuntimeSecurity(env, 'web')).toThrow('MEDIA_SECRET_KEY');
    env.MEDIA_SECRET_KEY = randomBytes(32).toString('base64');
    env.APP_DATABASE_URL = `postgresql://synthetic:${[...value].map((c) => '%' + c.charCodeAt(0).toString(16)).join('')}@localhost/synthetic`;
    expect(() => assertRuntimeSecurity(env, 'web')).toThrow('APP_DATABASE_URL');
  }
  const worker = valid();
  delete worker.SAFETY_ENCRYPTION_KEY;
  delete worker.MEDIA_ENCRYPTION_KEY;
  delete worker.OPS_DATABASE_URL;
  delete worker.SAFETY_DATABASE_URL;
  expect(() => assertRuntimeSecurity(worker, 'worker')).not.toThrow();
});
it('I-19 P22 only explicit loopback local mode permits plaintext SMTP; all other modes require verified TLS', () => {
  expect(smtpOptions(valid())).toMatchObject({
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  expect(smtpOptions({ ...valid(), SMTP_TLS: 'implicit', SMTP_PORT: '465' }).secure).toBe(true);
  for (const APP_MODE of ['production', 'staging', 'test', 'unknown', '']) {
    expect(() =>
      assertRuntimeSecurity({ ...valid(), APP_MODE, SMTP_TLS: 'none' }, 'web'),
    ).toThrow();
  }
  for (const APP_ORIGIN of [
    'http://localhost:3100',
    'http://127.0.0.1:3100',
    'http://[::1]:3100',
  ]) {
    expect(() => assertRuntimeSecurity({ APP_MODE: 'local', APP_ORIGIN }, 'web')).not.toThrow();
    expect(() =>
      smtpOptions({ APP_MODE: 'local', APP_ORIGIN, SMTP_HOST: 'public.invalid' }),
    ).toThrow('SMTP_TLS');
  }
  expect(() =>
    assertRuntimeSecurity({ APP_MODE: 'local', APP_ORIGIN: 'https://public.invalid' }, 'web'),
  ).toThrow('APP_ORIGIN');
  const env = valid();
  env.SMTP_TLS = '';
  expect(() => assertRuntimeSecurity(env, 'web')).toThrow('SMTP_TLS');
});
it('I-12 I-17 operational monitoring cannot serialize private error data and queue failures remain retryable with a generic error', async () => {
  const lines: string[] = [];
  operationalEvent('web.request.failed', (line) => {
    lines.push(line);
  });
  expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual(['event', 'requestId', 'timestamp']);
  expect(() => operationalEvent('member@synthetic.invalid' as 'worker.error', () => {})).toThrow();
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await expect(
    monitoredJob(async () => {
      throw new Error('private email token message photo location body sentinel');
    }),
  ).rejects.toThrow('JOB_FAILED');
  expect(JSON.stringify(output.mock.calls)).not.toMatch(/sentinel|email|token|photo|location|body/);
  expect(await monitoredJob(async () => 42)).toBe(42);
});
