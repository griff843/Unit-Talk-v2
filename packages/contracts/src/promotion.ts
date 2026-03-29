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

/**
 * Full input snapshot written to pick_promotion_history.metadata at decision time.
 * Given this snapshot and the policy thresholds, the decision can be deterministically reproduced.
 */
export interface PromotionDecisionSnapshot {
  scoringProfile: string;
  policyVersion: string;
  scoreInputs: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };
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
  boardStateAtDecision: {
    currentBoardCount: number;
    sameSportCount: number;
    sameGameCount: number;
    duplicateCount: number;
  };
  weightsUsed: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };
  override?: {
    forcePromote?: boolean;
    suppress?: boolean;
    reason?: string;
  };
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

// ---------------------------------------------------------------------------
// Target Registry (UTV2-129)
// ---------------------------------------------------------------------------

export interface TargetRegistryEntry {
  target: PromotionTarget;
  /** Whether delivery to this target is permitted. false = skip without failing. */
  enabled: boolean;
  /** Human-readable reason if disabled. For operator surface / logs. */
  disabledReason?: string | undefined;
}

/**
 * Canonical target registry — the V2 source of truth for which targets are
 * permitted to receive live deliveries.
 *
 * Enabled/disabled state is the runtime equivalent of the "Live / Blocked"
 * table in CLAUDE.md. This registry makes that gate machine-enforceable.
 *
 * Override at startup via UNIT_TALK_ENABLED_TARGETS env var.
 * Disabled targets are skipped by the distribution worker — outbox rows
 * for a disabled target are left in 'pending' status and not failed.
 */
export const defaultTargetRegistry: TargetRegistryEntry[] = [
  {
    target: 'best-bets',
    enabled: true,
  },
  {
    target: 'trader-insights',
    enabled: true,
  },
  {
    target: 'exclusive-insights',
    enabled: false,
    disabledReason:
      'Activation contract required before live delivery (see T1_EXCLUSIVE_INSIGHTS_ACTIVATION_CONTRACT.md)',
  },
];

/**
 * Returns the effective registry, applying UNIT_TALK_ENABLED_TARGETS override if set.
 *
 * UNIT_TALK_ENABLED_TARGETS is a comma-separated list of explicitly enabled targets.
 * Targets NOT in the list are disabled, regardless of defaultTargetRegistry.
 *
 * If the env var is absent, defaultTargetRegistry is used as-is.
 */
export function resolveTargetRegistry(
  env: { UNIT_TALK_ENABLED_TARGETS?: string | undefined } = process.env,
): TargetRegistryEntry[] {
  const raw = env.UNIT_TALK_ENABLED_TARGETS?.trim();
  if (!raw) {
    return defaultTargetRegistry;
  }

  const explicitlyEnabled = new Set(
    raw.split(',').map((t) => t.trim()).filter(Boolean),
  );

  return promotionTargets.map((target) => ({
    target,
    enabled: explicitlyEnabled.has(target),
    disabledReason: explicitlyEnabled.has(target)
      ? undefined
      : 'Not in UNIT_TALK_ENABLED_TARGETS',
  }));
}

export function isTargetEnabled(
  target: string,
  registry: TargetRegistryEntry[],
): boolean {
  const entry = registry.find((e) => e.target === target);
  // If target is not in the registry, it is not a governed promotion target — allow it.
  return entry?.enabled ?? true;
}
