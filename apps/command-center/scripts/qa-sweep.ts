/**
 * UTV2-1522 QA sweep — Playwright-driven visual/functional pass over every
 * Command Center surface.
 *
 * For each route: assert HTTP 200, no uncaught page errors, zero console
 * errors (warnings logged), no raw "undefined"/"NaN"/"[object Object]" text
 * in the body, and a rendered page header (never a blank page). Captures a
 * full-page 1600x1000 dark-theme screenshot per surface.
 *
 * Usage (dev server on :4300, local.env sourced for auth credentials):
 *   tsx scripts/qa-sweep.ts [--out <screenshot-dir>]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:4300';
const OUT_DIR =
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]!
    : path.resolve(process.cwd(), '../../docs/06_status/proof/UTV2-1522/screenshots');

const AUTH_TOKEN =
  process.env.UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN || process.env.COMMAND_CENTER_AUTH_TOKEN;

/** All nav surfaces + key drill-ins. Keep in sync with CommandCenterShell NAV_GROUPS. */
const ROUTES: Array<{ route: string; name: string }> = [
  { route: '/', name: 'desk-executive-overview' },
  { route: '/fire-board', name: 'desk-fire-board' },
  { route: '/pipeline', name: 'desk-todays-action' },
  { route: '/research/lines', name: 'intel-odds-board' },
  { route: '/research/props', name: 'intel-props-explorer' },
  { route: '/intel/ev-feed', name: 'intel-ev-feed' },
  { route: '/intel/arbitrage', name: 'intel-arbitrage' },
  { route: '/intel/middles', name: 'intel-middles' },
  { route: '/intel/boosts', name: 'intel-boosts' },
  { route: '/intel/sharp-books', name: 'intel-sharp-books' },
  { route: '/intel/line-movement', name: 'intel-line-movement' },
  { route: '/research/players', name: 'intel-player-research' },
  { route: '/intel/teams', name: 'intel-team-research' },
  { route: '/intel/injuries', name: 'intel-injury-monitor' },
  { route: '/research/trends', name: 'intel-trend-explorer' },
  { route: '/intel/alerts', name: 'intel-alert-builder' },
  { route: '/execution/pick-builder', name: 'exec-pick-builder' },
  { route: '/review', name: 'exec-review-queue' },
  { route: '/execution/discord-preview', name: 'exec-discord-preview' },
  { route: '/execution/scheduled', name: 'exec-scheduled-dispatch' },
  { route: '/execution/results', name: 'exec-results-tracking' },
  { route: '/operations/outbox', name: 'ops-outbox' },
  { route: '/operations/approvals', name: 'ops-approvals' },
  { route: '/operations/discord', name: 'ops-discord-control' },
  { route: '/operations/results', name: 'ops-results' },
  { route: '/operations/governance', name: 'system-governance' },
  { route: '/api-health', name: 'system-health' },
  { route: '/picks', name: 'drill-picks-index' },
];

interface SweepResult {
  route: string;
  status: number | 'ERR';
  consoleErrors: string[];
  consoleWarnings: number;
  pageErrors: string[];
  suspectText: string[];
  hasHeader: boolean;
  bodyTextLength: number;
  screenshot: string;
  notes: string[];
}

const SUSPECT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'undefined', re: /(^|[\s>:,(])undefined([\s<.,)]|$)/ },
  { label: 'NaN', re: /(^|[\s>:,(])NaN([\s<.,)%]|$)/ },
  { label: '[object Object]', re: /\[object Object\]/ },
];

async function sweepRoute(page: Page, route: string, name: string): Promise<SweepResult> {
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
  let bodyTextLength = 0;
  const screenshot = `${name}.png`;

  try {
    const response = await page.goto(`${BASE_URL}${route}`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
    status = response?.status() ?? 'ERR';
    await page.waitForTimeout(750);

    const bodyText = await page.innerText('body');
    bodyTextLength = bodyText.trim().length;
    for (const { label, re } of SUSPECT_PATTERNS) {
      if (re.test(bodyText)) suspectText.push(label);
    }
    hasHeader = (await page.locator('h1').count()) > 0;
    if (!hasHeader) notes.push('no h1 header rendered');
    if (bodyTextLength < 40) notes.push('page appears blank');

    await page.screenshot({ path: path.join(OUT_DIR, screenshot), fullPage: true });
  } catch (error) {
    notes.push(`navigation failed: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return { route, status, consoleErrors, consoleWarnings, pageErrors, suspectText, hasHeader, bodyTextLength, screenshot, notes };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    colorScheme: 'dark',
    ...(AUTH_TOKEN ? { extraHTTPHeaders: { Authorization: `Bearer ${AUTH_TOKEN}` } } : {}),
  });
  const page = await context.newPage();

  // Resolve a live pick id for the drill-in keeper page, if any data resolves.
  const routes = [...ROUTES];
  try {
    await page.goto(`${BASE_URL}/picks`, { waitUntil: 'networkidle', timeout: 90_000 });
    const href = await page.locator('a[href^="/picks/"]').first().getAttribute('href', { timeout: 5_000 });
    if (href && href !== '/picks') routes.push({ route: href, name: 'drill-pick-detail' });
  } catch {
    console.log('note: no pick detail link resolved from /picks — skipping drill-in');
  }

  const results: SweepResult[] = [];
  for (const { route, name } of routes) {
    const result = await sweepRoute(page, route, name);
    results.push(result);
    const ok =
      result.status === 200 &&
      result.consoleErrors.length === 0 &&
      result.pageErrors.length === 0 &&
      result.suspectText.length === 0 &&
      result.hasHeader &&
      result.notes.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${result.route} status=${result.status} consoleErrors=${result.consoleErrors.length} pageErrors=${result.pageErrors.length} suspect=[${result.suspectText.join(',')}] warnings=${result.consoleWarnings}${result.notes.length ? ' notes=' + result.notes.join('; ') : ''}`);
    for (const err of [...result.consoleErrors, ...result.pageErrors].slice(0, 5)) {
      console.log(`    error: ${err.slice(0, 300)}`);
    }
  }

  await browser.close();

  const failures = results.filter(
    (r) =>
      r.status !== 200 ||
      r.consoleErrors.length > 0 ||
      r.pageErrors.length > 0 ||
      r.suspectText.length > 0 ||
      !r.hasHeader ||
      r.notes.length > 0,
  );
  console.log(`\nSweep complete: ${results.length - failures.length}/${results.length} passing`);
  console.log(`\n| Route | Status | Console errors | Notes |`);
  console.log(`|---|---|---|---|`);
  for (const r of results) {
    console.log(`| ${r.route} | ${r.status} | ${r.consoleErrors.length + r.pageErrors.length} | ${[...r.suspectText.map((s) => `suspect:${s}`), ...r.notes].join('; ') || 'ok'} |`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
