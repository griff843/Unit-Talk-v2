/**
 * Portfolio concentration signals.
 *
 * Computes how concentrated a portfolio would be if a candidate pick is added,
 * across four dimensions: player, team, sport, and market family.
 *
 * Pure — no I/O, no DB, no env reads.
 */

export interface PortfolioSlot {
  pickId: string;
  sport: string;
  marketFamily: 'game-line' | 'player-prop' | 'team-prop' | 'unknown';
  participantId: string | null;     // player ID for props
  teamId: string | null;             // team identifier
  modelProbability: number;
  edge: number;
  stake: number;                     // suggested position size (0-1)
}

export interface ConcentrationSignals {
  playerConcentration: number;       // 0-1, fraction of portfolio on same player
  teamConcentration: number;         // 0-1, fraction on same team (includes player props)
  sportConcentration: number;        // 0-1, fraction on same sport
  marketFamilyConcentration: number; // 0-1, fraction in same market family
  maxSlotWeight: number;             // largest single pick stake
}

export interface ConcentrationPenalty {
  penaltyFactor: number;    // 0-1 multiplicative penalty on boardFit score
  reason: string[];
  signals: ConcentrationSignals;
}

export const CONCENTRATION_LIMITS = {
  player: 0.25,       // >25% of portfolio on one player → penalty
  team: 0.40,         // >40% on one team (including player props for that team)
  sport: 0.60,        // >60% on one sport
  marketFamily: 0.70, // >70% in one market family
} as const;

/**
 * Compute how concentrated the board WOULD BE if candidate is added.
 *
 * Returns signals across player, team, sport, and market family dimensions.
 * All fractions are in 0-1 range.
 */
export function computeConcentrationSignals(
  board: PortfolioSlot[],
  candidate: PortfolioSlot,
): ConcentrationSignals {
  const all = [...board, candidate];
  const totalStake = all.reduce((s, p) => s + p.stake, 0);
  const total = totalStake > 0 ? totalStake : 1;

  // Player concentration: only meaningful if candidate has participantId
  const playerConcentration = candidate.participantId
    ? all
        .filter(p => p.participantId === candidate.participantId)
        .reduce((s, p) => s + p.stake, 0) / total
    : 0;

  // Team concentration: include picks on same teamId or where participantId matches candidate teamId
  const teamConcentration = candidate.teamId
    ? all
        .filter(
          p =>
            p.teamId === candidate.teamId ||
            p.participantId === candidate.teamId,
        )
        .reduce((s, p) => s + p.stake, 0) / total
    : 0;

  const sportConcentration =
    all
      .filter(p => p.sport === candidate.sport)
      .reduce((s, p) => s + p.stake, 0) / total;

  const marketFamilyConcentration =
    all
      .filter(p => p.marketFamily === candidate.marketFamily)
      .reduce((s, p) => s + p.stake, 0) / total;

  const maxSlotWeight = Math.max(...all.map(p => p.stake / total));

  return {
    playerConcentration,
    teamConcentration,
    sportConcentration,
    marketFamilyConcentration,
    maxSlotWeight,
  };
}

/**
 * Convert concentration signals into a multiplicative penalty factor.
 *
 * penaltyFactor is clamped to [0.1, 1.0]:
 * - 1.0 = no penalty
 * - 0.1 = maximum penalty (board is critically over-concentrated)
 *
 * Player excess reduces factor linearly (1:1).
 * Team excess reduces factor at 50% rate (half-penalty).
 * Sport excess applies a flat 5% reduction.
 * Market-family excess is not penalized by default (monitored only via signal).
 */
export function computeConcentrationPenalty(
  signals: ConcentrationSignals,
): ConcentrationPenalty {
  const reasons: string[] = [];
  let penaltyFactor = 1.0;

  if (signals.playerConcentration > CONCENTRATION_LIMITS.player) {
    const excess = signals.playerConcentration - CONCENTRATION_LIMITS.player;
    reasons.push(
      `player_concentration_${Math.round(signals.playerConcentration * 100)}pct`,
    );
    penaltyFactor *= 1 - excess;
  }

  if (signals.teamConcentration > CONCENTRATION_LIMITS.team) {
    const excess = signals.teamConcentration - CONCENTRATION_LIMITS.team;
    reasons.push(
      `team_concentration_${Math.round(signals.teamConcentration * 100)}pct`,
    );
    penaltyFactor *= 1 - excess * 0.5;
  }

  if (signals.sportConcentration > CONCENTRATION_LIMITS.sport) {
    reasons.push(
      `sport_concentration_${Math.round(signals.sportConcentration * 100)}pct`,
    );
    penaltyFactor *= 0.95;
  }

  // Clamp to valid range
  penaltyFactor = Math.max(0.1, Math.min(1.0, penaltyFactor));

  return { penaltyFactor, reason: reasons, signals };
}
