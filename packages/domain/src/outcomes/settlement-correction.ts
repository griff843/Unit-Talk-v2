/**
 * Settlement Correction — dual-authorized correction model.
 *
 * Pure computation: no I/O, no DB, no HTTP, no env.
 * Invariant: corrections require two distinct authorizers and full lineage.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DualAuthorization {
  readonly authorizer_1: string;
  readonly authorizer_2: string;
  readonly justification: string;
}

export interface SettlementCorrectionInput {
  readonly prior_record_id: string;
  readonly pick_id: string;
  readonly result: string | null;
  readonly source: string;
  readonly confidence: string;
  readonly evidence_ref: string;
  readonly notes?: string | null;
  readonly settled_by: string;
  readonly settled_at: string;
  readonly authorization: DualAuthorization;
}

export interface SettlementCorrectionRecord {
  readonly id: string;
  readonly settlement_record_id: string;
  readonly prior_record_id: string;
  readonly authorizer_1: string;
  readonly authorizer_2: string;
  readonly justification: string;
  readonly correction_at: string;
  readonly audit_event_id: string | null;
}

export type DualAuthValidationResult =
  | { ok: true }
  | { ok: false; errors: readonly string[] };

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate dual authorization. Fail-closed: all invariants must hold.
 */
export function validateDualAuthorization(
  auth: DualAuthorization,
): DualAuthValidationResult {
  const errors: string[] = [];

  if (!auth.authorizer_1 || auth.authorizer_1.trim() === '') {
    errors.push('DUAL_AUTH_MISSING_AUTHORIZER_1');
  }
  if (!auth.authorizer_2 || auth.authorizer_2.trim() === '') {
    errors.push('DUAL_AUTH_MISSING_AUTHORIZER_2');
  }
  if (
    auth.authorizer_1.trim() !== '' &&
    auth.authorizer_2.trim() !== '' &&
    auth.authorizer_1.trim() === auth.authorizer_2.trim()
  ) {
    errors.push('DUAL_AUTH_SAME_IDENTITY: authorizer_1 and authorizer_2 must be distinct');
  }
  if (!auth.justification || auth.justification.trim() === '') {
    errors.push('DUAL_AUTH_MISSING_JUSTIFICATION');
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateSettlementCorrectionInput(
  input: SettlementCorrectionInput,
): DualAuthValidationResult {
  const errors: string[] = [];

  if (!input.prior_record_id || input.prior_record_id.trim() === '') {
    errors.push('CORRECTION_MISSING_PRIOR_RECORD_ID');
  }
  if (!input.pick_id || input.pick_id.trim() === '') {
    errors.push('CORRECTION_MISSING_PICK_ID');
  }

  const authResult = validateDualAuthorization(input.authorization);
  if (!authResult.ok) {
    errors.push(...authResult.errors);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Build a correction lineage description for audit.
 * Pure — derives a human-readable lineage string from the correction inputs.
 */
export function buildCorrectionLineage(
  input: SettlementCorrectionInput,
  newRecordId: string,
): string {
  return JSON.stringify({
    correction_id: newRecordId,
    prior_record_id: input.prior_record_id,
    pick_id: input.pick_id,
    authorizer_1: input.authorization.authorizer_1,
    authorizer_2: input.authorization.authorizer_2,
    justification: input.authorization.justification,
    corrected_at: input.settled_at,
  });
}
