import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '../packages/config/dist/env.js';
import { createClient } from '../packages/db/node_modules/@supabase/supabase-js/dist/index.mjs';

type JsonRecord = Record<string, unknown>;
type Band = 'A+' | 'A' | 'B' | 'C' | 'SUPPRESS' | 'UNKNOWN';
type Verdict = 'PROVEN_EDGE' | 'UNPROVEN' | 'INSUFFICIENT_DATA';
type EdgeSplit = 'real-edge-backed' | 'confidence-proxy' | 'unknown';
type Era = 'historical' | 'post_fix';

interface QueryResult {
  data: unknown[] | null;
  error: { message?: string } | null;
}

interface QueryBuilder {
  select(columns: string): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  not(column: string, operator: string, value: unknown): QueryBuilder;
  in(column: string, values: string[]): QueryBuilder;
  range(from: number, to: number): Promise<QueryResult>;
}

interface Client {
  from(table: string): QueryBuilder;
}

interface PickRow extends JsonRecord {
  id?: string;
  created_at?: string | null;
  market?: string | null;
  metadata?: unknown;
  odds?: number | null;
  promotion_score?: number | null;
  promotion_status?: string | null;
  promotion_target?: string | null;
  sport_id?: string | null;
  stake_units?: number | null;
}

interface SettlementRow extends JsonRecord {
  id?: string;
  created_at?: string | null;
  corrects_id?: string | null;
  payload?: unknown;
  pick_id?: string | null;
  result?: string | null;
  settled_at?: string | null;
  stake_units?: number | null;
}

interface PromotionHistoryRow extends JsonRecord {
  id?: string;
  created_at?: string | null;
  decided_at?: string | null;
  payload?: unknown;
  pick_id?: string | null;
  score?: number | null;
  status?: string | null;
  target?: string | null;
}

interface AnalyzedPick {
  band: Band;
  beatsClosingLine: boolean | null;
  clvRaw: number | null;
  edgeSplit: EdgeSplit;
  era: Era;
  market: string;
  pickId: string;
  profitUnits: number;
  result: 'win' | 'loss' | 'push';
  sport: string;
  stakeUnits: number;
}

interface MetricGroup {
  clvBeatRate: number | null;
  clvCount: number;
  losses: number;
  medianClv: number | null;
  push: number;
  roi: number | null;
  roiConfidenceInterval: { lower: number | null; upper: number | null };
  sampleSize: number;
  stakeUnits: number;
  winRate: number | null;
  wins: number;
}

interface ProofReport {
  generatedAt: string;
  filter: string;
  sampleBreakdown: {
    promotedPickRows: number;
    settlementRows: number;
    analyzedSettledPicks: number;
    realEdgeBackedSettledPicks: number;
    confidenceProxySettledPicks: number;
    unknownEdgeSettledPicks: number;
    postFixSettledPicks: number;
    historicalSettledPicks: number;
  };
  roiBySport: Record<string, MetricGroup>;
  clvByBand: Record<string, MetricGroup>;
  winRate: {
    overall: MetricGroup;
    byBand: Record<string, MetricGroup>;
    byMarket: Record<string, MetricGroup>;
    bySport: Record<string, MetricGroup>;
  };
  bandCalibration: {
    orderedBands: Band[];
    monotonicAPlusThroughC: boolean | null;
    rows: Array<{ band: Band; sampleSize: number; winRate: number | null }>;
  };
  edgeSourceSplit: Record<EdgeSplit, MetricGroup>;
  outOfSampleSplit: Record<Era, MetricGroup>;
  verdict: {
    value: Verdict;
    threshold: string;
    reasoning: string[];
  };
  notes: string[];
}

const PAGE_SIZE = 1000;
const POST_FIX_START_ISO = '2026-05-01T00:00:00.000Z';
const OUTPUT_PATH = resolve(process.cwd(), 'artifacts/model-edge-proof.json');
const BAND_ORDER: Band[] = ['A+', 'A', 'B', 'C', 'SUPPRESS', 'UNKNOWN'];

async function main(): Promise<void> {
  const env = loadEnvironment();
  const supabaseUrl = env.SUPABASE_URL ?? '';
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY are required');
  }

  const client = createClient<Record<string, never>>(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as unknown as Client;

  const report = await buildReport(client);
  await writeJson(OUTPUT_PATH, report);
  printSummary(report);
}

async function buildReport(client: Client): Promise<ProofReport> {
  const notes: string[] = [];
  const picks = await fetchRows<PickRow>(
    'picks',
    (from, to) =>
      client
        .from('picks')
        .select('id,created_at,market,metadata,odds,promotion_score,promotion_status,promotion_target,sport_id,stake_units')
        .not('promotion_status', 'is', null)
        .order('created_at', { ascending: false })
        .range(from, to),
    'promoted picks',
    notes,
  );

  const pickIds = unique(picks.map((row) => readString(row, 'id')).filter((id): id is string => id !== null));
  const settlements = pickIds.length > 0
    ? await fetchChunkedRows<SettlementRow>(
        'settlement_records',
        pickIds,
        200,
        (ids, from, to) =>
          client
            .from('settlement_records')
            .select('id,created_at,corrects_id,payload,pick_id,result,settled_at,stake_units')
            .in('pick_id', ids)
            .order('settled_at', { ascending: false })
            .range(from, to),
        'settlement records',
        notes,
      )
    : [];

  const promotionRows = pickIds.length > 0
    ? await fetchChunkedRows<PromotionHistoryRow>(
        'pick_promotion_history',
        pickIds,
        200,
        (ids, from, to) =>
          client
            .from('pick_promotion_history')
            .select('id,created_at,decided_at,payload,pick_id,score,status,target')
            .in('pick_id', ids)
            .order('decided_at', { ascending: false })
            .range(from, to),
        'promotion history',
        notes,
      )
    : [];

  const settlementByPickId = latestByPick(settlements, (row) => readString(row, 'pick_id'), (row) => readString(row, 'settled_at') ?? readString(row, 'created_at'));
  const promotionByPickId = latestByPick(promotionRows, (row) => readString(row, 'pick_id'), (row) => readString(row, 'decided_at') ?? readString(row, 'created_at'));

  const analyzed: AnalyzedPick[] = [];
  for (const pick of picks) {
    const pickId = readString(pick, 'id');
    if (!pickId) continue;
    const settlement = settlementByPickId.get(pickId);
    if (!settlement) continue;
    const result = normalizeResult(readString(settlement, 'result'));
    if (!result) continue;

    const metadata = asRecord(pick.metadata);
    const promotion = promotionByPickId.get(pickId);
    const promotionPayload = asRecord(promotion?.payload);
    const settlementPayload = asRecord(settlement.payload);
    const stakeUnits = readNumber(settlement, 'stake_units') ?? readNumber(pick, 'stake_units') ?? 1;
    const profitUnits =
      readNestedNumber(settlementPayload, ['profitLossUnits']) ??
      computeProfitUnits(result, readNumber(pick, 'odds'), stakeUnits);

    analyzed.push({
      band: resolveBand(pick, promotion),
      beatsClosingLine:
        readNestedBoolean(settlementPayload, ['beatsClosingLine']) ??
        readNestedBoolean(settlementPayload, ['clv', 'beatsClosingLine']),
      clvRaw:
        readNestedNumber(settlementPayload, ['clvRaw']) ??
        readNestedNumber(settlementPayload, ['clv', 'clvRaw']),
      edgeSplit: resolveEdgeSplit(metadata, promotionPayload),
      era: resolveEra(readString(settlement, 'settled_at') ?? readString(pick, 'created_at')),
      market: normalizeLabel(readString(pick, 'market'), 'unknown'),
      pickId,
      profitUnits,
      result,
      sport: resolveSport(metadata, pick),
      stakeUnits: stakeUnits > 0 ? stakeUnits : 1,
    });
  }

  const realEdgeCount = analyzed.filter((row) => row.edgeSplit === 'real-edge-backed').length;
  const confidenceProxyCount = analyzed.filter((row) => row.edgeSplit === 'confidence-proxy').length;
  const unknownEdgeCount = analyzed.filter((row) => row.edgeSplit === 'unknown').length;

  const byBand = groupMetrics(analyzed, (row) => row.band);
  const report: ProofReport = {
    generatedAt: new Date().toISOString(),
    filter: 'picks where promotion_status IS NOT NULL with at least one settlement_records row',
    sampleBreakdown: {
      promotedPickRows: picks.length,
      settlementRows: settlements.length,
      analyzedSettledPicks: analyzed.length,
      realEdgeBackedSettledPicks: realEdgeCount,
      confidenceProxySettledPicks: confidenceProxyCount,
      unknownEdgeSettledPicks: unknownEdgeCount,
      postFixSettledPicks: analyzed.filter((row) => row.era === 'post_fix').length,
      historicalSettledPicks: analyzed.filter((row) => row.era === 'historical').length,
    },
    roiBySport: groupMetrics(analyzed, (row) => row.sport),
    clvByBand: byBand,
    winRate: {
      overall: summarize(analyzed),
      byBand,
      byMarket: groupMetrics(analyzed, (row) => row.market),
      bySport: groupMetrics(analyzed, (row) => row.sport),
    },
    bandCalibration: buildBandCalibration(byBand),
    edgeSourceSplit: groupMetrics(analyzed, (row) => row.edgeSplit),
    outOfSampleSplit: groupMetrics(analyzed, (row) => row.era),
    verdict: buildVerdict(analyzed),
    notes,
  };

  return report;
}

function buildVerdict(rows: AnalyzedPick[]): ProofReport['verdict'] {
  const realEdgeRows = rows.filter((row) => row.edgeSplit === 'real-edge-backed');
  const realEdgeMetrics = summarize(realEdgeRows);
  const reasoning: string[] = [];
  reasoning.push(`${realEdgeRows.length} real-edge-backed settled picks found; at least 50 are required for a non-INSUFFICIENT_DATA verdict.`);
  if (realEdgeRows.length < 50) {
    return {
      value: 'INSUFFICIENT_DATA',
      threshold: '>=50 real-edge-backed settled picks',
      reasoning,
    };
  }

  const roiPositive = realEdgeMetrics.roi !== null && realEdgeMetrics.roi > 0;
  const roiCiPositive = realEdgeMetrics.roiConfidenceInterval.lower !== null && realEdgeMetrics.roiConfidenceInterval.lower > 0;
  const clvPositive = realEdgeMetrics.clvBeatRate !== null && realEdgeMetrics.clvBeatRate > 0.5;
  const winRatePositive = realEdgeMetrics.winRate !== null && realEdgeMetrics.winRate > 0.5;
  reasoning.push(`Real-edge-backed ROI=${formatNumber(realEdgeMetrics.roi)}, ROI CI lower=${formatNumber(realEdgeMetrics.roiConfidenceInterval.lower)}.`);
  reasoning.push(`Real-edge-backed CLV beat rate=${formatNumber(realEdgeMetrics.clvBeatRate)}, win rate=${formatNumber(realEdgeMetrics.winRate)}.`);

  if (roiPositive && roiCiPositive && clvPositive && winRatePositive) {
    reasoning.push('ROI, ROI confidence interval, CLV, and win-rate checks are all positive.');
    return {
      value: 'PROVEN_EDGE',
      threshold: '>=50 real-edge-backed settled picks plus positive ROI CI, CLV beat rate, and win rate',
      reasoning,
    };
  }

  reasoning.push('At least one real-edge-backed proof check failed.');
  return {
    value: 'UNPROVEN',
    threshold: '>=50 real-edge-backed settled picks plus positive ROI CI, CLV beat rate, and win rate',
    reasoning,
  };
}

function buildBandCalibration(byBand: Record<string, MetricGroup>): ProofReport['bandCalibration'] {
  const orderedBands: Band[] = ['A+', 'A', 'B', 'C'];
  const rows = orderedBands.map((band) => ({
    band,
    sampleSize: byBand[band]?.sampleSize ?? 0,
    winRate: byBand[band]?.winRate ?? null,
  }));
  const hasAllRates = rows.every((row) => row.winRate !== null);
  return {
    orderedBands,
    monotonicAPlusThroughC: hasAllRates
      ? rows.every((row, index) => index === 0 || (rows[index - 1]!.winRate ?? 0) >= (row.winRate ?? 0))
      : null,
    rows,
  };
}

function groupMetrics<T extends string>(rows: AnalyzedPick[], keyFor: (row: AnalyzedPick) => T): Record<T, MetricGroup> {
  const groups = new Map<T, AnalyzedPick[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort(([left], [right]) => orderKey(left).localeCompare(orderKey(right)))
      .map(([key, group]) => [key, summarize(group)]),
  ) as Record<T, MetricGroup>;
}

function summarize(rows: AnalyzedPick[]): MetricGroup {
  const wins = rows.filter((row) => row.result === 'win').length;
  const losses = rows.filter((row) => row.result === 'loss').length;
  const push = rows.filter((row) => row.result === 'push').length;
  const stakeUnits = sum(rows.map((row) => row.stakeUnits));
  const profitUnits = sum(rows.map((row) => row.profitUnits));
  const decisions = wins + losses;
  const clvRows = rows.filter((row) => row.clvRaw !== null);
  const clvBeatRows = rows.filter((row) => row.beatsClosingLine !== null);
  const returns = rows.map((row) => row.profitUnits / row.stakeUnits);
  const roi = stakeUnits > 0 ? profitUnits / stakeUnits : null;
  const ci = roiConfidenceInterval(returns);
  return {
    clvBeatRate: clvBeatRows.length > 0
      ? round4(clvBeatRows.filter((row) => row.beatsClosingLine === true).length / clvBeatRows.length)
      : null,
    clvCount: clvRows.length,
    losses,
    medianClv: median(clvRows.map((row) => row.clvRaw).filter((value): value is number => value !== null)),
    push,
    roi: roi === null ? null : round4(roi),
    roiConfidenceInterval: ci,
    sampleSize: rows.length,
    stakeUnits: round4(stakeUnits),
    winRate: decisions > 0 ? round4(wins / decisions) : null,
    wins,
  };
}

function roiConfidenceInterval(returns: number[]): MetricGroup['roiConfidenceInterval'] {
  if (returns.length < 2) {
    return { lower: null, upper: null };
  }
  const mean = sum(returns) / returns.length;
  const variance = sum(returns.map((value) => (value - mean) ** 2)) / (returns.length - 1);
  const margin = 1.96 * Math.sqrt(variance / returns.length);
  return {
    lower: round4(mean - margin),
    upper: round4(mean + margin),
  };
}

async function fetchRows<T extends JsonRecord>(
  table: string,
  fetchPage: (from: number, to: number) => Promise<QueryResult>,
  label: string,
  notes: string[],
): Promise<T[]> {
  const rows: T[] = [];
  try {
    for (let from = 0; ; from += PAGE_SIZE) {
      const response = await fetchPage(from, from + PAGE_SIZE - 1);
      if (response.error) {
        throw new Error(`${label}: ${response.error.message ?? 'unknown Supabase error'}`);
      }
      const page = (response.data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch (error) {
    notes.push(`${table} read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return rows;
}

async function fetchChunkedRows<T extends JsonRecord>(
  table: string,
  ids: string[],
  chunkSize: number,
  fetchPage: (chunkIds: string[], from: number, to: number) => Promise<QueryResult>,
  label: string,
  notes: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunkIds of chunk(ids, chunkSize)) {
    rows.push(...await fetchRows<T>(table, (from, to) => fetchPage(chunkIds, from, to), label, notes));
  }
  return rows;
}

function latestByPick<T>(
  rows: T[],
  pickIdFor: (row: T) => string | null,
  timestampFor: (row: T) => string | null,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const pickId = pickIdFor(row);
    if (!pickId || map.has(pickId)) continue;
    map.set(pickId, row);
  }
  return new Map(Array.from(map.entries()).sort((left, right) => {
    const leftTime = timestampFor(left[1]) ?? '';
    const rightTime = timestampFor(right[1]) ?? '';
    return rightTime.localeCompare(leftTime);
  }));
}

function resolveBand(pick: PickRow, promotion: PromotionHistoryRow | undefined): Band {
  const promotionPayload = asRecord(promotion?.payload);
  const metadata = asRecord(pick.metadata);
  const explicitBand =
    normalizeBand(readNestedString(promotionPayload, ['band'])) ??
    normalizeBand(readNestedString(metadata, ['band'])) ??
    normalizeBand(readNestedString(metadata, ['promotionScores', 'tier']));
  if (explicitBand) return explicitBand;

  const status = readString(promotion ?? {}, 'status') ?? readString(pick, 'promotion_status');
  if (status?.toLowerCase() === 'suppressed') return 'SUPPRESS';

  const score = readNumber(promotion ?? {}, 'score') ?? readNumber(pick, 'promotion_score');
  if (score === null) return 'UNKNOWN';
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  return 'C';
}

function resolveEdgeSplit(metadata: JsonRecord, promotionPayload: JsonRecord): EdgeSplit {
  const scoreInputs = asRecord(promotionPayload['scoreInputs']);
  const edgeSource =
    readNestedString(scoreInputs, ['edgeSource']) ??
    readNestedString(metadata, ['edgeSource']) ??
    readNestedString(metadata, ['domainAnalysis', 'realEdgeSource']);
  const edgeMethod =
    readNestedString(scoreInputs, ['edgeMethod']) ??
    readNestedString(metadata, ['edgeProvenance', 'method']);
  const providerCoverageState =
    readNestedString(scoreInputs, ['providerCoverageState']) ??
    readNestedString(metadata, ['edgeProvenance', 'providerCoverageState']);
  const edgeSourceQuality = readNestedString(scoreInputs, ['edgeSourceQuality']);

  if (
    edgeMethod === 'market-devigged' ||
    edgeSourceQuality === 'market-backed' ||
    ['real-edge', 'consensus-edge', 'sgo-edge', 'single-book-edge'].includes(edgeSource ?? '') ||
    ['pinnacle', 'consensus', 'sgo', 'single-book'].includes(providerCoverageState ?? '')
  ) {
    return 'real-edge-backed';
  }
  if (
    edgeMethod === 'confidence-delta' ||
    edgeSourceQuality === 'confidence-fallback' ||
    ['confidence-delta', 'explicit'].includes(edgeSource ?? '') ||
    providerCoverageState === 'none'
  ) {
    return 'confidence-proxy';
  }
  return 'unknown';
}

function resolveSport(metadata: JsonRecord, pick: PickRow): string {
  return normalizeLabel(
    readNestedString(metadata, ['sport']) ??
      readNestedString(metadata, ['league']) ??
      readNestedString(metadata, ['event', 'sport']) ??
      readString(pick, 'sport_id'),
    'unknown',
  );
}

function resolveEra(iso: string | null): Era {
  if (!iso) return 'historical';
  return new Date(iso).getTime() >= new Date(POST_FIX_START_ISO).getTime() ? 'post_fix' : 'historical';
}

function normalizeResult(value: string | null): AnalyzedPick['result'] | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'win' || normalized === 'won') return 'win';
  if (normalized === 'loss' || normalized === 'lost') return 'loss';
  if (normalized === 'push' || normalized === 'void') return 'push';
  return null;
}

function computeProfitUnits(result: AnalyzedPick['result'], odds: number | null, stakeUnits: number): number {
  const stake = stakeUnits > 0 ? stakeUnits : 1;
  if (result === 'push') return 0;
  if (result === 'loss') return -stake;
  if (odds !== null && odds !== 0) {
    return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
  }
  return stake;
}

function normalizeBand(value: string | null): Band | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'A+' || normalized === 'A' || normalized === 'B' || normalized === 'C' || normalized === 'SUPPRESS') {
    return normalized;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function readString(row: JsonRecord, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(row: JsonRecord, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedString(row: JsonRecord, path: string[]): string | null {
  const value = readNestedValue(row, path);
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNestedNumber(row: JsonRecord, path: string[]): number | null {
  const value = readNestedValue(row, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedBoolean(row: JsonRecord, path: string[]): boolean | null {
  const value = readNestedValue(row, path);
  return typeof value === 'boolean' ? value : null;
}

function readNestedValue(row: JsonRecord, path: string[]): unknown {
  let current: unknown = row;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return current;
}

function normalizeLabel(value: string | null, fallback: string): string {
  return value?.trim().toUpperCase() || fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
  return round4(value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function orderKey(value: string): string {
  const bandIndex = BAND_ORDER.indexOf(value as Band);
  return bandIndex === -1 ? value : String(bandIndex).padStart(2, '0');
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function printSummary(report: ProofReport): void {
  console.log('=== UTV2-1000 Model Edge Proof ===');
  console.log(`Generated at: ${report.generatedAt}`);
  console.log(`Analyzed settled picks: ${report.sampleBreakdown.analyzedSettledPicks}`);
  console.log(`Real-edge-backed settled picks: ${report.sampleBreakdown.realEdgeBackedSettledPicks}`);
  console.log(`Confidence-proxy settled picks: ${report.sampleBreakdown.confidenceProxySettledPicks}`);
  console.log(`Post-fix / historical: ${report.sampleBreakdown.postFixSettledPicks} / ${report.sampleBreakdown.historicalSettledPicks}`);
  console.log(`Overall ROI: ${formatPercent(report.winRate.overall.roi)} (${formatNumber(report.winRate.overall.roiConfidenceInterval.lower)} to ${formatNumber(report.winRate.overall.roiConfidenceInterval.upper)})`);
  console.log(`Overall win rate: ${formatPercent(report.winRate.overall.winRate)}`);
  console.log(`Overall CLV beat rate: ${formatPercent(report.winRate.overall.clvBeatRate)}`);
  console.log(`Band calibration A+ > A > B > C: ${String(report.bandCalibration.monotonicAPlusThroughC)}`);
  console.log(`Verdict: ${report.verdict.value}`);
  for (const reason of report.verdict.reasoning) {
    console.log(`- ${reason}`);
  }
  console.log(`Wrote ${OUTPUT_PATH}`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
