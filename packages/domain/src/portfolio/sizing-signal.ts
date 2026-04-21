/**
 * SizingSignal — bankroll-aware exposure sizing separate from pick quality.
 *
 * Problem: promotion score folds pick quality AND portfolio context into one
 * number, making it impossible to explain why the highest-edge pick is not
 * always the highest-allocation pick.
 *
 * Solution: split the two concerns explicitly.
 *   pickQualityScore   — intrinsic merit (edge, trust, readiness, uniqueness)
 *   adjustedExposure   — how much capital to commit, after portfolio penalties
 *
 * Pure — no I/O, no DB, no env reads. Deterministic from inputs.
 */

import type { BankrollConfig, KellySizingResult } from '../risk/kelly-sizer.js';
import { computeKellySize } from '../risk/kelly-sizer.js';
import type { BoardFitResult } from './board-fit.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SizingSignalInputs {
  /** Promotion quality components (0-100 each). boardFit excluded — it is a portfolio concern. */
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;

  /** Model win probability (0-1 exclusive). Used as Kelly p input. */
  winProbability: number;
  /** Decimal odds from market (> 1). Used as Kelly b input. */
  decimalOdds: number;

  /** Pre-computed board-fit result for this candidate. */
  boardFitResult: BoardFitResult;
  /** Model uncertainty (0-1). High uncertainty → reduce sizing. */
  modelUncertainty: number;
  /**
   * Current portfolio drawdown as a fraction of bankroll (0-1).
   * 0 = no drawdown, 0.1 = 10% loss from peak, 0.5+ = severe.
   */
  portfolioDrawdownFraction: number;

  /** Edge scores of picks already on the board, for rank comparison. */
  boardEdgeScores: number[];
  /** Allocation fractions of picks already on the board, for rank comparison. */
  boardAllocationFractions: number[];

  /** Bankroll configuration for Kelly sizing. */
  bankroll: BankrollConfig;
}

export interface SizingPenalties {
  /**
   * 0-1 factor from board-fit (concentration + correlation).
   * 1.0 = no penalty, 0.0 = fully suppressed by portfolio fit.
   */
  boardFitFactor: number;
  /**
   * 0-1 factor from model uncertainty.
   * 1.0 = no uncertainty, ~0.5 = maximum uncertainty (50% reduction).
   */
  varianceFactor: number;
  /**
   * 0-1 factor from portfolio drawdown.
   * 1.0 = no drawdown, 0.5 = severe drawdown (50% reduction).
   */
  drawdownFactor: number;
  /** Combined product of all penalty factors. */
  combined: number;
}

export interface SizingSignal {
  /**
   * Intrinsic pick quality (0-100), independent of portfolio and bankroll.
   * Weighted sum of edge, trust, readiness, uniqueness — boardFit excluded.
   * Weights are renormalized from the promotion score weights:
   *   edge=0.389, trust=0.278, readiness=0.222, uniqueness=0.111
   */
  pickQualityScore: number;

  /** Raw Kelly fraction before portfolio adjustments (e.g. 0.05 = 5%). */
  rawKellyFraction: number;
  /** Raw Kelly units before portfolio adjustments. */
  rawKellyUnits: number;

  /**
   * Kelly fraction after applying all portfolio penalty factors.
   * This is the suggested exposure as a bankroll fraction.
   */
  adjustedExposureFraction: number;
  /** Adjusted exposure in bankroll units. */
  adjustedExposureUnits: number;

  /** True when this pick's edge exceeds every existing board pick's edge. */
  isHighestEdge: boolean;
  /**
   * True when this pick's adjusted allocation would exceed every existing
   * board pick's allocation. May differ from isHighestEdge when penalties
   * reduce a high-edge pick's sizing below a lower-edge pick's.
   */
  isHighestAllocation: boolean;

  /** Breakdown of why adjusted exposure < raw Kelly exposure. */
  penalties: SizingPenalties;

  /**
   * Human-readable reasons the operator sees when the highest-edge pick is
   * not the highest-allocation pick, or when sizing is reduced.
   */
  adjustmentReasons: string[];

  /** Whether Kelly found positive edge. False → adjustedExposure is 0. */
  hasEdge: boolean;

  /** Raw Kelly result for callers that need the full breakdown. */
  kelly: KellySizingResult;
}

// ─── Quality weight constants ─────────────────────────────────────────────────

// Promotion weights: edge=0.35, trust=0.25, readiness=0.20, uniqueness=0.10, boardFit=0.10
// boardFit is a portfolio concern — strip it and renormalize the remaining 0.90.
const QUALITY_WEIGHT_EDGE = 0.35 / 0.9;       // ≈ 0.389
const QUALITY_WEIGHT_TRUST = 0.25 / 0.9;      // ≈ 0.278
const QUALITY_WEIGHT_READINESS = 0.20 / 0.9;  // ≈ 0.222
const QUALITY_WEIGHT_UNIQUENESS = 0.10 / 0.9; // ≈ 0.111

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Compute a SizingSignal for a candidate pick given portfolio context.
 *
 * Algorithm:
 *   1. pickQualityScore = weighted(edge, trust, readiness, uniqueness) — no boardFit
 *   2. rawKelly = computeKellySize(winProbability, decimalOdds, bankroll)
 *   3. boardFitFactor = boardFitResult.score / 100
 *   4. varianceFactor = 1 - (0.5 * clamp(modelUncertainty, 0, 1))
 *   5. drawdownFactor = 1 - clamp(portfolioDrawdownFraction, 0, 0.5)
 *   6. adjustedFraction = rawKellyFraction * boardFitFactor * varianceFactor * drawdownFactor
 */
export function computeSizingSignal(inputs: SizingSignalInputs): SizingSignal {
  const {
    edge, trust, readiness, uniqueness,
    winProbability, decimalOdds,
    boardFitResult, modelUncertainty, portfolioDrawdownFraction,
    boardEdgeScores, boardAllocationFractions,
    bankroll,
  } = inputs;

  // Step 1: Pick quality score — intrinsic merit only, no portfolio context
  const pickQualityScore = clamp(
    edge * QUALITY_WEIGHT_EDGE +
    trust * QUALITY_WEIGHT_TRUST +
    readiness * QUALITY_WEIGHT_READINESS +
    uniqueness * QUALITY_WEIGHT_UNIQUENESS,
    0, 100,
  );

  // Step 2: Kelly sizing
  const kelly = computeKellySize(winProbability, decimalOdds, bankroll);
  const rawKellyFraction = kelly.recommended_fraction;
  const rawKellyUnits = kelly.recommended_units;

  if (!kelly.has_edge) {
    return noEdgeSignal(pickQualityScore, kelly, boardEdgeScores, boardAllocationFractions);
  }

  // Step 3: Board-fit penalty — concentration and correlation reduce sizing
  const boardFitFactor = clamp(boardFitResult.score / 100, 0, 1);

  // Step 4: Variance penalty — high model uncertainty reduces sizing by up to 50%
  const varianceFactor = 1 - 0.5 * clamp(modelUncertainty, 0, 1);

  // Step 5: Drawdown penalty — portfolio losses throttle new exposure by up to 50%
  const drawdownFactor = 1 - clamp(portfolioDrawdownFraction, 0, 0.5);

  const combined = boardFitFactor * varianceFactor * drawdownFactor;

  const adjustedExposureFraction = round(rawKellyFraction * combined, 6);
  const adjustedExposureUnits = round(adjustedExposureFraction * bankroll.total_bankroll, 2);

  // Step 6: Rank comparisons
  const isHighestEdge = boardEdgeScores.every((e) => edge > e);
  const isHighestAllocation = boardAllocationFractions.every((a) => adjustedExposureFraction > a);

  // Step 7: Explain adjustments in operator-readable terms
  const adjustmentReasons = buildAdjustmentReasons(
    boardFitFactor,
    varianceFactor,
    drawdownFactor,
    boardFitResult,
    isHighestEdge,
    isHighestAllocation,
  );

  return {
    pickQualityScore: round(pickQualityScore, 2),
    rawKellyFraction,
    rawKellyUnits,
    adjustedExposureFraction,
    adjustedExposureUnits,
    isHighestEdge,
    isHighestAllocation,
    penalties: {
      boardFitFactor: round(boardFitFactor, 4),
      varianceFactor: round(varianceFactor, 4),
      drawdownFactor: round(drawdownFactor, 4),
      combined: round(combined, 4),
    },
    adjustmentReasons,
    hasEdge: true,
    kelly,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noEdgeSignal(
  pickQualityScore: number,
  kelly: KellySizingResult,
  boardEdgeScores: number[],
  boardAllocationFractions: number[],
): SizingSignal {
  return {
    pickQualityScore: round(pickQualityScore, 2),
    rawKellyFraction: 0,
    rawKellyUnits: 0,
    adjustedExposureFraction: 0,
    adjustedExposureUnits: 0,
    isHighestEdge: false,
    isHighestAllocation: boardAllocationFractions.length === 0,
    penalties: { boardFitFactor: 1, varianceFactor: 1, drawdownFactor: 1, combined: 1 },
    adjustmentReasons: ['No positive Kelly edge — model probability does not overcome the vig'],
    hasEdge: false,
    kelly,
  };
}

function buildAdjustmentReasons(
  boardFitFactor: number,
  varianceFactor: number,
  drawdownFactor: number,
  boardFitResult: BoardFitResult,
  isHighestEdge: boolean,
  isHighestAllocation: boolean,
): string[] {
  const reasons: string[] = [];

  if (boardFitFactor < 0.9) {
    const pct = Math.round((1 - boardFitFactor) * 100);
    const detail = boardFitResult.concentrationReasons.length > 0
      ? `: ${boardFitResult.concentrationReasons.slice(0, 2).join(', ')}`
      : '';
    reasons.push(`Portfolio concentration/correlation reduced sizing by ${pct}%${detail}`);
  }

  if (varianceFactor < 0.9) {
    const pct = Math.round((1 - varianceFactor) * 100);
    reasons.push(`Model uncertainty reduced sizing by ${pct}%`);
  }

  if (drawdownFactor < 0.95) {
    const pct = Math.round((1 - drawdownFactor) * 100);
    reasons.push(`Active drawdown throttled sizing by ${pct}%`);
  }

  if (isHighestEdge && !isHighestAllocation) {
    reasons.push(
      'Highest-edge pick on the board, but portfolio penalties reduced allocation ' +
      'below other board picks — edge alone does not determine position size',
    );
  }

  return reasons;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
