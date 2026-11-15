import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRepositoryBundle, InMemorySystemRunRepository } from '@unit-talk/db';
import { isGradingCronFresh, refreshGradingCronLiveness } from './grading-cron-health.js';
import test from 'node:test';
import {
  evaluateGradingHealthAlertTransition,
  runGradingCronEntrypoint,
  runGradingCronCycles,
  startGradingCronLoop,
} from './grading-cron.js';
import { fetchAllByLifecycleState } from './grading-service.js';
import type { PickRecord, SystemRunRecord } from '@unit-talk/db';

test('runGradingCronCycles executes each cycle and sleeps between runs', async () => {
  const calls: number[] = [];
  const sleeps: number[] = [];

  const summaries = await runGradingCronCycles({
    repositories: {} as Parameters<typeof runGradingCronCycles>[0]['repositories'],
    maxCycles: 2,
    pollIntervalMs: 1234,
    runGradingPass: async () => {
      calls.push(calls.length + 1);
      return {
        attempted: 1,
        graded: 1,
        skipped: 0,
        errors: 0,
        details: [],
      };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(sleeps, [1234]);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.cycle, 1);
  assert.equal(summaries[0]?.result?.graded, 1);
  assert.equal(summaries[1]?.cycle, 2);
  assert.equal(summaries[1]?.result?.attempted, 1);
});

test('runGradingCronCycles records failures and continues to the next cycle', async () => {
  let attempts = 0;

  const summaries = await runGradingCronCycles({
    repositories: {} as Parameters<typeof runGradingCronCycles>[0]['repositories'],
    maxCycles: 2,
    pollIntervalMs: 500,
    runGradingPass: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('transient grading failure');
      }

      return {
        attempted: 0,
        graded: 0,
        skipped: 0,
        errors: 0,
        details: [],
      };
    },
    sleep: async () => {},
  });

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.cycle, 1);
  assert.equal(summaries[0]?.error, 'transient grading failure');
  assert.equal(summaries[1]?.cycle, 2);
  assert.equal(summaries[1]?.result?.graded, 0);
});

test('startGradingCronLoop writes heartbeat system_run on each cycle', async () => {
  const startRunCalls: unknown[] = [];
  const completeRunCalls: unknown[] = [];
  let cycle = 0;

  const fakeRun: SystemRunRecord = {
    id: 'run-hb-1',
    run_type: 'grading.cron.heartbeat',
    actor: null,
    status: 'succeeded',
    details: {},
    idempotency_key: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  const fakeRunsRepo = {
    startRun: async (input: unknown) => {
      startRunCalls.push(input);
      return fakeRun;
    },
    completeRun: async (input: unknown) => {
      completeRunCalls.push(input);
      return fakeRun;
    },
    listByType: async () => [] as SystemRunRecord[],
  };

  await startGradingCronLoop({
    repositories: {
      runs: fakeRunsRepo,
    } as unknown as Parameters<typeof startGradingCronLoop>[0]['repositories'],
    pollIntervalMs: 0,
    runGradingPass: async () => {
      cycle += 1;
      return { attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] };
    },
    sleep: async () => {
      if (cycle >= 2) throw new Error('stop');
    },
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message !== 'stop') throw err;
  });

  assert.equal(startRunCalls.length, 2);
  assert.deepEqual(startRunCalls[0], { runType: 'grading.cron.heartbeat', details: { cycle: 1 } });
  assert.deepEqual(startRunCalls[1], { runType: 'grading.cron.heartbeat', details: { cycle: 2 } });
  assert.equal(completeRunCalls.length, 2);
});

test('startGradingCronLoop emits staleness warning when grading.run gap exceeds threshold', async () => {
  const errors: string[] = [];
  // Use a timestamp 60 minutes ago — exceeds the default 45-minute GRADING_STALE_WARN_MS constant
  const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const fakeRun: SystemRunRecord = {
    id: 'run-hb-2',
    run_type: 'grading.cron.heartbeat',
    actor: null,
    status: 'succeeded',
    details: {},
    idempotency_key: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  const staleRun: SystemRunRecord = {
    id: 'run-stale',
    run_type: 'grading.run',
    actor: null,
    status: 'succeeded',
    details: {},
    idempotency_key: null,
    created_at: staleTimestamp,
    started_at: staleTimestamp,
    finished_at: null,
  };

  const fakeRunsRepo = {
    startRun: async () => fakeRun,
    completeRun: async () => fakeRun,
    listByType: async () => [staleRun],
  };

  await startGradingCronLoop({
    repositories: {
      runs: fakeRunsRepo,
    } as unknown as Parameters<typeof startGradingCronLoop>[0]['repositories'],
    pollIntervalMs: 0,
    runGradingPass: async () => ({ attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] }),
    sleep: async () => {
      throw new Error('stop');
    },
    logger: {
      info() {},
      warn() {},
      error(msg: unknown) {
        errors.push(String(msg));
      },
    },
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message !== 'stop') throw err;
  });

  assert.ok(
    errors.some((e) => e.includes('STALENESS WARNING')),
    `expected STALENESS WARNING in errors: ${JSON.stringify(errors)}`,
  );
});

test('startGradingCronLoop does not emit staleness warning when grading.run is recent', async () => {
  const errors: string[] = [];
  const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago — well within threshold

  const fakeRun: SystemRunRecord = {
    id: 'run-hb-3',
    run_type: 'grading.cron.heartbeat',
    actor: null,
    status: 'succeeded',
    details: {},
    idempotency_key: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  const recentRun: SystemRunRecord = {
    id: 'run-recent',
    run_type: 'grading.run',
    actor: null,
    status: 'succeeded',
    details: {},
    idempotency_key: null,
    created_at: recentTimestamp,
    started_at: recentTimestamp,
    finished_at: null,
  };

  const fakeRunsRepo = {
    startRun: async () => fakeRun,
    completeRun: async () => fakeRun,
    listByType: async () => [recentRun],
  };

  await startGradingCronLoop({
    repositories: {
      runs: fakeRunsRepo,
    } as unknown as Parameters<typeof startGradingCronLoop>[0]['repositories'],
    pollIntervalMs: 0,
    runGradingPass: async () => ({ attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] }),
    sleep: async () => {
      throw new Error('stop');
    },
    logger: {
      info() {},
      warn() {},
      error(msg: unknown) {
        errors.push(String(msg));
      },
    },
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message !== 'stop') throw err;
  });

  assert.ok(
    !errors.some((e) => e.includes('STALENESS WARNING')),
    `unexpected STALENESS WARNING in errors: ${JSON.stringify(errors)}`,
  );
});

test('runGradingCronCycles shares a single retry state across cycles', async () => {
  const retryStates: unknown[] = [];

  await runGradingCronCycles({
    repositories: {} as Parameters<typeof runGradingCronCycles>[0]['repositories'],
    maxCycles: 2,
    pollIntervalMs: 100,
    runGradingPass: async (_repositories, options) => {
      retryStates.push(options?.retryState);
      return {
        attempted: 0,
        graded: 0,
        skipped: 0,
        errors: 0,
        details: [],
      };
    },
    sleep: async () => {},
  });

  assert.equal(retryStates.length, 2);
  assert.ok(retryStates[0] instanceof Map);
  assert.equal(retryStates[0], retryStates[1]);
});

test('fetchAllByLifecycleState paginates through more than 1000 picks', async () => {
  const PAGE_SIZE = 500;
  const TOTAL = 1050;

  const fakeRecords: PickRecord[] = Array.from({ length: TOTAL }, (_, i) => ({
    id: `pick-${i}`,
    status: 'posted',
    created_at: new Date(i).toISOString(),
    updated_at: new Date(i).toISOString(),
    submission_id: null,
    participant_id: null,
    player_id: null,
    capper_id: null,
    sport_id: null,
    market_type_id: null,
    market: 'player_points',
    selection: 'over',
    line: null,
    odds: -110,
    stake_units: null,
    confidence: null,
    source: 'manual',
    approval_status: 'approved',
    promotion_status: 'done',
    promotion_target: null,
    promotion_score: null,
    promotion_reason: null,
    promotion_version: null,
    promotion_decided_at: null,
    promotion_decided_by: null,
    posted_at: null,
    settled_at: null,
    idempotency_key: null,
    metadata: {},
  } as unknown as PickRecord));

  const calls: Array<[number | undefined, number | undefined]> = [];
  const mockPicksRepo = {
    listByLifecycleState: async (
      _state: string,
      limit?: number,
      offset?: number,
    ): Promise<PickRecord[]> => {
      calls.push([limit, offset]);
      const start = offset ?? 0;
      return fakeRecords.slice(start, limit !== undefined ? start + limit : undefined);
    },
  } as unknown as Parameters<typeof fetchAllByLifecycleState>[0];

  const result = await fetchAllByLifecycleState(mockPicksRepo, 'posted');

  assert.equal(result.length, TOTAL);
  assert.equal(calls.length, Math.ceil(TOTAL / PAGE_SIZE));
  assert.deepEqual(calls[0], [PAGE_SIZE, 0]);
  assert.deepEqual(calls[1], [PAGE_SIZE, PAGE_SIZE]);
  assert.deepEqual(calls[2], [PAGE_SIZE, PAGE_SIZE * 2]);
});

function gradingRun(
  id: string,
  outcomeClass: string,
  status: SystemRunRecord['status'],
  details: Record<string, unknown> = {},
): SystemRunRecord {
  return {
    id,
    run_type: 'grading.run',
    actor: 'grading-service',
    status,
    details: {
      outcome_class: outcomeClass,
      graded_count: outcomeClass === 'succeeded_with_work' ? 1 : 0,
      ...details,
    },
    idempotency_key: null,
    created_at: '2026-09-19T12:00:00.000Z',
    started_at: '2026-09-19T12:00:00.000Z',
    finished_at: '2026-09-19T12:00:01.000Z',
  };
}

test('grading health alert opens once for stale input and deduplicates repeats', () => {
  const stale = gradingRun('stale-2', 'degraded_stale_input', 'failed', {
    newest_game_result_sourced_at: '2026-09-19T01:00:00.000Z',
    input_freshness: { status: 'stale', threshold_hours: 6 },
    skipped_reasons: { game_result_not_found: 3 },
  });
  const success = gradingRun('success-1', 'succeeded_with_work', 'succeeded');

  const opened = evaluateGradingHealthAlertTransition([stale, success]);
  assert.equal(opened?.kind, 'open');
  assert.match(opened?.message ?? '', /game_result_not_found/);
  assert.match(opened?.message ?? '', /Check results ingestion/);

  const repeated = evaluateGradingHealthAlertTransition([
    gradingRun('failed-2', 'failed', 'failed'),
    stale,
    success,
  ]);
  assert.equal(repeated, null);
});

test('fresh successful work clears an alert across intervening no-op runs', () => {
  const transition = evaluateGradingHealthAlertTransition([
    gradingRun('success-2', 'succeeded_with_work', 'succeeded', {
      graded_count: 4,
    }),
    gradingRun('noop-1', 'no_op_no_input', 'succeeded'),
    gradingRun('stale-1', 'degraded_stale_input', 'failed'),
  ]);

  assert.equal(transition?.kind, 'clear');
  assert.match(transition?.message ?? '', /graded=4/);
});

function runGradingReadinessProbe(row: Record<string, unknown>): {
  blocking: boolean;
  status: string;
  evidence: string;
} {
  const source = `
    import('./scripts/ops/readiness-refresh.ts').then(async (loaded) => {
      const exports = loaded.probeGradingHealth ? loaded : loaded.default;
      const row = ${JSON.stringify(row)};
      const result = await exports.probeGradingHealth({
        now: new Date('2026-09-19T12:05:00.000Z'),
        db: {
          projectRef: 'zfzdnfwdarxucxtaojxm',
          latestRow: async () => row,
          countRows: async () => 0,
          selectRows: async () => [],
        },
        dbUnavailableReason: null,
        github: null,
        githubUnavailableReason: 'not needed',
        repoRoot: process.cwd(),
      });
      process.stdout.write(JSON.stringify(result));
    });
  `;
  return JSON.parse(
    execFileSync('pnpm', ['exec', 'tsx', '-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }),
  ) as { blocking: boolean; status: string; evidence: string };
}

test('readiness consumes degraded grading outcome as blocking RED input', () => {
  const dimension = runGradingReadinessProbe({
    status: 'failed',
    started_at: '2026-09-19T12:00:00.000Z',
    finished_at: '2026-09-19T12:00:01.000Z',
    details: {
      outcome_class: 'degraded_stale_input',
      graded_count: 0,
      data_dependent_skipped_count: 2,
      input_freshness: { status: 'stale', age_ms: 25_200_000, threshold_hours: 6 },
    },
  });

  assert.equal(dimension.blocking, true);
  assert.equal(dimension.status, 'fail');
  assert.match(dimension.evidence, /degraded_stale_input/);
});

test('readiness treats a genuine empty no-op as healthy, not an incident', () => {
  const dimension = runGradingReadinessProbe({
    status: 'succeeded',
    started_at: '2026-09-19T12:00:00.000Z',
    finished_at: '2026-09-19T12:00:01.000Z',
    details: {
      outcome_class: 'no_op_no_input',
      rows_scanned: 0,
      gradeable_rows: 0,
      graded_count: 0,
      skipped_count: 0,
      skipped_reasons: {},
      data_dependent_skipped_count: 0,
      error_count: 0,
      input_freshness: { status: 'fresh', age_ms: 60_000, threshold_hours: 6 },
    },
  });

  assert.equal(dimension.status, 'pass');
  assert.match(dimension.evidence, /no_op_no_input/);
});

test('readiness accepts a nothing-gradeable pass and refuses a no-input claim that examined rows', () => {
  const examinedAndSkipped = {
    outcome_class: 'no_op_nothing_gradeable',
    rows_scanned: 15_000,
    gradeable_rows: 0,
    graded_count: 0,
    skipped_count: 15_000,
    skipped_reasons: { settlement_already_exists: 15_000 },
    data_dependent_skipped_count: 0,
    error_count: 0,
    input_freshness: { status: 'fresh', age_ms: 60_000, threshold_hours: 6 },
  };

  const honest = runGradingReadinessProbe({
    status: 'succeeded',
    started_at: '2026-09-19T12:00:00.000Z',
    finished_at: '2026-09-19T12:00:01.000Z',
    details: examinedAndSkipped,
  });
  assert.equal(honest.status, 'pass');
  assert.match(honest.evidence, /no_op_nothing_gradeable/);

  // Mutation control. The same 15,000-row pass mislabelled as no_op_no_input is
  // the defect this lane removes: it positively asserts there was no input. The
  // probe must refuse it rather than pass it as a healthy quiet run.
  const mislabelled = runGradingReadinessProbe({
    status: 'succeeded',
    started_at: '2026-09-19T12:00:00.000Z',
    finished_at: '2026-09-19T12:00:01.000Z',
    details: { ...examinedAndSkipped, outcome_class: 'no_op_no_input' },
  });
  assert.equal(mislabelled.status, 'fail');
  assert.match(mislabelled.evidence, /examined 15000 rows/);
});


test('PM-ratified five-value grading model is understood by readiness', () => {
  const cases = [
    ['succeeded_with_work', 'succeeded', 1, 1, 0, 0, 'fresh', 'pass'],
    ['no_op_no_input', 'succeeded', 0, 0, 0, 0, 'fresh', 'pass'],
    ['no_op_nothing_gradeable', 'succeeded', 1, 0, 1, 0, 'fresh', 'pass'],
    ['degraded_stale_input', 'failed', 1, 0, 1, 0, 'stale', 'fail'],
    ['failed', 'failed', 1, 0, 0, 1, 'fresh', 'fail'],
    ['unknown_outcome', 'succeeded', 0, 0, 0, 0, 'fresh', 'fail'],
  ] as const;
  for (const [outcome, status, scanned, graded, skipped, errors, freshness, expected] of cases) {
    const result = runGradingReadinessProbe({
      status,
      started_at: '2026-09-19T12:00:00.000Z',
      finished_at: '2026-09-19T12:00:01.000Z',
      details: {
        outcome_class: outcome,
        rows_scanned: scanned,
        gradeable_rows: graded,
        graded_count: graded,
        skipped_count: skipped,
        skipped_reasons: skipped ? { settlement_already_exists: skipped } : {},
        data_dependent_skipped_count: freshness === 'stale' ? 1 : 0,
        error_count: errors,
        input_freshness: { status: freshness, age_ms: freshness === 'stale' ? 86_400_000 : 60_000, threshold_hours: 6 },
      },
    });
    assert.equal(result.status, expected, outcome);
  }
});

const emptyGradingPass = async () => ({ attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] });
const quietLogger = { info() {}, warn() {}, error() {} };

for (const method of ['startRun', 'completeRun', 'listByType'] as const) {
  test(`loop recovers from transient ${method} failures and resets the consecutive budget`, async () => {
    const runs = new InMemorySystemRunRepository();
    const original = runs[method].bind(runs);
    let attempts = 0;
    // Two bursts separated by success prove the budget resets, rather than accumulating.
    Object.assign(runs, {
      [method]: async (...args: Parameters<typeof original>) => {
        attempts += 1;
        if ([1, 2, 4, 5].includes(attempts)) throw new Error(`injected ${method}`);
        return Reflect.apply(original, runs, args);
      },
    });
    const sleeps: number[] = [];
    let freshCycles = 0;
    const stop = new Error('test complete');
    await assert.rejects(startGradingCronLoop({
      repositories: { ...createInMemoryRepositoryBundle(), runs },
      runGradingPass: emptyGradingPass,
      maxConsecutiveFailures: 3,
      pollIntervalMs: 100,
      retryBaseMs: 10,
      retryMaxMs: 20,
      refreshLiveness: async () => { freshCycles += 1; },
      logger: quietLogger,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 6) throw stop;
      },
    }), (error) => error === stop);
    assert.equal(attempts, 6);
    // One start-of-cycle refresh per loop iteration (6, one per sleep) plus one
    // end-of-cycle refresh for each of the 2 successful cycles.
    assert.equal(freshCycles, 8);
    assert.deepEqual(sleeps, [10, 20, 100, 10, 20, 100]);
  });

  test(`continuous ${method} failure rejects, alerts, exits and leaves the liveness marker stale`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'grading-failure-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'marker');
    let now = 1_000;
    await refreshGradingCronLiveness(path, now);
    const runs = new InMemorySystemRunRepository();
    let attempts = 0;
    Object.assign(runs, { [method]: async () => { attempts += 1; throw new Error('continuous failure'); } });
    const sleeps: number[] = [];
    const alerts: string[] = [];
    const errors: string[] = [];
    const exits: number[] = [];
    let rejected = false;
    await runGradingCronEntrypoint(async () => {
      try {
        await startGradingCronLoop({
          repositories: { ...createInMemoryRepositoryBundle(), runs },
          runGradingPass: emptyGradingPass,
          pollIntervalMs: 10,
          maxConsecutiveFailures: 5,
          retryBaseMs: 10,
          retryMaxMs: 20,
          logger: { ...quietLogger, error: (msg: unknown) => { errors.push(String(msg)); } },
          refreshLiveness: () => refreshGradingCronLiveness(path, now),
          sleep: async (ms) => { sleeps.push(ms); now += ms; },
          onStalenessAlert: async (msg) => { alerts.push(msg); },
        });
      } catch (error) {
        rejected = true;
        assert.match(String(error), /grading.cron.failure_budget_exhausted/);
        throw error;
      }
    }, (code) => { exits.push(code); }, quietLogger);
    assert.equal(rejected, true);
    assert.equal(attempts, 5);
    assert.deepEqual(sleeps, [10, 20, 20, 20]);
    assert.deepEqual(exits, [1]);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]!, /grading.cron.failure_budget_exhausted/);
    assert.equal(errors.filter((msg) => msg.includes('failure_budget_exhausted')).length, 1);
    // The start-of-cycle refresh stamps each attempt, so the marker is only as
    // fresh as the last attempt (the process exits right after). Once three
    // polls pass with no further refresh it is stale: a dead loop never reads
    // healthy for longer than the freshness bound.
    assert.equal(await isGradingCronFresh(path, 10, now + 31), false);
  });
}

test('entrypoint exits even when the ops alert rejects', async () => {
  const runs = new InMemorySystemRunRepository();
  runs.startRun = async () => { throw new Error('offline'); };
  const exits: number[] = [];
  await runGradingCronEntrypoint(() => startGradingCronLoop({
    repositories: { ...createInMemoryRepositoryBundle(), runs },
    runGradingPass: emptyGradingPass,
    maxConsecutiveFailures: 1,
    onStalenessAlert: async () => { throw new Error('webhook offline'); },
    logger: quietLogger,
  }), (code) => { exits.push(code); }, quietLogger);
  assert.deepEqual(exits, [1]);
});

test('a hung ops alert cannot keep an exhausted loop alive', async () => {
  const runs = new InMemorySystemRunRepository();
  runs.startRun = async () => { throw new Error('offline'); };
  const exits: number[] = [];
  await runGradingCronEntrypoint(() => startGradingCronLoop({
    repositories: { ...createInMemoryRepositoryBundle(), runs },
    runGradingPass: emptyGradingPass,
    maxConsecutiveFailures: 1,
    onStalenessAlert: () => new Promise<void>(() => {}),
    logger: quietLogger,
  }), (code) => { exits.push(code); }, quietLogger);
  assert.deepEqual(exits, [1]);
});

test('liveness write failures at cycle start use the same bounded recovery policy', async () => {
  let writes = 0;
  const stop = new Error('test complete');
  const sleeps: number[] = [];
  await assert.rejects(startGradingCronLoop({
    repositories: createInMemoryRepositoryBundle(),
    runGradingPass: emptyGradingPass,
    logger: quietLogger,
    refreshLiveness: async () => {
      writes += 1;
      if (writes < 3) throw new Error('disk unavailable');
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      // writes: 1 and 2 fail at cycle start, 3 (start) and 4 (end) succeed.
      if (writes === 4) throw stop;
    },
  }), (error) => error === stop);
  assert.deepEqual(sleeps, [1_000, 2_000, 300_000]);
  assert.equal(writes, 4);
});

test('liveness write failures at cycle end use the same bounded recovery policy', async () => {
  let writes = 0;
  const stop = new Error('test complete');
  const sleeps: number[] = [];
  await assert.rejects(startGradingCronLoop({
    repositories: createInMemoryRepositoryBundle(),
    runGradingPass: emptyGradingPass,
    logger: quietLogger,
    refreshLiveness: async () => {
      writes += 1;
      // Even-numbered writes are the end-of-cycle refresh.
      if (writes === 2 || writes === 4) throw new Error('disk unavailable');
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      if (writes === 6) throw stop;
    },
  }), (error) => error === stop);
  assert.deepEqual(sleeps, [1_000, 2_000, 300_000]);
  assert.equal(writes, 6);
});

test('WORK-2026110801: liveness is refreshed before the grading pass in every cycle', async () => {
  const events: string[] = [];
  const stop = new Error('test complete');
  let sleeps = 0;
  await assert.rejects(startGradingCronLoop({
    repositories: createInMemoryRepositoryBundle(),
    runGradingPass: async () => {
      events.push('pass');
      return { attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] };
    },
    logger: quietLogger,
    refreshLiveness: async () => { events.push('refresh'); },
    sleep: async () => { sleeps += 1; if (sleeps === 2) throw stop; },
  }), (error) => error === stop);
  assert.deepEqual(events, ['refresh', 'pass', 'refresh', 'refresh', 'pass', 'refresh']);
});

test('WORK-2026110801: a failing pass still leaves the start-of-cycle refresh recorded, and #1837 failure handling is unchanged', async () => {
  const events: string[] = [];
  const sleeps: number[] = [];
  const alerts: string[] = [];
  await assert.rejects(startGradingCronLoop({
    repositories: createInMemoryRepositoryBundle(),
    runGradingPass: async () => {
      events.push('pass');
      throw new Error('injected grading pass failure');
    },
    maxConsecutiveFailures: 2,
    retryBaseMs: 10,
    retryMaxMs: 20,
    logger: quietLogger,
    refreshLiveness: async () => { events.push('refresh'); },
    sleep: async (ms) => { sleeps.push(ms); },
    onStalenessAlert: async (message) => { alerts.push(message); },
  }), (error) => /failure_budget_exhausted/.test(String(error)));
  // Every attempt is stamped before it runs; no end-of-cycle refresh on failure.
  assert.deepEqual(events, ['refresh', 'pass', 'refresh', 'pass']);
  // Existing bounded backoff and exhaustion alert behaviour is unchanged.
  assert.deepEqual(sleeps, [10]);
  assert.equal(alerts.filter((message) => /failure_budget_exhausted/.test(message)).length, 1);
});

/**
 * Real marker file + injected clock, read with the same isGradingCronFresh rule
 * the compose probe implements (age <= 3 x poll, polled every minute).
 */
async function sampleLivenessTimeline(passMinutes: number, cycles: number) {
  const dir = await mkdtemp(join(tmpdir(), 'grading-timeline-'));
  const path = join(dir, 'marker');
  const poll = 300_000;
  const minute = 60_000;
  let now = 1_000_000;
  const stale: number[] = [];
  const stop = new Error('timeline complete');
  let completed = 0;
  try {
    await assert.rejects(startGradingCronLoop({
      repositories: createInMemoryRepositoryBundle(),
      pollIntervalMs: poll,
      logger: quietLogger,
      refreshLiveness: () => refreshGradingCronLiveness(path, now),
      runGradingPass: async () => {
        for (let m = 1; m <= passMinutes; m += 1) {
          now += minute;
          if (!(await isGradingCronFresh(path, poll, now))) stale.push(m);
        }
        return { attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] };
      },
      sleep: async (ms) => {
        // Sample the idle poll gap minute by minute too.
        for (let waited = 0; waited < ms; waited += minute) {
          now += Math.min(minute, ms - waited);
          if (!(await isGradingCronFresh(path, poll, now))) stale.push(-1);
        }
        completed += 1;
        if (completed === cycles) throw stop;
      },
    }), (error) => error === stop);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return stale;
}

test('WORK-2026110801: a normal 12 min pass with a 5 min poll stays healthy through every cycle', async () => {
  assert.deepEqual(await sampleLivenessTimeline(12, 4), []);
});

test('WORK-2026110801: a pass at the 3 x poll bound is healthy; one over it, and so a hung pass, reads unhealthy', async () => {
  assert.deepEqual(await sampleLivenessTimeline(15, 2), [], 'age == 15 min is still healthy');
  const overBound = await sampleLivenessTimeline(17, 1);
  assert.deepEqual(overBound, [16, 17], 'minutes past 15 without a refresh read unhealthy');
});

test('grading-cron-health: liveness is unhealthy when missing, expired, malformed or future; healthy within three polls', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'grading-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'marker');
  assert.equal(await isGradingCronFresh(path, 100, 1_000), false);
  await refreshGradingCronLiveness(path, 1_000);
  assert.equal(await isGradingCronFresh(path, 100, 1_000), true);
  assert.equal(await isGradingCronFresh(path, 100, 1_300), true);
  assert.equal(await isGradingCronFresh(path, 100, 1_301), false);
  assert.equal(await isGradingCronFresh(path, 100, 999), false);
  for (const content of ['', 'garbage', 'Infinity']) {
    await writeFile(path, content);
    assert.equal(await isGradingCronFresh(path, 100, 1_000), false);
  }
  assert.equal(await isGradingCronFresh(path, 0), false);
});

type ScriptedPass = 'fail' | 'noop' | 'work';

/**
 * Drives the real loop with passes that persist a grading.run row exactly as
 * runGradingPass does (a failed pass persists outcome 'failed' and throws).
 */
async function runScriptedGradingLoop(
  script: ScriptedPass[],
  runs: InMemorySystemRunRepository,
): Promise<string[]> {
  const alerts: string[] = [];
  let index = 0;
  let lastSucceeded = false;
  // The in-memory repo sorts by millisecond timestamp, so same-millisecond runs
  // come back oldest-first. Real storage is newest-first; make that deterministic.
  const listByTypeRaw = runs.listByType.bind(runs);
  const idOf = (run: SystemRunRecord) => Number(run.id.replace('run_', ''));
  Object.assign(runs, {
    listByType: async (runType: string, limit = 50) =>
      (await listByTypeRaw(runType, 10_000)).sort((a, b) => idOf(b) - idOf(a)).slice(0, limit),
  });
  const stop = new Error('script complete');
  const persist = async (outcome: string, status: 'failed' | 'succeeded') => {
    const run = await runs.startRun({ runType: 'grading.run', details: { outcome_class: 'failed' } });
    await runs.completeRun({
      runId: run.id,
      status,
      details: { outcome_class: outcome, graded_count: outcome === 'succeeded_with_work' ? 2 : 0 },
    });
  };
  await assert.rejects(
    startGradingCronLoop({
      repositories: { ...createInMemoryRepositoryBundle(), runs },
      maxConsecutiveFailures: 5,
      pollIntervalMs: 10,
      retryBaseMs: 1,
      retryMaxMs: 2,
      refreshLiveness: async () => {},
      logger: quietLogger,
      onStalenessAlert: async (message) => {
        alerts.push(message);
      },
      runGradingPass: async () => {
        const step = script[index++];
        lastSucceeded = step !== 'fail';
        if (step === 'fail') {
          await persist('failed', 'failed');
          throw new Error('injected grading pass failure');
        }
        if (step === 'work') await persist('succeeded_with_work', 'succeeded');
        else await persist('no_op_no_input', 'succeeded');
        return { attempted: 0, graded: 0, skipped: 0, errors: 0, details: [] };
      },
      sleep: async () => {
        if (index >= script.length && lastSucceeded) throw stop;
      },
    }),
    (error) => error === stop,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return alerts;
}

test('a failed grading pass followed by a no-work cycle still raises the grading-health alert once', async () => {
  const alerts = await runScriptedGradingLoop(['fail', 'noop'], new InMemorySystemRunRepository());
  assert.equal(alerts.length, 1);
  assert.match(alerts[0] ?? '', /ALERT OPEN: grading outcome=failed/);
});

test('repeated failed passes deduplicate to one alert and fresh work clears it', async () => {
  const alerts = await runScriptedGradingLoop(
    ['fail', 'fail', 'noop', 'work'],
    new InMemorySystemRunRepository(),
  );
  assert.equal(alerts.length, 2);
  assert.match(alerts[0] ?? '', /ALERT OPEN/);
  assert.match(alerts[1] ?? '', /ALERT CLEARED/);
});

test('an alert missed because the failure-path run listing failed is still raised after a no-work cycle', async () => {
  const runs = new InMemorySystemRunRepository();
  const original = runs.listByType.bind(runs);
  let listCalls = 0;
  Object.assign(runs, {
    listByType: async (...args: Parameters<typeof original>) => {
      listCalls += 1;
      // Call 1 is the failure-path evaluation; fail it so the alert is pending.
      if (listCalls === 1) throw new Error('injected listByType failure');
      return Reflect.apply(original, runs, args);
    },
  });
  const alerts = await runScriptedGradingLoop(['fail', 'noop'], runs);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0] ?? '', /ALERT OPEN: grading outcome=failed/);
});
