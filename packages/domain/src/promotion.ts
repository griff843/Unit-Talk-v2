import {
  bestBetsPromotionPolicy,
  type ApprovalStatus,
  type BoardPromotionDecision,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
  type PromotionDecisionSnapshot,
  type PromotionPolicy,
  type PromotionScoreBreakdown,
  type PromotionScoreInputs,
  type PromotionScoreWeights,
} from '@unit-talk/contracts';
import { createHash } from 'node:crypto';
import { applyPromotionModifiers, type ScoreProvenance } from './scoring/promotion-weight-profiles.js';
import { americanToDecimal } from './risk/kelly-sizer.js';
import {
  createForcePromotionExceptionDecisionRecord,
  type DecisionRecord,
} from './models/decision-record.js';

export { bestBetsPromotionPolicy, exclusiveInsightsPromotionPolicy, traderInsightsPromotionPolicy } from '@unit-talk/contracts';
export type { ScoreProvenance, MarketFamily, PromotionWeightModifiers } from './scoring/promotion-weight-profiles.js';
export {
  MARKET_FAMILY_PROMOTION_MODIFIERS,
  SUPPORTED_SPORTS,
  UNSUPPORTED_SPORT_SCORE_CAP,
  classifyMarketFamily,
  isSupportedSport,
} from './scoring/promotion-weight-profiles.js';

// ---------------------------------------------------------------------------
// Local type guard (used by risk helpers below)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Risk / Volatility scoring — UTV2-1022 / UTV2-607
// ---------------------------------------------------------------------------

/** Fraction of the final promotion score influenced by risk modifier. */
export const RISK_MODIFIER_WEIGHT = 0.15;

/** Version stamp for the risk score formula. Bump when formula changes. */
export const RISK_SCORE_VERSION = 'risk-v1';

/** Result of computeRiskScore — composite risk signal for a single pick. */
export interface RiskScoreResult {
  /** 0–100 composite risk quality score. Higher = lower risk. */
  score: number;
  /** Effective score multiplier: RISK_MODIFIER_WEIGHT anchored (0.85 – 1.0). */
  modifier: number;
  /** True when any hard-block threshold fired. */
  hardBlock: boolean;
  /** Human-readable reasons for each triggered hard-block. */
  hardBlockReasons: string[];
  components: {
    varianceScore: number;
    kellyScore: number;
    /** @deprecated UTV2-1204 Option B: lineMovement no longer contributes to riskScore.
     * Field retained for backward compatibility with stored snapshots. Always 50 (neutral).
     * The lineMovement signal enters exclusively through the edge/model-blend path.
     */
    lineMovementScore: number;
    dispersionScore: number;
  };
}

/**
 * Compute a composite risk/volatility score for a pick.
 *
 * Pure function — reads only from pick.odds, pick.metadata.kellySizing,
 * and pick.metadata.consensus.
 * Absent fields default to neutral sub-scores (except kellyScore which fails closed to 0).
 *
 * UTV2-1204 (Option B): Line movement is no longer a component of the risk score.
 * The `lineMovement` signal contributes to the promotion score exclusively through
 * the edge/model-blend path (`movement_score` → `signal_adjustment` in model-blend.ts),
 * which is the sole authoritative path. Routing it through the risk modifier as well
 * would double-count the signal.
 *
 * Hard-block thresholds:
 *   - riskScore < 10  → hardBlock
 *   - kellyScore === 0 AND kellySizing data was present → hardBlock (degenerate Kelly)
 *
 * Weights (risk-v2, UTV2-1204):
 *   varianceScore * 0.45 + kellyScore * 0.45 + dispersionScore * 0.10
 *
 * @param pick        - CanonicalPick being evaluated
 * @param _scoreInputs - Reserved for future use; not consumed in risk-v2
 */
export function computeRiskScore(
  pick: CanonicalPick,
  _scoreInputs: PromotionScoreInputs,
): RiskScoreResult {
  const metadata: Record<string, unknown> = isRecord(pick.metadata) ? pick.metadata : {};

  // ─── 1. Variance score (from odds) ────────────────────────────────────────
  const varianceScore = computeVarianceScore(pick.odds);

  // ─── 2. Kelly score ────────────────────────────────────────────────────────
  const { kellyScore, kellyDataPresent } = computeKellyScore(metadata);

  // ─── 3. Dispersion score (odds dispersion across books) ────────────────────
  const dispersionScore = computeDispersionScore(metadata);

  // ─── 4. Composite (risk-v2: lineMovement removed — enters only via model blend) ──
  const score = Math.round(
    varianceScore * 0.45 +
    kellyScore   * 0.45 +
    dispersionScore * 0.10,
  );

  // modifier: 1.0 at riskScore=100, 0.85 at riskScore=0
  const modifier = 1 - RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT * (score / 100);

  // ─── 5. Hard-block evaluation ─────────────────────────────────────────────
  const hardBlockReasons: string[] = [];

  if (score < 10) {
    hardBlockReasons.push(
      `composite risk score ${score} is below hard-block threshold 10 (risk-v1)`,
    );
  }

  // Degenerate Kelly: data was present but fraction is 0 (no edge at offered price)
  if (kellyScore === 0 && kellyDataPresent) {
    hardBlockReasons.push(
      'Kelly fraction is 0 with Kelly data present — no positive EV at offered price (risk-v1)',
    );
  }

  return {
    score,
    modifier,
    hardBlock: hardBlockReasons.length > 0,
    hardBlockReasons,
    components: {
      varianceScore,
      kellyScore,
      lineMovementScore: 50, // UTV2-1204: neutral marker — no longer computed from metadata; use model-blend path
      dispersionScore,
    },
  };
}

// ─── Sub-score helpers (risk-v1 formulas) ─────────────────────────────────

/**
 * Variance score from submitted American odds.
 *
 * Higher odds → higher outcome variance → lower score.
 * odds > +250 → 25 (high variance)
 * odds > +150 → 50
 * odds > -115 → 75
 * odds <= -115 → 100 (short price, low variance)
 *
 * Absent/invalid odds → 50 (neutral).
 */
function computeVarianceScore(odds: number | undefined): number {
  if (odds === undefined || !Number.isFinite(odds)) {
    return 50; // neutral when absent
  }

  const decimalOdds = americanToDecimal(odds);

  if (decimalOdds >= 4.5) return 25; // approx +250 or longer in American
  if (decimalOdds >= 3.0) return 50; // approx +150 or longer
  if (decimalOdds > 1.87) return 75; // above -115 favourites
  return 100; // at or below -115 (short price, low variance)
}

/**
 * Kelly score from pick metadata.
 *
 * Priority: `pick.metadata.kellySizing.fractional_kelly`
 *           → `pick.metadata.domainAnalysis.kellyFraction` (computed at domain-analysis time)
 *
 * Absent/null → 0 (fails closed, most restrictive).
 * 0–0.05     → 100 (minimal sizing = safe relative to max_bet_fraction 0.05)
 * 0.05–0.15  → 75
 * 0.15–0.25  → 50
 * > 0.25     → 25 (aggressive sizing = risky)
 *
 * Returns `kellyDataPresent` so the hard-block check can distinguish
 * "no data" (neutral 0) from "data present but degenerate" (hard block).
 */
function computeKellyScore(
  metadata: Record<string, unknown>,
): { kellyScore: number; kellyDataPresent: boolean } {
  // Priority 1: explicit kellySizing result from submission pipeline
  const kellySizing = metadata['kellySizing'];
  if (isRecord(kellySizing)) {
    const fraction = kellySizing['fractional_kelly'];
    if (typeof fraction === 'number' && Number.isFinite(fraction)) {
      if (fraction <= 0) {
        return { kellyScore: 0, kellyDataPresent: true };
      }
      return { kellyScore: kellyTierScore(fraction), kellyDataPresent: true };
    }
    // kellySizing present but fraction missing/invalid → treat as data present, degenerate
    return { kellyScore: 0, kellyDataPresent: true };
  }

  // Priority 2: domain analysis kelly fraction (falls back gracefully)
  const domainAnalysis = metadata['domainAnalysis'];
  if (isRecord(domainAnalysis)) {
    const fraction = domainAnalysis['kellyFraction'];
    if (typeof fraction === 'number' && Number.isFinite(fraction)) {
      if (fraction <= 0) {
        return { kellyScore: 0, kellyDataPresent: true };
      }
      return { kellyScore: kellyTierScore(fraction), kellyDataPresent: true };
    }
  }

  // No Kelly data available — fail closed (0) but not degenerate (no hard block)
  return { kellyScore: 0, kellyDataPresent: false };
}

/** Map a Kelly fraction to a tiered risk score (risk-v1). */
function kellyTierScore(fraction: number): number {
  if (fraction <= 0.05) return 100;
  if (fraction <= 0.15) return 75;
  if (fraction <= 0.25) return 50;
  return 25;
}

/**
 * Dispersion score from pick.metadata.consensus.bookSpread (0.0–1.0).
 *
 * absent      → 50 (neutral)
 * <= 0.02     → 100 (all books agree)
 * <= 0.05     → 75
 * <= 0.10     → 50
 * <= 0.20     → 25
 * > 0.20      → 0  (extreme disagreement)
 */
function computeDispersionScore(metadata: Record<string, unknown>): number {
  const consensus = metadata['consensus'];
  if (!isRecord(consensus)) {
    return 50; // neutral when absent
  }

  const spread = consensus['bookSpread'];
  if (typeof spread !== 'number' || !Number.isFinite(spread)) {
    return 50;
  }

  if (spread <= 0.02) return 100;
  if (spread <= 0.05) return 75;
  if (spread <= 0.10) return 50;
  if (spread <= 0.20) return 25;
  return 0;
}

// ---------------------------------------------------------------------------
// End risk / volatility scoring
// ---------------------------------------------------------------------------

/**
 * Extended promotion decision that includes score provenance tracking.
 * Returned by evaluatePromotionEligibilityWithProvenance().
 */
export interface BoardPromotionDecisionWithProvenance extends BoardPromotionDecision {
  scoreProvenance: ScoreProvenance;
  exceptionRecord?: DecisionRecord;
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

  // UTV2-1022 / UTV2-607: computed risk gates (after operator riskBlocked, before board caps)
  // If scoreInputs.riskScore is already set (e.g. deterministic replay from a stored snapshot),
  // skip recomputation and use the stored value so replayed decisions remain reproducible.
  const riskResult =
    input.scoreInputs.riskScore !== undefined
      ? ({
          score: input.scoreInputs.riskScore,
          modifier: 1 - RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT * (input.scoreInputs.riskScore / 100),
          hardBlock: false,
          hardBlockReasons: [],
          components: input.scoreInputs.riskComponents ?? { varianceScore: 50, kellyScore: 50, lineMovementScore: 50, dispersionScore: 50 },
        } as ReturnType<typeof computeRiskScore>)
      : computeRiskScore(input.pick, input.scoreInputs);
  if (riskResult.hardBlock) {
    suppressionReasons.push(...riskResult.hardBlockReasons);
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

  const breakdown = calculateScore(input, policy.weights, riskResult.score);
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

  const forcePromotionError = validateForcePromotionOverride(input);
  if (forcePromotionError) {
    suppressionReasons.push(forcePromotionError);
  }

  if (suppressionReasons.length > 0 && (!input.override?.forcePromote || forcePromotionError)) {
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
    const exceptionRecord = createForcePromotionExceptionDecisionRecord({
      record_id: buildForcePromotionExceptionRecordId(input, policy, decidedAt),
      entity_id: resolveForcePromotionEntityId(input, policy),
      decided_at_ms: Date.parse(decidedAt),
      inputs_hash: hashForcePromotionExceptionInputs(input, policy, breakdown, suppressionReasons),
      target: policy.target,
      requested_by: decidedBy,
      authority: resolveDecisionAuthority(decidedBy),
      policy_version: version,
      evaluator_version: 'promotion-exception-runtime-v1',
      override_reason: input.override.reason?.trim() ?? `operator force-promoted to ${policy.target}`,
      score: breakdown.total,
      minimum_score: policy.minimumScore,
      suppression_reasons: suppressionReasons,
      gate_reasons: reasons,
    });
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
      exceptionRecord,
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

/**
 * Calculate the weighted promotion score for a pick.
 *
 * @param riskScore - Optional 0–100 composite risk score (UTV2-1022).
 *   When present, applies a risk modifier to the final total:
 *     modifiedTotal = rawTotal × (1 − RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT × (riskScore / 100))
 *   When undefined (pre-v3 replay compat), modifier is 1.0 — no change.
 */
function calculateScore(
  input: BoardPromotionEvaluationInput,
  weights: PromotionScoreWeights,
  riskScore?: number,
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

  // Risk modifier: 1.0 when absent (pre-v3 compat), otherwise 0.85–1.0
  const riskModifier =
    riskScore !== undefined
      ? 1 - RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT * (riskScore / 100)
      : 1.0;

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
      total: rawTotal * riskModifier,
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
    total: modified.total * riskModifier,
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
  exceptionRecord?: DecisionRecord;
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
    ...(input.exceptionRecord ? { exceptionRecord: input.exceptionRecord } : {}),
  };
}

function validateForcePromotionOverride(input: BoardPromotionEvaluationInput): string | null {
  if (!input.override?.forcePromote) {
    return null;
  }
  if (input.override.suppress) {
    return 'force promotion exception is invalid: forcePromote and suppress cannot both be true';
  }
  if (!input.override.reason?.trim()) {
    return 'force promotion exception is invalid: override reason is required';
  }
  return null;
}

function resolveForcePromotionEntityId(
  input: BoardPromotionEvaluationInput,
  policy: PromotionPolicy,
): string {
  return input.pick.id?.trim() || `promotion:${policy.target}`;
}

function resolveDecisionAuthority(decidedBy: string): 'system' | 'pm' | 'operator' {
  const normalized = decidedBy.trim().toLowerCase();
  if (normalized.startsWith('pm') || normalized.includes('product-manager')) {
    return 'pm';
  }
  if (normalized === 'system' || normalized === 'replay') {
    return 'system';
  }
  return 'operator';
}

function buildForcePromotionExceptionRecordId(
  input: BoardPromotionEvaluationInput,
  policy: PromotionPolicy,
  decidedAt: string,
): string {
  const digest = createHash('sha256')
    .update(stableSerialize({
      pickId: input.pick.id,
      entityId: resolveForcePromotionEntityId(input, policy),
      target: policy.target,
      decidedAt,
      reason: input.override?.reason ?? '',
    }))
    .digest('hex')
    .slice(0, 16);
  return `force-promotion:${policy.target}:${digest}`;
}

function hashForcePromotionExceptionInputs(
  input: BoardPromotionEvaluationInput,
  policy: PromotionPolicy,
  breakdown: PromotionScoreBreakdown,
  suppressionReasons: readonly string[],
): string {
  return createHash('sha256')
    .update(stableSerialize({
      target: policy.target,
      policyVersion: policy.version,
      entityId: resolveForcePromotionEntityId(input, policy),
      scoreInputs: input.scoreInputs,
      gateInputs: {
        approvalStatus: input.approvalStatus,
        hasRequiredFields: input.hasRequiredFields,
        isStale: input.isStale,
        withinPostingWindow: input.withinPostingWindow,
        marketStillValid: input.marketStillValid,
        riskBlocked: input.riskBlocked,
        confidenceFloor: input.confidenceFloor ?? null,
        pickConfidence: input.pick.confidence ?? null,
      },
      boardState: input.boardState,
      boardCaps: input.boardCaps,
      override: input.override,
      score: breakdown.total,
      minimumScore: policy.minimumScore,
      suppressionReasons,
    }))
    .digest('hex');
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortForStableSerialization(value));
}

function sortForStableSerialization(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableSerialization);
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortForStableSerialization(value[key]);
  }
  return sorted;
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
    // Replay determinism: if the snapshot has a stored riskScore (v3+), use it.
    // For pre-v3 snapshots without riskScore, inject 100 so the modifier is 1.0 (no change),
    // preserving the original score semantics of the decision being replayed.
    scoreInputs: snapshot.scoreInputs.riskScore !== undefined
      ? snapshot.scoreInputs
      : { ...snapshot.scoreInputs, riskScore: 100 },
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
