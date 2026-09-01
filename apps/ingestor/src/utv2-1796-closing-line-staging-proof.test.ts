/**
 * UTV2-1796 — closing-line marking is non-vacuous through the real ingest caller path.
 *
 * A direct call to `markClosingLines` cannot show that the caller passes the right
 * options, and the caller was the defect: `ingest-odds-api.ts` omitted
 * `includeBookmakerKey`, so every bookmaker quoting the same market collapsed into one
 * de-duplication key and exactly one book kept a closing line. Measured on a single
 * production event, 1,318 offers collapsed to 264 keys across 7 bookmakers.
 *
 * These tests drive `ingestOddsApiLeague` end to end with a mock HTTP response and the
 * in-memory repository bundle, so the option actually travels from the ingest caller into
 * the repository. The collapse is inverted rather than assumed: the same fixture is run
 * with the option withheld and must lose bookmakers.
 *
 * No provider call, no production write, no staging write. The staging live proof is a
 * separate receipt in this lane's bundle.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';

import { ingestOddsApiLeague } from './ingest-odds-api.js';

// Seven bookmakers on one market, matching the shape observed on production event
// usHLeS7NsELL6HCdrzA0 (sgo, MLB): one event, one market, seven books quoting it.
const SEVEN_BOOKS = [
  'pinnacle',
  'fanduel',
  'draftkings',
  'betmgm',
  'caesars',
  'bet365',
  'espnbet',
] as const;

// A closing line is never marked by the cycle that wrote the offer: markClosingLines only
// considers offers snapshotted strictly BEFORE the event commenced, and only for events
// that commenced within the last 48 hours. The fixture reproduces that two-cycle shape
// relative to now, because both bounds are computed from the ingest snapshot.
const NOW = Date.now();
const OFFERS_SNAPSHOTTED_AT = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
const COMMENCED_AT = new Date(NOW - 60 * 60 * 1000).toISOString();
const NOT_YET_COMMENCED = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();

function sevenBookEvent(commenceTime: string): string {
  return JSON.stringify([
    {
      id: 'utv2-1796-evt',
      sport_key: 'basketball_nba',
      sport_title: 'NBA',
      commence_time: commenceTime,
      home_team: 'Boston Celtics',
      away_team: 'Miami Heat',
      bookmakers: SEVEN_BOOKS.map((key, index) => ({
        key,
        title: key,
        last_update: '2026-01-01T11:00:00.000Z',
        markets: [
          {
            key: 'totals',
            last_update: '2026-01-01T11:00:00.000Z',
            outcomes: [
              { name: 'Over', price: -110 - index, point: 228.5 },
              { name: 'Under', price: -110 + index, point: 228.5 },
            ],
          },
        ],
      })),
    },
  ]);
}

function mockFetch(body: string): typeof fetch {
  return async (): Promise<Response> =>
    new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-requests-remaining': '500',
        'x-requests-last': '1',
      },
    });
}

type MarkClosingLinesOptions = { includeBookmakerKey?: boolean } | undefined;

/**
 * Runs the real ingest caller path and reports both what the caller asked for and what the
 * repository actually did with it. `forceOptions` exists only to withhold the option for
 * the inversion; the production path never sets it.
 */
async function runIngest(
  forceOptions?: { withholdIncludeBookmakerKey: true },
): Promise<{
  observedOptions: MarkClosingLinesOptions[];
  markedBookmakers: string[];
  returnedCount: number;
}> {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const providerOffers = repositories.providerOffers;
  const observedOptions: MarkClosingLinesOptions[] = [];

  const realMark = providerOffers.markClosingLines.bind(providerOffers);
  let returnedCount = 0;
  providerOffers.markClosingLines = async (events, snapshotAt, options) => {
    observedOptions.push(options);
    const effective = forceOptions?.withholdIncludeBookmakerKey ? undefined : options;
    returnedCount = await realMark(events, snapshotAt, effective);
    return returnedCount;
  };

  async function ingest(commenceTime: string): Promise<void> {
    const summary = await ingestOddsApiLeague({
      apiKey: 'utv2-1796-not-a-real-key',
      league: 'NBA',
      repositories,
      fetchImpl: mockFetch(sevenBookEvent(commenceTime)),
      logger: { warn: () => {}, info: () => {} },
    });
    assert.equal(summary.status, 'succeeded', `ingest must succeed: ${summary.error ?? ''}`);
  }

  // Cycle 1: the event has not commenced, so these offers are pre-commence quotes and
  // nothing is eligible to be marked yet.
  await ingest(NOT_YET_COMMENCED);
  const preCommence = new Map(
    (providerOffers as unknown as { offers: Map<string, { snapshot_at: string }> }).offers,
  );
  for (const offer of preCommence.values()) {
    // The cycle stamped these with the wall clock. Backdate them to the hour before the
    // event started so the fixture has the pre-commence/post-commence relationship the
    // production data has; the repository is not being taught anything it would not see.
    offer.snapshot_at = OFFERS_SNAPSHOTTED_AT;
  }
  assert.ok(preCommence.size > 0, 'cycle 1 must have written offers to mark');
  observedOptions.length = 0;

  // Cycle 2: the same event has now commenced, within the 48-hour window.
  await ingest(COMMENCED_AT);

  const closing = (await providerOffers.listClosingOffers('2020-01-01T00:00:00Z')) as Array<{
    bookmaker_key: string | null;
  }>;
  const markedBookmakers = [
    ...new Set(closing.map((offer) => offer.bookmaker_key ?? '')),
  ].sort();

  return { observedOptions, markedBookmakers, returnedCount };
}

test('UTV2-1796: the ingest caller asks for per-bookmaker closing lines', async () => {
  const { observedOptions } = await runIngest();

  assert.ok(observedOptions.length > 0, 'ingest must reach markClosingLines at all');
  for (const options of observedOptions) {
    assert.equal(
      options?.includeBookmakerKey,
      true,
      'ingest-odds-api.ts must pass includeBookmakerKey; without it six of seven books lose their closing line',
    );
  }
});

test('UTV2-1796: the odds-api path is not itself collapsing, and this test says so', async () => {
  const { markedBookmakers, returnedCount } = await runIngest();

  // This ingester encodes the book in provider_key ("odds-api:fanduel") and leaves
  // bookmaker_key null, so its offers are already distinct with or without the option.
  // Asserting seven bookmaker_key values here would be asserting a shape this path does
  // not produce. What it does produce is one marked offer per book, via provider_key.
  assert.deepEqual(
    markedBookmakers,
    [''],
    'odds-api offers carry a null bookmaker_key; the book lives in provider_key',
  );
  assert.equal(
    returnedCount,
    SEVEN_BOOKS.length,
    `every one of the seven books must be marked, got ${returnedCount}`,
  );
});

test('UTV2-1796: the collapsed key loses books on the shape production actually has', async () => {
  // The hazard the option prevents does not bite the odds-api shape; it bites the sgo
  // shape, which is the only shape in provider_offer_history -- all 14.4M rows carry
  // provider_key 'sgo' with the book in bookmaker_key. Seven books therefore share one
  // provider_key, and the de-duplication key is the only thing keeping them apart.
  const repositories = createInMemoryIngestorRepositoryBundle();
  const providerOffers = repositories.providerOffers;

  await providerOffers.upsertBatch(
    SEVEN_BOOKS.map((bookmaker, index) => ({
      providerKey: 'sgo',
      providerEventId: 'utv2-1796-sgo-evt',
      providerMarketKey: 'batting_hits+runs+rbi-all-game-ou',
      providerParticipantId: 'ALEC_BOHM_1_MLB',
      bookmakerKey: bookmaker,
      sportKey: 'MLB',
      line: 1.5,
      overOdds: -110 - index,
      underOdds: -110 + index,
      devigMode: 'PAIRED' as const,
      isOpening: false,
      isClosing: false,
      snapshotAt: OFFERS_SNAPSHOTTED_AT,
      // Each book is a distinct row upstream; without a distinct idempotency key the
      // fixture itself would collapse them and the inversion would prove nothing.
      idempotencyKey: `utv2-1796-sgo-evt:${bookmaker}`,
    })),
  );

  const perBook = await providerOffers.markClosingLines(
    [{ providerEventId: 'utv2-1796-sgo-evt', commenceTime: COMMENCED_AT }],
    new Date(NOW).toISOString(),
    { includeBookmakerKey: true },
  );
  assert.equal(
    perBook,
    SEVEN_BOOKS.length,
    `with the bookmaker in the key every book keeps a closing line, got ${perBook}`,
  );

  // Inversion on a fresh bundle: the same seven offers, the option withheld.
  const collapsedRepositories = createInMemoryIngestorRepositoryBundle();
  await collapsedRepositories.providerOffers.upsertBatch(
    SEVEN_BOOKS.map((bookmaker, index) => ({
      providerKey: 'sgo',
      providerEventId: 'utv2-1796-sgo-evt',
      providerMarketKey: 'batting_hits+runs+rbi-all-game-ou',
      providerParticipantId: 'ALEC_BOHM_1_MLB',
      bookmakerKey: bookmaker,
      sportKey: 'MLB',
      line: 1.5,
      overOdds: -110 - index,
      underOdds: -110 + index,
      devigMode: 'PAIRED' as const,
      isOpening: false,
      isClosing: false,
      snapshotAt: OFFERS_SNAPSHOTTED_AT,
      // Each book is a distinct row upstream; without a distinct idempotency key the
      // fixture itself would collapse them and the inversion would prove nothing.
      idempotencyKey: `utv2-1796-sgo-evt:${bookmaker}`,
    })),
  );
  const collapsed = await collapsedRepositories.providerOffers.markClosingLines(
    [{ providerEventId: 'utv2-1796-sgo-evt', commenceTime: COMMENCED_AT }],
    new Date(NOW).toISOString(),
  );

  assert.equal(
    collapsed,
    1,
    `without the bookmaker in the key the seven books collapse to one closing line, got ${collapsed}`,
  );
});
