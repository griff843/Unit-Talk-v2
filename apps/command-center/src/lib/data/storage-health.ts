import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import type { DbRuntimeHealth, StorageDomainHealth, StorageGrowthSource } from '../types.js';

interface DiskConfigResponse {
  attributes?: {
    size_gb?: number;
    iops?: number;
    throughput_mibps?: number;
    type?: string;
  };
  last_modified_at?: string;
}

interface DiskUtilResponse {
  timestamp?: string;
  metrics?: {
    fs_size_bytes?: number;
    fs_avail_bytes?: number;
    fs_used_bytes?: number;
  };
}

interface BackupsResponse {
  pitr_enabled?: boolean;
  walg_enabled?: boolean;
  backups?: Array<{
    status?: string;
    inserted_at?: string;
  }>;
}

interface RestoreResponse {
  available_versions?: Array<{
    version?: string;
  }>;
}

interface RelationSizeRow {
  domain: 'app' | 'ingestion';
  table_name: string;
  total_bytes: number;
  table_bytes: number;
  index_bytes: number;
}

interface RelationGrowthRow {
  table_name: string;
  rows_last_day: number;
}

interface DbPressureRow {
  max_connections: number;
  used_connections: number;
  waiting_connections: number;
  waiting_locks: number;
  max_tx_age_seconds: number;
  long_tx_count: number;
  max_query_age_seconds: number;
  slow_query_count: number;
  wal_bytes: number;
  wal_written_bytes: string | number;
  wal_stats_reset: string | null;
  archive_mode: string | null;
  archive_command: string | null;
}

interface ResolvedManagementEnv {
  accessToken: string;
  projectRef: string;
}

const INGESTION_RELATIONS = new Set([
  'provider_offers',
  'provider_offer_history',
  'provider_cycle_status',
  'system_runs',
]);

const APP_RELATIONS = new Set([
  'picks',
  'distribution_outbox',
  'distribution_receipts',
  'settlement_records',
  'audit_log',
]);

function resolveWorkspaceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
}

function readRawEnvFileValue(root: string, key: string): string | null {
  for (const fileName of ['local.env', '.env']) {
    const filePath = path.join(root, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function resolveManagementEnv(): ResolvedManagementEnv {
  const root = resolveWorkspaceRoot();
  const env = loadEnvironment(root);
  const accessToken =
    process.env['SUPABASE_ACCESS_TOKEN']?.trim() ??
    readRawEnvFileValue(root, 'SUPABASE_ACCESS_TOKEN') ??
    '';
  const projectRef =
    process.env['SUPABASE_PROJECT_REF']?.trim() ??
    env.SUPABASE_PROJECT_REF?.trim() ??
    readRawEnvFileValue(root, 'SUPABASE_PROJECT_REF') ??
    '';

  if (!accessToken || !projectRef) {
    throw new Error('Supabase management credentials are unavailable for storage health.');
  }

  return { accessToken, projectRef };
}

async function fetchManagementJson<T>(route: string): Promise<T> {
  const { accessToken, projectRef } = resolveManagementEnv();
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/${route}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Supabase management request failed for ${route}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function runSqlQuery<T>(query: string): Promise<T[]> {
  const { accessToken, projectRef } = resolveManagementEnv();
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Supabase SQL request failed: ${response.status}`);
  }

  return (await response.json()) as T[];
}

function coerceNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bytesToGiB(bytes: number): number {
  return round(bytes / 1024 / 1024 / 1024, 2);
}

function daysBetween(now: Date, sinceIso: string | null): number {
  if (!sinceIso) {
    return 1;
  }
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    return 1;
  }
  return Math.max((now.getTime() - sinceMs) / 86_400_000, 1 / 24);
}

function classifyProjection(daysToFull: number | null): StorageDomainHealth['alertStatus'] {
  if (daysToFull === null) {
    return 'stable';
  }
  if (daysToFull <= 3) {
    return 'critical';
  }
  if (daysToFull <= 7) {
    return 'warning';
  }
  if (daysToFull <= 14) {
    return 'watch';
  }
  return 'stable';
}

function totalDirectoryBytes(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.size;
  }

  return fs.readdirSync(targetPath).reduce((sum, entry) => {
    return sum + totalDirectoryBytes(path.join(targetPath, entry));
  }, 0);
}

function bytesAddedSince(targetPath: string, cutoffMs: number): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.mtimeMs >= cutoffMs ? stat.size : 0;
  }

  return fs.readdirSync(targetPath).reduce((sum, entry) => {
    return sum + bytesAddedSince(path.join(targetPath, entry), cutoffMs);
  }, 0);
}

function summarizeDomain(
  domain: 'app' | 'ingestion',
  relations: RelationSizeRow[],
  growthRows: Map<string, number>,
  extraSources: StorageGrowthSource[],
  freeBytes: number,
): StorageDomainHealth {
  const domainRelations = relations.filter((row) => row.domain === domain);
  const relationSources: StorageGrowthSource[] = domainRelations.map((row) => {
    const rowsLastDay = growthRows.get(row.table_name) ?? 0;
    const bytesPerRow = row.total_bytes > 0 && rowsLastDay > 0
      ? row.total_bytes / Math.max(rowsLastDay, 1)
      : 0;
    const estimatedGrowthBytesPerDay = rowsLastDay > 0 ? Math.round(rowsLastDay * bytesPerRow) : 0;

    return {
      source: row.table_name,
      tableBytes: row.table_bytes,
      indexBytes: row.index_bytes,
      totalBytes: row.total_bytes,
      estimatedGrowthBytesPerDay,
      rowsLastDay,
    };
  });

  const growthSources = [...relationSources, ...extraSources].sort(
    (left, right) => right.totalBytes - left.totalBytes,
  );
  const totalBytes = growthSources.reduce((sum, row) => sum + row.totalBytes, 0);
  const growthBytesPerDay = growthSources.reduce(
    (sum, row) => sum + row.estimatedGrowthBytesPerDay,
    0,
  );
  const daysToFull = growthBytesPerDay > 0 ? round(freeBytes / growthBytesPerDay, 1) : null;
  const topGrowthSources = growthSources
    .slice()
    .sort((left, right) => right.estimatedGrowthBytesPerDay - left.estimatedGrowthBytesPerDay)
    .slice(0, 4);

  return {
    name: domain,
    totalBytes,
    totalGiB: bytesToGiB(totalBytes),
    estimatedGrowthBytesPerDay: growthBytesPerDay,
    estimatedGrowthGiBPerDay: bytesToGiB(growthBytesPerDay),
    daysToFull,
    alertStatus: classifyProjection(daysToFull),
    topGrowthSources,
  };
}

export async function getStorageHealth(): Promise<DbRuntimeHealth> {
  const now = new Date();
  const [
    diskConfig,
    diskUtil,
    backups,
    restorePoints,
    relationSizes,
    relationGrowth,
    pressureRows,
  ] = await Promise.all([
    fetchManagementJson<DiskConfigResponse>('config/disk'),
    fetchManagementJson<DiskUtilResponse>('config/disk/util'),
    fetchManagementJson<BackupsResponse>('database/backups'),
    fetchManagementJson<RestoreResponse>('restore').catch(() => ({ available_versions: [] })),
    runSqlQuery<RelationSizeRow>(`
      with table_sizes as (
        select * from (values
          ('provider_offers','ingestion'),
          ('provider_offer_history','ingestion'),
          ('provider_cycle_status','ingestion'),
          ('system_runs','ingestion'),
          ('picks','app'),
          ('distribution_outbox','app'),
          ('distribution_receipts','app'),
          ('settlement_records','app'),
          ('audit_log','app')
        ) as t(table_name, domain)
      )
      select
        ts.domain,
        ts.table_name,
        coalesce(pg_total_relation_size(to_regclass(format('public.%I', ts.table_name))), 0)::bigint as total_bytes,
        coalesce(pg_relation_size(to_regclass(format('public.%I', ts.table_name))), 0)::bigint as table_bytes,
        coalesce(pg_indexes_size(to_regclass(format('public.%I', ts.table_name))), 0)::bigint as index_bytes
      from table_sizes ts
      order by total_bytes desc;
    `),
    runSqlQuery<RelationGrowthRow>(`
      select 'provider_offers' as table_name, count(*)::bigint as rows_last_day from provider_offers where created_at >= now() - interval '1 day'
      union all
      select 'provider_offer_history', 0::bigint
      union all
      select 'provider_cycle_status', count(*)::bigint from provider_cycle_status where updated_at >= now() - interval '1 day'
      union all
      select 'system_runs', count(*)::bigint from system_runs where created_at >= now() - interval '1 day'
      union all
      select 'picks', count(*)::bigint from picks where created_at >= now() - interval '1 day'
      union all
      select 'distribution_outbox', count(*)::bigint from distribution_outbox where created_at >= now() - interval '1 day'
      union all
      select 'distribution_receipts', count(*)::bigint from distribution_receipts where recorded_at >= now() - interval '1 day'
      union all
      select 'settlement_records', count(*)::bigint from settlement_records where created_at >= now() - interval '1 day'
      union all
      select 'audit_log', count(*)::bigint from audit_log where created_at >= now() - interval '1 day';
    `),
    runSqlQuery<DbPressureRow>(`
      select
        (select setting::int from pg_settings where name = 'max_connections') as max_connections,
        (select count(*)::int from pg_stat_activity) as used_connections,
        (select count(*)::int from pg_stat_activity where wait_event_type = 'Lock') as waiting_connections,
        (select count(*)::int from pg_locks where not granted) as waiting_locks,
        (select coalesce(max(extract(epoch from now() - xact_start)), 0)::int from pg_stat_activity where xact_start is not null and state <> 'idle') as max_tx_age_seconds,
        (select count(*)::int from pg_stat_activity where xact_start is not null and now() - xact_start > interval '5 minutes' and state <> 'idle') as long_tx_count,
        (select coalesce(max(extract(epoch from now() - query_start)), 0)::int from pg_stat_activity where state = 'active') as max_query_age_seconds,
        (select count(*)::int from pg_stat_activity where state = 'active' and now() - query_start > interval '30 seconds') as slow_query_count,
        (select coalesce(sum(size), 0)::bigint from pg_ls_waldir()) as wal_bytes,
        (select wal_bytes::numeric from pg_stat_wal) as wal_written_bytes,
        (select stats_reset from pg_stat_wal) as wal_stats_reset,
        current_setting('archive_mode', true) as archive_mode,
        current_setting('archive_command', true) as archive_command;
    `),
  ]);

  const pressure = pressureRows[0];
  const fsSizeBytes = coerceNumber(diskUtil.metrics?.fs_size_bytes);
  const fsUsedBytes = coerceNumber(diskUtil.metrics?.fs_used_bytes);
  const fsAvailBytes = coerceNumber(diskUtil.metrics?.fs_avail_bytes);
  const walBytes = coerceNumber(pressure?.wal_bytes);
  const walWrittenBytes = coerceNumber(pressure?.wal_written_bytes);
  const walDays = daysBetween(now, pressure?.wal_stats_reset ?? null);
  const walGrowthBytesPerDay = walWrittenBytes > 0 ? Math.round(walWrittenBytes / walDays) : 0;

  const configuredArchiveDir = process.env['UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR']?.trim();
  const archiveDir = configuredArchiveDir
    ? path.join(resolveWorkspaceRoot(), configuredArchiveDir)
    : path.join(resolveWorkspaceRoot(), 'out', 'provider-payload-archive');
  const archiveTotalBytes = totalDirectoryBytes(archiveDir);
  const archiveGrowthBytesPerDay = bytesAddedSince(
    archiveDir,
    now.getTime() - 86_400_000,
  );

  const growthByTable = new Map(
    relationGrowth.map((row) => [row.table_name, coerceNumber(row.rows_last_day)]),
  );

  const ingestionExtras: StorageGrowthSource[] = [
    {
      source: 'wal',
      tableBytes: walBytes,
      indexBytes: 0,
      totalBytes: walBytes,
      estimatedGrowthBytesPerDay: walGrowthBytesPerDay,
      rowsLastDay: 0,
    },
    {
      source: 'provider_payload_archive',
      tableBytes: archiveTotalBytes,
      indexBytes: 0,
      totalBytes: archiveTotalBytes,
      estimatedGrowthBytesPerDay: archiveGrowthBytesPerDay,
      rowsLastDay: 0,
    },
  ];

  const appExtras: StorageGrowthSource[] = [];

  const storageDomains: StorageDomainHealth[] = [
    summarizeDomain('ingestion', relationSizes, growthByTable, ingestionExtras, fsAvailBytes),
    summarizeDomain('app', relationSizes, growthByTable, appExtras, fsAvailBytes),
  ];

  const topGrowthSources = [
    ...storageDomains.flatMap((domain) => domain.topGrowthSources),
  ]
    .sort((left, right) => right.estimatedGrowthBytesPerDay - left.estimatedGrowthBytesPerDay)
    .slice(0, 6);

  const overallProjectionDays = topGrowthSources.reduce(
    (sum, source) => sum + source.estimatedGrowthBytesPerDay,
    0,
  ) > 0
    ? round(
        fsAvailBytes /
          topGrowthSources.reduce((sum, source) => sum + source.estimatedGrowthBytesPerDay, 0),
        1,
      )
    : null;

  return {
    disk: {
      provisionedGiB: coerceNumber(diskConfig.attributes?.size_gb),
      usedGiB: bytesToGiB(fsUsedBytes),
      availableGiB: bytesToGiB(fsAvailBytes),
      usedPct: fsSizeBytes > 0 ? round((fsUsedBytes / fsSizeBytes) * 100, 1) : 0,
      iops: coerceNumber(diskConfig.attributes?.iops),
      throughputMiBps: coerceNumber(diskConfig.attributes?.throughput_mibps),
      diskType: diskConfig.attributes?.type ?? 'unknown',
      observedAt: diskUtil.timestamp ?? now.toISOString(),
      projectedDaysToFull: overallProjectionDays,
      alertStatus: classifyProjection(overallProjectionDays),
    },
    connections: {
      used: coerceNumber(pressure?.used_connections),
      max: coerceNumber(pressure?.max_connections),
      waiting: coerceNumber(pressure?.waiting_connections),
    },
    locks: {
      waiting: coerceNumber(pressure?.waiting_locks),
    },
    longTransactions: {
      count: coerceNumber(pressure?.long_tx_count),
      maxAgeSeconds: coerceNumber(pressure?.max_tx_age_seconds),
    },
    slowQueries: {
      count: coerceNumber(pressure?.slow_query_count),
      maxAgeSeconds: coerceNumber(pressure?.max_query_age_seconds),
    },
    wal: {
      sizeGiB: bytesToGiB(walBytes),
      estimatedGrowthGiBPerDay: bytesToGiB(walGrowthBytesPerDay),
      archiveMode: pressure?.archive_mode ?? 'unknown',
      archiveConfigured:
        typeof pressure?.archive_command === 'string' &&
        pressure.archive_command.trim().length > 0 &&
        pressure.archive_command !== '(disabled)',
    },
    backups: {
      pitrEnabled: backups.pitr_enabled === true,
      walGEnabled: backups.walg_enabled === true,
      lastBackupAt: backups.backups?.[0]?.inserted_at ?? null,
      lastBackupStatus: backups.backups?.[0]?.status ?? null,
      restorePointCount: restorePoints.available_versions?.length ?? 0,
    },
    storageDomains,
    topGrowthSources,
  };
}

export function classifyStorageDomain(rows: RelationSizeRow[]): {
  appTables: string[];
  ingestionTables: string[];
} {
  return {
    appTables: rows.filter((row) => APP_RELATIONS.has(row.table_name)).map((row) => row.table_name),
    ingestionTables: rows
      .filter((row) => INGESTION_RELATIONS.has(row.table_name))
      .map((row) => row.table_name),
  };
}
