import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';
import { runIngestorCycles } from './ingestor-runner.js';

/*
 * UTV2-1282 — MLB offer persistence: per-league singleton + terminal timeout +
 * bounded dedup lookup.
 *
 * Root cause (live): the MLB cycle blew the per-league timeout in the DB phase
 * (`findExistingCombinations` scanned all provider_offer_history partitions and hit
 * a statement timeout); the timed-out work kept running, so the next cycle started
 * an overlapping MLB cycle and they piled onto the DB. These tests prove:
 *   (1) overlapping MLB cycles cannot run while prior work is still in flight,
 *   (2) a timed-out cycle releases the singleton once its work settles (next cycle proceeds),
 *   (3) the next league proceeds when one league times out,
 *   (4) the existing-combinations dedup lookup is bounded by a snapshot window.
 */

const SNAPSHOT_AT = '2026-06-18T04:00:00.000Z';
const API_KEY = 'test-sgo-key';

const emptyOdds = () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** Hangs forever and IGNORES the abort signal — models a non-abortable DB stall. */
function unabortableHangingFetch(): typeof fetch {
  return (() => new Promise<Response>(() => {})) as typeof fetch;
}

/** Hangs but rejects when its signal aborts — models an abortable fetch stall. */
function abortableHangingFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal) {
        if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
          once: true,
        });
      }
    })) as typeof fetch;
}

function mlbHangsOthersEmpty(hang: typeof fetch): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('leagueID=MLB')) return hang(href, init);
    return Promise.resolve(emptyOdds());
  }) as typeof fetch;
}

test('singleton: a still-in-flight MLB cycle is not overlapped by the next cycle (UTV2-1282)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const warnings: string[] = [];

  // MLB work never settles even when aborted → the timed-out work stays in flight.
  const summaries = await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 2,
    skipResults: true,
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: mlbHangsOthersEmpty(unabortableHangingFetch()),
    logger: { warn: (m?: unknown) => warnings.push(String(m)), info: () => {} },
  });

  assert.equal(summaries.length, 2);
  const allLeagues = summaries.flatMap((s) => s.results.map((r) => r.league));
  // MLB never produces a successful result; NBA runs both cycles.
  assert.ok(!allLeagues.includes('MLB'), `MLB must not succeed, got [${allLeagues.join(', ')}]`);
  assert.equal(allLeagues.filter((l) => l === 'NBA').length, 2, 'NBA should run in both cycles');
  // Cycle 2 must SKIP MLB via the singleton guard rather than overlap it.
  assert.ok(
    warnings.some((w) => w.includes('league=MLB') && w.includes('SKIP') && w.includes('singleton')),
    `expected an MLB singleton SKIP warning, got: ${warnings.join(' | ')}`,
  );
});

test('terminal timeout: once a timed-out MLB cycle settles, the singleton releases and the next cycle retries it (UTV2-1282)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const warnings: string[] = [];

  // MLB work rejects when aborted → it settles on timeout, so the lock releases.
  await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 2,
    skipResults: true,
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: mlbHangsOthersEmpty(abortableHangingFetch()),
    logger: { warn: (m?: unknown) => warnings.push(String(m)), info: () => {} },
  });

  // Released lock → MLB is attempted (and times out) in BOTH cycles, not skipped.
  const mlbTimeouts = warnings.filter((w) => w.includes('league=MLB') && w.includes('TIMEOUT'));
  assert.equal(mlbTimeouts.length, 2, `expected MLB to be retried after release; warnings: ${warnings.join(' | ')}`);
  assert.ok(
    !warnings.some((w) => w.includes('league=MLB') && w.includes('SKIP')),
    'MLB must NOT be skipped once its work settles (lock released)',
  );

  // Terminalized: the timed-out MLB cycle was recorded as a failed run.
  const runs = Array.from(
    ((repositories.runs as unknown as { runs: Map<string, { status: string; details: unknown }> }).runs ?? new Map()).values(),
  );
  const failedMlb = runs.filter(
    (r) => r.status === 'failed' && (r.details as { league?: string })?.league === 'MLB',
  );
  assert.ok(failedMlb.length >= 1, 'timed-out MLB cycle must be terminalized as a failed run');
});

test('next league proceeds when an earlier league times out (UTV2-1282)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const summaries = await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 1,
    skipResults: true,
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: mlbHangsOthersEmpty(abortableHangingFetch()),
    logger: { warn: () => {}, info: () => {} },
  });
  const leagues = summaries[0]!.results.map((r) => r.league);
  assert.ok(leagues.includes('NBA'), `NBA must run after MLB times out, got [${leagues.join(', ')}]`);
});

test('findExistingCombinations is bounded by the snapshot window — old partitions are excluded (UTV2-1282)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const base = {
    providerKey: 'sgo',
    providerEventId: 'evt-mlb-dedup',
    providerMarketKey: 'batting_hits-all-game-ou',
    providerParticipantId: 'player-7',
    sportKey: 'MLB',
    line: 1.5,
    overOdds: -120,
    underOdds: 100,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    bookmakerKey: 'fanduel',
  };
  await repositories.providerOffers.upsertBatch([
    { ...base, snapshotAt: '2026-06-01T00:00:00.000Z', idempotencyKey: 'old' }, // > 72h before snapshot
    { ...base, snapshotAt: '2026-06-17T12:00:00.000Z', idempotencyKey: 'recent' }, // within 72h
  ]);

  const afterSnapshotAt = '2026-06-15T04:00:00.000Z'; // SNAPSHOT_AT - 72h

  const unbounded = await repositories.providerOffers.findExistingCombinations(
    [base.providerEventId],
    { includeBookmakerKey: true, beforeSnapshotAt: SNAPSHOT_AT },
  );
  const bounded = await repositories.providerOffers.findExistingCombinations(
    [base.providerEventId],
    { includeBookmakerKey: true, beforeSnapshotAt: SNAPSHOT_AT, afterSnapshotAt },
  );

  // Both runs see the combination (it exists recently), but the bounded lookup must
  // not depend on the old partition: prove the lower bound is applied by excluding a
  // combination that ONLY exists before the window.
  assert.ok(unbounded.size >= 1, 'unbounded lookup finds the combination');
  assert.ok(bounded.size >= 1, 'bounded lookup still finds the recent combination');

  // A combination present ONLY in the old window must be excluded by the bound.
  await repositories.providerOffers.upsertBatch([
    { ...base, providerEventId: 'evt-old-only', snapshotAt: '2026-06-01T00:00:00.000Z', idempotencyKey: 'old-only' },
  ]);
  const oldOnly = await repositories.providerOffers.findExistingCombinations(
    ['evt-old-only'],
    { includeBookmakerKey: true, beforeSnapshotAt: SNAPSHOT_AT, afterSnapshotAt },
  );
  assert.equal(oldOnly.size, 0, 'a combination only in the pre-window partition must be excluded by afterSnapshotAt');
});
