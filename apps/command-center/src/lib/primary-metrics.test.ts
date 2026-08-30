import assert from 'node:assert/strict';
import test from 'node:test';
import { readTodayPickCount } from './primary-metrics';

test('readTodayPickCount uses the measured current-day bucket instead of a loaded picks window', () => {
  assert.equal(readTodayPickCount([2, 4, 3, 7]), 7);
});

test('readTodayPickCount preserves unavailable daily measurements as unknown', () => {
  assert.equal(readTodayPickCount(null), null);
  assert.equal(readTodayPickCount([]), null);
});
