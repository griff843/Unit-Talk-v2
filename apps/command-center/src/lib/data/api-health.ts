import { getDataClient } from './client';
import { getProviderHealth } from './intelligence';
import type { ProviderHealth } from '../types';

type JsonRecord = Record<string, unknown>;

export interface ApiHealthTrendPoint {
  bucketIso: string;
  label: string;
  avgResponseMs: number | null;
  requestCount: number;
}

export interface ApiHealthProviderCard {
  providerKey: string;
  providerName: string;
  status: 'healthy' | 'degraded' | 'down';
  statusDetail: string;
  lastCheckedAt: string | null;
  latestSnapshotAt: string | null;
  avgResponseMs: number | null;
  todayCallCount: number;
  quotaPct: number | null;
  quotaUsed: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  totalRows: number;
  last24hRows: number;
  sparkline: ApiHealthTrendPoint[];
}

export interface ApiHealthPageData {
  observedAt: string;
  realtimeEnabled: boolean;
  providers: ApiHealthProviderCard[];
}

interface ProviderRunSummary {
  providerKey: string;
  lastCheckedAt: string | null;
  avgResponseMs: number | null;
  todayCallCount: number;
  quotaUsed: number;
  quotaRemaining: number | null;
  quotaLimit: number | null;
  sparkline: ApiHealthTrendPoint[];
}

interface ProviderRunRow {
  details: unknown;
  finished_at: string | null;
  started_at: string;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}

function providerName(providerKey: string) {
  switch (providerKey) {
    case 'sgo':
      return 'Sports Game Odds';
    case 'odds-api':
      return 'The Odds API';
    default:
      return providerKey.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function bucketKeyFromIso(iso: string) {
  return iso.slice(0, 13);
}

function bucketLabelFromIso(iso: string) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(parsed));
}

function computeDurationMs(startedAt: string, finishedAt: string | null) {
  const startMs = Date.parse(startedAt);
  const endMs = finishedAt ? Date.parse(finishedAt) : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function buildHourlyBuckets(nowMs: number) {
  const buckets: ApiHealthTrendPoint[] = [];
  const hourMs = 60 * 60 * 1000;
  const startMs = nowMs - (23 * hourMs);
  for (let index = 0; index < 24; index += 1) {
    const bucketStartMs = startMs + (index * hourMs);
    const bucketIso = new Date(bucketStartMs).toISOString();
    buckets.push({
      bucketIso,
      label: bucketLabelFromIso(bucketIso),
      avgResponseMs: null,
      requestCount: 0,
    });
  }
  return buckets;
}

export function buildProviderRunSummaries(
  runs: ProviderRunRow[],
  observedAt = new Date().toISOString(),
): Map<string, ProviderRunSummary> {
  const nowMs = Date.parse(observedAt);
  const bucketTemplates = buildHourlyBuckets(nowMs);
  const bucketStartSet = new Set(bucketTemplates.map((point) => bucketKeyFromIso(point.bucketIso)));
  const last24hCutoffMs = nowMs - (24 * 60 * 60 * 1000);
  const currentDay = new Date(observedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const providerMetrics = new Map<string, {
    lastCheckedAt: string | null;
    durations: number[];
    todayCallCount: number;
    quotaUsed: number;
    quotaRemaining: number | null;
    quotaLimit: number | null;
    buckets: Map<string, { totalDurationMs: number; durationCount: number; requestCount: number }>;
  }>();

  for (const run of runs) {
    const details = asRecord(run.details);
    const quota = asRecord(details['quota']);
    const providerKey = asString(quota['provider']) ?? asString(details['provider']);
    if (!providerKey) continue;

    const startedAt = run.started_at;
    const startedMs = Date.parse(startedAt);
    if (!Number.isFinite(startedMs) || startedMs < last24hCutoffMs) {
      continue;
    }

    const summary = providerMetrics.get(providerKey) ?? {
      lastCheckedAt: null,
      durations: [],
      todayCallCount: 0,
      quotaUsed: 0,
      quotaRemaining: null,
      quotaLimit: null,
      buckets: new Map<string, { totalDurationMs: number; durationCount: number; requestCount: number }>(),
    };

    if (summary.lastCheckedAt == null || startedAt > summary.lastCheckedAt) {
      summary.lastCheckedAt = startedAt;
    }

    const requestCount = asNumber(quota['requestCount']) ?? 0;
    const creditsUsed = asNumber(quota['creditsUsed']) ?? 0;
    const remaining = asNumber(quota['remaining']);
    const limit = asNumber(quota['limit']);
    const durationMs = computeDurationMs(startedAt, run.finished_at);
    const dayKey = new Date(startedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    if (dayKey === currentDay) {
      summary.todayCallCount += requestCount;
      summary.quotaUsed += creditsUsed;
      summary.quotaRemaining = remaining ?? summary.quotaRemaining;
      summary.quotaLimit = limit ?? summary.quotaLimit;
    }

    if (durationMs != null) {
      summary.durations.push(durationMs);
    }

    const bucketKey = bucketKeyFromIso(startedAt);
    if (bucketStartSet.has(bucketKey)) {
      const bucketSummary = summary.buckets.get(bucketKey) ?? {
        totalDurationMs: 0,
        durationCount: 0,
        requestCount: 0,
      };
      bucketSummary.requestCount += requestCount;
      if (durationMs != null) {
        bucketSummary.totalDurationMs += durationMs;
        bucketSummary.durationCount += 1;
      }
      summary.buckets.set(bucketKey, bucketSummary);
    }

    providerMetrics.set(providerKey, summary);
  }

  const result = new Map<string, ProviderRunSummary>();

  for (const [providerKey, summary] of providerMetrics.entries()) {
    const sparkline = bucketTemplates.map((template) => {
      const bucketSummary = summary.buckets.get(bucketKeyFromIso(template.bucketIso));
      return {
        bucketIso: template.bucketIso,
        label: template.label,
        avgResponseMs: bucketSummary && bucketSummary.durationCount > 0
          ? roundNumber(bucketSummary.totalDurationMs / bucketSummary.durationCount)
          : null,
        requestCount: bucketSummary?.requestCount ?? 0,
      };
    });

    result.set(providerKey, {
      providerKey,
      lastCheckedAt: summary.lastCheckedAt,
      avgResponseMs: summary.durations.length > 0
        ? roundNumber(summary.durations.reduce((total, value) => total + value, 0) / summary.durations.length)
        : null,
      todayCallCount: summary.todayCallCount,
      quotaUsed: summary.quotaUsed,
      quotaRemaining: summary.quotaRemaining,
      quotaLimit: summary.quotaLimit,
      sparkline,
    });
  }

  return result;
}

function mapProviderStatus(provider: ProviderHealth['providers'][number], runSummary: ProviderRunSummary | undefined) {
  if (provider.status === 'active') {
    return {
      status: 'healthy' as const,
      detail: runSummary?.avgResponseMs != null
        ? `Healthy ingestion in last 24h · avg ${Math.round(runSummary.avgResponseMs)}ms`
        : 'Healthy ingestion in last 24h',
    };
  }

  if (provider.status === 'stale') {
    return {
      status: 'degraded' as const,
      detail: provider.minutesSinceLastSnapshot != null
        ? `Snapshot stale for ${provider.minutesSinceLastSnapshot}m`
        : 'Snapshot freshness degraded',
    };
  }

  return {
    status: 'down' as const,
    detail: runSummary?.lastCheckedAt
      ? 'No recent live provider snapshots'
      : 'No provider health heartbeat observed',
  };
}

function computeQuotaPct(summary: ProviderRunSummary | undefined) {
  if (!summary) return null;
  if (summary.quotaLimit != null && summary.quotaLimit > 0) {
    return Math.max(0, Math.min(100, roundNumber((summary.quotaUsed / summary.quotaLimit) * 100)));
  }
  if (summary.quotaRemaining != null) {
    const total = summary.quotaUsed + summary.quotaRemaining;
    if (total > 0) {
      return Math.max(0, Math.min(100, roundNumber((summary.quotaUsed / total) * 100)));
    }
  }
  return null;
}

export function buildApiHealthCards(
  providerHealth: ProviderHealth,
  runSummaries: Map<string, ProviderRunSummary>,
): ApiHealthProviderCard[] {
  return [...providerHealth.providers]
    .sort((left, right) => left.providerKey.localeCompare(right.providerKey))
    .map((provider) => {
      const runSummary = runSummaries.get(provider.providerKey);
      const status = mapProviderStatus(provider, runSummary);
      return {
        providerKey: provider.providerKey,
        providerName: providerName(provider.providerKey),
        status: status.status,
        statusDetail: status.detail,
        lastCheckedAt: runSummary?.lastCheckedAt ?? provider.latestSnapshotAt,
        latestSnapshotAt: provider.latestSnapshotAt,
        avgResponseMs: runSummary?.avgResponseMs ?? null,
        todayCallCount: runSummary?.todayCallCount ?? 0,
        quotaPct: computeQuotaPct(runSummary),
        quotaUsed: runSummary?.quotaUsed ?? 0,
        quotaRemaining: runSummary?.quotaRemaining ?? null,
        quotaLimit: runSummary?.quotaLimit ?? null,
        totalRows: provider.totalRows,
        last24hRows: provider.last24hRows,
        sparkline: runSummary?.sparkline ?? buildHourlyBuckets(Date.now()),
      };
    });
}

export async function getApiHealthData(): Promise<ApiHealthPageData> {
  const client = getDataClient();
  const observedAt = new Date().toISOString();
  const [providerHealthResult, runsResult] = await Promise.all([
    getProviderHealth(),
    client
      .from('system_runs')
      .select('started_at, finished_at, details')
      .eq('run_type', 'ingestor.cycle')
      .order('started_at', { ascending: false })
      .limit(500),
  ]);

  if (runsResult.error) {
    throw new Error(`getApiHealthData: ${String(runsResult.error)}`);
  }

  const providerHealth = providerHealthResult.data as ProviderHealth;
  const runSummaries = buildProviderRunSummaries((runsResult.data ?? []) as ProviderRunRow[], observedAt);

  return {
    observedAt,
    realtimeEnabled: Boolean(process.env['SUPABASE_URL'] && process.env['SUPABASE_ANON_KEY']),
    providers: buildApiHealthCards(providerHealth, runSummaries),
  };
}
