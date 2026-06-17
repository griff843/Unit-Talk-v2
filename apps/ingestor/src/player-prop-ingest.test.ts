import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';
import { fetchAndPairSGOProps } from './sgo-fetcher.js';
import { ingestLeague } from './ingest-league.js';
import { normalizeSGOPairedProp } from './sgo-normalizer.js';
import {
  SGO_PLAYER_PROP_ODD_ID_PATTERNS,
  buildSgoOddsRequestUrl,
} from './sgo-request-contract.js';

/*
 * UTV2-1275 Wave 1 — SGO player-prop ingestion.
 *
 * Proves the player-prop fetch path is (a) distinct from the game-line fetch,
 * (b) never Pinnacle-only, (c) uses the MLB PLAYER_ID oddID patterns, (d) preserves
 * provider_participant_id through the parser/normalizer, and (e) runs every cycle
 * even under peak Pinnacle-only game-line polling (freshness).
 */

const EMPTY_SGO_RESPONSE = () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

// --- request-contract level (pure URL construction) -----------------------

test('buildSgoOddsRequestUrl: player-prop patterns set oddID and never Pinnacle-only', () => {
  const url = buildSgoOddsRequestUrl({
    apiKey: 'k',
    league: 'MLB',
    snapshotAt: '2026-06-13T18:00:00.000Z',
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
    pinnacleOnly: true, // must be ignored when prop patterns are present
    includeOpenCloseOdds: true,
  });
  const oddId = url.searchParams.get('oddID') ?? '';
  assert.ok(oddId.includes('PLAYER_ID'), 'oddID must use PLAYER_ID wildcard');
  assert.ok(oddId.includes('batting_hits-PLAYER_ID-game-ou-over'));
  assert.equal(
    url.searchParams.get('bookmakerID'),
    null,
    'player-prop request must NOT be Pinnacle-only',
  );
  assert.equal(url.searchParams.get('includeOpenCloseOdds'), 'true');
  assert.equal(url.searchParams.get('oddsAvailable'), 'true');
});

test('buildSgoOddsRequestUrl: game-line Pinnacle-only path is distinct (bookmakerID, no oddID)', () => {
  const url = buildSgoOddsRequestUrl({
    apiKey: 'k',
    league: 'MLB',
    snapshotAt: '2026-06-13T18:00:00.000Z',
    pinnacleOnly: true,
  });
  assert.equal(url.searchParams.get('bookmakerID'), 'pinnacle');
  assert.equal(url.searchParams.get('oddID'), null);
});

test('MLB PLAYER_ID patterns are defined and player-shaped', () => {
  const patterns = SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB;
  assert.ok(patterns.length > 0);
  for (const pattern of patterns) {
    assert.ok(pattern.includes('-PLAYER_ID-'), `${pattern} must use PLAYER_ID`);
    assert.ok(pattern.startsWith('batting_'), `${pattern} should be an MLB batting stat`);
  }
});

// --- fetcher level (forwarding) -------------------------------------------

test('fetchAndPairSGOProps forwards player-prop patterns and open/close on a live fetch', async () => {
  let capturedUrl: URL | null = null;
  await fetchAndPairSGOProps({
    apiKey: 'test-key',
    league: 'MLB',
    snapshotAt: '2026-06-13T18:00:00.000Z',
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
    includeOpenCloseOdds: true,
    pinnacleOnly: true, // ignored — prop patterns win
    fetchImpl: async (input) => {
      capturedUrl = new URL(String(input));
      return EMPTY_SGO_RESPONSE();
    },
  });
  const url = capturedUrl as URL | null;
  assert.ok(url);
  assert.ok((url.searchParams.get('oddID') ?? '').includes('PLAYER_ID'));
  assert.equal(url.searchParams.get('bookmakerID'), null);
  assert.equal(url.searchParams.get('includeOpenCloseOdds'), 'true');
  assert.equal(url.searchParams.get('finalized'), null);
});

// --- parser / normalizer (identity preservation) --------------------------

test('MLB batting prop preserves provider_participant_id through parse + normalize', async () => {
  const result = await fetchAndPairSGOProps({
    apiKey: 'test-key',
    league: 'MLB',
    snapshotAt: '2026-06-13T18:00:00.000Z',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              eventID: 'evt-mlb-prop-1',
              leagueID: 'MLB',
              status: {
                oddsAvailable: true,
                startsAt: '2026-06-13T23:00:00.000Z',
              },
              odds: {
                'batting_hits-ALEC_BOHM_1_MLB-game-ou-over': {
                  oddID: 'batting_hits-ALEC_BOHM_1_MLB-game-ou-over',
                  playerID: 'ALEC_BOHM_1_MLB',
                  bookOverUnder: '1.5',
                  bookOdds: '-120',
                  byBookmaker: {
                    fanduel: { odds: '-118', overUnder: '1.5' },
                  },
                },
                'batting_hits-ALEC_BOHM_1_MLB-game-ou-under': {
                  oddID: 'batting_hits-ALEC_BOHM_1_MLB-game-ou-under',
                  playerID: 'ALEC_BOHM_1_MLB',
                  bookOverUnder: '1.5',
                  bookOdds: '-110',
                  byBookmaker: {
                    fanduel: { odds: '-112', overUnder: '1.5' },
                  },
                },
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  assert.ok(result.pairedProps.length > 0, 'expected paired props from a non-Pinnacle book');
  const battingProp = result.pairedProps.find((prop) =>
    prop.marketKey.startsWith('batting_hits-'),
  );
  assert.ok(battingProp, 'batting prop should be parsed');

  const normalized = normalizeSGOPairedProp(battingProp);
  assert.ok(normalized, 'batting prop should normalize');
  assert.equal(
    normalized.providerParticipantId,
    'ALEC_BOHM_1_MLB',
    'player identity must be preserved as provider_participant_id',
  );
  assert.equal(normalized.providerEventId, 'evt-mlb-prop-1');
});

// --- ingest-league split + freshness --------------------------------------

/** A game-line response carrying a single imminent MLB event for the slate. */
const gameLineSlateResponse = (snapshotAt: string, eventId: string) =>
  new Response(
    JSON.stringify({
      data: [
        {
          eventID: eventId,
          leagueID: 'MLB',
          status: {
            oddsAvailable: true,
            // ~5h ahead of the snapshot — inside the imminent player-prop window.
            startsAt: new Date(Date.parse(snapshotAt) + 5 * 3_600_000).toISOString(),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

test('ingestLeague issues a separate non-Pinnacle player-prop request every cycle, event-scoped to the slate (UTV2-1281)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const snapshotAt = '2026-06-13T18:00:00.000Z';
  const eventId = 'evt-mlb-slate-1';
  const oddsUrls: URL[] = [];

  await ingestLeague('MLB', 'test-key', repositories, {
    snapshotAt,
    skipResults: true,
    pinnacleOnly: true, // simulate peak window
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (!url.searchParams.has('leagueID')) {
        return EMPTY_SGO_RESPONSE();
      }
      oddsUrls.push(url);
      // The game-line request is the Pinnacle-only one; return the slate event so
      // the player-prop fetch has events to scope to.
      const isGameLine = url.searchParams.get('bookmakerID') === 'pinnacle';
      return isGameLine
        ? gameLineSlateResponse(snapshotAt, eventId)
        : EMPTY_SGO_RESPONSE();
    },
  });

  assert.equal(oddsUrls.length, 2, 'expected two odds requests: game-line + player-prop');

  const gameLine = oddsUrls.find(
    (u) => u.searchParams.get('bookmakerID') === 'pinnacle',
  );
  const playerProp = oddsUrls.find((u) =>
    (u.searchParams.get('oddID') ?? '').includes('PLAYER_ID'),
  );

  assert.ok(gameLine, 'game-line request should be Pinnacle-only during peak');
  assert.equal(gameLine.searchParams.get('oddID'), null);

  assert.ok(playerProp, 'player-prop request should be present every cycle');
  assert.equal(
    playerProp.searchParams.get('bookmakerID'),
    null,
    'player-prop request must NOT inherit Pinnacle-only',
  );
  // The fix: the prop request is scoped to the slate's event IDs, not league-wide.
  assert.equal(
    playerProp.searchParams.get('eventID'),
    eventId,
    'player-prop request must be event-scoped to the slate (UTV2-1281)',
  );
});

test('ingestLeague skips the player-prop fetch when the slate has no imminent events (no league-wide prop query) (UTV2-1281)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const propUrls: URL[] = [];

  await ingestLeague('MLB', 'test-key', repositories, {
    snapshotAt: '2026-06-13T18:00:00.000Z',
    skipResults: true,
    playerPropOddIdPatterns: [...SGO_PLAYER_PROP_ODD_ID_PATTERNS.MLB],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if ((url.searchParams.get('oddID') ?? '').includes('PLAYER_ID')) {
        propUrls.push(url);
      }
      // Empty game-line slate → no events to scope props to.
      return EMPTY_SGO_RESPONSE();
    },
  });

  assert.equal(
    propUrls.length,
    0,
    'with an empty slate there must be no league-wide player-prop request to hang on',
  );
});
