import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const baseURL = process.env.SMART_FORM_UI_BASE_URL ?? 'http://127.0.0.1:4106';
const outputDirectory = new URL('../../../.out/smart-form-ui/', import.meta.url);
function screenshotPath(name: string) {
  mkdirSync(outputDirectory, { recursive: true });
  return fileURLToPath(new URL(name, outputDirectory));
}
async function browserPage(context: TestContext) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'UI fixtures may target only a local server');
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const browserContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  return browserContext.newPage();
}

// Browser-only fixtures. Submission responses are intercepted; these tests
// never activate delivery or write to a production API.
const catalog = {
  data: {
    sports: [{
      id: 'NCAAF', name: 'NCAAF',
      marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'],
      statTypes: ['Passing Yards'], teams: [],
    }],
    sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }],
    ticketTypes: [], cappers: [],
  },
};

async function fixtureSession(page: Page) {
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { name: 'UI Test Capper' }, capperId: 'griff843', expires: '2099-01-01T00:00:00.000Z' }),
  }));
}

async function fixtureReferenceData(page: Page) {
  await fixtureSession(page);
  await page.route('**/api/reference-data/catalog', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(catalog),
  }));
  await page.route('**/api/reference-data/availability?**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { sportId: 'NCAAF', teamsAvailable: true, playersAvailable: true } }),
  }));
  for (const endpoint of ['matchups', 'search/teams']) {
    await page.route(`**/api/reference-data/${endpoint}?**`, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }),
    }));
  }
}

async function enterManualMoneyline(page: Page) {
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF', exact: true }).click();
  await page.getByLabel('Away Team', { exact: true }).fill('Temple');
  await page.getByText(/No canonical team found for.*Temple/).waitFor();
  await page.getByLabel('Home Team', { exact: true }).fill('Navy');
  await page.getByTestId('coverage-gap-manual-entry').click();
  await page.getByRole('button', { name: /ML\s*Moneyline/ }).click();
  await page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: 'Navy', exact: true }).click();
  await page.getByLabel('Odds', { exact: true }).fill('-110');
  await page.getByRole('button', { name: '8', exact: true }).click();
}

for (const scenario of [
  { name: 'mobile Track Only', width: 390, requestDelivery: false },
  { name: 'desktop delivery request awaiting approval', width: 1440, requestDelivery: true },
]) {
  test(`polished ${scenario.name} preserves payload and server-derived receipt`, async (t) => {
    const page = await browserPage(t);
    await page.setViewportSize({ width: scenario.width, height: 1000 });
    await fixtureReferenceData(page);
    const submissions: Array<Record<string, unknown>> = [];
    await page.route('**/api/submissions', async route => {
      submissions.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: {
        submissionId: 'ui-submission', pickId: 'ui-pick',
        lifecycleState: scenario.requestDelivery ? 'awaiting_approval' : 'validated',
        outboxEnqueued: false,
        ...(scenario.requestDelivery ? {} : { deliveryPosture: 'track-only' }),
      } }) });
    });
    await enterManualMoneyline(page);
    if (scenario.requestDelivery) {
      await page.getByRole('radio', { name: /Request Official Pick Delivery/ }).check();
    }
    assert.equal(await page.locator('input[name="odds"]').getAttribute('inputmode'), 'text');
    assert.equal(await page.locator('input[name="odds"]').inputValue(), '-110');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await page.screenshot({ path: screenshotPath(scenario.requestDelivery ? 'desktop-form.png' : 'mobile-form.png'), fullPage: true });
    await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
    const disposition = page.getByTestId('delivery-disposition');
    await disposition.waitFor();
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]?.odds, -110);
    assert.equal(submissions[0]?.source, 'smart-form');
    const metadata = submissions[0]?.metadata as Record<string, unknown>;
    assert.equal(metadata.distributionMode, scenario.requestDelivery ? 'delivery-eligible' : 'track-only');
    assert.equal(await disposition.getAttribute('data-disposition'), scenario.requestDelivery ? 'awaiting-approval' : 'track-only');
    assert.match(await disposition.innerText(), scenario.requestDelivery ? /held for review/ : /server recorded this pick as Track Only/);
    await page.screenshot({ path: screenshotPath(scenario.requestDelivery ? 'approval-receipt.png' : 'track-only-receipt.png'), fullPage: true });
  });
}

test('mobile player-prop entry keeps long names and canonical payload identity', async (t) => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtureReferenceData(page);
  const playerName = 'Jeremiah Alexander Montgomery-Washington III';
  const matchup = {
    eventId: 'ui-event', externalId: 'ui-event', eventName: 'TCU @ UNC',
    eventDate: '2026-10-27', startTime: '2026-10-27T23:00:00.000Z', status: 'scheduled',
    sportId: 'NCAAF', leagueId: 'ncaaf',
    teams: [
      { participantId: 'ui-tcu', teamId: 'ui-tcu', displayName: 'TCU', role: 'away' },
      { participantId: 'ui-unc', teamId: 'ui-unc', displayName: 'UNC', role: 'home' },
    ],
  };
  await page.route('**/api/reference-data/matchups?**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [matchup] }),
  }));
  await page.route('**/api/reference-data/events/ui-event/browse*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
      ...matchup,
      participants: [
        { participantId: 'ui-tcu', canonicalId: 'ui-tcu', participantType: 'team', displayName: 'TCU', role: 'away', teamId: 'ui-tcu', teamName: 'TCU' },
        { participantId: 'ui-unc', canonicalId: 'ui-unc', participantType: 'team', displayName: 'UNC', role: 'home', teamId: 'ui-unc', teamName: 'UNC' },
        { participantId: 'ui-player', canonicalId: 'ui-player', participantType: 'player', displayName: playerName, role: 'away', teamId: 'ui-tcu', teamName: 'TCU' },
      ],
      offers: [{ sportsbookId: 'fanatics', sportsbookName: 'Fanatics', marketTypeId: 'player.passing_yards', marketDisplayName: 'Passing Yards', participantId: 'ui-player', participantName: playerName, line: 245.5, overOdds: -110, underOdds: -110, snapshotAt: '2026-10-27T22:55:00.000Z', providerKey: 'fixture', providerMarketKey: 'ui-passing-yards', providerParticipantId: 'ui-player' }],
    } }),
  }));
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/submissions', async route => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { submissionId: 'ui-prop-submission', pickId: 'ui-prop', lifecycleState: 'validated', outboxEnqueued: false, deliveryPosture: 'track-only' } }) });
  });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'Browse offers', exact: true }).click();
  await page.getByRole('button', { name: 'NCAAF', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill('2026-10-27');
  await page.getByRole('button', { name: /TCU @ UNC/i }).click();
  await page.getByRole('button', { name: /PROP\s*Player Prop/ }).first().click();
  await page.getByRole('button', { name: /TCU Filter players to this team/ }).click();
  await page.getByRole('button', { name: playerName, exact: true }).click();
  await page.getByRole('button', { name: 'Over -110', exact: true }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  assert.match(await page.locator('[data-slip-label="Pick"]').innerText(), /Montgomery-Washington III/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.screenshot({ path: screenshotPath('mobile-player-prop.png'), fullPage: true });
  await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
  await page.getByTestId('delivery-disposition').waitFor();
  assert.equal(submissions.length, 1);
  const metadata = submissions[0]?.metadata as Record<string, unknown>;
  assert.equal(metadata.playerId, 'ui-player');
  assert.equal(metadata.teamId, 'ui-tcu');
  assert.equal(metadata.distributionMode, 'track-only');
  assert.equal(submissions[0]?.line, 245.5);
  assert.equal(submissions[0]?.odds, -110);
});

test('mobile incomplete input stays in the form and never submits', async (t) => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 320, height: 844 });
  await fixtureReferenceData(page);
  let submissions = 0;
  await page.route('**/api/submissions', route => {
    submissions += 1;
    return route.abort();
  });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF', exact: true }).click();
  await page.getByLabel('Odds', { exact: true }).fill('-');
  await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
  await page.locator('[aria-invalid="true"]').first().waitFor();
  assert.equal(submissions, 0);
  assert.equal(await page.locator('input[name="odds"]').inputValue(), '-');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
});

test('catalog failure offers a working retry without changing authentication', async (t) => {
    const page = await browserPage(t);
  await fixtureSession(page);
  let requests = 0;
  let allowSuccess = false;
  await page.route('**/api/reference-data/catalog', route => {
    requests += 1;
    return route.fulfill({
      status: allowSuccess ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(allowSuccess ? catalog : { error: { message: 'Reference data temporarily unavailable.' } }),
    });
  });
  await page.goto('/submit');
  await page.getByRole('heading', { name: 'We couldn’t load your workspace.' }).waitFor();
  await page.screenshot({ path: screenshotPath('catalog-error.png'), fullPage: true });
  const requestsBeforeRetry = requests;
  allowSuccess = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('heading', { name: 'Build your pick.' }).waitFor();
  assert.ok(requests > requestsBeforeRetry, 'Retry must request the catalog again');
  assert.equal(await page.getByRole('img', { name: 'Unit Talk', exact: true }).count(), 1);
});
