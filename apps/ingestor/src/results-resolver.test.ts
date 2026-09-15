import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAndInsertResults } from './results-resolver.js';
import type { SGOEventResult } from './sgo-fetcher.js';

/*
 * UTV2-1287 — finalization/results funnel telemetry.
 *
 * game_results was frozen while the watchdog kept restarting the ingestor mid
 * finalized-repoll. After the watchdog fix, results flow again — but a residual
 * of finished MLB games never reach status='completed', so their results are
 * silently skipped. These tests pin the diagnostic behavior added to
 * resolveAndInsertResults: the event-gate skip is attributed to the correct
 * reason (mapping miss vs status-transition gap) and the funnel is logged,
 * with NO change to insert behavior.
 */

interface FakeEvent {
  id: string;
  status: string;
}

function makeResult(
  providerEventId: string,
  markets = 1,
): SGOEventResult {
  return {
    providerEventId,
    status: { finalized: true } as SGOEventResult['status'],
    playerStats: [],
    resolvedEvent: null,
    scoredMarkets: Array.from({ length: markets }, (_, i) => ({
      oddId: `points-all-game-ou-${i}`,
      baseMarketKey: 'points-all-game-ou',
      providerParticipantId: null, // game-line market → inserts without a participant
      providerSide: null, // stat entity `all` → genuinely game-scoped (UTV2-1868)
      score: 5 + i,
      scoringSupported: true,
    })),
  };
}

function makeRepositories(eventsByExternalId: Record<string, FakeEvent | null>) {
  const inserts: Array<{ eventId: string; marketKey: string }> = [];
  const repositories = {
    events: {
      findByExternalId: async (externalId: string) =>
        eventsByExternalId[externalId] ?? null,
    },
    participants: {
      findByExternalId: async () => null,
    },
    gradeResults: {
      insert: async (row: { eventId: string; marketKey: string }) => {
        inserts.push({ eventId: row.eventId, marketKey: row.marketKey });
        return row;
      },
    },
  } as unknown as Parameters<typeof resolveAndInsertResults>[1];
  return { repositories, inserts };
}

test('UTV2-1287: a completed event inserts results and counts as completed', async () => {
  const { repositories, inserts } = makeRepositories({
    EVT_DONE: { id: 'evt-done', status: 'completed' },
  });
  const summary = await resolveAndInsertResults([makeResult('EVT_DONE', 2)], repositories);

  assert.equal(summary.processedEvents, 1);
  assert.equal(summary.completedEvents, 1);
  assert.equal(summary.insertedResults, 2);
  assert.equal(summary.skippedEventNotFound, 0);
  assert.equal(summary.skippedEventNotCompleted, 0);
  assert.equal(inserts.length, 2);
});

test('UTV2-1287: a finished event still in_progress is attributed to skippedEventNotCompleted (the residual)', async () => {
  const { repositories, inserts } = makeRepositories({
    EVT_STUCK: { id: 'evt-stuck', status: 'in_progress' },
  });
  const summary = await resolveAndInsertResults([makeResult('EVT_STUCK', 3)], repositories);

  assert.equal(summary.completedEvents, 0);
  assert.equal(summary.insertedResults, 0);
  assert.equal(summary.skippedEventNotCompleted, 1, 'status-transition gap is its own reason');
  assert.equal(summary.skippedEventNotFound, 0);
  assert.equal(summary.skippedResults, 3, 'all 3 markets skipped');
  assert.equal(inserts.length, 0, 'no game_results inserted for a non-completed event');
});

test('UTV2-1287: an unmapped providerEventId is attributed to skippedEventNotFound', async () => {
  const { repositories } = makeRepositories({}); // no event rows
  const summary = await resolveAndInsertResults([makeResult('EVT_MISSING', 1)], repositories);

  assert.equal(summary.skippedEventNotFound, 1, 'mapping miss is its own reason');
  assert.equal(summary.skippedEventNotCompleted, 0);
  assert.equal(summary.completedEvents, 0);
  assert.equal(summary.insertedResults, 0);
});

test('UTV2-1287: the funnel telemetry line is emitted with the full breakdown', async () => {
  const { repositories } = makeRepositories({
    EVT_DONE: { id: 'evt-done', status: 'completed' },
    EVT_STUCK: { id: 'evt-stuck', status: 'in_progress' },
  });
  const infos: string[] = [];
  const summary = await resolveAndInsertResults(
    [makeResult('EVT_DONE', 1), makeResult('EVT_STUCK', 1), makeResult('EVT_MISSING', 1)],
    repositories,
    { warn: () => {}, info: (m?: unknown) => infos.push(String(m)) },
  );

  // 3 finalized results in: 1 completed+inserted, 1 not-completed, 1 not-found.
  assert.equal(summary.processedEvents, 3);
  assert.equal(summary.completedEvents, 1);
  assert.equal(summary.insertedResults, 1);
  assert.equal(summary.skippedEventNotCompleted, 1);
  assert.equal(summary.skippedEventNotFound, 1);

  const line = infos.find((m) => m.includes('[results-telemetry]'));
  assert.ok(line, `expected a [results-telemetry] funnel line; got: ${infos.join(' | ')}`);
  assert.match(line!, /finalized_results_in=3/);
  assert.match(line!, /completed=1/);
  assert.match(line!, /inserted=1/);
  assert.match(line!, /skipped_event_not_found=1/);
  assert.match(line!, /skipped_event_not_completed=1/);
});

/*
 * UTV2-1889 — the SGO submission-to-result journey.
 *
 * Three defects were proven against shipped code and are repaired together here,
 * because each one alone leaves the journey broken:
 *   A. the game-line canonical table was keyed to a shape the normalizer cannot emit
 *   B. a moneyline `actual_value` was the raw team score, not an outcome
 *   D. no stored game-line row carried the side its score belongs to
 *
 * The load-bearing assertion in this block is the *last* one: an event whose side
 * cannot be resolved writes nothing. Guessing there would silently attribute a win
 * to a team that was never attested.
 */

function makeMoneylineResult(
  providerEventId: string,
  homeScore: number,
  awayScore: number,
  options: { omitAway?: boolean } = {},
): SGOEventResult {
  const markets = [
    {
      oddId: 'points-home-game-ml-home',
      baseMarketKey: 'points-all-game-ml',
      providerParticipantId: null,
      providerSide: 'home' as const,
      score: homeScore,
      scoringSupported: true,
    },
    {
      oddId: 'points-away-game-ml-away',
      baseMarketKey: 'points-all-game-ml',
      providerParticipantId: null,
      providerSide: 'away' as const,
      score: awayScore,
      scoringSupported: true,
    },
  ];
  return {
    providerEventId,
    status: { finalized: true } as SGOEventResult['status'],
    playerStats: [],
    resolvedEvent: null,
    scoredMarkets: options.omitAway ? [markets[0]!] : markets,
  };
}

function makeSidedRepositories(
  eventsByExternalId: Record<string, FakeEvent | null>,
  sides: Array<{ participant_id: string; role: string }>,
) {
  const inserts: Array<{
    eventId: string;
    participantId: string | null;
    marketKey: string;
    actualValue: number;
  }> = [];
  const repositories = {
    events: {
      findByExternalId: async (externalId: string) =>
        eventsByExternalId[externalId] ?? null,
    },
    participants: { findByExternalId: async () => null },
    eventParticipants: { listByEvent: async () => sides },
    gradeResults: {
      insert: async (row: {
        eventId: string;
        participantId: string | null;
        marketKey: string;
        actualValue: number;
      }) => {
        inserts.push(row);
        return row;
      },
    },
  } as unknown as Parameters<typeof resolveAndInsertResults>[1];
  return { repositories, inserts };
}

const HOME_AWAY_SIDES = [
  { participant_id: 'p-home', role: 'home' },
  { participant_id: 'p-away', role: 'away' },
];

test('UTV2-1889 (gaps A+B+D): a moneyline writes an outcome per side, attributed to the team', async () => {
  const { repositories, inserts } = makeSidedRepositories(
    { EVT_ML: { id: 'evt-ml', status: 'completed' } },
    HOME_AWAY_SIDES,
  );
  const summary = await resolveAndInsertResults(
    [makeMoneylineResult('EVT_ML', 5, 3)],
    repositories,
  );

  assert.equal(summary.insertedResults, 2);
  assert.equal(summary.skippedMoneylineOutcomeUnresolved, 0);
  assert.equal(inserts.length, 2);

  // Gap A: the key is the one the normalizer can actually emit, mapped to the one
  // grading actually reads. Neither `points-all-game-ml` nor `game_ml_mlb` appears.
  assert.deepEqual(
    [...new Set(inserts.map((row) => row.marketKey))],
    ['game_moneyline_win'],
  );

  const home = inserts.find((row) => row.participantId === 'p-home');
  const away = inserts.find((row) => row.participantId === 'p-away');

  // Gap D: every row says whose result it is.
  assert.ok(home, 'the home side must be attributed');
  assert.ok(away, 'the away side must be attributed');

  // Gap B: the value is the outcome of the comparison, not either raw score.
  assert.equal(home!.actualValue, 1);
  assert.equal(away!.actualValue, 0);
  assert.ok(
    !inserts.some((row) => row.actualValue === 5 || row.actualValue === 3),
    'no raw team score may reach an outcome-keyed row',
  );
});

test('UTV2-1889: a tied moneyline is a push on both sides, not a win for whoever was read first', async () => {
  const { repositories, inserts } = makeSidedRepositories(
    { EVT_TIE: { id: 'evt-tie', status: 'completed' } },
    HOME_AWAY_SIDES,
  );
  await resolveAndInsertResults([makeMoneylineResult('EVT_TIE', 2, 2)], repositories);

  assert.equal(inserts.length, 2);
  assert.deepEqual(
    inserts.map((row) => row.actualValue),
    [0.5, 0.5],
  );
});

test('UTV2-1889: a half-scored event writes nothing — the outcome is never inferred from one side', async () => {
  const { repositories, inserts } = makeSidedRepositories(
    { EVT_HALF: { id: 'evt-half', status: 'completed' } },
    HOME_AWAY_SIDES,
  );
  const summary = await resolveAndInsertResults(
    [makeMoneylineResult('EVT_HALF', 5, 0, { omitAway: true })],
    repositories,
  );

  assert.equal(inserts.length, 0, 'a lone side cannot establish a winner');
  assert.equal(summary.insertedResults, 0);
  assert.equal(summary.skippedMoneylineOutcomeUnresolved, 1);
});

test('UTV2-1889: an unresolvable side writes nothing and is never guessed', async () => {
  // The event has no event_participants rows at all — exactly the shape of the
  // 3,000+ historical game-line rows that carry no participant.
  const { repositories, inserts } = makeSidedRepositories(
    { EVT_NOSIDES: { id: 'evt-nosides', status: 'completed' } },
    [],
  );
  const summary = await resolveAndInsertResults(
    [makeMoneylineResult('EVT_NOSIDES', 5, 3)],
    repositories,
  );

  assert.equal(inserts.length, 0, 'no row may be written for an unattributable side');
  assert.equal(summary.skippedTeamSideUnresolved, 2);
  assert.equal(summary.insertedResults, 0);
});

test('UTV2-1889: a game total is untouched by the moneyline path — its raw value is its value', async () => {
  const { repositories, inserts } = makeSidedRepositories(
    { EVT_DONE: { id: 'evt-done', status: 'completed' } },
    HOME_AWAY_SIDES,
  );
  await resolveAndInsertResults([makeResult('EVT_DONE', 1)], repositories);

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]!.marketKey, 'game_total_ou');
  assert.equal(inserts[0]!.actualValue, 5, 'a total is a quantity, not an outcome');
  assert.equal(inserts[0]!.participantId, null, 'a total belongs to the game, not a side');
});
