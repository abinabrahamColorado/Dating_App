import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { ExploreStore } from '../../packages/db/src/explore';
import { VenueStore } from '../../packages/db/src/venues';
import { hashToken } from '../../packages/db/src/encryption';
import { accountConfig } from '../../packages/config/src/accounts';
import { syntheticProfile, syntheticPreferences } from '../fixtures/accounts';
import { syntheticVenue } from '../fixtures/venues';
import { putPhoto } from '../../apps/web/server/media';
import { zonedParts } from '../../packages/core/src/connections';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Real test database required');
const admin = new Pool({ connectionString: url }),
  identity = new Pool({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL! }),
  app = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL! }),
  ops = new Pool({ connectionString: process.env.TEST_OPS_DATABASE_URL! });
const accounts = new AccountStore({
    identity,
    app,
    ops,
    identityKey: process.env.IDENTITY_ENCRYPTION_KEY!,
    appKey: process.env.APP_ENCRYPTION_KEY!,
    lookupKey: process.env.LOOKUP_KEY!,
  }),
  explore = new ExploreStore(accounts),
  venues = new VenueStore(accounts),
  members: string[] = [],
  venueIds: string[] = [];
test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  await admin.query("UPDATE app.members SET state='PAUSED' WHERE id=ANY($1::uuid[])", [members]);
  await admin.query('UPDATE app.explore_venues SET approved=false WHERE id=ANY($1::uuid[])', [
    venueIds,
  ]);
  await Promise.all([admin, identity, app, ops].map((p) => p.end()));
});
async function seed(page: Page, staff = false): Promise<Authority> {
  const id = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID();
  members.push(id);
  await identity.query(
    'INSERT INTO identity.users(id,email_lookup,email_cipher) VALUES($1,$2,$3)',
    [
      id,
      accounts.lookup(`${id}@synthetic.invalid`),
      accounts.identityCipher.seal(`${id}@synthetic.invalid`, `email:${id}`),
    ],
  );
  await identity.query(
    "INSERT INTO identity.sessions(id,member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [sessionId, id, hashToken(token)],
  );
  await accounts.ensureMember(id);
  await accounts.register(id, {
    birthDate: '2002-01-15',
    termsVersion: accountConfig.TERMS_VERSION,
    privacyVersion: accountConfig.PRIVACY_VERSION,
    accepted: true,
  });
  await accounts.saveProfile(id, randomUUID(), 0, syntheticProfile);
  await accounts.savePreferences(id, randomUUID(), 0, syntheticPreferences);
  if (!staff)
    for (let i = 0; i < 2; i++) {
      const photo = randomUUID();
      process.env.MEDIA_BUCKET = 'meetwell-private-test';
      await putPhoto(
        photo,
        await sharp({ create: { width: 80, height: 80, channels: 3, background: '#78896a' } })
          .jpeg()
          .toBuffer(),
      );
      await admin.query("INSERT INTO app.media(id,member_id,status) VALUES($1,$2,'APPROVED')", [
        photo,
        id,
      ]);
    }
  await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
  if (staff)
    await admin.query(
      "INSERT INTO ops.staff(member_id,role) VALUES($1,'operator'),($1,'safety_reviewer')",
      [id],
    );
  await page.context().addCookies([
    {
      name: 'meetwell_session',
      value: token,
      url: 'http://localhost:3100',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return { memberId: id, sessionId, authenticatedAt: new Date(), registered: true, age: 24 };
}
async function mutual(a: Authority, b: Authority, staff: Authority) {
  const batch = await explore.generate(
      staff,
      randomUUID(),
      { seed: randomUUID(), members: [a.memberId, b.memberId] },
      randomUUID(),
    ),
    review = await explore.review(staff, batch.id, randomUUID()),
    id = review.pairs[0]!.id;
  await explore.edit(
    staff,
    batch.id,
    randomUUID(),
    { action: 'APPROVE', version: 0 },
    randomUUID(),
  );
  await explore.deliverOne(id);
  for (const member of [a, b])
    await explore.decide(member, id, randomUUID(), { decision: 'ACCEPT', version: 0 });
  return id;
}
async function axe(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}
async function post(page: Page, path: string, data: unknown) {
  return page.request.post(`/api/v1/${path}`, {
    headers: { Origin: 'http://localhost:3100', 'Idempotency-Key': randomUUID() },
    data,
  });
}
function tomorrow() {
  const p = zonedParts(new Date(), 'America/New_York');
  return `${new Date(Date.UTC(p.year, p.month - 1, p.day + 1)).toISOString().slice(0, 10)}T11:00`;
}
test('I-09 I-11 I-20 reviewed public venue and mutual connection reach a confirmed accessible plan without chat; calendar, private share and manual messages work', async ({
  page,
  browser,
}, testInfo) => {
  const otherContext = await browser.newContext(),
    operatorContext = await browser.newContext();
  const other = await otherContext.newPage(),
    operator = await operatorContext.newPage();
  try {
    const a = await seed(page),
      b = await seed(other),
      staff = await seed(operator, true),
      name = `Synthetic M4 public room ${randomUUID().slice(0, 8)}`;
    await operator.goto('/ops/venues');
    await operator.getByRole('button', { name: 'Add a public meeting place', exact: true }).click();
    await operator.getByLabel('Venue name', { exact: true }).fill(name);
    for (const label of [
      'Public address',
      'Public entrance',
      'Permitted meeting area',
      'Transit access',
      'Emergency exit notes',
      'Checks completed and limitations',
      'Accessibility details and limits',
    ])
      await operator.getByLabel(label, { exact: true }).fill(`Synthetic ${label.toLowerCase()}`);
    await operator.getByLabel('Latitude', { exact: true }).fill('40.746');
    await operator.getByLabel('Longitude', { exact: true }).fill('-74.001');
    for (const day of [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ])
      await operator.getByLabel(day, { exact: true }).check();
    for (const label of [
      'Verified accessible entrance',
      'Verified accessible seating',
      'Verified accessible toilets',
      'Seating available',
      'No purchase required',
      'Alcohol-free options available',
      'Staff present during listed hours',
      'conversation',
      'coffee',
    ])
      await operator.getByLabel(label, { exact: true }).check();
    await operator
      .getByLabel('Review date', { exact: true })
      .fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
    await operator
      .getByLabel('Review expiry date (end of day UTC)', { exact: true })
      .fill(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
    await operator
      .getByLabel('I reviewed the public meeting area, its access conditions and the checks above')
      .check();
    await operator.getByLabel('Approve for suggestions', { exact: true }).check();
    await axe(operator);
    await operator.screenshot({ path: testInfo.outputPath('venue-review.png'), fullPage: true });
    await operator.getByRole('button', { name: 'Save venue review', exact: true }).click();
    await expect(operator.getByRole('status')).toContainText('Venue review saved');
    const venue = (await admin.query('SELECT id FROM app.explore_venues WHERE name=$1', [name]))
      .rows[0].id as string;
    venueIds.push(venue);
    const id = await mutual(a, b, staff);
    await page.goto(`/connections/${id}`);
    await other.goto(`/connections/${id}`);
    await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Something felt off', exact: true })).toBeVisible();
    await page
      .getByLabel('Proposed date and time (America/New_York)', { exact: true })
      .fill(tomorrow());
    await page.getByRole('button', { name: 'Find meeting places', exact: true }).click();
    await page.getByRole('button', { name: `Propose ${name}`, exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm this venue and time', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm this venue and time', exact: true }).click();
    await other.reload();
    await other.getByRole('button', { name: 'Confirm this venue and time', exact: true }).click();
    await page.reload();
    await expect(page.getByText('You both confirmed this plan.', { exact: true })).toBeVisible();
    expect(
      (await admin.query('SELECT 1 FROM app.messages WHERE connection_id=$1', [id])).rowCount,
    ).toBe(0);
    await page.getByRole('link', { name: 'Open plan page', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your meeting plan', exact: true }),
    ).toBeVisible();
    await axe(page);
    await page.screenshot({ path: testInfo.outputPath('confirmed-plan.png'), fullPage: true });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Add to calendar', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('meetwell-plan.ics');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }),
    );
    await page.getByRole('button', { name: 'Share plan', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Plan copied.');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(name);
    expect(copied).toContain('Synthetic');
    expect(copied).not.toContain(id);
    expect(copied).not.toContain('chelsea');
    await page.getByRole('button', { name: "I'm here", exact: true }).click();
    await other.reload();
    await expect(
      other.getByRole('list', { name: 'Messages' }).getByText("I'm here", { exact: true }),
    ).toBeVisible();
    await other
      .getByLabel('Your message', { exact: true })
      .fill('Synthetic question before travel');
    await other.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('link', { name: 'Back to chat and planning', exact: true }).click();
    await expect(page.getByText('Synthetic question before travel', { exact: true })).toBeVisible();
    await axe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('mobile-conversation.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await other.getByRole('button', { name: 'Close connection privately', exact: true }).click();
    await expect(page.getByText('This connection has ended.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Something felt off', exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
    await operatorContext.close();
  }
});
test('I-04 I-09 I-11 venue kill switch invalidates an unconfirmed plan, block denies chat and reports/help remain available over HTTP', async ({
  page,
  browser,
}) => {
  const otherContext = await browser.newContext(),
    operatorContext = await browser.newContext();
  const other = await otherContext.newPage(),
    operator = await operatorContext.newPage();
  try {
    const a = await seed(page),
      b = await seed(other),
      staff = await seed(operator, true),
      v = syntheticVenue();
    venueIds.push(v.id);
    await venues.save(staff, randomUUID(), v, randomUUID());
    const id = await mutual(a, b, staff);
    await page.goto(`/connections/${id}`);
    const time = { start: new Date(Date.now() + 86400000).toISOString(), minutes: 30 },
      options = await (await post(page, `connections/${id}/options`, time)).json(),
      choice = options.venues[0];
    expect(choice).toBeTruthy();
    const plan = await (
      await post(page, `connections/${id}/plans`, {
        action: 'PROPOSE',
        optionsId: options.id,
        venueId: choice.id,
      })
    ).json();
    const switched = await post(operator, 'ops/safety/switches', {
      scope: 'VENUE',
      target: choice.id,
      disabled: true,
      version: 0,
    });
    expect(switched.status()).toBe(200);
    await page.goto(`/connections/${id}/plans/${plan.id}`);
    await expect(page.getByText(/This plan has changed or is unavailable/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirm this venue and time', exact: true }),
    ).toHaveCount(0);
    await axe(page);
    expect((await post(page, 'safety/block', { subjectId: b.memberId })).status()).toBe(200);
    expect(
      (
        await post(other, `connections/${id}/messages`, { text: 'Synthetic denied message' })
      ).status(),
    ).toBe(409);
    await page.reload();
    await page.getByRole('link', { name: 'Something felt off', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Get help now', exact: true })).toBeVisible();
    const report = await post(page, 'safety/reports', {
      subjectId: b.memberId,
      detail: '',
      context: { surface: 'plan' },
    });
    expect(report.status()).toBe(200);
    await page.goto('/safety/help');
    await axe(page);
  } finally {
    await otherContext.close();
    await operatorContext.close();
  }
});
