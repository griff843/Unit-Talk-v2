import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketDeadLetterRows } from './readiness-refresh.js';
import { evaluateQueueMovement, type QueueRow } from './runtime-health-queue.js';

const now = new Date('2026-09-27T16:00:00Z');
const thresholds = { outboxMaxPendingWarn: 20, outboxMaxPendingCrit: 100, outboxStuckProcMin: 5, outboxDeadLetterCrit: 1 };

function run(rows: QueueRow[], overrides: { nonSentCount?: number | null; sentCount?: number | null } = {}) {
  return evaluateQueueMovement({
    rows,
    nonSentCount: overrides.nonSentCount === undefined ? rows.length : overrides.nonSentCount,
    sentCount: overrides.sentCount === undefined ? 3760 : overrides.sentCount,
    now,
    thresholds,
  });
}

const hold = (id: string, attempts = 0): QueueRow => ({
  id,
  status: 'dead_letter',
  attempt_count: attempts,
  last_error: 'operator-disposition: retired target',
});

test('a clean, completely read queue is healthy', () => {
  const result = run([{ id: 'p1', status: 'pending' }]);
  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.counts.pending, 1);
});

test('a read shorter than the exact non-sent count is UNKNOWN, never healthy', () => {
  const result = run([{ id: 'p1', status: 'pending' }], { nonSentCount: 1990 });
  assert.equal(result.state, 'UNKNOWN');
  assert.match(result.issues[0] ?? '', /read 1 of 1990/);
});

test('a partial read is UNKNOWN even when the sample shows a true failure', () => {
  const failure: QueueRow = { id: 'd1', status: 'dead_letter', attempt_count: 3, last_error: 'discord 500' };
  assert.equal(run([failure], { nonSentCount: 2 }).state, 'UNKNOWN');
});

test('an unreadable exact count is UNKNOWN', () => {
  assert.equal(run([], { nonSentCount: null }).state, 'UNKNOWN');
  assert.equal(run([], { sentCount: null }).state, 'UNKNOWN');
});

test('an attempted, unrecognised dead letter is a true failure and FAILED', () => {
  const result = run([{ id: 'd1', status: 'dead_letter', attempt_count: 3, last_error: 'discord 500' }]);
  assert.equal(result.state, 'FAILED');
  assert.equal(result.counts.trueDeadLetter, 1);
});

test('governance holds are DEGRADED and named, whatever their attempt count', () => {
  const result = run([hold('h1', 0), hold('h2', 2)]);
  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.counts.governanceHold, 2);
  assert.equal(result.counts.trueDeadLetter, 0);
  assert.ok(result.issues.some((i) => /2 governance-hold/.test(i)));
});

test('an unattempted, unclassified dead letter is DEGRADED, not FAILED', () => {
  const result = run([{ id: 'u1', status: 'dead_letter', attempt_count: 0, last_error: 'something new' }]);
  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.counts.unattemptedUnclassified, 1);
});

test('dead-letter counts match the readiness gate on the same rows', () => {
  const rows: QueueRow[] = [
    hold('a', 0),
    hold('b', 4),
    { id: 'c', status: 'dead_letter', attempt_count: 0, last_error: null },
    { id: 'd', status: 'dead_letter', attempt_count: 2, last_error: 'timeout' },
    { id: 'e', status: 'dead_letter', attempt_count: 'x' as unknown as number, last_error: 'timeout' },
    { id: 'f', status: 'dead_letter', attempt_count: 0, last_error: 'proof-pick-blocked: x' },
    { id: 'g', status: 'dead_letter', last_error: 'stale_pending_operator_review' },
  ];
  const gate = bucketDeadLetterRows(rows as unknown as Record<string, unknown>[]);
  const { counts } = run(rows);
  assert.deepEqual(
    { governanceHold: counts.governanceHold, unattemptedUnclassified: counts.unattemptedUnclassified, trueFailure: counts.trueDeadLetter },
    gate,
  );
});

test('a processing row claimed beyond the threshold is stuck and DEGRADED', () => {
  const result = run([{ id: 's1', status: 'processing', claimed_at: '2026-09-27T15:00:00Z' }]);
  assert.equal(result.state, 'DEGRADED');
  assert.equal(result.counts.stuckProcessing, 1);
});

test('the 2026-09-27 production shape: no true failure, holds and stuck rows named', () => {
  const rows: QueueRow[] = [
    ...Array.from({ length: 1950 }, (_, i) => hold(`h${i}`, i % 2)),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, status: 'dead_letter', attempt_count: 0, last_error: null })),
    ...Array.from({ length: 32 }, (_, i) => ({ id: `s${i}`, status: 'processing', claimed_at: '2026-09-01T00:00:00Z' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, status: 'pending' })),
  ];
  const result = run(rows);
  assert.equal(result.state, 'DEGRADED');
  assert.deepEqual(
    [result.counts.governanceHold, result.counts.unattemptedUnclassified, result.counts.trueDeadLetter, result.counts.stuckProcessing, result.counts.pending],
    [1950, 4, 0, 32, 4],
  );
});
