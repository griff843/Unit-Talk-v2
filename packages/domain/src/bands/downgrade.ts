/**
 * Band Downgrade Rules
 *
 * Applies downgrade and suppression rules to an initial band assignment.
 * Each rule is evaluated independently and the most severe outcome wins.
 *
 * Rule categories:
 *   1. Uncertainty caps — high uncertainty caps or downgrades the band
 *   2. CLV forecast — negative CLV downgrades or suppresses
 *   3. Liquidity — low liquidity caps the band
 *   4. Market resistance — high resistance downgrades or suppresses
 *   5. Risk decision — reject/reduce from risk layer
 *
 * Pure function: same input + initial band always produces same output.
 */

import {
  UNCERTAINTY_CAPS,
  UNCERTAINTY_SUPPRESS_THRESHOLD,
  CLV_THRESHOLDS,
  LIQUIDITY_BAND_CAPS,
  MARKET_RESISTANCE_DOWNGRADE_THRESHOLD,
  MARKET_RESISTANCE_SUPPRESS_THRESHOLD,
  THRESHOLD_VERSION,
  compareBands,
  downgradeOneStep,
} from './thresholds.js';
import type { BandInput, BandTier, BandOutput } from './types.js';

/**
 * Apply all downgrade rules to an initial band assignment.
 * Returns the final band output with full audit trail.
 */
export function applyBandDowngrades(input: BandInput, initialBand: BandTier): BandOutput {
  if (initialBand === 'SUPPRESS') {
    return {
      finalBand: 'SUPPRESS',
      initialBand: 'SUPPRESS',
      downgradeReasons: [],
      suppressionReasons: ['initial_assignment_suppressed'],
      thresholdVersion: THRESHOLD_VERSION,
    };
  }

  let currentBand: BandTier = initialBand;
  const downgradeReasons: string[] = [];
  const suppressionReasons: string[] = [];

  currentBand = applyUncertaintyCaps(input, currentBand, downgradeReasons, suppressionReasons);
  currentBand = applyClvDowngrades(input, currentBand, downgradeReasons, suppressionReasons);
  currentBand = applyLiquidityCaps(input, currentBand, downgradeReasons);
  currentBand = applyMarketResistance(input, currentBand, downgradeReasons, suppressionReasons);
  currentBand = applyRiskDecision(input, currentBand, downgradeReasons, suppressionReasons);

  return {
    finalBand: currentBand,
    initialBand,
    downgradeReasons,
    suppressionReasons,
    thresholdVersion: THRESHOLD_VERSION,
  };
}

function applyUncertaintyCaps(
  input: BandInput,
  band: BandTier,
  downgradeReasons: string[],
  suppressionReasons: string[],
): BandTier {
  if (band === 'SUPPRESS') return band;

  if (input.uncertainty >= UNCERTAINTY_SUPPRESS_THRESHOLD) {
    suppressionReasons.push(
      `uncertainty_extreme:${input.uncertainty.toFixed(4)}>=${UNCERTAINTY_SUPPRESS_THRESHOLD}`,
    );
    return 'SUPPRESS';
  }

  let current: BandTier = band;
  while (current !== 'SUPPRESS' && current !== 'C') {
    const cap = UNCERTAINTY_CAPS[current];
    if (input.uncertainty <= cap) break;

    const next = downgradeOneStep(current);
    downgradeReasons.push(
      `uncertainty_cap:${current}->${next}:${input.uncertainty.toFixed(4)}>${cap}`,
    );
    current = next;
  }

  if (current === 'C' && input.uncertainty > UNCERTAINTY_CAPS.C) {
    suppressionReasons.push(
      `uncertainty_exceeds_c_cap:${input.uncertainty.toFixed(4)}>${UNCERTAINTY_CAPS.C}`,
    );
    return 'SUPPRESS';
  }

  return current;
}

function applyClvDowngrades(
  input: BandInput,
  band: BandTier,
  downgradeReasons: string[],
  suppressionReasons: string[],
): BandTier {
  if (band === 'SUPPRESS') return band;

  if (input.clvForecast < CLV_THRESHOLDS.suppressBelow) {
    suppressionReasons.push(
      `clv_suppress:${input.clvForecast.toFixed(4)}<${CLV_THRESHOLDS.suppressBelow}`,
    );
    return 'SUPPRESS';
  }

  if (input.clvForecast < CLV_THRESHOLDS.downgradeBelow) {
    const next = downgradeOneStep(band);
    downgradeReasons.push(
      `clv_downgrade:${band}->${next}:${input.clvForecast.toFixed(4)}<${CLV_THRESHOLDS.downgradeBelow}`,
    );
    return next;
  }

  return band;
}

function applyLiquidityCaps(
  input: BandInput,
  band: BandTier,
  downgradeReasons: string[],
): BandTier {
  if (band === 'SUPPRESS') return band;

  const cap = LIQUIDITY_BAND_CAPS[input.liquidityTier];
  if (compareBands(band, cap) < 0) {
    downgradeReasons.push(`liquidity_cap:${band}->${cap}:liquidity=${input.liquidityTier}`);
    return cap;
  }

  return band;
}

function applyMarketResistance(
  input: BandInput,
  band: BandTier,
  downgradeReasons: string[],
  suppressionReasons: string[],
): BandTier {
  if (band === 'SUPPRESS') return band;

  const resistance = input.marketResistance;
  if (resistance == null) return band;

  if (resistance >= MARKET_RESISTANCE_SUPPRESS_THRESHOLD) {
    suppressionReasons.push(
      `market_resistance_suppress:${resistance.toFixed(4)}>=${MARKET_RESISTANCE_SUPPRESS_THRESHOLD}`,
    );
    return 'SUPPRESS';
  }

  if (resistance >= MARKET_RESISTANCE_DOWNGRADE_THRESHOLD) {
    const next = downgradeOneStep(band);
    downgradeReasons.push(
      `market_resistance_downgrade:${band}->${next}:${resistance.toFixed(4)}>=${MARKET_RESISTANCE_DOWNGRADE_THRESHOLD}`,
    );
    return next;
  }

  return band;
}

function applyRiskDecision(
  input: BandInput,
  band: BandTier,
  downgradeReasons: string[],
  suppressionReasons: string[],
): BandTier {
  if (band === 'SUPPRESS') return band;

  if (input.riskDecision === 'reject') {
    const codes = input.riskThrottleReasonCodes?.join(',') ?? 'no_codes';
    suppressionReasons.push(`risk_reject:${codes}`);
    return 'SUPPRESS';
  }

  if (input.riskDecision === 'reduce') {
    const next = downgradeOneStep(band);
    const codes = input.riskThrottleReasonCodes?.join(',') ?? 'no_codes';
    downgradeReasons.push(`risk_reduce:${band}->${next}:${codes}`);
    return next;
  }

  return band;
}
