export const settlementStatuses = ['settled', 'manual_review'] as const;
export const settlementResults = ['win', 'loss', 'push', 'void', 'cancelled'] as const;
export const settlementSources = ['operator', 'api', 'feed', 'grading'] as const;
export const settlementConfidences = ['confirmed', 'estimated', 'pending'] as const;

export type SettlementStatus = (typeof settlementStatuses)[number];
export type SettlementResult = (typeof settlementResults)[number];
export type SettlementSource = (typeof settlementSources)[number];
export type SettlementConfidence = (typeof settlementConfidences)[number];

export interface SettlementRequest {
  status: SettlementStatus;
  result?: SettlementResult | undefined;
  source: SettlementSource;
  confidence: SettlementConfidence;
  evidenceRef: string;
  notes?: string | undefined;
  reviewReason?: string | undefined;
  settledBy: string;
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

  return {
    ok: errors.length === 0,
    errors,
  };
}
