import { expect, test, type Page } from '@playwright/test';

// Fixture-backed UI behavior tests. Canonical reference rows below are test fixtures,
// not evidence that the connected API environment is populated.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/reference-data/availability?**', async (route) => {
    const sportId = new URL(route.request().url()).searchParams.get('sport') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { sportId, teamsAvailable: true, playersAvailable: true } }),
    });
  });
  await page.addInitScript(() => {
    const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    localStorage.setItem('ut_capper_token', `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: 'griff843', capperId: 'griff843', displayName: 'Griff Test', role: 'capper',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.test-signature`);
  });
});

const catalog = {
  data: {
    sports: [
      { id: 'NCAAF', name: 'NCAAF', marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'], statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards'], teams: [] },
      { id: 'MLB', name: 'MLB', marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'], statTypes: ['Hits', 'Total Bases', 'Pitching Strikeouts'], teams: [] },
    ],
    sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }],
    ticketTypes: [],
    cappers: [],
  },
};

const ncaafMatchup = {
  eventId: 'event-ncaaf', externalId: 'ncaaf-1', eventName: 'TCU @ UNC',
  eventDate: '2026-09-01', startTime: '2026-09-01T23:00:00.000Z', status: 'scheduled',
  sportId: 'NCAAF', leagueId: 'ncaaf',
  teams: [
    { participantId: 'team-tcu', teamId: 'team-tcu', displayName: 'TCU', role: 'away' },
    { participantId: 'team-unc', teamId: 'team-unc', displayName: 'UNC', role: 'home' },
  ],
};

const ncaafBrowse = {
  ...ncaafMatchup,
  participants: [
    { participantId: 'team-tcu', canonicalId: 'team-tcu', participantType: 'team', displayName: 'TCU', role: 'away', teamId: 'team-tcu', teamName: 'TCU' },
    { participantId: 'team-unc', canonicalId: 'team-unc', participantType: 'team', displayName: 'UNC', role: 'home', teamId: 'team-unc', teamName: 'UNC' },
    { participantId: 'player-tcu-qb', canonicalId: 'player-tcu-qb', participantType: 'player', displayName: 'TCU Quarterback', role: 'away', teamId: 'team-tcu', teamName: 'TCU' },
    { participantId: 'player-unc-qb', canonicalId: 'player-unc-qb', participantType: 'player', displayName: 'UNC Quarterback', role: 'home', teamId: 'team-unc', teamName: 'UNC' },
  ],
  offers: [
    { sportsbookId: 'fanatics', sportsbookName: 'Fanatics', marketTypeId: 'moneyline', marketDisplayName: 'Moneyline', participantId: 'team-tcu', participantName: 'TCU', line: null, overOdds: 125, underOdds: null, snapshotAt: '2026-09-01T22:55:00.000Z', providerKey: 'fixture', providerMarketKey: 'ncaaf-ml-tcu', providerParticipantId: 'team-tcu' },
    { sportsbookId: 'fanatics', sportsbookName: 'Fanatics', marketTypeId: 'moneyline', marketDisplayName: 'Moneyline', participantId: 'team-unc', participantName: 'UNC', line: null, overOdds: -145, underOdds: null, snapshotAt: '2026-09-01T22:55:00.000Z', providerKey: 'fixture', providerMarketKey: 'ncaaf-ml-unc', providerParticipantId: 'team-unc' },
    { sportsbookId: 'fanatics', sportsbookName: 'Fanatics', marketTypeId: 'player.passing_yards', marketDisplayName: 'Passing Yards', participantId: 'player-tcu-qb', participantName: 'TCU Quarterback', line: 245.5, overOdds: -110, underOdds: -110, snapshotAt: '2026-09-01T22:55:00.000Z', providerKey: 'fixture', providerMarketKey: 'ncaaf-pass', providerParticipantId: 'player-tcu-qb' },
  ],
};

async function routeNcaaf(page: Page, submitted: { value: Record<string, unknown> | null }) {
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/reference-data/matchups?**', (route) => {
    const sport = new URL(route.request().url()).searchParams.get('sport');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: sport === 'NCAAF' ? [ncaafMatchup] : [] }),
    });
  });
  await page.route('**/api/reference-data/events/event-ncaaf/browse', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: ncaafBrowse }) }));
  await page.route('**/api/submissions', async (route) => {
    submitted.value = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { submissionId: 'sub-ncaaf', pickId: 'pick-ncaaf', lifecycleState: 'validated' } }) });
  });
}

test('mobile NCAAF moneyline preserves canonical IDs and Track Only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const submitted: { value: Record<string, unknown> | null } = { value: null };
  await routeNcaaf(page, submitted);
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByLabel('Date').fill('2026-09-01');
  await page.getByRole('button', { name: /TCU @ UNC/i }).click();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/02-authenticated-smart-form-shell.png', fullPage: true });
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/03-ncaaf-structured-matchup.png', fullPage: true });
  await page.getByRole('button', { name: /ML\s*Moneyline|Moneyline/i }).first().click();
  await page.getByRole('button', { name: /TCU Fanatics \+125/i }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await expect(page.getByText('Internal Tracking · Track Only', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/04-ncaaf-moneyline-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Pick Submitted')).toBeVisible();
  const metadata = submitted.value?.['metadata'] as Record<string, unknown>;
  expect(metadata['distributionMode']).toBe('track-only');
  expect(metadata['eventId']).toBe('event-ncaaf');
  expect(metadata['teamId']).toBe('team-tcu');
  expect(metadata['participantResolution']).toMatchObject({ resolution: 'canonical', sportId: 'NCAAF', eventId: 'event-ncaaf' });
});

test('mobile NCAAF player prop submits canonical event, team, and player IDs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const submitted: { value: Record<string, unknown> | null } = { value: null };
  await routeNcaaf(page, submitted);
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByLabel('Date').fill('2026-09-01');
  await page.getByRole('button', { name: /TCU @ UNC/i }).click();
  await page.getByRole('button', { name: /PROP\s*Player Prop|Player Prop/i }).first().click();
  await page.getByRole('button', { name: /TCU Filter players to this team/i }).click();
  await page.getByRole('button', { name: 'TCU Quarterback', exact: true }).click();
  await page.getByRole('button', { name: 'Over -110', exact: true }).click();
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expect(page.getByText('Pick Submitted')).toBeVisible();
  const metadata = submitted.value?.['metadata'] as Record<string, unknown>;
  expect(metadata).toMatchObject({
    distributionMode: 'track-only',
    eventId: 'event-ncaaf',
    teamId: 'team-tcu',
    playerId: 'player-tcu-qb',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'NCAAF',
      eventId: 'event-ncaaf',
      team: { participantId: 'team-tcu' },
      player: { participantId: 'player-tcu-qb', teamId: 'team-tcu' },
    },
  });
});

test('mobile NCAAF team selection filters incompatible players', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeNcaaf(page, { value: null });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByLabel('Date').fill('2026-09-01');
  await page.getByRole('button', { name: /TCU @ UNC/i }).click();
  await page.getByRole('button', { name: /PROP\s*Player Prop|Player Prop/i }).first().click();
  await page.getByRole('button', { name: /TCU Filter players to this team/i }).click();
  await expect(page.getByRole('button', { name: 'TCU Quarterback' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'UNC Quarterback' })).toHaveCount(0);
  await page.getByRole('button', { name: 'TCU Quarterback', exact: true }).click();
  await expect(page.getByPlaceholder('Type a player name')).toHaveValue('TCU Quarterback');
  await page.getByRole('button', { name: /UNC Filter players to this team/i }).click();
  await expect(page.getByPlaceholder('Type a player name')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'TCU Quarterback' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'UNC Quarterback' })).toBeVisible();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/05-ncaaf-team-player-filter-mobile.png', fullPage: true });
});

test('switching sports clears the selected canonical matchup', async ({ page }) => {
  await routeNcaaf(page, { value: null });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByLabel('Date').fill('2026-09-01');
  await page.getByRole('button', { name: /TCU @ UNC/i }).click();
  await expect(page.getByRole('button', { name: 'Change game' })).toBeVisible();

  await page.getByRole('button', { name: 'MLB' }).click();
  await expect(page.getByRole('button', { name: 'Change game' })).toHaveCount(0);
  await expect(page.getByText('TCU @ UNC', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No canonical matchups are available for 2026-09-01. Continue with Away Team and Home Team search below.')).toBeVisible();
});

test('desktop MLB structured canonical event entry remains available', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;
  const mlbMatchup = {
    eventId: 'event-mlb', externalId: 'mlb-1', eventName: 'Yankees @ Red Sox', eventDate: '2026-09-01',
    startTime: '2026-09-01T23:10:00.000Z', status: 'scheduled', sportId: 'MLB', leagueId: 'mlb',
    teams: [
      { participantId: 'team-yankees', teamId: 'team-yankees', displayName: 'Yankees', role: 'away' },
      { participantId: 'team-red-sox', teamId: 'team-red-sox', displayName: 'Red Sox', role: 'home' },
    ],
  };
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [mlbMatchup] }) }));
  await page.route('**/api/reference-data/events/event-mlb/browse', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...mlbMatchup, participants: [
    { participantId: 'team-yankees', canonicalId: 'team-yankees', participantType: 'team', displayName: 'Yankees', role: 'away', teamId: 'team-yankees', teamName: 'Yankees' },
    { participantId: 'team-red-sox', canonicalId: 'team-red-sox', participantType: 'team', displayName: 'Red Sox', role: 'home', teamId: 'team-red-sox', teamName: 'Red Sox' },
  ], offers: [] } }) }));
  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { submissionId: 'sub-mlb', pickId: 'pick-mlb', lifecycleState: 'validated' } }) });
  });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'MLB' }).click();
  await page.getByLabel('Date').fill('2026-09-01');
  await page.getByRole('button', { name: /Yankees @ Red Sox/i }).click();
  await expect(page.getByText('Yankees @ Red Sox', { exact: true })).toBeVisible();
  await expect(page.getByText('Internal Tracking · Track Only', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/06-mlb-structured-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /ML\s*Moneyline|Moneyline/i }).first().click();
  await page.getByRole('button', { name: /Yankees.*fanatics.*Manual odds/i }).click();
  await page.locator('input[name="odds"]').fill('-110');
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByTestId('smart-form-submit-button').first().click();
  await expect(page.getByText('Pick Submitted')).toBeVisible();

  const metadata = submittedPayload?.['metadata'] as Record<string, unknown>;
  expect(metadata).toMatchObject({
    distributionMode: 'track-only',
    eventId: 'event-mlb',
    teamId: 'team-yankees',
    participantResolution: {
      resolution: 'canonical',
      sportId: 'MLB',
      eventId: 'event-mlb',
      team: { participantId: 'team-yankees' },
    },
  });
});

test('manual participant override submits unresolved provenance without canonical IDs', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { submissionId: 'sub-manual', pickId: 'pick-manual', lifecycleState: 'validated' } }) });
  });
  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByRole('button', { name: 'Manual fallback' }).click();
  await page.getByRole('button', { name: "Can't find participants? Add manually" }).click();
  await expect(page.getByText('Manual participant override', { exact: true })).toBeVisible();
  await expect(page.getByText('Manual identities are explicitly tagged unresolved and never stored as canonical IDs.')).toBeVisible();
  await page.screenshot({ path: '../../docs/06_status/proof/UTV2-1787/07-manual-participant-override.png', fullPage: true });
  await page.getByRole('button', { name: /ML\s*Moneyline|Moneyline/i }).first().click();
  await page.getByLabel('Matchup').fill('Temple @ Navy');
  await page.getByPlaceholder('Type a team name').fill('Navy');
  await page.locator('input[name="odds"]').fill('-120');
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByTestId('smart-form-submit-button').first().click();
  await expect(page.getByText('Pick Submitted')).toBeVisible();

  const metadata = submittedPayload?.['metadata'] as Record<string, unknown>;
  expect(metadata['distributionMode']).toBe('track-only');
  expect(metadata['eventId']).toBeNull();
  expect(metadata['teamId']).toBeNull();
  expect(metadata['playerId']).toBeNull();
  expect(metadata['participantResolution']).toMatchObject({
    resolution: 'manual',
    sportId: 'NCAAF',
    eventId: null,
    manualOverride: true,
    reason: 'canonical-coverage-gap',
    enteredEventName: 'Temple @ Navy',
  });
});

test('structured manual entry rejects the same canonical participant on both sides', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog) }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.route('**/api/reference-data/search/teams?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [
      { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' },
      { participantId: 'team-unc', displayName: 'UNC', participantType: 'team' },
    ] }),
  }));

  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF' }).click();
  await page.getByRole('button', { name: 'Manual fallback' }).click();
  await page.getByLabel('Away Team').fill('TCU');
  await page.getByRole('button', { name: /TCU\s+team/i }).click();
  await page.getByLabel('Home Team').fill('TCU');
  await page.getByRole('button', { name: /TCU\s+team/i }).click();

  await expect(page.getByText('Choose a different participant', { exact: true })).toBeVisible();
  await expect(page.getByText('The same canonical participant cannot occupy both event sides.', { exact: true })).toBeVisible();
  await expect(page.getByText('Derived matchup', { exact: true })).toHaveCount(0);
});

test('non-team sport without a slate remains reachable through explicit manual provenance', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;
  const mmaCatalog = {
    data: {
      ...catalog.data,
      sports: [
        ...catalog.data.sports,
        { id: 'MMA', name: 'MMA', marketTypes: ['moneyline'], statTypes: [], teams: [] },
      ],
    },
  };
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mmaCatalog),
  }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [] }),
  }));
  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { submissionId: 'sub-mma', pickId: 'pick-mma', lifecycleState: 'validated' } }),
    });
  });

  await page.goto('/submit');
  await page.getByRole('button', { name: 'MMA', exact: true }).click();
  await expect(page.getByText('Manual event identity', { exact: true })).toBeVisible();
  await expect(page.getByText(/does not use canonical home\/away roles/i)).toBeVisible();
  await expect(page.getByText(/enter explicit manual event and competitor details below/i).first()).toBeVisible();
  await expect(page.getByLabel('Away Team')).toHaveCount(0);
  await expect(page.getByLabel('Home Team')).toHaveCount(0);
  await page.getByRole('button', { name: /Moneyline/i }).first().click();
  await page.getByLabel('Matchup').fill('Fighter A vs Fighter B');
  await page.getByLabel('Competitor').fill('Fighter A');
  await page.locator('input[name="odds"]').fill('-115');
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.getByTestId('smart-form-submit-button').first().click();
  await expect(page.getByText('Pick Submitted')).toBeVisible();

  const metadata = submittedPayload?.['metadata'] as Record<string, unknown>;
  expect(metadata['participantResolution']).toMatchObject({
    resolution: 'manual',
    sportId: 'MMA',
    eventId: null,
    manualOverride: true,
    enteredEventName: 'Fighter A vs Fighter B',
  });
});

test('editing a selected team as free text clears the dependent canonical player', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(catalog),
  }));
  await page.route('**/api/reference-data/matchups?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [] }),
  }));
  await page.route('**/api/reference-data/search/teams?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [
      { participantId: 'team-tcu', displayName: 'TCU', participantType: 'team' },
      { participantId: 'team-unc', displayName: 'UNC', participantType: 'team' },
    ] }),
  }));
  await page.route('**/api/reference-data/search/players?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [
      { participantId: 'player-tcu-qb', displayName: 'TCU Quarterback', participantType: 'player', teamId: 'team-tcu' },
    ] }),
  }));

  await page.goto('/submit');
  await page.getByRole('button', { name: 'NCAAF', exact: true }).click();
  await page.getByRole('button', { name: /Player Prop/i }).first().click();
  await page.getByLabel('Team', { exact: true }).fill('TCU');
  await page.getByRole('button', { name: /TCU\s+team/i }).last().click();
  await page.getByLabel('Player', { exact: true }).fill('TCU');
  await page.getByRole('button', { name: /TCU Quarterback/i }).click();
  await expect(page.getByLabel('Player', { exact: true })).toHaveValue('TCU Quarterback');

  await page.getByLabel('Team', { exact: true }).fill('UNC');
  await expect(page.getByLabel('Player', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Player', { exact: true })).toBeDisabled();
});
