import { roundTo } from './devig.js';

export interface PredictionOutcome {
  pFinal: number;
  outcome: 0 | 1;
  pickId?: string;
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
