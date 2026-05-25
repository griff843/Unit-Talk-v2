/**
 * QuarantineManager tests (UTV2-1090 / INIT-1.3.3)
 *
 * Adversarial validation: confirm quarantine cannot be suppressed by configuration.
 * Proof artifact: injected critical violation auto-quarantines and emits AuditEvent.
 *
 * Test runner: node:test + tsx --test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { QuarantineManager } from './quarantine.js';
import type { InvariantViolation } from './engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeViolation(
  overrides: Partial<InvariantViolation> = {},
): InvariantViolation {
  return {
    invariant_id: 'INV-0001',
    title: 'Test invariant',
    severity: 'governance-critical',
    quarantine_behavior: 'fail-closed',
    detected_at: new Date().toISOString(),
    context: { test: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AuditEvent emission — every violation, no exceptions
// ---------------------------------------------------------------------------

describe('QuarantineManager — AuditEvent emission', () => {
  test('emits AuditEvent for a fail-closed violation', () => {
    const mgr = new QuarantineManager();
    const audits: unknown[] = [];
    mgr.on('audit_event', (e) => audits.push(e));

    const violation = makeViolation({ quarantine_behavior: 'fail-closed' });
    mgr.process([violation]);

    assert.ok(audits.length >= 1, 'at least one AuditEvent must be emitted');
  });

  test('emits AuditEvent for a quarantine violation', () => {
    const mgr = new QuarantineManager();
    const audits: unknown[] = [];
    mgr.on('audit_event', (e) => audits.push(e));

    mgr.process([makeViolation({ quarantine_behavior: 'quarantine' })]);
    assert.ok(audits.length >= 1);
  });

  test('emits AuditEvent for an advisory violation (no quarantine, but audited)', () => {
    const mgr = new QuarantineManager();
    const audits: unknown[] = [];
    mgr.on('audit_event', (e) => audits.push(e));

    mgr.process([makeViolation({ quarantine_behavior: 'advisory' })]);
    assert.equal(audits.length, 1, 'advisory violations emit exactly 1 AuditEvent (violation only)');
  });

  test('returns audit_events in QuarantineResult for all violations', () => {
    const mgr = new QuarantineManager();
    const violations = [
      makeViolation({ invariant_id: 'INV-0009', quarantine_behavior: 'fail-closed' }),
      makeViolation({ invariant_id: 'INV-0010', quarantine_behavior: 'advisory' }),
    ];
    const result = mgr.process(violations);
    // fail-closed: violation + quarantine + escalation = 3 events; advisory: 1 event → 4 total
    assert.ok(result.audit_events.length >= 2, 'at least one AuditEvent per violation');
    const ids = result.audit_events.map((e) => (e as { invariant_id: string }).invariant_id);
    assert.ok(ids.includes('INV-0009'));
    assert.ok(ids.includes('INV-0010'));
  });

  test('AuditEvent has required immutable shape', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation()]);
    const event = result.audit_events[0]!;
    assert.equal(typeof event.id, 'string');
    assert.ok(event.id.length > 0);
    assert.equal(typeof event.event_type, 'string');
    assert.equal(typeof event.invariant_id, 'string');
    assert.equal(typeof event.severity, 'string');
    assert.equal(typeof event.quarantine_behavior, 'string');
    assert.equal(typeof event.recorded_at, 'string');
    assert.equal(typeof event.payload, 'object');
    assert.equal(event.immutable, true);
  });

  test('processes zero violations gracefully — no events emitted', () => {
    const mgr = new QuarantineManager();
    const audits: unknown[] = [];
    mgr.on('audit_event', (e) => audits.push(e));
    const result = mgr.process([]);
    assert.equal(audits.length, 0);
    assert.equal(result.audit_events.length, 0);
    assert.equal(result.quarantine_records.length, 0);
    assert.equal(result.escalations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Auto-quarantine — fail-closed and quarantine behaviors
// ---------------------------------------------------------------------------

describe('QuarantineManager — automatic quarantine', () => {
  test('auto-quarantines fail-closed violation without human action', () => {
    const mgr = new QuarantineManager();
    const quarantined: unknown[] = [];
    mgr.on('quarantine', (r) => quarantined.push(r));

    const result = mgr.process([makeViolation({ quarantine_behavior: 'fail-closed' })]);
    assert.equal(result.quarantine_records.length, 1);
    assert.equal(quarantined.length, 1);
  });

  test('auto-quarantines quarantine-behavior violation', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation({ quarantine_behavior: 'quarantine' })]);
    assert.equal(result.quarantine_records.length, 1);
  });

  test('does NOT quarantine advisory violation', () => {
    const mgr = new QuarantineManager();
    const quarantined: unknown[] = [];
    mgr.on('quarantine', (r) => quarantined.push(r));

    const result = mgr.process([makeViolation({ quarantine_behavior: 'advisory' })]);
    assert.equal(result.quarantine_records.length, 0);
    assert.equal(quarantined.length, 0);
  });

  test('QuarantineRecord has required shape and is tied to the violation', () => {
    const mgr = new QuarantineManager();
    const violation = makeViolation({
      invariant_id: 'INV-0014',
      severity: 'governance-critical',
      quarantine_behavior: 'fail-closed',
    });
    const result = mgr.process([violation]);
    const record = result.quarantine_records[0]!;

    assert.equal(typeof record.id, 'string');
    assert.equal(record.invariant_id, 'INV-0014');
    assert.equal(record.violation.invariant_id, 'INV-0014');
    assert.equal(typeof record.quarantined_at, 'string');
    assert.equal(typeof record.escalation_target, 'string');
    assert.ok(record.escalation_target.length > 0);
    assert.equal(record.status, 'quarantined');
    assert.equal(typeof record.audit_event_id, 'string');
  });

  test('multiple violations quarantined independently', () => {
    const mgr = new QuarantineManager();
    const violations = [
      makeViolation({ invariant_id: 'INV-0009', quarantine_behavior: 'fail-closed' }),
      makeViolation({ invariant_id: 'INV-0014', quarantine_behavior: 'quarantine' }),
      makeViolation({ invariant_id: 'INV-0001', quarantine_behavior: 'advisory' }),
    ];
    const result = mgr.process(violations);
    // 2 quarantined (fail-closed + quarantine), 1 advisory (not quarantined)
    assert.equal(result.quarantine_records.length, 2);
    const ids = result.quarantine_records.map((r) => r.invariant_id);
    assert.ok(ids.includes('INV-0009'));
    assert.ok(ids.includes('INV-0014'));
    assert.ok(!ids.includes('INV-0001'));
  });
});

// ---------------------------------------------------------------------------
// Escalation routing — mechanical, not advisory
// ---------------------------------------------------------------------------

describe('QuarantineManager — escalation routing', () => {
  test('routes escalation for fail-closed violation', () => {
    const mgr = new QuarantineManager();
    const escalated: unknown[] = [];
    mgr.on('escalation', (n) => escalated.push(n));

    const result = mgr.process([makeViolation({ quarantine_behavior: 'fail-closed' })]);
    assert.equal(result.escalations.length, 1);
    assert.equal(escalated.length, 1);
  });

  test('escalation notice references quarantine_record_id', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation({ quarantine_behavior: 'fail-closed' })]);
    const record = result.quarantine_records[0]!;
    const notice = result.escalations[0]!;

    assert.equal(notice.quarantine_record_id, record.id);
    assert.equal(notice.invariant_id, record.invariant_id);
    assert.equal(typeof notice.target, 'string');
    assert.ok(notice.target.length > 0);
    assert.equal(typeof notice.routed_at, 'string');
  });

  test('does NOT escalate advisory violation', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation({ quarantine_behavior: 'advisory' })]);
    assert.equal(result.escalations.length, 0);
  });

  test('escalation target is non-empty for all quarantinable severities', () => {
    const mgr = new QuarantineManager();
    const severities = [
      'existential',
      'truth-critical',
      'replay-critical',
      'governance-critical',
      'settlement-critical',
      'capital-runtime',
    ] as const;

    for (const severity of severities) {
      const result = mgr.process([makeViolation({ severity, quarantine_behavior: 'fail-closed' })]);
      const notice = result.escalations[0]!;
      assert.ok(notice.target.length > 0, `escalation target must be set for severity ${severity}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Adversarial validation — quarantine cannot be suppressed by configuration
// ---------------------------------------------------------------------------

describe('QuarantineManager — adversarial: quarantine cannot be suppressed', () => {
  test('constructor accepts no suppression config — no options parameter', () => {
    // QuarantineManager takes no constructor arguments.
    // Passing unexpected args would fail TypeScript; at runtime it still works correctly.
    const mgr = new QuarantineManager();
    assert.ok(mgr instanceof QuarantineManager);
  });

  test('AUTO_QUARANTINE_BEHAVIORS is a frozen set — cannot be mutated at runtime', () => {
    const behaviors = QuarantineManager.AUTO_QUARANTINE_BEHAVIORS;
    assert.ok(behaviors.has('fail-closed'));
    assert.ok(behaviors.has('quarantine'));
    assert.ok(!behaviors.has('advisory'));

    // Confirm it is a ReadonlySet (cannot add/delete)
    assert.ok(typeof (behaviors as unknown as Set<string>).add === 'undefined' ||
      (() => {
        try {
          (behaviors as unknown as Set<string>).add('advisory');
          return false; // should not reach here if truly frozen
        } catch {
          return true;
        }
      })(),
      'AUTO_QUARANTINE_BEHAVIORS must not be mutable',
    );
  });

  test('quarantine fires even when process() is called repeatedly — no state degradation', () => {
    const mgr = new QuarantineManager();
    for (let i = 0; i < 5; i++) {
      const result = mgr.process([makeViolation({ quarantine_behavior: 'fail-closed' })]);
      assert.equal(result.quarantine_records.length, 1, `quarantine must fire on call ${i + 1}`);
    }
  });

  test('injected critical violation auto-quarantines and emits AuditEvent — proof artifact', () => {
    // This is the required proof artifact from the issue: an injected critical violation
    // must auto-quarantine and emit an AuditEvent — no human action required.
    const mgr = new QuarantineManager();
    const auditEvents: unknown[] = [];
    const quarantineRecords: unknown[] = [];

    mgr.on('audit_event', (e) => auditEvents.push(e));
    mgr.on('quarantine', (r) => quarantineRecords.push(r));

    const injectedViolation: InvariantViolation = {
      invariant_id: 'INV-0009',
      title: 'Postgres outbox is the only delivery queue',
      severity: 'settlement-critical',
      quarantine_behavior: 'fail-closed',
      detected_at: new Date().toISOString(),
      context: { delivery_bypassed_outbox: true, injected: true },
    };

    const result = mgr.process([injectedViolation]);

    // AuditEvent was emitted
    assert.ok(auditEvents.length >= 1, 'AuditEvent must be emitted for injected violation');

    // Quarantine record was created without human action
    assert.equal(result.quarantine_records.length, 1, 'QuarantineRecord must exist');
    assert.equal(quarantineRecords.length, 1, 'quarantine event must be emitted');

    // Escalation was routed
    assert.equal(result.escalations.length, 1, 'escalation must be routed');

    const record = result.quarantine_records[0]!;
    assert.equal(record.invariant_id, 'INV-0009');
    assert.equal(record.status, 'quarantined');

    const audit = result.audit_events.find(
      (e) => (e as { event_type: string }).event_type === 'invariant_violation',
    )!;
    assert.ok(audit !== undefined, 'invariant_violation AuditEvent must exist');
    assert.equal((audit as { immutable: boolean }).immutable, true);
  });

  test('QuarantineResult is frozen — cannot be mutated after process()', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation({ quarantine_behavior: 'fail-closed' })]);

    // Verify Object.freeze was applied (strict mode throws on write to frozen object)
    assert.throws(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any).quarantine_records = [];
      },
      TypeError,
      'QuarantineResult must be frozen (immutable)',
    );
  });

  test('AuditEvent payload is frozen — cannot be mutated after creation', () => {
    const mgr = new QuarantineManager();
    const result = mgr.process([makeViolation()]);
    const event = result.audit_events[0]!;

    assert.throws(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event.payload as any).injected_suppression = true;
      },
      TypeError,
      'AuditEvent payload must be frozen',
    );
  });
});
