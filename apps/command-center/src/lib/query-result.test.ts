import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertQuerySucceeded, readAuthoritativeCount } from './query-result';

test('assertQuerySucceeded rejects database errors instead of allowing an empty-state fallback', () => {
  assert.throws(
    () => assertQuerySucceeded({ error: { message: 'connection unavailable' } }, 'review queue'),
    /review queue: connection unavailable/,
  );
});

test('readAuthoritativeCount distinguishes measured zero from an unavailable count', () => {
  assert.equal(readAuthoritativeCount({ error: null, count: 0 }, 'active picks'), 0);
  assert.throws(
    () => readAuthoritativeCount({ error: null, count: null }, 'active picks'),
    /active picks: authoritative count unavailable/,
  );
});
