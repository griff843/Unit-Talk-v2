/**
 * Calibration Engine
 *
 * Applies deterministic probability calibration transforms.
 *
 * Supported methods:
 *   1. Platt scaling — logistic correction via sigmoid(a * logit(p) + b)
 *   2. Histogram — bin-based reliability adjustment
 *   3. Identity — no-op pass-through
 *
 * All transforms are pure functions: same input + config → same output.
 * Probability bounds are enforced: output ∈ (eps, 1 - eps).
 */

import { DEFAULT_CALIBRATION_PROFILE } from './version.js';
import type {
  CalibrationInput,
  CalibrationOutput,
  CalibrationConfig,
  CalibrationProfile,
  PlattParams,
  CalibrationBin,
} from './types.js';
import type { BandTier } from '../bands/types.js';

const EPS = 1e-7;

/**
 * Calibrate a single probability estimate.
 */
export function calibrate(
  input: CalibrationInput,
  profile: CalibrationProfile = DEFAULT_CALIBRATION_PROFILE,
): CalibrationOutput {
  const config = resolveConfig(input.band, profile);
  const pCal = applyTransform(input.p_final, config);

  return {
    p_calibrated: pCal,
    calibrationVersion: profile.version,
    delta: round6(pCal - input.p_final),
  };
}

/**
 * Calibrate a batch of probability estimates.
 */
export function calibrateBatch(
  inputs: CalibrationInput[],
  profile: CalibrationProfile = DEFAULT_CALIBRATION_PROFILE,
): CalibrationOutput[] {
  return inputs.map((input) => calibrate(input, profile));
}

function resolveConfig(
  band: Exclude<BandTier, 'SUPPRESS'>,
  profile: CalibrationProfile,
): CalibrationConfig {
  const bandConfig = profile.byBand?.[band];
  return bandConfig ?? profile.global;
}

function applyTransform(p: number, config: CalibrationConfig): number {
  const clamped = clamp(p, EPS, 1 - EPS);

  switch (config.method) {
    case 'platt':
      return applyPlatt(clamped, config.plattParams!);
    case 'histogram':
      return applyHistogram(clamped, config.bins!);
    case 'identity':
      return clamped;
  }
}

/**
 * Platt scaling: maps p through logistic correction.
 *
 * logit(p) = ln(p / (1 - p))
 * p_calibrated = sigmoid(a * logit(p) + b) = 1 / (1 + exp(-(a * logit(p) + b)))
 */
function applyPlatt(p: number, params: PlattParams): number {
  const logit = Math.log(p / (1 - p));
  const z = params.a * logit + params.b;
  const result = 1 / (1 + Math.exp(-z));
  return clamp(result, EPS, 1 - EPS);
}

/**
 * Histogram calibration: maps p to the observed rate in the matching bin.
 */
function applyHistogram(p: number, bins: CalibrationBin[]): number {
  if (bins.length === 0) return p;

  const bin = bins.find((b) => p >= b.lower && p < b.upper);
  if (bin) {
    return clamp(bin.observedRate, EPS, 1 - EPS);
  }

  if (p >= bins[bins.length - 1]!.upper) {
    return clamp(bins[bins.length - 1]!.observedRate, EPS, 1 - EPS);
  }
  return clamp(bins[0]!.observedRate, EPS, 1 - EPS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
