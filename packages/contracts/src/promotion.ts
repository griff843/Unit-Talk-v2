import type { CanonicalPick } from './picks.js';

export const promotionTargets = [
  'best-bets',
  'trader-insights',
  'exclusive-insights',
] as const;
export type PromotionTarget = (typeof promotionTargets)[number];

export const approvalStatuses = [
  'pending',
  'approved',
  'rejected',
  'voided',
  'expired',
] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const promotionStatuses = [
  'not_eligible',
  'eligible',
  'qualified',
  'promoted',
  'suppressed',
  'expired',
] as const;
export type PromotionStatus = (typeof promotionStatuses)[number];

export const promotionOverrideActions = [
  'force_promote',
  'suppress',
  'suppress_from_best_bets',
] as const;
export type PromotionOverrideAction = (typeof promotionOverrideActions)[number];

export interface PromotionScoreWeights {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
}

export interface PromotionScoreInputs {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
}

export interface PromotionBoardCaps {
  perSlate: number;
  perSport: number;
  perGame: number;
}

export interface PromotionBoardState {
  currentBoardCount: number;
  sameSportCount: number;
  sameGameCount: number;
  duplicateCount: number;
}

export interface PromotionOverrideState {
  forcePromote?: boolean | undefined;
  suppress?: boolean | undefined;
  reason?: string | undefined;
}

export interface PromotionPolicy {
  target: PromotionTarget;
  minimumScore: number;
  minimumEdge: number;
  minimumTrust: number;
  confidenceFloor?: number | undefined;
  boardCaps: PromotionBoardCaps;
  weights: PromotionScoreWeights;
  version: string;
}

export interface BoardPromotionEvaluationInput {
  target: PromotionTarget;
  pick: CanonicalPick;
  approvalStatus: ApprovalStatus;
  hasRequiredFields: boolean;
  isStale: boolean;
  withinPostingWindow: boolean;
  marketStillValid: boolean;
  riskBlocked: boolean;
  scoreInputs: PromotionScoreInputs;
  minimumScore: number;
  confidenceFloor?: number | undefined;
  boardCaps: PromotionBoardCaps;
  boardState: PromotionBoardState;
  override?: PromotionOverrideState | undefined;
  decidedAt?: string | undefined;
  decidedBy?: string | undefined;
  version?: string | undefined;
}

export interface PromotionScoreBreakdown {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
  total: number;
}

export interface PromotionExplanationPayload {
  target: PromotionTarget;
  reasons: string[];
  suppressionReasons: string[];
  weights: PromotionScoreWeights;
}

export interface BoardPromotionDecision {
  status: PromotionStatus;
  target?: PromotionTarget | undefined;
  qualified: boolean;
  score: number;
  breakdown: PromotionScoreBreakdown;
  explanation: PromotionExplanationPayload;
  version: string;
  decidedAt: string;
  decidedBy: string;
}

export const bestBetsScoreWeights: PromotionScoreWeights = {
  edge: 0.35,
  trust: 0.25,
  readiness: 0.2,
  uniqueness: 0.1,
  boardFit: 0.1,
};

export const bestBetsPromotionPolicy: PromotionPolicy = {
  target: 'best-bets',
  minimumScore: 70,
  minimumEdge: 0,
  minimumTrust: 0,
  confidenceFloor: 0.6,
  boardCaps: {
    perSlate: 5,
    perSport: 3,
    perGame: 1,
  },
  weights: bestBetsScoreWeights,
  version: 'best-bets-v1',
};

export const traderInsightsPromotionPolicy: PromotionPolicy = {
  target: 'trader-insights',
  minimumScore: 80,
  minimumEdge: 85,
  minimumTrust: 85,
  confidenceFloor: 0.6,
  boardCaps: {
    perSlate: 5,
    perSport: 3,
    perGame: 1,
  },
  weights: {
    edge: 0.40,
    trust: 0.30,
    readiness: 0.15,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'trader-insights-v1',
};

export const exclusiveInsightsPromotionPolicy: PromotionPolicy = {
  target: 'exclusive-insights',
  minimumScore: 90,
  minimumEdge: 90,
  minimumTrust: 88,
  confidenceFloor: 0.6,
  boardCaps: {
    perSlate: 5,
    perSport: 3,
    perGame: 1,
  },
  weights: {
    edge: 0.45,
    trust: 0.30,
    readiness: 0.10,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'exclusive-insights-v1',
};

/**
 * A named scoring profile: a set of promotion policies (one per target) selectable
 * at runtime via UNIT_TALK_SCORING_PROFILE env var. Profiles allow weight
 * experimentation without code deploys.
 */
export interface ScoringProfile {
  /** Unique identifier written to pick_promotion_history metadata.scoringProfile */
  name: string;
  description: string;
  policies: {
    'best-bets': PromotionPolicy;
    'trader-insights': PromotionPolicy;
    'exclusive-insights': PromotionPolicy;
  };
}

export const defaultScoringProfile: ScoringProfile = {
  name: 'default',
  description: 'Production baseline weights (best-bets-v1, trader-insights-v1, exclusive-insights-v1)',
  policies: {
    'best-bets': bestBetsPromotionPolicy,
    'trader-insights': traderInsightsPromotionPolicy,
    'exclusive-insights': exclusiveInsightsPromotionPolicy,
  },
};

export const conservativeScoringProfile: ScoringProfile = {
  name: 'conservative',
  description: 'Edge-weighted variant: edge +5%, trust -5% across all targets',
  policies: {
    'best-bets': {
      ...bestBetsPromotionPolicy,
      weights: { edge: 0.40, trust: 0.20, readiness: 0.20, uniqueness: 0.10, boardFit: 0.10 },
      version: 'best-bets-conservative-v1',
    },
    'trader-insights': {
      ...traderInsightsPromotionPolicy,
      weights: { edge: 0.45, trust: 0.25, readiness: 0.15, uniqueness: 0.10, boardFit: 0.05 },
      version: 'trader-insights-conservative-v1',
    },
    'exclusive-insights': {
      ...exclusiveInsightsPromotionPolicy,
      weights: { edge: 0.50, trust: 0.25, readiness: 0.10, uniqueness: 0.10, boardFit: 0.05 },
      version: 'exclusive-insights-conservative-v1',
    },
  },
};

export const scoringProfiles: Record<string, ScoringProfile> = {
  default: defaultScoringProfile,
  conservative: conservativeScoringProfile,
};

export function resolveScoringProfile(name: string | undefined): ScoringProfile {
  const key = name ?? 'default';
  const profile = scoringProfiles[key];
  if (!profile) {
    throw new Error(
      `Unknown scoring profile "${key}". Available: ${Object.keys(scoringProfiles).join(', ')}`,
    );
  }
  return profile;
}
