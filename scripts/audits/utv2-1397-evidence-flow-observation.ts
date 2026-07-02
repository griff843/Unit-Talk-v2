/**
 * UTV2-1397: evidence-flow observation for alert-agent, model-driven, smart-form.
 *
 * Read-only, observe-only. UTV2-1382 found these three sources had zero
 * measurable production data over a 30-day window (100% test/proof fixtures).
 * This script re-checks for real (non-fixture) rows and, where they exist,
 * reports the same distributions UTV2-1382 reported for the two measurable
 * sources — scoped per-source so a source with real data doesn't mask one
 * without it.
 *
 * This script does not trigger picks, does not mutate rows, and does not
 * make ROI/CLV/edge-performance claims. It only reads and classifies.
 *
 * Exclusion rule mirrors scripts/audits/utv2-1382-scoring-validation.ts:
 *   - metadata.testRun rows
 *   - metadata.proof_issue / metadata.proof_fixture_id rows (pre-UTV2-1394 convention)
 *   - selection text containing "proof"
 *   - non-production source values (api, test, proof, t1-proof, synthetic, canary-proof)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseClient, type UnitTalkSupabaseClient } from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;

const TARGET_SOURCES = ['alert-agent', 'model-driven', 'smart-form'] as const;

const NON_PRODUCTION_SOURCES = new Set(['api', 'test', 'proof', 't1-proof', 'synthetic', 'canary-proof']);
const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-1397');
const OUTPUT_FILE = 'evidence-flow-summary.json';

interface PickRow {
  id: string;
  source: string | null;
  selection: string | null;
  status: string;
  promotion_status: string;
  promotion_target: string | null;
  created_at: string;
  metadata: JsonRecord | null;
}

interface RunOptions {
  days?: number;
  outDir?: string;
  now?: Date;
  rows?: PickRow[];
  client?: UnitTalkSupabaseClient;
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

/** Mirrors scripts/audits/utv2-1382-scoring-validation.ts isTestFixtureRow(). */
function isTestFixtureRow(row: PickRow): boolean {
  const metadata = jsonRecord(row.metadata);
  if (metadata['testRun']) return true;
  if (metadata['proof_issue'] != null) return true;
  if (metadata['proof_fixture_id'] != null) return true;
  if (typeof row.selection === 'string' && /proof/i.test(row.selection)) return true;
  return false;
}

function isExcludedSource(row: PickRow): boolean {
  return NON_PRODUCTION_SOURCES.has(row.source?.trim().toLowerCase() || '');
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToSortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/** Mirrors classifyEdgeSourceQuality in scripts/audits/utv2-1382-scoring-validation.ts. */
function classifyEdgeSourceQuality(metadata: JsonRecord): 'explicit' | 'market-backed' | 'confidence-fallback' {
  const promotionScores = jsonRecord(metadata['promotionScores']);
  if (typeof promotionScores['edge'] === 'number') {
    return 'explicit';
  }

  const domainAnalysis = jsonRecord(metadata['domainAnalysis']);
  if (finiteNumber(domainAnalysis['realEdge']) !== null) {
    return 'market-backed';
  }

  if (metadata['realEdgeSource'] !== 'confidence-delta' && finiteNumber(metadata['realEdge']) !== null) {
    return 'market-backed';
  }

  return 'confidence-fallback';
}

/** Mirrors classifyFallbackReason in scripts/audits/utv2-1382-scoring-validation.ts. */
function classifyFallbackReason(metadata: JsonRecord): string {
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

async function fetchPicksForSources(
  client: UnitTalkSupabaseClient,
  fromIso: string,
  sources: readonly string[],
): Promise<PickRow[]> {
  const rows: PickRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('picks')
      .select('id,source,selection,status,promotion_status,promotion_target,created_at,metadata')
      .in('source', [...sources])
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

interface SourceReport {
  real_sample_count: number;
  excluded_fixture_count: number;
  domain_analysis_present_pct: number;
  edge_source_quality: Record<string, number>;
  fallback_reason: Record<string, number>;
  promotion_status: Record<string, number>;
  delivery_status: Record<string, number> | null;
  verdict: 'PASS' | 'PARTIAL' | 'INSUFFICIENT_DATA';
}

/**
 * A source with zero real rows is INSUFFICIENT_DATA — there is nothing to
 * validate, and that is reported honestly rather than as a pass/fail on an
 * empty set. PARTIAL vs PASS on a populated source mirrors UTV2-1382's
 * confidence-fallback threshold (>50% confidence-fallback is a concern).
 */
function verdictFor(realCount: number, edgeSourceQuality: Map<string, number>): SourceReport['verdict'] {
  if (realCount === 0) return 'INSUFFICIENT_DATA';
  const confidenceFallbackPct = pct(edgeSourceQuality.get('confidence-fallback') ?? 0, realCount);
  return confidenceFallbackPct > 50 ? 'PARTIAL' : 'PASS';
}

export async function runEvidenceFlowObservation(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;

  const allRows =
    options.rows ??
    (await fetchPicksForSources(
      options.client ?? createDatabaseClient({ useServiceRole: true }),
      from.toISOString(),
      TARGET_SOURCES,
    ));

  const bySource: Record<string, SourceReport> = {};
  let overallVerdict: 'PASS' | 'PARTIAL' | 'INSUFFICIENT_DATA' | 'FAIL' = 'PASS';
  const insufficientSources: string[] = [];

  for (const source of TARGET_SOURCES) {
    const sourceRows = allRows.filter((row) => (row.source?.trim().toLowerCase() || '') === source);
    const excludedCount = sourceRows.filter((row) => isExcludedSource(row) || isTestFixtureRow(row)).length;
    const realRows = sourceRows.filter((row) => !isExcludedSource(row) && !isTestFixtureRow(row));
    const realCount = realRows.length;

    const edgeSourceQuality = new Map<string, number>();
    const fallbackReason = new Map<string, number>();
    const promotionStatus = new Map<string, number>();
    const deliveryStatus = new Map<string, number>();
    let domainAnalysisPresentCount = 0;
    let deliveryStatusObserved = false;

    for (const row of realRows) {
      const metadata = jsonRecord(row.metadata);
      if (metadata['domainAnalysis'] != null) domainAnalysisPresentCount += 1;
      bump(edgeSourceQuality, classifyEdgeSourceQuality(metadata));
      bump(fallbackReason, classifyFallbackReason(metadata));
      bump(promotionStatus, row.promotion_status);

      const deliveryStatusValue = metadata['deliveryStatus'] ?? metadata['delivery_status'];
      if (typeof deliveryStatusValue === 'string') {
        deliveryStatusObserved = true;
        bump(deliveryStatus, deliveryStatusValue);
      }
    }

    const verdict = verdictFor(realCount, edgeSourceQuality);
    if (verdict === 'INSUFFICIENT_DATA') insufficientSources.push(source);

    bySource[source] = {
      real_sample_count: realCount,
      excluded_fixture_count: excludedCount,
      domain_analysis_present_pct: pct(domainAnalysisPresentCount, realCount),
      edge_source_quality: mapToSortedObject(edgeSourceQuality),
      fallback_reason: mapToSortedObject(fallbackReason),
      promotion_status: mapToSortedObject(promotionStatus),
      delivery_status: deliveryStatusObserved ? mapToSortedObject(deliveryStatus) : null,
      verdict,
    };
  }

  const verdicts = Object.values(bySource).map((r) => r.verdict);
  if (verdicts.every((v) => v === 'INSUFFICIENT_DATA')) {
    overallVerdict = 'INSUFFICIENT_DATA';
  } else if (verdicts.some((v) => v === 'PARTIAL' || v === 'INSUFFICIENT_DATA')) {
    overallVerdict = 'PARTIAL';
  } else {
    overallVerdict = 'PASS';
  }

  const summary: JsonRecord = {
    schema_version: 1,
    issue_id: 'UTV2-1397',
    generated_at: now.toISOString(),
    evaluation_window: { from: from.toISOString(), to: now.toISOString(), days },
    mode: 'observe-only',
    target_sources: TARGET_SOURCES,
    by_source: bySource,
    insufficient_data_sources: insufficientSources,
    overall_verdict: overallVerdict,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, OUTPUT_FILE), `${JSON.stringify(summary, null, 2)}\n`);

  return summary;
}

function parseArgs(argv: string[]): { days: number; outDir?: string } {
  let days = 30;
  let outDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--days') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--days must be a positive integer');
      days = value;
      index += 1;
      continue;
    }
    if (argv[index] === '--out-dir') {
      outDir = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return { days, outDir };
}

function isCli(): boolean {
  return process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const { days, outDir } = parseArgs(process.argv.slice(2));
  runEvidenceFlowObservation({ days, outDir })
    .then((summary) => {
      process.stdout.write(
        `Evidence-flow observation written to ${outDir ?? REQUIRED_OUTPUT_DIR}. overall_verdict=${String(summary['overall_verdict'])}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`Evidence-flow observation failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
