import { getDataClient } from './client.js';
import type {
  ProviderCycleHealthSummary,
  ProviderCycleStatusRow,
  ProviderCycleFreshnessStatus,
  ProviderCycleProofStatus,
  ProviderCycleStageStatus,
  ProviderHealth,
} from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

interface ProviderCycleStatusDbRow {
  run_id: string;
  provider_key: string;
  league: string;
  cycle_snapshot_at: string;
  stage_status: ProviderCycleStageStatus;
  freshness_status: ProviderCycleFreshnessStatus;
  proof_status: ProviderCycleProofStatus;
  staged_count: number;
  merged_count: number;
  duplicate_count: number;
  failure_category: ProviderCycleStatusRow['failureCategory'];
  failure_scope: ProviderCycleStatusRow['failureScope'];
  last_error: string | null;
  updated_at: string;
}

function compareIsoDesc(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function toProductionStatus(
  row: ProviderCycleStatusDbRow,
): Pick<ProviderCycleStatusRow, 'productionStatus' | 'statusReason'> {
  if (row.stage_status === 'failed') {
    return { productionStatus: 'critical', statusReason: 'Cycle failed before a safe merge state.' };
  }
  if (row.freshness_status === 'stale') {
    return { productionStatus: 'critical', statusReason: 'Freshness gate blocked this staging lane as stale.' };
  }
  if (row.freshness_status === 'invalid_snapshot') {
    return { productionStatus: 'critical', statusReason: 'Snapshot timestamp is invalid, so freshness cannot be trusted.' };
  }
  if (row.stage_status === 'merge_blocked' && row.proof_status === 'required') {
    return { productionStatus: 'warning', statusReason: 'Replay proof is still required before merge is allowed.' };
  }
  if (row.stage_status === 'merge_blocked') {
    return { productionStatus: 'critical', statusReason: 'Merge is blocked for this staging lane.' };
  }
  if (row.stage_status === 'pending' || row.stage_status === 'staged') {
    return { productionStatus: 'warning', statusReason: 'Cycle is staged but not yet merged into live offer truth.' };
  }
  if (row.stage_status === 'merged' && row.proof_status === 'waived') {
    return { productionStatus: 'warning', statusReason: 'Cycle merged under an explicit proof waiver.' };
  }
  return { productionStatus: 'healthy', statusReason: 'Cycle merged with fresh staging data.' };
}

function mapCycleRow(row: ProviderCycleStatusDbRow): ProviderCycleStatusRow {
  const production = toProductionStatus(row);
  return {
    runId: row.run_id,
    providerKey: row.provider_key,
    league: row.league,
    cycleSnapshotAt: row.cycle_snapshot_at,
    stageStatus: row.stage_status,
    freshnessStatus: row.freshness_status,
    proofStatus: row.proof_status,
    stagedCount: row.staged_count,
    mergedCount: row.merged_count,
    duplicateCount: row.duplicate_count,
    failureCategory: row.failure_category,
    failureScope: row.failure_scope,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    productionStatus: production.productionStatus,
    statusReason: production.statusReason,
  };
}

export function summarizeProviderCycleHealth(
  rows: ProviderCycleStatusDbRow[],
  providerHealth?: Pick<ProviderHealth, 'latestProviderOfferSnapshotAt'>,
): ProviderCycleHealthSummary {
  const latestByLane = new Map<string, ProviderCycleStatusDbRow>();

  for (const row of [...rows].sort((left, right) => compareIsoDesc(left.updated_at, right.updated_at))) {
    const key = `${row.provider_key}::${row.league}`;
    if (!latestByLane.has(key)) {
      latestByLane.set(key, row);
    }
  }

  const mappedRows = Array.from(latestByLane.values())
    .map(mapCycleRow)
    .sort((left, right) => compareIsoDesc(left.updatedAt, right.updatedAt));

  const blockedLanes = mappedRows.filter((row) => row.stageStatus === 'merge_blocked').length;
  const failedLanes = mappedRows.filter((row) => row.stageStatus === 'failed').length;
  const staleLanes = mappedRows.filter(
    (row) => row.freshnessStatus === 'stale' || row.freshnessStatus === 'invalid_snapshot',
  ).length;
  const proofRequiredLanes = mappedRows.filter((row) => row.proofStatus === 'required').length;
  const mergedLanes = mappedRows.filter((row) => row.stageStatus === 'merged').length;
  const warningLanes = mappedRows.filter((row) => row.productionStatus === 'warning').length;

  let overallStatus: ProviderCycleHealthSummary['overallStatus'] = 'healthy';
  if (failedLanes > 0 || staleLanes > 0) {
    overallStatus = 'critical';
  } else if (blockedLanes > 0 || proofRequiredLanes > 0 || warningLanes > 0) {
    overallStatus = 'warning';
  }

  return {
    overallStatus,
    trackedLanes: mappedRows.length,
    mergedLanes,
    blockedLanes,
    failedLanes,
    staleLanes,
    proofRequiredLanes,
    latestCycleSnapshotAt: mappedRows[0]?.cycleSnapshotAt ?? null,
    latestUpdatedAt: mappedRows[0]?.updatedAt ?? null,
    liveOfferSnapshotAt: providerHealth?.latestProviderOfferSnapshotAt ?? null,
    rows: mappedRows,
  };
}

export async function getProviderCycleHealth(
  providerHealth?: Pick<ProviderHealth, 'latestProviderOfferSnapshotAt'>,
): Promise<ProviderCycleHealthSummary> {
  const client: Client = getDataClient();
  const { data, error } = await client
    .from('provider_cycle_status')
    .select([
      'run_id',
      'provider_key',
      'league',
      'cycle_snapshot_at',
      'stage_status',
      'freshness_status',
      'proof_status',
      'staged_count',
      'merged_count',
      'duplicate_count',
      'failure_category',
      'failure_scope',
      'last_error',
      'updated_at',
    ].join(','))
    .order('updated_at', { ascending: false })
    .limit(250);

  if (error) {
    throw new Error(`getProviderCycleHealth: ${String(error.message ?? error)}`);
  }

  return summarizeProviderCycleHealth((data ?? []) as ProviderCycleStatusDbRow[], providerHealth);
}

export async function getProviderCycleLatencySamples(): Promise<Array<{ providerKey: string; updatedAt: string; totalLatencyMs: number | null }>> {
  // Returns freshness samples for provider health sparklines.
  // Compact/current offer truth does not persist per-row latency, so we surface
  // the latest cycle update timestamp per provider and leave latency null.
  const client: Client = getDataClient();
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

  const { data, error } = await client
    .from('provider_cycle_status')
    .select('provider_key, updated_at')
    .gte('updated_at', new Date(oneDayAgoMs).toISOString())
    .order('updated_at', { ascending: false });

  if (error) {
    // Return empty array on error (no latency data available)
    return [];
  }

  const samplesByProvider = new Map<string, { timestamps: string[] }>();
  for (const row of (data ?? []) as Array<{ provider_key: string; updated_at: string }>) {
    const key = String(row.provider_key ?? '').toLowerCase();
    if (!key) continue;

    if (!samplesByProvider.has(key)) {
      samplesByProvider.set(key, { timestamps: [] });
    }
    const samples = samplesByProvider.get(key)!;
    samples.timestamps.push(row.updated_at);
  }

  const result: Array<{ providerKey: string; updatedAt: string; totalLatencyMs: number | null }> = [];
  for (const [providerKey, samples] of samplesByProvider.entries()) {
    result.push({
      providerKey,
      updatedAt: samples.timestamps[0] ?? new Date().toISOString(),
      totalLatencyMs: null,
    });
  }

  return result;
}
