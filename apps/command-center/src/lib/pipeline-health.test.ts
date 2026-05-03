import assert from 'node:assert/strict';
import test from 'node:test';

import { derivePipelineHealthSnapshot } from './pipeline-health';

test('derivePipelineHealthSnapshot maps five stages and computes publish errors', () => {
  const snapshot = derivePipelineHealthSnapshot({
    observedAt: '2026-04-30T20:00:00.000Z',
    submissions: [
      { status: 'received', created_at: '2026-04-30T19:50:00.000Z', updated_at: '2026-04-30T19:50:00.000Z' },
      { status: 'validated', created_at: '2026-04-30T19:40:00.000Z', updated_at: '2026-04-30T19:45:00.000Z' },
      { status: 'materialized', created_at: '2026-04-30T18:30:00.000Z', updated_at: '2026-04-30T18:45:00.000Z' },
    ],
    picks: [
      { status: 'validated', promotion_status: 'pending', promotion_score: null, created_at: '2026-04-30T19:35:00.000Z', updated_at: '2026-04-30T19:35:00.000Z' },
      { status: 'queued', promotion_status: 'qualified', promotion_score: 78, created_at: '2026-04-30T19:20:00.000Z', updated_at: '2026-04-30T19:42:00.000Z' },
      { status: 'posted', promotion_status: 'qualified', promotion_score: 81, created_at: '2026-04-30T19:00:00.000Z', updated_at: '2026-04-30T19:30:00.000Z' },
    ],
    outbox: [
      { status: 'pending', created_at: '2026-04-30T19:44:00.000Z', updated_at: '2026-04-30T19:44:00.000Z', claimed_at: null },
      { status: 'failed', created_at: '2026-04-30T19:10:00.000Z', updated_at: '2026-04-30T19:15:00.000Z', claimed_at: null },
    ],
    receipts: [{ recorded_at: '2026-04-30T19:55:00.000Z' }],
    runs: [{ run_type: 'grading.run', status: 'succeeded', started_at: '2026-04-30T19:50:00.000Z', finished_at: '2026-04-30T19:51:00.000Z' }],
    liveConfig: null,
  });

  assert.equal(snapshot.stages.length, 5);
  assert.equal(snapshot.stages[4]?.key, 'publish');
  assert.equal(snapshot.stages[4]?.status, 'error');
  assert.equal(snapshot.errorCount, 1);
  assert.equal(snapshot.itemsInFlight, 8);
  assert.equal(snapshot.overallStatus, 'error');
});

test('derivePipelineHealthSnapshot reports idle when no rows are active', () => {
  const snapshot = derivePipelineHealthSnapshot({
    observedAt: '2026-04-30T20:00:00.000Z',
    submissions: [],
    picks: [],
    outbox: [],
    receipts: [],
    runs: [],
    liveConfig: null,
  });

  assert.equal(snapshot.overallStatus, 'idle');
  assert.equal(snapshot.itemsInFlight, 0);
  assert.equal(snapshot.errorCount, 0);
  assert.equal(snapshot.stages.every((stage) => stage.status === 'idle'), true);
});
