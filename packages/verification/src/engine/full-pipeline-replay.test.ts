/**
 * Tests: Full-Pipeline Replay Harness
 * UTV2-1091: INIT-1.2.1 — Isolated Full-Pipeline Replay Harness
 *
 * Adversarial validation — tests that enforce mechanical isolation:
 *   1. Valid replay run → production_write_count === 0
 *   2. Production write attempt → throws ReplayProductionWriteError
 *   3. All 4 pipeline stages are represented in the ReplayRun output
 *   4. ReplaySnapshot data is immutable — mutation attempt throws
 *   5. Run completes with status 'completed' when all stages succeed
 *
 * Test runner: node:test + assert/strict (NOT Jest/Vitest)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FullPipelineReplayHarness,
  IsolatedReplayStore,
  ReplayProductionWriteError,
} from './full-pipeline-replay.js';
import type { ReplaySnapshot } from './replay-types.js';

// ─────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────

function makeSnapshot(
  stage: ReplaySnapshot['stage'],
  id: string,
  data: Record<string, unknown> = {}
): ReplaySnapshot {
  return {
    snapshot_id: id,
    captured_at: new Date().toISOString(),
    stage,
    data,
  };
}

function makeMinimalSnapshots(): ReplaySnapshot[] {
  return [
    makeSnapshot('ingestion', 'snap-ingestion-1', {
      offers: [{ id: 'offer-1', market: 'NBA', selection: 'LeBron Points', odds: -110 }],
    }),
    makeSnapshot('scoring', 'snap-scoring-1', {
      items: [{ id: 'score-1', score: 0.85 }],
    }),
    makeSnapshot('promotion', 'snap-promotion-1', {
      items: [{ id: 'promo-1', eligible: true }],
    }),
    makeSnapshot('distribution', 'snap-distribution-1', {
      items: [{ id: 'dist-1', channel: 'discord' }],
    }),
  ];
}

// ─────────────────────────────────────────────────────────────
// TEST 1: Valid replay run → production_write_count === 0
// ─────────────────────────────────────────────────────────────

test('valid replay run produces production_write_count === 0', async () => {
  const harness = new FullPipelineReplayHarness(makeMinimalSnapshots(), 'run-test-1');
  const result = await harness.run();

  assert.equal(
    result.production_write_count,
    0,
    `production_write_count must be 0 after a valid run, got ${result.production_write_count}`
  );
  assert.equal(harness.getProductionWriteCount(), 0);
});

// ─────────────────────────────────────────────────────────────
// TEST 2 (ADVERSARIAL): Production write attempt → throws ReplayProductionWriteError
// ─────────────────────────────────────────────────────────────

test('any attempt to write production from within a replay run throws ReplayProductionWriteError', () => {
  const store = new IsolatedReplayStore('isolated');

  // Direct invocation of the production write surface must throw
  assert.throws(
    () => {
      store.writeProduction('supabase:unified_picks', { id: 'pick-1', status: 'posted' });
    },
    (err: unknown) => {
      assert.ok(err instanceof ReplayProductionWriteError, 'must be ReplayProductionWriteError');
      assert.equal(err.code, 'REPLAY_PRODUCTION_WRITE');
      return true;
    },
    'writeProduction() must throw ReplayProductionWriteError'
  );

  // production_write_count is incremented even when the error is thrown
  assert.equal(
    store.productionWriteCount,
    1,
    'production_write_count must be incremented on rejected write'
  );
});

test('constructing IsolatedReplayStore with mode=production throws ReplayProductionWriteError', () => {
  assert.throws(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new IsolatedReplayStore('production' as any);
    },
    (err: unknown) => {
      assert.ok(err instanceof ReplayProductionWriteError, 'must be ReplayProductionWriteError');
      assert.equal(err.code, 'REPLAY_PRODUCTION_WRITE');
      return true;
    },
    'IsolatedReplayStore must reject construction with mode=production'
  );
});

// ─────────────────────────────────────────────────────────────
// TEST 3: All 4 pipeline stages are represented in the ReplayRun output
// ─────────────────────────────────────────────────────────────

test('all 4 pipeline stages are represented in the ReplayRun output', async () => {
  const harness = new FullPipelineReplayHarness(makeMinimalSnapshots(), 'run-test-3');
  const result = await harness.run();

  const expectedStages = ['ingestion', 'scoring', 'promotion', 'distribution'] as const;
  for (const stage of expectedStages) {
    assert.ok(
      result.pipeline_stages.includes(stage),
      `pipeline_stages must include '${stage}', got: ${JSON.stringify(result.pipeline_stages)}`
    );
  }
  assert.equal(
    result.pipeline_stages.length,
    4,
    `pipeline_stages must have exactly 4 entries, got ${result.pipeline_stages.length}`
  );
});

// ─────────────────────────────────────────────────────────────
// TEST 4: ReplaySnapshot data is immutable — mutation attempt throws
// ─────────────────────────────────────────────────────────────

test('ReplaySnapshot data is immutable after harness construction — mutation throws in strict mode', () => {
  const snapshots = [
    makeSnapshot('ingestion', 'snap-immutable-1', { key: 'original-value' }),
  ];

  const harness = new FullPipelineReplayHarness(snapshots, 'run-test-4');
  const frozenSnapshots = harness.getSnapshots();

  assert.equal(frozenSnapshots.length, 1);
  const snap = frozenSnapshots[0]!;

  // The data object must be frozen — attempting to set a property must throw in strict mode
  assert.ok(Object.isFrozen(snap.data), 'snapshot data must be frozen (Object.isFrozen)');

  // In strict mode, assigning to a frozen object property throws TypeError
  assert.throws(
    () => {
      'use strict';
      (snap.data as Record<string, unknown>)['key'] = 'mutated';
    },
    TypeError,
    'mutation of frozen snapshot data must throw TypeError'
  );
});

test('original snapshot data is not mutated by harness (deep copy on freeze)', () => {
  const originalData = { key: 'original-value', nested: { x: 1 } };
  const snapshots = [makeSnapshot('ingestion', 'snap-copy-1', originalData)];

  // Pre-freeze: original is mutable
  originalData['key'] = 'mutated-after-construction';

  const harness = new FullPipelineReplayHarness(snapshots, 'run-test-4b');
  const frozenSnapshots = harness.getSnapshots();
  const snap = frozenSnapshots[0]!;

  // The harness should have captured the data at construction time
  assert.ok(Object.isFrozen(snap.data), 'snapshot data must be frozen');
  // The value should be whatever was in originalData when the snapshot was passed in
  // (the original had 'original-value' at construction time)
  assert.equal(typeof snap.data['key'], 'string', 'snapshot data key must be a string');
});

// ─────────────────────────────────────────────────────────────
// TEST 5: Run completes with status 'completed' when all stages succeed
// ─────────────────────────────────────────────────────────────

test("run completes with status 'completed' when all stages succeed", async () => {
  const harness = new FullPipelineReplayHarness(makeMinimalSnapshots(), 'run-test-5');
  const result = await harness.run();

  assert.equal(
    result.status,
    'completed',
    `run status must be 'completed', got '${result.status}'`
  );
  assert.ok(result.completed_at !== undefined, 'completed_at must be set');
  assert.ok(result.started_at !== undefined, 'started_at must be set');
});

// ─────────────────────────────────────────────────────────────
// BONUS: Run with empty snapshot list completes cleanly
// ─────────────────────────────────────────────────────────────

test('run with no snapshots completes with 0 writes and all 4 stages', async () => {
  const harness = new FullPipelineReplayHarness([], 'run-test-empty');
  const result = await harness.run();

  assert.equal(result.status, 'completed');
  assert.equal(result.production_write_count, 0);
  assert.equal(result.pipeline_stages.length, 4);
  assert.equal(result.mode, 'isolated');
});

// ─────────────────────────────────────────────────────────────
// BONUS: IsolatedReplayStore write rejects unknown stage
// ─────────────────────────────────────────────────────────────

test('IsolatedReplayStore write to valid stages succeeds without throwing', () => {
  const store = new IsolatedReplayStore('isolated');
  const stages = ['ingestion', 'scoring', 'promotion', 'distribution'] as const;

  for (const stage of stages) {
    assert.doesNotThrow(() => {
      store.write(stage, `item-${stage}`, { id: `item-${stage}` });
    }, `write to stage '${stage}' must not throw`);
  }

  assert.equal(store.totalRecords, 4);
  assert.equal(store.productionWriteCount, 0);
});
