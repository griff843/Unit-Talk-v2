import { createReplayableAdversarialFinding } from './independent-data-path.js';
import type {
  ManipulationClassification,
  ManipulationDetectorInput,
  ManipulationDetectorThresholds,
  ManipulationFinding,
} from './manipulation-detector.types.js';

export type {
  ManipulationClassification,
  ManipulationFinding,
  ManipulationDetectorInput,
  ManipulationDetectorThresholds,
} from './manipulation-detector.types.js';

export const DEFAULT_MANIPULATION_THRESHOLDS: ManipulationDetectorThresholds = Object.freeze({
  fabricatedLineDelta: 1,
  volumeSpikeRatio: 5,
  timestampFutureToleranceMs: 60_000,
  timestampPastToleranceMs: 86_400_000,
});

export function detectManipulation(input: ManipulationDetectorInput): ManipulationFinding {
  const thresholds = { ...DEFAULT_MANIPULATION_THRESHOLDS, ...input.thresholds };
  const payload = asRecord(input.record.rawSnapshot.payload);
  const capturedAtMs = Date.parse(input.record.rawSnapshot.capturedAt);

  const observedLine = findNumber(payload, ['line', 'offer.line', 'observedLine']);
  const expectedLine = findNumber(payload, [
    'consensusLine',
    'expectedLine',
    'marketConsensus.line',
    'consensus.line',
  ]);
  if (observedLine !== undefined && expectedLine !== undefined) {
    const delta = Math.abs(observedLine - expectedLine);
    if (delta >= thresholds.fabricatedLineDelta) {
      return buildFinding(input, 'line_fabrication', confidenceFromRatio(delta, thresholds.fabricatedLineDelta), true, {
        code: 'line_fabrication',
        observedLine,
        expectedLine,
        delta,
        threshold: thresholds.fabricatedLineDelta,
      });
    }
  }

  const explicitSpikeRatio = findNumber(payload, ['volumeSpikeRatio', 'volume.spikeRatio']);
  const observedVolume = findNumber(payload, ['volume', 'betVolume', 'handle', 'volume.observed']);
  const baselineVolume = findNumber(payload, ['baselineVolume', 'expectedVolume', 'averageVolume', 'volume.baseline']);
  const spikeRatio = explicitSpikeRatio
    ?? (observedVolume !== undefined && baselineVolume !== undefined && baselineVolume > 0
      ? observedVolume / baselineVolume
      : undefined);
  if (spikeRatio !== undefined && spikeRatio >= thresholds.volumeSpikeRatio) {
    return buildFinding(input, 'volume_spoofing', confidenceFromRatio(spikeRatio, thresholds.volumeSpikeRatio), true, {
      code: 'volume_spoofing',
      spikeRatio,
      threshold: thresholds.volumeSpikeRatio,
      observedVolume,
      baselineVolume,
    });
  }

  const providerTimestamp = findString(payload, [
    'providerTimestamp',
    'publishedAt',
    'lastUpdatedAt',
    'timestamp',
    'offer.timestamp',
  ]);
  if (providerTimestamp !== undefined) {
    const providerTimestampMs = Date.parse(providerTimestamp);
    if (Number.isFinite(providerTimestampMs)) {
      const driftMs = providerTimestampMs - capturedAtMs;
      if (
        driftMs > thresholds.timestampFutureToleranceMs
        || driftMs < -thresholds.timestampPastToleranceMs
      ) {
        return buildFinding(input, 'timestamp_forgery', 0.9, true, {
          code: 'timestamp_forgery',
          providerTimestamp,
          capturedAt: input.record.rawSnapshot.capturedAt,
          driftMs,
        });
      }
    }
  }

  return buildFinding(input, 'none', 0.05, false, { code: 'none' });
}

function buildFinding(
  input: ManipulationDetectorInput,
  classification: ManipulationClassification,
  confidence: number,
  quarantineSignal: boolean,
  finding: Record<string, unknown>,
): ManipulationFinding {
  const replayable = createReplayableAdversarialFinding({
    record: input.record,
    detectedAt: input.detectedAt,
    finding,
  });

  return Object.freeze({
    ...replayable,
    classification,
    confidence,
    quarantineSignal,
  });
}

function confidenceFromRatio(value: number, threshold: number): number {
  return Math.min(0.99, Math.max(0.6, value / threshold * 0.72));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function findNumber(record: Record<string, unknown>, paths: readonly string[]): number | undefined {
  for (const path of paths) {
    const value = findValue(record, path);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function findString(record: Record<string, unknown>, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = findValue(record, path);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function findValue(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
