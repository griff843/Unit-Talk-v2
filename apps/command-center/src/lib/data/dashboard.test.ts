import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapLifecycleStatus } from './dashboard';

test('mapLifecycleStatus preserves governed review state and does not coerce unknown states', () => {
  assert.equal(mapLifecycleStatus('awaiting_approval'), 'awaiting_approval');
  assert.equal(mapLifecycleStatus('validated'), 'validated');
  assert.equal(mapLifecycleStatus('unexpected_future_state'), 'unknown');
});
