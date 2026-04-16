/**
 * Availability / Injury Confidence Extractor — UTV2-634
 *
 * Adjusts pick confidence based on:
 *   - Player availability status (confirmed → out scale)
 *   - Key teammate availability (game-script risk)
 *   - Data staleness (< 4h = fresh)
 *
 * Pure — no I/O, no DB, no env reads.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type AvailabilityStatus =
  | 'confirmed'
  | 'probable'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'unknown';

export interface PlayerAvailability {
  participantId: string;
  status: AvailabilityStatus;
  /** Free text from injury report */
  injuryNote?: string;
  /** ISO timestamp */
  lastUpdatedAt?: string;
}

export interface AvailabilityConfidenceResult {
  /** 1.0 = no change; 0.5 = major uncertainty */
  confidenceMultiplier: number;
  recommendationAdjustment: 'none' | 'reduce_stake' | 'hold' | 'suppress';
  reason: string;
  /** fresh = < 4h old */
  staleness: 'fresh' | 'stale' | 'unknown';
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Confidence multipliers by availability status. */
export const AVAILABILITY_CONFIDENCE_MAP: Record<AvailabilityStatus, number> =
  {
    confirmed: 1.0,
    probable: 0.92,
    questionable: 0.70,
    doubtful: 0.40,
    /** Pick should be suppressed if key player is out. */
    out: 0.0,
    /** Some uncertainty but do not hard-suppress. */
    unknown: 0.80,
  };

export const STALENESS_THRESHOLD_HOURS = 4;

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Evaluate availability confidence for a pick candidate.
 *
 * @param targetPlayer      - The player being picked.
 * @param keyTeammateAvailability - Stars whose absence changes game script.
 * @param now               - ISO timestamp for staleness reference (defaults to Date.now()).
 */
export function evaluateAvailabilityConfidence(
  targetPlayer: PlayerAvailability,
  keyTeammateAvailability?: PlayerAvailability[],
  now?: string,
): AvailabilityConfidenceResult {
  const nowMs = now ? new Date(now).getTime() : Date.now();

  // ── Staleness check ──────────────────────────────────────────────────────
  let staleness: 'fresh' | 'stale' | 'unknown' = 'unknown';
  if (targetPlayer.lastUpdatedAt) {
    const ageHours =
      (nowMs - new Date(targetPlayer.lastUpdatedAt).getTime()) / 3600000;
    staleness = ageHours < STALENESS_THRESHOLD_HOURS ? 'fresh' : 'stale';
  }

  const baseMultiplier = AVAILABILITY_CONFIDENCE_MAP[targetPlayer.status];

  // ── Key teammate impact ──────────────────────────────────────────────────
  let teammateImpact = 1.0;
  let teammateReason = '';
  if (keyTeammateAvailability?.length) {
    const outTeammates = keyTeammateAvailability.filter(
      (p) => p.status === 'out',
    );
    const questionableTeammates = keyTeammateAvailability.filter(
      (p) => p.status === 'questionable' || p.status === 'doubtful',
    );
    if (outTeammates.length > 0) {
      // Star out changes game script → less certainty on stat projections
      teammateImpact = 0.85;
      teammateReason = 'key_teammate_out';
    } else if (questionableTeammates.length > 0) {
      teammateImpact = 0.92;
      teammateReason = 'key_teammate_questionable';
    }
  }

  const confidenceMultiplier = Math.max(0, baseMultiplier * teammateImpact);

  // ── Recommendation adjustment ────────────────────────────────────────────
  let recommendationAdjustment: AvailabilityConfidenceResult['recommendationAdjustment'];
  if (targetPlayer.status === 'out') {
    recommendationAdjustment = 'suppress';
  } else if (
    targetPlayer.status === 'doubtful' ||
    confidenceMultiplier < 0.45
  ) {
    recommendationAdjustment = 'hold';
  } else if (
    staleness === 'stale' ||
    targetPlayer.status === 'questionable'
  ) {
    recommendationAdjustment = 'reduce_stake';
  } else {
    recommendationAdjustment = 'none';
  }

  const reasons = [
    `status_${targetPlayer.status}`,
    staleness !== 'unknown' ? `data_${staleness}` : null,
    teammateReason || null,
  ]
    .filter(Boolean)
    .join(',');

  return {
    confidenceMultiplier,
    recommendationAdjustment,
    reason: reasons,
    staleness,
  };
}
