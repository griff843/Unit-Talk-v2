import { stableHash } from './independent-data-path.js';
import type {
  BuildEscalationBatchInput,
  BuildEscalationInput,
  AdversarialFinding,
  EscalationEvent,
  AuditEvent,
  EscalationReason,
  EscalationResult,
} from './escalation.types.js';

export type {
  BuildEscalationBatchInput,
  BuildEscalationInput,
  AdversarialFinding,
  EscalationEvent,
  AuditEvent,
  EscalationDecision,
  EscalationReason,
  EscalationEventType,
  EscalationAuditEventType,
  EscalationResult,
} from './escalation.types.js';

export class EscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EscalationError';
  }
}

export const ADVERSARIAL_ESCALATION_EVENT_TYPE = 'adversarial.escalation' as const;
export const ADVERSARIAL_ESCALATION_AUDIT_EVENT_TYPE = 'adversarial.escalation.audit' as const;

export function buildAdversarialEscalation(input: BuildEscalationInput): EscalationResult {
  assertIsoTimestamp(input.escalatedAt, 'escalatedAt');
  assertReplayableFinding(input.finding);

  const shouldEscalate = input.finding.quarantineSignal === true;
  const reason: EscalationReason = shouldEscalate
    ? 'quarantine_signal_present'
    : 'quarantine_signal_absent';

  const escalationEvent = shouldEscalate
    ? buildEscalationEvent(input.finding, input.escalatedAt)
    : null;

  return Object.freeze({
    escalationEvent,
    auditEvent: buildAuditEvent(input.finding, input.escalatedAt, shouldEscalate, reason),
  });
}

export function buildAdversarialEscalationBatch(
  input: BuildEscalationBatchInput,
): readonly EscalationResult[] {
  return Object.freeze(input.findings.map((finding) => buildAdversarialEscalation({
    finding,
    escalatedAt: input.escalatedAt,
  })));
}

function buildEscalationEvent(finding: AdversarialFinding, escalatedAt: string): EscalationEvent {
  return Object.freeze({
    id: `advesc_${stableHash({
      classification: finding.classification,
      escalatedAt,
      findingId: finding.id,
      recordId: finding.recordId,
      replayKey: finding.replayKey,
    })}`,
    eventType: ADVERSARIAL_ESCALATION_EVENT_TYPE,
    findingId: finding.id,
    recordId: finding.recordId,
    replayKey: finding.replayKey,
    escalatedAt,
    classification: finding.classification,
    confidence: finding.confidence,
    quarantineSignal: true,
    economicImpactIgnored: true,
  });
}

function buildAuditEvent(
  finding: AdversarialFinding,
  auditedAt: string,
  escalated: boolean,
  reason: EscalationReason,
): AuditEvent {
  return Object.freeze({
    id: `advaudit_${stableHash({
      auditedAt,
      decision: escalated ? 'escalated' : 'not_escalated',
      findingId: finding.id,
      reason,
      recordId: finding.recordId,
      replayKey: finding.replayKey,
    })}`,
    eventType: ADVERSARIAL_ESCALATION_AUDIT_EVENT_TYPE,
    findingId: finding.id,
    recordId: finding.recordId,
    replayKey: finding.replayKey,
    auditedAt,
    decision: escalated ? 'escalated' : 'not_escalated',
    reason,
  });
}

function assertReplayableFinding(finding: AdversarialFinding): void {
  assertNonEmpty(finding.id, 'finding.id');
  assertNonEmpty(finding.recordId, 'finding.recordId');
  assertNonEmpty(finding.replayKey, 'finding.replayKey');
  assertNonEmpty(finding.payloadHash, 'finding.payloadHash');

  if (finding.replayableFromPath !== 'independent-adversarial') {
    throw new EscalationError('finding must be replayable from independent-adversarial');
  }
  if (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1) {
    throw new EscalationError('finding.confidence must be a finite number between 0 and 1');
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new EscalationError(`${field} is required`);
  }
}

function assertIsoTimestamp(value: string, field: string): void {
  assertNonEmpty(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new EscalationError(`${field} must be an ISO-8601 UTC timestamp`);
  }
}
