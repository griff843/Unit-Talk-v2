import { expect, test } from '@playwright/test';

const catalogResponse = {
  data: {
    sports: [
      {
        id: 'NBA',
        name: 'NBA',
        marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'],
        statTypes: ['Points', 'Assists', 'Points + Assists'],
        teams: [],
      },
      {
        id: 'NFL',
        name: 'NFL',
        marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'],
        statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards'],
        teams: [],
      },
    ],
    sportsbooks: [
      { id: 'fanatics', name: 'Fanatics' },
      { id: 'draftkings', name: 'DraftKings' },
      { id: 'williamhill', name: 'William Hill' },
      { id: 'sgo', name: 'SGO' },
    ],
    ticketTypes: [],
    cappers: [
      { id: 'griff843', displayName: 'griff843' },
      { id: 'unittalkbot', displayName: 'Unit Talk Bot' },
    ],
  },
};

const matchupResponse = {
  data: [
    {
      eventId: 'evt-1',
      externalId: 'nba-evt-1',
      eventName: 'Nuggets vs Jazz',
      eventDate: '2026-04-02T23:00:00.000Z',
      status: 'scheduled',
      sportId: 'NBA',
      leagueId: 'nba',
      teams: [
        { participantId: 'team-jazz', teamId: 'team-jazz', displayName: 'Jazz', role: 'away' },
        { participantId: 'team-nuggets', teamId: 'team-nuggets', displayName: 'Nuggets', role: 'home' },
      ],
    },
  ],
};

const eventBrowseResponse = {
  data: {
    eventId: 'evt-1',
    externalId: 'nba-evt-1',
    eventName: 'Nuggets vs Jazz',
    eventDate: '2026-04-02T23:00:00.000Z',
    status: 'scheduled',
    sportId: 'NBA',
    leagueId: 'nba',
    participants: [
      {
        participantId: 'team-nuggets',
        canonicalId: 'team-nuggets',
        participantType: 'team',
        displayName: 'Nuggets',
        role: 'home',
        teamId: 'team-nuggets',
        teamName: 'Nuggets',
      },
      {
        participantId: 'team-jazz',
        canonicalId: 'team-jazz',
        participantType: 'team',
        displayName: 'Jazz',
        role: 'away',
        teamId: 'team-jazz',
        teamName: 'Jazz',
      },
      {
        participantId: 'player-jamal',
        canonicalId: 'player-jamal',
        participantType: 'player',
        displayName: 'Jamal Murray',
        role: 'home',
        teamId: 'team-nuggets',
        teamName: 'Nuggets',
      },
    ],
    offers: [
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'player.assists',
        marketDisplayName: 'Player Assists',
        participantId: 'player-jamal',
        participantName: 'Jamal Murray',
        line: 7,
        overOdds: -140,
        underOdds: 115,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-player-assists',
        providerParticipantId: 'provider-jamal',
      },
    ],
  },
};

const nbaLookupMatchupsResponse = {
  data: [
    {
      eventId: 'evt-celtics',
      externalId: 'nba-evt-celtics',
      eventName: 'Celtics vs Knicks',
      eventDate: '2026-04-02',
      status: 'scheduled',
      sportId: 'NBA',
      leagueId: 'nba',
      teams: [
        { participantId: 'team-celtics-participant', teamId: 'team-celtics', displayName: 'Celtics', role: 'home' },
        { participantId: 'team-knicks-participant', teamId: 'team-knicks', displayName: 'Knicks', role: 'away' },
      ],
    },
    {
      eventId: 'evt-lakers',
      externalId: 'nba-evt-lakers',
      eventName: 'Lakers vs Bulls',
      eventDate: '2026-04-02',
      status: 'scheduled',
      sportId: 'NBA',
      leagueId: 'nba',
      teams: [
        { participantId: 'team-lakers-participant', teamId: 'team-lakers', displayName: 'Lakers', role: 'home' },
        { participantId: 'team-bulls-participant', teamId: 'team-bulls', displayName: 'Bulls', role: 'away' },
      ],
    },
  ],
};

const nbaLookupEventBrowseResponse = {
  data: {
    eventId: 'evt-celtics',
    externalId: 'nba-evt-celtics',
    eventName: 'Celtics vs Knicks',
    eventDate: '2026-04-02',
    status: 'scheduled',
    sportId: 'NBA',
    leagueId: 'nba',
    participants: [
      {
        participantId: 'team-celtics-participant',
        canonicalId: 'team-celtics',
        participantType: 'team',
        displayName: 'Celtics',
        role: 'home',
        teamId: 'team-celtics',
        teamName: 'Celtics',
      },
      {
        participantId: 'team-knicks-participant',
        canonicalId: 'team-knicks',
        participantType: 'team',
        displayName: 'Knicks',
        role: 'away',
        teamId: 'team-knicks',
        teamName: 'Knicks',
      },
      {
        participantId: 'player-tatum',
        canonicalId: 'player-tatum',
        participantType: 'player',
        displayName: 'Jayson Tatum',
        role: 'home',
        teamId: 'team-celtics',
        teamName: 'Celtics',
      },
      {
        participantId: 'player-brown',
        canonicalId: 'player-brown',
        participantType: 'player',
        displayName: 'Jaylen Brown',
        role: 'home',
        teamId: 'team-celtics',
        teamName: 'Celtics',
      },
      {
        participantId: 'player-brunson',
        canonicalId: 'player-brunson',
        participantType: 'player',
        displayName: 'Jalen Brunson',
        role: 'away',
        teamId: 'team-knicks',
        teamName: 'Knicks',
      },
    ],
    offers: [
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'moneyline',
        marketDisplayName: 'Moneyline',
        participantId: 'team-celtics-participant',
        participantName: 'Celtics',
        line: null,
        overOdds: -135,
        underOdds: null,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-moneyline-celtics',
        providerParticipantId: 'team-celtics',
      },
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'moneyline',
        marketDisplayName: 'Moneyline',
        participantId: 'team-knicks-participant',
        participantName: 'Knicks',
        line: null,
        overOdds: 115,
        underOdds: null,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-moneyline-knicks',
        providerParticipantId: 'team-knicks',
      },
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'game_spread',
        marketDisplayName: 'Spread',
        participantId: 'team-celtics-participant',
        participantName: 'Celtics',
        line: -4.5,
        overOdds: -110,
        underOdds: null,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-spread-celtics',
        providerParticipantId: 'team-celtics',
      },
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'game_spread',
        marketDisplayName: 'Spread',
        participantId: 'team-knicks-participant',
        participantName: 'Knicks',
        line: 4.5,
        overOdds: -110,
        underOdds: null,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-spread-knicks',
        providerParticipantId: 'team-knicks',
      },
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'game_total',
        marketDisplayName: 'Total',
        participantId: null,
        participantName: null,
        line: 227.5,
        overOdds: -108,
        underOdds: -112,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-total',
        providerParticipantId: null,
      },
      {
        sportsbookId: 'fanatics',
        sportsbookName: 'Fanatics',
        marketTypeId: 'player.points',
        marketDisplayName: 'Player Points',
        participantId: 'player-tatum',
        participantName: 'Jayson Tatum',
        line: 29.5,
        overOdds: -110,
        underOdds: -110,
        snapshotAt: '2026-04-02T22:55:00.000Z',
        providerKey: 'sgo',
        providerMarketKey: 'nba-player-points',
        providerParticipantId: 'provider-tatum',
      },
    ],
  },
};

const nbaLookupBrowseSearchResponse = {
  data: [
    {
      resultType: 'player',
      participantId: 'player-tatum',
      displayName: 'Jayson Tatum',
      contextLabel: 'Celtics · Knicks @ Celtics · Apr 2',
      teamId: 'team-celtics',
      teamName: 'Celtics',
      matchup: nbaLookupMatchupsResponse.data[0],
    },
    {
      resultType: 'team',
      participantId: 'team-celtics',
      displayName: 'Celtics',
      contextLabel: 'NBA · Apr 2',
      teamId: 'team-celtics',
      teamName: 'Celtics',
      matchup: nbaLookupMatchupsResponse.data[0],
    },
  ],
};

const browseSearchResponse = {
  data: [
    {
      resultType: 'player',
      participantId: 'player-jamal',
      displayName: 'Jamal Murray',
      contextLabel: 'Nuggets · Jazz @ Nuggets · Apr 2, 11:00 PM',
      teamId: 'team-nuggets',
      teamName: 'Nuggets',
      matchup: matchupResponse.data[0],
    },
    {
      resultType: 'matchup',
      participantId: null,
      displayName: 'Jazz @ Nuggets',
      contextLabel: 'NBA · Apr 2, 11:00 PM',
      teamId: null,
      teamName: null,
      matchup: matchupResponse.data[0],
    },
  ],
};

test('live-offer search flow supports canonical entity selection and successful submission', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(matchupResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-1/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(eventBrowseResponse),
    });
  });

  await page.route('**/api/reference-data/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(browseSearchResponse),
    });
  });

  await page.route('**/api/reference-data/search/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          submissionId: 'sub_test_123',
          pickId: 'pick_test_123',
          lifecycleState: 'validated',
        },
      }),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await expect(page.getByPlaceholder('Search capper')).toHaveValue('griff843');

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Search canonical players, teams, and matchups for NBA on 2026-04-02.')).toBeVisible();

  await page.getByPlaceholder('Type a player, team, or matchup').fill('Jam');
  await expect(page.getByRole('button', { name: /Jamal Murray/i })).toBeVisible();
  await expect(page.getByText('Nuggets · Jazz @ Nuggets · Apr 2, 11:00 PM')).toBeVisible();
  await page.getByRole('button', { name: /Jamal Murray/i }).click();

  await expect(page.getByRole('button', { name: /PROP Player Prop/i }).first()).toBeVisible();
  await expect(page.locator('p.text-sm.font-semibold.text-foreground', { hasText: 'Nuggets vs Jazz' })).toBeVisible();
  await page.getByRole('button', { name: 'Over -140' }).click();

  await expect(page.getByText('Conviction (1-10)', { exact: true })).toBeVisible();
  await expect(page.locator('input[name="capperConviction"]')).toBeVisible();
  await expect(page.getByText('How confident are you in this pick? (1 = low, 10 = highest conviction)')).toBeVisible();
  await expect(page.getByText('Teasers').first()).toBeVisible();

  await page.getByPlaceholder('Search sportsbook').click();
  await expect(page.getByRole('button', { name: /Fanatics/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /William Hill/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /SGO/i })).toHaveCount(0);
  await page.getByText('Book not listed? Type it').click();
  await page.getByPlaceholder('Type sportsbook name').fill('PrizePicks');

  await page.getByRole('button', { name: 'Submit Pick' }).first().click();
  await expect(page.getByText('Conviction must be a number')).toBeVisible();

  await page.locator('input[name="capperConviction"]').fill('8');
  await page.locator('input[name="units"]').fill('1');

  await page.getByRole('button', { name: 'Submit Pick' }).first().click();

  await expect(page.getByText('Pick Submitted')).toBeVisible();
  await expect(page.getByText('pick_test_123')).toBeVisible();
  await expect(page.getByText('Conviction')).toBeVisible();
  await expect(page.getByText('8/10')).toBeVisible();

  expect(submittedPayload).not.toBeNull();
  expect(submittedPayload?.market).toBe('player.assists');
  expect(submittedPayload?.confidence).toBe(0.8);
  expect(submittedPayload?.metadata).toMatchObject({
    eventId: 'evt-1',
    submissionMode: 'live-offer',
    playerId: 'player-jamal',
    capperConviction: 8,
    promotionScores: {
      trust: 80,
    },
    selectedOffer: {
      providerKey: 'sgo',
      providerMarketKey: 'nba-player-assists',
      providerParticipantId: 'provider-jamal',
    },
    manualEntry: true,
    manualOverrideFields: ['sportsbook'],
  });
  expect(submittedPayload?.metadata).toMatchObject({
    sportsbook: 'PrizePicks',
    sportsbookId: null,
  });
});

test('manual fallback surfaces the current free-text matchup warning', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/reference-data/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/reference-data/search/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await page.getByRole('button', { name: 'Manual fallback' }).click();

  await expect(page.getByText('Manual fallback is active. Matchup is still required, and current fallback uses free-text event entry until structured matchup selection is available.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Pick' }).first()).toBeEnabled();
});

test('selected matchup constrains participant choices and valid stat types', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(matchupResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-1/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(eventBrowseResponse),
    });
  });

  await page.route('**/api/operator/participants?**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const participantType = requestUrl.searchParams.get('participantType');

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: participantType === 'player'
          ? [
              {
                participantId: 'player-jamal',
                displayName: 'Jamal Murray',
                participantType: 'player',
              },
              {
                participantId: 'player-lebron',
                displayName: 'LeBron James',
                participantType: 'player',
              },
            ]
          : [],
      }),
    });
  });

  await page.goto('/submit');

  await expect(page.getByText('Select a sport first')).toBeVisible();

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await page.getByRole('button', { name: /Jazz @ Nuggets/i }).click();
  await page.getByRole('button', { name: /PROP Player Prop/i }).first().click();

  await page.getByRole('combobox', { name: 'Stat Type' }).click();
  await expect(page.getByRole('option', { name: 'Assists' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Points' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Passing Yards' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByPlaceholder('Type a player name').fill('Ja');
  await expect(page.getByRole('button', { name: /Jamal Murray/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /LeBron James/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'NFL' }).click();
  await page.getByRole('button', { name: /PROP Player Prop/i }).first().click();
  await page.getByRole('combobox', { name: 'Stat Type' }).click();
  await expect(page.getByRole('option', { name: 'Passing Yards' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Assists' })).toHaveCount(0);
});

test('player-prop flow auto-binds team and matchup from player or team selection', async ({ page }) => {
  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupMatchupsResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-celtics/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupEventBrowseResponse),
    });
  });

  await page.route('**/api/reference-data/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupBrowseSearchResponse),
    });
  });

  await page.route('**/api/reference-data/search/players?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            participantId: 'player-tatum',
            displayName: 'Jayson Tatum',
            participantType: 'player',
          },
        ],
      }),
    });
  });

  await page.route('**/api/reference-data/search/teams?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            participantId: 'team-celtics',
            displayName: 'Celtics',
            participantType: 'team',
          },
        ],
      }),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await expect(page.locator('input[placeholder="Search sportsbook"]')).toHaveValue('Fanatics');
  await expect(page.getByRole('button', { name: /ML\s*Moneyline/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /SPR\s*Spread/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /TOT\s*Total/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /T-TOT\s*Team Total/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /PROP Player Prop/i }).first().click();

  await page.getByPlaceholder('Type a player name').fill('Jays');
  await page.getByRole('button', { name: /Jayson Tatum/i }).click();

  await expect(page.getByText('Pick Details')).toHaveCount(0);
  await expect(page.getByLabel('Team')).toHaveValue('Celtics');
  await expect(page.getByLabel('Player')).toHaveValue('Jayson Tatum');
  await expect(page.locator('p.text-sm.font-semibold.text-foreground', { hasText: 'Celtics vs Knicks' })).toBeVisible();
  await expect(page.getByText('Apr 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Stat Type' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jayson Tatum' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jaylen Brown' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jalen Brunson' })).toHaveCount(0);

});

test('moneyline flow uses sportsbook-first filtering and matchup teams instead of free-text winner entry', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupMatchupsResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-celtics/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupEventBrowseResponse),
    });
  });

  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          submissionId: 'sub_moneyline_123',
          pickId: 'pick_moneyline_123',
          lifecycleState: 'validated',
        },
      }),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await expect(page.locator('input[placeholder="Search sportsbook"]')).toHaveValue('Fanatics');
  await page.getByRole('button', { name: /Knicks @ Celtics/i }).click();
  await expect(page.getByRole('button', { name: /Bulls @ Lakers/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change game' })).toBeVisible();
  await page.getByRole('button', { name: /ML\s*Moneyline/i }).first().click();

  await expect(page.getByText('Pick Details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Celtics Fanatics -135/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Knicks Fanatics \+115/i })).toBeVisible();
  await expect(page.getByText('-135')).toBeVisible();
  await expect(page.getByText('+115')).toBeVisible();
  await expect(page.getByLabel('Team to Win')).toHaveCount(0);

  await page.getByRole('button', { name: /Celtics Fanatics -135/i }).click();
  await expect(page.locator('input[name="odds"]')).toHaveValue('-135');
  await page.locator('input[name="capperConviction"]').fill('8');
  await page.locator('input[name="units"]').fill('1');
  await page.getByRole('button', { name: 'Submit Pick' }).first().click();

  await expect(page.getByText('Pick Submitted')).toBeVisible();
  expect(submittedPayload).not.toBeNull();
  expect(submittedPayload?.market).toBe('moneyline');
  expect(submittedPayload?.selection).toContain('Celtics');
});

test('spread flow collapses the slate and preloads side, line, and odds from live offers', async ({ page }) => {
  let submittedPayload: Record<string, unknown> | null = null;

  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupMatchupsResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-celtics/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupEventBrowseResponse),
    });
  });

  await page.route('**/api/submissions', async (route) => {
    submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          submissionId: 'sub_spread_123',
          pickId: 'pick_spread_123',
          lifecycleState: 'validated',
        },
      }),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await expect(page.locator('input[placeholder="Search sportsbook"]')).toHaveValue('Fanatics');
  await page.getByRole('button', { name: /Knicks @ Celtics/i }).click();

  await expect(page.getByRole('button', { name: /Bulls @ Lakers/i })).toHaveCount(0);
  await page.getByRole('button', { name: /SPR\s*Spread/i }).first().click();

  await expect(page.getByText('Pick Details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Celtics.*-4.5.*-110/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Knicks.*\+4.5.*-110/i })).toBeVisible();

  await page.getByRole('button', { name: /Celtics.*-4.5.*-110/i }).click();
  await expect(page.locator('input[name="odds"]')).toHaveValue('-110');
  await page.locator('input[name="capperConviction"]').fill('8');
  await page.locator('input[name="units"]').fill('1');
  await page.getByRole('button', { name: 'Submit Pick' }).first().click();

  await expect(page.getByText('Pick Submitted')).toBeVisible();
  expect(submittedPayload).not.toBeNull();
  expect(submittedPayload?.market).toBe('game_spread');
  expect(submittedPayload?.selection).toContain('Celtics -4.5');
});

test('spread fallback keeps the selected matchup compact when live offers are missing', async ({ page }) => {
  const spreadlessEventBrowseResponse = {
    data: {
      ...nbaLookupEventBrowseResponse.data,
      offers: nbaLookupEventBrowseResponse.data.offers.filter((offer) => offer.marketTypeId !== 'game_spread'),
    },
  };

  await page.route('**/api/reference-data/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogResponse),
    });
  });

  await page.route('**/api/reference-data/matchups?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nbaLookupMatchupsResponse),
    });
  });

  await page.route('**/api/reference-data/events/evt-celtics/browse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(spreadlessEventBrowseResponse),
    });
  });

  await page.goto('/submit');

  await page.getByRole('button', { name: 'NBA' }).click();
  await page.getByLabel('Date').fill('2026-04-02');
  await page.getByRole('button', { name: /Knicks @ Celtics/i }).click();
  await page.getByRole('button', { name: /Spread/i }).first().click();

  await expect(page.getByText('No live offers for this market.')).toBeVisible();
  await expect(page.getByText('Market Family')).toHaveCount(1);
  await expect(page.getByText('Matchup locked from Browse Setup: Knicks @ Celtics')).toBeVisible();
  await expect(page.getByRole('button', { name: /Celtics.*Enter line/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Knicks.*Enter line/i })).toBeVisible();
  await expect(page.getByLabel('Matchup')).toHaveCount(0);
  await expect(page.getByLabel('Team')).toHaveCount(0);
});
