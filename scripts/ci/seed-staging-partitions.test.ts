import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PARTITION_LOOKAHEAD_DAYS,
  PARTITION_LOOKBACK_DAYS,
  partitionWindow,
} from './seed-staging-fixtures.js';

test('partition window covers yesterday through two weeks ahead (UTC)', () => {
  assert.equal(PARTITION_LOOKBACK_DAYS, 1);
  assert.equal(PARTITION_LOOKAHEAD_DAYS, 14);
  assert.deepEqual(partitionWindow(new Date('2026-11-25T15:00:00Z')), {
    p_start_day: '2026-11-24',
    p_end_day: '2026-12-09',
  });
});

test('partition window uses the UTC day, not local time, and crosses month and year ends', () => {
  assert.deepEqual(partitionWindow(new Date('2026-12-31T23:59:59Z')), {
    p_start_day: '2026-12-30',
    p_end_day: '2027-01-14',
  });
  assert.deepEqual(partitionWindow(new Date('2027-01-01T00:00:00Z')), {
    p_start_day: '2026-12-31',
    p_end_day: '2027-01-15',
  });
});

test('window always includes the current UTC day', () => {
  const now = new Date('2026-03-08T07:30:00Z');
  const { p_start_day, p_end_day } = partitionWindow(now);
  const today = now.toISOString().slice(0, 10);
  assert.ok(p_start_day < today && today < p_end_day);
});
