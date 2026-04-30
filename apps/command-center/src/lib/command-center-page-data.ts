export interface CommandCenterEvent {
  id: string;
  type: 'system' | 'audit' | 'health' | 'incident';
  title: string;
  detail: string;
  timestamp: string;
  timestampLabel: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface PipelineMetricRow {
  stage: string;
  currentCount: number;
  lagLabel: string;
  sparkline: number[];
  tone: 'healthy' | 'idle' | 'error';
}

export interface PipelineMetricCard {
  label: string;
  value: number;
  detail: string;
  trend: 'up' | 'down' | 'flat';
}

export interface PipelinePageData {
  observedAt: string;
  stages: Array<{ name: string; count: number; status: 'healthy' | 'idle' | 'error' }>;
  lagRows: PipelineMetricRow[];
  backlog: PipelineMetricCard;
  promotionQueue: PipelineMetricCard;
}

export interface ApiHealthCardData {
  provider: string;
  status: 'healthy' | 'degraded' | 'down';
  responseMs: number | null;
  quotaPct: number;
  callsToday: number;
  lastCheckedAt: string | null;
  sparkline: number[];
  detail: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function unwrapResponse(raw: unknown) {
  const top = asRecord(raw);
  return top['data'] !== undefined ? asRecord(top['data']) : top;
}

function minutesSince(timestamp: string | null) {
  if (!timestamp) {
    return null;
  }
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 60_000));
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return 'No timestamp';
  }
  return new Date(timestamp).toLocaleString();
}

function formatRelativeTimestamp(timestamp: string | null) {
  const minutes = minutesSince(timestamp);
  if (minutes == null) {
    return 'Unknown';
  }
  if (minutes < 1) {
    return 'Now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function extractStageSamples(recentPicks: unknown[], status: string) {
  return recentPicks
    .filter((row) => asString(asRecord(row)['status']) === status)
    .map((row) => minutesSince(asNullableString(asRecord(row)['createdAt']) ?? asNullableString(asRecord(row)['created_at'])))
    .filter((value): value is number => value != null)
    .slice(0, 12)
    .reverse();
}

function trendFromSeries(points: number[]): 'up' | 'down' | 'flat' {
  if (points.length < 2) {
    return 'flat';
  }
  const midpoint = Math.max(1, Math.floor(points.length / 2));
  const older = points.slice(0, midpoint);
  const newer = points.slice(midpoint);
  const olderAvg = older.reduce((sum, value) => sum + value, 0) / older.length;
  const newerAvg = newer.reduce((sum, value) => sum + value, 0) / newer.length;
  if (newerAvg > olderAvg + 0.25) {
    return 'up';
  }
  if (newerAvg < olderAvg - 0.25) {
    return 'down';
  }
  return 'flat';
}

function statusTone(hasError: boolean, count: number) {
  if (hasError) {
    return 'error' as const;
  }
  if (count === 0) {
    return 'idle' as const;
  }
  return 'healthy' as const;
}

function recentSampleCounts(recentPicks: unknown[], predicate: (row: Record<string, unknown>) => boolean) {
  return recentPicks
    .slice(0, 12)
    .reverse()
    .map((row) => (predicate(asRecord(row)) ? 1 : 0));
}

export function buildPipelinePageData(snapshotResult: unknown): PipelinePageData {
  const snapshot = unwrapResponse(snapshotResult);
  const observedAt = asString(snapshot['observedAt'], new Date().toISOString());
  const pipeline = asRecord(snapshot['picksPipeline']);
  const counts = asRecord(pipeline['counts']);
  const recentPicks = asArray(pipeline['recentPicks']);
  const outboxCounts = asRecord(snapshot['counts']);
  const workerRuntime = asRecord(snapshot['workerRuntime']);
  const aging = asRecord(snapshot['aging']);

  const validatedCount = asNumber(counts['validated']);
  const queuedCount = asNumber(counts['queued']);
  const postedCount = asNumber(counts['posted']);
  const settledCount = asNumber(counts['settled']);

  const stagedCounts = [
    {
      name: 'Validated',
      count: validatedCount,
      status: statusTone(asNumber(aging['staleValidated']) > 0, validatedCount),
    },
    {
      name: 'Queued',
      count: queuedCount,
      status: statusTone(
        ['stalled', 'blocked'].includes(asString(workerRuntime['drainState'])) ||
          asNumber(outboxCounts['deadLetterOutbox']) > 0,
        queuedCount,
      ),
    },
    {
      name: 'Posted',
      count: postedCount,
      status: statusTone(
        asNumber(aging['stalePosted']) > 0 || asNumber(outboxCounts['failedOutbox']) > 0,
        postedCount,
      ),
    },
    {
      name: 'Settled',
      count: settledCount,
      status: statusTone(false, settledCount),
    },
  ];

  const lagRows: PipelineMetricRow[] = [
    {
      stage: 'Validated',
      currentCount: validatedCount,
      lagLabel: `${Math.max(...extractStageSamples(recentPicks, 'validated'), 0)}m max age`,
      sparkline: extractStageSamples(recentPicks, 'validated'),
      tone: stagedCounts[0].status,
    },
    {
      stage: 'Queued',
      currentCount: queuedCount,
      lagLabel: `${Math.max(...extractStageSamples(recentPicks, 'queued'), 0)}m max age`,
      sparkline: extractStageSamples(recentPicks, 'queued'),
      tone: stagedCounts[1].status,
    },
    {
      stage: 'Posted',
      currentCount: postedCount,
      lagLabel: `${Math.max(...extractStageSamples(recentPicks, 'posted'), 0)}m max age`,
      sparkline: extractStageSamples(recentPicks, 'posted'),
      tone: stagedCounts[2].status,
    },
    {
      stage: 'Settled',
      currentCount: settledCount,
      lagLabel: `${Math.max(...extractStageSamples(recentPicks, 'settled'), 0)}m sample age`,
      sparkline: extractStageSamples(recentPicks, 'settled'),
      tone: stagedCounts[3].status,
    },
  ];

  const backlogValue = asNumber(outboxCounts['pendingOutbox']) + asNumber(outboxCounts['processingOutbox']);
  const backlogSeries = recentSampleCounts(
    recentPicks,
    (row) => ['validated', 'queued'].includes(asString(row['status'])),
  );
  const promotionSeries = recentSampleCounts(
    recentPicks,
    (row) => asString(row['promotionStatus']) === 'qualified' && !['posted', 'settled'].includes(asString(row['status'])),
  );
  const promotionQueueValue = recentPicks.filter((row) => {
    const record = asRecord(row);
    return asString(record['promotionStatus']) === 'qualified' && !['posted', 'settled'].includes(asString(record['status']));
  }).length;

  return {
    observedAt,
    stages: stagedCounts,
    lagRows,
    backlog: {
      label: 'Backlog Count',
      value: backlogValue,
      detail: `${compactNumber(asNumber(outboxCounts['pendingOutbox']))} pending / ${compactNumber(asNumber(outboxCounts['processingOutbox']))} processing`,
      trend: trendFromSeries(backlogSeries),
    },
    promotionQueue: {
      label: 'Promotion Queue Depth',
      value: promotionQueueValue,
      detail: 'Qualified picks waiting to finish queue or posting stages',
      trend: trendFromSeries(promotionSeries),
    },
  };
}

function toneFromRunStatus(status: string): CommandCenterEvent['tone'] {
  if (status === 'failed' || status === 'cancelled') {
    return 'error';
  }
  if (status === 'running') {
    return 'warning';
  }
  return 'success';
}

export function buildEventFeedData(snapshotResult: unknown) {
  const snapshot = unwrapResponse(snapshotResult);
  const recentRuns = asArray(snapshot['recentRuns']);
  const recentAudit = asArray(snapshot['recentAudit']);
  const healthSignals = asArray(snapshot['health']);
  const incidents = asArray(snapshot['incidents']);

  const events: CommandCenterEvent[] = [];

  for (const run of recentRuns.slice(0, 20)) {
    const record = asRecord(run);
    const timestamp = asNullableString(record['started_at']) ?? asNullableString(record['created_at']) ?? new Date().toISOString();
    events.push({
      id: `run-${asString(record['id'], timestamp)}`,
      type: 'system',
      title: asString(record['run_type'], 'system.run'),
      detail: `Run status: ${asString(record['status'], 'unknown')}`,
      timestamp,
      timestampLabel: formatRelativeTimestamp(timestamp),
      tone: toneFromRunStatus(asString(record['status'])),
    });
  }

  for (const row of recentAudit.slice(0, 12)) {
    const record = asRecord(row);
    const timestamp = asNullableString(record['created_at']) ?? new Date().toISOString();
    events.push({
      id: `audit-${asString(record['id'], timestamp)}`,
      type: 'audit',
      title: asString(record['action'], 'audit.entry'),
      detail: `${asString(record['entity_type'], 'entity')} ${asString(record['entity_ref'], '')}`.trim(),
      timestamp,
      timestampLabel: formatRelativeTimestamp(timestamp),
      tone: 'info',
    });
  }

  for (const row of healthSignals) {
    const record = asRecord(row);
    const timestamp = new Date().toISOString();
    const status = asString(record['status']);
    events.push({
      id: `health-${asString(record['component'], timestamp)}`,
      type: 'health',
      title: `${asString(record['component'], 'component')} ${status}`,
      detail: asString(record['detail'], 'No detail available'),
      timestamp,
      timestampLabel: formatRelativeTimestamp(timestamp),
      tone: status === 'down' ? 'error' : status === 'degraded' ? 'warning' : 'success',
    });
  }

  for (const row of incidents) {
    const record = asRecord(row);
    const timestamp = new Date().toISOString();
    events.push({
      id: `incident-${asString(record['type'], timestamp)}`,
      type: 'incident',
      title: asString(record['summary'], 'Incident'),
      detail: `${asString(record['severity'], 'unknown')} severity / ${compactNumber(asNumber(record['affectedCount']))} affected`,
      timestamp,
      timestampLabel: formatRelativeTimestamp(timestamp),
      tone: asString(record['severity']) === 'critical' ? 'error' : 'warning',
    });
  }

  events.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return events;
}

function baseProviderKey(providerKey: string) {
  return providerKey.split(':', 1)[0] ?? providerKey;
}

function pushLatencySample(collection: Map<string, number[]>, providerKey: string, latencyMs: number | null) {
  if (latencyMs == null) {
    return;
  }
  const existing = collection.get(providerKey) ?? [];
  existing.push(latencyMs);
  collection.set(providerKey, existing.slice(-12));
}

export function buildApiHealthPageData(
  providerHealthResult: unknown,
  snapshotResult: unknown,
  latencySamples: Array<{ providerKey: string; updatedAt: string; totalLatencyMs: number | null }>,
): ApiHealthCardData[] {
  const providerHealth = unwrapResponse(providerHealthResult);
  const snapshot = unwrapResponse(snapshotResult);
  const providerRows = asArray(providerHealth['providers']).map(asRecord);
  const quotaSummary = asRecord(snapshot['quotaSummary']);
  const quotaProviders = asArray(quotaSummary['providers']).map(asRecord);

  const providerMap = new Map<string, ApiHealthCardData>();
  const latencyByProvider = new Map<string, number[]>();

  for (const sample of latencySamples.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))) {
    pushLatencySample(latencyByProvider, baseProviderKey(sample.providerKey), sample.totalLatencyMs);
  }

  for (const row of providerRows) {
    const baseKey = baseProviderKey(asString(row['providerKey']));
    const current = providerMap.get(baseKey) ?? {
      provider: baseKey.toUpperCase() === 'SGO' ? 'SGO' : baseKey.replace(/^odds-api$/i, 'Odds API'),
      status: 'down' as const,
      responseMs: null,
      quotaPct: 0,
      callsToday: 0,
      lastCheckedAt: null,
      sparkline: latencyByProvider.get(baseKey) ?? [],
      detail: '',
    };

    const latestSnapshotAt = asNullableString(row['latestSnapshotAt']);
    const nextStatus = asString(row['status']) === 'active'
      ? 'healthy'
      : asString(row['status']) === 'stale'
        ? 'degraded'
        : current.status;

    providerMap.set(baseKey, {
      ...current,
      status: nextStatus,
      callsToday: current.callsToday + asNumber(row['last24hRows']),
      lastCheckedAt:
        current.lastCheckedAt == null || (latestSnapshotAt != null && Date.parse(latestSnapshotAt) > Date.parse(current.lastCheckedAt))
          ? latestSnapshotAt
          : current.lastCheckedAt,
      detail: `${compactNumber(asNumber(row['totalRows']))} live rows / ${compactNumber(asNumber(row['last24hRows']))} rows in last 24h`,
    });
  }

  for (const row of quotaProviders) {
    const provider = baseProviderKey(asString(row['provider']));
    const limit = asNumber(row['limit'], 0);
    const used = asNumber(row['creditsUsed']);
    const remaining = asNumber(row['remaining'], 0);
    const quotaBasis = limit > 0 ? limit : used + remaining;
    const quotaPct = quotaBasis > 0 ? Math.min(100, Math.round((used / quotaBasis) * 100)) : 0;
    const current = providerMap.get(provider) ?? {
      provider: provider.toUpperCase() === 'SGO' ? 'SGO' : provider.replace(/^odds-api$/i, 'Odds API'),
      status: 'down' as const,
      responseMs: null,
      quotaPct: 0,
      callsToday: 0,
      lastCheckedAt: null,
      sparkline: latencyByProvider.get(provider) ?? [],
      detail: '',
    };
    const sparkline = latencyByProvider.get(provider) ?? [];

    providerMap.set(provider, {
      ...current,
      responseMs: sparkline.length > 0
        ? Math.round(sparkline.reduce((sum, value) => sum + value, 0) / sparkline.length)
        : current.responseMs,
      quotaPct,
      callsToday: Math.max(current.callsToday, asNumber(row['requestCount'])),
      lastCheckedAt:
        current.lastCheckedAt == null || Date.parse(asString(row['lastSeenAt'], '1970-01-01T00:00:00.000Z')) > Date.parse(current.lastCheckedAt)
          ? asNullableString(row['lastSeenAt'])
          : current.lastCheckedAt,
      sparkline,
      detail: current.detail || `${compactNumber(asNumber(row['runCount']))} ingest run(s) with quota headers`,
    });
  }

  return Array.from(providerMap.values()).sort((left, right) => left.provider.localeCompare(right.provider));
}

export function formatObservedAt(timestamp: string | null) {
  return formatTimestamp(timestamp);
}
