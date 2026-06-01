import type { ManipulationFinding } from './manipulation-detector.types.js';
import type { ProviderAnomalyReport } from './provider-anomaly.types.js';

export type AdversarialFinding = ManipulationFinding | ProviderAnomalyReport;

export type EscalationDecision = 'escalated' | 'not_escalated';
export type EscalationReason = 'quarantine_signal_present' | 'quarantine_signal_absent';
export type EscalationEventType = 'adversarial.escalation';
export type EscalationAuditEventType = 'adversarial.escalation.audit';

export interface BuildEscalationInput {
  readonly finding: AdversarialFinding;
  readonly escalatedAt: string;
  readonly economicImpact?: number;
}

export interface BuildEscalationBatchInput {
  readonly findings: readonly AdversarialFinding[];
  readonly escalatedAt: string;
}

export interface EscalationEvent {
  readonly id: string;
  readonly eventType: EscalationEventType;
  readonly findingId: string;
  readonly recordId: string;
  readonly replayKey: string;
  readonly escalatedAt: string;
  readonly classification: string;
  readonly confidence: number;
  readonly quarantineSignal: true;
  readonly economicImpactIgnored: boolean;
}

export interface AuditEvent {
  readonly id: string;
  readonly eventType: EscalationAuditEventType;
  readonly findingId: string;
  readonly recordId: string;
  readonly replayKey: string;
  readonly auditedAt: string;
  readonly decision: EscalationDecision;
  readonly reason: EscalationReason;
}

export interface EscalationResult {
  readonly escalationEvent: EscalationEvent | null;
  readonly auditEvent: AuditEvent;
}
