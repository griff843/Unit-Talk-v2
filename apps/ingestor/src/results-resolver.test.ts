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
