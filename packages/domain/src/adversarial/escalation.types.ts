// UTV2-1149: Escalation wiring types — INIT-5.2.3
// Stub for lane file-scope lock. Implementation by Codex lane.

import type { ManipulationFinding } from './manipulation-detector.types.js';
import type { ProviderAnomalyReport } from './provider-anomaly.types.js';

export type AdversarialFinding = ManipulationFinding | ProviderAnomalyReport;

export interface EscalationEvent {
  readonly id: string;
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
  readonly findingId: string;
  readonly recordId: string;
  readonly replayKey: string;
  readonly auditedAt: string;
  readonly decision: 'escalated' | 'not_escalated';
  readonly reason: string;
}

export interface EscalationResult {
  readonly escalationEvent: EscalationEvent | null;
  readonly auditEvent: AuditEvent;
}
