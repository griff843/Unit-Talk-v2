import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeBrierScore,
  computeCalibrationMetrics,
  computeECE,
  computeLogLoss,
  computeMCE,
  computeReliabilityBuckets,
  DEFAULT_BUCKET_WIDTH,
  type PredictionOutcome,
  computeSliceCalibrationMetrics,
  computeCalibrationAlertLevel,
  CALIBRATION_THRESHOLDS,
  type SlicedPredictionOutcome,
} from './calibration.js';

const predictions: PredictionOutcome[] = [
  { pFinal: 0.8, outcome: 1, pickId: 'a' },
  { pFinal: 0.7, outcome: 1, pickId: 'b' },
  { pFinal: 0.3, outcome: 0, pickId: 'c' },
  { pFinal: 0.2, outcome: 0, pickId: 'd' }
];

test('computeBrierScore returns deterministic fixed-input value', () => {
  assert.equal(computeBrierScore(predictions), 0.065);
});

test('computeLogLoss returns deterministic fixed-input value', () => {
  assert.equal(computeLogLoss(predictions), 0.289909);
});

test('computeReliabilityBuckets groups predictions into buckets', () => {
  const buckets = computeReliabilityBuckets(predictions, DEFAULT_BUCKET_WIDTH);
  assert.ok(buckets.length >= 2);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 4);
});

test('computeECE returns zero for perfectly aligned bucket outcomes', () => {
  const aligned: PredictionOutcome[] = [
    { pFinal: 0, outcome: 0 },
    { pFinal: 0, outcome: 0 },
    { pFinal: 1, outcome: 1 },
    { pFinal: 1, outcome: 1 }
  ];
  const buckets = computeReliabilityBuckets(aligned, 0.5);
  assert.equal(computeECE(buckets, aligned.length), 0);
});

test('computeMCE returns the max calibration error across buckets', () => {
  const buckets = computeReliabilityBuckets(predictions, DEFAULT_BUCKET_WIDTH);
  assert.ok(computeMCE(buckets) >= 0);
});

test('computeCalibrationMetrics returns a complete metrics bundle', () => {
  const metrics = computeCalibrationMetrics(
    predictions,
    'model-1',
    'prob-model-1'
  );
  assert.equal(metrics.sampleSize, 4);
  assert.equal(metrics.winCount, 2);
  assert.equal(metrics.lossCount, 2);
  assert.equal(metrics.modelVersion, 'model-1');
  assert.equal(metrics.probabilityModelVersion, 'prob-model-1');
});

test('empty inputs return zero-safe metrics from base functions', () => {
  assert.equal(computeBrierScore([]), 0);
  assert.equal(computeLogLoss([]), 0);
  assert.deepEqual(computeReliabilityBuckets([]), []);
  assert.equal(computeECE([], 0), 0);
  assert.equal(computeMCE([]), 0);
});

// ── computeSliceCalibrationMetrics ───────────────────────────────────────────

test('computeSliceCalibrationMetrics groups predictions by sport+marketFamily', () => {
  const preds: SlicedPredictionOutcome[] = [
    ...Array.from({ length: 15 }, (_, i) => ({
      pFinal: 0.55,
      outcome: (i % 2) as 0 | 1,
      sport: 'NBA',
      marketFamily: 'player-prop',
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      pFinal: 0.6,
      outcome: (i % 2) as 0 | 1,
      sport: 'NFL',
      marketFamily: 'spread',
    })),
  ];

  const result = computeSliceCalibrationMetrics(preds, 'v1', 'pv1');

  assert.equal(result.length, 2);

  const nba = result.find((s) => s.sport === 'NBA' && s.marketFamily === 'player-prop');
  assert.ok(nba !== undefined, 'NBA slice missing');
  assert.equal(nba.sliceKey, 'NBA:player-prop');
  assert.equal(nba.sampleSize, 15);
  assert.ok(nba.brierScore > 0, 'brierScore should be computed for NBA slice');

  const nfl = result.find((s) => s.sport === 'NFL' && s.marketFamily === 'spread');
  assert.ok(nfl !== undefined, 'NFL slice missing');
  assert.equal(nfl.sliceKey, 'NFL:spread');
  assert.equal(nfl.sampleSize, 12);
  assert.ok(nfl.brierScore > 0, 'brierScore should be computed for NFL slice');
});

test('computeSliceCalibrationMetrics returns minimal entry for slices with < 10 samples', () => {
  const preds: SlicedPredictionOutcome[] = [
    { pFinal: 0.6, outcome: 1, sport: 'NHL', marketFamily: 'puck-line' },
    { pFinal: 0.4, outcome: 0, sport: 'NHL', marketFamily: 'puck-line' },
    // only 2 samples → below MIN_SLICE_SAMPLES
  ];

  const result = computeSliceCalibrationMetrics(preds, 'v1', 'pv1');

  assert.equal(result.length, 1);
  const slice = result[0]!;
  assert.equal(slice.sport, 'NHL');
  assert.equal(slice.marketFamily, 'puck-line');
  assert.equal(slice.sampleSize, 2);
  // Metrics should be zero (not an error)
  assert.equal(slice.brierScore, 0);
  assert.equal(slice.ece, 0);
  assert.equal(slice.logLoss, 0);
  assert.deepEqual(slice.buckets, []);
});

test('computeSliceCalibrationMetrics handles missing sport/marketFamily as null', () => {
  const preds: SlicedPredictionOutcome[] = Array.from({ length: 10 }, (_, i) => ({
    pFinal: 0.6,
    outcome: (i % 2) as 0 | 1,
    // sport and marketFamily undefined
  }));

  const result = computeSliceCalibrationMetrics(preds, 'v1', 'pv1');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.sport, null);
  assert.equal(result[0]!.marketFamily, null);
  assert.equal(result[0]!.sliceKey, 'global:all');
});

test('computeSliceCalibrationMetrics returns empty array for empty input', () => {
  const result = computeSliceCalibrationMetrics([], 'v1', 'pv1');
  assert.deepEqual(result, []);
});

// ── computeCalibrationAlertLevel ─────────────────────────────────────────────

test('computeCalibrationAlertLevel returns green for sample below minSampleForAlert', () => {
  const metrics = computeCalibrationMetrics(
    [{ pFinal: 0.9, outcome: 0 }, { pFinal: 0.9, outcome: 0 }],
    'v1',
    'pv1'
  );
  // Only 2 samples, well below the 30-sample threshold — even with bad scores
  assert.equal(computeCalibrationAlertLevel(metrics), 'green');
});

test('computeCalibrationAlertLevel returns warning at warning threshold boundary', () => {
  // Construct metrics with brierScore just at the warning threshold
  const sufficientPreds: PredictionOutcome[] = Array.from({ length: 30 }, (_, i) => ({
    pFinal: 0.6,
    outcome: (i % 3 === 0 ? 0 : 1) as 0 | 1,
  }));
  const metrics = computeCalibrationMetrics(sufficientPreds, 'v1', 'pv1');

  // Force metrics fields to be at exactly the warning threshold via an inline override
  const syntheticMetrics = {
    ...metrics,
    brierScore: CALIBRATION_THRESHOLDS.brier.warning, // exactly at warning
    ece: 0,
    logLoss: 0,
  };
  assert.equal(computeCalibrationAlertLevel(syntheticMetrics), 'warning');
});

test('computeCalibrationAlertLevel returns critical at critical threshold boundary', () => {
  const sufficientPreds: PredictionOutcome[] = Array.from({ length: 30 }, (_, i) => ({
    pFinal: 0.6,
    outcome: (i % 3 === 0 ? 0 : 1) as 0 | 1,
  }));
  const metrics = computeCalibrationMetrics(sufficientPreds, 'v1', 'pv1');

  const syntheticMetrics = {
    ...metrics,
    brierScore: CALIBRATION_THRESHOLDS.brier.critical, // at critical
    ece: 0,
    logLoss: 0,
  };
  assert.equal(computeCalibrationAlertLevel(syntheticMetrics), 'critical');
});

test('computeCalibrationAlertLevel returns green for well-calibrated metrics with sufficient samples', () => {
  // Build synthetic metrics well below all thresholds with enough samples
  // pFinal=0.5 gives logLoss≈0.693 which is above the warning threshold (0.65),
  // so we use a synthetic metrics object with known-good values instead
  const sufficientPreds: PredictionOutcome[] = Array.from({ length: 30 }, (_, i) => ({
    pFinal: 0.5,
    outcome: (i % 2) as 0 | 1,
  }));
  const base = computeCalibrationMetrics(sufficientPreds, 'v1', 'pv1');
  const syntheticMetrics = {
    ...base,
    brierScore: 0.10,  // well below warning (0.28)
    ece: 0.02,          // well below warning (0.06)
    logLoss: 0.30,      // well below warning (0.65)
  };
  assert.equal(computeCalibrationAlertLevel(syntheticMetrics), 'green');
});

test('computeCalibrationAlertLevel triggers critical when ECE exceeds critical threshold', () => {
  const sufficientPreds: PredictionOutcome[] = Array.from({ length: 30 }, () => ({
    pFinal: 0.5,
    outcome: 1 as 0 | 1,
  }));
  const metrics = computeCalibrationMetrics(sufficientPreds, 'v1', 'pv1');
  const syntheticMetrics = {
    ...metrics,
    ece: CALIBRATION_THRESHOLDS.ece.critical,
    brierScore: 0,
    logLoss: 0,
  };
  assert.equal(computeCalibrationAlertLevel(syntheticMetrics), 'critical');
});
