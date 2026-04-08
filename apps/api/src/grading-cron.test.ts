import assert from 'node:assert/strict';
import test from 'node:test';
import { runGradingCronCycles } from './grading-cron.js';

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
