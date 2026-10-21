import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AccountStore } from '../../packages/db/src/accounts';
import { hashToken } from '../../packages/db/src/encryption';
import { accountConfig } from '../../packages/config/src/accounts';
import { syntheticProfile } from '../fixtures/accounts';
import { putPhoto } from '../../apps/web/server/media';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Real isolated test DB required');
const admin = new Pool({ connectionString: url });
const identity = new Pool({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL! }),
  app = new Pool({ connectionString: process.env.TEST_APP_DATABASE_URL! }),
  ops = new Pool({ connectionString: process.env.TEST_OPS_DATABASE_URL! });
const db = new AccountStore({
  identity,
  app,
  ops,
  identityKey: process.env.IDENTITY_ENCRYPTION_KEY!,
  appKey: process.env.APP_ENCRYPTION_KEY!,
  lookupKey: process.env.LOOKUP_KEY!,
});
const created: string[] = [];
test.afterAll(async () => {
  await admin.query("UPDATE safety.report SET status='CLOSED' WHERE reporter_id=ANY($1::uuid[])", [
    created,
  ]);
  await admin.query(
    "UPDATE safety.integrity_signal SET status='CLOSED' WHERE reporter_id=ANY($1::uuid[])",
    [created],
  );
  await admin.query(
    "UPDATE safety.appeal SET status='UPHELD' WHERE member_id=ANY($1::uuid[]) AND status='OPEN'",
    [created],
  );
  await Promise.all([admin, identity, app, ops].map((p) => p.end()));
});
async function seed(page: Page, staff = false) {
  const id = randomUUID(),
    session = randomUUID(),
    token = randomUUID();
  created.push(id);
  await identity.query(
    'INSERT INTO identity.users(id,email_lookup,email_cipher) VALUES($1,$2,$3)',
    [
      id,
      db.lookup(`${id}@synthetic.invalid`),
      db.identityCipher.seal(`${id}@synthetic.invalid`, `email:${id}`),
    ],
  );
  await identity.query(
    "INSERT INTO identity.sessions(id,member_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [session, id, hashToken(token)],
  );
  await db.ensureMember(id);
  await db.register(id, {
    birthDate: '2002-01-15',
    termsVersion: accountConfig.TERMS_VERSION,
    privacyVersion: accountConfig.PRIVACY_VERSION,
    accepted: true,
  });
  await db.saveProfile(id, randomUUID(), 0, syntheticProfile);
  await admin.query("UPDATE app.members SET state='ACTIVE' WHERE id=$1", [id]);
  if (staff)
    await admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'safety_reviewer')", [id]);
  await page.context().addCookies([
    {
      name: 'meetwell_session',
      value: token,
      url: 'http://localhost:3100',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return { id, session, token };
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
async function post(page: Page, path: string, data: unknown, key = randomUUID()) {
  return page.request.post(`/api/v1/${path}`, {
    headers: { Origin: 'http://localhost:3100', 'Idempotency-Key': key },
    data,
  });
}
test('I-11 independent public help, settings report without block/detail, acknowledgement and lost-response retry are accessible', async ({
  page,
}) => {
  await page.goto('/safety/help');
  await expect(page.getByRole('heading', { name: 'Get help now' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
  await axe(page);
  const a = await seed(page);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Something felt off', exact: true }).click();
  await axe(page);
  let lost = true;
  await page.route('**/api/v1/safety/reports', async (route) => {
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Send report', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your report was received');
  expect(
    (await admin.query('SELECT 1 FROM safety.report WHERE reporter_id=$1', [a.id])).rowCount,
  ).toBe(1);
  expect(
    (await admin.query('SELECT 1 FROM app.blocks WHERE low_id=$1 OR high_id=$1', [a.id])).rowCount,
  ).toBe(0);
  await page.getByRole('link', { name: 'View case status' }).click();
  await expect(page.getByRole('heading', { name: 'Report received' })).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: 'My reports and account review', exact: true }).click();
  await axe(page);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Something felt off', exact: true })).toBeVisible();
});
test('I-04 I-11 profile and approved photo access stop bilaterally, block stays independent, report survives unavailable subject', async ({
  page,
  browser,
}) => {
  const a = await seed(page),
    other = await browser.newContext(),
    bPage = await other.newPage(),
    b = await seed(bPage);
  try {
    await admin.query(
      "INSERT INTO app.profile_access(viewer_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 day'),($2,$1,now()+interval '1 day')",
      [a.id, b.id],
    );
    const photo = randomUUID();
    process.env.MEDIA_BUCKET = 'meetwell-private-test';
    await putPhoto(
      photo,
      await sharp({ create: { width: 240, height: 300, channels: 3, background: '#849482' } })
        .jpeg()
        .toBuffer(),
    );
    await admin.query("INSERT INTO app.media(id,member_id,status) VALUES($1,$2,'APPROVED')", [
      photo,
      b.id,
    ]);
    await page.goto(`/members/${b.id}`);
    await expect(page.getByRole('heading', { name: 'Finch,', exact: false })).toBeVisible();
    await axe(page);
    expect((await page.request.get(`/api/v1/members/${b.id}/photos/${photo}`)).status()).toBe(200);
    await page.getByRole('link', { name: 'Something felt off' }).click();
    await page.getByRole('button', { name: 'Block this person' }).click();
    await expect(page.getByRole('status')).toContainText('No report was filed');
    expect((await page.request.get(`/api/v1/members/${b.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/v1/members/${b.id}/photos/${photo}`)).status()).toBe(404);
    expect((await bPage.request.get(`/api/v1/members/${a.id}`)).status()).toBe(404);
    await admin.query(
      "UPDATE app.members SET state='EXITED',deletion_requested_at=now() WHERE id=$1",
      [b.id],
    );
    await page.getByRole('button', { name: 'Send report', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Your report was received');
    await page.getByRole('link', { name: 'View case status' }).click();
    await axe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await other.close();
  }
});
test('I-12 I-20 audited console, separate integrity, precaution, appeal, lift, switches and staff revocation work end to end', async ({
  page,
  browser,
}) => {
  const reporter = await seed(page),
    staffContext = await browser.newContext(),
    staffPage = await staffContext.newPage(),
    staff = await seed(staffPage, true),
    subjectContext = await browser.newContext(),
    subjectPage = await subjectContext.newPage(),
    subject = await seed(subjectPage);
  try {
    const report = (await (
      await post(page, 'safety/reports', {
        subjectId: subject.id,
        detail: 'Synthetic safety concern',
        severity: 'URGENT',
        context: { surface: 'profile' },
      })
    ).json()) as { id: string };
    await page.goto(`/safety/concern?subject=${subject.id}`);
    await page.getByLabel('Profile difference (optional)').fill('Synthetic discrepancy');
    await page.getByRole('button', { name: 'Send profile concern' }).click();
    await expect(page.getByRole('status')).toContainText('separate integrity review');
    await staffPage.goto('/ops/safety');
    await staffPage.getByRole('button', { name: `Open case ${report.id.slice(0, 8)}` }).click();
    await expect(staffPage.getByText('Synthetic safety concern', { exact: true })).toBeVisible();
    await axe(staffPage);
    await staffPage.getByRole('button', { name: 'Apply precautionary restriction' }).click();
    await expect(staffPage.getByRole('status')).toContainText('Precautionary restriction applied');
    await subjectPage.goto('/safety/cases');
    await expect(
      subjectPage.getByRole('heading', { name: 'Request account review' }),
    ).toBeVisible();
    await axe(subjectPage);
    const own = await (await subjectPage.request.get('/api/v1/safety/enforcement')).text();
    expect(own).not.toContain(reporter.id);
    expect(own).not.toContain(report.id);
    expect(own).not.toContain('Synthetic safety concern');
    await subjectPage
      .getByLabel('Anything you want the reviewer to know (optional)')
      .fill('Synthetic appeal text');
    await subjectPage.getByRole('button', { name: 'Request review', exact: true }).click();
    await expect(subjectPage.getByRole('status')).toContainText('Your appeal was received');
    await staffPage.getByRole('button', { name: 'Refresh console' }).click();
    await expect(staffPage.getByText('Synthetic appeal text')).toBeVisible();
    await staffPage.getByRole('button', { name: 'Lift restriction after review' }).click();
    await expect(staffPage.getByRole('main').getByRole('alert')).toContainText(
      'different safety reviewer',
    );
    const independent = await seed(staffPage, true);
    expect(independent.id).not.toBe(staff.id);
    await staffPage.reload();
    await staffPage.getByRole('button', { name: 'Lift restriction after review' }).click();
    await expect(staffPage.getByRole('status')).toContainText('restriction lifted');
    await staffPage.getByRole('combobox', { name: 'Queue', exact: true }).selectOption('integrity');
    await staffPage
      .getByRole('button', { name: /Open case/ })
      .first()
      .click();
    await expect(
      staffPage.getByRole('heading', { name: 'Case review', exact: true }),
    ).toBeVisible();
    await axe(staffPage);
    await staffPage.getByLabel('Venue or event reference').fill(randomUUID());
    await staffPage.getByRole('button', { name: 'Save shutdown' }).click();
    await expect(staffPage.getByRole('status')).toContainText('Shutdown saved');
    await staffPage.getByRole('button', { name: 'Review access audit' }).click();
    await expect(staffPage.getByText(/REPORT CASE VIEW/).first()).toBeVisible();
    await admin.query('DELETE FROM ops.staff WHERE member_id=$1', [independent.id]);
    expect((await staffPage.request.get(`/api/v1/ops/safety/reports/${report.id}`)).status()).toBe(
      403,
    );
    await staffPage.getByRole('button', { name: 'Refresh console' }).click();
    await expect(staffPage.getByRole('main').getByRole('alert')).toContainText('not available');
    await expect(staffPage.getByRole('heading', { name: 'Case review', exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await admin.query(
          "SELECT 1 FROM safety.case_access_audit WHERE record_id=$1 AND action='REPORT_CASE_VIEW'",
          [report.id],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
  } finally {
    await staffContext.close();
    await subjectContext.close();
  }
});
