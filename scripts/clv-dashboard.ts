#!/usr/bin/env tsx
/**
 * UTV2-1027: operator CLV dashboard export.
 *
 * Read-only summary of settled-pick CLV, segmented for operator review and
 * command-center ingestion.
 *
 * Usage:
 *   npx tsx scripts/clv-dashboard.ts --after=2026-05-01
 *   npx tsx scripts/clv-dashboard.ts --after=2026-05-01 --format=json
 *   npx tsx scripts/clv-dashboard.ts --window-days=7 --out=.out/clv-dashboard.md
 *   npx tsx scripts/clv-dashboard.ts --sample-data --format=json
 */
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type ClvSourceClass = 'pinnacle' | 'consensus' | 'proxy' | 'unknown';
type OutputFormat = 'markdown' | 'json';

export interface ClvDashboardRow {
  pickId: string;
  settlementId: string;
  settledAt: string;
  sport: string;
  band: string;
  modelVersion: string;
  result: string | null;
  odds: number | null;
  stakeUnits: number | null;
  profitUnits: number | null;
  roiPercent: number | null;
  clvPercent: number | null;
  clvRaw: number | null;
  beatsClosingLine: boolean | null;
  clvStatus: string | null;
  clvSourceClass: ClvSourceClass;
  clvProviderKey: string | null;
  isOpeningLineFallback: boolean;
}

export interface ClvSegmentSummary {
  segment: string;
  key: string;
  settled: number;
  clvRows: number;
  clvCoveragePct: number | null;
  positiveClvPct: number | null;
  meanClvPercent: number | null;
  medianClvPercent: number | null;
  roiPercent: number | null;
  clvRoiCorrelation: number | null;
  pinnacleRows: number;
  consensusRows: number;
  proxyRows: number;
  unknownSourceRows: number;
}

export interface ClvDashboardReport {
  generatedAt: string;
  window: {
    after: string;
    until: string | null;
  };
  rowCount: number;
  summaries: ClvSegmentSummary[];
  notes: string[];
}

interface QueryOptions {
  after: string;
  until: string | null;
}

interface RawSettlementRow {
  id?: unknown;
  pick_id?: unknown;
  result?: unknown;
  payload?: unknown;
  settled_at?: unknown;
  stake_units?: unknown;
  picks?: unknown;
}

interface RawPickRow {
  odds?: unknown;
  stake_units?: unknown;
  metadata?: unknown;
  market_type_id?: unknown;
  market?: unknown;
  source?: unknown;
}

const PAGE_SIZE = 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MIN_CORRELATION_ROWS = 3;

export async function fetchClvDashboardRows(options: QueryOptions): Promise<ClvDashboardRow[]> {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  const rows: ClvDashboardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from('settlement_records')
      .select(
        `
        id,
        pick_id,
        result,
        payload,
        settled_at,
        stake_units,
        picks!inner(odds, stake_units, metadata, market_type_id, market, source)
      `,
      )
      .gte('settled_at', options.after)
      .is('corrects_id', null)
      .order('settled_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (options.until) {
      query = query.lt('settled_at', options.until);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch CLV dashboard rows: ${error.message}`);
    }

    const page = (data ?? []) as unknown[];
    rows.push(...page.map((row) => toDashboardRow(asRawSettlementRow(row))));
    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

export function buildClvDashboardReport(
  rows: ClvDashboardRow[],
  options: QueryOptions,
  generatedAt = new Date().toISOString(),
): ClvDashboardReport {
  return {
    generatedAt,
    window: options,
    rowCount: rows.length,
    summaries: [
      summarizeSegment('overall', 'all', rows),
      ...summarizeBy('sport', rows, (row) => row.sport),
      ...summarizeBy('band', rows, (row) => row.band),
      ...summarizeBy('modelVersion', rows, (row) => row.modelVersion),
      ...summarizeBy('clvSourceClass', rows, (row) => row.clvSourceClass),
    ],
    notes: [
      'CLV is read from settlement_records.payload and is not recomputed by this report.',
      'Pinnacle rows are payload.clv.providerKey values matching pinnacle or odds-api:pinnacle.',
      'Proxy rows are opening-line fallback CLV; consensus rows are non-Pinnacle computed CLV with a provider key.',
      `CLV/ROI correlation is Pearson correlation over rows with both clvPercent and stake-based row ROI; requires at least ${MIN_CORRELATION_ROWS} rows.`,
    ],
  };
}

export function formatClvDashboardMarkdown(report: ClvDashboardReport): string {
  const lines: string[] = [];
  lines.push('# CLV Dashboard');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Window: settled_at >= ${report.window.after}${report.window.until ? ` and < ${report.window.until}` : ''}`);
  lines.push(`Rows: ${report.rowCount}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('| Segment | Key | Settled | CLV rows | CLV coverage | Positive CLV | Mean CLV | Median CLV | ROI | CLV/ROI corr | Pinnacle | Consensus | Proxy | Unknown |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of report.summaries) {
    lines.push(
      `| ${escapeCell(row.segment)} | ${escapeCell(row.key)} | ${row.settled} | ${row.clvRows} | ${formatPct(row.clvCoveragePct)} | ${formatPct(row.positiveClvPct)} | ${formatSignedPct(row.meanClvPercent)} | ${formatSignedPct(row.medianClvPercent)} | ${formatSignedPct(row.roiPercent)} | ${formatNumber(row.clvRoiCorrelation)} | ${row.pinnacleRows} | ${row.consensusRows} | ${row.proxyRows} | ${row.unknownSourceRows} |`,
    );
  }
  lines.push('');
  lines.push('## Notes');
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

export function summarizeSegment(
  segment: string,
  key: string,
  rows: ClvDashboardRow[],
): ClvSegmentSummary {
  const clvRows = rows.filter((row) => row.clvPercent !== null);
  const positiveClvRows = clvRows.filter((row) => (row.clvPercent ?? 0) > 0);
  const riskRows = rows.filter(hasRiskResult);
  const riskedUnits = riskRows.reduce((sum, row) => sum + row.stakeUnits, 0);
  const profitUnits = riskRows.reduce((sum, row) => sum + (row.profitUnits ?? 0), 0);
  const correlationRows = rows.filter(
    (row): row is ClvDashboardRow & { clvPercent: number; roiPercent: number } =>
      row.clvPercent !== null && row.roiPercent !== null,
  );

  return {
    segment,
    key,
    settled: rows.length,
    clvRows: clvRows.length,
    clvCoveragePct: rows.length > 0 ? (clvRows.length / rows.length) * 100 : null,
    positiveClvPct: clvRows.length > 0 ? (positiveClvRows.length / clvRows.length) * 100 : null,
    meanClvPercent: mean(clvRows.map((row) => row.clvPercent).filter(isFiniteNumber)),
    medianClvPercent: median(clvRows.map((row) => row.clvPercent).filter(isFiniteNumber)),
    roiPercent: riskedUnits > 0 ? (profitUnits / riskedUnits) * 100 : null,
    clvRoiCorrelation:
      correlationRows.length >= MIN_CORRELATION_ROWS
        ? pearson(
            correlationRows.map((row) => row.clvPercent),
            correlationRows.map((row) => row.roiPercent),
          )
        : null,
    pinnacleRows: rows.filter((row) => row.clvSourceClass === 'pinnacle').length,
    consensusRows: rows.filter((row) => row.clvSourceClass === 'consensus').length,
    proxyRows: rows.filter((row) => row.clvSourceClass === 'proxy').length,
    unknownSourceRows: rows.filter((row) => row.clvSourceClass === 'unknown').length,
  };
}

function summarizeBy(
  segment: string,
  rows: ClvDashboardRow[],
  readKey: (row: ClvDashboardRow) => string,
): ClvSegmentSummary[] {
  const groups = new Map<string, ClvDashboardRow[]>();
  for (const row of rows) {
    const key = readKey(row) || 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupRows]) => summarizeSegment(segment, key, groupRows));
}

function toDashboardRow(row: RawSettlementRow): ClvDashboardRow {
  const pick = readPick(row.picks);
  const payload = asRecord(row.payload);
  const metadata = asRecord(pick.metadata);
  const nestedClv = asRecord(payload['clv']);
  const stakeUnits = readNumber(pick.stake_units) ?? readNumber(row.stake_units);
  const odds = readNumber(pick.odds);
  const result = readString(row.result);
  const profitUnits = computeProfitUnits(result, odds, stakeUnits);
  const clvPercent = readNumber(payload['clvPercent']) ?? readNumber(nestedClv['clvPercent']);
  const clvRaw = readNumber(payload['clvRaw']) ?? readNumber(nestedClv['clvRaw']);
  const beatsClosingLine =
    readBoolean(payload['beatsClosingLine']) ?? readBoolean(nestedClv['beatsClosingLine']);
  const isOpeningLineFallback =
    readBoolean(payload['isOpeningLineFallback']) ??
    readBoolean(nestedClv['isOpeningLineFallback']) ??
    false;
  const providerKey = readString(nestedClv['providerKey']) ?? readString(payload['clvProviderKey']);

  return {
    pickId: readString(row.pick_id) ?? 'unknown',
    settlementId: readString(row.id) ?? 'unknown',
    settledAt: readString(row.settled_at) ?? 'unknown',
    sport: readFirstString(metadata, ['sport', 'sportKey', 'league']) ?? 'unknown',
    band: readFirstString(metadata, ['band', 'tier', 'confidenceBand', 'confidence_band', 'scoreBand']) ?? 'unknown',
    modelVersion:
      readFirstString(metadata, ['modelVersion', 'model_version', 'scoringVersion', 'scoring_version']) ??
      'unknown',
    result,
    odds,
    stakeUnits,
    profitUnits,
    roiPercent:
      stakeUnits !== null && stakeUnits > 0 && profitUnits !== null
        ? (profitUnits / stakeUnits) * 100
        : null,
    clvPercent,
    clvRaw,
    beatsClosingLine,
    clvStatus: readString(payload['clvStatus']),
    clvSourceClass: classifyClvSource(providerKey, isOpeningLineFallback, clvPercent),
    clvProviderKey: providerKey,
    isOpeningLineFallback,
  };
}

function classifyClvSource(
  providerKey: string | null,
  isOpeningLineFallback: boolean,
  clvPercent: number | null,
): ClvSourceClass {
  if (clvPercent === null) return 'unknown';
  if (isOpeningLineFallback) return 'proxy';
  if (!providerKey) return 'unknown';
  return providerKey.toLowerCase().includes('pinnacle') ? 'pinnacle' : 'consensus';
}

function computeProfitUnits(
  result: string | null,
  odds: number | null,
  stakeUnits: number | null,
): number | null {
  if (stakeUnits === null || stakeUnits <= 0 || result === null) return null;
  if (result === 'push') return 0;
  if (result === 'loss') return roundTo(-stakeUnits, 4);
  if (result !== 'win') return null;
  if (odds === null || odds === 0) return roundTo(stakeUnits, 4);
  return roundTo(odds > 0 ? stakeUnits * (odds / 100) : stakeUnits * (100 / Math.abs(odds)), 4);
}

function hasRiskResult(row: ClvDashboardRow): row is ClvDashboardRow & {
  stakeUnits: number;
  profitUnits: number;
} {
  return (
    row.stakeUnits !== null &&
    row.stakeUnits > 0 &&
    row.profitUnits !== null &&
    row.result !== 'push'
  );
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < MIN_CORRELATION_ROWS) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  if (leftMean === null || rightMean === null) return null;

  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? roundTo(numerator / denominator, 4) : null;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 4) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  return roundTo(value, 4);
}

function parseOptions(argv: string[]): {
  query: QueryOptions;
  format: OutputFormat;
  out: string | null;
  sampleData: boolean;
} {
  const windowDays = readNumberFlag(argv, 'window-days') ?? DEFAULT_WINDOW_DAYS;
  const after = readStringFlag(argv, 'after') ?? daysAgoIsoDate(windowDays);
  return {
    query: {
      after,
      until: readStringFlag(argv, 'until'),
    },
    format: readStringFlag(argv, 'format') === 'json' ? 'json' : 'markdown',
    out: readStringFlag(argv, 'out'),
    sampleData: hasFlag(argv, 'sample-data'),
  };
}

function readRawStringFlag(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return value && value.length > 0 ? value : null;
}

function readStringFlag(argv: string[], name: string): string | null {
  return readRawStringFlag(argv, name);
}

function readNumberFlag(argv: string[], name: string): number | null {
  const value = readRawStringFlag(argv, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function daysAgoIsoDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(1, Math.trunc(days)));
  return date.toISOString().slice(0, 10);
}

function writeOutput(path: string | null, content: string): void {
  if (!path) {
    console.log(content);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${content}\n`, 'utf8');
  console.log(`Wrote ${path}`);
}

function readPick(value: unknown): RawPickRow {
  const pick = Array.isArray(value) ? value[0] : value;
  return asRawPickRow(pick);
}

function asRawSettlementRow(value: unknown): RawSettlementRow {
  return asRecord(value) as RawSettlementRow;
}

function asRawPickRow(value: unknown): RawPickRow {
  return asRecord(value) as RawPickRow;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatPct(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number | null): string {
  return value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function buildSampleRows(): ClvDashboardRow[] {
  return [
    {
      pickId: 'sample-pinnacle-win',
      settlementId: 'sample-settlement-1',
      settledAt: '2026-05-20T00:00:00.000Z',
      sport: 'NBA',
      band: 'A',
      modelVersion: 'sample-v1',
      result: 'win',
      odds: -110,
      stakeUnits: 1,
      profitUnits: 0.9091,
      roiPercent: 90.91,
      clvPercent: 2.1,
      clvRaw: 0.021,
      beatsClosingLine: true,
      clvStatus: 'computed',
      clvSourceClass: 'pinnacle',
      clvProviderKey: 'odds-api:pinnacle',
      isOpeningLineFallback: false,
    },
    {
      pickId: 'sample-consensus-loss',
      settlementId: 'sample-settlement-2',
      settledAt: '2026-05-19T00:00:00.000Z',
      sport: 'NBA',
      band: 'B',
      modelVersion: 'sample-v1',
      result: 'loss',
      odds: -105,
      stakeUnits: 1,
      profitUnits: -1,
      roiPercent: -100,
      clvPercent: -1.4,
      clvRaw: -0.014,
      beatsClosingLine: false,
      clvStatus: 'computed',
      clvSourceClass: 'consensus',
      clvProviderKey: 'sgo',
      isOpeningLineFallback: false,
    },
    {
      pickId: 'sample-proxy-win',
      settlementId: 'sample-settlement-3',
      settledAt: '2026-05-18T00:00:00.000Z',
      sport: 'MLB',
      band: 'A',
      modelVersion: 'sample-v2',
      result: 'win',
      odds: 120,
      stakeUnits: 1,
      profitUnits: 1.2,
      roiPercent: 120,
      clvPercent: 0.4,
      clvRaw: 0.004,
      beatsClosingLine: true,
      clvStatus: 'opening_line_fallback',
      clvSourceClass: 'proxy',
      clvProviderKey: 'sgo',
      isOpeningLineFallback: true,
    },
  ];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const rows = options.sampleData ? buildSampleRows() : await fetchClvDashboardRows(options.query);
  const report = buildClvDashboardReport(rows, options.query);
  const output =
    options.format === 'json'
      ? JSON.stringify({ ...report, rows }, null, 2)
      : formatClvDashboardMarkdown(report);
  writeOutput(options.out, output);
}

const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
