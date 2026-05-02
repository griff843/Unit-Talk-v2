import { getDataClient } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function roundRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function mapEdgeSourceBucket(edgeSource: string | null) {
  switch ((edgeSource ?? '').toLowerCase()) {
    case 'real-edge':
    case 'pinnacle':
      return 'realEdge' as const;
    case 'consensus':
    case 'consensus-edge':
      return 'consensusEdge' as const;
    case 'sgo':
    case 'sgo-edge':
      return 'sgoEdge' as const;
    case 'confidence-delta':
      return 'confidenceDelta' as const;
    case 'explicit':
      return 'explicit' as const;
    default:
      return 'unknown' as const;
  }
}

function parseWindowDays(window?: string) {
  const raw = window?.trim() ?? '7d';
  const parsed = raw.endsWith('d')
    ? Number.parseInt(raw.slice(0, -1), 10)
    : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? { label: `${parsed}d`, days: parsed } : { label: '7d', days: 7 };
}

function resolveProviderOfferFreshnessThresholdMinutes(): number {
  const parsed = Number.parseInt(process.env['UNIT_TALK_INGESTOR_OFFER_STALE_MINUTES'] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export async function getIntelligenceCoverage(window?: string): Promise<{ ok: true; data: unknown }> {
  const client: Client = getDataClient();
  const { label, days } = parseWindowDays(window);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [picksResult, settlementsResult] = await Promise.all([
    client.from('picks').select('id, created_at, odds, metadata').gte('created_at', cutoff),
    client.from('settlement_records').select('id, created_at, status, payload').eq('status', 'settled').gte('created_at', cutoff),
  ]);

  if (picksResult.error || settlementsResult.error) {
    throw new Error(`getIntelligenceCoverage: ${String(picksResult.error ?? settlementsResult.error)}`);
  }

  const picks = (picksResult.data ?? []) as Array<Record<string, unknown>>;
  const settlements = (settlementsResult.data ?? []) as Array<Record<string, unknown>>;

  const coverage = {
    window: label,
    totalPicks: picks.length,
    picksWithOdds: 0,
    domainAnalysis: { count: 0, rate: 0 },
    deviggingResult: { count: 0, rate: 0 },
    kellySizing: { count: 0, rate: 0 },
    realEdge: { count: 0, rate: 0 },
    edgeSourceDistribution: { realEdge: 0, consensusEdge: 0, sgoEdge: 0, confidenceDelta: 0, explicit: 0, unknown: 0 },
    clvCoverage: { settledPicks: 0, withClv: 0, rate: 0 },
  };

  let domainAnalysisCount = 0;
  let devigCount = 0;
  let kellyCount = 0;
  let realEdgeCount = 0;

  for (const pick of picks) {
    const metadata = asRecord(pick['metadata']);
    const domainAnalysis = asRecord(metadata['domainAnalysis']);
    const odds = asNumber(pick['odds']);

    if (odds !== null) coverage.picksWithOdds += 1;
    if (Object.keys(domainAnalysis).length > 0) {
      domainAnalysisCount += 1;
      const bucket = mapEdgeSourceBucket(asString(domainAnalysis['realEdgeSource']));
      coverage.edgeSourceDistribution[bucket] += 1;
    } else {
      coverage.edgeSourceDistribution.unknown += 1;
    }
    if (metadata['deviggingResult'] != null) devigCount += 1;
    if (metadata['kellySizing'] != null) kellyCount += 1;
    if (domainAnalysis['realEdge'] != null) realEdgeCount += 1;
  }

  const oddsDenominator = coverage.picksWithOdds > 0 ? coverage.picksWithOdds : coverage.totalPicks;
  coverage.domainAnalysis = { count: domainAnalysisCount, rate: roundRate(domainAnalysisCount, oddsDenominator) };
  coverage.deviggingResult = { count: devigCount, rate: roundRate(devigCount, oddsDenominator) };
  coverage.kellySizing = { count: kellyCount, rate: roundRate(kellyCount, oddsDenominator) };
  coverage.realEdge = { count: realEdgeCount, rate: roundRate(realEdgeCount, oddsDenominator) };

  const settledPicks = settlements.length;
  const withClv = settlements.filter((row) => {
    const payload = asRecord(row['payload']);
    return payload['clvRaw'] != null || payload['clvPercent'] != null;
  }).length;
  coverage.clvCoverage = { settledPicks, withClv, rate: roundRate(withClv, settledPicks) };

  return { ok: true, data: coverage };
}

export async function getProviderHealth(): Promise<{ ok: true; data: unknown }> {
  const client: Client = getDataClient();
  const staleThresholdMinutes = resolveProviderOfferFreshnessThresholdMinutes();

  const [offersResult, runsResult, latestOfferResult] = await Promise.all([
    client.from('provider_offer_current').select('provider_key, created_at, snapshot_at, provider_event_id'),
    client.from('system_runs').select('*').order('created_at', { ascending: false }).limit(50),
    client.from('provider_offer_current').select('snapshot_at').order('snapshot_at', { ascending: false }).limit(1),
  ]);

  if (offersResult.error) throw new Error(`getProviderHealth: ${String(offersResult.error)}`);

  const rows = (offersResult.data ?? []) as Array<Record<string, unknown>>;
  const recentRuns = (runsResult.data ?? []) as Array<Record<string, unknown>>;
  const last24hCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  const providerKeys = new Set<string>();
  const aggregates = new Map<string, { totalRows: number; last24hRows: number; latestSnapshotMs: number | null }>();
  const distinctEvents = new Set<string>();

  for (const row of rows) {
    const providerKey = asString(row['provider_key']) ?? 'unknown';
    providerKeys.add(providerKey);
    const createdAtMs = Date.parse(asString(row['created_at']) ?? '');
    const snapshotAtRaw = asString(row['snapshot_at']);
    const snapshotAtMs = snapshotAtRaw ? Date.parse(snapshotAtRaw) : Number.NaN;
    const providerEventId = asString(row['provider_event_id']);
    const existing = aggregates.get(providerKey) ?? { totalRows: 0, last24hRows: 0, latestSnapshotMs: null };
    existing.totalRows += 1;
    if (Number.isFinite(createdAtMs) && createdAtMs >= last24hCutoffMs) {
      existing.last24hRows += 1;
      if (providerEventId) distinctEvents.add(providerEventId);
    }
    if (Number.isFinite(snapshotAtMs)) {
      existing.latestSnapshotMs = existing.latestSnapshotMs == null ? snapshotAtMs : Math.max(existing.latestSnapshotMs, snapshotAtMs);
    }
    aggregates.set(providerKey, existing);
  }

  const providers = Array.from(providerKeys).sort((a, b) => a.localeCompare(b)).map((providerKey) => {
    const agg = aggregates.get(providerKey) ?? { totalRows: 0, last24hRows: 0, latestSnapshotMs: null };
    const minutesSinceLastSnapshot = agg.latestSnapshotMs == null
      ? null
      : Math.max(0, Math.floor((Date.now() - agg.latestSnapshotMs) / 60000));
    const status: 'active' | 'stale' | 'absent' =
      agg.latestSnapshotMs == null || agg.totalRows === 0 ? 'absent'
        : minutesSinceLastSnapshot != null && minutesSinceLastSnapshot <= staleThresholdMinutes ? 'active'
          : minutesSinceLastSnapshot != null && minutesSinceLastSnapshot <= staleThresholdMinutes * 12 ? 'stale'
            : 'absent';
    return {
      providerKey,
      totalRows: agg.totalRows,
      last24hRows: agg.last24hRows,
      latestSnapshotAt: agg.latestSnapshotMs == null ? null : new Date(agg.latestSnapshotMs).toISOString(),
      minutesSinceLastSnapshot,
      status,
    };
  });

  const ingestorRuns = recentRuns.filter((r) => String(r['run_type'] ?? '').startsWith('ingestor'));
  const latestIngestorRun = ingestorRuns[0] ?? null;

  const quotaByProvider = new Map<string, { creditsUsed: number; creditsRemaining: number | null }>();
  for (const run of ingestorRuns) {
    const details = run['details'];
    const quota = details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>)['quota'] : null;
    if (!quota || typeof quota !== 'object' || Array.isArray(quota)) continue;
    const q = quota as Record<string, unknown>;
    const provider = typeof q['provider'] === 'string' ? q['provider'] : null;
    if (!provider) continue;
    const existing = quotaByProvider.get(provider) ?? { creditsUsed: 0, creditsRemaining: null };
    if (typeof q['creditsUsed'] === 'number') existing.creditsUsed += q['creditsUsed'];
    if (typeof q['remaining'] === 'number') existing.creditsRemaining = q['remaining'];
    quotaByProvider.set(provider, existing);
  }

  const sgoQuota = quotaByProvider.get('sgo') ?? null;
  const oddsApiEntry = Array.from(quotaByProvider.entries()).find(([k]) => k.toLowerCase().startsWith('odds-api'));
  const oddsQuota = oddsApiEntry ? oddsApiEntry[1] : null;

  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
  const ingestorStale = !latestIngestorRun?.['started_at'] ||
    (Date.now() - new Date(latestIngestorRun['started_at'] as string).getTime()) > STALE_THRESHOLD_MS;

  const latestOfferSnapshotAt = latestOfferResult.data?.[0]?.snapshot_at ?? null;

  return {
    ok: true,
    data: {
      providers,
      ingestorHealth: {
        status: ingestorStale ? 'degraded' : 'healthy',
        lastRunAt: (latestIngestorRun?.['started_at'] as string | null | undefined) ?? null,
      },
      staleThresholdMinutes,
      quotaSummary: {
        sgo: sgoQuota,
        oddsApi: oddsQuota,
      },
      distinctEventsLast24h: distinctEvents.size,
      latestProviderOfferSnapshotAt: latestOfferSnapshotAt,
    },
  };
}
