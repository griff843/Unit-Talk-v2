import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFutureLeakage, type FutureLeakageInput } from './future-leakage-detector.js';

const CUT = '2026-05-01T18:00:00.000Z'; // decision cutoff

test('clean when all field evidence predates cutoff', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [
      { field: 'player_form', evidence_at: '2026-05-01T12:00:00.000Z' },
      { field: 'market_edge', evidence_at: '2026-05-01T17:59:59.999Z' },
    ],
  });
  assert.equal(result.status, 'clean');
  assert.equal(result.leaked_fields.length, 0);
});

test('leaked when one field evidence postdates cutoff', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [
      { field: 'clv', evidence_at: '2026-05-01T19:00:00.000Z' },
      { field: 'market_edge', evidence_at: '2026-05-01T17:00:00.000Z' },
    ],
  });
  assert.equal(result.status, 'leaked');
  assert.deepEqual(result.leaked_fields, ['clv']);
});

test('leaked reports all post-cutoff fields', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [
      { field: 'clv', evidence_at: '2026-05-02T00:00:00.000Z' },
      { field: 'closing_line', evidence_at: '2026-05-02T01:00:00.000Z' },
      { field: 'market_edge', evidence_at: '2026-05-01T17:00:00.000Z' },
    ],
  });
  assert.equal(result.status, 'leaked');
  assert.deepEqual([...result.leaked_fields].sort(), ['closing_line', 'clv']);
});

test('clean with empty field_evidence list', () => {
  const result = detectFutureLeakage({ cutoff: CUT, field_evidence: [] });
  assert.equal(result.status, 'clean');
  assert.equal(result.leaked_fields.length, 0);
});

test('exactly at cutoff is not leaked (boundary: same millisecond)', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [{ field: 'market_edge', evidence_at: CUT }],
  });
  assert.equal(result.status, 'clean');
});

test('1ms after cutoff is leaked', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [{ field: 'closing_line', evidence_at: '2026-05-01T18:00:00.001Z' }],
  });
  assert.equal(result.status, 'leaked');
  assert.deepEqual(result.leaked_fields, ['closing_line']);
});

test('indeterminate when cutoff is not a valid ISO-8601 string', () => {
  const result = detectFutureLeakage({
    cutoff: 'not-a-date',
    field_evidence: [{ field: 'clv', evidence_at: CUT }],
  });
  assert.equal(result.status, 'indeterminate');
  assert.ok(result.status === 'indeterminate' && result.reason.includes('cutoff'));
});

test('indeterminate when a field evidence_at is not a valid ISO-8601 string', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [{ field: 'bad_field', evidence_at: 'garbage' }],
  });
  assert.equal(result.status, 'indeterminate');
  assert.ok(result.status === 'indeterminate' && result.reason.includes('bad_field'));
});

test('deterministic: same input always returns same result', () => {
  const input: FutureLeakageInput = {
    cutoff: CUT,
    field_evidence: [
      { field: 'clv', evidence_at: '2026-05-01T19:00:00.000Z' },
      { field: 'form', evidence_at: '2026-05-01T10:00:00.000Z' },
    ],
  };
  const r1 = detectFutureLeakage(input);
  const r2 = detectFutureLeakage(input);
  assert.deepEqual(r1, r2);
});

test('only leaked fields appear in result — clean fields excluded', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [
      { field: 'form', evidence_at: '2026-04-30T00:00:00.000Z' },
      { field: 'clv', evidence_at: '2026-05-02T00:00:00.000Z' },
      { field: 'edge', evidence_at: '2026-05-01T17:00:00.000Z' },
    ],
  });
  assert.equal(result.status, 'leaked');
  assert.deepEqual(result.leaked_fields, ['clv']);
});

test('far-future leakage detected (days after cutoff)', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [{ field: 'final_score', evidence_at: '2026-05-10T00:00:00.000Z' }],
  });
  assert.equal(result.status, 'leaked');
});

test('far-past evidence is clean (days before cutoff)', () => {
  const result = detectFutureLeakage({
    cutoff: CUT,
    field_evidence: [{ field: 'season_avg', evidence_at: '2026-01-01T00:00:00.000Z' }],
  });
  assert.equal(result.status, 'clean');
});
