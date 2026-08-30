import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PROOF_DIR = resolve(process.cwd(), '../../docs/06_status/proof/UTV2-1788/screenshots');
mkdirSync(PROOF_DIR, { recursive: true });

const WORKFLOWS = [
  { label: 'Overview', href: '/', slug: 'overview' },
  { label: 'Review', href: '/review', slug: 'review' },
  { label: 'Active Picks', href: '/picks', slug: 'active-picks' },
  { label: 'Settlement', href: '/settlement', slug: 'settlement' },
  { label: 'Exceptions', href: '/exceptions', slug: 'exceptions' },
  { label: 'System Health', href: '/api-health', slug: 'system-health' },
] as const;

async function assertWorkflow(page: Page, workflow: typeof WORKFLOWS[number], viewport: 'desktop' | 'mobile') {
  await expect(page).toHaveURL(new RegExp(`${workflow.href === '/' ? '/$' : `${workflow.href}$`}`), { timeout: 25_000 });
  await expect(page.getByRole('heading', { level: 1, name: workflow.label })).toBeVisible({ timeout: 25_000 });
  if (viewport === 'mobile') {
    await page.waitForTimeout(250);
  }
  await page.screenshot({
    path: resolve(PROOF_DIR, `${viewport}-${workflow.slug}.png`),
    fullPage: true,
  });
}

test('desktop sidebar navigates through all six primary workflows', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await assertWorkflow(page, WORKFLOWS[0], 'desktop');

  for (const workflow of WORKFLOWS.slice(1)) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: workflow.label, exact: true }).click();
    await assertWorkflow(page, workflow, 'desktop');
  }
});

test('mobile drawer navigates through all six primary workflows', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await assertWorkflow(page, WORKFLOWS[0], 'mobile');

  for (const workflow of WORKFLOWS.slice(1)) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: workflow.label, exact: true }).click();
    await assertWorkflow(page, workflow, 'mobile');
  }
});
