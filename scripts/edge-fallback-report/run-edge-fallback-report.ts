/**
 * UTV2-1379: edge fallback distribution report.
 *
 * Read-only measurement of how picks classify across the fallback-reason
 * taxonomy, broken down by source. Run after the taxonomy + promotion-time
 * recovery + conviction=10 fixes land, to see what actually remains as the
 * dominant driver of confidence-delta fallback — do not assume smart-form
 * is still the cause without re-measuring.
 *
 * Categories (PM-required, see UTV2-1379):
 *   domain-analysis, confidence-delta, no-confidence, no-provider-offer,
 *   no-market-key, no-participant-scope, computation-error, unknown-legacy
 *
 * Source buckets: raw pick.source value, with api/test/proof/synthetic
 * sources reported separately rather than silently excluded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseClient, type UnitTalkSupabaseClient } from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;

const FALLBACK_CATEGORIES = [
  'domain-analysis',
  'confidence-delta',
  'no-confidence',
  'no-provider-offer',
  'no-market-key',
  'no-participant-scope',
  'computation-error',
  'unknown-legacy',
] as const;
type FallbackCategory = (typeof FALLBACK_CATEGORIES)[number];

const NON_PRODUCTION_SOURCES = new Set(['api', 'test', 'proof', 't1-proof', 'synthetic', 'canary-proof']);

const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-1379');
const OUTPUT_FILES = ['edge-fallback-summary.json', 'edge-fallback-by-source.csv'] as const;

interface PickRow {
  id: string;
  source: string | null;
  created_at: string;
  metadata: JsonRecord | null;
}

interface RunOptions {
  days?: number;
  outDir?: string;
  now?: Date;
  rows?: PickRow[];
  client?: UnitTalkSupabaseClient;
  /** UTV2-1379B: exclude non-production sources (t1-proof, api/test/synthetic) entirely from totals. */
  productionOnly?: boolean;
}

function jsonRecord(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Number(((count / total) * 100).toFixed(2));
}

/**
 * Classify only what the metadata can prove — mirrors the fail-closed rule
 * applied in real-edge-service.ts / promotion-service.ts. Never guesses.
 */
function classifyFallback(metadata: JsonRecord): FallbackCategory {
  const domainAnalysis = jsonRecord(metadata['domainAnalysis']);
  const topLevelRealEdge = finiteNumber(metadata['realEdge']);
  const nestedRealEdge = finiteNumber(domainAnalysis['realEdge']);

  if (topLevelRealEdge !== null || nestedRealEdge !== null) {
    return 'domain-analysis';
  }

  const domainAnalysisFallbackReason = domainAnalysis['fallbackReason'];
  if (domainAnalysisFallbackReason === 'no-confidence') {
    return 'no-confidence';
  }

  const edgeProvenance = jsonRecord(metadata['edgeProvenance']);
  const provenanceFallbackReason = edgeProvenance['fallbackReason'];
  if (
    provenanceFallbackReason === 'no-provider-offer' ||
    provenanceFallbackReason === 'no-market-key' ||
    provenanceFallbackReason === 'no-participant-scope' ||
    provenanceFallbackReason === 'computation-error'
  ) {
    return provenanceFallbackReason;
  }

  const hasConfidenceDelta =
    finiteNumber(domainAnalysis['confidenceDelta']) !== null || finiteNumber(domainAnalysis['edge']) !== null;
  if (hasConfidenceDelta) {
    return 'confidence-delta';
  }

  return 'unknown-legacy';
}

function sourceBucket(rawSource: string | null): string {
  const normalized = rawSource?.trim().toLowerCase() || 'unknown';
  return NON_PRODUCTION_SOURCES.has(normalized) ? `non-production:${normalized}` : normalized;
}

async function fetchPicks(client: UnitTalkSupabaseClient, fromIso: string): Promise<PickRow[]> {
  const rows: PickRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('picks')
      .select('id,source,created_at,metadata')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`picks query failed: ${error.message}`);
    const page = (data ?? []) as PickRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function csvEscape(cell: string): string {
  if (!/[",\n\r]/.test(cell)) return cell;
  return `"${cell.replaceAll('"', '""')}"`;
}

function toCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

export async function runEdgeFallbackReport(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;

  const allRows =
    options.rows ??
    (await fetchPicks(options.client ?? createDatabaseClient({ useServiceRole: true }), from.toISOString()));
  const excludedCount = options.productionOnly
    ? allRows.filter((row) => NON_PRODUCTION_SOURCES.has(row.source?.trim().toLowerCase() || '')).length
    : 0;
  const rows = options.productionOnly
    ? allRows.filter((row) => !NON_PRODUCTION_SOURCES.has(row.source?.trim().toLowerCase() || ''))
    : allRows;

  const bySource = new Map<string, Record<FallbackCategory, number>>();
  const totals: Record<FallbackCategory, number> = Object.fromEntries(
    FALLBACK_CATEGORIES.map((category) => [category, 0]),
  ) as Record<FallbackCategory, number>;

  for (const row of rows) {
    const category = classifyFallback(jsonRecord(row.metadata));
    totals[category] += 1;

    const bucket = sourceBucket(row.source);
    const existing = bySource.get(bucket) ?? (Object.fromEntries(
      FALLBACK_CATEGORIES.map((c) => [c, 0]),
    ) as Record<FallbackCategory, number>);
    existing[category] += 1;
    bySource.set(bucket, existing);
  }

  const total = rows.length;
  const summary: JsonRecord = {
    schema_version: 1,
    issue_id: 'UTV2-1379',
    generated_at: now.toISOString(),
    evaluation_window: { from: from.toISOString(), to: now.toISOString(), days },
    production_only: options.productionOnly ?? false,
    excluded_non_production_count: excludedCount,
    total_picks_analyzed: total,
    fallback_category_counts: totals,
    fallback_category_pct: Object.fromEntries(
      FALLBACK_CATEGORIES.map((category) => [category, pct(totals[category], total)]),
    ),
    domain_analysis_rate_pct: pct(totals['domain-analysis'], total),
    confidence_fallback_rate_pct: pct(
      total - totals['domain-analysis'],
      total,
    ),
    by_source: Object.fromEntries(
      [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'edge-fallback-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const csvRows: string[][] = [['source', ...FALLBACK_CATEGORIES, 'total']];
  for (const [source, counts] of [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const rowTotal = FALLBACK_CATEGORIES.reduce((sum, category) => sum + counts[category], 0);
    csvRows.push([source, ...FALLBACK_CATEGORIES.map((category) => String(counts[category])), String(rowTotal)]);
  }
  fs.writeFileSync(path.join(outDir, 'edge-fallback-by-source.csv'), toCsv(csvRows));

  for (const file of OUTPUT_FILES) {
    const outputPath = path.join(outDir, file);
    if (!fs.existsSync(outputPath)) throw new Error(`required output file was not written: ${outputPath}`);
  }

  return summary;
}

function parseArgs(argv: string[]): { days: number; productionOnly: boolean; outDir?: string } {
  let days = 30;
  let productionOnly = false;
  let outDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--days') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--days must be a positive integer');
      days = value;
      index += 1;
      continue;
    }
    if (argv[index] === '--production-only') {
      productionOnly = true;
      continue;
    }
    if (argv[index] === '--out-dir') {
      outDir = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return { days, productionOnly, outDir };
}

function isCli(): boolean {
  return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const { days, productionOnly, outDir } = parseArgs(process.argv.slice(2));
  runEdgeFallbackReport({ days, productionOnly, outDir })
    .then((summary) => {
      process.stdout.write(
        `Edge fallback report written to ${outDir ?? REQUIRED_OUTPUT_DIR}. domain-analysis rate=${String(summary['domain_analysis_rate_pct'])}%\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`Edge fallback report failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
