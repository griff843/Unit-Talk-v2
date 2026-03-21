/**
 * Model Blend — p_final_v2
 *
 * Core model separation formula. Blends:
 * - 60% market devig consensus (equal-weight)
 * - 30% sharp-weighted consensus
 * - 10% signal adjustment (movement + disagreement penalty)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface ModelBlendResult {
  p_final_v2: number;
  p_market_devig: number;
  p_sharp: number;
  signal_adjustment: number;
  edge_v2: number;
  components: {
    market_weight: number;
    sharp_weight: number;
    signal_weight: number;
    signal_raw: number;
  };
}

// ── Constants ───────────────────────────────────────────────────────────────

const MARKET_WEIGHT = 0.6;
const SHARP_WEIGHT = 0.3;
const SIGNAL_WEIGHT = 0.1;
const SIGNAL_CLAMP = 0.05;

// ── Computation ─────────────────────────────────────────────────────────────

/**
 * Compute blended p_final_v2 from market consensus, sharp consensus,
 * and signal features.
 *
 * signal_adjustment = clamp(movement_score + disagreement_penalty, -0.05, +0.05)
 * disagreement_penalty = -dispersion_score * 0.5
 *
 * p_final_v2 = 0.6 * p_market_devig + 0.3 * p_sharp + 0.1 * signal_adjustment
 */
export function computeModelBlend(
  p_market_devig: number,
  p_sharp: number,
  movement_score: number,
  dispersion_score: number,
): ModelBlendResult {
  const disagreement_penalty = -dispersion_score * 0.5;
  const signal_raw = movement_score + disagreement_penalty;
  const signal_adjustment = Math.max(
    -SIGNAL_CLAMP,
    Math.min(SIGNAL_CLAMP, signal_raw),
  );

  const p_final_v2 =
    MARKET_WEIGHT * p_market_devig +
    SHARP_WEIGHT * p_sharp +
    SIGNAL_WEIGHT * signal_adjustment;

  // Edge = how much our model diverges from equal-weight market consensus
  const edge_v2 = p_final_v2 - p_market_devig;

  return {
    p_final_v2,
    p_market_devig,
    p_sharp,
    signal_adjustment,
    edge_v2,
    components: {
      market_weight: MARKET_WEIGHT,
      sharp_weight: SHARP_WEIGHT,
      signal_weight: SIGNAL_WEIGHT,
      signal_raw,
    },
  };
}
