/**
 * Cohort-Level Holds — INIT-3.3.3
 *
 * A model may be held for a specific market-type / league cohort while
 * remaining active for other cohorts. Cohort-level degradation that does not
 * breach the aggregate threshold is still caught and held mechanically.
 *
 * Invariants:
 *  - Cohort degradation triggers a cohort-level hold (not a full model hold).
 *  - A model can have multiple simultaneous cohort holds.
 *  - All cohort hold decisions emit AuditEvents as append-only records.
 *  - All functions are pure and deterministic for replay.
 *  - Cohort metrics are reproducible from stored inputs.
 */

// ── Cohort identity ────────────────────────────────────────────────────────────

/**
 * Identifies a single cohort: a sport + market-type pair.
 * Cohort key = `{sport}:{market_type}` (e.g. "nba:spread").
 */
export interface CohortKey {
  readonly sport: string;
  readonly market_type: string;
}

export function cohortKeyString(cohort: CohortKey): string {
  return `${cohort.sport}:${cohort.market_type}`;
}

// ── Cohort threshold + metrics ────────────────────────────────────────────────

export interface CohortThreshold {
  readonly metric: string;
  readonly threshold: number;
  readonly direction: 'above' | 'below';
}

/** Per-cohort metric readings. */
export interface CohortMetrics {
  readonly cohort: CohortKey;
  /** Map of metric name → actual measured value for this cohort. */
  readonly metrics: Readonly<Record<string, number>>;
}

// ── Cohort violation ──────────────────────────────────────────────────────────

export interface CohortViolation {
  readonly metric: string;
  readonly threshold: number;
  readonly actual_value: number;
  readonly direction: 'above' | 'below';
}

// ── Cohort hold record ────────────────────────────────────────────────────────

export interface CohortHoldAuditEvent {
  readonly event_type: 'cohort_hold_triggered';
  readonly entity_type: 'model_version_cohort';
  /** Stable key: `{model_name}@{model_version}:{sport}:{market_type}` */
  readonly entity_id: string;
  readonly triggered_at_ms: number;
  readonly cohort_key: string;
  readonly violations: readonly CohortViolation[];
}

/**
 * An active hold scoped to a specific cohort.
 * The model remains active for all other cohorts.
 */
export interface CohortHold {
  readonly hold_id: string;
  readonly model_name: string;
  readonly model_version: string;
  readonly cohort: CohortKey;
  readonly cohort_key: string;
  readonly violations: readonly CohortViolation[];
  readonly triggered_at_ms: number;
  readonly blocks_scoring_for_cohort: true;
  readonly audit_event: CohortHoldAuditEvent;
}

// ── Evaluation input / result ─────────────────────────────────────────────────

export interface CohortHoldEvaluationInput {
  readonly model_name: string;
  readonly model_version: string;
  /**
   * Thresholds that apply to every cohort unless overridden.
   * Per-cohort overrides are not supported in this version —
   * all cohorts share the same threshold set.
   */
  readonly thresholds: readonly CohortThreshold[];
  /** Metric readings per cohort. */
  readonly cohort_metrics: readonly CohortMetrics[];
  readonly evaluated_at_ms: number;
}

export interface CohortHoldEvaluationResult {
  readonly model_name: string;
  readonly model_version: string;
  readonly evaluated_at_ms: number;
  /** All cohorts that breached at least one threshold. */
  readonly held_cohorts: readonly CohortHold[];
  /** Cohort keys that were evaluated but had no violations. */
  readonly passing_cohort_keys: readonly string[];
  readonly any_held: boolean;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Evaluates all cohorts against the shared threshold set.
 *
 * For each cohort in cohort_metrics, every configured threshold is checked.
 * A cohort that violates any threshold gets a CohortHold. Missing metrics
 * within a cohort are treated as violations (fail-closed).
 *
 * A model can have zero, one, or many cohort holds simultaneously.
 * Cohorts with no readings are silently skipped.
 */
export function evaluateCohortHolds(
  input: CohortHoldEvaluationInput,
): CohortHoldEvaluationResult {
  const heldCohorts: CohortHold[] = [];
  const passingCohortKeys: string[] = [];

  for (const cohortEntry of input.cohort_metrics) {
    const key = cohortKeyString(cohortEntry.cohort);
    const violations: CohortViolation[] = [];

    for (const threshold of input.thresholds) {
      const actual = cohortEntry.metrics[threshold.metric];

      if (actual === undefined) {
        // Metric absent in this cohort's readings — fail-closed.
        violations.push({
          metric: threshold.metric,
          threshold: threshold.threshold,
          actual_value: NaN,
          direction: threshold.direction,
        });
        continue;
      }

      const breached =
        threshold.direction === 'above'
          ? actual > threshold.threshold
          : actual < threshold.threshold;

      if (breached) {
        violations.push({
          metric: threshold.metric,
          threshold: threshold.threshold,
          actual_value: actual,
          direction: threshold.direction,
        });
      }
    }

    if (violations.length > 0) {
      const entityId = `${input.model_name}@${input.model_version}:${key}`;
      const holdId = `cohort-hold:${entityId}:${input.evaluated_at_ms}`;

      const auditEvent: CohortHoldAuditEvent = {
        event_type: 'cohort_hold_triggered',
        entity_type: 'model_version_cohort',
        entity_id: entityId,
        triggered_at_ms: input.evaluated_at_ms,
        cohort_key: key,
        violations,
      };

      heldCohorts.push({
        hold_id: holdId,
        model_name: input.model_name,
        model_version: input.model_version,
        cohort: cohortEntry.cohort,
        cohort_key: key,
        violations,
        triggered_at_ms: input.evaluated_at_ms,
        blocks_scoring_for_cohort: true,
        audit_event: auditEvent,
      });
    } else {
      passingCohortKeys.push(key);
    }
  }

  return {
    model_name: input.model_name,
    model_version: input.model_version,
    evaluated_at_ms: input.evaluated_at_ms,
    held_cohorts: heldCohorts,
    passing_cohort_keys: passingCohortKeys,
    any_held: heldCohorts.length > 0,
  };
}

/**
 * Returns true if the given cohort is currently held.
 * Callers use this as the per-cohort scoring gate.
 */
export function isCohortHeld(
  result: CohortHoldEvaluationResult,
  cohort: CohortKey,
): boolean {
  const key = cohortKeyString(cohort);
  return result.held_cohorts.some((h) => h.cohort_key === key);
}
