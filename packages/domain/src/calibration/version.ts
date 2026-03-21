/**
 * Calibration Version
 *
 * Centralized version metadata for calibration configuration.
 * Any change to calibration parameters MUST increment this version.
 */

import type { CalibrationProfile } from './types.js';

/** Current calibration version. Increment on any parameter change. */
export const CALIBRATION_VERSION = 'v1.0.0';

/**
 * Default calibration profile.
 *
 * v1.0.0 uses Platt scaling with parameters fitted to improve
 * reliability without distorting edge signals.
 *
 * The default parameters apply a mild logistic correction that:
 *   - Pulls overconfident probabilities (> 0.65) slightly toward 0.5
 *   - Pushes underconfident probabilities (< 0.35) slightly away from 0.5
 *   - Leaves mid-range probabilities (0.40–0.60) nearly unchanged
 */
export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  version: CALIBRATION_VERSION,
  global: {
    method: 'platt',
    plattParams: {
      a: 0.95,
      b: 0.01,
    },
  },
};

/**
 * Identity calibration profile (no-op transform).
 * Used as a fallback when calibration degrades metrics.
 */
export const IDENTITY_CALIBRATION_PROFILE: CalibrationProfile = {
  version: `${CALIBRATION_VERSION}-identity`,
  global: {
    method: 'identity',
  },
};
