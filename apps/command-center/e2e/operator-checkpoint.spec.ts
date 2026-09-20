import assert from 'node:assert/strict';
import { test } from '@playwright/test';

// Opt-in read-only browser acceptance against a configured operator instance.
// Never submits a settlement, review decision, or delivery action.
test('operator can open a real pick and inspect its recorded history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/picks');
  const link = page.locator('a[href^="/picks/"]').first();
  await link.waitFor({ state: 'visible' });
  await link.click();
  await page.getByText('Lifecycle Transitions', { exact: true }).waitFor();
  const text = await page.innerText('body');
  assert.match(text, /Promotion State/i);
  assert.match(text, /Discord Delivery Status/i);
  assert.match(text, /Settlement Records/i);
  assert.match(text, /Audit Trail/i);
  assert.doesNotMatch(text, /Pick detail unavailable|column .* does not exist/i);
  assert.deepEqual(errors, []);
});

test('Track Only history shows verified non-delivery', async ({ page }) => {
  const pickId = process.env.CC_TRACK_ONLY_PICK_ID;
  test.skip(!pickId, 'Supply CC_TRACK_ONLY_PICK_ID for the target environment');
  await page.goto(`/picks/${pickId}`);
  await page.getByText('Verified: no outbox row, no receipt, no delivery attempt.', { exact: true }).waitFor();
  assert.match(await page.innerText('body'), /Lifecycle Transitions/i);
});

test('non-governed diagnostics show authoritative totals', async ({ page }) => {
  const expected = process.env.CC_EXPECTED_NON_GOVERNED_TOTAL;
  test.skip(!expected, 'Supply an independently verified diagnostic total');
  await page.goto('/exceptions?deliveryPopulation=non-governed');
  await page.getByText(new RegExp(`${expected} rows are outside`)).waitFor();
});
