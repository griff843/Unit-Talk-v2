#!/usr/bin/env tsx
/**
 * Read-only disk growth projection for app and Hetzner Postgres databases.
 *
 * Uses SELECT-only psql calls and stores snapshots for simple growth-rate
 * projection against the current 512 GB capacity target.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  'docs',
  '06_status',
  'proof',
  'disk-snapshots.json',
);
const CAPACITY_BYTES = 512 * 1024 * 1024 * 1024;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type DatabaseName = 'app' | 'hetzner';
type AlertLevel = 'critical' | 'alert' | 'warn' | 'ok' | 'unknown';

interface TableSize {
  table_name: string;
  size_bytes: number;
}

interface DiskSnapshot {
  timestamp: string;
  db_name: DatabaseName;
  size_bytes: number;
  top_tables: TableSize[];
}

interface DiskProjection {
  bytes_per_day: number | null;
  days_to_full: number | null;
  alert_level: AlertLevel;
}

interface DatabaseReport extends DiskSnapshot {
  provider_offer_history: TableSize | null;
  projection: DiskProjection;
}

interface DiskGrowthReport {
  generated_at: string;
  capacity_bytes: number;
  databases: DatabaseReport[];
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

function requireDatabaseUrls(): Partial<Record<DatabaseName, string>> {
  const env = loadEnvironment();
  const appUrl = readEnv(env, ['DATABASE_URL', 'SUPABASE_DATABASE_URL']);
  const hetznerUrl = readEnv(env, ['HETZNER_DATABASE_URL']);
  const urls: Partial<Record<DatabaseName, string>> = {};

  if (!appUrl) {
    throw new Error('Missing app database URL. Set DATABASE_URL or SUPABASE_DATABASE_URL.');
  }

  urls.app = appUrl;
  if (hetznerUrl) {
    urls.hetzner = hetznerUrl;
  }

  return urls;
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

async function databaseSize(connectionString: string): Promise<number> {
  const sql = `
    SELECT json_build_object('size_bytes', pg_database_size(current_database())::bigint::text);
  `;
  const result = await selectJson<{ size_bytes: string }>(connectionString, sql);
  return Number(result.size_bytes);
}

async function topTables(connectionString: string): Promise<TableSize[]> {
  const sql = `
    SELECT COALESCE(json_agg(row_to_json(table_sizes)), '[]'::json)
    FROM (
      SELECT
        relname AS table_name,
        pg_relation_size(c.oid)::bigint::text AS size_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'm')
      ORDER BY pg_relation_size(c.oid) DESC, relname ASC
      LIMIT 20
    ) table_sizes;
  `;
  const rows = await selectJson<Array<{ table_name: string; size_bytes: string }>>(
    connectionString,
    sql,
  );
  return rows.map((row) => ({
    table_name: row.table_name,
    size_bytes: Number(row.size_bytes),
  }));
}

async function providerOfferHistorySize(connectionString: string): Promise<TableSize | null> {
  const tableName = 'provider_offer_history';
  const sql = `
    SELECT json_build_object(
      'table_name',
      ${quoteLiteral(tableName)},
      'size_bytes',
      CASE
        WHEN to_regclass('public.provider_offer_history') IS NULL THEN NULL
        ELSE pg_relation_size('public.provider_offer_history'::regclass)::bigint::text
      END
    );
  `;
  const row = await selectJson<{ table_name: string; size_bytes: string | null }>(
    connectionString,
    sql,
  );

  if (row.size_bytes === null) {
    return null;
  }

  return {
    table_name: row.table_name,
    size_bytes: Number(row.size_bytes),
  };
}

function readSnapshots(): DiskSnapshot[] {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, '[]\n');
    return [];
  }

  const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8').trim();
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as DiskSnapshot[];
  if (!Array.isArray(parsed)) {
    throw new Error(`${path.relative(process.cwd(), SNAPSHOT_PATH)} must contain a JSON array.`);
  }

  return parsed;
}

function writeSnapshots(snapshots: DiskSnapshot[]): void {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshots, null, 2)}\n`);
}

function calculateProjection(
  dbName: DatabaseName,
  current: DiskSnapshot,
  existingSnapshots: DiskSnapshot[],
): DiskProjection {
  const previousSnapshots = existingSnapshots
    .filter((snapshot) => snapshot.db_name === dbName)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  if (previousSnapshots.length === 0) {
    return {
      bytes_per_day: null,
      days_to_full: null,
      alert_level: 'unknown',
    };
  }

  const previous = previousSnapshots[0];
  const elapsedDays =
    (Date.parse(current.timestamp) - Date.parse(previous.timestamp)) / MILLISECONDS_PER_DAY;

  if (elapsedDays <= 0) {
    return {
      bytes_per_day: null,
      days_to_full: null,
      alert_level: 'unknown',
    };
  }

  const bytesPerDay = (current.size_bytes - previous.size_bytes) / elapsedDays;
  const daysToFull =
    bytesPerDay > 0 ? Math.max((CAPACITY_BYTES - current.size_bytes) / bytesPerDay, 0) : null;

  return {
    bytes_per_day: bytesPerDay,
    days_to_full: daysToFull,
    alert_level: alertLevel(daysToFull),
  };
}

function alertLevel(daysToFull: number | null): AlertLevel {
  if (daysToFull === null) {
    return 'unknown';
  }

  if (daysToFull < 3) {
    return 'critical';
  }

  if (daysToFull < 7) {
    return 'alert';
  }

  if (daysToFull < 14) {
    return 'warn';
  }

  return 'ok';
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatRate(bytesPerDay: number | null): string {
  return bytesPerDay === null ? 'n/a' : `${formatBytes(bytesPerDay)}/day`;
}

function formatDays(days: number | null): string {
  return days === null ? 'n/a' : days.toFixed(2);
}

async function collectDatabaseReport(
  dbName: DatabaseName,
  connectionString: string,
  timestamp: string,
  existingSnapshots: DiskSnapshot[],
): Promise<DatabaseReport> {
  const snapshot: DiskSnapshot = {
    timestamp,
    db_name: dbName,
    size_bytes: await databaseSize(connectionString),
    top_tables: await topTables(connectionString),
  };

  return {
    ...snapshot,
    provider_offer_history: await providerOfferHistorySize(connectionString),
    projection: calculateProjection(dbName, snapshot, existingSnapshots),
  };
}

async function buildReport(): Promise<DiskGrowthReport> {
  const timestamp = new Date().toISOString();
  const urls = requireDatabaseUrls();
  const existingSnapshots = readSnapshots();
  const databases: DatabaseReport[] = [];

  for (const [dbName, connectionString] of Object.entries(urls)) {
    if (!connectionString) {
      continue;
    }

    databases.push(
      await collectDatabaseReport(
        dbName as DatabaseName,
        connectionString,
        timestamp,
        existingSnapshots,
      ),
    );
  }

  writeSnapshots(
    existingSnapshots.concat(
      databases.map(({ projection: _projection, provider_offer_history: _provider, ...snapshot }) => snapshot),
    ),
  );

  return {
    generated_at: timestamp,
    capacity_bytes: CAPACITY_BYTES,
    databases,
  };
}

function printSummary(report: DiskGrowthReport): void {
  console.log('\nDisk growth report');
  console.log('='.repeat(24));
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Capacity: ${formatBytes(report.capacity_bytes)}`);
  console.log(`Snapshots: ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);

  for (const database of report.databases) {
    console.log(`\n${database.db_name}`);
    console.log(`  Size: ${formatBytes(database.size_bytes)} (${database.size_bytes} bytes)`);
    console.log(`  Growth: ${formatRate(database.projection.bytes_per_day)}`);
    console.log(`  Days to full: ${formatDays(database.projection.days_to_full)}`);
    console.log(`  Alert level: ${database.projection.alert_level}`);
    console.log(
      `  provider_offer_history: ${
        database.provider_offer_history
          ? formatBytes(database.provider_offer_history.size_bytes)
          : 'missing'
      }`,
    );
    console.log('  Top tables:');
    for (const table of database.top_tables.slice(0, 10)) {
      console.log(`    ${table.table_name}: ${formatBytes(table.size_bytes)}`);
    }
  }

  console.log('\nJSON');
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const report = await buildReport();
  printSummary(report);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[disk-growth-report] ${message}`);
  process.exit(1);
});
