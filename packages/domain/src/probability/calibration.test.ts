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
  type PredictionOutcome
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
