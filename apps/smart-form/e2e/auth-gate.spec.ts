import { expect, test } from '@playwright/test';

// UTV2-1786 — authentication gate acceptance.
//
// The version of this spec inherited from PR #1462 asserted the opposite of
// what this lane requires: it forged a token whose signature was the literal
// string "proof-signature", pasted it into the recovery field, and asserted
// that /submit then rendered as that capper. That is the client-stored-claim
// bypass the Definition of Done requires be refused, encoded as a passing
// test. These tests assert the refusal instead.

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

/** A structurally valid, cryptographically worthless capper token. */
function forgedCapperToken(capperId: string, displayName: string) {
  return [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      sub: capperId,
      capperId,
      displayName,
      role: 'capper',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    'not-a-real-signature',
  ].join('.');
}

test('unauthenticated submit redirects to the Unit Talk Capper Portal', async ({ page }) => {
  await page.goto('/submit');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Unit Talk', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Capper Portal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Operator recovery access', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Operator-issued recovery token')).toBeHidden();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1786/01-capper-portal-login.png', fullPage: true });
});

test('a forged capper token stored in localStorage does not open /submit', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(recoveryCatalog),
  }));

  await page.goto('/login');
  await page.evaluate((token) => {
    localStorage.setItem('ut_capper_token', token);
  }, forgedCapperToken('forged-capper', 'Forged Capper'));

  await page.goto('/submit');

  // The gate waits for authoritative session resolution and then refuses.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Forged Capper')).toHaveCount(0);
  await expect(page.getByText('forged-capper')).toHaveCount(0);
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1786/02-forged-claim-refused.png', fullPage: true });
});

test('storing a recovery token does not sign the operator in', async ({ page }) => {
  await page.goto('/login');
  await page.locator('summary', { hasText: 'Operator recovery access' }).click();
  await page.getByLabel('Operator-issued recovery token').fill(
    forgedCapperToken('capper-proof', 'Capper Proof'),
  );
  await page.getByRole('button', { name: 'Store recovery token' }).click();

  // The token is saved for API bearer use, but the operator stays on /login:
  // it is not an identity this client can verify.
  await expect(page.getByTestId('recovery-token-stored')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Capper Portal' })).toBeVisible();

  const storedToken = await page.evaluate(() => localStorage.getItem('ut_capper_token'));
  expect(storedToken).toBeTruthy();

  // And it still does not open /submit.
  await page.goto('/submit');
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1786/03-recovery-token-stored-not-signed-in.png', fullPage: true });
});
