import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProviderCycleHealth } from './provider-cycle-health.js';

test('summarizeProviderCycleHealth keeps only the latest row per provider/league lane', () => {
  const summary = summarizeProviderCycleHealth([
    {
      run_id: 'run-older',
      provider_key: 'sgo',
      league: 'NBA',
      cycle_snapshot_at: '2026-04-29T10:00:00.000Z',
      stage_status: 'merge_blocked',
      freshness_status: 'stale',
      proof_status: 'required',
      staged_count: 12,
      merged_count: 0,
      duplicate_count: 0,
      failure_category: 'stale_after_cycle',
      failure_scope: 'cycle',
      last_error: 'blocked',
      updated_at: '2026-04-29T10:01:00.000Z',
    },
    {
      run_id: 'run-newer',
      provider_key: 'sgo',
      league: 'NBA',
      cycle_snapshot_at: '2026-04-29T10:05:00.000Z',
      stage_status: 'merged',
      freshness_status: 'fresh',
      proof_status: 'verified',
      staged_count: 14,
      merged_count: 14,
      duplicate_count: 1,
      failure_category: null,
      failure_scope: null,
      last_error: null,
      updated_at: '2026-04-29T10:06:00.000Z',
    },
  ]);

  assert.equal(summary.trackedLanes, 1);
  assert.equal(summary.mergedLanes, 1);
  assert.equal(summary.rows[0]?.runId, 'run-newer');
  assert.equal(summary.rows[0]?.productionStatus, 'healthy');
});

test('summarizeProviderCycleHealth flags stale and proof-blocked lanes separately', () => {
  const summary = summarizeProviderCycleHealth(
    [
      {
        run_id: 'run-stale',
        provider_key: 'sgo',
        league: 'MLB',
        cycle_snapshot_at: '2026-04-29T11:00:00.000Z',
        stage_status: 'merge_blocked',
        freshness_status: 'stale',
        proof_status: 'verified',
        staged_count: 4,
        merged_count: 0,
        duplicate_count: 0,
        failure_category: 'stale_after_cycle',
        failure_scope: 'cycle',
        last_error: 'stale gate',
        updated_at: '2026-04-29T11:01:00.000Z',
      },
      {
        run_id: 'run-proof',
        provider_key: 'odds-api:consensus',
        league: 'NBA',
        cycle_snapshot_at: '2026-04-29T11:10:00.000Z',
        stage_status: 'merge_blocked',
        freshness_status: 'fresh',
        proof_status: 'required',
        staged_count: 6,
        merged_count: 0,
        duplicate_count: 2,
        failure_category: null,
        failure_scope: null,
        last_error: 'proof missing',
        updated_at: '2026-04-29T11:11:00.000Z',
      },
    ],
    { latestProviderOfferSnapshotAt: '2026-04-29T11:12:00.000Z' },
  );

  assert.equal(summary.overallStatus, 'critical');
  assert.equal(summary.blockedLanes, 2);
  assert.equal(summary.staleLanes, 1);
  assert.equal(summary.proofRequiredLanes, 1);
  assert.equal(summary.liveOfferSnapshotAt, '2026-04-29T11:12:00.000Z');
  assert.equal(summary.rows.find((row) => row.runId === 'run-proof')?.productionStatus, 'warning');
  assert.equal(summary.rows.find((row) => row.runId === 'run-stale')?.productionStatus, 'critical');
});
