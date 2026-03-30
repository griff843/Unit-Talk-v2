import {
  bestBetsPromotionPolicy,
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type PromotionPolicy,
  type PromotionScoreBreakdown,
  type PromotionScoreWeights,
} from '@unit-talk/contracts';

export { bestBetsPromotionPolicy, exclusiveInsightsPromotionPolicy, traderInsightsPromotionPolicy } from '@unit-talk/contracts';

export function evaluatePromotionEligibility(
  input: BoardPromotionEvaluationInput,
  policy: PromotionPolicy,
): BoardPromotionDecision {
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
): BoardPromotionDecision {
  return evaluatePromotionEligibility(input, bestBetsPromotionPolicy);
}

function calculateScore(
  input: BoardPromotionEvaluationInput,
  weights: PromotionScoreWeights,
): PromotionScoreBreakdown {
  const e = normalizeScore(input.scoreInputs.edge);
  const t = normalizeScore(input.scoreInputs.trust);
  const r = normalizeScore(input.scoreInputs.readiness);
  const u = normalizeScore(input.scoreInputs.uniqueness);
  const b = normalizeScore(input.scoreInputs.boardFit);

  return {
    edge: e * weights.edge,
    trust: t * weights.trust,
    readiness: r * weights.readiness,
    uniqueness: u * weights.uniqueness,
    boardFit: b * weights.boardFit,
    total:
      e * weights.edge +
      t * weights.trust +
      r * weights.readiness +
      u * weights.uniqueness +
      b * weights.boardFit,
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
  breakdown: PromotionScoreBreakdown;
  reasons: string[];
  suppressionReasons: string[];
  policyWeights: PromotionScoreWeights;
  status: BoardPromotionDecision['status'];
  qualified: boolean;
}): BoardPromotionDecision {
  return {
    status: input.status,
    target: input.qualified ? input.input.target : undefined,
    qualified: input.qualified,
    score: input.breakdown.total,
    breakdown: input.breakdown,
    explanation: {
      target: input.input.target,
      reasons: input.reasons,
      suppressionReasons: input.suppressionReasons,
      weights: input.policyWeights,
    },
    version: input.version,
    decidedAt: input.decidedAt,
    decidedBy: input.decidedBy,
  };
}
