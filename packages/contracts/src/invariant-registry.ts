/**
 * Constitutional invariant registry type contract (UTV2-1088 / INIT-1.3.1).
 *
 * Source of truth for InvariantRegistryEntry and related types.
 * The @unit-talk/invariants package imports these types (not the reverse).
 */

export type InvariantSeverity =
  | 'existential'
  | 'truth-critical'
  | 'replay-critical'
  | 'governance-critical'
  | 'settlement-critical'
  | 'capital-runtime';

export type InvariantEnforcingLayer =
  | 'ci'
  | 'db-trigger'
  | 'db-rpc'
  | 'application'
  | 'governance'
  | 'certification';

export type InvariantQuarantineBehavior = 'fail-closed' | 'quarantine' | 'advisory';

export type InvariantStatus = 'active' | 'proposed' | 'superseded' | 'retired';

export interface InvariantRegistryEntry {
  id: string;
  title: string;
  description: string;
  severity: InvariantSeverity;
  enforcing_layer: InvariantEnforcingLayer[];
  quarantine_behavior: InvariantQuarantineBehavior;
  escalation_target: string;
  status: InvariantStatus;
  source_ref: string;
  audit_gap_ref?: string;
  ratified_at: string;
  ratified_by: string;
  superseded_by?: string;
  retired_reason?: string;
}
