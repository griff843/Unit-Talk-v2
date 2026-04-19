import assert from 'node:assert/strict';
import test from 'node:test';
import { runGradingCronCycles, startGradingCronLoop } from './grading-cron.js';
import type { SystemRunRecord } from '@unit-talk/db';

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
