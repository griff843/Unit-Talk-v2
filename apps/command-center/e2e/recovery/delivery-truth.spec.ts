import { expect, test } from '@playwright/test';

test('delivery shows scoped persisted records and every governed control', async ({ page }) => {
  const attempts = process.env.CC_EXPECTED_OPERATOR_ATTEMPTS;
  const receipts = process.env.CC_EXPECTED_OPERATOR_RECEIPTS;
  test.skip(attempts === undefined || receipts === undefined, 'Supply independently measured operator delivery counts.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/operations/outbox');
  await expect(page.getByRole('heading', { name: `Outbox Rows (${Math.min(Number(attempts), 25)} shown of ${Number(attempts).toLocaleString('en-US')})`, exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Load Failed');
  await expect(page.getByRole('navigation', { name: 'Outbox pages' })).toContainText(`${Number(attempts).toLocaleString('en-US')} records`);
  await expect(page.getByRole('navigation', { name: 'Receipt pages' })).toContainText(`${Number(receipts).toLocaleString('en-US')} records`);
  await page.goto('/operations/outbox?page=10000&receiptPage=10000&status=sent');
  await expect(page.getByText('No outbox rows match this filter.', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Outbox pages' }).getByRole('link', { name: 'Previous page' }).click();
  await expect(page).toHaveURL(/status=sent/);
  await expect(page.getByRole('heading', { name:  /Outbox Rows \(.*shown of/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Receipt pages' }).getByRole('link', { name: 'Previous page' }).click();
  await expect(page.getByRole('navigation', { name: 'Receipt pages' })).toContainText('Page 1');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
