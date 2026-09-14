export const settlementStatuses = ['settled', 'manual_review'] as const;
export const settlementResults = ['win', 'loss', 'push', 'void', 'cancelled'] as const;
export const settlementSources = ['operator', 'api', 'feed', 'grading'] as const;
export const settlementConfidences = ['confirmed', 'estimated', 'pending'] as const;

export type SettlementStatus = (typeof settlementStatuses)[number];
export type SettlementResult = (typeof settlementResults)[number];
export type SettlementSource = (typeof settlementSources)[number];
export type SettlementConfidence = (typeof settlementConfidences)[number];

/**
 * What an operator attests to when settling an evidence-plane pick by hand.
 *
 * The automatic path's `gradingContext` carries `{actualValue, marketKey,
 * eventId, gameResultId}` — four references into rows the grading pass resolved.
 * A manual settlement has none of them: every production Track Only pick carries
 * `eventId: null` and no `game_results` row exists to point at. Widening
 * `gradingContext` to make those fields optional would let an automatic
 * settlement be written with its provenance silently absent, so this is a
 * separate shape rather than a loosened one.
 *
 * Every field is required. There is no default and no inference: an operator
 * settlement that cannot say where the outcome came from is refused.
 */
export interface OperatorGradingContext {
  /** How the operator determined the outcome, in their own words. */
  outcomeBasis: string;
  /** Where a reader can independently check it — a box score, a league page. */
  resultSourceUrl: string;
  /** ISO-8601 instant at which the operator observed the result. */
  observedAt: string;
}

export interface SettlementRequest {
  status: SettlementStatus;
  result?: SettlementResult | undefined;
  source: SettlementSource;
  confidence: SettlementConfidence;
  evidenceRef: string;
  notes?: string | undefined;
  reviewReason?: string | undefined;
  settledBy: string;
  /**
   * Required when the target pick is on the evidence plane, and meaningless
   * otherwise. Optional here because `SettlementRequest` is shared with the
   * `posted`/`settled` paths, which resolve provenance from the pick's own
   * delivery history. The evidence-plane dispatch enforces its presence.
   */
  operatorGradingContext?: OperatorGradingContext | undefined;
}

export interface SettlementValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSettlementRequest(
  request: SettlementRequest,
): SettlementValidationResult {
  const errors: string[] = [];

  if (!settlementStatuses.includes(request.status)) {
    errors.push(`status must be one of: ${settlementStatuses.join(', ')}`);
  }

  if (!settlementSources.includes(request.source)) {
    errors.push(`source must be one of: ${settlementSources.join(', ')}`);
  }

  if (!settlementConfidences.includes(request.confidence)) {
    errors.push(`confidence must be one of: ${settlementConfidences.join(', ')}`);
  }

  if (!request.evidenceRef.trim()) {
    errors.push('evidenceRef is required');
  }

  if (!request.settledBy.trim()) {
    errors.push('settledBy is required');
  }

  if (request.status === 'settled') {
    if (!request.result || !settlementResults.includes(request.result)) {
      errors.push(`result must be one of: ${settlementResults.join(', ')}`);
    }
  }

  if (request.status === 'manual_review') {
    if (request.result !== undefined) {
      errors.push('manual_review requests must not include a result');
    }
    if (!request.reviewReason?.trim()) {
      errors.push('reviewReason is required for manual_review');
    }
  }

  // Validated when present, never required here: whether it is required depends
  // on the *pick*, which this function cannot see. A malformed context must not
  // reach the settlement path as a well-formed one, so it is checked either way.
  if (request.operatorGradingContext !== undefined) {
    errors.push(...validateOperatorGradingContext(request.operatorGradingContext));
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Fail closed on an operator grading context. Returns the errors rather than a
 * boolean so the settlement path can name which field was missing — an operator
 * told only "invalid context" retries blind.
 */
export function validateOperatorGradingContext(
  context: OperatorGradingContext,
): string[] {
  const errors: string[] = [];

  if (typeof context.outcomeBasis !== 'string' || !context.outcomeBasis.trim()) {
    errors.push('operatorGradingContext.outcomeBasis is required');
  }

  if (
    typeof context.resultSourceUrl !== 'string' ||
    !context.resultSourceUrl.trim()
  ) {
    errors.push('operatorGradingContext.resultSourceUrl is required');
  }

  if (typeof context.observedAt !== 'string' || !context.observedAt.trim()) {
    errors.push('operatorGradingContext.observedAt is required');
  } else if (Number.isNaN(Date.parse(context.observedAt))) {
    errors.push('operatorGradingContext.observedAt must be an ISO-8601 instant');
  }

  return errors;
}
