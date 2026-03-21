/**
 * Enhanced CLV Forecast (V2)
 *
 * Incorporates signal features into CLV forecasting:
 * - Edge component (50% weight)
 * - Movement score (20% weight)
 * - Sharp divergence signal (15% weight)
 * - Market conviction from dispersion (15% weight)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface CLVForecastV2Result {
  clv_forecast: number;
  components: {
    edge_component: number;
    movement_component: number;
    sharp_component: number;
    conviction_component: number;
  };
}

// ── Computation ─────────────────────────────────────────────────────────────

/**
 * Compute enhanced CLV forecast with signal features.
 *
 * Formula:
 *   clv = 0.5 * edge
 *       + 0.2 * movement_score
 *       + 0.15 * sharp_weight_score * sharp_direction
 *       + 0.15 * (1 - dispersion_score)
 *
 * Clamped to [-1, +1].
 */
export function computeCLVForecastV2(
  edge: number,
  movement_score: number,
  sharp_weight_score: number,
  sharp_direction: number,
  dispersion_score: number,
): CLVForecastV2Result {
  const edge_component = 0.5 * edge;
  const movement_component = 0.2 * movement_score;
  const sharp_component = 0.15 * sharp_weight_score * sharp_direction;
  const conviction_component = 0.15 * (1 - dispersion_score);

  const raw =
    edge_component + movement_component + sharp_component + conviction_component;
  const clv_forecast = Math.max(-1, Math.min(1, raw));

  return {
    clv_forecast,
    components: {
      edge_component,
      movement_component,
      sharp_component,
      conviction_component,
    },
  };
}
