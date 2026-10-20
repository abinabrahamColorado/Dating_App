import { test, expect } from '@playwright/test';
test('Public home and versioned liveness endpoint expose no member or environment data', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Room for something real.' })).toBeVisible();
  const link = page.getByRole('link', { name: 'Find your starting point' });
  await link.focus();
  await expect(link).toBeFocused();
  const response = await page.request.get('/api/v1/health');
  expect(await response.json()).toEqual({ status: 'ok', service: 'web' });
});
