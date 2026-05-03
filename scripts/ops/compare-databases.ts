#!/usr/bin/env tsx
/**
 * Read-only Supabase vs Hetzner database comparison.
 *
 * Uses SELECT-only psql calls. This script intentionally avoids repository and
 * app imports so it can compare two raw Postgres endpoints before cutover.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROW_COUNT_TABLES = [
  'picks',
  'pick_candidates',
  'approved_picks',
  'outbox',
  'receipts',
  'settlements',
  'pick_grades',
] as const;
const FRESHNESS_TABLES = ['provider_offers', 'provider_offer_current'] as const;
const STATUS_TABLES = ['approved_picks', 'outbox', 'receipts', 'settlements'] as const;
const TIMESTAMP_COLUMN_CANDIDATES = [
  'updated_at',
  'snapshot_at',
  'created_at',
  'recorded_at',
  'settled_at',
  'queued_at',
  'inserted_at',
] as const;

type DatabaseName = 'supabase' | 'hetzner';
type CountValue = number | null;

interface TableComparison {
  supabase: CountValue;
  hetzner: CountValue;
  delta: number | null;
  match: boolean;
}

interface FreshnessComparison {
  supabase: string | null;
  hetzner: string | null;
  match: boolean;
}

interface StatusComparison {
  supabase: number;
  hetzner: number;
}

interface SchemaTableInfo {
  exists: boolean;
  columns: string[];
}

interface CompareReport {
  tables: Record<string, TableComparison>;
  freshness: Record<string, FreshnessComparison>;
  status_distributions: Record<string, Record<string, StatusComparison>>;
  mismatches: string[];
  generated_at: string;
  dry_run: boolean;
}

interface DryRunSchemaReport extends CompareReport {
  schema: Record<string, Record<DatabaseName, SchemaTableInfo>>;
}

function parseEnvFile(filePath: string): Array<[string, string]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const entries: Array<[string, string]> = [];
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    entries.push([key, value]);
  }

  return entries;
}

function loadEnvironment(rootDir = process.cwd()): Map<string, string> {
  const merged = new Map<string, string>();
  for (const envFile of ['.env.example', '.env', 'local.env']) {
    for (const [key, value] of parseEnvFile(path.join(rootDir, envFile))) {
      merged.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length > 0) {
      merged.set(key, value);
    }
  }

  return merged;
}

function readEnv(env: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = env.get(key);
    if (value && value.length > 0) {
      return value;
    }
  }

  return null;
}

function requireDatabaseUrls(): Record<DatabaseName, string> {
  const env = loadEnvironment();
  const supabaseUrl = readEnv(env, [
    'SUPABASE_DATABASE_URL',
    'SUPABASE_DB_URL',
    'DATABASE_URL',
  ]);
  const hetznerUrl = readEnv(env, ['HETZNER_DATABASE_URL']);

  if (!supabaseUrl) {
    throw new Error(
      'Missing Supabase database URL. Set SUPABASE_DATABASE_URL or SUPABASE_DB_URL.',
    );
  }

  if (!hetznerUrl) {
    throw new Error('Missing HETZNER_DATABASE_URL. Set it before running db:compare.');
  }

  return { supabase: supabaseUrl, hetzner: hetznerUrl };
}

function quoteIdent(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function selectJson<T>(connectionString: string, sql: string): Promise<T> {
  const { stdout } = await execFileAsync(
    'psql',
    [
      connectionString,
      '--no-align',
      '--tuples-only',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      sql,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        PGOPTIONS: '-c default_transaction_read_only=on',
      },
    },
  );

  return JSON.parse(stdout.trim()) as T;
}

async function tableExists(connectionString: string, table: string): Promise<boolean> {
  const sql = `SELECT json_build_object('exists', to_regclass(${quoteLiteral(`public.${table}`)}) IS NOT NULL);`;
  const result = await selectJson<{ exists: boolean }>(connectionString, sql);
  return result.exists;
}

async function getColumns(connectionString: string, table: string): Promise<string[]> {
  const sql = `
    SELECT COALESCE(json_agg(column_name ORDER BY ordinal_position), '[]'::json)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${quoteLiteral(table)};
  `;
  return selectJson<string[]>(connectionString, sql);
}

async function countRows(connectionString: string, table: string): Promise<CountValue> {
  if (!(await tableExists(connectionString, table))) {
    return null;
  }

  const sql = `SELECT json_build_object('count', count(*)::bigint::text) FROM public.${quoteIdent(table)};`;
  const result = await selectJson<{ count: string }>(connectionString, sql);
  return Number(result.count);
}

async function latestTimestamp(connectionString: string, table: string): Promise<string | null> {
  if (!(await tableExists(connectionString, table))) {
    return null;
  }

  const columns = new Set(await getColumns(connectionString, table));
  const timestampColumn = TIMESTAMP_COLUMN_CANDIDATES.find((column) => columns.has(column));
  if (!timestampColumn) {
    return null;
  }

  const sql = `
    SELECT json_build_object(
      'latest',
      to_json(max(${quoteIdent(timestampColumn)})::timestamptz)
    )
    FROM public.${quoteIdent(table)};
  `;
  const result = await selectJson<{ latest: string | null }>(connectionString, sql);
  return result.latest;
}

async function statusDistribution(
  connectionString: string,
  table: string,
): Promise<Record<string, number> | null> {
  if (!(await tableExists(connectionString, table))) {
    return null;
  }

  const columns = new Set(await getColumns(connectionString, table));
  if (!columns.has('status')) {
    return null;
  }

  const sql = `
    SELECT COALESCE(json_object_agg(status_key, row_count), '{}'::json)
    FROM (
      SELECT COALESCE(status::text, '<null>') AS status_key, count(*)::int AS row_count
      FROM public.${quoteIdent(table)}
      GROUP BY COALESCE(status::text, '<null>')
      ORDER BY status_key
    ) status_counts;
  `;
  return selectJson<Record<string, number>>(connectionString, sql);
}

async function collectSchemaInfo(
  urls: Record<DatabaseName, string>,
): Promise<Record<string, Record<DatabaseName, SchemaTableInfo>>> {
  const tables = [...new Set([...ROW_COUNT_TABLES, ...FRESHNESS_TABLES, ...STATUS_TABLES])].sort();
  const schema: Record<string, Record<DatabaseName, SchemaTableInfo>> = {};

  for (const table of tables) {
    const supabaseColumns = await getColumns(urls.supabase, table);
    const hetznerColumns = await getColumns(urls.hetzner, table);
    schema[table] = {
      supabase: { exists: supabaseColumns.length > 0, columns: supabaseColumns },
      hetzner: { exists: hetznerColumns.length > 0, columns: hetznerColumns },
    };
  }

  return schema;
}

function compareCounts(supabase: CountValue, hetzner: CountValue): TableComparison {
  return {
    supabase,
    hetzner,
    delta: supabase === null || hetzner === null ? null : supabase - hetzner,
    match: supabase !== null && hetzner !== null && supabase === hetzner,
  };
}

function buildStatusComparison(
  supabase: Record<string, number> | null,
  hetzner: Record<string, number> | null,
): Record<string, StatusComparison> {
  const statuses = new Set([...Object.keys(supabase ?? {}), ...Object.keys(hetzner ?? {})]);
  const comparison: Record<string, StatusComparison> = {};

  for (const status of [...statuses].sort()) {
    comparison[status] = {
      supabase: supabase?.[status] ?? 0,
      hetzner: hetzner?.[status] ?? 0,
    };
  }

  return comparison;
}

function addMismatch(mismatches: string[], message: string): void {
  mismatches.push(message);
}

async function buildReport(urls: Record<DatabaseName, string>, dryRun: boolean): Promise<CompareReport | DryRunSchemaReport> {
  const generatedAt = new Date().toISOString();
  const report: CompareReport = {
    tables: {},
    freshness: {},
    status_distributions: {},
    mismatches: [],
    generated_at: generatedAt,
    dry_run: dryRun,
  };

  if (dryRun) {
    return {
      ...report,
      schema: await collectSchemaInfo(urls),
    };
  }

  for (const table of ROW_COUNT_TABLES) {
    const comparison = compareCounts(
      await countRows(urls.supabase, table),
      await countRows(urls.hetzner, table),
    );
    report.tables[table] = comparison;
    if (!comparison.match) {
      addMismatch(report.mismatches, `${table} row count mismatch`);
    }
  }

  for (const table of FRESHNESS_TABLES) {
    const supabase = await latestTimestamp(urls.supabase, table);
    const hetzner = await latestTimestamp(urls.hetzner, table);
    const comparison = {
      supabase,
      hetzner,
      match: supabase === hetzner,
    };
    report.freshness[table] = comparison;
    if (!comparison.match) {
      addMismatch(report.mismatches, `${table} freshness mismatch`);
    }
  }

  for (const table of STATUS_TABLES) {
    const supabase = await statusDistribution(urls.supabase, table);
    const hetzner = await statusDistribution(urls.hetzner, table);
    report.status_distributions[table] = buildStatusComparison(supabase, hetzner);

    if (supabase === null || hetzner === null) {
      addMismatch(report.mismatches, `${table} status distribution unavailable`);
      continue;
    }

    for (const [status, counts] of Object.entries(report.status_distributions[table] ?? {})) {
      if (counts.supabase !== counts.hetzner) {
        addMismatch(report.mismatches, `${table}.${status} status count mismatch`);
      }
    }
  }

  return report;
}

function reportPath(timestamp: string): string {
  const safeTimestamp = timestamp.replaceAll(':', '-').replaceAll('.', '-');
  return path.join(
    process.cwd(),
    'docs',
    '06_status',
    'proof',
    `compare-databases-${safeTimestamp}.json`,
  );
}

function writeReport(report: CompareReport | DryRunSchemaReport): string {
  const outputPath = reportPath(report.generated_at);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

function printSummary(report: CompareReport | DryRunSchemaReport, outputPath: string): void {
  console.log('\nSupabase vs Hetzner comparison');
  console.log('='.repeat(36));
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Dry run: ${report.dry_run ? 'yes' : 'no'}`);
  console.log(`Report: ${path.relative(process.cwd(), outputPath)}`);

  if ('schema' in report) {
    console.log('\nSchema');
    for (const [table, dbs] of Object.entries(report.schema)) {
      console.log(
        `  ${table}: supabase=${dbs.supabase.exists ? dbs.supabase.columns.length : 'missing'} columns, hetzner=${dbs.hetzner.exists ? dbs.hetzner.columns.length : 'missing'} columns`,
      );
    }
    return;
  }

  console.log('\nRow counts');
  for (const [table, comparison] of Object.entries(report.tables)) {
    const delta = comparison.delta === null ? 'n/a' : comparison.delta;
    console.log(
      `  ${table}: supabase=${comparison.supabase ?? 'missing'}, hetzner=${comparison.hetzner ?? 'missing'}, delta=${delta}, match=${comparison.match}`,
    );
  }

  console.log('\nFreshness');
  for (const [table, comparison] of Object.entries(report.freshness)) {
    console.log(
      `  ${table}: supabase=${comparison.supabase ?? 'missing'}, hetzner=${comparison.hetzner ?? 'missing'}, match=${comparison.match}`,
    );
  }

  console.log('\nStatus distributions');
  for (const [table, distribution] of Object.entries(report.status_distributions)) {
    const statuses = Object.entries(distribution);
    if (statuses.length === 0) {
      console.log(`  ${table}: unavailable`);
      continue;
    }
    for (const [status, counts] of statuses) {
      console.log(`  ${table}.${status}: supabase=${counts.supabase}, hetzner=${counts.hetzner}`);
    }
  }

  console.log(`\nMismatches: ${report.mismatches.length}`);
  for (const mismatch of report.mismatches) {
    console.log(`  - ${mismatch}`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const urls = requireDatabaseUrls();
  const report = await buildReport(urls, dryRun);
  const outputPath = writeReport(report);
  printSummary(report, outputPath);

  if (!dryRun && report.mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[compare-databases] ${message}`);
  process.exit(1);
});
