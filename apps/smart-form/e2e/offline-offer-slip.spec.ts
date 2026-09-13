import { expect, test, type Page } from '@playwright/test';

// SYNTHETIC OFFLINE UI PROOF ONLY, never staging/persistence evidence.
// NFL archived pages audited 2026-09-13 contain no events. All fixture names
// and identities are fictional. Auth follows phase-one.spec.ts's inline helper.
test.use({ serviceWorkers: 'block' });
const fixture = {
  "label": "SYNTHETIC OFFLINE FIXTURE \u2014 NOT LIVE ODDS OR A REAL GAME",
  "classification": "synthetic staging candidate; staging not executed",
  "clock": "2026-09-13T20:05:00.000Z",
  "restrictions": [
    "Intercept local browser reference-data routes only.",
    "Do not submit fabricated canonical IDs to any connected API.",
    "Connected local proof must resolve IDs from the same in-memory repository the API validates.",
    "No production writes, SGO requests or member delivery."
  ],
  "matchups": {
    "data": [
      {
        "eventId": "STAGING-FIXTURE-SMART-FORM-NFL-EVENT",
        "externalId": "STAGING-FIXTURE-SMART-FORM-NFL-PROVIDER-EVENT",
        "eventName": "Fixture Away Football @ Fixture Home Football",
        "eventDate": "2026-09-13",
        "startTime": "2026-09-13T20:25:00.000Z",
        "status": "scheduled",
        "sportId": "NFL",
        "leagueId": "nfl",
        "teams": [
          {
            "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
            "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
            "displayName": "Fixture Away Football",
            "role": "away"
          },
          {
            "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
            "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
            "displayName": "Fixture Home Football",
            "role": "home"
          }
        ]
      }
    ]
  },
  "browse": {
    "data": {
      "eventId": "STAGING-FIXTURE-SMART-FORM-NFL-EVENT",
      "externalId": "STAGING-FIXTURE-SMART-FORM-NFL-PROVIDER-EVENT",
      "eventName": "Fixture Away Football @ Fixture Home Football",
      "eventDate": "2026-09-13",
      "startTime": "2026-09-13T20:25:00.000Z",
      "status": "scheduled",
      "sportId": "NFL",
      "leagueId": "nfl",
      "participants": [
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantType": "team",
          "displayName": "Fixture Away Football",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "participantType": "team",
          "displayName": "Fixture Home Football",
          "role": "home",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "teamName": "Fixture Home Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "participantType": "player",
          "displayName": "Fixture Quarterback",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        }
      ],
      "offers": [
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "moneyline",
          "marketDisplayName": "Moneyline",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantName": "Fixture Away Football",
          "line": null,
          "overOdds": 125,
          "underOdds": null,
          "snapshotAt": "2026-09-13T20:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-moneyline",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY"
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "spread",
          "marketDisplayName": "Spread",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantName": "Fixture Away Football",
          "line": -3.5,
          "overOdds": -110,
          "underOdds": null,
          "snapshotAt": "2026-09-13T20:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-spread",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY"
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "total",
          "marketDisplayName": "Total",
          "participantId": null,
          "participantName": null,
          "line": 47.5,
          "overOdds": -110,
          "underOdds": -110,
          "snapshotAt": "2026-09-13T20:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-total",
          "providerParticipantId": null
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "player.passing_yards",
          "marketDisplayName": "Passing Yards",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "participantName": "Fixture Quarterback",
          "line": 245.5,
          "overOdds": -115,
          "underOdds": -105,
          "snapshotAt": "2026-09-13T20:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-player.passing_yards",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB"
        }
      ]
    }
  },
  "emptyBrowse": {
    "data": {
      "eventId": "STAGING-FIXTURE-SMART-FORM-NFL-EVENT",
      "externalId": "STAGING-FIXTURE-SMART-FORM-NFL-PROVIDER-EVENT",
      "eventName": "Fixture Away Football @ Fixture Home Football",
      "eventDate": "2026-09-13",
      "startTime": "2026-09-13T20:25:00.000Z",
      "status": "scheduled",
      "sportId": "NFL",
      "leagueId": "nfl",
      "participants": [
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantType": "team",
          "displayName": "Fixture Away Football",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "participantType": "team",
          "displayName": "Fixture Home Football",
          "role": "home",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "teamName": "Fixture Home Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "participantType": "player",
          "displayName": "Fixture Quarterback",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        }
      ],
      "offers": []
    }
  },
  "staleBrowse": {
    "data": {
      "eventId": "STAGING-FIXTURE-SMART-FORM-NFL-EVENT",
      "externalId": "STAGING-FIXTURE-SMART-FORM-NFL-PROVIDER-EVENT",
      "eventName": "Fixture Away Football @ Fixture Home Football",
      "eventDate": "2026-09-13",
      "startTime": "2026-09-13T20:25:00.000Z",
      "status": "scheduled",
      "sportId": "NFL",
      "leagueId": "nfl",
      "participants": [
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantType": "team",
          "displayName": "Fixture Away Football",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "participantType": "team",
          "displayName": "Fixture Home Football",
          "role": "home",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-HOME",
          "teamName": "Fixture Home Football"
        },
        {
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "canonicalId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "participantType": "player",
          "displayName": "Fixture Quarterback",
          "role": "away",
          "teamId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "teamName": "Fixture Away Football"
        }
      ],
      "offers": [
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "moneyline",
          "marketDisplayName": "Moneyline",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantName": "Fixture Away Football",
          "line": null,
          "overOdds": 125,
          "underOdds": null,
          "snapshotAt": "2026-09-13T18:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-moneyline",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY"
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "spread",
          "marketDisplayName": "Spread",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY",
          "participantName": "Fixture Away Football",
          "line": -3.5,
          "overOdds": -110,
          "underOdds": null,
          "snapshotAt": "2026-09-13T18:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-spread",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-AWAY"
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "total",
          "marketDisplayName": "Total",
          "participantId": null,
          "participantName": null,
          "line": 47.5,
          "overOdds": -110,
          "underOdds": -110,
          "snapshotAt": "2026-09-13T18:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-total",
          "providerParticipantId": null
        },
        {
          "sportsbookId": "fanatics",
          "sportsbookName": "Fanatics",
          "marketTypeId": "player.passing_yards",
          "marketDisplayName": "Passing Yards",
          "participantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB",
          "participantName": "Fixture Quarterback",
          "line": 245.5,
          "overOdds": -115,
          "underOdds": -105,
          "snapshotAt": "2026-09-13T18:00:00.000Z",
          "providerKey": "staging-fixture",
          "providerMarketKey": "STAGING-FIXTURE-SMART-FORM-NFL-player.passing_yards",
          "providerParticipantId": "STAGING-FIXTURE-SMART-FORM-NFL-QB"
        }
      ]
    }
  }
} as const;

type Submission = { source: string; submittedBy?: string; market: string; odds: number; line?: number; metadata: Record<string, unknown> };
async function installOfflineFixture(page: Page) {
  const submitted: Submission[] = [];
  const denied: string[] = [];
  await page.clock.setFixedTime(new Date(fixture.clock));
  await page.addInitScript(() => {
    const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    localStorage.setItem('ut_capper_token', `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'griff843', capperId: 'griff843', displayName: 'Griff Test', role: 'capper', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`);
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      denied.push(url.origin);
      return route.abort('blockedbyclient');
    }
    const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/session') return fulfill({ user: { name: 'Griff Test' }, capperId: 'griff843', expires: '2026-09-14T20:05:00.000Z' });
    if (url.pathname === '/api/reference-data/catalog') return fulfill({ data: {
      sports: [{ id: 'NFL', name: 'NFL', marketTypes: ['player-prop', 'moneyline', 'spread', 'total', 'team-total'], statTypes: ['Passing Yards', 'Rushing Yards', 'Receiving Yards'], teams: [] }],
      sportsbooks: [{ id: 'fanatics', name: 'Fanatics' }], ticketTypes: [], cappers: [{ id: 'griff843', displayName: 'Griff Test' }],
    } });
    if (url.pathname === '/api/reference-data/availability') return fulfill({ data: { sportId: 'NFL', teamsAvailable: true, playersAvailable: true } });
    if (url.pathname === '/api/reference-data/matchups') return fulfill(fixture.matchups);
    if (url.pathname === `/api/reference-data/events/${fixture.browse.data.eventId}/browse`) return fulfill(fixture.browse);
    if (url.pathname === '/api/reference-data/leagues') return fulfill({ data: [{ id: 'nfl', sportId: 'NFL', displayName: 'NFL' }] });
    if (url.pathname.startsWith('/api/reference-data/')) return fulfill({ data: [] });
    if (url.pathname === '/api/submissions' && route.request().method() === 'POST') {
      const authorization = route.request().headers()['authorization'];
      expect(authorization).toMatch(/^Bearer /);
      const claims = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString());
      expect(claims).toMatchObject({ capperId: 'griff843', role: 'capper' });
      submitted.push(route.request().postDataJSON() as Submission);
      return fulfill({ data: { submissionId: 'STAGING-FIXTURE-SIMULATED-SUBMISSION', pickId: 'STAGING-FIXTURE-SIMULATED-PICK', lifecycleState: 'validated' } });
    }
    if (url.pathname.startsWith('/api/')) return fulfill({ error: { message: 'Offline fixture endpoint unavailable' } }, 501);
    return route.continue(); // Local document/static assets only; no API passthrough.
  });
  return { submitted, denied };
}

const cases = [
  { name: 'moneyline', marketButton: /ML\s*Moneyline|Moneyline/i, offerButton: /Fixture Away Football Fanatics \+125/i, market: 'moneyline', odds: 125, line: null, offerIndex: 0 },
  { name: 'negative spread', marketButton: /Spread/i, offerButton: /Fixture Away Football Fanatics -3.5 -110/i, market: 'spread', odds: -110, line: -3.5, offerIndex: 1 },
  { name: 'total under', marketButton: /Total/i, offerButton: /^Under -110$/, market: 'total', odds: -110, line: 47.5, offerIndex: 2 },
  { name: 'passing yards over', marketButton: /PROP\s*Player Prop|Player Prop/i, offerButton: /^Over -115$/, market: 'player.passing_yards', odds: -115, line: 245.5, offerIndex: 3 },
] as const;
for (const scenario of cases) {
  test(`offline synthetic NFL ${scenario.name} reaches the Track Only slip`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { submitted, denied } = await installOfflineFixture(page);
    await page.goto('/submit');
    await page.getByRole('button', { name: 'Browse offers', exact: true }).click();
    await page.getByRole('button', { name: 'NFL', exact: true }).click();
    await page.getByLabel('Date', { exact: true }).fill('2026-09-13');
    await page.getByRole('button', { name: /Fixture Away Football @ Fixture Home Football/i }).click();
    await page.getByRole('button', { name: scenario.marketButton }).first().click();
    if (scenario.offerIndex === 3) {
      await page.getByRole('button', { name: /Fixture Away Football Filter players to this team/i }).click();
      await page.getByRole('button', { name: 'Fixture Quarterback', exact: true }).click();
    }
    await page.getByRole('button', { name: scenario.offerButton }).click();
    await expect(page.getByLabel('Odds', { exact: true })).toHaveValue(scenario.odds > 0 ? '+' + scenario.odds : String(scenario.odds));
    const selectionText = ['Fixture Away Football', 'Fixture Away Football -3.5', 'U 47.5', 'Fixture Quarterback Passing Yards O 245.5'][scenario.offerIndex];
    await expect(page.getByText(selectionText, { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: '8', exact: true }).click();
    await expect(page.getByText('Track Only · Internal', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    await expect(page.getByText('Pick Saved', { exact: true })).toBeVisible();
    const payload = submitted[0];
    const offer = fixture.browse.data.offers[scenario.offerIndex];
    expect(payload).toMatchObject({ source: 'smart-form', submittedBy: 'griff843', market: scenario.market, odds: scenario.odds });
    if (scenario.line !== null) expect(payload.line).toBe(scenario.line);
    expect(payload.metadata).toMatchObject({
      capper: 'griff843', distributionMode: 'track-only', submissionMode: 'live-offer', eventId: fixture.browse.data.eventId, sportsbook: 'fanatics',
      selectedOffer: { providerKey: 'staging-fixture', providerMarketKey: offer.providerMarketKey, providerParticipantId: offer.providerParticipantId, snapshotAt: offer.snapshotAt },
      participantResolution: { resolution: 'canonical', sportId: 'NFL', eventId: fixture.browse.data.eventId },
    });
    if (scenario.offerIndex === 3) expect(payload.metadata).toMatchObject({ teamId: 'STAGING-FIXTURE-SMART-FORM-NFL-AWAY', playerId: 'STAGING-FIXTURE-SMART-FORM-NFL-QB', overUnder: 'over' });
    if (scenario.offerIndex === 2) expect(payload.metadata.overUnder).toBe('under');
    expect(denied, 'No nonlocal request should be attempted').toEqual([]);
  });
}
