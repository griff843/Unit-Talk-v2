import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE,
  DEFAULT_PROP_EVENT_LOOKAHEAD_HOURS,
  DEFAULT_PROP_EVENT_LOOKBACK_HOURS,
  chunkEventIds,
  selectPlayerPropEventIds,
} from './sgo-player-prop-scope.js';

/*
 * UTV2-1281 — event-scope the SGO player-prop fetch.
 *
 * The league-wide PLAYER_ID-wildcard prop query over a full slate (MLB) exhausts
 * the per-league timeout. These tests pin the pure selection/batching logic that
 * bounds the prop fetch to the imminent slate's event IDs in small batches.
 */

const SNAPSHOT_AT = '2026-06-17T18:00:00.000Z';

function hoursFromSnapshot(hours: number): string {
  return new Date(Date.parse(SNAPSHOT_AT) + hours * 3_600_000).toISOString();
}

test('selectPlayerPropEventIds keeps events inside the imminent window', () => {
  const ids = selectPlayerPropEventIds(
    [
      { providerEventId: 'soon', startsAt: hoursFromSnapshot(2) },
      { providerEventId: 'edge-ahead', startsAt: hoursFromSnapshot(DEFAULT_PROP_EVENT_LOOKAHEAD_HOURS) },
      { providerEventId: 'in-progress', startsAt: hoursFromSnapshot(-2) },
    ],
    SNAPSHOT_AT,
  );
  assert.deepEqual(ids, ['soon', 'edge-ahead', 'in-progress']);
});

test('selectPlayerPropEventIds drops events outside the window (too far ahead / long past)', () => {
  const ids = selectPlayerPropEventIds(
    [
      { providerEventId: 'too-far', startsAt: hoursFromSnapshot(DEFAULT_PROP_EVENT_LOOKAHEAD_HOURS + 1) },
      { providerEventId: 'long-past', startsAt: hoursFromSnapshot(-(DEFAULT_PROP_EVENT_LOOKBACK_HOURS + 1)) },
      { providerEventId: 'keep', startsAt: hoursFromSnapshot(6) },
    ],
    SNAPSHOT_AT,
  );
  assert.deepEqual(ids, ['keep']);
});

test('selectPlayerPropEventIds excludes events with missing or unparseable startsAt', () => {
  const ids = selectPlayerPropEventIds(
    [
      { providerEventId: 'no-start', startsAt: null },
      { providerEventId: 'bad-start', startsAt: 'not-a-date' },
      { providerEventId: 'good', startsAt: hoursFromSnapshot(1) },
    ],
    SNAPSHOT_AT,
  );
  assert.deepEqual(ids, ['good']);
});

test('selectPlayerPropEventIds de-duplicates while preserving order, drops empty ids', () => {
  const ids = selectPlayerPropEventIds(
    [
      { providerEventId: 'a', startsAt: hoursFromSnapshot(1) },
      { providerEventId: '', startsAt: hoursFromSnapshot(1) },
      { providerEventId: 'a', startsAt: hoursFromSnapshot(2) },
      { providerEventId: 'b', startsAt: hoursFromSnapshot(3) },
    ],
    SNAPSHOT_AT,
  );
  assert.deepEqual(ids, ['a', 'b']);
});

test('selectPlayerPropEventIds returns empty for an empty slate or bad snapshot', () => {
  assert.deepEqual(selectPlayerPropEventIds([], SNAPSHOT_AT), []);
  assert.deepEqual(
    selectPlayerPropEventIds(
      [{ providerEventId: 'a', startsAt: hoursFromSnapshot(1) }],
      'not-a-date',
    ),
    [],
  );
});

test('selectPlayerPropEventIds honors custom window options', () => {
  const ids = selectPlayerPropEventIds(
    [
      { providerEventId: 'within-tight', startsAt: hoursFromSnapshot(3) },
      { providerEventId: 'outside-tight', startsAt: hoursFromSnapshot(10) },
    ],
    SNAPSHOT_AT,
    { lookbackHours: 1, lookaheadHours: 6 },
  );
  assert.deepEqual(ids, ['within-tight']);
});

test('chunkEventIds batches at the default size', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `e${i}`);
  const batches = chunkEventIds(ids);
  assert.equal(batches.length, Math.ceil(12 / DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE));
  assert.equal(batches[0]?.length, DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE);
  assert.deepEqual(batches.flat(), ids);
  assert.equal(batches.at(-1)?.length, 12 % DEFAULT_PLAYER_PROP_EVENT_BATCH_SIZE);
});

test('chunkEventIds honors an explicit batch size and coerces invalid sizes to the default', () => {
  assert.deepEqual(chunkEventIds(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
  assert.deepEqual(chunkEventIds([], 5), []);
  // Invalid sizes fall back to the default rather than producing degenerate batches.
  assert.deepEqual(chunkEventIds(['a', 'b'], 0).flat(), ['a', 'b']);
  assert.deepEqual(chunkEventIds(['a', 'b'], Number.NaN).flat(), ['a', 'b']);
});
