/**
 * InvariantEngine tests (UTV2-1089 / INIT-1.3.2)
 *
 * Per-invariant injection tests: for each of the 15 constitutional invariants,
 * we verify that:
 *   1. A violating context produces a detection (with correct invariant_id)
 *   2. A clean context produces no violation for that invariant
 *
 * Adversarial validation: each violation class is injected independently.
 *
 * Test runner: node:test + tsx --test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { InvariantEngine, type RuntimeContext } from './engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanContext(overrides: Record<string, unknown> = {}): RuntimeContext {
  return {
    snapshot_at: new Date().toISOString(),
    ...overrides,
  };
}

function engineWithViolations(ctx: RuntimeContext): string[] {
  const engine = new InvariantEngine();
  return engine.evaluate(ctx).map((v) => v.invariant_id);
}

function assertDetected(violations: string[], id: string) {
  assert.ok(
    violations.includes(id),
    `Expected ${id} to be detected but violations were: [${violations.join(', ')}]`,
  );
}

function assertNotDetected(violations: string[], id: string) {
  assert.ok(
    !violations.includes(id),
    `Expected ${id} NOT to be detected but it appeared in violations`,
  );
}

// ---------------------------------------------------------------------------
// INV-0001: main is shipped truth
// ---------------------------------------------------------------------------

describe('INV-0001 — main is shipped truth', () => {
  test('detects violation when agent_claim_overrides_main is true', () => {
    const violations = engineWithViolations(cleanContext({ agent_claim_overrides_main: true }));
    assertDetected(violations, 'INV-0001');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0001');
  });
});

// ---------------------------------------------------------------------------
// INV-0002: No lane without preflight; no Done without truth-check
// ---------------------------------------------------------------------------

describe('INV-0002 — No lane without preflight; no Done without truth-check', () => {
  test('detects lane started without preflight', () => {
    const violations = engineWithViolations(cleanContext({ lane_started_without_preflight: true }));
    assertDetected(violations, 'INV-0002');
  });

  test('detects Done without truth-check', () => {
    const violations = engineWithViolations(cleanContext({ done_without_truth_check: true }));
    assertDetected(violations, 'INV-0002');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0002');
  });
});

// ---------------------------------------------------------------------------
// INV-0003: One issue → one lane → one branch → one PR
// ---------------------------------------------------------------------------

describe('INV-0003 — One issue → one lane → one branch → one PR', () => {
  test('detects multiple issues per lane', () => {
    const violations = engineWithViolations(cleanContext({ issues_per_lane: 2 }));
    assertDetected(violations, 'INV-0003');
  });

  test('detects multiple PRs per lane', () => {
    const violations = engineWithViolations(cleanContext({ prs_per_lane: 3 }));
    assertDetected(violations, 'INV-0003');
  });

  test('no violation with exactly 1 issue and 1 PR', () => {
    const violations = engineWithViolations(cleanContext({ issues_per_lane: 1, prs_per_lane: 1 }));
    assertNotDetected(violations, 'INV-0003');
  });

  test('no violation on clean context (no count fields)', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0003');
  });
});

// ---------------------------------------------------------------------------
// INV-0004: Proof must tie to merge SHA
// ---------------------------------------------------------------------------

describe('INV-0004 — Proof must tie to merge SHA', () => {
  test('detects proof SHA mismatch from merge SHA', () => {
    const violations = engineWithViolations(cleanContext({
      proof_sha: 'aaaaaa',
      merge_sha: 'bbbbbb',
    }));
    assertDetected(violations, 'INV-0004');
  });

  test('detects proof bound to branch HEAD', () => {
    const violations = engineWithViolations(cleanContext({ proof_bound_to_branch_head: true }));
    assertDetected(violations, 'INV-0004');
  });

  test('no violation when proof_sha matches merge_sha', () => {
    const violations = engineWithViolations(cleanContext({
      proof_sha: 'abc123',
      merge_sha: 'abc123',
    }));
    assertNotDetected(violations, 'INV-0004');
  });

  test('no violation on clean context (no SHA fields)', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0004');
  });
});

// ---------------------------------------------------------------------------
// INV-0005: Tier label required before Ready
// ---------------------------------------------------------------------------

describe('INV-0005 — Tier label required before Ready', () => {
  test('detects issue in ready state without tier label', () => {
    const violations = engineWithViolations(cleanContext({
      issue_in_ready_state: true,
      tier_label_set: false,
    }));
    assertDetected(violations, 'INV-0005');
  });

  test('detects dispatch without tier label', () => {
    const violations = engineWithViolations(cleanContext({ dispatched_without_tier: true }));
    assertDetected(violations, 'INV-0005');
  });

  test('no violation when issue is ready and tier is set', () => {
    const violations = engineWithViolations(cleanContext({
      issue_in_ready_state: true,
      tier_label_set: true,
    }));
    assertNotDetected(violations, 'INV-0005');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0005');
  });
});

// ---------------------------------------------------------------------------
// INV-0006: Lane manifest is sole authority for active lane state
// ---------------------------------------------------------------------------

describe('INV-0006 — Lane manifest is sole authority', () => {
  test('detects lane state sourced from memory', () => {
    const violations = engineWithViolations(cleanContext({ lane_state_from_memory: true }));
    assertDetected(violations, 'INV-0006');
  });

  test('detects lane state sourced from chat', () => {
    const violations = engineWithViolations(cleanContext({ lane_state_from_chat: true }));
    assertDetected(violations, 'INV-0006');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0006');
  });
});

// ---------------------------------------------------------------------------
// INV-0007: Domain package is pure — no I/O
// ---------------------------------------------------------------------------

describe('INV-0007 — Domain package is pure', () => {
  test('detects domain importing forbidden I/O module (fs)', () => {
    const violations = engineWithViolations(cleanContext({
      domain_package_imports: ['node:fs', '@unit-talk/contracts'],
    }));
    assertDetected(violations, 'INV-0007');
  });

  test('detects domain importing http module', () => {
    const violations = engineWithViolations(cleanContext({
      domain_package_imports: ['https', 'something-else'],
    }));
    assertDetected(violations, 'INV-0007');
  });

  test('detects domain_performs_io flag', () => {
    const violations = engineWithViolations(cleanContext({ domain_performs_io: true }));
    assertDetected(violations, 'INV-0007');
  });

  test('no violation with clean imports', () => {
    const violations = engineWithViolations(cleanContext({
      domain_package_imports: ['@unit-talk/contracts', 'node:crypto'],
    }));
    assertNotDetected(violations, 'INV-0007');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0007');
  });
});

// ---------------------------------------------------------------------------
// INV-0008: Dependency boundary — packages do not import from apps
// ---------------------------------------------------------------------------

describe('INV-0008 — Dependency boundary', () => {
  test('detects package importing from app', () => {
    const violations = engineWithViolations(cleanContext({ package_imports_app: true }));
    assertDetected(violations, 'INV-0008');
  });

  test('detects app importing from another app', () => {
    const violations = engineWithViolations(cleanContext({ app_imports_other_app: true }));
    assertDetected(violations, 'INV-0008');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0008');
  });
});

// ---------------------------------------------------------------------------
// INV-0009: Postgres outbox is the only delivery queue (runtime-evaluable)
// ---------------------------------------------------------------------------

describe('INV-0009 — Postgres outbox is the only delivery queue', () => {
  test('detects delivery bypass of outbox', () => {
    const violations = engineWithViolations(cleanContext({ delivery_bypassed_outbox: true }));
    assertDetected(violations, 'INV-0009');
  });

  test('detects in-memory queue usage', () => {
    const violations = engineWithViolations(cleanContext({ in_memory_queue_used: true }));
    assertDetected(violations, 'INV-0009');
  });

  test('detects zero DeliveryOutcomes per attempt', () => {
    const violations = engineWithViolations(cleanContext({ outbox_outcomes_per_attempt: 0 }));
    assertDetected(violations, 'INV-0009');
  });

  test('detects multiple DeliveryOutcomes per attempt', () => {
    const violations = engineWithViolations(cleanContext({ outbox_outcomes_per_attempt: 2 }));
    assertDetected(violations, 'INV-0009');
  });

  test('no violation with exactly 1 outcome per attempt', () => {
    const violations = engineWithViolations(cleanContext({ outbox_outcomes_per_attempt: 1 }));
    assertNotDetected(violations, 'INV-0009');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0009');
  });
});

// ---------------------------------------------------------------------------
// INV-0010: Fail closed — no silent fallback (runtime-evaluable)
// ---------------------------------------------------------------------------

describe('INV-0010 — Fail closed — no silent fallback', () => {
  test('detects silent fallback to "qualified"', () => {
    const violations = engineWithViolations(cleanContext({ silent_fallback_state: 'qualified' }));
    assertDetected(violations, 'INV-0010');
  });

  test('detects silent fallback to "pass"', () => {
    const violations = engineWithViolations(cleanContext({ silent_fallback_state: 'pass' }));
    assertDetected(violations, 'INV-0010');
  });

  test('detects silent fallback to "done"', () => {
    const violations = engineWithViolations(cleanContext({ silent_fallback_state: 'done' }));
    assertDetected(violations, 'INV-0010');
  });

  test('detects fallback_on_ambiguity flag', () => {
    const violations = engineWithViolations(cleanContext({ fallback_on_ambiguity: true }));
    assertDetected(violations, 'INV-0010');
  });

  test('no violation when fallback state is an allowed rejection state', () => {
    const violations = engineWithViolations(cleanContext({ silent_fallback_state: 'rejected' }));
    assertNotDetected(violations, 'INV-0010');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0010');
  });
});

// ---------------------------------------------------------------------------
// INV-0011: Mechanical enforcement required for all invariants
// ---------------------------------------------------------------------------

describe('INV-0011 — Mechanical enforcement required', () => {
  test('detects invariant with prose-only enforcement', () => {
    const violations = engineWithViolations(cleanContext({ invariant_prose_only: true }));
    assertDetected(violations, 'INV-0011');
  });

  test('detects invariant ID missing mechanical enforcement layer', () => {
    const violations = engineWithViolations(cleanContext({
      invariant_id_without_mechanical_enforcement: 'INV-XXXX',
    }));
    assertDetected(violations, 'INV-0011');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0011');
  });
});

// ---------------------------------------------------------------------------
// INV-0012: Pick writer authority — field-level ownership
// ---------------------------------------------------------------------------

describe('INV-0012 — Pick writer authority', () => {
  test('detects unauthorized field write by wrong role', () => {
    const violations = engineWithViolations(cleanContext({
      unauthorized_field_write: 'submitter attempting to write settlement_result',
    }));
    assertDetected(violations, 'INV-0012');
  });

  test('detects cross-role field write flag', () => {
    const violations = engineWithViolations(cleanContext({ cross_role_field_write: true }));
    assertDetected(violations, 'INV-0012');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0012');
  });
});

// ---------------------------------------------------------------------------
// INV-0013: No truth-surface migration without tested rollback
// ---------------------------------------------------------------------------

describe('INV-0013 — No migration without rollback', () => {
  test('detects migration missing rollback script', () => {
    const violations = engineWithViolations(cleanContext({ migration_missing_rollback: true }));
    assertDetected(violations, 'INV-0013');
  });

  test('detects migration reversibility gate failure', () => {
    const violations = engineWithViolations(cleanContext({ migration_reversibility_gate_failed: true }));
    assertDetected(violations, 'INV-0013');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0013');
  });
});

// ---------------------------------------------------------------------------
// INV-0014: Audit log is append-only and immutable (runtime-evaluable)
// ---------------------------------------------------------------------------

describe('INV-0014 — Audit log is append-only and immutable', () => {
  test('detects DELETE on audit_log', () => {
    const violations = engineWithViolations(cleanContext({ audit_log_delete_attempted: true }));
    assertDetected(violations, 'INV-0014');
  });

  test('detects UPDATE on audit_log', () => {
    const violations = engineWithViolations(cleanContext({ audit_log_update_attempted: true }));
    assertDetected(violations, 'INV-0014');
  });

  test('detects audit_log rows being pruned', () => {
    const violations = engineWithViolations(cleanContext({ audit_log_rows_pruned: 5 }));
    assertDetected(violations, 'INV-0014');
  });

  test('no violation when zero rows pruned', () => {
    const violations = engineWithViolations(cleanContext({ audit_log_rows_pruned: 0 }));
    assertNotDetected(violations, 'INV-0014');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0014');
  });
});

// ---------------------------------------------------------------------------
// INV-0015: Pick lifecycle transitions immutable once terminal (runtime-evaluable)
// ---------------------------------------------------------------------------

describe('INV-0015 — Pick lifecycle terminal immutability', () => {
  test('detects transition from settled state', () => {
    const violations = engineWithViolations(cleanContext({
      transition_from_state: 'settled',
      transition_to_state: 'qualified',
    }));
    assertDetected(violations, 'INV-0015');
  });

  test('detects transition from voided state', () => {
    const violations = engineWithViolations(cleanContext({
      transition_from_state: 'voided',
      transition_to_state: 'pending',
    }));
    assertDetected(violations, 'INV-0015');
  });

  test('detects settled state transition without to_state (bare terminal re-transition)', () => {
    const violations = engineWithViolations(cleanContext({
      transition_from_state: 'settled',
    }));
    assertDetected(violations, 'INV-0015');
  });

  test('detects retroactive terminal change flag', () => {
    const violations = engineWithViolations(cleanContext({ retroactive_terminal_change: true }));
    assertDetected(violations, 'INV-0015');
  });

  test('no violation for non-terminal from_state', () => {
    const violations = engineWithViolations(cleanContext({
      transition_from_state: 'pending',
      transition_to_state: 'qualified',
    }));
    assertNotDetected(violations, 'INV-0015');
  });

  test('no violation on clean context', () => {
    const violations = engineWithViolations(cleanContext());
    assertNotDetected(violations, 'INV-0015');
  });
});

// ---------------------------------------------------------------------------
// Engine mechanics
// ---------------------------------------------------------------------------

describe('InvariantEngine — mechanics', () => {
  test('returns empty array for fully clean context', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(cleanContext());
    assert.equal(violations.length, 0);
  });

  test('evaluate() returns InvariantViolation objects with required fields', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(cleanContext({ delivery_bypassed_outbox: true }));
    assert.equal(violations.length, 1);
    const v = violations[0]!;
    assert.equal(typeof v.invariant_id, 'string');
    assert.equal(typeof v.title, 'string');
    assert.equal(typeof v.severity, 'string');
    assert.equal(typeof v.quarantine_behavior, 'string');
    assert.equal(typeof v.detected_at, 'string');
    assert.equal(typeof v.context, 'object');
    assert.ok(v.replay_run_id === undefined, 'replay_run_id should be absent from evaluate()');
  });

  test('evaluateForReplay() stamps violations with replay_run_id', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluateForReplay(
      cleanContext({ delivery_bypassed_outbox: true }),
      'replay-42',
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0]!.replay_run_id, 'replay-42');
  });

  test('evaluateForReplay() returns empty array for clean context', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluateForReplay(cleanContext(), 'replay-43');
    assert.equal(violations.length, 0);
  });

  test('emits "violation" event for each detected violation', () => {
    const engine = new InvariantEngine();
    const emitted: string[] = [];
    engine.on('violation', (v) => emitted.push(v.invariant_id));
    engine.evaluate(cleanContext({
      delivery_bypassed_outbox: true,
      audit_log_delete_attempted: true,
    }));
    assert.ok(emitted.includes('INV-0009'));
    assert.ok(emitted.includes('INV-0014'));
  });

  test('RUNTIME_EVALUABLE_IDS is a Set containing the four runtime-evaluable invariants', () => {
    assert.ok(InvariantEngine.RUNTIME_EVALUABLE_IDS.has('INV-0009'));
    assert.ok(InvariantEngine.RUNTIME_EVALUABLE_IDS.has('INV-0010'));
    assert.ok(InvariantEngine.RUNTIME_EVALUABLE_IDS.has('INV-0014'));
    assert.ok(InvariantEngine.RUNTIME_EVALUABLE_IDS.has('INV-0015'));
  });

  test('multiple violations can be returned in a single evaluate() call', () => {
    const engine = new InvariantEngine();
    const violations = engine.evaluate(cleanContext({
      silent_fallback_state: 'qualified',       // INV-0010
      audit_log_update_attempted: true,          // INV-0014
      transition_from_state: 'settled',          // INV-0015
      transition_to_state: 'pending',
    }));
    const ids = violations.map((v) => v.invariant_id);
    assert.ok(ids.includes('INV-0010'));
    assert.ok(ids.includes('INV-0014'));
    assert.ok(ids.includes('INV-0015'));
  });
});
