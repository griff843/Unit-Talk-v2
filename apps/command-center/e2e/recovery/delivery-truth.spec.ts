import { expect, test } from '@playwright/test';

test('delivery shows scoped persisted records and every governed control', async ({ page }) => {
  const attempts = process.env.CC_EXPECTED_OPERATOR_ATTEMPTS;
  const receipts = process.env.CC_EXPECTED_OPERATOR_RECEIPTS;
  test.skip(attempts === undefined || receipts === undefined, 'Supply independently measured operator delivery counts.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/operations/outbox');
  await expect(page.getByRole('heading', { name: `Outbox Rows (${Math.min(Number(attempts), 100)})`, exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Load Failed');
  await page.goto('/operations/discord');
  const panel = page.locator('div.cc-surface').filter({ has: page.getByRole('heading', { name: 'Delivery Kill Switch', exact: true }) });
  for (const target of ['official-picks', 'best-bets', 'trader-insights', 'exclusive-insights']) {
    await expect(panel.getByText(target, { exact: true })).toBeVisible();
  }
  await expect(panel).toContainText('requires the owner’s authorization');
  await expect(page.getByRole('heading', { name: new RegExp(`last ${Math.min(Number(receipts), 500)} receipts`) })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Load Failed');
  expect(errors).toEqual([]);
});
