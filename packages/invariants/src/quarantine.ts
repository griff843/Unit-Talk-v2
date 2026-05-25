/**
 * QuarantineManager (UTV2-1090 / INIT-1.3.3)
 *
 * Mechanical quarantine and escalation for invariant violations.
 * - Every violation emits an immutable AuditEvent.
 * - Violations with quarantine_behavior 'fail-closed' or 'quarantine' auto-quarantine.
 * - Escalation routes mechanically to the escalation_target from the registry entry.
 * - No configuration can suppress quarantine (adversarial invariant).
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { InvariantViolation } from './engine.js';
import type { InvariantSeverity, InvariantQuarantineBehavior } from './types.js';
import { getInvariant } from './registry/loader.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QuarantineStatus = 'quarantined' | 'escalated';

export interface AuditEvent {
  readonly id: string;
  readonly event_type: 'invariant_violation' | 'quarantine_triggered' | 'escalation_routed';
  readonly invariant_id: string;
  readonly severity: InvariantSeverity;
  readonly quarantine_behavior: InvariantQuarantineBehavior;
  readonly recorded_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly immutable: true;
}

export interface QuarantineRecord {
  readonly id: string;
  readonly invariant_id: string;
  readonly violation: InvariantViolation;
  readonly quarantined_at: string;
  readonly escalation_target: string;
  readonly status: QuarantineStatus;
  readonly audit_event_id: string;
}

export interface EscalationNotice {
  readonly invariant_id: string;
  readonly target: string;
  readonly quarantine_record_id: string;
  readonly audit_event_id: string;
  readonly routed_at: string;
}

export interface QuarantineResult {
  readonly audit_events: readonly AuditEvent[];
  readonly quarantine_records: readonly QuarantineRecord[];
  readonly escalations: readonly EscalationNotice[];
}

// ---------------------------------------------------------------------------
// Behaviors that trigger automatic quarantine
// ---------------------------------------------------------------------------

const AUTO_QUARANTINE_BEHAVIORS: ReadonlySet<InvariantQuarantineBehavior> = new Set([
  'fail-closed',
  'quarantine',
]);

// ---------------------------------------------------------------------------
// QuarantineManager
// ---------------------------------------------------------------------------

/**
 * Processes InvariantViolations and applies mechanical quarantine.
 *
 * Construction accepts no options — quarantine behavior is driven entirely
 * by the violation's quarantine_behavior field. This is the adversarial
 * invariant: there is no configuration path to suppress quarantine.
 */
export class QuarantineManager extends EventEmitter {
  /**
   * Process a set of violations.
   * Emits 'audit_event', 'quarantine', and 'escalation' events for each applicable violation.
   * Returns an immutable QuarantineResult.
   */
  process(violations: readonly InvariantViolation[]): QuarantineResult {
    const auditEvents: AuditEvent[] = [];
    const quarantineRecords: QuarantineRecord[] = [];
    const escalations: EscalationNotice[] = [];

    for (const violation of violations) {
      // Every violation emits an AuditEvent — no exceptions.
      const violationAudit = this.buildAuditEvent('invariant_violation', violation);
      auditEvents.push(violationAudit);
      this.emit('audit_event', violationAudit);

      if (AUTO_QUARANTINE_BEHAVIORS.has(violation.quarantine_behavior)) {
        const escalationTarget = this.resolveEscalationTarget(violation);

        const quarantineAudit = this.buildAuditEvent('quarantine_triggered', violation);
        auditEvents.push(quarantineAudit);
        this.emit('audit_event', quarantineAudit);

        const record: QuarantineRecord = {
          id: randomUUID(),
          invariant_id: violation.invariant_id,
          violation,
          quarantined_at: new Date().toISOString(),
          escalation_target: escalationTarget,
          status: 'quarantined',
          audit_event_id: quarantineAudit.id,
        };
        quarantineRecords.push(record);
        this.emit('quarantine', record);

        const escalationAudit = this.buildAuditEvent('escalation_routed', violation);
        auditEvents.push(escalationAudit);
        this.emit('audit_event', escalationAudit);

        const notice: EscalationNotice = {
          invariant_id: violation.invariant_id,
          target: escalationTarget,
          quarantine_record_id: record.id,
          audit_event_id: escalationAudit.id,
          routed_at: new Date().toISOString(),
        };
        escalations.push(notice);
        this.emit('escalation', notice);
      }
    }

    return Object.freeze({
      audit_events: Object.freeze(auditEvents),
      quarantine_records: Object.freeze(quarantineRecords),
      escalations: Object.freeze(escalations),
    });
  }

  private buildAuditEvent(
    eventType: AuditEvent['event_type'],
    violation: InvariantViolation,
  ): AuditEvent {
    return Object.freeze({
      id: randomUUID(),
      event_type: eventType,
      invariant_id: violation.invariant_id,
      severity: violation.severity,
      quarantine_behavior: violation.quarantine_behavior,
      recorded_at: new Date().toISOString(),
      payload: Object.freeze({ ...violation.context }),
      immutable: true as const,
    });
  }

  private resolveEscalationTarget(violation: InvariantViolation): string {
    // Prefer the registry's declared escalation_target if available.
    const entry = getInvariant(violation.invariant_id);
    if (entry?.escalation_target) {
      return entry.escalation_target;
    }
    // Fall back to GovernanceReviewer for any unregistered violation.
    return 'GovernanceReviewer';
  }

  /**
   * The set of quarantine_behavior values that trigger automatic quarantine.
   * Exposed as a static for adversarial test assertions.
   */
  static readonly AUTO_QUARANTINE_BEHAVIORS: ReadonlySet<InvariantQuarantineBehavior> =
    AUTO_QUARANTINE_BEHAVIORS;
}
