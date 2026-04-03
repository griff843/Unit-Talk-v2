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
    ],
    ticketTypes: [],
    cappers: [{ id: 'griff843', displayName: 'griff843' }],
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

  await page.getByRole('button', { name: 'Submit Pick' }).first().click();
  await expect(page.getByText('Conviction must be a number')).toBeVisible();

  await page.locator('input[name="capperConviction"]').fill('8');
  await page.locator('input[name="units"]').fill('1');
  await page.getByPlaceholder('Search capper').fill('grif');
  await page.getByRole('button', { name: /griff843/i }).click();

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
    sportsbookId: 'fanatics',
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
