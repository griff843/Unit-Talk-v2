import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  evaluateGradingHealthAlertTransition,
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
