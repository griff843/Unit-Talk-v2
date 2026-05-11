/**
 * Portfolio-level correlation analysis.
 *
 * Works at the PortfolioSlot level (position-sized slots) rather than the
 * CanonicalPick level. Detects correlation between a candidate pick and the
 * existing board using sport, market family, participant, and team dimensions.
 *
 * Complements the pick-level correlation-detection.ts (which works on CanonicalPick
 * with event keys) with a stake-weighted, board-level view.
 *
 * Pure — no I/O, no DB, no env reads.
 */

import type { PortfolioSlot } from './concentration.js';

export interface PortfolioCorrelationResult {
  correlatedCount: number;              // number of existing board picks correlated with candidate
  maxCorrelation: number;               // highest single correlation coefficient (0-1)
  portfolioCorrelationPenalty: number;  // 0-1 penalty factor (1 = no penalty)
  correlatedPickIds: string[];
}

interface CorrelatedSlot {
  pickId: string;
  coefficient: number;
}

/**
 * Classify correlation coefficient between a board slot and a candidate.
 *
 * Correlation tiers:
 * - 0.8  same player in any market
 * - 0.6  same team + same market family
 * - 0.4  same sport + same market family (game-line or team-prop)
 * - 0.2  same sport only (cross-market family)
 * - 0.0  different sport
 */
function classifyCoefficient(
  board: PortfolioSlot,
  candidate: PortfolioSlot,
): number {
  // Same player → highest correlation
  if (
    candidate.participantId !== null &&
    board.participantId !== null &&
    board.participantId === candidate.participantId
  ) {
    return 0.8;
  }

  // Same team + same market family → medium-high
  if (
    candidate.teamId !== null &&
    board.teamId !== null &&
    board.teamId === candidate.teamId &&
    board.marketFamily === candidate.marketFamily
  ) {
    return 0.6;
  }

  if (board.sport !== candidate.sport) {
    return 0.0;
  }

  // Same sport from here on.
  // Game-lines and player-props on the same sport but different games are nearly
  // independent (e.g., Celtics-Nets and Lakers-Warriors). A low coefficient
  // prevents the floor from being hit prematurely on an active board — the
  // 0.4 value caused boardFit to floor at 10 with only 15 same-sport picks
  // (UTV2-902). Same-game correlation cannot be detected without an event key
  // on PortfolioSlot; 0.1 is the safe sport-level baseline until that is added.
  if (board.marketFamily === candidate.marketFamily) {
    // Game-lines and team-props on same sport: low coefficient (different games)
    if (
      candidate.marketFamily === 'game-line' ||
      candidate.marketFamily === 'team-prop'
    ) {
      return 0.1;
    }
    // Player-props on same sport but different player → low correlation
    return 0.1;
  }

  // Same sport, different market family → very low correlation
  return 0.1;
}

/**
 * Compute portfolio-level correlation between a candidate slot and the existing board.
 *
 * The penalty factor is:
 *   1 - min(0.9, sum_of_correlated_coefficients * 0.15)
 *
 * This means:
 * - 1 same-player duplicate: penalty factor 0.88
 * - 3 same-sport picks: penalty factor 0.91
 * - Maximum penalty is capped at 0.1 (penalty factor 0.1)
 */
export function computePortfolioCorrelation(
  board: PortfolioSlot[],
  candidate: PortfolioSlot,
): PortfolioCorrelationResult {
  const correlated: CorrelatedSlot[] = [];

  for (const slot of board) {
    if (slot.pickId === candidate.pickId) {
      continue;
    }

    const coefficient = classifyCoefficient(slot, candidate);
    if (coefficient > 0) {
      correlated.push({ pickId: slot.pickId, coefficient });
    }
  }

  const maxCorrelation =
    correlated.length > 0
      ? Math.max(...correlated.map(c => c.coefficient))
      : 0;

  const correlatedCount = correlated.length;
  const correlatedPickIds = correlated.map(c => c.pickId);

  // Penalty grows with total correlation mass, capped at 90%
  const correlationMass = correlated.reduce((s, c) => s + c.coefficient, 0);
  const penaltyAmount = Math.min(0.9, correlationMass * 0.15);
  const portfolioCorrelationPenalty = Math.max(0.1, 1 - penaltyAmount);

  return {
    correlatedCount,
    maxCorrelation,
    portfolioCorrelationPenalty,
    correlatedPickIds,
  };
}
