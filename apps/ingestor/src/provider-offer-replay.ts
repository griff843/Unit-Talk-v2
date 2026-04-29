import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type {
  IngestorRepositoryBundle,
  ProviderCycleStatusRow,
} from '@unit-talk/db';

import type { IngestLeagueSummary } from './ingest-league.js';
import { ingestLeague } from './ingest-league.js';
import type { SGORequestCapture } from './sgo-fetcher.js';

export const PROVIDER_OFFER_REPLAY_PACK_VERSION =
  'provider-offer-replay.v1' as const;

export type ProviderOfferReplayMode = '1x' | '2x';
export type ProviderOfferReplayPressureStrategy =
  | 'captured_timing'
  | 'time_compression';

export interface ProviderOfferReplayMarketCoverage {
  providerKey: string;
  sportKey: string | null;
  providerMarketKey: string;
  offerCount: number;
}

export interface ProviderOfferReplayRequestRecord
  extends Omit<SGORequestCapture, 'payload'> {
  requestId: string;
  payloadPath: string;
}

export interface ProviderOfferReplayPackManifest {
  schemaVersion: typeof PROVIDER_OFFER_REPLAY_PACK_VERSION;
  packType: 'provider-offer';
  providerKey: string;
  league: string;
  capturedAt: string;
  snapshotAt: string;
  sourceRunId: string;
  proofStatus: 'verified' | 'waived';
  freshnessMaxAgeMs: number;
  ingestConfig: {
    skipResults: boolean;
    startsAfter?: string;
    startsBefore?: string;
    providerEventIds?: string[];
  };
  requests: ProviderOfferReplayRequestRecord[];
  marketCoverage: ProviderOfferReplayMarketCoverage[];
  ingestSummary: IngestLeagueSummary;
  cycleStatus: ProviderCycleStatusRow | null;
  notes: string[];
}

export interface ProviderOfferReplayCaptureSession {
  recordRequest(capture: SGORequestCapture): Promise<void>;
  recordMarketCoverage(markets: ReadonlyArray<ProviderOfferReplayMarketCoverage>): void;
  finalizeCapture(input: {
    ingestSummary: IngestLeagueSummary;
    cycleStatus: ProviderCycleStatusRow | null;
    proofStatus: 'verified' | 'waived';
    freshnessMaxAgeMs: number;
    skipResults: boolean;
    startsAfter?: string;
    startsBefore?: string;
    providerEventIds?: string[];
  }): Promise<ProviderOfferReplayPackManifest>;
  readonly packDir: string;
}

export interface ProviderOfferReplayCaptureOptions {
  rootDir: string;
  providerKey: string;
  league: string;
  snapshotAt: string;
  runId: string;
}

export interface ProviderOfferReplayExecutionOptions {
  packDir: string;
  mode: ProviderOfferReplayMode;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProviderOfferReplayExecutionResult {
  reportPath: string;
  manifest: ProviderOfferReplayPackManifest;
  replaySummary: IngestLeagueSummary;
  replayCycleStatus: ProviderCycleStatusRow | null;
  requestMetrics: Array<{
    requestId: string;
    endpoint: 'odds' | 'results';
    scheduledOffsetMs: number;
    observedOffsetMs: number;
    scheduledDurationMs: number;
    observedDurationMs: number;
    status: number;
  }>;
}

export function createProviderOfferReplayCaptureSession(
  options: ProviderOfferReplayCaptureOptions,
): ProviderOfferReplayCaptureSession {
  const stamp = options.snapshotAt.replace(/[:.]/g, '-');
  const packDir = path.join(
    options.rootDir,
    options.providerKey,
    options.league,
    `${options.runId}-${stamp}`,
  );
  const payloadDir = path.join(packDir, 'requests');
  fs.mkdirSync(payloadDir, { recursive: true });

  const requests: ProviderOfferReplayRequestRecord[] = [];
  const marketCoverage = new Map<string, ProviderOfferReplayMarketCoverage>();

  return {
    async recordRequest(capture) {
      const requestId = `${capture.endpoint}-${String(requests.length + 1).padStart(4, '0')}`;
      const payloadPath = path.join('requests', `${requestId}.json`);
      await fs.promises.writeFile(
        path.join(packDir, payloadPath),
        `${JSON.stringify(capture.payload, null, 2)}\n`,
        'utf8',
      );
      requests.push({
        requestId,
        provider: capture.provider,
        endpoint: capture.endpoint,
        url: capture.url,
        pageIndex: capture.pageIndex,
        cursor: capture.cursor,
        startedAt: capture.startedAt,
        completedAt: capture.completedAt,
        durationMs: capture.durationMs,
        status: capture.status,
        headers: capture.headers,
        responseBytes: capture.responseBytes,
        endOfResults: capture.endOfResults,
        payloadPath,
      });
    },
    recordMarketCoverage(markets) {
      for (const market of markets) {
        const key = [
          market.providerKey,
          market.sportKey ?? '',
          market.providerMarketKey,
        ].join(':');
        const existing = marketCoverage.get(key);
        if (existing) {
          existing.offerCount += market.offerCount;
        } else {
          marketCoverage.set(key, { ...market });
        }
      }
    },
    async finalizeCapture(input) {
      const manifest: ProviderOfferReplayPackManifest = {
        schemaVersion: PROVIDER_OFFER_REPLAY_PACK_VERSION,
        packType: 'provider-offer',
        providerKey: options.providerKey,
        league: options.league,
        capturedAt: new Date().toISOString(),
        snapshotAt: options.snapshotAt,
        sourceRunId: options.runId,
        proofStatus: input.proofStatus,
        freshnessMaxAgeMs: input.freshnessMaxAgeMs,
        ingestConfig: {
          skipResults: input.skipResults,
          ...(input.startsAfter ? { startsAfter: input.startsAfter } : {}),
          ...(input.startsBefore ? { startsBefore: input.startsBefore } : {}),
          ...(input.providerEventIds
            ? { providerEventIds: input.providerEventIds }
            : {}),
        },
        requests,
        marketCoverage: Array.from(marketCoverage.values()).sort((left, right) =>
          left.providerMarketKey.localeCompare(right.providerMarketKey),
        ),
        ingestSummary: input.ingestSummary,
        cycleStatus: input.cycleStatus,
        notes: [
          'UTV2-796 replay pack contract: real captured provider payloads only.',
          'UTV2-781 freshness SLA is enforced from freshnessMaxAgeMs in this manifest.',
          'TODO: extend multi-provider capture beyond SGO before any broader cutover.',
        ],
      };
      await fs.promises.writeFile(
        path.join(packDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
      return manifest;
    },
    packDir,
  };
}

export async function loadProviderOfferReplayPack(packDir: string) {
  const raw = await fs.promises.readFile(path.join(packDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as ProviderOfferReplayPackManifest;
  assert.equal(manifest.schemaVersion, PROVIDER_OFFER_REPLAY_PACK_VERSION);
  return manifest;
}

export async function runProviderOfferReplay(
  repositories: IngestorRepositoryBundle,
  options: {
    packDir: string;
    mode: ProviderOfferReplayMode;
    apiKey: string;
    league: string;
    sleep?: (ms: number) => Promise<void>;
    logger?: Pick<Console, 'info' | 'warn'>;
  },
): Promise<ProviderOfferReplayExecutionResult> {
  const manifest = await loadProviderOfferReplayPack(options.packDir);
  const requestMetrics: ProviderOfferReplayExecutionResult['requestMetrics'] = [];
  const fetchImpl = createReplayFetchImpl(manifest, {
    mode: options.mode,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    onResolved(metric) {
      requestMetrics.push(metric);
    },
    packDir: options.packDir,
  });

  const replaySummary = await ingestLeague(
    options.league,
    options.apiKey,
    repositories,
    {
      snapshotAt: manifest.snapshotAt,
      fetchImpl,
      ...(manifest.ingestConfig.startsAfter
        ? { startsAfter: manifest.ingestConfig.startsAfter }
        : {}),
      ...(manifest.ingestConfig.startsBefore
        ? { startsBefore: manifest.ingestConfig.startsBefore }
        : {}),
      ...(manifest.ingestConfig.providerEventIds
        ? { providerEventIds: manifest.ingestConfig.providerEventIds }
        : {}),
      ...(manifest.ingestConfig.skipResults ? { skipResults: true } : {}),
      providerOfferStagingMode: 'stage_and_merge_verified',
      providerOfferProofStatus: 'verified',
      providerOfferFreshnessMaxAgeMs: manifest.freshnessMaxAgeMs,
      ...(options.logger ? { logger: options.logger } : {}),
    },
  );
  const replayCycleStatus = replaySummary.runId
    ? await repositories.providerOffers.getCycleStatus(replaySummary.runId)
    : null;
  const report = buildReplayReport(manifest, replaySummary, replayCycleStatus, requestMetrics, options.mode);
  const reportPath = path.join(
    options.packDir,
    `replay-report-${options.mode ?? '1x'}.json`,
  );
  await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    reportPath,
    manifest,
    replaySummary,
    replayCycleStatus,
    requestMetrics,
  };
}

export async function captureProviderOfferReplayPack(
  repositories: IngestorRepositoryBundle,
  options: {
    rootDir: string;
    providerKey: string;
    league: string;
    apiKey: string;
    snapshotAt: string;
    freshnessMaxAgeMs: number;
    fetchImpl?: typeof fetch;
    skipResults?: boolean;
    startsAfter?: string;
    startsBefore?: string;
    providerEventIds?: string[];
    logger?: Pick<Console, 'info' | 'warn'>;
  },
): Promise<{
  packDir: string;
  manifest: ProviderOfferReplayPackManifest;
  ingestSummary: IngestLeagueSummary;
}> {
  const captureRunId = `provider-replay-capture-${Date.now()}`;
  const session = createProviderOfferReplayCaptureSession({
    rootDir: options.rootDir,
    providerKey: options.providerKey,
    league: options.league,
    snapshotAt: options.snapshotAt,
    runId: captureRunId,
  });

  const ingestSummary = await ingestLeague(
    options.league,
    options.apiKey,
    repositories,
    {
      snapshotAt: options.snapshotAt,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.startsAfter ? { startsAfter: options.startsAfter } : {}),
      ...(options.startsBefore ? { startsBefore: options.startsBefore } : {}),
      ...(options.providerEventIds
        ? { providerEventIds: options.providerEventIds }
        : {}),
      ...(options.skipResults ? { skipResults: true } : {}),
      providerOfferStagingMode: 'stage_and_merge_verified',
      providerOfferProofStatus: 'verified',
      providerOfferFreshnessMaxAgeMs: options.freshnessMaxAgeMs,
      replayCaptureSession: session,
      ...(options.logger ? { logger: options.logger } : {}),
    },
  );
  const cycleStatus = ingestSummary.runId
    ? await repositories.providerOffers.getCycleStatus(ingestSummary.runId)
    : null;
  const manifest = await session.finalizeCapture({
    ingestSummary,
    cycleStatus,
    proofStatus: 'verified',
    freshnessMaxAgeMs: options.freshnessMaxAgeMs,
    skipResults: options.skipResults ?? false,
    ...(options.startsAfter ? { startsAfter: options.startsAfter } : {}),
    ...(options.startsBefore ? { startsBefore: options.startsBefore } : {}),
    ...(options.providerEventIds
      ? { providerEventIds: options.providerEventIds }
      : {}),
  });

  return {
    packDir: session.packDir,
    manifest,
    ingestSummary,
  };
}

function buildReplayReport(
  manifest: ProviderOfferReplayPackManifest,
  replaySummary: IngestLeagueSummary,
  replayCycleStatus: ProviderCycleStatusRow | null,
  requestMetrics: ProviderOfferReplayExecutionResult['requestMetrics'],
  mode: ProviderOfferReplayMode,
) {
  const sourceLatency = readLatencyMetadata(manifest.cycleStatus);
  const replayLatency = readLatencyMetadata(replayCycleStatus);
  return {
    schemaVersion: PROVIDER_OFFER_REPLAY_PACK_VERSION,
    packDir: manifest.sourceRunId,
    mode,
    providerKey: manifest.providerKey,
    league: manifest.league,
    freshness: manifest.marketCoverage.map((market) => ({
      providerKey: market.providerKey,
      sportKey: market.sportKey,
      providerMarketKey: market.providerMarketKey,
      offerCount: market.offerCount,
      freshnessStatus:
        replayCycleStatus?.freshness_status ??
        manifest.cycleStatus?.freshness_status ??
        'unknown',
      ageMs: computeAgeMs(manifest.snapshotAt),
      freshnessSlaMs: manifest.freshnessMaxAgeMs,
    })),
    dbBehavior: {
      sourceCycleStatus: summarizeCycleStatus(manifest.cycleStatus),
      replayCycleStatus: summarizeCycleStatus(replayCycleStatus),
      sourceMergeLatencyMs: sourceLatency?.mergeLatencyMs ?? null,
      replayMergeLatencyMs: replayLatency?.mergeLatencyMs ?? null,
      sourceStageLatencyMs: sourceLatency?.stageLatencyMs ?? null,
      replayStageLatencyMs: replayLatency?.stageLatencyMs ?? null,
    },
    mergeLatency: {
      source: sourceLatency,
      replay: replayLatency,
    },
    failureTaxonomy: {
      source: {
        category: manifest.cycleStatus?.failure_category ?? null,
        scope: manifest.cycleStatus?.failure_scope ?? null,
        lastError: manifest.cycleStatus?.last_error ?? null,
      },
      replay: {
        category: replayCycleStatus?.failure_category ?? null,
        scope: replayCycleStatus?.failure_scope ?? null,
        lastError: replayCycleStatus?.last_error ?? null,
      },
    },
    summary: {
      sourceRunId: manifest.sourceRunId,
      replayRunId: replaySummary.runId,
      requestsCaptured: manifest.requests.length,
      requestsReplayed: requestMetrics.length,
      insertedCount: replaySummary.insertedCount,
      updatedCount: replaySummary.updatedCount,
      skippedCount: replaySummary.skippedCount,
    },
    requestMetrics,
    notes: [
      mode === '2x'
        ? '2x pressure uses time compression against captured request timing.'
        : '1x replay preserves captured request timing offsets and response durations.',
      'No fake payload duplication is used in this replay report.',
    ],
  };
}

function summarizeCycleStatus(cycleStatus: ProviderCycleStatusRow | null) {
  if (!cycleStatus) {
    return null;
  }
  return {
    stageStatus: cycleStatus.stage_status,
    freshnessStatus: cycleStatus.freshness_status,
    proofStatus: cycleStatus.proof_status,
    mergedCount: cycleStatus.merged_count,
    duplicateCount: cycleStatus.duplicate_count,
    failureCategory: cycleStatus.failure_category,
    failureScope: cycleStatus.failure_scope,
  };
}

function readLatencyMetadata(cycleStatus: ProviderCycleStatusRow | null) {
  const metadata = cycleStatus?.metadata;
  const latency = metadata?.latencyMs;
  if (!latency || typeof latency !== 'object' || Array.isArray(latency)) {
    return null;
  }
  const latencyRecord = latency as Record<string, unknown>;
  return {
    stageLatencyMs: numberOrNull(latencyRecord.stage),
    mergeLatencyMs: numberOrNull(latencyRecord.merge),
    totalLatencyMs: numberOrNull(latencyRecord.total),
  };
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function computeAgeMs(snapshotAt: string) {
  const snapshotMs = Date.parse(snapshotAt);
  if (!Number.isFinite(snapshotMs)) {
    return null;
  }
  return Date.now() - snapshotMs;
}

function createReplayFetchImpl(
  manifest: ProviderOfferReplayPackManifest,
  options: ProviderOfferReplayExecutionOptions & {
    onResolved(metric: ProviderOfferReplayExecutionResult['requestMetrics'][number]): void;
  },
): typeof fetch {
  let requestIndex = 0;
  const replayStartMs = Date.now();
  const captureStartMs = Date.parse(manifest.requests[0]?.startedAt ?? manifest.snapshotAt);
  const divisor = options.mode === '2x' ? 2 : 1;

  return async (input) => {
    const request = manifest.requests[requestIndex];
    if (!request) {
      throw new Error('Replay requested more HTTP calls than exist in the capture pack');
    }
    requestIndex += 1;

    const actualUrl = new URL(String(input));
    const expectedUrl = new URL(request.url);
    assert.equal(actualUrl.pathname, expectedUrl.pathname);
    assert.equal(stripApiKey(actualUrl.searchParams), stripApiKey(expectedUrl.searchParams));

    const scheduledOffsetMs = Math.max(
      0,
      Math.round((Date.parse(request.startedAt) - captureStartMs) / divisor),
    );
    const scheduledDurationMs = Math.max(0, Math.round(request.durationMs / divisor));
    const nowOffsetMs = Date.now() - replayStartMs;
    const waitBeforeStartMs = scheduledOffsetMs - nowOffsetMs;
    if (waitBeforeStartMs > 0) {
      await (options.sleep ?? defaultSleep)(waitBeforeStartMs);
    }

    const observedStartMs = Date.now() - replayStartMs;
    if (scheduledDurationMs > 0) {
      await (options.sleep ?? defaultSleep)(scheduledDurationMs);
    }
    const payloadRaw = await fs.promises.readFile(
      path.join(options.packDir, request.payloadPath),
      'utf8',
    );
    const observedEndMs = Date.now() - replayStartMs;
    options.onResolved({
      requestId: request.requestId,
      endpoint: request.endpoint,
      scheduledOffsetMs,
      observedOffsetMs: observedStartMs,
      scheduledDurationMs,
      observedDurationMs: observedEndMs - observedStartMs,
      status: request.status,
    });
    return new Response(payloadRaw, {
      status: request.status,
      headers: {
        'content-type': 'application/json',
        ...request.headers,
      },
    });
  };
}

function stripApiKey(searchParams: URLSearchParams) {
  const clone = new URLSearchParams(searchParams);
  clone.delete('apiKey');
  return clone.toString();
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
