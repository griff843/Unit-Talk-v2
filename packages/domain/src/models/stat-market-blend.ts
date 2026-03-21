/**
 * Stat-Market Blend Layer
 *
 * This is the ONLY layer where market information is introduced.
 *
 * Blends:
 *   P_stat  (from stat projection engine)
 *   P_market (from devig consensus)
 *
 * into P_final with divergence tracking.
 */

import type { StatProjectionOutput } from './stat-distribution.js';

// ── Output Contract ──────────────────────────────────────────────────────────

export interface BlendOutput {
  // Core probabilities
  p_final: number;
  p_stat: number;
  p_market: number;

  // Weight allocation
  stat_weight: number;
  market_weight: number;

  // Divergence tracking
  stat_alpha: number;
  divergence: number;
  divergence_direction: number;

  // Edge measurement
  edge_vs_market: number;

  // Metadata
  blend_version: string;
  sport?: string;
  market_type?: string;
}

export type BlendResult =
  | { ok: true; data: BlendOutput }
  | { ok: false; reason: string };

// ── Configuration ────────────────────────────────────────────────────────────

export interface BlendConfig {
  /** Base weight for stat model (0-1). Default: 0.3 (market-heavy initially) */
  base_stat_weight?: number;
  /** Confidence scaling: how much stat model confidence affects weight */
  confidence_scaling?: number;
  /** Sport identifier for logging */
  sport?: string;
  /** Market type for logging */
  market_type?: string;
}

/** Per-sport default weights. Conservative until stat model is proven. */
const SPORT_DEFAULTS: Record<string, { base_stat_weight: number }> = {
  nba: { base_stat_weight: 0.3 },
  nfl: { base_stat_weight: 0.25 },
  mlb: { base_stat_weight: 0.25 },
  nhl: { base_stat_weight: 0.2 },
};

const DEFAULT_BASE_STAT_WEIGHT = 0.3;
const DEFAULT_CONFIDENCE_SCALING = 0.5;
const BLEND_VERSION = 'stat-market-blend-v1.0';

// ── Core Computation ─────────────────────────────────────────────────────────

/**
 * Blend stat projection probability with market devig probability.
 *
 * Market information enters HERE and ONLY here.
 *
 * p_final = w_stat × p_stat + w_market × p_market
 */
export function computeStatMarketBlend(
  statProjection: StatProjectionOutput,
  p_market_devig: number,
  config: BlendConfig = {},
): BlendResult {
  if (p_market_devig <= 0 || p_market_devig >= 1) {
    return {
      ok: false,
      reason: `Invalid p_market_devig: ${p_market_devig} (must be in (0,1))`,
    };
  }

  const sport = config.sport;
  const sportDefaults = sport
    ? SPORT_DEFAULTS[sport.toLowerCase()]
    : undefined;
  const baseStatWeight =
    config.base_stat_weight ??
    sportDefaults?.base_stat_weight ??
    DEFAULT_BASE_STAT_WEIGHT;
  const confidenceScaling =
    config.confidence_scaling ?? DEFAULT_CONFIDENCE_SCALING;

  const p_stat = statProjection.p_over;

  // ── Weight Calculation ─────────────────────────────────────────────────
  const confidenceModifier =
    1 + (statProjection.confidence - 0.5) * confidenceScaling;
  const rawStatWeight = baseStatWeight * confidenceModifier;
  const statWeight = round4(clamp(rawStatWeight, 0.05, 0.7));
  const marketWeight = round4(1 - statWeight);

  // ── Blend ──────────────────────────────────────────────────────────────
  const pFinal = round4(
    clamp(statWeight * p_stat + marketWeight * p_market_devig, 0.001, 0.999),
  );

  // ── Divergence ─────────────────────────────────────────────────────────
  const statAlpha = round4(p_stat - p_market_devig);
  const divergence = round4(Math.abs(statAlpha));
  const divergenceDirection =
    statAlpha > 0.001 ? 1 : statAlpha < -0.001 ? -1 : 0;

  // ── Edge ───────────────────────────────────────────────────────────────
  const edgeVsMarket = round4(pFinal - p_market_devig);

  return {
    ok: true,
    data: {
      p_final: pFinal,
      p_stat: round4(p_stat),
      p_market: round4(p_market_devig),
      stat_weight: statWeight,
      market_weight: marketWeight,
      stat_alpha: statAlpha,
      divergence,
      divergence_direction: divergenceDirection,
      edge_vs_market: edgeVsMarket,
      blend_version: BLEND_VERSION,
      ...(config.sport !== undefined ? { sport: config.sport } : {}),
      ...(config.market_type !== undefined
        ? { market_type: config.market_type }
        : {}),
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
