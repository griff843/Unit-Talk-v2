/**
 * UTV2-1093: INIT-1.2.2 — Replay Validator Un-Stubbing
 *
 * Tests that ReplayLifecycleRunner enforces constitutional invariants via
 * an injected InvariantEvaluator and halts replay on any violation.
 *
 * Adversarial scenario: inject a historically invariant-violating record;
 * replay must catch it and throw before the write completes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayLifecycleRunner, type InvariantEvaluator } from './replay-lifecycle-runner.js';
import { IsolatedPickStore } from './isolated-pick-store.js';

// ─────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────

function makeStore(): IsolatedPickStore {
  return new IsolatedPickStore();
}

function minimalPick(id: string) {
  return {
    id,
    status: 'draft' as const,
    posted_to_discord: false,
    settlement_status: null,
  };
}

const cleanEngine: InvariantEvaluator = {
  evaluateForReplay: () => [],
};

const violatingEngine: InvariantEvaluator = {
  evaluateForReplay: (_ctx, replayRunId) => [
    {
      invariant_id: 'INV-TEST-001',
      title: 'Test invariant violation',
      severity: 'critical',
      detected_at: new Date().toISOString(),
      context: { replay_run_id: replayRunId },
    },
  ],
};

function capturingEngine(): { engine: InvariantEvaluator; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const engine: InvariantEvaluator = {
    evaluateForReplay: (ctx) => {
      calls.push({ ...ctx });
      return [];
    },
  };
  return { engine, calls };
}

// ─────────────────────────────────────────────────────────────
// no engine injected (legacy/permissive mode)
// ─────────────────────────────────────────────────────────────

test('runner without engine: insert and update succeed', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store);

  const ins = runner.insert(minimalPick('pick-1'), { writerRole: 'submitter' });
  assert.ok(ins.success, `insert failed: ${ins.error}`);

  const upd = runner.update('pick-1', { status: 'validated' }, { writerRole: 'submitter' });
  assert.ok(upd.success, `update failed: ${upd.error}`);
});

// ─────────────────────────────────────────────────────────────
// clean engine — no violations
// ─────────────────────────────────────────────────────────────

test('runner with clean engine: transitions succeed', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store, { invariantEngine: cleanEngine, replayRunId: 'run-clean-001' });

  runner.insert(minimalPick('pick-2'), { writerRole: 'submitter' });
  const upd = runner.update('pick-2', { status: 'validated' }, { writerRole: 'submitter' });
  assert.ok(upd.success, `update failed: ${upd.error}`);
  assert.ok(upd.validationPassed);
});

test('engine receives context with pick fields and replay_run_id', () => {
  const store = makeStore();
  const { engine, calls } = capturingEngine();
  const runner = new ReplayLifecycleRunner(store, { invariantEngine: engine, replayRunId: 'run-ctx-001' });

  runner.insert(minimalPick('pick-3'), { writerRole: 'submitter' });
  runner.update('pick-3', { status: 'validated' }, { writerRole: 'submitter' });

  assert.ok(calls.length >= 1, 'engine should have been called at least once');
  const ctx = calls[0]!;
  assert.equal(ctx['replay_run_id'], 'run-ctx-001');
  assert.ok('pick_id' in ctx || 'pick_status' in ctx, 'context should contain pick fields');
});

// ─────────────────────────────────────────────────────────────
// ADVERSARIAL: engine reports violation → replay halts
// ─────────────────────────────────────────────────────────────

test('ADVERSARIAL: violating engine halts replay — result is failure with validationPassed=false', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store, { invariantEngine: violatingEngine, replayRunId: 'run-adversarial-001' });

  runner.insert(minimalPick('pick-adversarial'), { writerRole: 'submitter' });
  const result = runner.update('pick-adversarial', { status: 'validated' }, { writerRole: 'submitter' });

  assert.ok(!result.success, 'replay should have halted on invariant violation');
  assert.ok(!result.validationPassed, 'validationPassed must be false when invariant fires');
  assert.ok(result.error?.includes('INV-TEST-001'), `error should include invariant id, got: ${result.error}`);
  assert.ok(result.error?.includes('Test invariant violation'), `error should include title, got: ${result.error}`);
});

test('ADVERSARIAL: violated pick is NOT written to store when invariant fires', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store, { invariantEngine: violatingEngine, replayRunId: 'run-adversarial-003' });

  runner.insert(minimalPick('pick-no-write'), { writerRole: 'submitter' });
  runner.update('pick-no-write', { status: 'validated' }, { writerRole: 'submitter' });

  // The pick status should remain 'pending' — the invariant check fires before the store write
  const pick = store.getAsPick('pick-no-write');
  assert.ok(pick !== null, 'pick should still exist in store');
  assert.equal(pick?.status, 'pending', `pick status should be unchanged 'pending', got: ${pick?.status}`);
});

// ─────────────────────────────────────────────────────────────
// writer authority hardening
// ─────────────────────────────────────────────────────────────

test('empty writer role throws', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store);

  const result = runner.insert({ id: 'pick-auth-test', status: 'draft' as const }, { writerRole: '' as never });
  assert.ok(!result.success, 'empty writer role should fail');
  assert.ok(result.error?.includes('invalid writer role'), `expected invalid writer role error, got: ${result.error}`);
});

// ─────────────────────────────────────────────────────────────
// validateWrite hardening
// ─────────────────────────────────────────────────────────────

test('empty field list throws', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store);

  runner.insert(minimalPick('pick-fields-test'), { writerRole: 'submitter' });
  const result = runner.update('pick-fields-test', {}, { writerRole: 'submitter' });
  assert.ok(!result.success, 'empty field list should fail');
  assert.ok(result.error?.includes('field list must be non-empty'), `got: ${result.error}`);
});

// ─────────────────────────────────────────────────────────────
// skipTransitionValidation bypasses invariant check
// ─────────────────────────────────────────────────────────────

test('skipTransitionValidation bypasses invariant engine', () => {
  const store = makeStore();
  const runner = new ReplayLifecycleRunner(store, { invariantEngine: violatingEngine, replayRunId: 'run-skip-001' });

  runner.insert(minimalPick('pick-skip'), { writerRole: 'submitter' });
  const result = runner.update('pick-skip', { status: 'validated' }, { writerRole: 'submitter', skipTransitionValidation: true });

  assert.ok(result.success, `skipTransitionValidation should bypass invariant check, got: ${result.error}`);
});
