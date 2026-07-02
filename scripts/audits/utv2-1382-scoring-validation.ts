/**
 * UTV2-1382: scoring validation audit.
 *
 * Read-only measurement of promotion scoring health now that UTV2-1380
 * (Kelly sizing wiring), UTV2-1379/1395 (domainAnalysis/confidence-delta
 * fallback fix), and UTV2-1394 (testRun-excluded measurement) have landed.
 *
 * This does NOT change scoring logic. It reports distributions and a
 * PASS/PARTIAL/FAIL verdict so a narrow-bug child lane can be scoped if
 * something is broken.
 *
 * Exclusions (per UTV2-1394 lesson — do not repeat the pre-1394 mistake of
 * treating test fixtures as real production signal):
 *   - metadata.testRun rows (T1 pnpm test:db live fixtures)
 *   - non-production source values (api, test, proof, t1-proof, synthetic, canary-proof)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyMarketFamily } from '@unit-talk/domain';
import { createDatabaseClient, type UnitTalkSupabaseClient } from '@unit-talk/db';

type JsonRecord = Record<string, unknown>;

const NON_PRODUCTION_SOURCES = new Set(['api', 'test', 'proof', 't1-proof', 'synthetic', 'canary-proof']);
const REQUIRED_OUTPUT_DIR = path.join('docs', '06_status', 'proof', 'UTV2-1382');
const OUTPUT_FILE = 'scoring-validation-summary.json';

interface PickRow {
  id: string;
  source: string | null;
  selection: string | null;
  market: string | null;
  sport_id: string | null;
  status: string;
  approval_status: string;
  promotion_status: string;
  promotion_target: string | null;
  promotion_score: number | null;
  promotion_reason: string | null;
  confidence: number | null;
  created_at: string;
  posted_at: string | null;
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

/**
 * Rows tagged metadata.testRun (post-UTV2-1394 convention) are one form of
 * fixture contamination. An older convention predating UTV2-1394 tags proof
 * fixtures via metadata.proof_issue / metadata.proof_fixture_id (e.g. UTV2-1022
 * risk-sizing proof rows) or embeds "PROOF" directly in the selection string —
 * none of which set metadata.testRun, so they survive the testRun-only filter
 * undetected. All three markers must be excluded to get a genuine production
 * denominator.
 */
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

/**
 * Mirrors readMarketBackedEdgeScore / readDomainAnalysisEdgeSource / resolveEdgeSourceQuality
 * in apps/api/src/promotion-service.ts. Reimplemented here (read-only) rather than imported,
 * matching the UTV2-1394 measurement-tool pattern of not depending on app-layer code.
 */
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

/** Mirrors classifyFallback in scripts/edge-fallback-report/run-edge-fallback-report.ts. */
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

function readSport(row: PickRow): string {
  const metaSport = jsonRecord(row.metadata)['sport'];
  if (typeof metaSport === 'string' && metaSport.trim()) return metaSport.trim();
  return row.sport_id?.trim() || 'unknown';
}

function readBand(row: PickRow): string {
  const band = jsonRecord(row.metadata)['band'];
  return typeof band === 'string' && band.trim() ? band.trim() : 'none';
}

function readEventTimeMs(row: PickRow): number | null {
  const metadata = jsonRecord(row.metadata);
  const raw = metadata['eventStartTime'] ?? metadata['eventTime'];
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchPicks(client: UnitTalkSupabaseClient, fromIso: string): Promise<PickRow[]> {
  const rows: PickRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('picks')
      .select(
        'id,source,selection,market,sport_id,status,approval_status,promotion_status,promotion_target,promotion_score,promotion_reason,confidence,created_at,posted_at,metadata',
      )
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

export async function runScoringValidationAudit(options: RunOptions = {}): Promise<JsonRecord> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);
  const outDir = options.outDir ?? REQUIRED_OUTPUT_DIR;

  const allRows =
    options.rows ??
    (await fetchPicks(options.client ?? createDatabaseClient({ useServiceRole: true }), from.toISOString()));

  const excludedSourceCount = allRows.filter(isExcludedSource).length;
  const excludedTestFixtureCount = allRows.filter(
    (row) => !isExcludedSource(row) && isTestFixtureRow(row),
  ).length;
  const rows = allRows.filter((row) => !isExcludedSource(row) && !isTestFixtureRow(row));
  const total = rows.length;

  // Fixture saturation by source: sources where every row in the window is a
  // test/proof fixture cannot be measured at all in this window, regardless of
  // how good the exclusion filter is. This must surface even when the verdict
  // on the surviving sample looks clean.
  const rawBySource = new Map<string, { total: number; fixture: number }>();
  for (const row of allRows) {
    if (isExcludedSource(row)) continue;
    const source = row.source?.trim().toLowerCase() || 'unknown';
    const entry = rawBySource.get(source) ?? { total: 0, fixture: 0 };
    entry.total += 1;
    if (isTestFixtureRow(row)) entry.fixture += 1;
    rawBySource.set(source, entry);
  }
  const fixtureSaturationBySource = Object.fromEntries(
    [...rawBySource.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, entry]) => [
        source,
        { total: entry.total, fixture_pct: pct(entry.fixture, entry.total), clean_count: entry.total - entry.fixture },
      ]),
  );
  const fullySaturatedSources = Object.entries(fixtureSaturationBySource)
    .filter(([, v]) => v.clean_count === 0)
    .map(([source]) => source);

  // ── Band distribution by sport / source / market family ──────────────────
  const bandBySport = new Map<string, number>();
  const bandBySource = new Map<string, number>();
  const bandByMarketFamily = new Map<string, number>();
  const bandOverall = new Map<string, number>();

  // ── edgeSourceQuality distribution (overall + by source) ──────────────────
  const edgeSourceQualityOverall = new Map<string, number>();
  const edgeSourceQualityBySource = new Map<string, Map<string, number>>();

  // ── Kelly sizing distribution ─────────────────────────────────────────────
  let kellyPresentCount = 0;
  let kellyZeroCount = 0;
  const kellyFractions: number[] = [];

  // ── fallback reason distribution ──────────────────────────────────────────
  const fallbackReasonOverall = new Map<string, number>();
  const fallbackReasonBySource = new Map<string, Map<string, number>>();

  // ── suppress/reject reason counts ─────────────────────────────────────────
  const suppressReasonCounts = new Map<string, number>();
  let suppressCount = 0;

  // ── source-by-source scoring health ───────────────────────────────────────
  const bySourceHealth = new Map<
    string,
    { total: number; withBand: number; withKelly: number; withDomainAnalysis: number; suppressed: number }
  >();

  // ── stale/postgame/SUPPRESS leakage ────────────────────────────────────────
  let stalePromotedCount = 0;
  let postgamePromotedCount = 0;
  let suppressBandButPromotedCount = 0;
  const leakageExamples: JsonRecord[] = [];

  const promotedRows: PickRow[] = [];
  const rejectedRows: PickRow[] = [];

  for (const row of rows) {
    const metadata = jsonRecord(row.metadata);
    const sport = readSport(row);
    const source = row.source?.trim().toLowerCase() || 'unknown';
    const marketFamily = classifyMarketFamily(row.market ?? '');
    const band = readBand(row);

    bump(bandOverall, band);
    bump(bandBySport, `${sport}|${band}`);
    bump(bandBySource, `${source}|${band}`);
    bump(bandByMarketFamily, `${marketFamily}|${band}`);

    const edgeQuality = classifyEdgeSourceQuality(metadata);
    bump(edgeSourceQualityOverall, edgeQuality);
    const edgeBySourceMap = edgeSourceQualityBySource.get(source) ?? new Map<string, number>();
    bump(edgeBySourceMap, edgeQuality);
    edgeSourceQualityBySource.set(source, edgeBySourceMap);

    const fallbackReason = classifyFallbackReason(metadata);
    bump(fallbackReasonOverall, fallbackReason);
    const fallbackBySourceMap = fallbackReasonBySource.get(source) ?? new Map<string, number>();
    bump(fallbackBySourceMap, fallbackReason);
    fallbackReasonBySource.set(source, fallbackBySourceMap);

    const kellySizing = jsonRecord(metadata['kellySizing']);
    const fractionalKelly = finiteNumber(kellySizing['fractional_kelly']) ?? finiteNumber(kellySizing['fraction']);
    if (Object.keys(kellySizing).length > 0) {
      kellyPresentCount += 1;
      if (fractionalKelly !== null) {
        kellyFractions.push(fractionalKelly);
        if (fractionalKelly === 0) kellyZeroCount += 1;
      }
    }

    const health = bySourceHealth.get(source) ?? {
      total: 0,
      withBand: 0,
      withKelly: 0,
      withDomainAnalysis: 0,
      suppressed: 0,
    };
    health.total += 1;
    if (band !== 'none') health.withBand += 1;
    if (Object.keys(kellySizing).length > 0) health.withKelly += 1;
    if (metadata['domainAnalysis'] != null) health.withDomainAnalysis += 1;
    if (band === 'SUPPRESS' || row.promotion_status === 'suppressed') health.suppressed += 1;
    bySourceHealth.set(source, health);

    if (band === 'SUPPRESS' || row.promotion_status === 'suppressed') {
      suppressCount += 1;
      const reasonKey = row.promotion_reason?.trim() || fallbackReason;
      bump(suppressReasonCounts, reasonKey);
    }

    // Stale/postgame/SUPPRESS leakage: a pick promoted (posted/promoted target set)
    // despite carrying a stale flag, a past event start time, or a SUPPRESS band.
    const isStaleFlag = metadata['isStale'] === true;
    const eventTimeMs = readEventTimeMs(row);
    const isPastEvent = eventTimeMs !== null && eventTimeMs < now.getTime();
    const wasPromoted = row.promotion_target !== null || row.promotion_status === 'promoted';

    if (wasPromoted && isStaleFlag) {
      stalePromotedCount += 1;
      leakageExamples.push({ id: row.id, type: 'stale', source, band, promotion_target: row.promotion_target });
    }
    if (wasPromoted && isPastEvent) {
      postgamePromotedCount += 1;
      leakageExamples.push({ id: row.id, type: 'postgame', source, band, promotion_target: row.promotion_target });
    }
    if (wasPromoted && band === 'SUPPRESS') {
      suppressBandButPromotedCount += 1;
      leakageExamples.push({ id: row.id, type: 'suppress-band-promoted', source, band, promotion_target: row.promotion_target });
    }

    if (wasPromoted) promotedRows.push(row);
    if (row.promotion_status === 'suppressed' || band === 'SUPPRESS') rejectedRows.push(row);
  }

  const kellyStats =
    kellyFractions.length > 0
      ? {
          count: kellyFractions.length,
          min: Math.min(...kellyFractions),
          max: Math.max(...kellyFractions),
          mean: Number((kellyFractions.reduce((a, b) => a + b, 0) / kellyFractions.length).toFixed(4)),
          zero_count: kellyZeroCount,
          zero_pct: pct(kellyZeroCount, kellyFractions.length),
        }
      : null;

  const topPromoted = [...promotedRows]
    .sort((a, b) => (b.promotion_score ?? -1) - (a.promotion_score ?? -1))
    .slice(0, 15)
    .map((row) => ({
      id: row.id,
      source: row.source,
      sport: readSport(row),
      market: row.market,
      band: readBand(row),
      promotion_score: row.promotion_score,
      promotion_target: row.promotion_target,
      edge_source_quality: classifyEdgeSourceQuality(jsonRecord(row.metadata)),
      confidence: row.confidence,
    }));

  const topRejected = [...rejectedRows]
    .sort((a, b) => (b.promotion_score ?? -1) - (a.promotion_score ?? -1))
    .slice(0, 15)
    .map((row) => ({
      id: row.id,
      source: row.source,
      sport: readSport(row),
      market: row.market,
      band: readBand(row),
      promotion_score: row.promotion_score,
      promotion_reason: row.promotion_reason,
      fallback_reason: classifyFallbackReason(jsonRecord(row.metadata)),
    }));

  const sourceHealth = Object.fromEntries(
    [...bySourceHealth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, health]) => [
        source,
        {
          total: health.total,
          band_coverage_pct: pct(health.withBand, health.total),
          kelly_coverage_pct: pct(health.withKelly, health.total),
          domain_analysis_coverage_pct: pct(health.withDomainAnalysis, health.total),
          suppressed_pct: pct(health.suppressed, health.total),
        },
      ]),
  );

  // ── Verdict ────────────────────────────────────────────────────────────────
  const verdictReasons: string[] = [];
  let verdict: 'PASS' | 'PARTIAL' | 'FAIL' = 'PASS';

  const leakageTotal = stalePromotedCount + postgamePromotedCount + suppressBandButPromotedCount;
  if (leakageTotal > 0) {
    verdict = 'FAIL';
    verdictReasons.push(
      `${leakageTotal} leakage rows: stale-promoted=${stalePromotedCount}, postgame-promoted=${postgamePromotedCount}, suppress-band-promoted=${suppressBandButPromotedCount}`,
    );
  }

  const bandNoneCount = bandOverall.get('none') ?? 0;
  if (pct(bandNoneCount, total) > 25) {
    verdict = verdict === 'FAIL' ? 'FAIL' : 'PARTIAL';
    verdictReasons.push(`${pct(bandNoneCount, total)}% of picks have no band assigned`);
  }

  const confidenceFallbackPct = pct(edgeSourceQualityOverall.get('confidence-fallback') ?? 0, total);
  if (confidenceFallbackPct > 50) {
    verdict = verdict === 'FAIL' ? 'FAIL' : 'PARTIAL';
    verdictReasons.push(`${confidenceFallbackPct}% of picks still resolve edgeSourceQuality=confidence-fallback`);
  }

  if (kellyStats === null) {
    verdict = verdict === 'FAIL' ? 'FAIL' : 'PARTIAL';
    verdictReasons.push('no picks carry parseable kellySizing.fractional_kelly');
  }

  if (fullySaturatedSources.length > 0) {
    verdict = verdict === 'FAIL' ? 'FAIL' : 'PARTIAL';
    verdictReasons.push(
      `sources with 0 clean production picks in this window (100% test/proof fixtures): ${fullySaturatedSources.join(', ')} — cannot be validated`,
    );
  }

  if (verdictReasons.length === 0) {
    verdictReasons.push('no structural defects found in scoring metadata for the evaluated window');
  }

  const summary: JsonRecord = {
    schema_version: 1,
    issue_id: 'UTV2-1382',
    generated_at: now.toISOString(),
    evaluation_window: { from: from.toISOString(), to: now.toISOString(), days },
    excluded_non_production_source_count: excludedSourceCount,
    excluded_test_fixture_count: excludedTestFixtureCount,
    total_picks_analyzed: total,

    fixture_saturation_by_source: fixtureSaturationBySource,
    fully_saturated_sources: fullySaturatedSources,

    band_distribution_overall: mapToSortedObject(bandOverall),
    band_distribution_by_sport: mapToSortedObject(bandBySport),
    band_distribution_by_source: mapToSortedObject(bandBySource),
    band_distribution_by_market_family: mapToSortedObject(bandByMarketFamily),

    edge_source_quality_overall: mapToSortedObject(edgeSourceQualityOverall),
    edge_source_quality_overall_pct: Object.fromEntries(
      [...edgeSourceQualityOverall.entries()].map(([k, v]) => [k, pct(v, total)]),
    ),
    edge_source_quality_by_source: Object.fromEntries(
      [...edgeSourceQualityBySource.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, m]) => [source, mapToSortedObject(m)]),
    ),

    kelly_sizing_distribution: kellyStats,
    kelly_present_count: kellyPresentCount,
    kelly_present_pct: pct(kellyPresentCount, total),

    fallback_reason_distribution_overall: mapToSortedObject(fallbackReasonOverall),
    fallback_reason_distribution_by_source: Object.fromEntries(
      [...fallbackReasonBySource.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, m]) => [source, mapToSortedObject(m)]),
    ),

    suppress_count: suppressCount,
    suppress_pct: pct(suppressCount, total),
    suppress_reject_reason_counts: mapToSortedObject(suppressReasonCounts),

    top_promoted_sanity_check: topPromoted,
    top_rejected_sanity_check: topRejected,

    stale_postgame_suppress_leakage: {
      stale_promoted_count: stalePromotedCount,
      postgame_promoted_count: postgamePromotedCount,
      suppress_band_but_promoted_count: suppressBandButPromotedCount,
      total_leakage: leakageTotal,
      examples: leakageExamples.slice(0, 20),
    },

    source_by_source_scoring_health: sourceHealth,

    verdict,
    verdict_reasons: verdictReasons,
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
  runScoringValidationAudit({ days, outDir })
    .then((summary) => {
      process.stdout.write(
        `Scoring validation audit written to ${outDir ?? REQUIRED_OUTPUT_DIR}. verdict=${String(summary['verdict'])}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`Scoring validation audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
