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
 * A named scoring profile is a set of promotion policies (one per target)
 * that can be selected at runtime via env var. Profiles allow weight
 * experimentation without code deploys.
 *
 * All three canonical targets must be present in every profile.
 * Missing targets would silently disable promotion for that lane.
 */
export interface ScoringProfile {
  /** Unique identifier written to pick_promotion_history.metadata.scoringProfile */
  name: string;
  description: string;
  policies: {
    'best-bets': PromotionPolicy;
    'trader-insights': PromotionPolicy;
    'exclusive-insights': PromotionPolicy;
  };
}

/**
 * Default profile -- current production weights.
 * This is the baseline; all experiments are deltas from this.
 */
export const defaultScoringProfile: ScoringProfile = {
  name: 'default',
  description: 'Production baseline weights (best-bets-v1, trader-insights-v1, exclusive-insights-v1)',
  policies: {
    'best-bets': bestBetsPromotionPolicy,
    'trader-insights': traderInsightsPromotionPolicy,
    'exclusive-insights': exclusiveInsightsPromotionPolicy,
  },
};

/**
 * Conservative profile -- higher edge weight, lower trust weight.
 * Use when you want to prioritize pure mathematical edge over capper trust signals.
 */
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
      `Unknown scoring profile "${key}". Available: ${Object.keys(scoringProfiles).join(", ")}`,
    );
  }
  return profile;
}

/**
 * Complete snapshot of all inputs that determined a promotion decision.
 * Stored in pick_promotion_history.metadata at decision time.
 * Given this snapshot and the policy thresholds, the original decision can be
 * deterministically reproduced by replayPromotion() in @unit-talk/domain.
 */
export interface PromotionDecisionSnapshot {
  /** Scoring profile name used at decision time (from UTV2-136). */
  scoringProfile: string;
  /** Policy version used at decision time (e.g. 'best-bets-v1'). */
  policyVersion: string;

  /** Raw 0–100 score component inputs before weighting. */
  scoreInputs: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };

  /** Gate boolean/value inputs at the moment of decision. */
  gateInputs: {
    approvalStatus: string;
    hasRequiredFields: boolean;
    isStale: boolean;
    withinPostingWindow: boolean;
    marketStillValid: boolean;
    riskBlocked: boolean;
    confidenceFloor: number | null;
    pickConfidence: number | null;
  };

  /** Board occupancy at decision time used for cap evaluation. */
  boardStateAtDecision: {
    currentBoardCount: number;
    sameSportCount: number;
    sameGameCount: number;
    duplicateCount: number;
  };

  /** Weights resolved from the active scoring profile at decision time. */
  weightsUsed: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };

  /** Override state applied at decision time, if any. */
  override?: {
    forcePromote?: boolean;
    suppress?: boolean;
    reason?: string;
  };
}

export interface TargetRegistryEntry {
  target: PromotionTarget;
  enabled: boolean;
  disabledReason?: string;
}

export const defaultTargetRegistry: TargetRegistryEntry[] = [
  { target: 'best-bets', enabled: true },
  { target: 'trader-insights', enabled: true },
  {
    target: 'exclusive-insights',
    enabled: false,
    disabledReason: 'Activation contract required before live delivery',
  },
];

export function resolveTargetRegistry(
  env: { UNIT_TALK_ENABLED_TARGETS?: string } = process.env,
): TargetRegistryEntry[] {
  const raw = env.UNIT_TALK_ENABLED_TARGETS;
  if (!raw) {
    return defaultTargetRegistry;
  }

  const explicitlyEnabled = new Set(
    raw.split(',').map((t) => t.trim()).filter(Boolean),
  );

  return promotionTargets.map((target) => ({
    target,
    enabled: explicitlyEnabled.has(target),
    ...(explicitlyEnabled.has(target)
      ? {}
      : {
          disabledReason: `Not listed in UNIT_TALK_ENABLED_TARGETS (${raw})`,
        }),
  }));
}

export function isTargetEnabled(
  target: string,
  registry: TargetRegistryEntry[],
): boolean {
  const entry = registry.find((e) => e.target === target);
  return entry?.enabled ?? false;
}
