import { createReplayableAdversarialFinding } from './independent-data-path.js';
import type { IndependentAdversarialRecord } from './independent-data-path.types.js';
import type {
  AnomalyClassification,
  ProviderAnomalyDetectorInput,
  ProviderAnomalyDetectorThresholds,
  ProviderAnomalyReport,
} from './provider-anomaly.types.js';

export type {
  AnomalyClassification,
  ProviderAnomalyReport,
  ProviderAnomalyDetectorInput,
  ProviderAnomalyDetectorThresholds,
} from './provider-anomaly.types.js';

export const DEFAULT_PROVIDER_ANOMALY_THRESHOLDS: ProviderAnomalyDetectorThresholds = Object.freeze({
  staleAfterMs: 300_000,
  lineDivergence: 1,
  oddsDivergence: 30,
});

interface NormalizedOffer {
  readonly record: IndependentAdversarialRecord;
  readonly source: string;
  readonly key: string;
  readonly line?: number;
  readonly odds?: number;
}

export function detectProviderAnomalies(input: ProviderAnomalyDetectorInput): readonly ProviderAnomalyReport[] {
  const thresholds = { ...DEFAULT_PROVIDER_ANOMALY_THRESHOLDS, ...input.thresholds };
  const reports: ProviderAnomalyReport[] = [];
  const detectedAtMs = Date.parse(input.detectedAt);
  const offersByRecord = new Map<string, readonly NormalizedOffer[]>();

  for (const record of input.records) {
    const capturedAtMs = Date.parse(record.rawSnapshot.capturedAt);
    if (Number.isFinite(detectedAtMs) && Number.isFinite(capturedAtMs)) {
      const ageMs = detectedAtMs - capturedAtMs;
      if (ageMs > thresholds.staleAfterMs) {
        reports.push(buildReport(input, record, 'stale_data', 0.9, [record.rawSnapshot.source], true, {
          code: 'stale_data',
          ageMs,
          threshold: thresholds.staleAfterMs,
        }));
      }
    }

    offersByRecord.set(record.id, normalizeOffers(record));
  }

  reports.push(...detectMissingMarkets(input, offersByRecord));
  reports.push(...detectCrossProviderDivergence(input, offersByRecord, thresholds));

  return Object.freeze(reports);
}

function detectMissingMarkets(
  input: ProviderAnomalyDetectorInput,
  offersByRecord: ReadonlyMap<string, readonly NormalizedOffer[]>,
): readonly ProviderAnomalyReport[] {
  const reports: ProviderAnomalyReport[] = [];
  const allMarketKeys = new Set<string>();
  for (const offers of offersByRecord.values()) {
    for (const offer of offers) {
      allMarketKeys.add(offer.key);
    }
  }

  if (allMarketKeys.size === 0) {
    return reports;
  }

  for (const record of input.records) {
    const offers = offersByRecord.get(record.id) ?? [];
    const presentKeys = new Set(offers.map((offer) => offer.key));
    for (const marketKey of allMarketKeys) {
      if (!presentKeys.has(marketKey)) {
        reports.push(buildReport(input, record, 'missing_market', 0.8, [record.rawSnapshot.source], true, {
          code: 'missing_market',
          marketKey,
          source: record.rawSnapshot.source,
        }));
      }
    }
  }

  return reports;
}

function detectCrossProviderDivergence(
  input: ProviderAnomalyDetectorInput,
  offersByRecord: ReadonlyMap<string, readonly NormalizedOffer[]>,
  thresholds: ProviderAnomalyDetectorThresholds,
): readonly ProviderAnomalyReport[] {
  const reports: ProviderAnomalyReport[] = [];
  const offersByKey = new Map<string, NormalizedOffer[]>();
  for (const offers of offersByRecord.values()) {
    for (const offer of offers) {
      const existing = offersByKey.get(offer.key) ?? [];
      existing.push(offer);
      offersByKey.set(offer.key, existing);
    }
  }

  for (const [marketKey, offers] of offersByKey.entries()) {
    const uniqueSources = new Set(offers.map((offer) => offer.source));
    if (uniqueSources.size < 2) {
      continue;
    }

    const lineValues = offers.map((offer) => offer.line).filter(isNumber);
    const oddsValues = offers.map((offer) => offer.odds).filter(isNumber);
    const lineRange = range(lineValues);
    const oddsRange = range(oddsValues);
    const lineDiverged = lineRange >= thresholds.lineDivergence;
    const oddsDiverged = oddsRange >= thresholds.oddsDivergence;
    if (!lineDiverged && !oddsDiverged) {
      continue;
    }

    const representative = offers[0];
    if (!representative) {
      continue;
    }

    const confidence = Math.min(
      0.99,
      Math.max(
        lineDiverged ? lineRange / thresholds.lineDivergence * 0.72 : 0,
        oddsDiverged ? oddsRange / thresholds.oddsDivergence * 0.72 : 0,
        0.7,
      ),
    );

    reports.push(buildReport(input, representative.record, 'cross_provider_divergence', confidence, [...uniqueSources], true, {
      code: 'cross_provider_divergence',
      marketKey,
      lineRange,
      oddsRange,
      lineThreshold: thresholds.lineDivergence,
      oddsThreshold: thresholds.oddsDivergence,
    }));
  }

  return reports;
}

function buildReport(
  input: ProviderAnomalyDetectorInput,
  record: IndependentAdversarialRecord,
  classification: AnomalyClassification,
  confidence: number,
  affectedSources: readonly string[],
  quarantineSignal: boolean,
  finding: Record<string, unknown>,
): ProviderAnomalyReport {
  const replayable = createReplayableAdversarialFinding({
    record,
    detectedAt: input.detectedAt,
    finding,
  });

  return Object.freeze({
    ...replayable,
    classification,
    confidence,
    affectedSources: Object.freeze([...affectedSources]),
    quarantineSignal,
  });
}

function normalizeOffers(record: IndependentAdversarialRecord): readonly NormalizedOffer[] {
  const payload = asRecord(record.rawSnapshot.payload);
  const candidates = extractOfferCandidates(payload);
  const offers = candidates
    .map((candidate) => normalizeOffer(record, payload, candidate))
    .filter((offer): offer is NormalizedOffer => offer !== undefined);

  return Object.freeze(offers);
}

function normalizeOffer(
  record: IndependentAdversarialRecord,
  payload: Record<string, unknown>,
  offer: Record<string, unknown>,
): NormalizedOffer | undefined {
  const eventId = findString(offer, ['eventId', 'event.id']) ?? findString(payload, ['eventId', 'event.id']);
  const market = findString(offer, ['market', 'marketId', 'marketKey']) ?? findString(payload, ['market', 'marketId', 'marketKey']);
  const selection = findString(offer, ['selection', 'participant', 'player', 'team']) ?? findString(payload, ['selection', 'participant', 'player', 'team']) ?? 'market';
  if (eventId === undefined || market === undefined) {
    return undefined;
  }

  const line = findNumber(offer, ['line', 'spread', 'total']) ?? findNumber(payload, ['line', 'spread', 'total']);
  const odds = findNumber(offer, ['odds', 'price']) ?? findNumber(payload, ['odds', 'price']);
  const normalized: NormalizedOffer = {
    record,
    source: record.rawSnapshot.source,
    key: `${eventId}:${market}:${selection}`,
    ...(line !== undefined ? { line } : {}),
    ...(odds !== undefined ? { odds } : {}),
  };

  return Object.freeze(normalized);
}

function extractOfferCandidates(payload: Record<string, unknown>): readonly Record<string, unknown>[] {
  const offer = payload.offer;
  if (isPlainRecord(offer)) {
    return [offer];
  }

  const offers = payload.offers;
  if (Array.isArray(offers)) {
    return offers.filter(isPlainRecord);
  }

  const markets = payload.markets;
  if (Array.isArray(markets)) {
    return markets.filter(isPlainRecord);
  }
  if (isPlainRecord(markets)) {
    return Object.values(markets).filter(isPlainRecord);
  }

  return [payload];
}

function range(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    if (!isPlainRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}
