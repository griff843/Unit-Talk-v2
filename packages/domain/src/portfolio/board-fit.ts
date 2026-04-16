/**
 * Board-fit score computation.
 *
 * Provides a canonical 0-100 boardFit score for a candidate pick given the
 * current board composition. The score integrates:
 *   1. Concentration penalty (player, team, sport dimensions)
 *   2. Portfolio-level correlation penalty
 *
 * This is the function apps should call when computing the `boardFit` input to
 * `evaluatePromotionEligibility()` instead of passing a hardcoded value.
 *
 * Pure — no I/O, no DB, no env reads.
 */

import {
  computeConcentrationSignals,
  computeConcentrationPenalty,
} from './concentration.js';
import { computePortfolioCorrelation } from './correlation.js';
import type { PortfolioSlot } from './concentration.js';

export interface BoardFitResult {
  /** 0-100 score suitable for use as scoreInputs.boardFit */
  score: number;
  /** Multiplicative factor from concentration analysis (0-1) */
  concentrationPenaltyFactor: number;
  /** Multiplicative factor from correlation analysis (0-1) */
  correlationPenaltyFactor: number;
  /** Concentration penalty reasons */
  concentrationReasons: string[];
  /** Number of correlated existing picks */
  correlatedCount: number;
}

/**
 * Compute a 0-100 board-fit score for `candidate` given the current `board`.
 *
 * Algorithm:
 *   baseScore = 100
 *   afterConcentration = baseScore * concentrationPenaltyFactor
 *   afterCorrelation   = afterConcentration * correlationPenaltyFactor
 *   score = clamp(afterCorrelation, 0, 100)
 *
 * An empty board always returns 100 (perfect fit — no concentration risk).
 */
export function computeBoardFitScore(
  board: PortfolioSlot[],
  candidate: PortfolioSlot,
): BoardFitResult {
  if (board.length === 0) {
    return {
      score: 100,
      concentrationPenaltyFactor: 1.0,
      correlationPenaltyFactor: 1.0,
      concentrationReasons: [],
      correlatedCount: 0,
    };
  }

  const concentrationSignals = computeConcentrationSignals(board, candidate);
  const concentrationPenalty = computeConcentrationPenalty(concentrationSignals);
  const correlationResult = computePortfolioCorrelation(board, candidate);

  const rawScore =
    100 *
    concentrationPenalty.penaltyFactor *
    correlationResult.portfolioCorrelationPenalty;

  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    concentrationPenaltyFactor: concentrationPenalty.penaltyFactor,
    correlationPenaltyFactor: correlationResult.portfolioCorrelationPenalty,
    concentrationReasons: concentrationPenalty.reason,
    correlatedCount: correlationResult.correlatedCount,
  };
}
