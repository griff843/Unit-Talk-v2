import {
  bestBetsPromotionPolicy,
  type ApprovalStatus,
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
  type PromotionDecisionSnapshot,
  type PromotionPolicy,
  type PromotionScoreBreakdown,
  type PromotionScoreWeights,
} from '@unit-talk/contracts';
import { applyPromotionModifiers, type ScoreProvenance } from './scoring/promotion-weight-profiles.js';

export { bestBetsPromotionPolicy, exclusiveInsightsPromotionPolicy, traderInsightsPromotionPolicy } from '@unit-talk/contracts';
export type { ScoreProvenance, MarketFamily, PromotionWeightModifiers } from './scoring/promotion-weight-profiles.js';
export {
  MARKET_FAMILY_PROMOTION_MODIFIERS,
  SUPPORTED_SPORTS,
  UNSUPPORTED_SPORT_SCORE_CAP,
  classifyMarketFamily,
  isSupportedSport,
} from './scoring/promotion-weight-profiles.js';

/**
 * Extended promotion decision that includes score provenance tracking.
 * Returned by evaluatePromotionEligibilityWithProvenance().
 */
export interface BoardPromotionDecisionWithProvenance extends BoardPromotionDecision {
  scoreProvenance: ScoreProvenance;
}

export function evaluatePromotionEligibility(
  input: BoardPromotionEvaluationInput,
  policy: PromotionPolicy,
): BoardPromotionDecisionWithProvenance {
  const decidedAt = input.decidedAt ?? new Date().toISOString();
  const decidedBy = input.decidedBy ?? 'system';
  const version = input.version ?? policy.version;
  const suppressionReasons: string[] = [];
  const reasons: string[] = [];

  if (input.override?.suppress) {
    suppressionReasons.push(input.override.reason ?? `operator suppressed from ${policy.target}`);
  }
  if (input.approvalStatus !== 'approved') {
    suppressionReasons.push(`approval status is ${input.approvalStatus}, not approved`);
  }
  if (!input.hasRequiredFields) {
    suppressionReasons.push('required canonical fields are missing');
  }
  if (input.isStale) {
    suppressionReasons.push('pick is stale');
  }
  if (!input.withinPostingWindow) {
    suppressionReasons.push('pick is outside the posting window');
  }
  if (!input.marketStillValid) {
    suppressionReasons.push('market or price is no longer actionable');
  }
  if (input.riskBlocked) {
    suppressionReasons.push('pick is blocked by operator or risk rule');
  }
  if (input.boardState.duplicateCount > 0) {
    suppressionReasons.push('duplicate or near-duplicate board exposure exists');
  }
  if (input.boardState.currentBoardCount >= input.boardCaps.perSlate) {
    suppressionReasons.push('board cap for the slate has been reached');
  }
  if (input.boardState.sameSportCount >= input.boardCaps.perSport) {
    suppressionReasons.push('board cap for the sport has been reached');
  }
  if (input.boardState.sameGameCount >= input.boardCaps.perGame) {
    suppressionReasons.push('board cap for the game or thesis cluster has been reached');
  }
  if (
    input.confidenceFloor !== undefined &&
    (input.pick.confidence ?? 0) < input.confidenceFloor
  ) {
    suppressionReasons.push(`pick confidence is below the ${policy.target} floor`);
  }

  const breakdown = calculateScore(input, policy.weights);
  const edgeScore = normalizeScore(input.scoreInputs.edge);
  const trustScore = normalizeScore(input.scoreInputs.trust);

  if (edgeScore < policy.minimumEdge) {
    suppressionReasons.push(
      `edge score ${edgeScore.toFixed(2)} is below threshold ${policy.minimumEdge.toFixed(2)}`,
    );
  }
  if (trustScore < policy.minimumTrust) {
    suppressionReasons.push(
      `trust score ${trustScore.toFixed(2)} is below threshold ${policy.minimumTrust.toFixed(2)}`,
    );
  }

  if (suppressionReasons.length > 0 && !input.override?.forcePromote) {
    return buildDecision({
      input,
      decidedAt,
      decidedBy,
      version,
      breakdown,
      reasons,
      suppressionReasons,
      policyWeights: policy.weights,
      status: input.isStale || input.approvalStatus === 'expired' ? 'expired' : 'not_eligible',
      qualified: false,
    });
  }

  reasons.push('hard eligibility checks passed');

  if (input.override?.forcePromote) {
    reasons.push(input.override.reason ?? `operator force-promoted to ${policy.target}`);
    return buildDecision({
      input,
      decidedAt,
      decidedBy,
      version,
      breakdown,
      reasons,
      suppressionReasons,
      policyWeights: policy.weights,
      status: 'qualified',
      qualified: true,
    });
  }

  if (breakdown.total < policy.minimumScore) {
    suppressionReasons.push(
      `promotion score ${breakdown.total.toFixed(2)} is below threshold ${policy.minimumScore.toFixed(2)}`,
    );
    return buildDecision({
      input,
      decidedAt,
      decidedBy,
      version,
      breakdown,
      reasons,
      suppressionReasons,
      policyWeights: policy.weights,
      status: 'suppressed',
      qualified: false,
    });
  }

  reasons.push(
    `promotion score ${breakdown.total.toFixed(2)} meets threshold ${policy.minimumScore.toFixed(2)}`,
  );

  return buildDecision({
    input,
    decidedAt,
    decidedBy,
    version,
    breakdown,
    reasons,
    suppressionReasons,
    policyWeights: policy.weights,
    status: 'qualified',
    qualified: true,
  });
}

export function evaluateBestBetsPromotion(
  input: BoardPromotionEvaluationInput,
): BoardPromotionDecisionWithProvenance {
  return evaluatePromotionEligibility(input, bestBetsPromotionPolicy);
}

interface PromotionScoreBreakdownWithProvenance extends PromotionScoreBreakdown {
  provenance: ScoreProvenance;
}

function calculateScore(
  input: BoardPromotionEvaluationInput,
  weights: PromotionScoreWeights,
): PromotionScoreBreakdownWithProvenance {
  const e = normalizeScore(input.scoreInputs.edge);
  const t = normalizeScore(input.scoreInputs.trust);
  const r = normalizeScore(input.scoreInputs.readiness);
  const u = normalizeScore(input.scoreInputs.uniqueness);
  const b = normalizeScore(input.scoreInputs.boardFit);

  const weighted = {
    edge: e * weights.edge,
    trust: t * weights.trust,
    readiness: r * weights.readiness,
    uniqueness: u * weights.uniqueness,
    boardFit: b * weights.boardFit,
  };

  const market = input.pick.market ?? '';
  const sport =
    input.pick.metadata &&
    typeof input.pick.metadata['sport'] === 'string'
      ? input.pick.metadata['sport']
      : null;

  // When market context is absent (e.g., historical replay snapshots written before UTV2-623
  // introduced market-family modifiers), skip modifiers entirely to preserve deterministic
  // replay of pre-modifier decisions.
  if (!market) {
    const rawTotal = weighted.edge + weighted.trust + weighted.readiness + weighted.uniqueness + weighted.boardFit;
    return {
      edge: weighted.edge,
      trust: weighted.trust,
      readiness: weighted.readiness,
      uniqueness: weighted.uniqueness,
      boardFit: weighted.boardFit,
      total: rawTotal,
      provenance: {
        marketFamily: 'unknown',
        sport: sport ?? '',
        modifiersApplied: false,
        unsupportedSlice: false,
        capApplied: false,
        capValue: null,
      },
    };
  }

  const modified = applyPromotionModifiers(weighted, market, sport);

  return {
    edge: modified.edge,
    trust: modified.trust,
    readiness: modified.readiness,
    uniqueness: modified.uniqueness,
    boardFit: modified.boardFit,
    total: modified.total,
    provenance: modified.provenance,
  };
}

function normalizeScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function buildDecision(input: {
  input: BoardPromotionEvaluationInput;
  decidedAt: string;
  decidedBy: string;
  version: string;
  breakdown: PromotionScoreBreakdownWithProvenance;
  reasons: string[];
  suppressionReasons: string[];
  policyWeights: PromotionScoreWeights;
  status: BoardPromotionDecision['status'];
  qualified: boolean;
}): BoardPromotionDecisionWithProvenance {
  // Extract provenance from the extended breakdown but strip it from the
  // contracts-typed breakdown field to keep the breakdown shape conformant.
  const { provenance, ...coreBreakdown } = input.breakdown;
  return {
    status: input.status,
    target: input.qualified ? input.input.target : undefined,
    qualified: input.qualified,
    score: input.breakdown.total,
    breakdown: coreBreakdown,
    explanation: {
      target: input.input.target,
      reasons: input.reasons,
      suppressionReasons: input.suppressionReasons,
      weights: input.policyWeights,
    },
    version: input.version,
    decidedAt: input.decidedAt,
    decidedBy: input.decidedBy,
    scoreProvenance: provenance,
  };
}

/**
 * Deterministically reproduces a promotion decision from a stored snapshot.
 *
 * Given the same snapshot and the same policy, this function produces the same
 * BoardPromotionDecision that was recorded at decision time. Useful for:
 * - Auditing: verify that a stored decision was computed correctly
 * - Counterfactuals: "what would the decision have been under policy X?"
 * - Regression testing: ensure scoring changes do not silently alter past decisions
 *
 * @param snapshot  - The PromotionDecisionSnapshot stored in pick_promotion_history.metadata
 * @param policy    - The PromotionPolicy to evaluate against
 * @param decidedAt - ISO timestamp for the replay (pass stored decidedAt for exact match)
 */
export function replayPromotion(
  snapshot: PromotionDecisionSnapshot,
  policy: PromotionPolicy,
  decidedAt?: string,
): BoardPromotionDecisionWithProvenance {
  const input: BoardPromotionEvaluationInput = {
    target: policy.target,
    pick: {
      confidence: snapshot.gateInputs.pickConfidence ?? undefined,
    } as CanonicalPick,
    approvalStatus: snapshot.gateInputs.approvalStatus as ApprovalStatus,
    hasRequiredFields: snapshot.gateInputs.hasRequiredFields,
    isStale: snapshot.gateInputs.isStale,
    withinPostingWindow: snapshot.gateInputs.withinPostingWindow,
    marketStillValid: snapshot.gateInputs.marketStillValid,
    riskBlocked: snapshot.gateInputs.riskBlocked,
    scoreInputs: snapshot.scoreInputs,
    minimumScore: policy.minimumScore,
    confidenceFloor: snapshot.gateInputs.confidenceFloor ?? undefined,
    boardCaps: policy.boardCaps,
    boardState: snapshot.boardStateAtDecision,
    override: snapshot.override,
    decidedAt: decidedAt ?? new Date().toISOString(),
    decidedBy: 'replay',
    version: snapshot.policyVersion,
  };

  return evaluatePromotionEligibility(input, policy);
}
