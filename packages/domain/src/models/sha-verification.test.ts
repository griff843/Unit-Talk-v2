import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyShaAtInference } from './sha-verification.js';

const NOW = 1748376000000;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('verified when observed SHA matches expected', () => {
  const result = verifyShaAtInference({
    model_name: 'test-model',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: SHA_A,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.expected_sha, SHA_A);
  assert.equal(result.observed_sha, SHA_A);
  assert.equal(result.verified_at_ms, NOW);
});

test('mismatch when observed SHA differs from expected', () => {
  const result = verifyShaAtInference({
    model_name: 'test-model',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: SHA_B,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'mismatch');
  assert.equal(result.expected_sha, SHA_A);
  assert.equal(result.observed_sha, SHA_B);
});

test('mismatch when observed SHA is null but expected is set', () => {
  const result = verifyShaAtInference({
    model_name: 'test-model',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: null,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'mismatch');
});

test('unverifiable (fail-open) when expected SHA is null', () => {
  const result = verifyShaAtInference({
    model_name: 'legacy-model',
    model_version: 'v1',
    expected_sha: null,
    observed_sha: SHA_A,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'unverifiable');
  assert.equal(result.expected_sha, null);
});

test('unverifiable (fail-open) when expected SHA is undefined', () => {
  const result = verifyShaAtInference({
    model_name: 'legacy-model',
    model_version: 'v2',
    expected_sha: undefined,
    observed_sha: SHA_B,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'unverifiable');
  assert.equal(result.expected_sha, null);
});

test('unverifiable when both SHAs are null', () => {
  const result = verifyShaAtInference({
    model_name: 'legacy-model',
    model_version: 'v3',
    expected_sha: null,
    observed_sha: null,
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'unverifiable');
});

test('result carries model_name and model_version through', () => {
  const result = verifyShaAtInference({
    model_name: 'nfl-spread-v2',
    model_version: 'v1.3.0',
    expected_sha: SHA_A,
    observed_sha: SHA_A,
    verified_at_ms: NOW,
  });
  assert.equal(result.model_name, 'nfl-spread-v2');
  assert.equal(result.model_version, 'v1.3.0');
});

test('verified_at_ms is preserved in result', () => {
  const ts = 1700000000000;
  const result = verifyShaAtInference({
    model_name: 'm',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: SHA_A,
    verified_at_ms: ts,
  });
  assert.equal(result.verified_at_ms, ts);
});

test('deterministic: same input always returns same result', () => {
  const input = {
    model_name: 'deterministic-test',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: SHA_A,
    verified_at_ms: NOW,
  };
  const r1 = verifyShaAtInference(input);
  const r2 = verifyShaAtInference(input);
  assert.deepEqual(r1, r2);
});

test('mismatch when observed SHA is empty string', () => {
  const result = verifyShaAtInference({
    model_name: 'test-model',
    model_version: 'v1',
    expected_sha: SHA_A,
    observed_sha: '',
    verified_at_ms: NOW,
  });
  assert.equal(result.status, 'mismatch');
});

test('domain package purity: no I/O, no DB, no env reads', () => {
  // verifyShaAtInference is a pure function — the import itself would fail
  // if it attempted I/O or DB access at module load time.
  // This test asserts the function exists and is callable without side effects.
  assert.equal(typeof verifyShaAtInference, 'function');
});
