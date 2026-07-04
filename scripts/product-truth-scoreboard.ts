/**
 * UTV2-1449: product-truth scoreboard.
 *
 * Read-only measurement surfaced in `pnpm ops:brief` so model-certification
 * progress is visible every session instead of depending on someone
 * remembering to check. Does not change scoring, promotion, or settlement
 * logic — this is a report, not a gate.
 *
 * Exclusions (per UTV2-1394 lesson — mirrors scripts/audits/utv2-1382-scoring-validation.ts):
 *   - metadata.testRun rows (T1 pnpm test:db live fixtures)
 *   - legacy proof-fixture markers (metadata.proof_issue, metadata.proof_fixture_id, "proof" in selection)
 *   - non-production source values (api, test, proof, t1-proof, synthetic, canary-proof)
 *
 * Thresholds per docs/05_operations/MODEL_EDGE_ACCEPTANCE_STANDARD.md:
 *   - DEVELOPING: >= 50 in-sample market-backed-edge settled picks
 *   - STRONG: >= 200 in-sample market-backed-edge settled picks
 * "Market-backed" excludes confidence-fallback rows — a pick whose edge score
 * is a confidence proxy does not count toward either threshold.
 */
import { createDatabaseClient, type UnitTalkSupabaseClient } from '@unit-talk/db';
import { hasClvCoveragePayload } from './clvCoverage.js';

type JsonRecord = Record<string, unknown>;

const NON_PRODUCTION_SOURCES = new Set(['api', 'test', 'proof', 't1-proof', 'synthetic', 'canary-proof']);
const DEVELOPING_THRESHOLD = 50;
const STRONG_THRESHOLD = 200;

interface PickRow {
  id: string;
  source: string | null;
  selection: string | null;
  status: string;
  metadata: JsonRecord | null;
}

interface SettlementRow {
  pick_id: string;
  result: string | null;
  settled_at: string;
  payload: JsonRecord | null;
  picks: PickRow | null;
}

export interface ProductTruthScoreboard {
  windowDays: number;
  settledPicksTotal: number;
  settledPicksExcludedFixture: number;
  settledPicksMeasured: number;
  clvCoveragePct: number;
  edgeSourceQuality: {
    explicitPct: number;
    marketBackedPct: number;
    confidenceFallbackPct: number;
  };
  kellySizingPopulatedPct: number;
  marketBackedSettledCount: number;
  developing: { threshold: number; remaining: number; met: boolean };
  strong: { threshold: number; remaining: number; met: boolean };
  generatedAt: string;
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

/**
 * Mirrors classifyEdgeSourceQuality in scripts/audits/utv2-1382-scoring-validation.ts,
 * which itself mirrors resolveEdgeSourceQuality in apps/api/src/promotion-service.ts.
 * Reimplemented (read-only) rather than imported, matching the UTV2-1394 measurement
 * convention of not depending on app-layer code for an audit surface.
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

function hasKellySizing(metadata: JsonRecord): boolean {
  const kellySizing = jsonRecord(metadata['kellySizing']);
  return Object.keys(kellySizing).length > 0;
}

async function fetchSettledPicks(client: UnitTalkSupabaseClient, fromIso: string): Promise<SettlementRow[]> {
  const rows: SettlementRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('settlement_records')
      .select('pick_id,result,settled_at,payload,picks!inner(id,source,selection,status,metadata)')
      .gte('settled_at', fromIso)
      .not('result', 'is', null)
      .order('settled_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`settlement_records query failed: ${error.message}`);
    const page = (data ?? []) as unknown as SettlementRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function computeProductTruthScoreboard(
  options: { days?: number; now?: Date; rows?: SettlementRow[]; client?: UnitTalkSupabaseClient } = {},
): Promise<ProductTruthScoreboard> {
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000);

  const allRows =
    options.rows ?? (await fetchSettledPicks(options.client ?? createDatabaseClient({ useServiceRole: true }), from.toISOString()));

  const settledPicksTotal = allRows.length;
  const measured = allRows.filter((row) => {
    const pick = row.picks;
    if (!pick) return false;
    return !isExcludedSource(pick) && !isTestFixtureRow(pick);
  });
  const settledPicksMeasured = measured.length;
  const settledPicksExcludedFixture = settledPicksTotal - settledPicksMeasured;

  const clvCoveredCount = measured.filter((row) => hasClvCoveragePayload({ payload: row.payload })).length;

  let explicitCount = 0;
  let marketBackedCount = 0;
  let confidenceFallbackCount = 0;
  let kellyPopulatedCount = 0;

  for (const row of measured) {
    const metadata = jsonRecord(row.picks?.metadata);
    const quality = classifyEdgeSourceQuality(metadata);
    if (quality === 'explicit') explicitCount += 1;
    else if (quality === 'market-backed') marketBackedCount += 1;
    else confidenceFallbackCount += 1;

    if (hasKellySizing(metadata)) kellyPopulatedCount += 1;
  }

  // Market-backed-edge settled count = the DEVELOPING/STRONG sample denominator.
  // Confidence-fallback rows do not count toward certification thresholds
  // (MODEL_EDGE_ACCEPTANCE_STANDARD.md — "confidence-proxy rows do not count
  // toward the sample minimum").
  const marketBackedSettledCount = explicitCount + marketBackedCount;

  return {
    windowDays: days,
    settledPicksTotal,
    settledPicksExcludedFixture,
    settledPicksMeasured,
    clvCoveragePct: pct(clvCoveredCount, settledPicksMeasured),
    edgeSourceQuality: {
      explicitPct: pct(explicitCount, settledPicksMeasured),
      marketBackedPct: pct(marketBackedCount, settledPicksMeasured),
      confidenceFallbackPct: pct(confidenceFallbackCount, settledPicksMeasured),
    },
    kellySizingPopulatedPct: pct(kellyPopulatedCount, settledPicksMeasured),
    marketBackedSettledCount,
    developing: {
      threshold: DEVELOPING_THRESHOLD,
      remaining: Math.max(0, DEVELOPING_THRESHOLD - marketBackedSettledCount),
      met: marketBackedSettledCount >= DEVELOPING_THRESHOLD,
    },
    strong: {
      threshold: STRONG_THRESHOLD,
      remaining: Math.max(0, STRONG_THRESHOLD - marketBackedSettledCount),
      met: marketBackedSettledCount >= STRONG_THRESHOLD,
    },
    generatedAt: now.toISOString(),
  };
}

export function formatProductTruthScoreboard(scoreboard: ProductTruthScoreboard): string[] {
  const lines: string[] = [];
  lines.push(`Settled (${scoreboard.windowDays}d, non-fixture): ${scoreboard.settledPicksMeasured} (${scoreboard.settledPicksExcludedFixture} fixture rows excluded)`);
  lines.push(`CLV coverage: ${scoreboard.clvCoveragePct}%`);
  lines.push(
    `Edge source: ${scoreboard.edgeSourceQuality.explicitPct}% explicit, ${scoreboard.edgeSourceQuality.marketBackedPct}% market-backed, ${scoreboard.edgeSourceQuality.confidenceFallbackPct}% confidence-fallback`,
  );
  lines.push(`Kelly sizing populated: ${scoreboard.kellySizingPopulatedPct}%`);
  lines.push(
    `DEVELOPING: ${scoreboard.marketBackedSettledCount}/${scoreboard.developing.threshold}${
      scoreboard.developing.met ? ' (MET)' : ` (${scoreboard.developing.remaining} to go)`
    }`,
  );
  lines.push(
    `STRONG: ${scoreboard.marketBackedSettledCount}/${scoreboard.strong.threshold}${
      scoreboard.strong.met ? ' (MET)' : ` (${scoreboard.strong.remaining} to go)`
    }`,
  );
  return lines;
}

async function main(): Promise<void> {
  const scoreboard = await computeProductTruthScoreboard();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(scoreboard, null, 2));
  } else {
    for (const line of formatProductTruthScoreboard(scoreboard)) {
      console.log(line);
    }
  }
}

const isMain = process.argv[1] != null && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  main().catch((error) => {
    console.error('product-truth-scoreboard failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
