import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { lookupToken } from '../../packages/db/src/encryption';
import { accountConfig as c } from '../../packages/config/src/accounts';
import { pilot } from '../../packages/config/src/pilot';
import { syntheticProfile, syntheticPreferences } from '../fixtures/accounts';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Isolated test DB required');
const pool = new Pool({ connectionString: url });
test.afterAll(async () => {
  await pool.end();
});
async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
async function post(page: Page, path: string, data: unknown) {
  return page.request.post(`/api/v1/${path}`, {
    headers: { Origin: 'http://localhost:3100', 'Idempotency-Key': randomUUID() },
    data,
  });
}
async function signin(page: Page) {
  const email = `${randomUUID()}@synthetic.invalid`;
  await page.goto('/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('If a link can be sent');
  let mailId = '';
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const data = (await result.json()) as { messages: { ID: string }[] };
        mailId = data.messages?.[0]?.ID ?? '';
        return !!mailId;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const result = await fetch(`http://127.0.0.1:8025/api/v1/message/${mailId}`);
  const mail = (await result.json()) as { Text: string };
  const link = mail.Text.match(/http:\/\/localhost:3100\/verify#[A-Za-z0-9_-]+/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await page.getByRole('button', { name: 'Continue securely' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const member = await pool.query<{ id: string }>(
    'SELECT id FROM identity.users WHERE email_lookup=$1',
    [lookupToken(process.env.LOOKUP_KEY!, email)],
  );
  return { email, id: member.rows[0]!.id };
}
async function register(page: Page) {
  const result = await post(page, 'account/register', {
    birthDate: '2002-01-15',
    accepted: true,
    termsVersion: c.TERMS_VERSION,
    privacyVersion: c.PRIVACY_VERSION,
  });
  expect(result.status()).toBe(200);
}
async function photoBytes() {
  return sharp({ create: { width: 240, height: 300, channels: 3, background: '#849482' } })
    .png()
    .toBuffer();
}
async function populate(page: Page) {
  expect((await post(page, 'profile', { version: 0, data: syntheticProfile })).status()).toBe(200);
  expect(
    (await post(page, 'preferences', { version: 0, data: syntheticPreferences })).status(),
  ).toBe(200);
}
test('REQ-025 axe checks every public page, keyboard access and mobile layout', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/how-it-works',
    '/safety',
    '/privacy',
    '/terms',
    '/apply',
    '/signin',
    '/verify',
  ]) {
    await page.goto(path);
    await axe(page);
  }
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await axe(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('heading', { name: 'Room for something real.' }).click();
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/home-desktop.png', fullPage: true });
});
test('Apply outside the catchment is honest and does not collect an email or create an account', async ({
  page,
}) => {
  await page.goto('/apply');
  const email = `${randomUUID()}@synthetic.invalid`;
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Are you in our launch catchment?').selectOption('outside');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('We have not saved your email');
  const r = await pool.query('SELECT 1 FROM identity.magic_links WHERE email_lookup=$1', [
    lookupToken(process.env.LOOKUP_KEY!, email),
  ]);
  expect(r.rowCount).toBe(0);
});
test('I-01 and REQ-021 real email-to-onboarding flow stays under three minutes; photos require review', async ({
  page,
}) => {
  const start = Date.now();
  const user = await signin(page);
  await axe(page);
  await page.getByLabel('Birth date').fill('2015-01-01');
  await page.getByLabel('I acknowledge the development terms and privacy notice.').check();
  await page.getByRole('button', { name: 'Confirm eligibility' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('adults aged 18–30');
  await page.getByLabel('Birth date').fill('2002-01-15');
  await page.getByRole('button', { name: 'Confirm eligibility' }).click();
  await page.getByLabel('Chosen display name').fill('Synthetic Finch');
  await page.getByLabel('I describe my gender as').selectOption('nonbinary');
  await page
    .getByRole('combobox', { name: 'Relationship intention', exact: true })
    .selectOption('long-term');
  await page
    .getByRole('combobox', { name: 'Relationship structure', exact: true })
    .selectOption('monogamous');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Your broad area').selectOption('chelsea');
  await page.getByLabel('Maximum travel time, in minutes').fill('30');
  await page.getByLabel('How you would travel').selectOption('transit');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const interest of ['Art', 'Books', 'Cooking', 'Coffee', 'Film'])
    await page.getByLabel(interest, { exact: true }).check();
  await page.getByLabel('A small thing that makes my day…').fill('A quiet page and a warm cup.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Nonbinary people', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('I’m flexible this week').check();
  await page.getByRole('button', { name: 'Save and add photos' }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Add a photo', { exact: false }).setInputFiles({
      name: `synthetic-${i}.png`,
      mimeType: 'image/png',
      buffer: await photoBytes(),
    });
    await expect(page.getByText('Awaiting review', { exact: true })).toHaveCount(i + 1);
  }
  expect(Date.now() - start).toBeLessThan(pilot.ONBOARDING_TARGET_SECONDS * 1000);
  await axe(page);
  await page.getByRole('link', { name: 'View my profile' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Synthetic Finch.' })).toBeVisible();
  const me = await (await page.request.get('/api/v1/me')).json();
  expect(me.policy.state).toBe('ONBOARDING');
  expect(me.age).toBeGreaterThanOrEqual(18);
  expect(JSON.stringify(me)).not.toMatch(/birth|email|cipher|2002-01-15/);
  const failed = await post(page, 'account/policy', {
    action: 'ACTIVATE',
    version: me.policy.version,
  });
  expect(failed.status()).toBe(422);
  await axe(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Account & discovery' })).toBeVisible();
  await page.getByText('Edit profile, preferences & availability', { exact: true }).click();
  await axe(page);
  // This synthetic member is intentionally left pending, with real private S3 objects.
  expect(user.id).toBeTruthy();
});
test('I-19 route matrix rejects anonymous access, cross-origin writes, unknown fields and another member’s photos', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  for (const path of [
    'me',
    'account/sessions',
    'ops/photos',
    'ops/audit',
    `ops/photos/${randomUUID()}`,
    `photos/${randomUUID()}`,
  ]) {
    expect((await page.request.get(`/api/v1/${path}`)).status()).toBe(401);
  }
  for (const path of [
    'account/register',
    'account/policy',
    'account/sessions/revoke-others',
    'auth/signout',
    'profile',
    'preferences',
    'photos',
    `photos/${randomUUID()}/remove`,
    `ops/photos/${randomUUID()}`,
  ])
    expect((await post(page, path, {})).status()).toBe(401);
  expect((await post(page, 'auth/passkey/options', { kind: 'register' })).status()).toBe(401);
  expect(
    (
      await page.request.post('/api/v1/auth/request', {
        headers: { Origin: 'https://attacker.invalid' },
        data: { email: 'synthetic@invalid.test', purpose: 'signin' },
      })
    ).status(),
  ).toBe(403);
  await signin(page);
  await register(page);
  await populate(page);
  const upload = await page.request.post('/api/v1/photos', {
    headers: {
      Origin: 'http://localhost:3100',
      'Content-Type': 'image/png',
      'Idempotency-Key': randomUUID(),
    },
    data: await photoBytes(),
  });
  expect(upload.status()).toBe(200);
  const photo = await upload.json();
  expect((await page.request.get(`/api/v1/photos/${photo.id}`)).status()).toBe(200);
  expect(
    (
      await post(page, 'profile', { version: 1, data: { ...syntheticProfile, latitude: 40.7 } })
    ).status(),
  ).toBe(400);
  for (const path of ['ops/photos', 'ops/audit', `ops/photos/${photo.id}`])
    expect((await page.request.get(`/api/v1/${path}`)).status()).toBe(403);
  expect((await post(page, `ops/photos/${photo.id}`, { version: 0, approve: true })).status()).toBe(
    403,
  );
  const other = await browser.newContext();
  const second = await other.newPage();
  await signin(second);
  await register(second);
  expect((await second.request.get(`/api/v1/photos/${photo.id}`)).status()).toBe(404);
  expect((await post(second, `photos/${photo.id}/remove`, {})).status()).toBe(404);
  await other.close();
});
test('I-20 operator photo moderation activates only after review and audit access is admin-only', async ({
  page,
  browser,
}) => {
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signin(member);
  await register(member);
  await populate(member);
  const uploaded = [];
  for (let i = 0; i < pilot.PROFILE_MIN_PHOTOS; i++) {
    const response = await member.request.post('/api/v1/photos', {
      headers: {
        Origin: 'http://localhost:3100',
        'Content-Type': 'image/png',
        'Idempotency-Key': randomUUID(),
      },
      data: await photoBytes(),
    });
    expect(response.status()).toBe(200);
    uploaded.push((await response.json()) as { id: string });
  }
  const staff = await signin(page);
  await register(page);
  await pool.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'operator')", [staff.id]);
  await page.goto('/ops');
  await expect(page.getByRole('button', { name: 'Refresh review queue' })).toBeVisible();
  await axe(page);
  const queue = (await (await page.request.get('/api/v1/ops/photos')).json()) as {
    id: string;
    version: number;
  }[];
  expect(queue.length).toBeGreaterThan(0);
  for (const photo of uploaded) {
    expect(
      (await post(page, `ops/photos/${photo.id}`, { version: 0, approve: true })).status(),
    ).toBe(200);
  }
  const me = await (await member.request.get('/api/v1/me')).json();
  expect(
    (
      await post(member, 'account/policy', { action: 'ACTIVATE', version: me.policy.version })
    ).status(),
  ).toBe(200);
  expect((await (await member.request.get('/api/v1/me')).json()).policy.state).toBe('ACTIVE');
  expect((await page.request.get('/api/v1/ops/audit')).status()).toBe(403);
  await pool.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'admin')", [staff.id]);
  await page.reload();
  await page.getByRole('button', { name: 'Review audit log' }).click();
  await expect(page.getByText(/audit read ·/).first()).toBeVisible();
  await axe(page);
  const audit = await pool.query('SELECT action FROM ops.audit WHERE actor_id=$1', [staff.id]);
  expect(audit.rows.some((row) => row.action === 'MEDIA_APPROVED')).toBe(true);
  await memberContext.close();
});
test('Optional passkey round trip uses user verification; deletion requires fresh authentication', async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const user = await signin(page);
  await register(page);
  await populate(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add a passkey', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Passkey added.');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await pool.query(
    "UPDATE identity.sessions SET authenticated_at=now()-interval '1 hour' WHERE member_id=$1",
    [user.id],
  );
  const me = await (await page.request.get('/api/v1/me')).json();
  expect(
    (await post(page, 'account/policy', { action: 'DELETE', version: me.policy.version })).status(),
  ).toBe(403);
  await pool.query('UPDATE identity.sessions SET authenticated_at=now() WHERE member_id=$1', [
    user.id,
  ]);
  expect(
    (await post(page, 'account/policy', { action: 'DELETE', version: me.policy.version })).status(),
  ).toBe(200);
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await cdp.detach();
});
