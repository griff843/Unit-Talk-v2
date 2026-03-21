import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calibrate, calibrateBatch } from './engine.js';
import {
  computeCalibrationMetrics,
  compareCalibration,
  compareCalibrationByBand,
} from './analysis.js';
import {
  DEFAULT_CALIBRATION_PROFILE,
  IDENTITY_CALIBRATION_PROFILE,
  CALIBRATION_VERSION,
} from './version.js';
import type { CalibrationInput, CalibrationOutcomeRecord } from './types.js';

describe('calibrate', () => {
  it('returns calibrated probability with version and delta', () => {
    const input: CalibrationInput = { p_final: 0.55, band: 'A' };
    const result = calibrate(input);
    assert.ok(result.p_calibrated > 0 && result.p_calibrated < 1);
    assert.equal(result.calibrationVersion, CALIBRATION_VERSION);
    assert.ok(typeof result.delta === 'number');
  });

  it('identity profile returns ~same probability', () => {
    const input: CalibrationInput = { p_final: 0.55, band: 'A' };
    const result = calibrate(input, IDENTITY_CALIBRATION_PROFILE);
    assert.ok(Math.abs(result.p_calibrated - 0.55) < 0.001);
    assert.ok(Math.abs(result.delta) < 0.001);
  });

  it('bounds output in (0,1)', () => {
    const nearZero = calibrate({ p_final: 0.0001, band: 'C' });
    assert.ok(nearZero.p_calibrated > 0);
    const nearOne = calibrate({ p_final: 0.9999, band: 'C' });
    assert.ok(nearOne.p_calibrated < 1);
  });

  it('platt scaling compresses extreme probabilities', () => {
    // Default profile: a=0.95, b=0.01
    // For high p, compression should pull slightly toward 0.5
    const input: CalibrationInput = { p_final: 0.85, band: 'A' };
    const result = calibrate(input);
    // With a=0.95 < 1.0, extreme probs get compressed
    assert.ok(result.p_calibrated < 0.85);
    assert.ok(result.p_calibrated > 0.5);
  });

  it('uses per-band config when available', () => {
    const profile = {
      ...DEFAULT_CALIBRATION_PROFILE,
      byBand: {
        'A+': { method: 'identity' as const },
      },
    };
    const resultAPplus = calibrate({ p_final: 0.70, band: 'A+' }, profile);
    const resultA = calibrate({ p_final: 0.70, band: 'A' }, profile);
    // A+ uses identity, A uses platt — should differ
    assert.ok(Math.abs(resultAPplus.p_calibrated - resultA.p_calibrated) > 0.001);
  });
});

describe('calibrateBatch', () => {
  it('calibrates multiple inputs', () => {
    const inputs: CalibrationInput[] = [
      { p_final: 0.55, band: 'A' },
      { p_final: 0.65, band: 'B' },
      { p_final: 0.45, band: 'C' },
    ];
    const results = calibrateBatch(inputs);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.ok(r.p_calibrated > 0 && r.p_calibrated < 1);
    }
  });
});

describe('computeCalibrationMetrics', () => {
  it('returns zero metrics for empty input', () => {
    const metrics = computeCalibrationMetrics([]);
    assert.equal(metrics.brierScore, 0);
    assert.equal(metrics.logLoss, 0);
    assert.equal(metrics.ece, 0);
    assert.equal(metrics.sampleSize, 0);
  });

  it('computes brier score for perfect predictions', () => {
    const predictions = [
      { p: 1.0, outcome: 1 as const },
      { p: 0.0, outcome: 0 as const },
    ];
    const metrics = computeCalibrationMetrics(predictions);
    assert.ok(metrics.brierScore < 0.01);
  });

  it('computes higher brier score for bad predictions', () => {
    const predictions = [
      { p: 0.0, outcome: 1 as const },
      { p: 1.0, outcome: 0 as const },
    ];
    const metrics = computeCalibrationMetrics(predictions);
    assert.ok(metrics.brierScore > 0.9);
  });

  it('returns correct sample size', () => {
    const predictions = [
      { p: 0.5, outcome: 1 as const },
      { p: 0.5, outcome: 0 as const },
      { p: 0.5, outcome: 1 as const },
    ];
    const metrics = computeCalibrationMetrics(predictions);
    assert.equal(metrics.sampleSize, 3);
  });

  it('builds reliability curve with correct bucket count', () => {
    const predictions = Array.from({ length: 100 }, (_, i) => ({
      p: i / 100,
      outcome: (i % 2 === 0 ? 1 : 0) as 0 | 1,
    }));
    const metrics = computeCalibrationMetrics(predictions, 5);
    assert.equal(metrics.reliabilityCurve.length, 5);
  });
});

describe('compareCalibration', () => {
  it('filters out PUSH outcomes', () => {
    const records: CalibrationOutcomeRecord[] = [
      { p_final: 0.6, p_calibrated: 0.58, outcome: 'WIN', band: 'A' },
      { p_final: 0.5, p_calibrated: 0.5, outcome: 'PUSH', band: 'A' },
      { p_final: 0.4, p_calibrated: 0.42, outcome: 'LOSS', band: 'B' },
    ];
    const result = compareCalibration(records);
    assert.equal(result.preCal.sampleSize, 2);
    assert.equal(result.postCal.sampleSize, 2);
  });

  it('reports brierImproved correctly', () => {
    const records: CalibrationOutcomeRecord[] = [
      { p_final: 0.8, p_calibrated: 0.9, outcome: 'WIN', band: 'A' },
      { p_final: 0.2, p_calibrated: 0.1, outcome: 'LOSS', band: 'A' },
    ];
    const result = compareCalibration(records);
    assert.equal(typeof result.brierImproved, 'boolean');
    assert.equal(typeof result.logLossAcceptable, 'boolean');
  });
});

describe('compareCalibrationByBand', () => {
  it('returns comparison per band', () => {
    const records: CalibrationOutcomeRecord[] = [
      { p_final: 0.7, p_calibrated: 0.68, outcome: 'WIN', band: 'A' },
      { p_final: 0.6, p_calibrated: 0.62, outcome: 'LOSS', band: 'A' },
      { p_final: 0.55, p_calibrated: 0.54, outcome: 'WIN', band: 'B' },
      { p_final: 0.45, p_calibrated: 0.46, outcome: 'LOSS', band: 'B' },
    ];
    const result = compareCalibrationByBand(records);
    assert.ok('A' in result);
    assert.ok('B' in result);
    assert.equal(result['A']!.preCal.sampleSize, 2);
    assert.equal(result['B']!.preCal.sampleSize, 2);
  });
});
