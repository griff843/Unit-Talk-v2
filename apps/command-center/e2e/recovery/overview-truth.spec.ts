import { expect, test } from '@playwright/test';

test('overview shows exact scoped counts and stays usable when runtime health is unavailable', async ({ page }) => {
  const total = process.env.CC_EXPECTED_OPERATOR_PICKS;
  test.skip(total === undefined || process.env.CC_EXPECT_RUNTIME_UNAVAILABLE !== 'true', 'Requires independently measured picks and a read-only preview with its runtime endpoint unavailable.');
  const errors: string[] = [];
  const speculativeReads: string[] = [];
  page.on('request', (request) => {
    if (request.headers()['next-router-prefetch']) speculativeReads.push(new URL(request.url()).pathname);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/', { waitUntil: 'commit' });
  const metrics = page.getByRole('region', { name: 'Operator counts', exact: true });
  await expect(metrics).toBeVisible({ timeout: 4_000 });
  const count = metrics.locator('article').filter({ has: page.getByText('Governed picks', { exact: true }) });
  await expect(count.getByText(Number(total).toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent lifecycle activity', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Delivery queue', exact: true })).toBeVisible();
  await expect(page.getByText('No unsent operator delivery records.', { exact: false })).toBeVisible();
  await expect(page.getByText('Unknown — the configured runtime health endpoint could not be verified.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(metrics).toBeVisible();
  await expect(page.locator('main')).not.toContainText('UTV2-');
  await expect(page.locator('main')).not.toContainText('PROOF');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(metrics).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(speculativeReads).toEqual([]);
  expect(errors).toEqual([]);
});
