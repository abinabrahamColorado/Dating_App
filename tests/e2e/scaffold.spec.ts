import { test, expect } from '@playwright/test';
test('M0 scaffold renders and links to the versioned liveness endpoint', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Meetwell' })).toBeVisible();
  await expect(page.getByText('M0 · ENGINEERING SCAFFOLD')).toBeVisible();
  const link = page.getByRole('link', { name: 'Check process health' });
  await link.focus();
  await expect(link).toBeFocused();
  const response = await page.request.get('/api/v1/health');
  expect(await response.json()).toEqual({ status: 'ok', service: 'web' });
});
