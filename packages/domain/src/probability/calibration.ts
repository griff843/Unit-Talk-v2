import { roundTo } from './devig.js';

export interface PredictionOutcome {
  pFinal: number;
  outcome: 0 | 1;
  pickId?: string;
}

export interface SlicedPredictionOutcome extends PredictionOutcome {
  sport?: string;
  marketFamily?: string;
}

export interface ReliabilityBucket {
  bucketLower: number;
  bucketUpper: number;
  count: number;
  avgPredicted: number;
  observedRate: number;
  calibrationError: number;
  brierContribution: number;
}

export interface CalibrationMetrics {
  sampleSize: number;
  winCount: number;
  lossCount: number;
  brierScore: number;
  ece: number;
  mce: number;
  logLoss: number;
  buckets: ReliabilityBucket[];
  modelVersion: string;
  probabilityModelVersion: string;
}

export const DEFAULT_BUCKET_WIDTH = 0.05;

const LOG_LOSS_EPSILON = 1e-15;

export function computeBrierScore(predictions: PredictionOutcome[]): number {
  if (predictions.length === 0) {
    return 0;
  }

  const sumSquaredError = predictions.reduce((sum, prediction) => {
    const error = prediction.outcome - prediction.pFinal;
    return sum + error * error;
  }, 0);

  return roundTo(sumSquaredError / predictions.length, 6);
}

export function computeLogLoss(predictions: PredictionOutcome[]): number {
  if (predictions.length === 0) {
    return 0;
  }

  const sumLogLoss = predictions.reduce((sum, prediction) => {
    const pClamped = Math.max(
      LOG_LOSS_EPSILON,
      Math.min(1 - LOG_LOSS_EPSILON, prediction.pFinal)
    );

    return prediction.outcome === 1
      ? sum - Math.log(pClamped)
      : sum - Math.log(1 - pClamped);
  }, 0);

  return roundTo(sumLogLoss / predictions.length, 6);
}

export function computeReliabilityBuckets(
  predictions: PredictionOutcome[],
  bucketWidth = DEFAULT_BUCKET_WIDTH
): ReliabilityBucket[] {
  if (predictions.length === 0) {
    return [];
  }

  const numBuckets = Math.ceil(1 / bucketWidth);
  const bucketData = new Map<number, PredictionOutcome[]>();

  for (const prediction of predictions) {
    const bucketIdx = Math.min(
      Math.floor(prediction.pFinal / bucketWidth),
      numBuckets - 1
    );
    const existing = bucketData.get(bucketIdx) ?? [];
    existing.push(prediction);
    bucketData.set(bucketIdx, existing);
  }

  const buckets: ReliabilityBucket[] = [];
  for (let index = 0; index < numBuckets; index += 1) {
    const bucketPredictions = bucketData.get(index);
    if (!bucketPredictions || bucketPredictions.length === 0) {
      continue;
    }

    const count = bucketPredictions.length;
    const sumPredicted = bucketPredictions.reduce(
      (sum, prediction) => sum + prediction.pFinal,
      0
    );
    const sumOutcomes = bucketPredictions.reduce(
      (sum, prediction) => sum + prediction.outcome,
      0
    );

    const avgPredicted = roundTo(sumPredicted / count, 6);
    const observedRate = roundTo(sumOutcomes / count, 6);
    const calibrationError = roundTo(Math.abs(avgPredicted - observedRate), 6);
    const brierContribution = roundTo(
      bucketPredictions.reduce((sum, prediction) => {
        return sum + (prediction.outcome - prediction.pFinal) ** 2;
      }, 0) / count,
      6
    );

    buckets.push({
      bucketLower: roundTo(index * bucketWidth, 4),
      bucketUpper: roundTo((index + 1) * bucketWidth, 4),
      count,
      avgPredicted,
      observedRate,
      calibrationError,
      brierContribution
    });
  }

  return buckets;
}

export function computeECE(
  buckets: ReliabilityBucket[],
  totalSamples: number
): number {
  if (buckets.length === 0 || totalSamples === 0) {
    return 0;
  }

  const ece = buckets.reduce((sum, bucket) => {
    return sum + (bucket.count / totalSamples) * bucket.calibrationError;
  }, 0);

  return roundTo(ece, 6);
}

export function computeMCE(buckets: ReliabilityBucket[]): number {
  if (buckets.length === 0) {
    return 0;
  }

  return Math.max(...buckets.map(bucket => bucket.calibrationError));
}

export function computeCalibrationMetrics(
  predictions: PredictionOutcome[],
  modelVersion: string,
  probabilityModelVersion: string,
  bucketWidth = DEFAULT_BUCKET_WIDTH
): CalibrationMetrics {
  const sampleSize = predictions.length;
  const winCount = predictions.filter(prediction => prediction.outcome === 1).length;
  const lossCount = sampleSize - winCount;
  const buckets = computeReliabilityBuckets(predictions, bucketWidth);

  return {
    sampleSize,
    winCount,
    lossCount,
    brierScore: computeBrierScore(predictions),
    ece: computeECE(buckets, sampleSize),
    mce: computeMCE(buckets),
    logLoss: computeLogLoss(predictions),
    buckets,
    modelVersion,
    probabilityModelVersion
  };
}

// ── Per-Slice Calibration ────────────────────────────────────────────────────

export interface SliceCalibrationMetrics extends CalibrationMetrics {
  /** e.g. "NBA:player-prop" or "global:all" */
  sliceKey: string;
  sport: string | null;
  marketFamily: string | null;
}

const MIN_SLICE_SAMPLES = 10;

/**
 * Compute calibration metrics broken out by sport + marketFamily.
 *
 * Groups with >= 10 samples get full metrics computed.
 * Groups with < 10 samples return a minimal entry with sampleSize set but all
 * metric fields at zero (not enough data to be meaningful).
 */
export function computeSliceCalibrationMetrics(
  predictions: SlicedPredictionOutcome[],
  modelVersion: string,
  probabilityModelVersion: string,
): SliceCalibrationMetrics[] {
  // Group by sport + marketFamily
  const groups = new Map<string, SlicedPredictionOutcome[]>();

  for (const p of predictions) {
    const sport = p.sport ?? null;
    const mf = p.marketFamily ?? null;
    const key = `${sport ?? 'null'}:${mf ?? 'null'}`;
    const existing = groups.get(key) ?? [];
    existing.push(p);
    groups.set(key, existing);
  }

  const results: SliceCalibrationMetrics[] = [];

  for (const [key, group] of groups) {
    const firstItem = group[0]!;
    const sport = firstItem.sport ?? null;
    const marketFamily = firstItem.marketFamily ?? null;
    const sliceKey = `${sport ?? 'global'}:${marketFamily ?? 'all'}`;

    if (group.length < MIN_SLICE_SAMPLES) {
      // Not enough data — return minimal entry with null-like metrics
      results.push({
        sliceKey,
        sport,
        marketFamily,
        sampleSize: group.length,
        winCount: group.filter(p => p.outcome === 1).length,
        lossCount: group.filter(p => p.outcome === 0).length,
        brierScore: 0,
        ece: 0,
        mce: 0,
        logLoss: 0,
        buckets: [],
        modelVersion,
        probabilityModelVersion,
      });
      continue;
    }

    const base = computeCalibrationMetrics(group, modelVersion, probabilityModelVersion);

    results.push({
      ...base,
      sliceKey,
      sport,
      marketFamily,
    });
  }

  return results;
}

// ── Alert Thresholds ─────────────────────────────────────────────────────────

export const CALIBRATION_THRESHOLDS = {
  brier: { warning: 0.28, critical: 0.32 },   // Lower is better
  ece: { warning: 0.06, critical: 0.10 },       // Lower is better
  logLoss: { warning: 0.65, critical: 0.75 },   // Lower is better
  minSampleForAlert: 30,                         // Don't alert on tiny samples
} as const;

export type CalibrationAlertLevel = 'green' | 'warning' | 'critical';

/**
 * Derive an alert level for a set of CalibrationMetrics.
 *
 * Returns 'green' when sample size is below the minimum threshold so we
 * never fire on statistically insignificant slices.
 */
export function computeCalibrationAlertLevel(
  metrics: CalibrationMetrics,
): CalibrationAlertLevel {
  if (metrics.sampleSize < CALIBRATION_THRESHOLDS.minSampleForAlert) return 'green';

  if (
    metrics.brierScore >= CALIBRATION_THRESHOLDS.brier.critical ||
    metrics.ece >= CALIBRATION_THRESHOLDS.ece.critical ||
    metrics.logLoss >= CALIBRATION_THRESHOLDS.logLoss.critical
  ) {
    return 'critical';
  }

  if (
    metrics.brierScore >= CALIBRATION_THRESHOLDS.brier.warning ||
    metrics.ece >= CALIBRATION_THRESHOLDS.ece.warning ||
    metrics.logLoss >= CALIBRATION_THRESHOLDS.logLoss.warning
  ) {
    return 'warning';
  }

  return 'green';
}
