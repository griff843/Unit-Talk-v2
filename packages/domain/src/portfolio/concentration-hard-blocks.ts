/**
 * Concentration Hard Blocks — INIT-3.5.4
 *
 * Enforces hard concentration limits on the live portfolio exposure snapshot.
 * A "hard block" prevents a candidate pick from being added when it would push
 * any concentration dimension past a configurable ceiling.
 *
 * Constitutional guarantees:
 *  1. Block decisions are deterministic and replay-safe from the same inputs.
 *  2. Fail closed: missing or invalid exposure state always blocks the candidate.
 *  3. No capital deployment, treasury, or scaling runtime is activated here.
 *  4. No Program 4 activation from this module.
 *  5. Block evidence is immutable once produced.
 *  6. No DB access.
 *
 * Depends on:
 *  - UTV2-1128: PortfolioExposureSnapshot (exposure-store.ts)
 *  - UTV2-1129: verifySnapshotConsistency (exposure-consistency.ts)
 *  - UTV2-1130: DrawdownMonitorResult (drawdown-monitor.ts) — used for pre-check
 *  - Existing: CONCENTRATION_LIMITS, computeConcentrationSignals (concentration.ts)
 *
 * Pure — no I/O, no DB, no env reads.
 */

import type { PortfolioExposureSnapshot } from './exposure-store.js';
import { verifySnapshotConsistency } from './exposure-consistency.js';
import {
  CONCENTRATION_LIMITS,
  computeConcentrationSignals,
  type PortfolioSlot,
} from './concentration.js';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface ConcentrationHardBlockConfig {
  /**
   * Override hard-block ceilings per dimension.
   * Defaults to CONCENTRATION_LIMITS from concentration.ts.
   */
  readonly player: number;
  readonly team: number;
  readonly sport: number;
  readonly market_family: number;
  /**
   * When true, an inconsistent exposure snapshot always blocks (fail closed).
   * Defaults to true.
   */
  readonly require_consistent_snapshot: boolean;
}

export const DEFAULT_HARD_BLOCK_CONFIG: ConcentrationHardBlockConfig = {
  player: CONCENTRATION_LIMITS.player,
  team: CONCENTRATION_LIMITS.team,
  sport: CONCENTRATION_LIMITS.sport,
  market_family: CONCENTRATION_LIMITS.marketFamily,
  require_consistent_snapshot: true,
} as const;

// ── Result types ──────────────────────────────────────────────────────────────

export type HardBlockReason =
  | 'INVALID_SNAPSHOT'
  | 'CONSISTENCY_FAILURE'
  | 'PLAYER_CONCENTRATION_EXCEEDED'
  | 'TEAM_CONCENTRATION_EXCEEDED'
  | 'SPORT_CONCENTRATION_EXCEEDED'
  | 'MARKET_FAMILY_CONCENTRATION_EXCEEDED';

export interface HardBlockEvidence {
  readonly reason: HardBlockReason;
  readonly detail: string;
  readonly dimension: string | null;
  readonly current_concentration: number | null;
  readonly ceiling: number | null;
  readonly candidate_pick_id: string;
  readonly snapshot_event_count: number;
}

export type ConcentrationBlockStatus = 'allowed' | 'blocked';

export interface ConcentrationHardBlockResult {
  readonly status: ConcentrationBlockStatus;
  /** Present only when status === 'blocked'. */
  readonly block_evidence: HardBlockEvidence | null;
  /** Post-add concentration signals (only when status === 'allowed'). */
  readonly projected_signals: ReturnType<typeof computeConcentrationSignals> | null;
}

// ── Candidate type ────────────────────────────────────────────────────────────

export interface CandidatePick {
  readonly pick_id: string;
  readonly sport: string;
  readonly market_family: 'game-line' | 'player-prop' | 'team-prop' | 'unknown';
  readonly participant_id: string | null;
  readonly team_id: string | null;
  readonly stake_weight: number;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Evaluate whether adding a candidate pick would breach any concentration ceiling.
 *
 * The function:
 *  1. Validates the snapshot (fail closed on invalid or inconsistent).
 *  2. Converts open picks to PortfolioSlot format.
 *  3. Projects signals as if the candidate were added.
 *  4. Checks each dimension against the configured ceiling.
 *  5. Returns the first violated dimension as immutable block evidence,
 *     or 'allowed' with projected signals if no ceiling is breached.
 */
export function evaluateConcentrationHardBlock(
  snapshot: PortfolioExposureSnapshot,
  candidate: CandidatePick,
  config: ConcentrationHardBlockConfig = DEFAULT_HARD_BLOCK_CONFIG,
): ConcentrationHardBlockResult {
  // Fail closed on invalid snapshot.
  if (!snapshot.is_valid) {
    return block('INVALID_SNAPSHOT', `Snapshot is invalid: ${snapshot.invalid_reason ?? 'unknown'}`, null, null, null, candidate.pick_id, snapshot.event_count);
  }

  // Consistency gate.
  if (config.require_consistent_snapshot) {
    const consistency = verifySnapshotConsistency(snapshot);
    if (!consistency.is_consistent) {
      const firstViolation = consistency.violations[0];
      return block('CONSISTENCY_FAILURE', `Snapshot consistency failure: ${firstViolation?.detail ?? 'unknown'}`, null, null, null, candidate.pick_id, snapshot.event_count);
    }
  }

  // Convert snapshot open picks + candidate to PortfolioSlot[].
  const board: PortfolioSlot[] = snapshot.open_picks.map(p => ({
    pickId: p.pick_id,
    sport: p.sport,
    marketFamily: p.market_family,
    participantId: p.participant_id,
    teamId: p.team_id,
    modelProbability: 0.5,  // not used in concentration signals
    edge: 0,
    stake: p.stake_weight,
  }));

  const candidateSlot: PortfolioSlot = {
    pickId: candidate.pick_id,
    sport: candidate.sport,
    marketFamily: candidate.market_family,
    participantId: candidate.participant_id,
    teamId: candidate.team_id,
    modelProbability: 0.5,
    edge: 0,
    stake: candidate.stake_weight,
  };

  // Project signals: computeConcentrationSignals appends the candidate internally,
  // so pass only the existing board (not [...board, candidateSlot]).
  const projected = computeConcentrationSignals(board, candidateSlot);

  // Empty board: single-pick portfolio can't be overconcentrated; skip dimension checks.
  if (board.length === 0) {
    return { status: 'allowed', block_evidence: null, projected_signals: projected };
  }

  // Check each dimension — first breach blocks.
  if (projected.playerConcentration > config.player) {
    return block('PLAYER_CONCENTRATION_EXCEEDED', `Player concentration ${projected.playerConcentration.toFixed(3)} > ceiling ${config.player}`, 'player', projected.playerConcentration, config.player, candidate.pick_id, snapshot.event_count);
  }
  if (projected.teamConcentration > config.team) {
    return block('TEAM_CONCENTRATION_EXCEEDED', `Team concentration ${projected.teamConcentration.toFixed(3)} > ceiling ${config.team}`, 'team', projected.teamConcentration, config.team, candidate.pick_id, snapshot.event_count);
  }
  if (projected.sportConcentration > config.sport) {
    return block('SPORT_CONCENTRATION_EXCEEDED', `Sport concentration ${projected.sportConcentration.toFixed(3)} > ceiling ${config.sport}`, 'sport', projected.sportConcentration, config.sport, candidate.pick_id, snapshot.event_count);
  }
  if (projected.marketFamilyConcentration > config.market_family) {
    return block('MARKET_FAMILY_CONCENTRATION_EXCEEDED', `Market-family concentration ${projected.marketFamilyConcentration.toFixed(3)} > ceiling ${config.market_family}`, 'market_family', projected.marketFamilyConcentration, config.market_family, candidate.pick_id, snapshot.event_count);
  }

  return { status: 'allowed', block_evidence: null, projected_signals: projected };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function block(
  reason: HardBlockReason,
  detail: string,
  dimension: string | null,
  current_concentration: number | null,
  ceiling: number | null,
  candidate_pick_id: string,
  snapshot_event_count: number,
): ConcentrationHardBlockResult {
  return {
    status: 'blocked',
    block_evidence: Object.freeze({
      reason,
      detail,
      dimension,
      current_concentration,
      ceiling,
      candidate_pick_id,
      snapshot_event_count,
    }),
    projected_signals: null,
  };
}
