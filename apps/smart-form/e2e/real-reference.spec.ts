import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';
const proofDirectory = '../../docs/06_status/proof/UTV2-1787';

async function installCapperSession(page: Page) {
  await page.addInitScript(() => {
    const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    localStorage.setItem('ut_capper_token', `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: 'griff843', capperId: 'griff843', displayName: 'Griff Test', role: 'capper',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.test-signature`);
  });
}

async function readRows(
  request: APIRequestContext,
  path: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await request.get(`${apiBaseUrl}${path}`);
  expect(response.status(), `Expected ${path} to return HTTP 200`).toBe(200);
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return payload.data ?? [];
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { name: 'Griff Test' },
      capperId: 'griff843',
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  }));
  await installCapperSession(page);
});

test('real-reference UI reports the connected environment honestly without route interception', async ({ page }) => {
  await page.goto('/submit');
  await expect(page.getByRole('heading', { name: 'Canonical pick entry' })).toBeVisible();
  await page.screenshot({ path: `${proofDirectory}/real-01-authenticated-shell.png`, fullPage: true });

  await page.getByRole('button', { name: 'NBA', exact: true }).click();
  await expect(page.getByTestId('canonical-matchup-builder')).toBeVisible();
  await expect(page.getByLabel('Away Team')).toBeVisible();
  await expect(page.getByLabel('Home Team')).toBeVisible();
  await page.screenshot({ path: `${proofDirectory}/real-02-primary-workflow.png`, fullPage: true });
  await page.getByLabel('Away Team').focus();
  await page.screenshot({ path: `${proofDirectory}/real-03-away-search.png`, fullPage: true });
  await page.getByLabel('Home Team').focus();
  await page.screenshot({ path: `${proofDirectory}/real-04-home-search.png`, fullPage: true });

  const availabilityResponse = await page.request.get(
    `${apiBaseUrl}/api/reference-data/availability?sport=NBA`,
  );
  expect(availabilityResponse.status()).toBe(200);
  const availability = await availabilityResponse.json() as {
    data?: { teamsAvailable?: boolean };
  };
  const lakersRows = await readRows(
    page.request,
    '/api/reference-data/search/teams?sport=NBA&q=Lakers',
  );

  await page.getByLabel('Away Team').fill('Lakers');
  if (availability.data?.teamsAvailable === false) {
    await expect(page.getByTestId('canonical-team-data-unavailable')).toBeVisible();
    await expect(page.getByText(
      'Canonical NBA team data is not available in this environment yet.',
      { exact: true },
    )).toBeVisible();
  } else if (lakersRows.length === 0) {
    await expect(page.getByText('No canonical team found for “Lakers”.', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: /Lakers/i }).last()).toBeVisible();
  }
  await page.screenshot({ path: `${proofDirectory}/real-05-reference-unavailable-state.png`, fullPage: true });

  await page.getByRole('button', { name: /Player Prop/i }).first().click();
  await expect(page.getByLabel('Team', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Player', { exact: true })).toBeDisabled();
  await page.screenshot({ path: `${proofDirectory}/real-06-team-player-dependency.png`, fullPage: true });

  await expect(page.getByTestId('coverage-gap-manual-entry')).toHaveCount(0);
  await expect(page.getByText('Manual participant override', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${proofDirectory}/real-07-coverage-gap-gated.png`, fullPage: true });

  await expect(page.getByText('Internal Tracking · Track Only', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${proofDirectory}/real-08-track-only.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${proofDirectory}/real-09-mobile.png`, fullPage: true });
});

test('real-reference canonical team-to-player acceptance', async ({ page, request }) => {
  const [lakers, lebron] = await Promise.all([
    readRows(request, '/api/reference-data/search/teams?sport=NBA&q=Lakers'),
    readRows(request, '/api/reference-data/search/players?sport=NBA&q=LeBron'),
  ]);

  const missing = [
    lakers.length === 0 ? 'NBA team query Lakers' : null,
    lebron.length === 0 ? 'NBA player query LeBron' : null,
  ].filter((value): value is string => value !== null);

  test.skip(
    missing.length > 0,
    `UTV2-1775 blocker: connected canonical reference data is missing ${missing.join(', ')}. No reference-data routes were intercepted.`,
  );

  await page.goto('/submit');
  await page.getByRole('button', { name: 'NBA', exact: true }).click();
  await page.getByRole('button', { name: /Player Prop/i }).first().click();
  await page.getByLabel('Team', { exact: true }).fill('Lakers');
  await page.getByRole('button', { name: /Lakers/i }).last().click();
  await expect(page.getByLabel('Player', { exact: true })).toBeEnabled();
  await page.getByLabel('Player', { exact: true }).fill('LeBron');
  await expect(page.getByRole('button', { name: /LeBron/i })).toBeVisible();
  await page.screenshot({ path: `${proofDirectory}/real-10-team-player-cascade.png`, fullPage: true });
});

test('real-reference named query audit uses the connected API', async ({ request }) => {
  const [lakers, lebron, harden, ncaaf] = await Promise.all([
    readRows(request, '/api/reference-data/search/teams?sport=NBA&q=Lakers'),
    readRows(request, '/api/reference-data/search/players?sport=NBA&q=LeBron'),
    readRows(request, '/api/reference-data/search/players?sport=NBA&q=James%20Harden'),
    readRows(request, '/api/reference-data/search/teams?sport=NCAAF&q=TCU'),
  ]);

  console.log(JSON.stringify({
    source: 'connected-api-no-reference-route-interception',
    counts: {
      nbaLakers: lakers.length,
      nbaLeBron: lebron.length,
      nbaJamesHarden: harden.length,
      ncaafTcu: ncaaf.length,
    },
  }));
});
