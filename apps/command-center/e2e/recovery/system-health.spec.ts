import { expect, test } from '@playwright/test';

test('system health shows provider source windows and isolates unavailable runtime on desktop and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/api-health');
  const providers = page.getByRole('region', { name: 'Provider telemetry' });
  await expect(providers).toBeVisible();
  await expect(providers.getByRole('heading', { name: 'SGO', exact: true })).toBeVisible();
  await expect(providers.getByRole('heading', { name: 'Odds API', exact: true })).toBeVisible();
  await expect(providers.getByText('Requests recorded · 24h', { exact: true })).toHaveCount(2);
  await expect(providers).toContainText('Offer freshness threshold: 30 minutes');
  await expect(providers).toContainText('it is not an HTTP response-time measurement');
  await expect(providers).not.toContainText('Calls Today');
  await expect(providers).not.toContainText('24h Response Trend');
  if (process.env.CC_EXPECT_RUNTIME_UNAVAILABLE === 'true') {
    await expect(page.getByText('Runtime truth unavailable:', { exact: false })).toBeVisible();
  }
  if (process.env.CC_EXPECTED_PROVIDER_TELEMETRY) {
    const expected = JSON.parse(process.env.CC_EXPECTED_PROVIDER_TELEMETRY) as { providers: Array<{ provider: string; totalOffers: number; createdOffers24h: number; latestOfferAt: string | null }> };
    for (const row of expected.providers) {
      const card = providers.locator('article').filter({ has: page.getByRole('heading', { name: row.provider === 'sgo' ? 'SGO' : 'Odds API', exact: true }) }).locator('..');
      await expect(card).toContainText(`Current offers: ${row.totalOffers.toLocaleString('en-US')} · created in 24h: ${row.createdOffers24h.toLocaleString('en-US')}`);
      await expect(card).toContainText(`Latest offer observation: ${row.latestOfferAt ?? 'Unavailable'}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(providers).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
