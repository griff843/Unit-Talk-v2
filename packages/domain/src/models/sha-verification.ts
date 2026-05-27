/**
 * SHA Verification at Inference — INIT-3.2.2
 *
 * Pure domain function verifying that the model artifact SHA observed at
 * inference time matches the SHA recorded at registration.
 *
 * Contract:
 *  - Fail-open: if no expected SHA is recorded (null/undefined), the
 *    verification passes. This prevents inference from halting on models
 *    registered before artifact_sha was introduced.
 *  - Deterministic: same inputs always produce the same result.
 *  - No I/O, no DB, no env reads. Caller records the ShaVerificationResult
 *    as append-only audit evidence.
 */

export type ShaVerificationStatus = 'verified' | 'mismatch' | 'unverifiable';

export interface ShaVerificationResult {
  readonly status: ShaVerificationStatus;
  readonly model_name: string;
  readonly model_version: string;
  readonly expected_sha: string | null;
  readonly observed_sha: string | null;
  readonly verified_at_ms: number;
}

export interface ShaVerificationInput {
  readonly model_name: string;
  readonly model_version: string;
  /** SHA recorded at model registration time. Null = registered before UTV2-1116. */
  readonly expected_sha: string | null | undefined;
  /** SHA of the artifact observed at inference call time. */
  readonly observed_sha: string | null | undefined;
  /** Caller-supplied timestamp (Date.now()) for replay reproducibility. */
  readonly verified_at_ms: number;
}

/**
 * Verifies that the observed artifact SHA matches the registered SHA.
 *
 * Returns `unverifiable` (fail-open) when no expected SHA is on record,
 * allowing inference to proceed for legacy model registrations.
 */
export function verifyShaAtInference(input: ShaVerificationInput): ShaVerificationResult {
  const expected = input.expected_sha ?? null;
  const observed = input.observed_sha ?? null;

  const base: Omit<ShaVerificationResult, 'status'> = {
    model_name: input.model_name,
    model_version: input.model_version,
    expected_sha: expected,
    observed_sha: observed,
    verified_at_ms: input.verified_at_ms,
  };

  if (expected === null) {
    return { ...base, status: 'unverifiable' };
  }

  if (observed === null || observed !== expected) {
    return { ...base, status: 'mismatch' };
  }

  return { ...base, status: 'verified' };
}
