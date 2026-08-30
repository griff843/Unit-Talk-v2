import { expect, test } from '@playwright/test';

const recoveryCatalog = {
  data: {
    sports: [{ id: 'NCAAF', name: 'NCAAF', marketTypes: ['moneyline'], statTypes: [], teams: [] }],
    sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }],
    ticketTypes: [],
    cappers: [],
  },
};

function encodeJwtPart(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('unauthenticated submit redirects to the Unit Talk Capper Portal', async ({ page }) => {
  await page.goto('/submit');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Unit Talk', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capper Portal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Operator recovery access', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Operator-issued recovery token')).toBeHidden();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/01-capper-portal-login.png', fullPage: true });
});

test('operator recovery token restores the authenticated capper form and identity', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(recoveryCatalog),
  }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [] }),
  }));

  await page.goto('/login');
  await page.locator('summary', { hasText: 'Operator recovery access' }).click();
  const token = `${encodeJwtPart({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPart({
    sub: 'capper-proof',
    capperId: 'capper-proof',
    displayName: 'Capper Proof',
    role: 'capper',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.proof-signature`;
  await page.getByLabel('Operator-issued recovery token').fill(token);
  await page.getByRole('button', { name: 'Use recovery token' }).click();

  await expect(page).toHaveURL(/\/submit$/);
  await expect(page.getByText('Capper Proof', { exact: true })).toBeVisible();
  await expect(page.getByText('capper-proof', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByText('Internal Tracking · Track Only', { exact: true })).toBeVisible();
});
