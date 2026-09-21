import { expect, test } from '@playwright/test';

test('performance record and capper reconcile with independent settlement-plane totals', async ({ page }) => {
  const raw = process.env.CC_EXPECTED_PERFORMANCE;
  test.skip(!raw, 'Supply an independently measured performance record.');
  const expected = JSON.parse(raw!) as { total: number; wins: number; losses: number; pushes: number; unsettled: number; unitsStaked: number; unitsReturned: number; unitsNet: number; capper: string };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/performance');
  await expect(page.getByRole('heading', { name: 'Unit Talk aggregate', exact: true })).toBeVisible();
  const aggregate = page.getByRole('article', { name: 'All governed picks', exact: true });
  const capper = page.getByRole('article', { name: expected.capper, exact: true });
  for (const record of [aggregate, capper]) {
    await expect(record.getByTestId('performance-record')).toHaveText(`${expected.wins} / ${expected.losses} / ${expected.pushes}`);
    await expect(record.getByTestId('performance-staked')).toHaveText(`${expected.unitsStaked.toFixed(2)}u`);
    await expect(record.getByTestId('performance-returned')).toHaveText(`${expected.unitsReturned.toFixed(2)}u`);
    await expect(record.getByTestId('performance-net')).toHaveText(`${expected.unitsNet.toFixed(2)}u`);
    await expect(record.locator('dt').filter({ hasText: /^Picks in record$/ }).locator('+ dd')).toHaveText(String(expected.total));
    await expect(record.locator('dt').filter({ hasText: /^Unsettled$/ }).locator('+ dd')).toHaveText(String(expected.unsettled));
  }
  await expect(page.getByRole('article', { name: 'Track Only · internal evidence', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('volume thresholds are not configured');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(aggregate).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('navigation', { name: 'Performance window', exact: true }).getByRole('link', { name: '7 days', exact: true }).click();
  await expect(page).toHaveURL(/window=7/);
  await expect(aggregate).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Performance unavailable');
  expect(errors).toEqual([]);
});
