import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUtcDayWindows, mapLifecycleStatus } from './dashboard';

test('mapLifecycleStatus preserves governed review state and does not coerce unknown states', () => {
  assert.equal(mapLifecycleStatus('awaiting_approval'), 'awaiting_approval');
  assert.equal(mapLifecycleStatus('validated'), 'validated');
  assert.equal(mapLifecycleStatus('unexpected_future_state'), 'unknown');
});

test('buildUtcDayWindows creates complete UTC calendar buckets ending with the current day', () => {
  assert.deepEqual(buildUtcDayWindows(3, new Date('2026-08-30T15:45:00.000Z')), [
    {
      day: '2026-08-28',
      startIso: '2026-08-28T00:00:00.000Z',
      endIso: '2026-08-29T00:00:00.000Z',
    },
    {
      day: '2026-08-29',
      startIso: '2026-08-29T00:00:00.000Z',
      endIso: '2026-08-30T00:00:00.000Z',
    },
    {
      day: '2026-08-30',
      startIso: '2026-08-30T00:00:00.000Z',
      endIso: '2026-08-31T00:00:00.000Z',
    },
  ]);
});
