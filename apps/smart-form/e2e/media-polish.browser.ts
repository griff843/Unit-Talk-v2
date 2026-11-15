import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Route } from '@playwright/test';

const baseURL = process.env.SMART_FORM_MEDIA_BASE_URL ?? 'http://127.0.0.1:4107';
const output = new URL('../../../.out/smart-form-media/', import.meta.url);
const teams = {
  NHL: ['Edmonton Oilers Northern Alberta Fixture Club', 'Calgary Flames Southern Alberta Fixture Club'],
  NBA: ['Minnesota Timberwolves Fixture Club', 'Phoenix Suns Fixture Club'],
} as const;
type Sport = keyof typeof teams;

test('a canonical player result can be selected using the keyboard', async t => {
  const page = await browserPage(t);
  await fixtures(page);
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await chooseMatchup(page, 'NHL');
  const input = page.getByLabel('Player', { exact: true });
  await input.fill(playerNames.NHL[0]);
  const result = page.getByRole('button', { name: `${playerNames.NHL[0]} player`, exact: true });
  await result.waitFor();
  await input.press('Tab');
  await result.press('Enter');
  assert.equal(await input.inputValue(), playerNames.NHL[0]);
  assert.equal(await page.getByTestId('participant-artwork').getAttribute('data-player-id'), playerId('NHL'));
});
const playerNames = { NHL: ['Connor McDavid Fixture', 'Calgary Skater Fixture'], NBA: ['Anthony Edwards Fixture', 'Phoenix Guard Fixture'] } as const;
function teamId(sport: Sport, side = 0) { return `fixture-${sport.toLowerCase()}-team-${side}`; }
function playerId(sport: Sport, side = 0) { return `fixture-${sport.toLowerCase()}-player-${side}`; }
function imageURL(sport: Sport, id: string) {
  return `https://${sport === 'NHL' ? 'assets.nhle.com' : 'cdn.nba.com'}/unit-talk-fixture/${id}.png`;
}
function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}
async function screenshot(page: Page, name: string) {
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, output)), fullPage: true });
}
async function browserPage(t: TestContext, width = 390) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'Fixtures require a local server');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ baseURL, viewport: { width, height: 844 } });
  context.setDefaultTimeout(10_000);
  return context.newPage();
}

interface FixtureState {
  playerFailures: number;
  playerRequests: number;
  delayPlayer: Promise<void> | null;
  mediaMode: 'good' | 'wrong-id' | 'failed' | 'broken';
  delayMedia: Promise<void> | null;
  submissions: Array<Record<string, unknown>>;
}

// Canonical identity and SVG artwork fixtures. All submission requests are
// intercepted; this suite does not write picks, authenticate users or deliver.
async function fixtures(page: Page): Promise<FixtureState> {
  const state: FixtureState = { playerFailures: 0, playerRequests: 0, delayPlayer: null, mediaMode: 'good', delayMedia: null, submissions: [] };
  await page.route('**/api/auth/session', route => json(route, {
    user: { name: 'Griff Fixture' }, capperId: 'griff843', expires: '2099-01-01T00:00:00.000Z',
  }));
  await page.route('**/api/reference-data/catalog', route => json(route, { data: {
    sports: (['NHL', 'NBA'] as const).map(id => ({ id, name: id, marketTypes: ['player-prop', 'moneyline', 'total', 'team-total'], statTypes: id === 'NHL' ? ['Shots on Goal', 'Points'] : ['Points', 'Assists'], teams: [] })),
    sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }], ticketTypes: [], cappers: [],
  } }));
  await page.route('**/api/reference-data/availability?**', route => json(route, { data: { sportId: new URL(route.request().url()).searchParams.get('sportId'), teamsAvailable: true, playersAvailable: true } }));
  await page.route('**/api/reference-data/matchups?**', route => json(route, { data: [] }));
  await page.route('**/api/reference-data/search?**', route => json(route, { data: [] }));
  await page.route('**/api/reference-data/search/teams?**', route => {
    const query = new URL(route.request().url()).searchParams;
    const sport = (query.get('sport') ?? 'NHL') as Sport;
    return json(route, { data: teams[sport].map((displayName, side) => ({ participantId: teamId(sport, side), displayName, participantType: 'team' })).filter(row => row.displayName.toLowerCase().includes((query.get('q') ?? '').toLowerCase())) });
  });
  await page.route('**/api/reference-data/search/players?**', async route => {
    state.playerRequests += 1;
    const query = new URL(route.request().url()).searchParams;
    const sport = (query.get('sport') ?? 'NHL') as Sport;
    if (state.delayPlayer) await state.delayPlayer;
    if (state.playerFailures > 0) {
      state.playerFailures -= 1;
      return json(route, { error: { message: 'Fixture participant service unavailable' } }, 503);
    }
    // Deliberately return the other team's player too: the UI must reject it.
    return json(route, { data: playerNames[sport].map((displayName, side) => ({ participantId: playerId(sport, side), displayName, participantType: 'player', teamId: teamId(sport, side) })) });
  });
  await page.route('**/api/reference-data/participants/*/media', async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    const sport: Sport = id.includes('-nba-') ? 'NBA' : 'NHL';
    const side = id.endsWith('-1') ? 1 : 0;
    const isPlayer = id.includes('-player-');
    const mode = state.mediaMode;
    if (state.delayMedia) await state.delayMedia;
    if (mode === 'failed') return json(route, { error: { message: 'Fixture media unavailable' } }, 503);
    return json(route, { data: {
      participantId: mode === 'wrong-id' ? 'fixture-unrelated-identity' : id,
      participantType: isPlayer ? 'player' : 'team', sport,
      displayName: isPlayer ? playerNames[sport][side] : teams[sport][side],
      headshotUrl: isPlayer ? imageURL(sport, id) : null,
      logoUrl: isPlayer ? null : imageURL(sport, id),
    } });
  });
  for (const host of ['assets.nhle.com', 'cdn.nba.com']) {
    await page.route(`https://${host}/unit-talk-fixture/**`, route => {
      if (state.mediaMode === 'broken') return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="234"><rect width="320" height="234" fill="#253648"/><circle cx="160" cy="82" r="42" fill="#bdceda"/><path d="M72 234V190Q160 102 248 190V234" fill="#496a87"/><text x="160" y="224" fill="white" font-size="14" text-anchor="middle">TEST ARTWORK FIXTURE</text></svg>' });
    });
  }
  await page.route('**/api/submissions', route => {
    state.submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, { data: { submissionId: 'fixture-submission', pickId: 'fixture-pick', lifecycleState: 'validated', outboxEnqueued: false, deliveryPosture: 'track-only' } }, 201);
  });
  return state;
}

async function chooseMatchup(page: Page, sport: Sport) {
  await page.getByRole('button', { name: sport, exact: true }).click();
  await page.getByLabel('Away Team', { exact: true }).fill(teams[sport][0]);
  await page.getByRole('button', { name: `${teams[sport][0]} team`, exact: true }).click();
  await page.getByLabel('Home Team', { exact: true }).fill(teams[sport][1]);
  await page.getByRole('button', { name: `${teams[sport][1]} team`, exact: true }).click();
  await page.getByRole('button', { name: /PROP\s*Player Prop/ }).first().click();
  await page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: teams[sport][0], exact: true }).click();
}
async function choosePlayer(page: Page, sport: Sport, side = 0) {
  await page.getByLabel('Player', { exact: true }).fill(playerNames[sport][side]);
  await page.getByRole('button', { name: `${playerNames[sport][side]} player`, exact: true }).click();
}
async function completeProp(page: Page, sport: Sport) {
  await choosePlayer(page, sport);
  await page.getByLabel('Stat Type', { exact: true }).click();
  await page.getByRole('option', { name: sport === 'NHL' ? 'Shots on Goal' : 'Points', exact: true }).click();
  await page.getByLabel('Over / Under', { exact: true }).click();
  await page.getByRole('option', { name: 'Over', exact: true }).click();
  await page.getByLabel('Line', { exact: true }).fill(sport === 'NHL' ? '3.5' : '24.5');
  await page.getByLabel('Odds', { exact: true }).fill('-110');
  await page.getByRole('button', { name: '8', exact: true }).click();
}
async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
}
async function contrast(page: Page, selector: string, index = 0) {
  const ratio = await page.locator(selector).nth(index).evaluate(element => {
    const style = getComputedStyle(element);
    let background = style.backgroundColor;
    let ancestor: Element | null = element;
    while ((background === 'rgba(0, 0, 0, 0)' || background === 'transparent') && ancestor?.parentElement) {
      ancestor = ancestor.parentElement;
      background = getComputedStyle(ancestor).backgroundColor;
    }
    // Inline callbacks avoid tsx's named-function helper in the browser scope.
    const luminances = [style.color, background].map(color =>
      (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0),
    );
    return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
  });
  assert.ok(ratio >= 4.5, `${selector} contrast ${ratio.toFixed(2)} must meet 4.5:1`);
}

for (const sport of ['NHL', 'NBA'] as const) {
  test(`${sport} canonical prop has readable controls, exact artwork and unchanged Track Only payload`, async t => {
    const page = await browserPage(t, sport === 'NHL' ? 390 : 1440);
    const state = await fixtures(page);
    await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await chooseMatchup(page, sport);
    await completeProp(page, sport);
    await contrast(page, '[id$="-form-item"][role="combobox"]');
    await contrast(page, '[id$="-form-item"][role="combobox"]', 1);
    await page.getByLabel('Over / Under', { exact: true }).click();
    await page.getByRole('option', { name: 'Under', exact: true }).waitFor();
    await contrast(page, '[role="option"][data-state="unchecked"]');
    await page.keyboard.press('Escape');
    const artwork = page.getByTestId('participant-artwork');
    assert.equal(await artwork.getAttribute('data-player-id'), playerId(sport));
    await artwork.getByRole('img', { name: `${playerNames[sport][0]} headshot` }).waitFor();
    assert.equal(await artwork.getByRole('img', { name: `${teams[sport][0]} logo` }).getAttribute('src'), imageURL(sport, teamId(sport)));
    await noOverflow(page);
    await screenshot(page, `${sport.toLowerCase()}-prop-artwork.png`);
    await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
    await page.getByTestId('delivery-disposition').waitFor();
    assert.equal(state.submissions.length, 1);
    const payload = state.submissions[0]!;
    const metadata = payload.metadata as Record<string, unknown>;
    assert.equal(payload.source, 'smart-form');
    assert.equal(payload.odds, -110);
    assert.equal(payload.line, sport === 'NHL' ? 3.5 : 24.5);
    assert.equal(metadata.playerId, playerId(sport));
    assert.equal(metadata.teamId, teamId(sport));
    assert.equal(metadata.distributionMode, 'track-only');
    assert.equal(await page.getByTestId('delivery-disposition').getAttribute('data-disposition'), 'track-only');
  });
}

test('matchup team buttons clear player and reject wrong-team search results', async t => {
  const page = await browserPage(t);
  const state = await fixtures(page);
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await chooseMatchup(page, 'NHL');
  await completeProp(page, 'NHL');
  await page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: teams.NHL[1], exact: true }).click();
  assert.equal(await page.getByLabel('Player', { exact: true }).inputValue(), '');
  await page.getByLabel('Player', { exact: true }).fill('Fixture');
  await page.getByRole('button', { name: `${playerNames.NHL[1]} player`, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: `${playerNames.NHL[0]} player`, exact: true }).count(), 0);
  assert.equal(await page.getByTestId('participant-artwork').getAttribute('data-player-id'), null);
  await page.getByLabel('Player', { exact: true }).fill(playerNames.NHL[0]);
  await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
  await page.getByText('Select a player from the results', { exact: true }).waitFor();
  assert.equal(state.submissions.length, 0, 'Typing the other team’s player must never POST a submission');
});

test('delayed player search cannot restore an old team or player', async t => {
  const page = await browserPage(t);
  const state = await fixtures(page);
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await chooseMatchup(page, 'NHL');
  let release: () => void = () => {};
  state.delayPlayer = new Promise<void>(resolve => { release = resolve; });
  const request = page.waitForRequest(url => url.url().includes('/search/players?'));
  await page.getByLabel('Player', { exact: true }).fill('Connor');
  await request;
  await page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: teams.NHL[1], exact: true }).click();
  state.delayPlayer = null;
  release();
  await choosePlayer(page, 'NHL', 1);
  assert.equal(await page.getByLabel('Player', { exact: true }).inputValue(), playerNames.NHL[1]);
  assert.equal(await page.getByTestId('participant-artwork').getAttribute('data-player-id'), playerId('NHL', 1));
  assert.equal(await page.getByRole('button', { name: `${playerNames.NHL[0]} player`, exact: true }).count(), 0);
});

test('participant search retries a transient failure without changing the query', async t => {
  const page = await browserPage(t);
  const state = await fixtures(page);
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await chooseMatchup(page, 'NBA');
  state.playerFailures = 1;
  await page.getByLabel('Player', { exact: true }).fill('Anthony');
  await page.getByRole('alert').filter({ hasText: 'Fixture participant service unavailable' }).waitFor();
  const before = state.playerRequests;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: `${playerNames.NBA[0]} player`, exact: true }).waitFor();
  assert.equal(await page.getByLabel('Player', { exact: true }).inputValue(), 'Anthony');
  assert.ok(state.playerRequests > before);
});

for (const mode of ['wrong-id', 'failed', 'broken'] as const) {
  test(`${mode} optional media falls back without blocking a canonical prop`, async t => {
    const page = await browserPage(t);
    const state = await fixtures(page);
    state.mediaMode = mode;
    await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await chooseMatchup(page, 'NHL');
    await completeProp(page, 'NHL');
    const artwork = page.getByTestId('participant-artwork');
    await artwork.locator('.participant-initials').waitFor();
    assert.equal(await artwork.locator('img').count(), 0);
    await noOverflow(page);
    await screenshot(page, `nhl-${mode}-fallback.png`);
    await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
    await page.getByTestId('delivery-disposition').waitFor();
    assert.equal(state.submissions.length, 1);
    assert.equal((state.submissions[0]!.metadata as Record<string, unknown>).playerId, playerId('NHL'));
  });
}

test('delayed artwork for the previous player is ignored after switching teams', async t => {
  const page = await browserPage(t);
  const state = await fixtures(page);
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await chooseMatchup(page, 'NHL');
  let release: () => void = () => {};
  state.delayMedia = new Promise<void>(resolve => { release = resolve; });
  const request = page.waitForRequest(url => url.url().includes(`/participants/${playerId('NHL')}/media`));
  await choosePlayer(page, 'NHL');
  await request;
  await page.getByTestId('manual-matchup-team-choices').getByRole('button', { name: teams.NHL[1], exact: true }).click();
  state.delayMedia = null;
  release();
  await choosePlayer(page, 'NHL', 1);
  const artwork = page.getByTestId('participant-artwork');
  await artwork.getByRole('img', { name: `${playerNames.NHL[1]} headshot` }).waitFor();
  assert.equal(await artwork.getByRole('img', { name: `${playerNames.NHL[0]} headshot` }).count(), 0);
  assert.equal(await artwork.getAttribute('data-team-id'), teamId('NHL', 1));
});

for (const width of [320, 390]) {
  test(`${width}px NHL matchup wraps fully and line examples match hockey`, async t => {
    const page = await browserPage(t, width);
    await fixtures(page);
    await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await chooseMatchup(page, 'NHL');
    const matchup = page.getByTestId('readable-matchup');
    assert.match(await matchup.inputValue(), /Edmonton Oilers.*Calgary Flames/);
    assert.equal(await matchup.evaluate(element => element.scrollHeight > element.clientHeight), false, 'Readonly matchup must show every line');
    await page.getByLabel('Stat Type', { exact: true }).click();
    await page.getByRole('option', { name: 'Shots on Goal', exact: true }).click();
    assert.equal(await page.getByLabel('Line', { exact: true }).getAttribute('placeholder'), 'e.g. 3.5');
    await noOverflow(page);
    await screenshot(page, `nhl-${width}-readable-matchup.png`);
  });
}

test('live browse maps legacy team IDs to canonical participant IDs for player search and artwork', async t => {
  const page = await browserPage(t);
  await fixtures(page);
  const matchup = {
    eventId: 'fixture-nhl-event', externalId: 'fixture-nhl-event',
    eventName: `${teams.NHL[0]} @ ${teams.NHL[1]}`, eventDate: '2026-10-27',
    startTime: '2026-10-27T23:00:00.000Z', status: 'scheduled', sportId: 'NHL', leagueId: 'nhl',
    teams: teams.NHL.map((displayName, side) => ({ participantId: teamId('NHL', side), teamId: `legacy-nhl-${side}`, displayName, role: side === 0 ? 'away' : 'home' })),
  };
  await page.route('**/api/reference-data/matchups?**', route => json(route, { data: [matchup] }));
  await page.route('**/api/reference-data/events/fixture-nhl-event/browse*', route => json(route, { data: {
    ...matchup, offers: [],
    participants: [
      ...matchup.teams.map(team => ({ ...team, canonicalId: team.participantId, participantType: 'team', teamName: team.displayName })),
      { participantId: playerId('NHL'), canonicalId: playerId('NHL'), participantType: 'player', displayName: playerNames.NHL[0], role: 'away', teamId: 'legacy-nhl-0', teamName: teams.NHL[0] },
    ],
  } }));
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Browse offers', exact: true }).click();
  await page.getByRole('button', { name: 'NHL', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill('2026-10-27');
  await page.getByRole('button', { name: new RegExp(`${teams.NHL[0]} @ ${teams.NHL[1]}`) }).click();
  await page.getByRole('button', { name: /PROP\s*Player Prop/ }).first().click();
  await page.getByRole('button', { name: `${teams.NHL[0]} Filter players to this team`, exact: true }).click();
  const request = page.waitForRequest(value => value.url().includes('/search/players?'));
  await choosePlayer(page, 'NHL');
  assert.equal(new URL((await request).url()).searchParams.get('teamId'), teamId('NHL'));
  const artwork = page.getByTestId('participant-artwork');
  assert.equal(await artwork.getAttribute('data-team-id'), teamId('NHL'));
  await artwork.getByRole('img', { name: `${playerNames.NHL[0]} headshot` }).waitFor();
  assert.equal(await artwork.getByRole('img', { name: `${teams.NHL[0]} logo` }).getAttribute('src'), imageURL('NHL', teamId('NHL')));
});

test('NHL game total shows both canonical team logos and preserves the entered total', async t => {
  const page = await browserPage(t, 390);
  const state = await fixtures(page);
  const matchup = {
    eventId: 'fixture-nhl-event', externalId: 'fixture-nhl-event',
    eventName: `${teams.NHL[0]} @ ${teams.NHL[1]}`, eventDate: '2026-10-27',
    startTime: '2026-10-27T23:00:00.000Z', status: 'scheduled', sportId: 'NHL', leagueId: 'nhl',
    teams: teams.NHL.map((displayName, side) => ({ participantId: teamId('NHL', side), teamId: `legacy-nhl-${side}`, displayName, role: side === 0 ? 'away' : 'home' })),
  };
  await page.route('**/api/reference-data/matchups?**', route => json(route, { data: [matchup] }));
  await page.route('**/api/reference-data/events/fixture-nhl-event/browse*', route => json(route, { data: {
    ...matchup, offers: [],
    participants: [
      ...matchup.teams.map(team => ({ ...team, canonicalId: team.participantId, participantType: 'team', teamName: team.displayName })),
      { participantId: playerId('NHL'), canonicalId: playerId('NHL'), participantType: 'player', displayName: playerNames.NHL[0], role: 'away', teamId: 'legacy-nhl-0', teamName: teams.NHL[0] },
    ],
  } }));
  await page.goto('/submit', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: 'Browse offers', exact: true }).click();
  await page.getByRole('button', { name: 'NHL', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill('2026-10-27');
  await page.getByRole('button', { name: new RegExp(`${teams.NHL[0]} @ ${teams.NHL[1]}`) }).click();
  await page.getByRole('button', { name: 'TOT Total', exact: true }).click();
  await page.getByRole('button', { name: /^Under fanatics Enter total$/i }).click();
  await page.getByLabel('Total', { exact: true }).fill('6.5');
  await page.getByLabel('Odds', { exact: true }).fill('-115');
  await page.getByRole('button', { name: '8', exact: true }).click();
  const artwork = page.getByTestId('participant-artwork');
  for (const side of [0, 1]) {
    await artwork.getByRole('img', { name: `${teams.NHL[side]} logo` }).waitFor();
    assert.equal(await artwork.getByRole('img', { name: `${teams.NHL[side]} logo` }).getAttribute('src'), imageURL('NHL', teamId('NHL', side)));
  }
  assert.equal(await artwork.getAttribute('data-player-id'), null);
  await noOverflow(page);
  await screenshot(page, 'nhl-total-team-logos.png');
  await page.locator('[data-testid="smart-form-submit-button"]:visible').click();
  await page.getByTestId('delivery-disposition').waitFor();
  assert.equal(state.submissions.length, 1);
  assert.equal(state.submissions[0]!.line, 6.5);
  assert.equal(state.submissions[0]!.odds, -115);
});
