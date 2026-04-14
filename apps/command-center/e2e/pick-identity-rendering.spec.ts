import { expect, test } from '@playwright/test';

test('picks list renders operator-facing bet identity columns', async ({ page }) => {
  await page.goto('/picks-list');

  await expect(page.getByRole('columnheader', { name: 'Bet' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Result' })).toBeVisible();

  const firstRow = page.locator('tbody tr').first();
  if (await firstRow.count()) {
    await expect(firstRow.locator('td').first()).toBeVisible();
    await expect(firstRow.locator('a[href^="/picks/"]').first()).toBeVisible();
  }
});

test('exceptions page renders the upgraded operator sections', async ({ page }) => {
  await page.goto('/exceptions');

  await expect(page.getByText('Exception Operations')).toBeVisible();
  await expect(page.getByText('Approval Drift', { exact: true })).toBeVisible();
  await expect(page.getByText('Missing Books', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Rerun \/ Override Candidates/i })).toBeVisible();
});

test('pick detail renders the identity summary cards', async ({ page }) => {
  await page.goto('/picks/12581d11-6433-42d1-b7bc-d8c3a17c819f');

  await expect(page.getByText('Submission Details')).toBeVisible();
  await expect(page.locator('p', { hasText: 'Lifecycle' }).first()).toBeVisible();
  await expect(page.locator('p', { hasText: 'Approval' }).first()).toBeVisible();
  await expect(page.locator('p', { hasText: 'Promotion' }).first()).toBeVisible();
  await expect(page.getByText('Settlement Records')).toBeVisible();
});
