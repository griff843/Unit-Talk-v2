import { expect, test } from '@playwright/test';

const dataset = process.env.CC_SETTLEMENT_TRUTH_DATASET;
const expectedRecords = process.env.CC_EXPECTED_GOVERNED_SETTLEMENTS;
const expectedManualReview = process.env.CC_EXPECTED_GOVERNED_MANUAL_REVIEW;
const expectedCorrections = process.env.CC_EXPECTED_GOVERNED_CORRECTIONS;
const expectedEffectivePick = process.env.CC_EXPECTED_EFFECTIVE_SETTLEMENT_PICK;
const expectedEffectiveResult = process.env.CC_EXPECTED_EFFECTIVE_SETTLEMENT_RESULT;

test('named runtime dataset presents one settlement truth across operator surfaces', async ({ page }) => {
  test.skip(
    [dataset, expectedRecords, expectedManualReview, expectedCorrections].some((value) => value === undefined),
    'Provide the named sanctioned dataset and independently measured governed counts.',
  );
  const records = Number(expectedRecords);
  const manualReview = Number(expectedManualReview);
  const corrections = Number(expectedCorrections);
  const pageSize = 25;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  test.info().annotations.push({ type: 'dataset', description: dataset! });
  const effectiveSettlements = () => page.getByRole('heading', {
    name: /Current Effective Settlements/,
  }).locator('..');

  await page.goto('/settlement');
  await expect(page.getByText('Only governed operator picks are included; test fixtures are excluded.', { exact: false })).toBeVisible();
  for (const [label, value] of [
    ['Manual Review Open', manualReview], ['Corrections', corrections],
  ] as const) {
    const card = page.locator('article').filter({ has: page.getByText(label, { exact: true }) });
    await expect(card.getByText(value.toLocaleString('en-US'), { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', {
    name: `Current Effective Settlements (${Math.min(records, pageSize)} shown of ${records.toLocaleString('en-US')})`,
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settlement pages' })).toContainText(
    `Page 1 of ${Math.max(1, Math.ceil(records / pageSize))} · ${records.toLocaleString('en-US')} records`,
  );

  if (records > pageSize) {
    const firstPageIds = await effectiveSettlements().locator('a[href^="/picks/"]').evaluateAll(
      (links) => links.map((link) => link.getAttribute('href')),
    );
    await page.getByRole('navigation', { name: 'Settlement pages' }).getByRole('link', { name: 'Next page' }).click();
    await expect(page.getByRole('navigation', { name: 'Settlement pages' })).toContainText('Page 2 of');
    const secondPageIds = await effectiveSettlements().locator('a[href^="/picks/"]').evaluateAll(
      (links) => links.map((link) => link.getAttribute('href')),
    );
    assertNoOverlap(firstPageIds, secondPageIds);
  }

  if (expectedEffectivePick && expectedEffectiveResult) {
    await page.goto('/settlement');
    const row = effectiveSettlements().locator('tr').filter({
      has: page.locator(`a[href="/picks/${expectedEffectivePick}"]`),
    });
    await expect(row).toContainText(expectedEffectiveResult);
  }

  await page.goto('/exceptions');
  if (manualReview > 0) {
    await expect(page.getByText(`${manualReview} settlements in manual review`, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText(/settlements in manual review/)).toHaveCount(0);
  }

  await page.goto('/');
  const overviewCard = page.locator('article').filter({ has: page.getByText('Settlement review', { exact: true }) });
  await expect(overviewCard.getByText(manualReview.toLocaleString('en-US'), { exact: true })).toBeVisible();

  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Ingest through publish' })).toBeVisible();
  await expect(page.getByText('Stage-flow signals unavailable', { exact: false })).toHaveCount(0);
  await expect(page.locator('aside').first()).toBeVisible();

  console.log(JSON.stringify({
    dataset,
    settlement: { effectiveRecords: records, manualReview, corrections },
    exceptions: { manualReview },
    overview: { manualReview },
    pipeline: { dashboardRead: 'available' },
    sidebar: { settlementBadge: 'not-present-in-current-navigation' },
  }));
  expect(errors).toEqual([]);
});

function assertNoOverlap(left: Array<string | null>, right: Array<string | null>) {
  const leftSet = new Set(left.filter((value): value is string => value !== null));
  assert(leftSet.size > 0, 'first settlement page should expose pick links');
  for (const value of right) {
    if (value !== null && leftSet.has(value)) throw new Error(`duplicate settlement row across pages: ${value}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
