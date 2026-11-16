import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
test('I-12 P22 production browser assets contain neither source maps nor configured server secrets', async () => {
  const root = resolve('apps/web/.next/static');
  const files = await readdir(root, { recursive: true });
  expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  const secrets = Object.entries(process.env)
    .filter(
      ([name, value]) => /KEY|PASSWORD|DATABASE_URL/.test(name) && value && value.length >= 16,
    )
    .map(([, value]) => value!);
  expect(secrets.length).toBeGreaterThan(0);
  for (const file of files.filter((file) => file.endsWith('.js'))) {
    const content = await readFile(resolve(root, file), 'utf8');
    // Compare booleans so even a failing assertion cannot print a secret.
    expect(secrets.some((secret) => content.includes(secret))).toBe(false);
  }
});
test('I-19 P22 direct Next startup fails closed on missing TLS, even when bypassing the web wrapper', () => {
  const require = createRequire(resolve('apps/web/package.json'));
  const result = spawnSync(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'start', '--port', '3198', '--hostname', '127.0.0.1'],
    {
      cwd: resolve('apps/web'),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        APP_MODE: 'production',
        APP_ORIGIN: 'https://synthetic.invalid',
        SMTP_TLS: 'none',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_PASS: 'private-startup-sentinel',
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain('SMTP_TLS');
  expect(result.stdout + result.stderr).not.toContain('private-startup-sentinel');
});
test('I-19 P22 CSP nonces are fresh and bound to rendered scripts; hydration and navigation work while injected inline script is blocked', async ({
  page,
  request,
}) => {
  const a = await request.get('/signin', {
    headers: { 'x-nonce': 'attacker', 'Content-Security-Policy': "script-src 'unsafe-inline'" },
  });
  const b = await request.get('/signin');
  const csp = a.headers()['content-security-policy']!;
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).not.toBe(b.headers()['content-security-policy']);
  expect(csp).not.toContain('attacker');
  expect(csp.split(';').find((d) => d.trim().startsWith('script-src '))).not.toContain(
    'unsafe-inline',
  );
  const html = await a.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(script[1]).toContain(`nonce="${nonce}"`);
  for (const name of [
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ])
    expect(a.headers()[name]).toBeTruthy();
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('Content Security Policy')) violations.push(msg.text());
  });
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(`csp-${Date.now()}@synthetic.invalid`);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(
    page.getByText('If a link can be sent, it will arrive shortly. Open it in this browser.'),
  ).toBeVisible();
  expect(violations).toEqual([]);
  // Model untrusted HTML injection, not trusted script creation through DevTools.
  await page.route('**/signin', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        '</body>',
        '<script>window.__injectedCsp = true</script></body>',
      ),
    });
  });
  await page.goto('/signin');
  expect(await page.evaluate(() => '__injectedCsp' in window)).toBe(false);
  expect(violations.length).toBeGreaterThan(0);
  const missing = await request.get('/definitely-not-a-page');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-security-policy']).toContain("'nonce-");
  for (const path of ['/.env', '/.git/config']) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
  }
  expect(a.headers()['access-control-allow-origin']).toBeUndefined();
});
