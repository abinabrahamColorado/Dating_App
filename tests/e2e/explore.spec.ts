import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AccountStore, type Authority } from '../../packages/db/src/accounts';
import { ExploreStore } from '../../packages/db/src/explore';
import { hashToken } from '../../packages/db/src/encryption';
import { accountConfig } from '../../packages/config/src/accounts';
import { syntheticProfile, syntheticPreferences } from '../fixtures/accounts';
import { putPhoto } from '../../apps/web/server/media';
import { sendIntroductionMail } from '../../packages/runtime/src/mail';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Real isolated test DB required');
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
  db = new ExploreStore(accounts);
const created: string[] = [],
  venue = randomUUID();
test.beforeAll(async () => {
  await admin.query(
    "INSERT INTO app.explore_venues(id,name,public_centroid,approved,review_expires_at,synthetic) VALUES($1,'Synthetic browser fixture',ST_SetSRID(ST_Point(-74.001,40.746),4326)::geography,true,now()+interval '1 year',true)",
    [venue],
  );
});
test.afterAll(async () => {
  await admin.query("UPDATE app.members SET state='PAUSED' WHERE id=ANY($1::uuid[])", [created]);
  await admin.query('UPDATE app.explore_venues SET approved=false WHERE id=$1', [venue]);
  await Promise.all([admin, identity, app, ops].map((p) => p.end()));
});
async function seed(page: Page, name: string, staff = false): Promise<Authority> {
  const id = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID();
  created.push(id);
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
  await accounts.saveProfile(id, randomUUID(), 0, { ...syntheticProfile, displayName: name });
  await accounts.savePreferences(id, randomUUID(), 0, syntheticPreferences);
  if (!staff)
    for (let i = 0; i < 2; i++) {
      const photo = randomUUID();
      process.env.MEDIA_BUCKET = 'meetwell-private-test';
      await putPhoto(
        photo,
        await sharp({
          create: { width: 80, height: 80, channels: 3, background: i ? '#78896a' : '#9d6b53' },
        })
          .jpeg()
          .toBuffer(),
      );
      await admin.query("INSERT INTO app.media(id,member_id,status) VALUES($1,$2,'APPROVED')", [
        photo,
        id,
      ]);
    }
  await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
  if (staff) await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'operator')", [id]);
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
async function deliver(a: Authority, b: Authority, staff: Authority) {
  const batch = await db.generate(
    staff,
    randomUUID(),
    { seed: randomUUID(), members: [a.memberId, b.memberId] },
    randomUUID(),
  );
  const r = await db.review(staff, batch.id, randomUUID());
  await db.edit(staff, batch.id, randomUUID(), { action: 'APPROVE', version: 0 }, randomUUID());
  const id = r.pairs[0]!.id;
  await db.deliverOne(id);
  return id;
}

test('I-02 I-06 I-07 I-15 I-16 operator review, generic mail, private cards, mutual connection and truthful capacity are accessible end to end', async ({
  page,
  browser,
}) => {
  const bContext = await browser.newContext(),
    staffContext = await browser.newContext();
  const bPage = await bContext.newPage(),
    staffPage = await staffContext.newPage();
  try {
    const a = await seed(page, 'Synthetic Cedar'),
      b = await seed(bPage, 'Synthetic Willow');
    await seed(staffPage, 'Synthetic Operator', true);
    await page.goto('/explore');
    await expect(
      page.getByText('No available introduction right now.', { exact: false }),
    ).toBeVisible();
    await axe(page);
    await page.getByLabel('Personal connection limit').selectOption('1');
    await page.getByRole('button', { name: 'Save introduction settings' }).click();
    await expect(page.getByRole('status')).toContainText('settings are saved');
    await staffPage.goto('/ops/explore');
    await staffPage.getByLabel('Optional member IDs').fill(`${a.memberId} ${b.memberId}`);
    await staffPage.getByRole('button', { name: 'Prepare review batch' }).click();
    await expect(
      staffPage.getByRole('heading', { name: 'Batch review', exact: true }),
    ).toBeVisible();
    await axe(staffPage);
    await staffPage.getByRole('button', { name: 'Approve batch for delivery' }).click();
    await expect(staffPage.getByRole('status')).toContainText('Batch approved');
    const opportunity = (
      await admin.query(
        'SELECT id FROM app.opportunities WHERE low_id=least($1::uuid,$2::uuid) AND high_id=greatest($1::uuid,$2::uuid)',
        [a.memberId, b.memberId],
      )
    ).rows[0].id;
    expect(await db.deliverOne(opportunity)).toEqual({ delivered: true });
    expect(
      (
        await admin.query(
          'SELECT policy,q FROM learning.introduction_exposure WHERE opportunity_id=$1',
          [opportunity],
        )
      ).rows,
    ).toEqual([{ policy: 'operator', q: null }]);
    const mail = (
      await admin.query(
        'SELECT id FROM app.introduction_mail WHERE opportunity_id=$1 AND member_id=$2',
        [opportunity, a.memberId],
      )
    ).rows[0].id;
    await db.sendOne(mail, sendIntroductionMail);
    const messages = (await (
      await fetch(
        `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${a.memberId}@synthetic.invalid`)}`,
      )
    ).json()) as { messages: { ID: string }[] };
    expect(messages.messages).toHaveLength(1);
    const email = (await (
      await fetch(`http://127.0.0.1:8025/api/v1/message/${messages.messages[0]!.ID}`)
    ).json()) as { Text: string };
    expect(email.Text).toContain('/explore');
    expect(email.Text).not.toMatch(/Cedar|Willow|Chelsea|40\.746/);
    await page.getByRole('button', { name: 'Refresh introductions' }).click();
    await expect(
      page.getByText('You are at your current capacity.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open introduction 1' }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic Willow, 24' })).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(2);
    await axe(page);
    const before = await (await bPage.request.get(`/api/v1/explore/${opportunity}`)).json();
    await page.getByRole('button', { name: 'Accept introduction' }).click();
    await expect(page.getByRole('button', { name: 'Accept introduction' })).toHaveCount(0);
    expect(await (await bPage.request.get(`/api/v1/explore/${opportunity}`)).json()).toEqual(
      before,
    );
    await bPage.goto(`/explore/${opportunity}`);
    await bPage.getByRole('button', { name: 'Accept introduction' }).click();
    await expect(bPage.getByRole('heading', { name: 'A mutual connection.' })).toBeVisible();
    await axe(bPage);
    await page.getByRole('button', { name: 'Refresh introduction', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A mutual connection.' })).toBeVisible();
    await page.getByRole('button', { name: 'Close connection' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Connection closed. Your slot is available again.',
    );
    expect((await bPage.request.get(`/api/v1/members/${a.memberId}`)).status()).toBe(404);
    await page.getByRole('link', { name: 'Something felt off' }).click();
    await expect(page.getByRole('button', { name: 'Send report', exact: true })).toBeVisible();
    await axe(page);
  } finally {
    await bContext.close();
    await staffContext.close();
  }
});
test('I-02 I-05 I-08 I-16 boundaries forbid padding, pass stays private, expiry is distinct and closed pairs never recur over HTTP', async ({
  page,
  browser,
}) => {
  const otherContext = await browser.newContext(),
    staffContext = await browser.newContext();
  const other = await otherContext.newPage(),
    staffPage = await staffContext.newPage();
  try {
    const a = await seed(page, 'Synthetic Elm'),
      b = await seed(other, 'Synthetic Ash'),
      staff = await seed(staffPage, 'Synthetic Reviewer', true);
    await accounts.savePreferences(a.memberId, randomUUID(), 1, {
      ...syntheticPreferences,
      age: { setting: 'HARD', min: 28, max: 30 },
    });
    const no = await post(staffPage, 'ops/explore', {
      seed: 'boundaries',
      members: [a.memberId, b.memberId],
    });
    expect(no.status()).toBe(200);
    const empty = await no.json();
    expect(
      (await (await staffPage.request.get(`/api/v1/ops/explore/${empty.id}`)).json()).pairs,
    ).toEqual([]);
    expect(
      (
        await post(staffPage, `ops/explore/${empty.id}`, {
          action: 'ADD',
          version: 0,
          u: a.memberId,
          v: b.memberId,
        })
      ).status(),
    ).toBe(422);
    await accounts.savePreferences(a.memberId, randomUUID(), 2, syntheticPreferences);
    const id = await deliver(a, b, staff);
    await page.goto(`/explore/${id}`);
    await page.getByRole('button', { name: 'Pass privately' }).click();
    await expect(page.getByRole('status')).toContainText('You passed');
    const view = await (await other.request.get('/api/v1/explore')).json();
    expect(view.opportunities.find((o: { id: string }) => o.id === id).status).toBe('UNAVAILABLE');
    expect(JSON.stringify(view)).not.toContain('PASS');
    expect(
      (
        await post(staffPage, `ops/explore/${empty.id}`, {
          action: 'ADD',
          version: 0,
          u: a.memberId,
          v: b.memberId,
        })
      ).status(),
    ).toBe(422);
    const c = await seed(other, 'Synthetic Oak');
    const expired = await deliver(a, c, staff);
    await admin.query(
      "UPDATE app.opportunities SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired],
    );
    await db.expireOne(expired);
    await page.goto('/explore');
    await expect(page.getByText('Introduction expired', { exact: false })).toBeVisible();
    await axe(page);
    expect(
      (
        await admin.query(
          'SELECT decision FROM learning.introduction_decision WHERE opportunity_id=$1',
          [expired],
        )
      ).rows,
    ).toEqual([]);
    expect((await page.request.get(`/api/v1/explore/${expired}`)).status()).toBe(404);
  } finally {
    await otherContext.close();
    await staffContext.close();
  }
});
