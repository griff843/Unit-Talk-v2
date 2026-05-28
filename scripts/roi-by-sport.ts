#!/usr/bin/env tsx
/**
 * UTV2-998: stake-based ROI / Win-Rate per Sport.
 *
 * Historical rows with missing stake_units are labeled and excluded from ROI.
 *
 * Usage: tsx scripts/roi-by-sport.ts [--after=YYYY-MM-DD] [--real-edge-only] [--monitor-json] [--state-file=path]
 */
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RoiBySportRow {
  result: string | null;
  sport: string | null;
  marketType: string | null;
  odds: number | null;
  stakeUnits: number | null;
  clvStatus: string | null;
  edgeSourceSplit?: EdgeSourceSplit;
  settledAt: string;
}

export interface StakeIntegritySummary {
  canonicalStakeRows: number;
  historicalUnknownStakeRows: number;
  totalRows: number;
}

interface SportSummary {
  sport: string;
  rows: RoiBySportRow[];
  knownStakeRows: RoiBySportRow[];
  wins: number;
  losses: number;
  pushes: number;
  riskedUnits: number;
  profitUnits: number;
  roiPercent: number | null;
  clvComputed: number;
}

export type ModelEdgeTier = 'UNPROVEN' | 'DEVELOPING' | 'STRONG' | 'ELITE';
export type EdgeSourceSplit =
  | 'real-edge-backed'
  | 'confidence-proxy'
  | 'unknown';
export type MonitoringAlertReason =
  | 'tier_changed'
  | 'roi_threshold_crossed'
  | 'sample_milestone_reached'
  | 'negative_roi'
  | 'low_clv_coverage';

export interface ModelPerformanceSnapshot {
  generatedAt: string;
  afterDate: string;
  tier: ModelEdgeTier;
  settledRows: number;
  stakeKnownRows: number;
  historicalUnknownStakeRows: number;
  riskedUnits: number;
  profitUnits: number;
  roiPercent: number | null;
  wins: number;
  losses: number;
  pushes: number;
  clvCoveragePercent: number | null;
  notes: string[];
}

export interface ModelPerformanceAlert {
  reason: MonitoringAlertReason;
  severity: 'warning' | 'critical';
  message: string;
}

export interface ModelPerformanceMonitorResult {
  snapshot: ModelPerformanceSnapshot;
  previousSnapshot: ModelPerformanceSnapshot | null;
  alerts: ModelPerformanceAlert[];
}

const ROI_BOUNDARIES = [0, 2, 4] as const;
const SAMPLE_MILESTONES = [50, 100, 200, 250, 500] as const;

function pct(n: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatUnits(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}u`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeStakeIntegrity(
  rows: RoiBySportRow[],
): StakeIntegritySummary {
  const canonicalStakeRows = rows.filter(hasMeasurableStake).length;
  return {
    canonicalStakeRows,
    historicalUnknownStakeRows: rows.length - canonicalStakeRows,
    totalRows: rows.length,
  };
}

export function computeProfitUnits(row: RoiBySportRow): number | null {
  if (!hasMeasurableStake(row)) return null;
  if (row.result === 'push') return 0;
  if (row.result === 'loss') return -row.stakeUnits;
  if (row.result !== 'win') return null;

  if (
    typeof row.odds === 'number' &&
    Number.isFinite(row.odds) &&
    row.odds !== 0
  ) {
    return row.odds > 0
      ? round2(row.stakeUnits * (row.odds / 100))
      : round2(row.stakeUnits * (100 / Math.abs(row.odds)));
  }

  return row.stakeUnits;
}

export function computeRoiPercent(rows: RoiBySportRow[]): number | null {
  const knownStakeRows = rows.filter(
    (row) => hasMeasurableStake(row) && row.result !== 'push',
  );
  const riskedUnits = knownStakeRows.reduce(
    (sum, row) => sum + row.stakeUnits,
    0,
  );
  if (riskedUnits <= 0) return null;

  const profitUnits = knownStakeRows.reduce(
    (sum, row) => sum + (computeProfitUnits(row) ?? 0),
    0,
  );
  return (profitUnits / riskedUnits) * 100;
}

export function buildSportSummaries(rows: RoiBySportRow[]): SportSummary[] {
  const sports = [...new Set(rows.map((row) => row.sport ?? 'unknown'))].sort();
  return sports.map((sport) => {
    const sportRows = rows.filter((row) => (row.sport ?? 'unknown') === sport);
    const knownStakeRows = sportRows.filter(hasMeasurableStake);
    const riskRows = knownStakeRows.filter((row) => row.result !== 'push');
    const riskedUnits = round2(
      riskRows.reduce((sum, row) => sum + row.stakeUnits, 0),
    );
    const profitUnits = round2(
      riskRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0),
    );

    return {
      sport,
      rows: sportRows,
      knownStakeRows,
      wins: sportRows.filter((row) => row.result === 'win').length,
      losses: sportRows.filter((row) => row.result === 'loss').length,
      pushes: sportRows.filter((row) => row.result === 'push').length,
      riskedUnits,
      profitUnits,
      roiPercent: riskedUnits > 0 ? (profitUnits / riskedUnits) * 100 : null,
      clvComputed: sportRows.filter((row) => row.clvStatus === 'computed')
        .length,
    };
  });
}

export function buildModelPerformanceSnapshot(
  rows: RoiBySportRow[],
  afterDate: string,
  generatedAt = new Date().toISOString(),
): ModelPerformanceSnapshot {
  const total = rows.length;
  const wins = rows.filter((row) => row.result === 'win').length;
  const losses = rows.filter((row) => row.result === 'loss').length;
  const pushes = rows.filter((row) => row.result === 'push').length;
  const knownRows = rows.filter(hasMeasurableStake);
  const riskRows = knownRows.filter((row) => row.result !== 'push');
  const riskedUnits = round2(
    riskRows.reduce((sum, row) => sum + row.stakeUnits, 0),
  );
  const profitUnits = round2(
    riskRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0),
  );
  const roiPercent = riskedUnits > 0 ? (profitUnits / riskedUnits) * 100 : null;
  const clvComputed = rows.filter((row) => row.clvStatus === 'computed').length;
  const clvCoveragePercent = total > 0 ? (clvComputed / total) * 100 : null;
  const stakeIntegrity = summarizeStakeIntegrity(rows);
  const notes: string[] = [];

  if (total < 50) {
    notes.push(
      'Sample below DEVELOPING minimum of 50 real-edge-backed settled bets',
    );
  }
  if (clvCoveragePercent === null || clvCoveragePercent < 60) {
    notes.push('CLV coverage below 60% minimum for positive edge labels');
  }
  if (roiPercent === null || roiPercent <= 0) notes.push('ROI is not positive');
  notes.push(
    'Tier uses observable N, ROI, and CLV coverage gates only; CI, median CLV, calibration, band accuracy, out-of-sample, and freshness gates require separate proof.',
  );

  return {
    generatedAt,
    afterDate,
    tier: computeObservableModelEdgeTier({
      settledRows: total,
      roiPercent,
      clvCoveragePercent,
    }),
    settledRows: total,
    stakeKnownRows: stakeIntegrity.canonicalStakeRows,
    historicalUnknownStakeRows: stakeIntegrity.historicalUnknownStakeRows,
    riskedUnits,
    profitUnits,
    roiPercent,
    wins,
    losses,
    pushes,
    clvCoveragePercent,
    notes,
  };
}

export function computeObservableModelEdgeTier(input: {
  settledRows: number;
  roiPercent: number | null;
  clvCoveragePercent: number | null;
}): ModelEdgeTier {
  const { settledRows, roiPercent, clvCoveragePercent } = input;
  if (roiPercent === null || clvCoveragePercent === null) return 'UNPROVEN';
  if (settledRows >= 500 && roiPercent >= 4 && clvCoveragePercent >= 90)
    return 'ELITE';
  if (settledRows >= 200 && roiPercent >= 2 && clvCoveragePercent >= 80)
    return 'STRONG';
  if (settledRows >= 50 && roiPercent > 0 && clvCoveragePercent >= 60)
    return 'DEVELOPING';
  return 'UNPROVEN';
}

export function evaluateModelPerformanceAlerts(
  snapshot: ModelPerformanceSnapshot,
  previousSnapshot: ModelPerformanceSnapshot | null,
): ModelPerformanceAlert[] {
  const alerts: ModelPerformanceAlert[] = [];

  if (previousSnapshot && previousSnapshot.tier !== snapshot.tier) {
    alerts.push({
      reason: 'tier_changed',
      severity:
        tierRank(snapshot.tier) < tierRank(previousSnapshot.tier)
          ? 'critical'
          : 'warning',
      message: `Observable edge tier changed from ${previousSnapshot.tier} to ${snapshot.tier}`,
    });
  }

  if (
    previousSnapshot?.roiPercent !== null &&
    previousSnapshot?.roiPercent !== undefined &&
    snapshot.roiPercent !== null
  ) {
    for (const boundary of ROI_BOUNDARIES) {
      if (
        crossedBoundary(
          previousSnapshot.roiPercent,
          snapshot.roiPercent,
          boundary,
        )
      ) {
        alerts.push({
          reason: 'roi_threshold_crossed',
          severity: snapshot.roiPercent < boundary ? 'critical' : 'warning',
          message: `ROI crossed ${formatPercent(boundary)} boundary (${formatPercent(previousSnapshot.roiPercent)} -> ${formatPercent(snapshot.roiPercent)})`,
        });
      }
    }
  }

  if (previousSnapshot) {
    for (const milestone of SAMPLE_MILESTONES) {
      if (
        previousSnapshot.settledRows < milestone &&
        snapshot.settledRows >= milestone
      ) {
        alerts.push({
          reason: 'sample_milestone_reached',
          severity: 'warning',
          message: `Settled sample reached ${milestone} rows; proof re-run is required`,
        });
      }
    }
  }

  if (snapshot.roiPercent !== null && snapshot.roiPercent < 0) {
    alerts.push({
      reason: 'negative_roi',
      severity: 'critical',
      message: `ROI is negative at ${formatPercent(snapshot.roiPercent)}`,
    });
  }

  if (
    snapshot.clvCoveragePercent !== null &&
    snapshot.clvCoveragePercent < 60
  ) {
    alerts.push({
      reason: 'low_clv_coverage',
      severity: snapshot.clvCoveragePercent < 50 ? 'critical' : 'warning',
      message: `CLV coverage is below the 60% edge-label minimum at ${formatPercent(snapshot.clvCoveragePercent)}`,
    });
  }

  return alerts;
}

export function buildMonitorResult(
  rows: RoiBySportRow[],
  afterDate: string,
  previousSnapshot: ModelPerformanceSnapshot | null,
  generatedAt = new Date().toISOString(),
): ModelPerformanceMonitorResult {
  const snapshot = buildModelPerformanceSnapshot(rows, afterDate, generatedAt);
  return {
    snapshot,
    previousSnapshot,
    alerts: evaluateModelPerformanceAlerts(snapshot, previousSnapshot),
  };
}

async function fetchRows(afterDate: string): Promise<RoiBySportRow[]> {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  const { data, error } = await client
    .from('settlement_records')
    .select(
      `
      result,
      pick_id,
      payload,
      settled_at,
      picks!inner(id, stake_units, odds, metadata)
    `,
    )
    .gte('settled_at', afterDate)
    .is('corrects_id', null);

  if (error) {
    throw new Error(`Failed to fetch settled ROI rows: ${error.message}`);
  }

  const promotionPayloadByPickId = await fetchLatestPromotionPayloads(
    client,
    (data ?? [])
      .map((row) => readString(row.pick_id))
      .filter((pickId): pickId is string => pickId !== null),
  );

  return (data ?? []).map((row) => {
    const pick = Array.isArray(row.picks) ? row.picks[0] : row.picks;
    const metadata = asRecord(pick?.metadata);
    const payload = asRecord(row.payload);
    const pickId = readString(row.pick_id) ?? readString(pick?.id);
    const promotionPayload = pickId
      ? (promotionPayloadByPickId.get(pickId) ?? null)
      : null;
    return {
      result: typeof row.result === 'string' ? row.result : null,
      sport: typeof metadata?.['sport'] === 'string' ? metadata['sport'] : null,
      marketType:
        typeof metadata?.['marketTypeId'] === 'string'
          ? metadata['marketTypeId']
          : typeof metadata?.['marketType'] === 'string'
            ? metadata['marketType']
            : null,
      odds: readNumber(pick?.odds),
      stakeUnits: readNumber(pick?.stake_units),
      clvStatus:
        typeof payload?.['clvStatus'] === 'string'
          ? payload['clvStatus']
          : null,
      edgeSourceSplit: resolveEdgeSourceSplit(metadata, promotionPayload),
      settledAt: row.settled_at,
    };
  });
}

async function fetchLatestPromotionPayloads(
  client: ReturnType<typeof createDatabaseClientFromConnection>,
  pickIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const uniquePickIds = [...new Set(pickIds)];
  if (uniquePickIds.length === 0) return new Map();

  const payloads = new Map<string, Record<string, unknown>>();
  for (const chunk of chunks(uniquePickIds, 200)) {
    const { data, error } = await client
      .from('pick_promotion_history')
      .select('pick_id, payload, decided_at, created_at')
      .in('pick_id', chunk)
      .order('decided_at', { ascending: false });

    if (error) {
      throw new Error(
        `Failed to fetch promotion history rows: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      const pickId = readString(row.pick_id);
      if (!pickId || payloads.has(pickId)) continue;
      payloads.set(pickId, asRecord(row.payload) ?? {});
    }
  }
  return payloads;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function filterRealEdgeBackedRows(
  rows: RoiBySportRow[],
): RoiBySportRow[] {
  return rows.filter((row) => row.edgeSourceSplit === 'real-edge-backed');
}

export function printReport(
  rows: RoiBySportRow[],
  afterDate: string,
  generatedAt = new Date().toISOString(),
  options: { realEdgeOnly?: boolean } = {},
): string {
  const lines: string[] = [];
  const total = rows.length;
  const wins = rows.filter((row) => row.result === 'win').length;
  const losses = rows.filter((row) => row.result === 'loss').length;
  const pushes = rows.filter((row) => row.result === 'push').length;
  const knownRows = rows.filter(hasMeasurableStake);
  const riskRows = knownRows.filter((row) => row.result !== 'push');
  const totalRisked = round2(
    riskRows.reduce((sum, row) => sum + row.stakeUnits, 0),
  );
  const netUnits = round2(
    riskRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0),
  );
  const stakeIntegrity = summarizeStakeIntegrity(rows);
  const roiPercent = totalRisked > 0 ? (netUnits / totalRisked) * 100 : null;
  const snapshot = buildModelPerformanceSnapshot(rows, afterDate, generatedAt);

  lines.push('=== ROI / Win-Rate by Sport ===');
  lines.push(`Query window: settled_at >= ${afterDate}`);
  lines.push(
    `Edge filter: ${options.realEdgeOnly ? 'real-edge-backed only' : 'all settled picks'}`,
  );
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('## Overall (all sports)');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total settled | ${total} |`);
  lines.push(
    `| Real-edge-backed rows | ${rows.filter((row) => row.edgeSourceSplit === 'real-edge-backed').length} |`,
  );
  lines.push(`| Wins | ${wins} (${pct(wins, total)}) |`);
  lines.push(`| Losses | ${losses} (${pct(losses, total)}) |`);
  lines.push(`| Pushes | ${pushes} |`);
  lines.push(`| Stake-known rows | ${stakeIntegrity.canonicalStakeRows} |`);
  lines.push(
    `| Historical unknown-stake rows | ${stakeIntegrity.historicalUnknownStakeRows} |`,
  );
  lines.push(`| Total risked | ${totalRisked.toFixed(2)}u |`);
  lines.push(`| Net units | ${formatUnits(netUnits)} |`);
  lines.push(`| ROI (stake-based) | ${formatPercent(roiPercent)} |`);
  lines.push(`| Observable model edge tier | ${snapshot.tier} |`);
  lines.push(
    `| CLV coverage | ${formatPercent(snapshot.clvCoveragePercent)} |`,
  );
  lines.push(
    `| Note | Rows with stake_units IS NULL are labeled historical_unknown and excluded from ROI |`,
  );
  lines.push('');
  lines.push('## By Sport');
  lines.push(
    '| Sport | Settled | Stake-known | Unknown stake | Wins | Win% | Losses | Risked | Net | ROI (stake-based) | CLV coverage |',
  );
  lines.push(
    '|-------|---------|-------------|---------------|------|------|--------|--------|-----|-------------------|-------------|',
  );

  for (const summary of buildSportSummaries(rows)) {
    lines.push(
      `| ${summary.sport} | ${summary.rows.length} | ${summary.knownStakeRows.length} | ${summary.rows.length - summary.knownStakeRows.length} | ${summary.wins} | ${pct(summary.wins, summary.rows.length)} | ${summary.losses} | ${summary.riskedUnits.toFixed(2)}u | ${formatUnits(summary.profitUnits)} | ${formatPercent(summary.roiPercent)} | ${pct(summary.clvComputed, summary.rows.length)} |`,
    );
  }

  const markets = [
    ...new Set(
      rows
        .map((row) => row.marketType)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  if (markets.length > 0) {
    lines.push('');
    lines.push('## By Market Type');
    lines.push('| Market | Settled | Stake-known | Win% | ROI (stake-based) |');
    lines.push('|--------|---------|-------------|------|-------------------|');
    for (const market of markets) {
      const marketRows = rows.filter((row) => row.marketType === market);
      lines.push(
        `| ${market} | ${marketRows.length} | ${marketRows.filter(hasMeasurableStake).length} | ${pct(marketRows.filter((row) => row.result === 'win').length, marketRows.length)} | ${formatPercent(computeRoiPercent(marketRows))} |`,
      );
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push(
    `- Data window: ${afterDate} onwards (post-UTV2-877 scorer fix merged 2026-05-10)`,
  );
  lines.push(
    '- Band data not available here; use band-specific reports when band persistence is required',
  );
  lines.push(
    '- Market type data may be sparse; marketTypeId is not consistently present in picks.metadata',
  );
  lines.push(
    '- ROI uses persisted picks.stake_units and persisted pick odds; no flat -110 fallback is used',
  );
  lines.push(
    '- Observable model edge tier applies only measurable real-edge-backed N, ROI, and CLV coverage gates from MODEL_EDGE_ACCEPTANCE_STANDARD.md when --real-edge-only is used; statistical proof gates must be reviewed separately',
  );
  lines.push(
    '- Run with --after=2026-05-17 on that date for 7-day post-fix window',
  );

  return lines.join('\n');
}

export function printMonitorReport(
  result: ModelPerformanceMonitorResult,
): string {
  const { snapshot, previousSnapshot, alerts } = result;
  const lines: string[] = [];

  lines.push('=== Model Performance Monitor ===');
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`Query window: settled_at >= ${snapshot.afterDate}`);
  lines.push(`Current tier: ${snapshot.tier}`);
  lines.push(`Previous tier: ${previousSnapshot?.tier ?? 'none'}`);
  lines.push(`Settled rows: ${snapshot.settledRows}`);
  lines.push(`Stake-known rows: ${snapshot.stakeKnownRows}`);
  lines.push(`ROI: ${formatPercent(snapshot.roiPercent)}`);
  lines.push(`CLV coverage: ${formatPercent(snapshot.clvCoveragePercent)}`);
  lines.push('');
  lines.push('## Alerts');
  if (alerts.length === 0) {
    lines.push('- none');
  } else {
    for (const alert of alerts) {
      lines.push(`- [${alert.severity}] ${alert.reason}: ${alert.message}`);
    }
  }
  lines.push('');
  lines.push('## Notes');
  for (const note of snapshot.notes) lines.push(`- ${note}`);

  return lines.join('\n');
}

function hasMeasurableStake(
  row: RoiBySportRow,
): row is RoiBySportRow & { stakeUnits: number } {
  return (
    typeof row.stakeUnits === 'number' &&
    Number.isFinite(row.stakeUnits) &&
    row.stakeUnits > 0
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNestedString(
  record: Record<string, unknown> | null,
  path: string[],
): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return readString(current);
}

export function resolveEdgeSourceSplit(
  metadata: Record<string, unknown> | null,
  promotionPayload: Record<string, unknown> | null,
): EdgeSourceSplit {
  const scoreInputs = asRecord(promotionPayload?.['scoreInputs']);
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
  const edgeSourceQuality = readNestedString(scoreInputs, [
    'edgeSourceQuality',
  ]);

  if (
    edgeMethod === 'market-devigged' ||
    edgeSourceQuality === 'market-backed' ||
    ['real-edge', 'consensus-edge', 'sgo-edge', 'single-book-edge'].includes(
      edgeSource ?? '',
    ) ||
    ['pinnacle', 'consensus', 'sgo', 'single-book'].includes(
      providerCoverageState ?? '',
    )
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

function readStringFlag(name: string): string | null {
  const value = process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')[1];
  return value && value.length > 0 ? value : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function readPreviousSnapshot(
  stateFile: string | null,
): ModelPerformanceSnapshot | null {
  if (!stateFile || !existsSync(stateFile)) return null;
  const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as unknown;
  return isSnapshot(parsed) ? parsed : null;
}

function writeSnapshot(
  stateFile: string,
  snapshot: ModelPerformanceSnapshot,
): void {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function isSnapshot(value: unknown): value is ModelPerformanceSnapshot {
  const record = asRecord(value);
  return (
    Boolean(record) &&
    typeof record?.['generatedAt'] === 'string' &&
    typeof record?.['afterDate'] === 'string' &&
    isModelEdgeTier(record?.['tier']) &&
    typeof record?.['settledRows'] === 'number' &&
    typeof record?.['stakeKnownRows'] === 'number' &&
    typeof record?.['historicalUnknownStakeRows'] === 'number' &&
    typeof record?.['riskedUnits'] === 'number' &&
    typeof record?.['profitUnits'] === 'number' &&
    (typeof record?.['roiPercent'] === 'number' ||
      record?.['roiPercent'] === null) &&
    typeof record?.['wins'] === 'number' &&
    typeof record?.['losses'] === 'number' &&
    typeof record?.['pushes'] === 'number' &&
    (typeof record?.['clvCoveragePercent'] === 'number' ||
      record?.['clvCoveragePercent'] === null) &&
    Array.isArray(record?.['notes'])
  );
}

function isModelEdgeTier(value: unknown): value is ModelEdgeTier {
  return (
    value === 'UNPROVEN' ||
    value === 'DEVELOPING' ||
    value === 'STRONG' ||
    value === 'ELITE'
  );
}

function tierRank(tier: ModelEdgeTier): number {
  if (tier === 'ELITE') return 3;
  if (tier === 'STRONG') return 2;
  if (tier === 'DEVELOPING') return 1;
  return 0;
}

function crossedBoundary(
  previous: number,
  current: number,
  boundary: number,
): boolean {
  return (
    (previous < boundary && current >= boundary) ||
    (previous >= boundary && current < boundary)
  );
}

async function main() {
  const afterArg = readStringFlag('after');
  const afterDate = afterArg ?? '2026-05-10';
  const stateFile = readStringFlag('state-file');
  const monitorJson = hasFlag('monitor-json');
  const monitor = hasFlag('monitor') || monitorJson || stateFile !== null;
  const realEdgeOnly = hasFlag('real-edge-only');
  const fetchedRows = await fetchRows(afterDate);
  const rows = realEdgeOnly ? filterRealEdgeBackedRows(fetchedRows) : fetchedRows;
  if (!monitor) {
    console.log(printReport(rows, afterDate, new Date().toISOString(), { realEdgeOnly }));
    return;
  }

  const result = buildMonitorResult(
    rows,
    afterDate,
    readPreviousSnapshot(stateFile),
  );
  if (stateFile) writeSnapshot(stateFile, result.snapshot);
  console.log(
    monitorJson ? JSON.stringify(result, null, 2) : printMonitorReport(result),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
