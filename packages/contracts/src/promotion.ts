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

/**
 * Identifies the source of the edge score component in a promotion decision.
 * - 'real-edge': model probability vs Pinnacle devigged line (authoritative)
 * - 'consensus-edge': model probability vs multi-book devigged consensus
 * - 'sgo-edge': model probability vs SGO devigged line
 * - 'confidence-delta': confidence minus implied probability from submitted odds (self-reported)
 * - 'explicit': edge provided directly in pick.metadata.promotionScores.edge
 */
export const edgeSources = [
  'real-edge',
  'consensus-edge',
  'sgo-edge',
  'confidence-delta',
  'explicit',
] as const;
export type EdgeSource = (typeof edgeSources)[number];

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
    perSlate: 15,
    perSport: 10,
    perGame: 2,
  },
  weights: bestBetsScoreWeights,
  version: 'best-bets-v2',
};

export const traderInsightsPromotionPolicy: PromotionPolicy = {
  target: 'trader-insights',
  minimumScore: 80,
  minimumEdge: 85,
  minimumTrust: 85,
  confidenceFloor: 0.6,
  boardCaps: {
    perSlate: 15,
    perSport: 10,
    perGame: 2,
  },
  weights: {
    edge: 0.40,
    trust: 0.30,
    readiness: 0.15,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'trader-insights-v2',
};

export const exclusiveInsightsPromotionPolicy: PromotionPolicy = {
  target: 'exclusive-insights',
  minimumScore: 90,
  minimumEdge: 90,
  minimumTrust: 88,
  confidenceFloor: 0.6,
  boardCaps: {
    perSlate: 15,
    perSport: 10,
    perGame: 2,
  },
  weights: {
    edge: 0.45,
    trust: 0.30,
    readiness: 0.10,
    uniqueness: 0.10,
    boardFit: 0.05,
  },
  version: 'exclusive-insights-v2',
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
  /** Semantic version for auditability (e.g., '1.0.0', '1.1.0') */
  version: string;
  /** When this profile was last modified */
  lastModifiedAt: string;
  /** Why this profile exists or was changed */
  rationale: string;
  /** Reference to backtest evidence (e.g., 'out/backtest/weight_backtest_2026-04-01.json') */
  backtestRef?: string | undefined;
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
  description: 'Production baseline weights and expanded board caps for live proving',
  version: '2.1.0',
  lastModifiedAt: '2026-04-03',
  rationale: 'Sprint D intelligence plus PM-ratified board cap expansion to perSport 10, perSlate 15, perGame 2 for proving-loop throughput.',
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
  version: '1.0.0',
  lastModifiedAt: '2026-03-29',
  rationale: 'Experimental variant for edge-dominant strategy testing. Not validated by backtest.',
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
  /** Policy version used at decision time (e.g. 'best-bets-v2'). */
  policyVersion: string;

  /** Raw 0–100 score component inputs before weighting. */
  scoreInputs: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
    /**
     * Source of the edge component at decision time.
     * Absent on snapshots written before UTV2-222/223.
     */
    edgeSource?: EdgeSource | undefined;
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
  /** Percentage of picks delivered to this target (0-100). Default 100. */
  rolloutPct: number;
  /** Optional sport filter. When set, only picks with a matching sport are delivered. */
  sportFilter?: string[];
}

export const defaultTargetRegistry: TargetRegistryEntry[] = [
  { target: 'best-bets', enabled: true, rolloutPct: 100 },
  { target: 'trader-insights', enabled: true, rolloutPct: 100 },
  {
    target: 'exclusive-insights',
    enabled: false,
    disabledReason: 'Activation contract required before live delivery',
    rolloutPct: 100,
  },
];

/**
 * Rollout config override shape parsed from UNIT_TALK_ROLLOUT_CONFIG env var.
 * Example JSON: { "best-bets": { "rolloutPct": 50, "sportFilter": ["NBA","NFL"] } }
 */
export interface RolloutConfigOverride {
  rolloutPct?: number;
  sportFilter?: string[];
}

/**
 * Parse UNIT_TALK_ROLLOUT_CONFIG env var and return per-target overrides.
 * Returns an empty record when the env var is absent or unparseable.
 */
export function resolveRolloutConfig(
  env: { UNIT_TALK_ROLLOUT_CONFIG?: string } = process.env,
): Record<string, RolloutConfigOverride> {
  const raw = env.UNIT_TALK_ROLLOUT_CONFIG;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, RolloutConfigOverride> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const v = value as Record<string, unknown>;
      const override: RolloutConfigOverride = {};
      if (typeof v['rolloutPct'] === 'number') {
        override.rolloutPct = Math.max(0, Math.min(100, v['rolloutPct']));
      }
      if (Array.isArray(v['sportFilter'])) {
        override.sportFilter = (v['sportFilter'] as unknown[]).filter(
          (s): s is string => typeof s === 'string',
        );
      }
      result[key] = override;
    }
    return result;
  } catch {
    return {};
  }
}

export function resolveTargetRegistry(
  env: { UNIT_TALK_ENABLED_TARGETS?: string; UNIT_TALK_ROLLOUT_CONFIG?: string } = process.env,
): TargetRegistryEntry[] {
  const raw = env.UNIT_TALK_ENABLED_TARGETS;
  let registry: TargetRegistryEntry[];

  if (!raw) {
    registry = defaultTargetRegistry.map((entry) => ({ ...entry }));
  } else {
    const explicitlyEnabled = new Set(
      raw.split(',').map((t) => t.trim()).filter(Boolean),
    );

    registry = promotionTargets.map((target) => ({
      target,
      enabled: explicitlyEnabled.has(target),
      rolloutPct: 100,
      ...(explicitlyEnabled.has(target)
        ? {}
        : {
            disabledReason: `Not listed in UNIT_TALK_ENABLED_TARGETS (${raw})`,
          }),
    }));
  }

  // Merge rollout config overrides
  const rolloutConfig = resolveRolloutConfig(env);
  for (const entry of registry) {
    const override = rolloutConfig[entry.target];
    if (!override) continue;
    if (override.rolloutPct !== undefined) {
      entry.rolloutPct = override.rolloutPct;
    }
    if (override.sportFilter !== undefined) {
      entry.sportFilter = override.sportFilter;
    }
  }

  return registry;
}

export function isTargetEnabled(
  target: string,
  registry: TargetRegistryEntry[],
): boolean {
  const entry = registry.find((e) => e.target === target);
  return entry?.enabled ?? false;
}

/**
 * Deterministic FNV-1a 32-bit hash. Same input always produces same output.
 */
export function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
}

// ─── Exposure Gate ────────────────────────────────────────────────────────────

export interface ExposureGateConfig {
  /** Maximum open picks (validated/queued/posted) from the same submitter on the same event. */
  maxPicksPerGame: number;
  /** Maximum open picks from the same submitter today. */
  maxPicksPerDay: number;
  /** Whether the exposure gate is enabled. */
  enabled: boolean;
}

export const defaultExposureGateConfig: ExposureGateConfig = {
  maxPicksPerGame: 3,
  maxPicksPerDay: 15,
  enabled: true,
};

/**
 * Resolve exposure gate config from UNIT_TALK_EXPOSURE_GATE_CONFIG env var (JSON)
 * or return defaults. Malformed JSON silently falls back to defaults.
 */
export function resolveExposureGateConfig(
  env: { UNIT_TALK_EXPOSURE_GATE_CONFIG?: string } = process.env,
): ExposureGateConfig {
  const raw = env.UNIT_TALK_EXPOSURE_GATE_CONFIG;
  if (!raw) return { ...defaultExposureGateConfig };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...defaultExposureGateConfig };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      maxPicksPerGame:
        typeof obj['maxPicksPerGame'] === 'number' && Number.isFinite(obj['maxPicksPerGame'])
          ? obj['maxPicksPerGame']
          : defaultExposureGateConfig.maxPicksPerGame,
      maxPicksPerDay:
        typeof obj['maxPicksPerDay'] === 'number' && Number.isFinite(obj['maxPicksPerDay'])
          ? obj['maxPicksPerDay']
          : defaultExposureGateConfig.maxPicksPerDay,
      enabled:
        typeof obj['enabled'] === 'boolean'
          ? obj['enabled']
          : defaultExposureGateConfig.enabled,
    };
  } catch {
    return { ...defaultExposureGateConfig };
  }
}

export type ExposureGateRejectionReason = 'exposure-game-limit' | 'exposure-daily-limit';

export type RolloutSkipReason = 'rollout-pct' | 'sport-filter';

export interface RolloutCheckResult {
  allowed: boolean;
  skipReason?: RolloutSkipReason;
}

/**
 * Check whether a pick should be delivered to a target based on rollout controls.
 * @param pickId - The pick ID
 * @param target - The target name (e.g. 'best-bets')
 * @param pickSport - The sport from the pick metadata (may be null/undefined)
 * @param registry - The resolved target registry
 */
export function checkRolloutControls(
  pickId: string,
  target: string,
  pickSport: string | null | undefined,
  registry: TargetRegistryEntry[],
): RolloutCheckResult {
  const entry = registry.find((e) => e.target === target);
  if (!entry) return { allowed: true };

  // Sport filter check
  if (entry.sportFilter && entry.sportFilter.length > 0) {
    if (!pickSport || !entry.sportFilter.includes(pickSport)) {
      return { allowed: false, skipReason: 'sport-filter' };
    }
  }

  // Rollout percentage check
  if (entry.rolloutPct <= 0) {
    return { allowed: false, skipReason: 'rollout-pct' };
  }
  if (entry.rolloutPct >= 100) {
    return { allowed: true };
  }

  const bucket = fnv1aHash(`${pickId}:${target}`) % 100;
  if (bucket >= entry.rolloutPct) {
    return { allowed: false, skipReason: 'rollout-pct' };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// UTV2-537: Typed accessor for promotion score components
// ---------------------------------------------------------------------------

/**
 * Convenience type for the 5 promotion score components.
 * These are the raw 0–100 inputs before weighting.
 */
export interface PromotionScoreComponents {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
  edgeSource?: EdgeSource | undefined;
}

/**
 * Parse a promotion history payload into a typed PromotionDecisionSnapshot.
 * Returns null if the payload is not a valid snapshot (e.g. pre-snapshot rows).
 */
export function parsePromotionSnapshot(
  payload: unknown,
): PromotionDecisionSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const scoreInputs = record['scoreInputs'];
  if (!scoreInputs || typeof scoreInputs !== 'object') {
    return null;
  }

  const si = scoreInputs as Record<string, unknown>;
  if (
    typeof si['edge'] !== 'number' ||
    typeof si['trust'] !== 'number' ||
    typeof si['readiness'] !== 'number' ||
    typeof si['uniqueness'] !== 'number' ||
    typeof si['boardFit'] !== 'number'
  ) {
    return null;
  }

  return payload as PromotionDecisionSnapshot;
}

/**
 * Extract just the score components from a promotion history payload.
 * Returns null if the payload doesn't contain valid score inputs.
 */
export function extractScoreComponents(
  payload: unknown,
): PromotionScoreComponents | null {
  const snapshot = parsePromotionSnapshot(payload);
  if (!snapshot) return null;
  return snapshot.scoreInputs;
}
