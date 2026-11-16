import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { lifecycleBrowser } from '../fixtures/lifecycle-browser';
import { refreshMetrics } from '../../packages/db/src/metrics';
const f = lifecycleBrowser();
test.describe.configure({ mode: 'serial' });
test.afterAll(f.close);
async function axe(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}
test('I-10 I-11 post-meeting feedback and independent invitation work under CSP with accessible controls', async ({
  page,
  browser,
}) => {
  const other = await browser.newPage(),
    operator = await browser.newPage();
  try {
    const a = await f.member(page),
      b = await f.member(other),
      staff = await f.member(operator, true),
      meeting = await f.encounter(a, b, staff);
    await page.goto('/feedback');
    await expect(page.getByRole('group', { name: 'Did you meet?' })).toBeVisible();
    await axe(page);
    await page
      .getByRole('group', { name: 'Did you meet?' })
      .getByLabel('Yes', { exact: true })
      .check();
    await page
      .getByRole('group', { name: 'Would you like to see them again?' })
      .getByLabel('Yes', { exact: true })
      .check();
    await page.getByLabel('Easy conversation').check();
    await page.getByRole('button', { name: 'Save privately' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your private answer is saved' }),
    ).toBeVisible();
    expect((await f.feedback.list(b)).find((x) => x.id === meeting.id)!.answer).toBeNull();
    expect(
      (
        await f.admin.query('SELECT 1 FROM app.messages WHERE connection_id=$1', [
          meeting.connection,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(
      page.getByRole('link', { name: 'Something important differed from their profile' }),
    ).toHaveAttribute('href', /post-meeting/);
    await expect(
      page.getByRole('link', { name: 'Something felt off', exact: true }).first(),
    ).toHaveAttribute('href', /post-meeting/);
    await page.getByRole('button', { name: 'Invite to meet again', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'invitation is queued' }),
    ).toBeVisible();
    expect(
      (
        await f.admin.query('SELECT 1 FROM app.messages WHERE connection_id=$1', [
          meeting.connection,
        ])
      ).rowCount,
    ).toBe(1);
    await page.reload();
    await expect(page.getByText('No new questions.')).toBeVisible();
  } finally {
    await other.close();
    await operator.close();
  }
});
test('I-10 optional success exit and separately consented follow-up remain accessible after exit', async ({
  page,
}) => {
  const a = await f.member(page);
  await page.goto('/settings');
  await page.getByLabel('Exit reason (optional)').selectOption('met-someone-here');
  await page.getByLabel('Ask me once after 30 days').check();
  await expect(page.getByLabel('Ask me once after 90 days')).not.toBeChecked();
  await page.getByRole('button', { name: 'Exit the service' }).click();
  await expect(page.getByRole('status')).toContainText('Your account choice is saved');
  expect(await f.feedback.followups(a)).toMatchObject([{ day: 30, answer: 'UNKNOWN' }]);
  await f.admin.query(
    "UPDATE app.outcome_followups SET due_at=clock_timestamp()-interval '1 day' WHERE member_id=$1",
    [a.memberId],
  );
  await page.goto('/outcomes');
  await expect(page.getByText('Is the meaningful connection')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Prefer not to say', exact: true }).click();
  await expect(page.getByText('Your answer is saved privately.')).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw this follow-up consent' }).click();
  await expect(page.getByText('You withdrew this follow-up consent.')).toBeVisible();
});
test('I-18 deletion is independent of feedback and shows an accessible receipt after revoking the session', async ({
  page,
}) => {
  const a = await f.member(page);
  await page.goto('/settings');
  await page.getByLabel('I want to disable my account and request deletion.').check();
  await page.getByRole('button', { name: 'Request deletion', exact: true }).click();
  await expect(page).toHaveURL(/deletion-receipt/);
  await expect(page.getByText('Pending — deletion work is queued.')).toBeVisible();
  await axe(page);
  expect(
    (
      await f.admin.query(
        'SELECT 1 FROM identity.sessions WHERE member_id=$1 AND revoked_at IS NULL',
        [a.memberId],
      )
    ).rowCount,
  ).toBe(0);
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
});
test('I-12 I-20 operator metrics and safety-retention pages are accessible, audited and deny revoked staff', async ({
  page,
}) => {
  const staff = await f.member(page, true);
  await f.admin.query("INSERT INTO ops.staff(member_id,role) VALUES($1,'admin')", [staff.memberId]);
  await page.goto('/ops/metrics');
  await page.getByText('Record readiness evidence (administrator)', { exact: true }).click();
  await page
    .getByLabel('Evidence and review record')
    .fill('Synthetic accessibility review; launch remains disabled.');
  await page.getByRole('button', { name: 'Save reviewed evidence' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Review recorded.' })).toBeVisible();
  await page.getByRole('button', { name: 'Freeze new enrollment cohort' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enrollment is fixed' })).toBeVisible();
  await refreshMetrics(f.admin, f.accounts);
  await page.getByRole('button', { name: 'Refresh metrics' }).click();
  await expect(
    page.getByRole('table', { name: 'Configured evidence required before expansion' }).first(),
  ).toBeVisible();
  await axe(page);
  await page.goto('/ops/safety/retention');
  await expect(page.getByRole('heading', { name: 'Safety retention review' })).toBeVisible();
  await axe(page);
  await f.admin.query('DELETE FROM ops.staff WHERE member_id=$1', [staff.memberId]);
  expect((await page.request.get('/api/v1/ops/safety/retention')).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/v1/ops/metrics', {
        headers: { Origin: 'http://localhost:3100', 'Idempotency-Key': randomUUID() },
        data: { action: 'FREEZE' },
      })
    ).status(),
  ).toBe(403);
});
