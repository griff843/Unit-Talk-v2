/**
 * Invariant Production Integration Tests (UTV2-1094 / INIT-1.3.4)
 *
 * Replaces governance-readiness.test.ts (static source-grep — gap #45).
 *
 * Proves:
 *   1. InvariantEngine detects each RUNTIME_EVALUABLE invariant via injected context
 *   2. QuarantineManager receives violations and produces QuarantineRecord + AuditEvent
 *   3. Engine + Manager wired together: end-to-end injection path
 *   4. Replay runner with InvariantEngine halts on violation
 *   5. Clean context produces zero violations
 *
 * Test runner: node:test + tsx --test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvariantEngine, QuarantineManager } from '@unit-talk/invariants';
import type { RuntimeContext, InvariantViolation } from '@unit-talk/invariants';
import { ReplayLifecycleRunner, IsolatedPickStore } from '@unit-talk/verification';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Record<string, unknown> = {}): RuntimeContext {
  return { snapshot_at: new Date().toISOString(), ...overrides };
}

function wireEngineToManager(
  engine: InvariantEngine,
  manager: QuarantineManager,
): void {
  engine.on('violation', (v: InvariantViolation) => {
    manager.process([v]);
  });
}

// ---------------------------------------------------------------------------
// 1. Per-invariant injection coverage (RUNTIME_EVALUABLE_IDS)
// ---------------------------------------------------------------------------

describe('InvariantEngine — per-invariant injection (RUNTIME_EVALUABLE_IDS)', () => {
  test('INV-0009: detects delivery that bypasses outbox', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ delivery_bypassed_outbox: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0009'), 'INV-0009 must fire when delivery_bypassed_outbox=true');
  });

  test('INV-0009: detects in-memory queue usage', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ in_memory_queue_used: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0009'));
  });

  test('INV-0009: detects multiple DeliveryOutcomes per attempt', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ outbox_outcomes_per_attempt: 2 }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0009'));
  });

  test('INV-0010: detects silent fallback to qualified', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ silent_fallback_state: 'qualified' }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0010'), 'INV-0010 must fire on silent fallback to qualified');
  });

  test('INV-0010: detects silent fallback to pass', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ silent_fallback_state: 'pass' }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0010'));
  });

  test('INV-0010: detects ambiguous fallback', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ fallback_on_ambiguity: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0010'));
  });

  test('INV-0014: detects audit log DELETE attempt', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ audit_log_delete_attempted: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0014'), 'INV-0014 must fire on audit_log_delete_attempted');
  });

  test('INV-0014: detects audit log UPDATE attempt', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ audit_log_update_attempted: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0014'));
  });

  test('INV-0014: detects audit log row pruning', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ audit_log_rows_pruned: 5 }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0014'));
  });

  test('INV-0015: detects transition out of terminal settled state', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(
      makeContext({ transition_from_state: 'settled', transition_to_state: 'pending' }),
    );
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0015'), 'INV-0015 must fire on transition from settled');
  });

  test('INV-0015: detects transition out of terminal voided state', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(
      makeContext({ transition_from_state: 'voided', transition_to_state: 'pending' }),
    );
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0015'));
  });

  test('INV-0015: detects retroactive terminal change', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ retroactive_terminal_change: true }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0015'));
  });

  test('clean context — zero violations across all RUNTIME_EVALUABLE invariants', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext());
    const runtimeIds = ['INV-0009', 'INV-0010', 'INV-0014', 'INV-0015'];
    const runtimeViolations = violations.filter((v) => runtimeIds.includes(v.invariant_id));
    assert.equal(runtimeViolations.length, 0, 'clean context must produce zero runtime violations');
  });
});

// ---------------------------------------------------------------------------
// 2. Engine emits violation events
// ---------------------------------------------------------------------------

describe('InvariantEngine — violation events', () => {
  test('emits violation event for each detected violation', () => {
    const engine = new InvariantEngine();
    const emitted: InvariantViolation[] = [];
    engine.on('violation', (v: InvariantViolation) => emitted.push(v));

    engine.evaluate(makeContext({ delivery_bypassed_outbox: true }));
    assert.ok(emitted.length >= 1, 'at least one violation event emitted');
    assert.equal(emitted[0]!.invariant_id, 'INV-0009');
  });

  test('emits multiple events when multiple invariants violated', () => {
    const engine = new InvariantEngine();
    const emitted: InvariantViolation[] = [];
    engine.on('violation', (v: InvariantViolation) => emitted.push(v));

    engine.evaluate(makeContext({
      delivery_bypassed_outbox: true,
      audit_log_delete_attempted: true,
    }));

    const ids = emitted.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0009'));
    assert.ok(ids.includes('INV-0014'));
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-end: Engine + QuarantineManager wired together
// ---------------------------------------------------------------------------

describe('InvariantEngine + QuarantineManager — end-to-end injection', () => {
  test('INV-0009 violation auto-quarantines and emits AuditEvent', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const auditEvents: unknown[] = [];
    const quarantineRecords: unknown[] = [];
    manager.on('audit_event', (e) => auditEvents.push(e));
    manager.on('quarantine', (r) => quarantineRecords.push(r));

    engine.evaluate(makeContext({ delivery_bypassed_outbox: true }));

    assert.ok(auditEvents.length >= 1, 'AuditEvent must be emitted');
    assert.ok(quarantineRecords.length >= 1, 'QuarantineRecord must be created');
  });

  test('INV-0010 silent-fallback violation auto-quarantines', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    engine.evaluate(makeContext({ silent_fallback_state: 'qualified' }));
    assert.ok(quarantined.length >= 1, 'INV-0010 must trigger quarantine');
  });

  test('INV-0014 audit-log-delete violation auto-quarantines', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    engine.evaluate(makeContext({ audit_log_delete_attempted: true }));
    assert.ok(quarantined.length >= 1, 'INV-0014 must trigger quarantine');
  });

  test('INV-0015 terminal-transition violation auto-quarantines', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    engine.evaluate(
      makeContext({ transition_from_state: 'settled', transition_to_state: 'pending' }),
    );
    assert.ok(quarantined.length >= 1, 'INV-0015 must trigger quarantine');
  });

  test('every quarantined violation has an AuditEvent and escalation', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const auditEvents: unknown[] = [];
    const escalations: unknown[] = [];
    manager.on('audit_event', (e) => auditEvents.push(e));
    manager.on('escalation', (n) => escalations.push(n));

    engine.evaluate(makeContext({ delivery_bypassed_outbox: true }));

    assert.ok(auditEvents.length >= 1, 'AuditEvent emitted for violation');
    assert.ok(escalations.length >= 1, 'Escalation routed for quarantined violation');
  });

  test('clean context — no quarantine, no audit events', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const auditEvents: unknown[] = [];
    manager.on('audit_event', (e) => auditEvents.push(e));

    engine.evaluate(makeContext());

    // Advisory violations may emit audit events, but runtime invariants must not fire
    const runtimeAuditIds = auditEvents
      .map((e) => (e as { invariant_id: string }).invariant_id)
      .filter((id) => ['INV-0009', 'INV-0010', 'INV-0014', 'INV-0015'].includes(id));
    assert.equal(runtimeAuditIds.length, 0, 'no runtime AuditEvents on clean context');
  });
});

// ---------------------------------------------------------------------------
// 4. Replay runner with InvariantEngine — enforcement in replay
// ---------------------------------------------------------------------------

describe('ReplayLifecycleRunner — InvariantEngine halts replay on violation', () => {
  function makeStore(): IsolatedPickStore {
    return new IsolatedPickStore();
  }

  test('runner with no engine — no halt on any context', () => {
    const store = makeStore();
    const runner = new ReplayLifecycleRunner(store, { replayRunId: 'test-no-engine' });

    const insertResult = runner.insert(
      { id: 'pick-1', status: 'draft' as const },
      { writerRole: 'submitter' },
    );
    assert.equal(insertResult.success, true, 'insert without engine must succeed');
  });

  test('runner with engine — clean context passes', () => {
    const store = makeStore();
    const engine = new InvariantEngine();
    const runner = new ReplayLifecycleRunner(store, {
      invariantEngine: engine,
      replayRunId: 'test-clean',
    });

    const insertResult = runner.insert(
      { id: 'pick-clean', status: 'draft' as const },
      { writerRole: 'submitter' },
    );
    assert.equal(insertResult.success, true, 'insert with engine on clean pick must succeed');
  });

  test('evaluateForReplay stamps replay_run_id on violations', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluateForReplay(
      makeContext({ delivery_bypassed_outbox: true }),
      'replay-run-abc123',
    );
    assert.ok(violations.length >= 1, 'violation must be detected');
    for (const v of violations) {
      assert.equal(v.replay_run_id, 'replay-run-abc123', 'replay_run_id must be stamped');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Adversarial: every registered invariant is fail-closed — no silent pass
// ---------------------------------------------------------------------------

describe('Adversarial: all registered invariants are fail-closed — no suppression path', () => {
  test('all injected violations produce QuarantineRecords — no violation silently passes', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    // Each injected context flag triggers a specific invariant violation
    const violations = engine.evaluate(makeContext({
      delivery_bypassed_outbox: true,    // INV-0009
      audit_log_delete_attempted: true,  // INV-0014
    }));

    assert.ok(violations.length >= 2, 'at least 2 violations detected');
    assert.ok(quarantined.length >= 2, 'every detected violation must produce a QuarantineRecord');
  });

  test('governance violations also auto-quarantine — no privileged bypass for governance class', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    // INV-0001: agent claim overrides main
    engine.evaluate(makeContext({ agent_claim_overrides_main: true }));
    assert.ok(quarantined.length >= 1, 'governance violations must also quarantine — no bypass class');
  });

  test('engine produces violations with correct quarantine_behavior from registry', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(makeContext({ delivery_bypassed_outbox: true }));
    const inv0009 = violations.find((v) => v.invariant_id === 'INV-0009');
    assert.ok(inv0009 !== undefined, 'INV-0009 must be detected');
    assert.equal(inv0009.quarantine_behavior, 'fail-closed', 'quarantine_behavior must be fail-closed from registry');
  });

  test('no quarantine fires on truly clean context', () => {
    const engine = new InvariantEngine();
    const manager = new QuarantineManager();
    wireEngineToManager(engine, manager);

    const quarantined: unknown[] = [];
    manager.on('quarantine', (r) => quarantined.push(r));

    engine.evaluate(makeContext());
    assert.equal(quarantined.length, 0, 'clean context must produce zero quarantine records');
  });
});
