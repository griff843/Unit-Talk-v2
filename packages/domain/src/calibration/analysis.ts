/**
 * Calibration Analysis
 *
 * Computes calibration error metrics and compares pre- vs post-calibration
 * performance. Used to verify that calibration improves probability
 * reliability without degrading overall model quality.
 *
 * Metrics computed:
 *   - Brier score
 *   - Log loss
 *   - Expected Calibration Error (ECE)
 *   - Reliability curve buckets
 */

import type {
  CalibrationMetrics,
  CalibrationComparison,
  CalibrationOutcomeRecord,
  ReliabilityBucket,
} from './types.js';

const EPS = 1e-7;
const DEFAULT_NUM_BUCKETS = 10;
const LOG_LOSS_TOLERANCE = 0.01;

/**
 * Compute calibration metrics for a set of predictions.
 */
export function computeCalibrationMetrics(
  predictions: Array<{ p: number; outcome: 0 | 1 }>,
  numBuckets: number = DEFAULT_NUM_BUCKETS,
): CalibrationMetrics {
  if (predictions.length === 0) {
    return emptyMetrics();
  }

  const brier = computeBrierScore(predictions);
  const ll = computeLogLoss(predictions);
  const curve = buildReliabilityCurve(predictions, numBuckets);
  const ece = computeECE(curve, predictions.length);

  return {
    brierScore: round6(brier),
    logLoss: round6(ll),
    ece: round6(ece),
    reliabilityCurve: curve,
    sampleSize: predictions.length,
  };
}

/**
 * Compare pre- and post-calibration metrics from outcome records.
 */
export function compareCalibration(records: CalibrationOutcomeRecord[]): CalibrationComparison {
  const binary = records.filter((r) => r.outcome !== 'PUSH');

  const prePredictions = binary.map((r) => ({
    p: r.p_final,
    outcome: (r.outcome === 'WIN' ? 1 : 0) as 0 | 1,
  }));

  const postPredictions = binary.map((r) => ({
    p: r.p_calibrated,
    outcome: (r.outcome === 'WIN' ? 1 : 0) as 0 | 1,
  }));

  const preCal = computeCalibrationMetrics(prePredictions);
  const postCal = computeCalibrationMetrics(postPredictions);

  const brierDelta = round6(postCal.brierScore - preCal.brierScore);
  const logLossDelta = round6(postCal.logLoss - preCal.logLoss);
  const eceDelta = round6(postCal.ece - preCal.ece);

  return {
    preCal,
    postCal,
    improvement: {
      brierDelta,
      logLossDelta,
      eceDelta,
    },
    brierImproved: brierDelta <= 0,
    logLossAcceptable: logLossDelta < LOG_LOSS_TOLERANCE,
  };
}

/**
 * Compare calibration metrics by band.
 */
export function compareCalibrationByBand(
  records: CalibrationOutcomeRecord[],
): Record<string, CalibrationComparison> {
  const bands = new Set(records.map((r) => r.band));
  const result: Record<string, CalibrationComparison> = {};

  for (const band of bands) {
    const bandRecords = records.filter((r) => r.band === band);
    result[band] = compareCalibration(bandRecords);
  }

  return result;
}

function computeBrierScore(predictions: Array<{ p: number; outcome: 0 | 1 }>): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((s, { p, outcome }) => s + (outcome - p) ** 2, 0);
  return sum / predictions.length;
}

function computeLogLoss(predictions: Array<{ p: number; outcome: 0 | 1 }>): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((s, { p, outcome }) => {
    const pClamped = Math.max(EPS, Math.min(1 - EPS, p));
    return s - (outcome * Math.log(pClamped) + (1 - outcome) * Math.log(1 - pClamped));
  }, 0);
  return sum / predictions.length;
}

function computeECE(curve: ReliabilityBucket[], totalSamples: number): number {
  if (totalSamples === 0) return 0;
  return curve.reduce(
    (s, bucket) => s + (bucket.count / totalSamples) * Math.abs(bucket.observed - bucket.predicted),
    0,
  );
}

function buildReliabilityCurve(
  predictions: Array<{ p: number; outcome: 0 | 1 }>,
  numBuckets: number,
): ReliabilityBucket[] {
  const bucketWidth = 1 / numBuckets;
  const buckets: ReliabilityBucket[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const lower = i * bucketWidth;
    const upper = (i + 1) * bucketWidth;
    const inBucket = predictions.filter(
      (p) => p.p >= lower && (i === numBuckets - 1 ? p.p <= upper : p.p < upper),
    );

    const count = inBucket.length;
    const predicted =
      count > 0 ? inBucket.reduce((s, r) => s + r.p, 0) / count : lower + bucketWidth / 2;
    const observed = count > 0 ? inBucket.reduce((s, r) => s + r.outcome, 0) / count : 0;

    buckets.push({
      predicted: round6(predicted),
      observed: round6(observed),
      count,
      lower: round6(lower),
      upper: round6(upper),
    });
  }

  return buckets;
}

function emptyMetrics(): CalibrationMetrics {
  return {
    brierScore: 0,
    logLoss: 0,
    ece: 0,
    reliabilityCurve: [],
    sampleSize: 0,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
