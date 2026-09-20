import { expect, test } from '@playwright/test';

// This suite must start exactly like the operator: no pre-authenticated context,
// injected Authorization header or storage state.
test.use({ extraHTTPHeaders: {}, storageState: { cookies: [], origins: [] } });
const username = process.env.CC_BROWSER_USERNAME;
const password = process.env.CC_BROWSER_PASSWORD;
test.skip(!username || !password, 'Set browser credentials for the intended preview/staging target.');

test('visible sign-in, deep link, reload, navigation, phone and sign-out', async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/picks');
  expect(response?.status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Sign in to Command Center' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill(username!);
  await page.getByLabel('Password', { exact: true }).fill('deliberately-wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted');
  expect((await context.cookies()).find((cookie) => cookie.name === 'cc_operator_session')).toBeUndefined();

  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('operator-identity')).toBeVisible();
  await expect(page.getByTestId('operator-identity')).not.toHaveText('Identity unavailable');
  await expect(page.locator('main')).toContainText('Active Picks');
  const session = (await context.cookies()).find((cookie) => cookie.name === 'cc_operator_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Strict');

  await page.reload();
  await expect(page.getByTestId('operator-identity')).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'Exceptions', exact: true }).click();
  await expect(page).toHaveURL(/\/exceptions$/);
  await expect(page.locator('main')).toContainText('Exceptions');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/picks');
  await expect(page.locator('main')).toContainText('Active Picks');
  const sidebar = await page.locator('aside.cc-sidebar').boundingBox();
  expect(sidebar ? sidebar.x + sidebar.width : 0).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('picks-phone.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Command Center' })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === 'cc_operator_session')).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a forged or removed session returns the browser to sign-in', async ({ page, context }) => {
  await page.goto('/picks');
  await page.getByLabel('Username', { exact: true }).fill(username!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('operator-identity')).toBeVisible();
  const session = (await context.cookies()).find((cookie) => cookie.name === 'cc_operator_session');
  expect(session).toBeDefined();
  await context.addCookies([{ ...session!, value: 'forged.operator.session' }]);
  const refused = await page.reload();
  expect(refused?.status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Sign in to Command Center' })).toBeVisible();
  await expect(page.getByTestId('operator-identity')).toHaveCount(0);
});
