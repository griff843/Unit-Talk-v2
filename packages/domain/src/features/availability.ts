/**
 * Availability / injury confidence extractor.
 *
 * Pure domain logic only: callers must provide real availability records from
 * an ingestor or analysis feed. Missing records should be handled by the app
 * layer so no-data and low-impact availability are not collapsed together.
 */

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
  /** Free text from a provider injury or lineup report. */
  injuryNote?: string;
  /** Provider/source name for explainability. */
  source?: string;
  /** ISO timestamp from the provider signal. */
  lastUpdatedAt?: string;
}

export interface AvailabilityConfidenceResult {
  /** 1.0 = no change; 0.5 = major uncertainty. */
  confidenceMultiplier: number;
  recommendationAdjustment: 'none' | 'reduce_stake' | 'hold' | 'suppress';
  reason: string;
  /** Fresh means the provider signal is less than 4 hours old. */
  staleness: 'fresh' | 'stale' | 'unknown';
}

/** Confidence multipliers by availability status. */
export const AVAILABILITY_CONFIDENCE_MAP: Record<AvailabilityStatus, number> = {
  confirmed: 1.0,
  probable: 0.92,
  questionable: 0.70,
  doubtful: 0.40,
  out: 0.0,
  unknown: 0.80,
};

export const STALENESS_THRESHOLD_HOURS = 4;

/**
 * Evaluate availability confidence for a pick candidate.
 *
 * @param targetPlayer Availability for the player being picked.
 * @param keyTeammateAvailability Stars whose absence changes game script.
 * @param now ISO timestamp for staleness reference. Defaults to Date.now().
 */
export function evaluateAvailabilityConfidence(
  targetPlayer: PlayerAvailability,
  keyTeammateAvailability?: PlayerAvailability[],
  now?: string,
): AvailabilityConfidenceResult {
  const nowMs = now ? new Date(now).getTime() : Date.now();

  let staleness: AvailabilityConfidenceResult['staleness'] = 'unknown';
  if (targetPlayer.lastUpdatedAt) {
    const ageHours =
      (nowMs - new Date(targetPlayer.lastUpdatedAt).getTime()) / 3600000;
    staleness = ageHours < STALENESS_THRESHOLD_HOURS ? 'fresh' : 'stale';
  }

  const baseMultiplier = AVAILABILITY_CONFIDENCE_MAP[targetPlayer.status];
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
      teammateImpact = 0.85;
      teammateReason = 'key_teammate_out';
    } else if (questionableTeammates.length > 0) {
      teammateImpact = 0.92;
      teammateReason = 'key_teammate_questionable';
    }
  }

  const confidenceMultiplier = Math.max(0, baseMultiplier * teammateImpact);

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
    targetPlayer.source ? `source_${targetPlayer.source}` : null,
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
