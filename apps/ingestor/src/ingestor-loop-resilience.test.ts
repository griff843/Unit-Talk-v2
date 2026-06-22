import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';
import { runIngestorCycles } from './ingestor-runner.js';
import { shouldWatchdogForceExit, type IngestorLoopProgress } from './heartbeat.js';

/*
 * UTV2-1284 — ingestor daemon durability.
 *
 * Proven production failure (2026-06-20): a transient Supabase 521 outage made a
 * cycle-level DB call (events.listStartedBySnapshot) throw; the rejection escaped
 * the infinite cycle loop, set process.exitCode=1 without exiting, and the daemon
 * went dark for ~5.5h while `pgrep node` still reported "healthy".
 *
 * These tests prove:
 *   (1) a transient cycle-level DB failure does NOT kill the loop — it fails the
 *       iteration closed, emits telemetry, and continues to the next poll;
 *   (2) the per-cycle heartbeat advances every iteration (consumed by the
 *       watchdog + healthcheck);
 *   (3) a timed-out league held past the re-admission bound is re-admitted to the
 *       rotation rather than dropped forever.
 */

const API_KEY = 'test-sgo-key';

const emptyOdds = () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const allEmptyFetch: typeof fetch = (() => Promise.resolve(emptyOdds())) as typeof fetch;

/** Hangs forever and IGNORES the abort signal — models a non-abortable DB stall. */
function unabortableHangingFetch(): typeof fetch {
  return (() => new Promise<Response>(() => {})) as typeof fetch;
}

function mlbHangsOthersEmpty(hang: typeof fetch): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('leagueID=MLB')) return hang(href, init);
    return Promise.resolve(emptyOdds());
  }) as typeof fetch;
}

test('FIX #1: a transient cycle-level DB failure does not kill the daemon loop (UTV2-1284)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  // Simulate the 521 outage: the cycle-level "list started events" call throws.
  // This runs AFTER the per-league loop, in the previously-unguarded cycle body.
  (repositories.events as unknown as { listStartedBySnapshot: () => Promise<unknown> })
    .listStartedBySnapshot = async () => {
    throw new Error('Supabase 521: Web server is down');
  };

  const warnings: string[] = [];
  const heartbeats: number[] = [];

  // Before the fix this call REJECTS (loop dies). After the fix it RESOLVES.
  const summaries = await runIngestorCycles({
    repositories,
    leagues: ['NBA'],
    apiKey: API_KEY,
    maxCycles: 2,
    skipResults: false, // so the cycle-level finalized-repoll path runs and throws
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: allEmptyFetch,
    recordHeartbeat: (progress) => heartbeats.push(progress.cycle),
    logger: { warn: (m?: unknown) => warnings.push(String(m)), info: () => {} },
  });

  // The loop survived both iterations (resolved instead of rejecting).
  assert.ok(Array.isArray(summaries), 'runIngestorCycles resolved — loop did not die');
  assert.ok(
    warnings.filter((w) => w.includes('POLL ITERATION FAILED') && w.includes('UTV2-1284')).length >= 2,
    `expected a fail-closed telemetry warning per failed cycle; got: ${warnings.join(' | ')}`,
  );
  // The progress signal advanced every iteration despite the failures.
  assert.ok(
    heartbeats.includes(1) && heartbeats.includes(2),
    `progress must advance each cycle; got [${heartbeats.join(',')}]`,
  );
});

test('FIX #1: the heartbeat hook throwing never breaks the loop (UTV2-1284)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  let calls = 0;
  const summaries = await runIngestorCycles({
    repositories,
    leagues: ['NBA'],
    apiKey: API_KEY,
    maxCycles: 2,
    skipResults: true,
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: allEmptyFetch,
    recordHeartbeat: () => {
      calls += 1;
      throw new Error('heartbeat file write failed');
    },
    logger: { warn: () => {}, info: () => {} },
  });
  assert.equal(summaries.length, 2, 'both cycles completed despite the heartbeat hook throwing');
  // UTV2-1286: progress is now emitted per-phase, so the hook is invoked many times
  // per cycle (>= 2 cycles × multiple phases). Every invocation threw and none broke the loop.
  assert.ok(calls >= 2, `progress hook was invoked each cycle despite throwing; got ${calls}`);
});

test('FIX #3: a timed-out league held past the re-admission bound is re-admitted (UTV2-1284)', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const warnings: string[] = [];
  let clock = 0;

  await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 3,
    skipResults: true,
    leagueTimeoutMs: 200,
    leagueReadmitMs: 300, // re-admit once MLB has been held > 300ms (injected clock)
    now: () => clock,
    sleep: async () => {
      clock += 200; // each inter-cycle sleep advances the injected clock by 200ms
    },
    // MLB hangs unabortably → its singleton is held (orphaned work never settles).
    fetchImpl: mlbHangsOthersEmpty(unabortableHangingFetch()),
    logger: { warn: (m?: unknown) => warnings.push(String(m)), info: () => {} },
  });

  // Cycle 1: MLB marked in-flight at clock=0, times out, held.
  // Cycle 2: clock=200, held 200ms < 300ms bound → SKIP.
  // Cycle 3: clock=400, held 400ms > 300ms bound → RE-ADMIT (not skipped forever).
  assert.ok(
    warnings.some((w) => w.includes('league=MLB') && w.includes('SKIP')),
    `expected an MLB singleton SKIP while within the bound; got: ${warnings.join(' | ')}`,
  );
  assert.ok(
    warnings.some((w) => w.includes('league=MLB') && w.includes('RE-ADMIT') && w.includes('UTV2-1284')),
    `expected MLB to be re-admitted past the bound; got: ${warnings.join(' | ')}`,
  );
});

/*
 * UTV2-1286 — the watchdog must detect a no-progress wedge, not a slow-but-alive
 * cycle. The fix emits a loop-progress signal at every PHASE boundary (poll start,
 * each league start/end, finalized-repoll start/end) instead of once per cycle, so
 * the inter-progress gap is bounded by a single phase (<= leagueTimeoutMs) rather
 * than a whole multi-league cycle that can exceed the 20-min watchdog threshold.
 */

test('UTV2-1286: progress is emitted per-league and per-phase, not once per cycle', async () => {
  const repositories = createInMemoryIngestorRepositoryBundle();
  const progress: IngestorLoopProgress[] = [];

  await runIngestorCycles({
    repositories,
    leagues: ['MLB', 'NBA'],
    apiKey: API_KEY,
    maxCycles: 1,
    skipResults: false, // exercise the finalized-repoll phase too
    leagueTimeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: allEmptyFetch,
    recordHeartbeat: (p) => progress.push(p),
    logger: { warn: () => {}, info: () => {} },
  });

  const phases = progress.map((p) => p.phase);
  // Coarse cycle-level phases.
  assert.ok(phases.includes('cycle-start'), `expected a cycle-start phase; got [${phases.join(',')}]`);
  assert.ok(phases.includes('finalized-repoll-start'), `expected finalized-repoll-start; got [${phases.join(',')}]`);
  assert.ok(phases.includes('finalized-repoll-end'), `expected finalized-repoll-end; got [${phases.join(',')}]`);
  assert.ok(phases.includes('cycle-end'), `expected a cycle-end phase; got [${phases.join(',')}]`);

  // Each configured league emits BOTH a start and an end progress signal — this is
  // what bounds the inter-progress gap to a single league's wall-clock.
  for (const league of ['MLB', 'NBA']) {
    assert.ok(
      progress.some((p) => p.phase === 'league-start' && p.league === league),
      `expected a league-start for ${league}; got ${JSON.stringify(progress)}`,
    );
    assert.ok(
      progress.some((p) => p.phase === 'league-end' && p.league === league),
      `expected a league-end for ${league}; got ${JSON.stringify(progress)}`,
    );
  }

  // Far more than one signal per cycle — the regression was exactly one per cycle.
  assert.ok(
    progress.length >= 6,
    `expected many per-phase progress signals in a single cycle; got ${progress.length}`,
  );
});

test('UTV2-1286: a slow-but-progressing cycle never trips the watchdog (no false positive)', () => {
  // Model a long cycle whose total wall-clock far exceeds the watchdog threshold,
  // but whose phases keep advancing so each inter-progress gap stays under it.
  const thresholdMs = 20 * 60_000; // 20 min, the production default
  const perPhaseGapMs = 4 * 60_000; // 4 min — one per-league bound between phases
  // 30 phases × 4 min = 2h of continuous progress: total >> threshold.
  let lastProgressAt = 0;
  for (let i = 1; i <= 30; i += 1) {
    const now = i * perPhaseGapMs; // a phase advanced → progress stamped at `now`
    // At the instant before this phase lands, the watchdog evaluates staleness.
    assert.equal(
      shouldWatchdogForceExit(lastProgressAt, thresholdMs, now),
      false,
      `watchdog must not trip while phases keep advancing (phase ${i}, gap ${now - lastProgressAt}ms)`,
    );
    lastProgressAt = now; // progress recorded
  }
  // Sanity: the simulated cycle outlasted the threshold many times over.
  assert.ok(30 * perPhaseGapMs > thresholdMs * 5);
});

test('UTV2-1286: a true no-progress wedge still trips the watchdog', () => {
  const thresholdMs = 20 * 60_000;
  const lastProgressAt = 1_000_000;
  // No phase advanced for longer than the threshold → wedge → force exit.
  assert.equal(
    shouldWatchdogForceExit(lastProgressAt, thresholdMs, lastProgressAt + thresholdMs + 1),
    true,
    'watchdog must force-exit when no progress occurs past the threshold',
  );
  // Exactly at the threshold is still alive (strictly greater trips).
  assert.equal(
    shouldWatchdogForceExit(lastProgressAt, thresholdMs, lastProgressAt + thresholdMs),
    false,
    'watchdog must not trip before the threshold is exceeded',
  );
});
