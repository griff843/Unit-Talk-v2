import { expect, test } from '@playwright/test';

test('pick explorer paginates all operator picks and searches beyond a loaded page', async ({ page }) => {
  const raw = process.env.CC_EXPECTED_OPERATOR_PICKS;
  test.skip(!raw || Number(raw) <= 5 || Number(raw) > 100, 'Requires an independently counted small operator cohort spanning pages.');
  const total = Number(raw);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/picks?limit=5');
  const links = page.locator('tbody a[href^="/picks/"]');
  const all: Array<{ href: string | null; name: string | null }> = [];
  for (let current = 1; current <= Math.ceil(total / 5); current++) {
    await expect(page.getByRole('navigation', { name: 'Pick pages' })).toContainText(`Page ${current}`);
    await expect(page.getByRole('status')).toContainText(`of ${total} matching governed picks`);
    all.push(...await links.evaluateAll((nodes) => nodes.map((node) => ({ href: node.getAttribute('href'), name: node.textContent }))));
    if (current * 5 < total) await page.getByRole('link', { name: 'Next page', exact: true }).click();
  }
  expect(all).toHaveLength(total);
  expect(new Set(all.map((pick) => pick.href)).size).toBe(total);
  await expect(page.getByRole('link', { name: 'Next page', exact: true })).toHaveCount(0);
  const term = all[0]!.name!;
  const expected = all.filter((pick) => pick.name === term);
  await page.getByRole('textbox', { name: 'Search picks', exact: true }).fill(term);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Pick pages' })).toContainText('Page 1');
  await expect(links).toHaveCount(expected.length);
  expect((await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).sort()).toEqual(expected.map((pick) => pick.href).sort());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search picks', exact: true })).toHaveValue(term);
  await expect(links).toHaveCount(expected.length);
  await page.getByRole('textbox', { name: 'Search picks', exact: true }).fill('no-match,(selection.not.is.null),"quoted"');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('0 matching governed picks');
  await expect(page.getByText('Active picks unavailable', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const searchBox = await page.getByRole('textbox', { name: 'Search picks', exact: true }).boundingBox();
  expect(searchBox?.width).toBeGreaterThan(280);
  expect(errors).toEqual([]);
});
