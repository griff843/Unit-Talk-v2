/**
 * UTV2-1522 QA sweep — Playwright-driven visual/functional pass over EVERY
 * Command Center page route, enumerated from the filesystem (src/app/…/page.tsx)
 * so coverage cannot drift from the route tree.
 *
 * Per route: assert HTTP 200 (after redirects), no uncaught page errors, zero
 * console errors, no visible "undefined"/"NaN"/"[object Object]" text, a
 * rendered h1, non-blank body; console warning counts are reported. Captures a
 * full-page 1600x1000 dark-theme screenshot per non-redirected surface.
 *
 * Also runs interaction probes: command palette open+jump, pick-builder empty
 * submit validation, and a picks-explorer filter toggle. The pick-detail
 * drill-in is mandatory: if no pick id can be resolved from /picks the sweep
 * FAILS with an explicit SKIPPED row.
 *
 * Usage (dev server on :4300, local.env sourced for auth):
 *   tsx scripts/qa-sweep.ts [--out <screenshot-dir>]
 */
import { chromium, type Page } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:4300';
const OUT_DIR =
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]!
    : path.resolve(process.cwd(), '../../docs/06_status/proof/UTV2-1522/screenshots');

const AUTH_TOKEN =
  process.env.UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN || process.env.COMMAND_CENTER_AUTH_TOKEN;

/** Routes that are intentionally thin redirects to a v2 surface. */
const REDIRECT_ROUTES = new Set([
  '/decisions', '/held', '/exceptions', '/interventions', '/picks-list', '/research',
  '/research/hit-rate', '/research/matchups', '/ops', '/agents', '/burn-in', '/runtime-dashboard',
]);

function enumerateRoutes(): string[] {
  const out = execSync('find src/app -name page.tsx', { encoding: 'utf8' });
  return out
    .trim()
    .split('\n')
    .map((file) => file.replace(/^src\/app/, '').replace(/\/page\.tsx$/, '') || '/')
    .filter((route) => !route.includes('[')) // dynamic routes handled by the drill-in probe
    .sort();
}

function routeName(route: string): string {
  return route === '/' ? 'root' : route.slice(1).replace(/\//g, '-');
}

interface SweepResult {
  route: string;
  status: number | 'ERR' | 'SKIPPED';
  consoleErrors: string[];
  consoleWarnings: number;
  pageErrors: string[];
  suspectText: string[];
  hasHeader: boolean;
  notes: string[];
}

const SUSPECT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'undefined', re: /(^|[\s>:,(])undefined([\s<.,)]|$)/ },
  { label: 'NaN', re: /(^|[\s>:,(])NaN([\s<.,)%]|$)/ },
  { label: '[object Object]', re: /\[object Object\]/ },
];

function isPass(result: SweepResult): boolean {
  return (
    result.status === 200 &&
    result.consoleErrors.length === 0 &&
    result.pageErrors.length === 0 &&
    result.suspectText.length === 0 &&
    result.hasHeader &&
    result.notes.length === 0
  );
}

async function sweepRoute(page: Page, route: string, screenshotName: string | null): Promise<SweepResult> {
  const consoleErrors: string[] = [];
  let consoleWarnings = 0;
  const pageErrors: string[] = [];

  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings += 1;
  };
  const onPageError = (err: Error) => pageErrors.push(err.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let status: number | 'ERR' = 'ERR';
  const notes: string[] = [];
  const suspectText: string[] = [];
  let hasHeader = false;

  try {
    const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 90_000 });
    status = response?.status() ?? 'ERR';
    await page.waitForTimeout(600);

    const bodyText = await page.innerText('body');
    for (const { label, re } of SUSPECT_PATTERNS) {
      if (re.test(bodyText)) suspectText.push(label);
    }
    hasHeader = (await page.locator('h1').count()) > 0;
    if (!hasHeader) notes.push('no h1 header rendered');
    if (bodyText.trim().length < 40) notes.push('page appears blank');

    if (screenshotName) {
      await page.screenshot({ path: path.join(OUT_DIR, `${screenshotName}.png`), fullPage: true });
    }
  } catch (error) {
    notes.push(`navigation failed: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return { route, status, consoleErrors, consoleWarnings, pageErrors, suspectText, hasHeader, notes };
}

async function interactionProbes(page: Page): Promise<SweepResult[]> {
  const results: SweepResult[] = [];

  const probe = async (label: string, run: () => Promise<void>) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const onConsole = (msg: { type(): string; text(): string }) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    const onPageError = (err: Error) => pageErrors.push(err.message);
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    const notes: string[] = [];
    try {
      await run();
    } catch (error) {
      notes.push(`${label} failed: ${(error as Error).message.split('\n')[0]}`);
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
    results.push({
      route: `probe:${label}`,
      status: notes.length === 0 ? 200 : 'ERR',
      consoleErrors,
      consoleWarnings: 0,
      pageErrors,
      suspectText: [],
      hasHeader: true,
      notes,
    });
  };

  // 1. Command palette: open with Ctrl+K, type, jump.
  await probe('palette-jump', async () => {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.keyboard.press('Control+k');
    const input = page.getByLabel('Search surfaces');
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    await input.fill('fire');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/fire-board', { timeout: 15_000 });
  });

  // 2. Pick builder: with an empty form the submit action must be disabled
  // and the readiness checklist must name the missing fields (fail-closed UX).
  await probe('pick-builder-empty-submit', async () => {
    await page.goto(`${BASE_URL}/execution/pick-builder`, { waitUntil: 'networkidle', timeout: 90_000 });
    const submit = page.getByRole('button', { name: /submit for approval/i }).first();
    await submit.waitFor({ state: 'visible', timeout: 5_000 });
    if (await submit.isEnabled()) {
      throw new Error('empty form submit is enabled — validation gate missing');
    }
    const bodyText = await page.innerText('body');
    if (!/missing|required|readiness/i.test(bodyText)) {
      throw new Error('no readiness/missing-field feedback rendered for empty form');
    }
  });

  // 3. Picks explorer: toggle the status filter.
  await probe('picks-filter-toggle', async () => {
    await page.goto(`${BASE_URL}/picks`, { waitUntil: 'networkidle', timeout: 90_000 });
    const select = page.getByLabel('Filter by status');
    await select.waitFor({ state: 'visible', timeout: 5_000 });
    const options = await select.locator('option').allTextContents();
    if (options.length > 1) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(400);
    }
  });

  return results;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const routes = enumerateRoutes();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    colorScheme: 'dark',
    ...(AUTH_TOKEN ? { extraHTTPHeaders: { Authorization: `Bearer ${AUTH_TOKEN}` } } : {}),
  });
  const page = await context.newPage();

  const results: SweepResult[] = [];
  for (const route of routes) {
    const screenshotName = REDIRECT_ROUTES.has(route) ? null : routeName(route);
    const result = await sweepRoute(page, route, screenshotName);
    results.push(result);
    console.log(`${isPass(result) ? 'PASS' : 'FAIL'} ${result.route} status=${result.status} consoleErrors=${result.consoleErrors.length} pageErrors=${result.pageErrors.length} suspect=[${result.suspectText.join(',')}] warnings=${result.consoleWarnings}${result.notes.length ? ' notes=' + result.notes.join('; ') : ''}`);
    for (const err of [...result.consoleErrors, ...result.pageErrors].slice(0, 4)) {
      console.log(`    error: ${err.slice(0, 280)}`);
    }
  }

  // Mandatory pick-detail drill-in (dynamic route).
  let drillHref: string | null = null;
  try {
    await page.goto(`${BASE_URL}/picks`, { waitUntil: 'networkidle', timeout: 90_000 });
    drillHref = await page.locator('a[href^="/picks/"]').first().getAttribute('href', { timeout: 10_000 });
  } catch {
    drillHref = null;
  }
  if (drillHref && drillHref !== '/picks') {
    const result = await sweepRoute(page, drillHref, 'drill-pick-detail');
    result.route = '/picks/[id]';
    results.push(result);
    console.log(`${isPass(result) ? 'PASS' : 'FAIL'} /picks/[id] (${drillHref}) status=${result.status} consoleErrors=${result.consoleErrors.length}`);
  } else {
    results.push({
      route: '/picks/[id]',
      status: 'SKIPPED',
      consoleErrors: [],
      consoleWarnings: 0,
      pageErrors: [],
      suspectText: [],
      hasHeader: false,
      notes: ['SKIPPED: no pick link resolved from /picks — drill-in NOT verified (hard failure)'],
    });
    console.log('FAIL /picks/[id] SKIPPED — no pick link resolved');
  }

  // Interaction probes.
  const probes = await interactionProbes(page);
  for (const probe of probes) {
    results.push(probe);
    console.log(`${isPass(probe) ? 'PASS' : 'FAIL'} ${probe.route}${probe.notes.length ? ' notes=' + probe.notes.join('; ') : ''}`);
  }

  await browser.close();

  const failures = results.filter((result) => !isPass(result));
  const totalWarnings = results.reduce((sum, result) => sum + result.consoleWarnings, 0);
  console.log(`\nSweep complete: ${results.length - failures.length}/${results.length} passing · ${totalWarnings} console warnings total`);
  console.log(`\n| Route | Status | Console errors | Warnings | Notes |`);
  console.log(`|---|---|---|---|---|`);
  for (const result of results) {
    console.log(`| ${result.route} | ${result.status} | ${result.consoleErrors.length + result.pageErrors.length} | ${result.consoleWarnings} | ${[...result.suspectText.map((s) => `suspect:${s}`), ...result.notes].join('; ') || 'ok'} |`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
