import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';

import { loadDiskAlertSnapshot, summarizeDiskProjection } from './disk-growth-alert.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface LegacyRetentionMitigationOptions {
  retentionDays: number;
  batchSize: number;
  maxBatches: number;
  apply: boolean;
}

interface QueryRow {
  [key: string]: string | number | boolean | null;
}

interface OldRowProofRow extends QueryRow {
  old_rows_total: string | number;
  old_rows_preserved: string | number;
  old_rows_deletable: string | number;
  oldest_old_row_at: string | null;
  newest_old_row_at: string | null;
}

interface RelationSizeProofRow extends QueryRow {
  total_bytes: string | number;
  table_bytes: string | number;
  index_bytes: string | number;
}

interface IndexProofRow extends QueryRow {
  index_name: string;
  index_bytes: string | number;
}

interface WalProofRow extends QueryRow {
  wal_bytes: string | number;
  wal_written_bytes: string | number;
  stats_reset: string | null;
}

interface DeleteBatchProofRow extends QueryRow {
  deleted_rows: string | number;
  remaining_deletable_rows: string | number;
  preserved_old_rows: string | number;
}

interface MitigationSnapshot {
  oldRows: {
    total: number;
    preserved: number;
    deletable: number;
    oldest: string | null;
    newest: string | null;
  };
  relation: {
    totalBytes: number;
    tableBytes: number;
    indexBytes: number;
  };
  indexes: Array<{ name: string; bytes: number }>;
  wal: {
    walBytes: number;
    walWrittenBytes: number;
    statsReset: string | null;
  };
  diskAlert: ReturnType<typeof summarizeDiskProjection>;
}

function coerceNumber(value: string | number | boolean | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
    throw new Error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF unavailable for legacy provider_offers mitigation.');
  }

  return { accessToken, projectRef };
}

export function parseCliOptions(args: string[]): LegacyRetentionMitigationOptions {
  return {
    retentionDays: parsePositiveInt(readFlagValue(args, '--retention-days')) ?? 7,
    batchSize: parsePositiveInt(readFlagValue(args, '--batch-size')) ?? 5_000,
    maxBatches: parsePositiveInt(readFlagValue(args, '--max-batches')) ?? 20,
    apply: args.includes('--apply'),
  };
}

export function buildCutoffIso(retentionDays: number, nowIso = new Date().toISOString()) {
  return new Date(
    Date.parse(nowIso) - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function buildPreserveEventIdsCte() {
  return `
    preserve_event_ids AS (
      SELECT DISTINCT resolved.provider_event_id
      FROM public.picks pick
      LEFT JOIN public.events event_by_id
        ON event_by_id.id::text = nullif(pick.metadata->>'eventId', '')
      LEFT JOIN public.events event_by_external
        ON event_by_external.external_id = nullif(pick.metadata->>'eventId', '')
      LEFT JOIN public.events event_by_name
        ON event_by_name.event_name = nullif(pick.metadata->>'eventName', '')
      CROSS JOIN LATERAL (
        VALUES (
          COALESCE(
            event_by_id.external_id,
            event_by_external.external_id,
            event_by_name.external_id
          )
        )
      ) AS resolved(provider_event_id)
      WHERE pick.status NOT IN ('settled', 'voided')
        AND resolved.provider_event_id IS NOT NULL
    )
  `;
}

export function buildOldRowProofQuery(cutoffIso: string) {
  return `
    WITH
      params AS (
        SELECT '${cutoffIso}'::timestamptz AS cutoff
      ),
      ${buildPreserveEventIdsCte()},
      old_rows AS (
        SELECT
          offer.created_at,
          preserve.provider_event_id IS NOT NULL AS preserved
        FROM public.provider_offers offer
        CROSS JOIN params
        LEFT JOIN preserve_event_ids preserve
          ON preserve.provider_event_id = offer.provider_event_id
        WHERE offer.created_at < params.cutoff
      )
    SELECT
      count(*)::bigint AS old_rows_total,
      count(*) FILTER (WHERE preserved)::bigint AS old_rows_preserved,
      count(*) FILTER (WHERE NOT preserved)::bigint AS old_rows_deletable,
      min(created_at)::text AS oldest_old_row_at,
      max(created_at)::text AS newest_old_row_at
    FROM old_rows;
  `;
}

export function buildRelationSizeProofQuery() {
  return `
    SELECT
      coalesce(pg_total_relation_size(to_regclass('public.provider_offers')), 0)::bigint AS total_bytes,
      coalesce(pg_table_size(to_regclass('public.provider_offers')), 0)::bigint AS table_bytes,
      coalesce(pg_indexes_size(to_regclass('public.provider_offers')), 0)::bigint AS index_bytes;
  `;
}

export function buildLargestIndexesProofQuery(limit = 5) {
  return `
    SELECT
      indexrelid::regclass::text AS index_name,
      pg_relation_size(indexrelid)::bigint AS index_bytes
    FROM pg_index
    WHERE indrelid = to_regclass('public.provider_offers')
    ORDER BY pg_relation_size(indexrelid) DESC, indexrelid::regclass::text ASC
    LIMIT ${Math.max(limit, 1)};
  `;
}

export function buildWalProofQuery() {
  return `
    SELECT
      (SELECT coalesce(sum(size), 0)::bigint FROM pg_ls_waldir()) AS wal_bytes,
      coalesce((SELECT wal_bytes::bigint FROM pg_stat_wal), 0)::bigint AS wal_written_bytes,
      (SELECT stats_reset::text FROM pg_stat_wal) AS stats_reset;
  `;
}

export function buildDeleteBatchQuery(cutoffIso: string, batchSize: number) {
  return `
    WITH
      params AS (
        SELECT '${cutoffIso}'::timestamptz AS cutoff
      ),
      ${buildPreserveEventIdsCte()},
      doomed AS (
        SELECT offer.id
        FROM public.provider_offers offer
        CROSS JOIN params
        LEFT JOIN preserve_event_ids preserve
          ON preserve.provider_event_id = offer.provider_event_id
        WHERE offer.created_at < params.cutoff
          AND preserve.provider_event_id IS NULL
        ORDER BY offer.created_at ASC, offer.id ASC
        LIMIT ${Math.max(batchSize, 1)}
      ),
      deleted AS (
        DELETE FROM public.provider_offers
        WHERE id IN (SELECT id FROM doomed)
        RETURNING id
      ),
      remaining AS (
        SELECT
          count(*) FILTER (WHERE preserve.provider_event_id IS NULL)::bigint AS remaining_deletable_rows,
          count(*) FILTER (WHERE preserve.provider_event_id IS NOT NULL)::bigint AS preserved_old_rows
        FROM public.provider_offers offer
        CROSS JOIN params
        LEFT JOIN preserve_event_ids preserve
          ON preserve.provider_event_id = offer.provider_event_id
        WHERE offer.created_at < params.cutoff
      )
    SELECT
      (SELECT count(*)::bigint FROM deleted) AS deleted_rows,
      remaining.remaining_deletable_rows,
      remaining.preserved_old_rows
    FROM remaining;
  `;
}

async function runSqlQuery<T extends QueryRow>(query: string): Promise<T[]> {
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
    const body = await response.text();
    const error = new Error(`Supabase SQL request failed: ${response.status} ${body}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T[];
}

function isTimeoutLike(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return (
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes('timeout') ||
    message.includes('statement timeout') ||
    message.includes('canceling statement')
  );
}

async function loadSnapshot(cutoffIso: string): Promise<MitigationSnapshot> {
  const [oldRows, relation, indexes, wal, diskAlertSnapshot] = await Promise.all([
    runSqlQuery<OldRowProofRow>(buildOldRowProofQuery(cutoffIso)),
    runSqlQuery<RelationSizeProofRow>(buildRelationSizeProofQuery()),
    runSqlQuery<IndexProofRow>(buildLargestIndexesProofQuery()),
    runSqlQuery<WalProofRow>(buildWalProofQuery()),
    loadDiskAlertSnapshot(),
  ]);

  const oldRow = oldRows[0];
  const relationRow = relation[0];
  const walRow = wal[0];

  return {
    oldRows: {
      total: coerceNumber(oldRow?.old_rows_total),
      preserved: coerceNumber(oldRow?.old_rows_preserved),
      deletable: coerceNumber(oldRow?.old_rows_deletable),
      oldest: typeof oldRow?.oldest_old_row_at === 'string' ? oldRow.oldest_old_row_at : null,
      newest: typeof oldRow?.newest_old_row_at === 'string' ? oldRow.newest_old_row_at : null,
    },
    relation: {
      totalBytes: coerceNumber(relationRow?.total_bytes),
      tableBytes: coerceNumber(relationRow?.table_bytes),
      indexBytes: coerceNumber(relationRow?.index_bytes),
    },
    indexes: indexes.map((row) => ({
      name: row.index_name,
      bytes: coerceNumber(row.index_bytes),
    })),
    wal: {
      walBytes: coerceNumber(walRow?.wal_bytes),
      walWrittenBytes: coerceNumber(walRow?.wal_written_bytes),
      statsReset: typeof walRow?.stats_reset === 'string' ? walRow.stats_reset : null,
    },
    diskAlert: summarizeDiskProjection(diskAlertSnapshot),
  };
}

function printSnapshot(label: string, snapshot: MitigationSnapshot) {
  console.log(`\n${label}`);
  console.log(JSON.stringify({
    oldRows: snapshot.oldRows,
    relation: snapshot.relation,
    largestIndexes: snapshot.indexes,
    wal: snapshot.wal,
    diskAlert: {
      severity: snapshot.diskAlert.severity,
      projectedDaysToFull: snapshot.diskAlert.projectedDaysToFull,
      diskAvailableGiB: Number(snapshot.diskAlert.diskAvailableGiB.toFixed(2)),
      diskUsedGiB: Number(snapshot.diskAlert.diskUsedGiB.toFixed(2)),
      topSources: snapshot.diskAlert.topSources.map((source) => ({
        source: source.source,
        totalGiB: Number((source.totalBytes / 1024 / 1024 / 1024).toFixed(2)),
        growthGiBPerDay: Number((source.estimatedGrowthBytesPerDay / 1024 / 1024 / 1024).toFixed(2)),
      })),
    },
  }, null, 2));
}

async function applyBatches(cutoffIso: string, options: LegacyRetentionMitigationOptions) {
  let batchesRun = 0;
  let deletedRows = 0;
  let timeoutEncountered = false;
  let remainingDeletableRows = 0;
  let preservedOldRows = 0;

  while (batchesRun < options.maxBatches) {
    try {
      const rows = await runSqlQuery<DeleteBatchProofRow>(
        buildDeleteBatchQuery(cutoffIso, options.batchSize),
      );
      const row = rows[0];
      const deletedThisBatch = coerceNumber(row?.deleted_rows);
      remainingDeletableRows = coerceNumber(row?.remaining_deletable_rows);
      preservedOldRows = coerceNumber(row?.preserved_old_rows);

      if (deletedThisBatch === 0) {
        break;
      }

      batchesRun += 1;
      deletedRows += deletedThisBatch;
      console.log(
        JSON.stringify({
          batch: batchesRun,
          deletedRows: deletedThisBatch,
          deletedRowsTotal: deletedRows,
          remainingDeletableRows,
          preservedOldRows,
        }),
      );
    } catch (error) {
      if (isTimeoutLike(error)) {
        timeoutEncountered = true;
        break;
      }
      throw error;
    }
  }

  return {
    batchesRun,
    deletedRows,
    timeoutEncountered,
    remainingDeletableRows,
    preservedOldRows,
  };
}

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function parsePositiveInt(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const cutoffIso = buildCutoffIso(options.retentionDays);

  console.log(JSON.stringify({
    retentionDays: options.retentionDays,
    batchSize: options.batchSize,
    maxBatches: options.maxBatches,
    apply: options.apply,
    cutoffIso,
  }));

  const before = await loadSnapshot(cutoffIso);
  printSnapshot('before', before);

  let applyResult = {
    batchesRun: 0,
    deletedRows: 0,
    timeoutEncountered: false,
    remainingDeletableRows: before.oldRows.deletable,
    preservedOldRows: before.oldRows.preserved,
  };

  if (options.apply) {
    applyResult = await applyBatches(cutoffIso, options);
  }

  const after = await loadSnapshot(cutoffIso);
  printSnapshot('after', after);

  console.log('\nsummary');
  console.log(JSON.stringify({
    mode: options.apply ? 'apply' : 'dry-run',
    deletedRows: applyResult.deletedRows,
    batchesRun: applyResult.batchesRun,
    timeoutEncountered: applyResult.timeoutEncountered,
    before: {
      oldRows: before.oldRows.total,
      deletableOldRows: before.oldRows.deletable,
      preservedOldRows: before.oldRows.preserved,
      providerOffersTotalBytes: before.relation.totalBytes,
      providerOffersTableBytes: before.relation.tableBytes,
      providerOffersIndexBytes: before.relation.indexBytes,
      walWrittenBytes: before.wal.walWrittenBytes,
      diskAvailableGiB: Number(before.diskAlert.diskAvailableGiB.toFixed(2)),
      projectedDaysToFull: before.diskAlert.projectedDaysToFull,
      severity: before.diskAlert.severity,
    },
    after: {
      oldRows: after.oldRows.total,
      deletableOldRows: after.oldRows.deletable,
      preservedOldRows: after.oldRows.preserved,
      providerOffersTotalBytes: after.relation.totalBytes,
      providerOffersTableBytes: after.relation.tableBytes,
      providerOffersIndexBytes: after.relation.indexBytes,
      walWrittenBytes: after.wal.walWrittenBytes,
      diskAvailableGiB: Number(after.diskAlert.diskAvailableGiB.toFixed(2)),
      projectedDaysToFull: after.diskAlert.projectedDaysToFull,
      severity: after.diskAlert.severity,
    },
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
