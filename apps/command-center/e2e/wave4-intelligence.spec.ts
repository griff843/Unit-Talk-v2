import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════════
// Wave 4 — Intelligence Layer Verification
//
// Contract: Command Center Wave 4 Contract
//
// These tests run without a live operator-web — when the upstream is unreachable,
// the pages render gracefully with empty/fallback states. The tests verify that
// all Wave 4 surfaces load, render the correct structural elements, and do not
// crash regardless of data availability.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Navigation ────────────────────────────────────────────────────────────────

test.describe('Wave 4 Navigation', () => {
  test('nav contains Intelligence link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Intelligence' })).toBeVisible();
  });

  test('Intelligence link navigates to /intelligence', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Intelligence' });
    await expect(link).toHaveAttribute('href', '/intelligence');
  });

  test('all prior nav links still present', async ({ page }) => {
    await page.goto('/');
    const expectedLinks = ['Dashboard', 'Picks', 'Review', 'Held', 'Exceptions', 'Performance', 'Intelligence', 'Decisions', 'Audit'];
    for (const label of expectedLinks) {
      await expect(page.getByRole('link', { name: label })).toBeVisible();
    }
  });
});

// ── Performance Page (Wave 4A extensions) ─────────────────────────────────────

test.describe('Wave 4A — Extended Performance', () => {
  test('performance page loads without crash', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('TypeError');
    await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible();
  });

  test('shows time window cards', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.getByText('Today')).toBeVisible();
    await expect(page.getByText('Last 7 Days')).toBeVisible();
    await expect(page.getByText('Last 30 Days')).toBeVisible();
    await expect(page.getByText('Month to Date')).toBeVisible();
  });

  test('shows Capper vs System section', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.getByText('Capper vs System')).toBeVisible();
  });

  test('shows Decision Outcomes section', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.getByText('Decision Outcomes')).toBeVisible();
  });

  test('shows capper leaderboard', async ({ page }) => {
    await page.goto('/performance');
    await expect(page.getByText('Capper Leaderboard')).toBeVisible();
  });

  test('no database references exposed', async ({ page }) => {
    await page.goto('/performance');
    const html = await page.content();
    expect(html).not.toContain('SUPABASE_URL');
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(html).not.toContain('postgresql://');
  });
});

// ── Intelligence Page (Wave 4B/C/D) ──────────────────────────────────────────

test.describe('Wave 4B — Intelligence page loads', () => {
  test('intelligence page loads at /intelligence', async ({ page }) => {
    await page.goto('/intelligence');
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('TypeError');
    await expect(page.getByRole('heading', { name: 'Intelligence' })).toBeVisible();
  });

  test('intelligence page renders fallback when data unavailable', async ({ page }) => {
    await page.goto('/intelligence');
    // Either shows full data or the "Unable to load" fallback — both are valid
    const body = await page.content();
    const valid =
      body.includes('Recent Form') ||
      body.includes('Unable to load intelligence data');
    expect(valid).toBe(true);
  });
});

test.describe('Wave 4C — Score Quality', () => {
  test('intelligence page does not crash', async ({ page }) => {
    await page.goto('/intelligence');
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('TypeError');
  });
});

test.describe('Wave 4D — Decision Quality', () => {
  test('intelligence page does not crash', async ({ page }) => {
    await page.goto('/intelligence');
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('TypeError');
  });
});

// ── Authority Model ──────────────────────────────────────────────────────────

test.describe('Wave 4 Authority Model', () => {
  test('intelligence page does not expose database credentials', async ({ page }) => {
    await page.goto('/intelligence');
    const html = await page.content();
    expect(html).not.toContain('SUPABASE_URL');
    expect(html).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(html).not.toContain('postgresql://');
    expect(html).not.toContain('supabase.co');
    expect(html).not.toContain('INSERT INTO');
  });
});

// ── All Pages Still Load ─────────────────────────────────────────────────────

test.describe('Wave 4 — All pages render without crash', () => {
  const allPages = [
    '/',
    '/picks-list',
    '/review',
    '/held',
    '/exceptions',
    '/performance',
    '/intelligence',
    '/decisions',
    '/interventions',
    '/picks/test-pick',
  ];

  for (const route of allPages) {
    test(`${route} renders without crash`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('body')).not.toContainText('TypeError');
      // Header should always be visible
      await expect(page.getByText('Unit Talk')).toBeVisible();
    });
  }
});
