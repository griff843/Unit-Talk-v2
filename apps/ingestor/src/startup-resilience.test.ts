import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runStartupStepWithRetry,
  startupBackoffDelayMs,
} from './startup-resilience.js';

/*
 * UTV2-1288 — resilient ingestor startup chain.
 *
 * Proven production failure (2026-06-22): during a transient Supabase outage the
 * pre-loop `reapStaleRuns` call threw, the rejection escaped to the top-level
 * `.catch` which set process.exitCode=1, the process exited, and
 * `restart: unless-stopped` recreated it instantly — a tight crash-restart loop
 * (RestartCount=109 in ~10h, only 3 watchdog exits).
 *
 * These tests prove the startup-step runner:
 *   (1) NEVER throws — a step that always fails returns { ok:false } so the
 *       daemon can continue into the resilient cycle loop instead of crash-exiting;
 *   (2) retries with bounded exponential backoff and emits an onRetry signal each
 *       time (used to stamp a startup heartbeat so the watchdog sees progress);
 *   (3) RECOVERS — a step that fails transiently then succeeds returns the value;
 *   (4) succeeds on the first attempt with no backoff when the step is healthy.
 */

const noopSleep = async () => {};

test('UTV2-1288: a startup step that always fails never throws — returns ok:false', async () => {
  let calls = 0;
  const result = await runStartupStepWithRetry(
    async () => {
      calls += 1;
      throw new Error('Supabase 521: Web server is down');
    },
    { label: 'reapStaleRuns', maxAttempts: 3, sleep: noopSleep },
  );

  assert.equal(result.ok, false, 'exhausted step resolves ok:false rather than throwing');
  assert.equal(result.attempts, 3, 'all attempts were made');
  assert.match(result.error ?? '', /521/, 'last error message is surfaced');
  assert.equal(calls, 3, 'op was invoked once per attempt');
});

test('UTV2-1288: a transient failure that then heals returns the recovered value', async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await runStartupStepWithRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error('statement timeout');
      }
      return 7; // e.g. 7 stale runs reaped once the DB heals
    },
    {
      label: 'reapStaleRuns',
      maxAttempts: 5,
      sleep: noopSleep,
      onRetry: ({ attempt }) => retries.push(attempt),
    },
  );

  assert.equal(result.ok, true, 'recovered before exhausting the budget');
  assert.equal(result.value, 7, 'resolved value is returned');
  assert.equal(result.attempts, 3, 'succeeded on the third attempt');
  assert.deepEqual(retries, [1, 2], 'onRetry fired after attempts 1 and 2, not after the success');
});

test('UTV2-1288: a healthy step succeeds on the first attempt with no retries', async () => {
  let retried = false;
  const result = await runStartupStepWithRetry(async () => 0, {
    label: 'reapStaleRuns',
    sleep: noopSleep,
    onRetry: () => {
      retried = true;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 0);
  assert.equal(result.attempts, 1, 'no retry on a first-attempt success');
  assert.equal(retried, false, 'onRetry never fired');
});

test('UTV2-1288: onRetry reports the backoff delay so callers can stamp progress', async () => {
  const delays: number[] = [];
  await runStartupStepWithRetry(
    async () => {
      throw new Error('transient');
    },
    {
      label: 'reapStaleRuns',
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 15_000,
      sleep: noopSleep,
      onRetry: ({ delayMs }) => delays.push(delayMs),
    },
  );

  // Two retries before the third (final) attempt: 1s then 2s exponential backoff.
  assert.deepEqual(delays, [1_000, 2_000], 'exponential backoff delays surfaced to onRetry');
});

test('UTV2-1288: backoff is exponential and capped at maxDelayMs', () => {
  assert.equal(startupBackoffDelayMs(1, 1_000, 15_000), 1_000, 'attempt 1 = base');
  assert.equal(startupBackoffDelayMs(2, 1_000, 15_000), 2_000, 'attempt 2 = 2× base');
  assert.equal(startupBackoffDelayMs(3, 1_000, 15_000), 4_000, 'attempt 3 = 4× base');
  assert.equal(startupBackoffDelayMs(5, 1_000, 15_000), 15_000, 'capped at maxDelayMs');
  assert.equal(startupBackoffDelayMs(10, 1_000, 15_000), 15_000, 'stays capped');
});

test('UTV2-1288: maxAttempts is clamped to at least one attempt', async () => {
  let calls = 0;
  const result = await runStartupStepWithRetry(
    async () => {
      calls += 1;
      return 'ok';
    },
    { label: 'reapStaleRuns', maxAttempts: 0, sleep: noopSleep },
  );

  assert.equal(calls, 1, 'a non-positive maxAttempts still runs the op once');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'ok');
});
