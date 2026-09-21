import { expect, test } from '@playwright/test';

const expectedRecords = process.env.CC_EXPECTED_GOVERNED_SETTLEMENTS;
const expectedPosted = process.env.CC_EXPECTED_GOVERNED_POSTED;
const expectedCorrections = process.env.CC_EXPECTED_GOVERNED_CORRECTIONS;
const expectedAwaiting = process.env.CC_EXPECTED_DELIVERED_UNSETTLED;

test('settlement rows and summary counts reconcile with independently measured operator data', async ({ page }) => {
  test.skip([expectedRecords, expectedPosted, expectedCorrections, expectedAwaiting].some((value) => value === undefined),
    'Provide independent database population counts for this read-only acceptance run.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settlement');
  await expect(page.getByText('Only governed operator picks are included; test fixtures are excluded.', { exact: false })).toBeVisible();
  for (const [label, value] of [
    ['Corrections', expectedCorrections], ['Stuck Posted', expectedPosted],
    ['Delivered — Awaiting Settlement', expectedAwaiting],
  ]) {
    const card = page.locator('article').filter({ has: page.getByText(label!, { exact: true }) });
    await expect(card.getByText(Number(value).toLocaleString('en-US'), { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: `Recent Settlement Records (${Math.min(Number(expectedRecords), 50)} shown)`, exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('PROOF');
  await expect(page.locator('main')).not.toContainText('INVARIANT');
  await expect(page.locator('main')).not.toContainText('src/lib/');
  if (Number(expectedRecords) > 0) {
    await expect(page.getByRole('link', { name: 'Correct settlement', exact: true }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});
