import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

interface DiskAlertSource {
  source: string;
  totalBytes: number;
  estimatedGrowthBytesPerDay: number;
}

interface DiskAlertSnapshot {
  diskUsedBytes: number;
  diskAvailBytes: number;
  projectedDaysToFull: number | null;
  sources: DiskAlertSource[];
}

interface RelationSizeRow {
  table_name: string;
  total_bytes: string | number;
}

interface RelationGrowthRow {
  table_name: string;
  rows_last_day: string | number;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function classifyProjection(daysToFull: number | null): 'stable' | 'watch' | 'warning' | 'critical' {
  if (daysToFull === null) return 'stable';
  if (daysToFull <= 3) return 'critical';
  if (daysToFull <= 7) return 'warning';
  if (daysToFull <= 14) return 'watch';
  return 'stable';
}

function readRawEnvFileValue(key: string): string | null {
  for (const fileName of ['local.env', '.env']) {
    const filePath = path.join(ROOT, fileName);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function resolveManagementCredentials() {
  const env = loadEnvironment(ROOT);
  const accessToken =
    process.env['SUPABASE_ACCESS_TOKEN']?.trim() ??
    readRawEnvFileValue('SUPABASE_ACCESS_TOKEN') ??
    '';
  const projectRef =
    process.env['SUPABASE_PROJECT_REF']?.trim() ??
    env.SUPABASE_PROJECT_REF?.trim() ??
    readRawEnvFileValue('SUPABASE_PROJECT_REF') ??
    '';

  if (!accessToken || !projectRef) {
    throw new Error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF unavailable for disk alerts.');
  }

  return { accessToken, projectRef };
}

async function fetchManagementJson<T>(route: string): Promise<T> {
  const { accessToken, projectRef } = resolveManagementCredentials();
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
  const { accessToken, projectRef } = resolveManagementCredentials();
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

function totalDirectoryBytes(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(targetPath).reduce((sum, entry) => {
    return sum + totalDirectoryBytes(path.join(targetPath, entry));
  }, 0);
}

function bytesAddedSince(targetPath: string, cutoffMs: number): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.mtimeMs >= cutoffMs ? stat.size : 0;
  return fs.readdirSync(targetPath).reduce((sum, entry) => {
    return sum + bytesAddedSince(path.join(targetPath, entry), cutoffMs);
  }, 0);
}

export function summarizeDiskProjection(input: DiskAlertSnapshot) {
  const severity = classifyProjection(input.projectedDaysToFull);
  const topSources = input.sources
    .slice()
    .sort((left, right) => right.estimatedGrowthBytesPerDay - left.estimatedGrowthBytesPerDay)
    .slice(0, 5);

  return {
    severity,
    topSources,
    projectedDaysToFull: input.projectedDaysToFull,
    diskUsedGiB: input.diskUsedBytes / 1024 / 1024 / 1024,
    diskAvailableGiB: input.diskAvailBytes / 1024 / 1024 / 1024,
  };
}

async function loadDiskAlertSnapshot(): Promise<DiskAlertSnapshot> {
  const [{ metrics }, sizeRows, growthRows, walRows] = await Promise.all([
    fetchManagementJson<{ metrics?: { fs_used_bytes?: number; fs_avail_bytes?: number } }>('config/disk/util'),
    runSqlQuery<RelationSizeRow>(`
      select * from (
        select 'provider_offers' as table_name, coalesce(pg_total_relation_size(to_regclass('public.provider_offers')), 0)::bigint as total_bytes
        union all
        select 'provider_offer_history', coalesce(pg_total_relation_size(to_regclass('public.provider_offer_history')), 0)::bigint
        union all
        select 'system_runs', coalesce(pg_total_relation_size(to_regclass('public.system_runs')), 0)::bigint
        union all
        select 'picks', coalesce(pg_total_relation_size(to_regclass('public.picks')), 0)::bigint
        union all
        select 'distribution_outbox', coalesce(pg_total_relation_size(to_regclass('public.distribution_outbox')), 0)::bigint
        union all
        select 'distribution_receipts', coalesce(pg_total_relation_size(to_regclass('public.distribution_receipts')), 0)::bigint
        union all
        select 'settlement_records', coalesce(pg_total_relation_size(to_regclass('public.settlement_records')), 0)::bigint
        union all
        select 'audit_log', coalesce(pg_total_relation_size(to_regclass('public.audit_log')), 0)::bigint
      ) sizes
      order by total_bytes desc;
    `),
    runSqlQuery<RelationGrowthRow>(`
      select 'provider_offers' as table_name, count(*)::bigint as rows_last_day from provider_offers where created_at >= now() - interval '1 day'
      union all
      select 'provider_offer_history', 0::bigint
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
    runSqlQuery<{ wal_bytes: string | number }>(`
      select coalesce(sum(size), 0)::bigint as wal_bytes from pg_ls_waldir();
    `),
  ]);

  const growthByTable = new Map(
    growthRows.map((row) => [row.table_name, coerceNumber(row.rows_last_day)]),
  );
  const rows = sizeRows.map((row) => {
    const totalBytes = coerceNumber(row.total_bytes);
    const rowsLastDay = growthByTable.get(row.table_name) ?? 0;
    const estimatedGrowthBytesPerDay =
      rowsLastDay > 0 && totalBytes > 0 ? Math.round(totalBytes / rowsLastDay) * rowsLastDay : 0;
    return {
      source: row.table_name,
      totalBytes,
      estimatedGrowthBytesPerDay,
    };
  });

  const walBytes = coerceNumber(walRows[0]?.wal_bytes);
  rows.push({
    source: 'wal',
    totalBytes: walBytes,
    estimatedGrowthBytesPerDay: 0,
  });

  const configuredArchiveDir = process.env['UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR']?.trim();
  const archiveDir = configuredArchiveDir
    ? path.join(ROOT, configuredArchiveDir)
    : path.join(ROOT, 'out', 'provider-payload-archive');
  rows.push({
    source: 'provider_payload_archive',
    totalBytes: totalDirectoryBytes(archiveDir),
    estimatedGrowthBytesPerDay: bytesAddedSince(archiveDir, Date.now() - 86_400_000),
  });

  const totalGrowthBytesPerDay = rows.reduce((sum, row) => sum + row.estimatedGrowthBytesPerDay, 0);
  const diskAvailBytes = coerceNumber(metrics?.fs_avail_bytes);

  return {
    diskUsedBytes: coerceNumber(metrics?.fs_used_bytes),
    diskAvailBytes,
    projectedDaysToFull:
      totalGrowthBytesPerDay > 0 ? Number((diskAvailBytes / totalGrowthBytesPerDay).toFixed(1)) : null,
    sources: rows,
  };
}

async function main() {
  const snapshot = await loadDiskAlertSnapshot();
  const summary = summarizeDiskProjection(snapshot);
  const payload = {
    service: 'storage',
    severity: summary.severity,
    projectedDaysToFull: summary.projectedDaysToFull,
    diskUsedGiB: Number(summary.diskUsedGiB.toFixed(2)),
    diskAvailableGiB: Number(summary.diskAvailableGiB.toFixed(2)),
    topGrowthSources: summary.topSources.map((source) => ({
      source: source.source,
      totalGiB: Number((source.totalBytes / 1024 / 1024 / 1024).toFixed(2)),
      growthGiBPerDay: Number(
        (source.estimatedGrowthBytesPerDay / 1024 / 1024 / 1024).toFixed(2),
      ),
    })),
    thresholds: {
      watchDays: 14,
      warningDays: 7,
      criticalDays: 3,
    },
    message:
      summary.projectedDaysToFull == null
        ? 'Disk growth is stable; no days-to-full projection is currently available.'
        : `Projected disk exhaustion in ${summary.projectedDaysToFull.toFixed(1)} day(s).`,
    ts: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload));
  process.exit(summary.severity === 'warning' || summary.severity === 'critical' ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        service: 'storage',
        severity: 'critical',
        message: error instanceof Error ? error.message : String(error),
        ts: new Date().toISOString(),
      }),
    );
    process.exit(1);
  });
}
