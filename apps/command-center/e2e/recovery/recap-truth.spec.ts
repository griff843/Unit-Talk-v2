import { expect, test } from '@playwright/test';

test('recap panel distinguishes verified Track Only absence from missing legacy delivery evidence', async ({ page }) => {
  const trackOnly = process.env.CC_RECAP_TRACK_ONLY_PICK_ID;
  const delivered = process.env.CC_RECAP_LEGACY_DELIVERED_PICK_ID;
  test.skip(!trackOnly || !delivered, 'Requires independently verified settled Track Only and legacy delivered picks.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/picks/${trackOnly}`);
  const panel = page.getByTestId('settlement-recap');
  await expect(page.getByRole('heading', { name: 'Correct Settlement', exact: true })).toBeVisible();
  await expect(panel.getByText('Not applicable', { exact: true })).toBeVisible();
  await expect(panel).toContainText('No delivery record, receipt or attempt exists');
  await page.goto(`/picks/${delivered}`);
  await expect(panel.getByText('Recap evidence unavailable', { exact: true })).toBeVisible();
  await expect(panel).toContainText('Older recap records cannot prove whether it posted');
  await expect(page.getByRole('heading', { name: 'Settlement Records', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
