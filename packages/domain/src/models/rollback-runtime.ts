/**
 * Rollback Runtime — INIT-3.2.4
 *
 * Records and verifies model rollback events as append-only audit evidence.
 * Rollbacks are initiated when SHA mismatch, shadow divergence, calibration
 * failure, or operator override is detected.
 *
 * Invariants:
 *  - Rollback records are append-only: existing records are never mutated.
 *  - Rollback is replay-safe: buildRollbackRecord is pure and deterministic.
 *  - fail_open determines routing behavior during rollback, not after.
 *  - Propagation verification re-checks the to_version SHA post-rollback.
 */

export type RollbackTrigger =
  | 'sha_mismatch'         // INIT-3.2.2 — SHA failed verification at inference
  | 'divergence_threshold' // INIT-3.2.3 — Shadow diverged beyond tolerance
  | 'calibration_failure'  // INIT-3.3.2 — Shadow-to-active calibration gate failed
  | 'deployment_breach'    // INIT-3.3.1 — Breach-to-deployment-state wiring
  | 'manual_override';     // Operator-initiated rollback

export type RollbackStatus =
  | 'initiated'   // Rollback requested but not yet propagated
  | 'propagated'  // Applied to all routing paths; awaiting SHA re-verification
  | 'verified'    // Propagation confirmed with SHA re-check
  | 'failed'      // Rollback attempt failed
  | 'superseded'; // A newer rollback for the same model superseded this one

export interface RollbackRecord {
  readonly rollback_id: string;
  readonly model_name: string;
  /** The version being rolled back FROM */
  readonly from_version: string;
  readonly from_artifact_sha: string | null;
  /** The version being rolled back TO (known-good) */
  readonly to_version: string;
  readonly to_artifact_sha: string | null;
  readonly trigger: RollbackTrigger;
  /** Human-readable detail about the trigger event */
  readonly trigger_detail: string | null;
  /**
   * When true: inference continues with the to_version during rollback window.
   * When false: inference is blocked until propagation is verified.
   * Fail-open is the default to avoid hard blocks on live routing.
   */
  readonly fail_open: boolean;
  readonly status: RollbackStatus;
  readonly initiated_at_ms: number;
  /** Non-null once rollback is propagated */
  readonly propagated_at_ms: number | null;
  /** Non-null once propagation is SHA-verified */
  readonly verified_at_ms: number | null;
  /** Non-null when status is 'failed' */
  readonly error_message: string | null;
  /** True once the to_version artifact SHA has been re-verified post-propagation */
  readonly sha_verified: boolean;
}

export interface RollbackInput {
  readonly rollback_id: string;
  readonly model_name: string;
  readonly from_version: string;
  readonly from_artifact_sha?: string | null;
  readonly to_version: string;
  readonly to_artifact_sha?: string | null;
  readonly trigger: RollbackTrigger;
  readonly trigger_detail?: string | null;
  /** Defaults to true (fail-open) */
  readonly fail_open?: boolean;
  readonly initiated_at_ms: number;
  readonly propagated_at_ms?: number | null;
  readonly verified_at_ms?: number | null;
  readonly error_message?: string | null;
  /** Defaults to false until explicit verification */
  readonly sha_verified?: boolean;
}

/**
 * Builds a RollbackRecord from raw inputs.
 *
 * Isolation guarantee: pure and stateless. Callers persist the record as
 * append-only audit evidence — never mutate an existing record.
 */
export function buildRollbackRecord(input: RollbackInput): RollbackRecord {
  const propagatedAt = input.propagated_at_ms ?? null;
  const verifiedAt = input.verified_at_ms ?? null;
  const errorMessage = input.error_message ?? null;
  const shaVerified = input.sha_verified ?? false;

  let status: RollbackStatus;
  if (errorMessage) {
    status = 'failed';
  } else if (verifiedAt !== null && shaVerified) {
    status = 'verified';
  } else if (propagatedAt !== null) {
    status = 'propagated';
  } else {
    status = 'initiated';
  }

  return {
    rollback_id: input.rollback_id,
    model_name: input.model_name,
    from_version: input.from_version,
    from_artifact_sha: input.from_artifact_sha ?? null,
    to_version: input.to_version,
    to_artifact_sha: input.to_artifact_sha ?? null,
    trigger: input.trigger,
    trigger_detail: input.trigger_detail ?? null,
    fail_open: input.fail_open ?? true,
    status,
    initiated_at_ms: input.initiated_at_ms,
    propagated_at_ms: propagatedAt,
    verified_at_ms: verifiedAt,
    error_message: errorMessage,
    sha_verified: shaVerified,
  };
}

export interface RollbackPropagationVerification {
  readonly rollback_id: string;
  readonly model_name: string;
  /** The version the rollback targeted */
  readonly expected_version: string;
  readonly expected_artifact_sha: string | null;
  /** The version currently active after rollback */
  readonly actual_version: string | null;
  readonly actual_artifact_sha: string | null;
  /** True when actual_version matches expected_version */
  readonly propagated: boolean;
  /** Non-null when both SHAs are present; true when they match */
  readonly sha_match: boolean | null;
  readonly checked_at_ms: number;
}

export interface RollbackPropagationInput {
  readonly rollback_id: string;
  readonly model_name: string;
  readonly expected_version: string;
  readonly expected_artifact_sha?: string | null;
  readonly actual_version?: string | null;
  readonly actual_artifact_sha?: string | null;
  readonly checked_at_ms: number;
}

/**
 * Verifies that a rollback propagated to the correct version and SHA.
 *
 * Isolation guarantee: pure and deterministic. Callers persist the result
 * as append-only audit evidence.
 */
export function verifyRollbackPropagation(
  input: RollbackPropagationInput,
): RollbackPropagationVerification {
  const actualVersion = input.actual_version ?? null;
  const expectedSha = input.expected_artifact_sha ?? null;
  const actualSha = input.actual_artifact_sha ?? null;

  const propagated = actualVersion === input.expected_version;

  let shaMatch: boolean | null = null;
  if (expectedSha !== null && actualSha !== null) {
    shaMatch = expectedSha === actualSha;
  }

  return {
    rollback_id: input.rollback_id,
    model_name: input.model_name,
    expected_version: input.expected_version,
    expected_artifact_sha: expectedSha,
    actual_version: actualVersion,
    actual_artifact_sha: actualSha,
    propagated,
    sha_match: shaMatch,
    checked_at_ms: input.checked_at_ms,
  };
}
