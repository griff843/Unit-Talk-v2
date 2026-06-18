import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flatMapCooperatively,
  mapCooperatively,
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
