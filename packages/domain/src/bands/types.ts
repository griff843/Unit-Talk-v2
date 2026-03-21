/**
 * Promotion Band Types
 *
 * Type definitions for the deterministic promotion band calibration layer.
 * Defines the contract between the pick selection engine and the publication
 * tier assignment system.
 */

/** Publication quality tiers, ordered highest to lowest. */
export type BandTier = 'A+' | 'A' | 'B' | 'C' | 'SUPPRESS';

/** Ordered band tiers for comparison (index 0 = highest). */
export const BAND_ORDER: readonly BandTier[] = ['A+', 'A', 'B', 'C', 'SUPPRESS'] as const;

/**
 * Liquidity classification for band assignment.
 * Separate from the devig module's LiquidityTier (which lacks 'unknown').
 */
export type BandLiquidityTier = 'high' | 'medium' | 'low' | 'unknown';

/** Risk decision from the risk-sizing layer. */
export type RiskDecision = 'allow' | 'reduce' | 'reject';

/** Selection decision from the pick selection engine. */
export type SelectionDecision = 'select' | 'hold' | 'reject';

/**
 * Input to the band assignment pipeline.
 * All fields sourced from the pick selection engine and upstream intelligence layers.
 */
export interface BandInput {
  /** True edge = P_final - P_market_devig. Primary quality signal. */
  edge: number;

  /** Model uncertainty estimate (0-1, lower = more confident). */
  uncertainty: number;

  /** Predicted CLV direction/magnitude (-1 to 1). */
  clvForecast: number;

  /** Liquidity classification based on book count. */
  liquidityTier: BandLiquidityTier;

  /** Market resistance / sharp fade signal (0-1, higher = more resistance). */
  marketResistance?: number | null;

  /** Risk decision from risk-sizing layer. */
  riskDecision?: RiskDecision | null;

  /** Reason codes from risk throttle evaluation. */
  riskThrottleReasonCodes?: string[];

  /** Selection outcome from pipeline. */
  selectionDecision: SelectionDecision;

  /** Composite selection score from pick engine (0-100). */
  selectionScore?: number | null;
}

/**
 * Output from the band assignment pipeline.
 * Every selected pick receives exactly one of these.
 */
export interface BandOutput {
  /** Final band after all downgrades applied. */
  finalBand: BandTier;

  /** Initial band before downgrades. */
  initialBand: BandTier;

  /** Reasons the band was downgraded from initial. Empty if no downgrade. */
  downgradeReasons: string[];

  /** Reasons the pick was suppressed. Empty if not suppressed. */
  suppressionReasons: string[];

  /** Version of the threshold config used for this evaluation. */
  thresholdVersion: string;
}
