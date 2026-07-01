import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flatMapCooperatively,
  mapCooperatively,
  mapWithConcurrency,
  withRetry,
  yieldToEventLoop,
} from './cooperative.js';

/*
 * UTV2-1283 — cooperative yielding so a heavy synchronous transform cannot block the
 * event loop and defeat the per-league timeout. The decisive test: a timer-based
 * abort (the same mechanism as the 240s leagueTimeout) must be able to interrupt the
 * transform mid-flight — which is only possible if the transform yields.
 */

test('mapCooperatively preserves order and output', async () => {
  const out = await mapCooperatively([1, 2, 3, 4], (n, i) => n * 10 + i, {
    chunkSize: 2,
  });
  assert.deepEqual(out, [10, 21, 32, 43]);
});

test('flatMapCooperatively flattens one level in order', async () => {
  const out = await flatMapCooperatively([1, 2, 3], (n) => [n, -n], {
    chunkSize: 1,
  });
  assert.deepEqual(out, [1, -1, 2, -2, 3, -3]);
});

test('mapCooperatively yields, so a timer-based abort interrupts it mid-transform (UTV2-1283)', async () => {
  const controller = new AbortController();
  // The abort is scheduled on a timer — exactly like the per-league timeout. It can
  // only fire if the transform yields to the event loop between chunks.
  setTimeout(() => controller.abort(new Error('deadline')), 0);

  let processed = 0;
  await assert.rejects(
    mapCooperatively(
      Array.from({ length: 200_000 }, (_, i) => i),
      (i) => {
        processed += 1;
        return i;
      },
      { chunkSize: 1_000, signal: controller.signal },
    ),
    (error: unknown) => error instanceof Error,
  );

  // The transform stopped FAR short of all 200k items — proving the timer fired and
  // the signal was observed mid-transform. A blocking (non-yielding) map would run to
  // completion before the setTimeout(0) could ever fire.
  assert.ok(
    processed > 0 && processed < 200_000,
    `expected early abort mid-transform, processed ${processed}/200000`,
  );
});

test('flatMapCooperatively honors an already-aborted signal immediately', async () => {
  const controller = new AbortController();
  controller.abort(new Error('already'));
  await assert.rejects(
    flatMapCooperatively([1, 2, 3], (n) => [n], {
      chunkSize: 1,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error,
  );
});

test('cooperative helpers complete normally with no signal (light path)', async () => {
  assert.deepEqual(await mapCooperatively([], (n) => n), []);
  assert.deepEqual(await mapCooperatively([5], (n) => n + 1), [6]);
  assert.deepEqual(await flatMapCooperatively([], () => [1]), []);
});

test('yieldToEventLoop resolves on a later macrotask (timers can run before it)', async () => {
  let timerRan = false;
  setTimeout(() => {
    timerRan = true;
  }, 0);
  await yieldToEventLoop();
  assert.ok(timerRan, 'a setTimeout(0) scheduled before the yield must run during it');
});

/*
 * UTV2-1298 — mapWithConcurrency: bounded-concurrency async map used to parallelize
 * sequential entity-resolution PostgREST writes under a cap. Must preserve order,
 * honor the cap, run sequentially at concurrency 1 (the reversible fallback), and
 * fail closed deterministically on the first error.
 */

test('mapWithConcurrency preserves result order', async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (n) => {
    await yieldToEventLoop();
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test('mapWithConcurrency honors the concurrency cap', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapWithConcurrency(
    Array.from({ length: 20 }, (_unused, i) => i),
    4,
    async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await yieldToEventLoop();
      await yieldToEventLoop();
      inFlight -= 1;
      return null;
    },
  );
  assert.ok(maxInFlight <= 4, `max in-flight ${maxInFlight} must not exceed cap 4`);
  assert.ok(maxInFlight >= 2, 'should actually run concurrently above 1');
});

test('mapWithConcurrency runs sequentially at concurrency 1 (reversible fallback)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const order: number[] = [];
  await mapWithConcurrency([0, 1, 2, 3], 1, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await yieldToEventLoop();
    order.push(n);
    inFlight -= 1;
    return n;
  });
  assert.equal(maxInFlight, 1, 'concurrency 1 must never overlap');
  assert.deepEqual(order, [0, 1, 2, 3], 'sequential order preserved');
});

test('mapWithConcurrency coerces non-finite/zero concurrency to sequential', async () => {
  let maxInFlight = 0;
  let inFlight = 0;
  await mapWithConcurrency([1, 2, 3], 0, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await yieldToEventLoop();
    inFlight -= 1;
    return n;
  });
  assert.equal(maxInFlight, 1);
});

/*
 * UTV2-1373 — withRetry: gated retry for transient statement-timeout errors on
 * participant upserts. 3 total attempts (PM requirement). Fail-closed on budget
 * exhaustion and on non-retryable errors. Successful retries do NOT count as errors.
 */

const isTimeout = (e: unknown) =>
  /statement timeout/i.test((e as Error)?.message ?? '');

test('withRetry succeeds on second attempt when first is retryable', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('statement timeout');
      return 'ok';
    },
    { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, isRetryable: isTimeout },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('withRetry exhausts budget and rethrows last error (fail-closed)', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('statement timeout');
      },
      { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, isRetryable: isTimeout },
    ),
    /statement timeout/,
  );
  assert.equal(calls, 3, 'must use all 3 attempts before giving up');
});

test('withRetry rethrows non-retryable error immediately without using remaining budget', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('non-retryable connection error');
      },
      { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, isRetryable: isTimeout },
    ),
    /non-retryable/,
  );
  assert.equal(calls, 1, 'non-retryable error must not use remaining retry budget');
});

test('withRetry with attempts=1 is a no-retry pass-through', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error('statement timeout');
      },
      { attempts: 1, baseDelayMs: 0, maxDelayMs: 0, isRetryable: isTimeout },
    ),
    /statement timeout/,
  );
  assert.equal(calls, 1, 'attempts=1 must not retry at all');
});

test('withRetry fires onRetry callback for each retried attempt (not on success)', async () => {
  const retries: number[] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('statement timeout');
      return 'done';
    },
    {
      attempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      isRetryable: isTimeout,
      onRetry: (attempt) => { retries.push(attempt); },
    },
  );
  assert.equal(result, 'done');
  assert.deepEqual(retries, [1, 2], 'onRetry fires for attempt 1 and 2 (not the final success)');
});

test('mapWithConcurrency fails closed: throws first error and stops dispatching', async () => {
  const started: number[] = [];
  await assert.rejects(
    mapWithConcurrency(Array.from({ length: 30 }, (_unused, i) => i), 2, async (n) => {
      started.push(n);
      await yieldToEventLoop();
      if (n === 1) {
        throw new Error('boom');
      }
      return n;
    }),
    /boom/,
  );
  // With cap 2 and an early failure, it must NOT dispatch all 30 items.
  assert.ok(started.length < 30, `expected early stop, dispatched ${started.length}/30`);
});
