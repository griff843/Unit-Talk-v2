/**
 * Deployment Hold — INIT-3.3.1
 *
 * A calibration breach automatically transitions a model's deployment state
 * to 'held' or 'quarantined', blocking it from the decision pipeline without
 * requiring human action. This is the mechanical enforcement component for
 * Blueprint Layer 3.5 (automatic deployment hold on breach).
 *
 * Invariants:
 *  - A calibration breach always triggers a hold. There is no advisory path.
 *  - Deployment-state transitions emit AuditEvents as append-only records.
 *  - All functions are pure and deterministic for replay.
 *  - A held or quarantined model must not be used for scoring.
 */

export type DeploymentState = 'active' | 'held' | 'quarantined' | 'retired';

export type DeploymentHoldTrigger =
  | 'calibration_breach'    // INIT-3.3.1 — threshold exceeded on calibration metric
  | 'sha_mismatch'          // INIT-3.2.2 — SHA failed verification at inference
  | 'divergence_threshold'  // INIT-3.2.3 — shadow diverged beyond tolerance
  | 'rollback_failed';      // INIT-3.2.4 — rollback propagation failed

/** The metric reading that crossed a threshold and triggered the hold. */
export interface CalibrationBreach {
  readonly metric: string;
  readonly threshold: number;
  readonly actual_value: number;
  /** Whether the actual value exceeded the threshold from above or below. */
  readonly direction: 'above' | 'below';
}

/**
 * Emitted when a deployment hold fires. Callers persist this as an
 * append-only audit entry — never mutate an existing AuditEvent.
 */
export interface DeploymentHoldAuditEvent {
  readonly event_type: 'deployment_hold_triggered';
  readonly entity_type: 'model_version';
  /** Stable key: `{model_name}@{model_version}` */
  readonly entity_id: string;
  readonly previous_state: DeploymentState;
  readonly new_state: DeploymentState;
  readonly triggered_at_ms: number;
  readonly trigger: DeploymentHoldTrigger;
}

export interface DeploymentHold {
  readonly hold_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly artifact_sha: string | null;
  readonly trigger: DeploymentHoldTrigger;
  /** Non-null when trigger is 'calibration_breach'. */
  readonly breach: CalibrationBreach | null;
  readonly previous_state: DeploymentState;
  /** Held models transition to 'held'; repeat breaches transition to 'quarantined'. */
  readonly deployment_state: DeploymentState;
  readonly initiated_at_ms: number;
  /** Always true — a held or quarantined model is blocked from scoring. */
  readonly blocks_scoring: boolean;
  /** Append-only audit record. Callers must persist this. */
  readonly audit_event: DeploymentHoldAuditEvent;
}

export interface DeploymentHoldInput {
  readonly hold_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly artifact_sha?: string | null;
  readonly trigger: DeploymentHoldTrigger;
  readonly breach?: CalibrationBreach | null;
  /** Current state before this hold. Defaults to 'active'. */
  readonly previous_state?: DeploymentState;
  readonly initiated_at_ms: number;
}

/**
 * Builds an immutable DeploymentHold with its audit event.
 *
 * State transition rules:
 *  - 'active' → 'held' (first hold)
 *  - 'held' → 'quarantined' (repeat hold — model already under hold)
 *  - 'quarantined' stays 'quarantined'
 *  - 'retired' stays 'retired' (no-op; should not be re-held)
 *
 * Isolation guarantee: pure and stateless. Callers persist the hold and
 * its audit_event as append-only evidence.
 */
export function buildDeploymentHold(input: DeploymentHoldInput): DeploymentHold {
  const previousState: DeploymentState = input.previous_state ?? 'active';

  let deploymentState: DeploymentState;
  if (previousState === 'active') {
    deploymentState = 'held';
  } else if (previousState === 'held') {
    deploymentState = 'quarantined';
  } else {
    // Already quarantined or retired — state unchanged.
    deploymentState = previousState;
  }

  const entityId = `${input.model_name}@${input.model_version}`;

  const auditEvent: DeploymentHoldAuditEvent = {
    event_type: 'deployment_hold_triggered',
    entity_type: 'model_version',
    entity_id: entityId,
    previous_state: previousState,
    new_state: deploymentState,
    triggered_at_ms: input.initiated_at_ms,
    trigger: input.trigger,
  };

  return {
    hold_id: input.hold_id,
    model_name: input.model_name,
    model_version: input.model_version,
    artifact_sha: input.artifact_sha ?? null,
    trigger: input.trigger,
    breach: input.breach ?? null,
    previous_state: previousState,
    deployment_state: deploymentState,
    initiated_at_ms: input.initiated_at_ms,
    blocks_scoring: deploymentState === 'held' || deploymentState === 'quarantined',
    audit_event: auditEvent,
  };
}

/** Threshold configuration for a single calibration metric. */
export interface BreachThreshold {
  readonly metric: string;
  readonly threshold: number;
  readonly direction: 'above' | 'below';
}

export interface BreachEvaluationInput {
  readonly model_name: string;
  readonly model_version: string;
  readonly thresholds: readonly BreachThreshold[];
  /** Map of metric name → actual measured value. */
  readonly metrics: Readonly<Record<string, number>>;
}

export interface BreachEvaluationResult {
  readonly model_name: string;
  readonly model_version: string;
  readonly breached: boolean;
  /** All thresholds that were violated. Empty when breached is false. */
  readonly violations: readonly CalibrationBreach[];
}

/**
 * Evaluates calibration metrics against thresholds.
 *
 * Returns breached=true and the violating thresholds when any metric
 * crosses its configured limit. This is the fail-closed gate: a single
 * violation is sufficient to trigger a hold.
 *
 * Isolation guarantee: pure and deterministic. Callers drive hold creation
 * via buildDeploymentHold when breached=true.
 */
export function evaluateBreachHold(input: BreachEvaluationInput): BreachEvaluationResult {
  const violations: CalibrationBreach[] = [];

  for (const threshold of input.thresholds) {
    const actual = input.metrics[threshold.metric];
    if (actual === undefined) continue;

    const violated =
      threshold.direction === 'above'
        ? actual > threshold.threshold
        : actual < threshold.threshold;

    if (violated) {
      violations.push({
        metric: threshold.metric,
        threshold: threshold.threshold,
        actual_value: actual,
        direction: threshold.direction,
      });
    }
  }

  return {
    model_name: input.model_name,
    model_version: input.model_version,
    breached: violations.length > 0,
    violations,
  };
}
