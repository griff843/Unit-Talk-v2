/**
 * Calibration Proof Bundle — INIT-3.3.4
 *
 * Composes the INIT-3.3 enforcement chain into a single reproducible proof:
 *   1. buildCalibrationReport()   — INIT-3.3.2: evaluate metrics against thresholds
 *   2. evaluateCalibrationGate()  — INIT-3.3.2: block promotion if report fails/absent/expired
 *   3. buildDeploymentHold()      — INIT-3.3.1: place model into held/quarantined state
 *   4. evaluateCohortHolds()      — INIT-3.3.3: per-cohort degradation detection
 *
 * The proof function is pure and deterministic. All inputs are stored so the
 * proof can be replayed from the same inputs and produce identical results.
 *
 * Advisory paths removed (INIT-3.3.4):
 *   - CalibrationAlertLevel 'green' for small samples → now 'insufficient_data'
 *   - SliceCalibrationMetrics zero-metric proxy reports → now has_sufficient_data=false
 */

import {
  buildCalibrationReport,
  evaluateCalibrationGate,
  type CalibrationReport,
  type CalibrationReportThreshold,
  type PromotionGateResult,
} from './calibration-gate.js';

import {
  buildDeploymentHold,
  type DeploymentHold,
  type DeploymentHoldTrigger,
} from './deployment-hold.js';

import {
  evaluateCohortHolds,
  type CohortHoldEvaluationResult,
  type CohortMetrics,
  type CohortThreshold,
} from './cohort-hold.js';

// ── Input ──────────────────────────────────────────────────────────────────────

export interface CalibrationProofInput {
  readonly proof_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly evaluated_at_ms: number;
  /** Thresholds used for both aggregate and per-cohort evaluation. */
  readonly thresholds: readonly CalibrationReportThreshold[];
  /** Aggregate metric readings (all cohorts combined). */
  readonly aggregate_metrics: Readonly<Record<string, number>>;
  /** Per-cohort metric readings. Empty array = no cohort evaluation. */
  readonly cohort_metrics: readonly CohortMetrics[];
  /**
   * Prior deployment state of the model.
   * Used if a hold must be placed (gate blocked + calibration_breach trigger).
   * Defaults to 'active'.
   */
  readonly prior_deployment_state?: 'active' | 'held' | 'quarantined' | 'retired';
}

// ── Result ─────────────────────────────────────────────────────────────────────

export interface CalibrationProof {
  readonly proof_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly evaluated_at_ms: number;
  /** Step 1 — aggregate calibration report */
  readonly calibration_report: CalibrationReport;
  /** Step 2 — promotion gate evaluation */
  readonly gate_result: PromotionGateResult;
  /** Step 3 — deployment hold, if gate blocked; null if gate approved */
  readonly deployment_hold: DeploymentHold | null;
  /** Step 4 — per-cohort hold evaluation */
  readonly cohort_hold_result: CohortHoldEvaluationResult;
  /** True when either the gate blocked (aggregate breach) or any cohort is held */
  readonly any_enforcement_fired: boolean;
}

// ── Function ───────────────────────────────────────────────────────────────────

/**
 * Builds a CalibrationProof by running the full INIT-3.3 enforcement chain.
 *
 * Enforcement fires when:
 *  - The aggregate CalibrationReport fails (gate blocks promotion)
 *  - Any individual cohort breaches its threshold
 *
 * When the gate blocks, a DeploymentHold is placed with trigger='calibration_breach'.
 * Cohort holds are always evaluated — they are independent of the gate result.
 */
export function buildCalibrationProof(input: CalibrationProofInput): CalibrationProof {
  // Step 1 — build aggregate calibration report
  const calibrationReport = buildCalibrationReport({
    report_id: `${input.proof_id}:report`,
    model_name: input.model_name,
    model_version: input.model_version,
    evaluated_at_ms: input.evaluated_at_ms,
    thresholds: input.thresholds,
    metrics: input.aggregate_metrics,
  });

  // Step 2 — evaluate promotion gate against the report
  const gateResult = evaluateCalibrationGate({
    model_name: input.model_name,
    model_version: input.model_version,
    requested_at_ms: input.evaluated_at_ms,
    calibration_report: calibrationReport,
  });

  // Step 3 — if gate blocked, place deployment hold
  let deploymentHold: DeploymentHold | null = null;
  if (gateResult.decision === 'blocked') {
    const firstViolation = calibrationReport.metric_results.find((r) => !r.passed);
    const trigger: DeploymentHoldTrigger = 'calibration_breach';

    deploymentHold = buildDeploymentHold({
      hold_id: `${input.proof_id}:hold`,
      model_name: input.model_name,
      model_version: input.model_version,
      trigger,
      breach: firstViolation
        ? {
            metric: firstViolation.metric,
            threshold: firstViolation.threshold,
            actual_value: firstViolation.actual_value,
            direction: firstViolation.direction,
          }
        : null,
      previous_state: input.prior_deployment_state ?? 'active',
      initiated_at_ms: input.evaluated_at_ms,
    });
  }

  // Step 4 — per-cohort hold evaluation (independent of aggregate gate)
  const cohortThresholds: CohortThreshold[] = input.thresholds.map((t) => ({
    metric: t.metric,
    threshold: t.threshold,
    direction: t.direction,
  }));

  const cohortHoldResult = evaluateCohortHolds({
    model_name: input.model_name,
    model_version: input.model_version,
    thresholds: cohortThresholds,
    cohort_metrics: input.cohort_metrics,
    evaluated_at_ms: input.evaluated_at_ms,
  });

  return {
    proof_id: input.proof_id,
    model_name: input.model_name,
    model_version: input.model_version,
    evaluated_at_ms: input.evaluated_at_ms,
    calibration_report: calibrationReport,
    gate_result: gateResult,
    deployment_hold: deploymentHold,
    cohort_hold_result: cohortHoldResult,
    any_enforcement_fired:
      gateResult.decision === 'blocked' || cohortHoldResult.any_held,
  };
}
