/**
 * Band Assignment
 *
 * Determines the initial promotion band for a selected pick based on
 * edge strength and selection score. This is the first stage of the
 * band calibration pipeline — downgrades are applied separately.
 *
 * Pure function: same input always produces same output.
 */

import { EDGE_THRESHOLDS, SELECTION_SCORE_THRESHOLDS, THRESHOLD_VERSION } from './thresholds.js';
import type { BandInput, BandTier } from './types.js';

/**
 * Assign an initial band based on edge and selection score.
 *
 * Band tiers are evaluated top-down (A+ first). A pick qualifies for a tier
 * if it meets both the edge threshold AND the selection score threshold
 * (when a score threshold exists for that tier).
 *
 * Picks with selectionDecision !== 'select' are immediately suppressed.
 */
export function initialBandAssignment(input: BandInput): {
  band: BandTier;
  reasons: string[];
  thresholdVersion: string;
} {
  const reasons: string[] = [];

  if (input.selectionDecision !== 'select') {
    reasons.push(`selection_not_selected:${input.selectionDecision}`);
    return { band: 'SUPPRESS', reasons, thresholdVersion: THRESHOLD_VERSION };
  }

  const score = input.selectionScore ?? null;
  const tiers: Exclude<BandTier, 'SUPPRESS'>[] = ['A+', 'A', 'B', 'C'];

  for (const tier of tiers) {
    const edgeOk = input.edge >= EDGE_THRESHOLDS[tier];
    const scoreThreshold = SELECTION_SCORE_THRESHOLDS[tier];
    const scoreOk = scoreThreshold === null || (score !== null && score >= scoreThreshold);

    if (edgeOk && scoreOk) {
      reasons.push(
        `initial_band:${tier}:edge=${input.edge.toFixed(4)}>=${EDGE_THRESHOLDS[tier]}` +
          (scoreThreshold !== null ? `,score=${score?.toFixed(1)}>=${scoreThreshold}` : ''),
      );
      return { band: tier, reasons, thresholdVersion: THRESHOLD_VERSION };
    }
  }

  reasons.push(
    `no_tier_qualified:edge=${input.edge.toFixed(4)},score=${score?.toFixed(1) ?? 'null'}`,
  );
  return { band: 'SUPPRESS', reasons, thresholdVersion: THRESHOLD_VERSION };
}
