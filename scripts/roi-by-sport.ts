#!/usr/bin/env tsx
/**
 * UTV2-998: stake-based ROI / Win-Rate per Sport.
 *
 * Historical rows with missing stake_units are labeled and excluded from ROI.
 *
 * Usage: tsx scripts/roi-by-sport.ts [--after=YYYY-MM-DD]
 */
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { fileURLToPath } from 'node:url';

export interface RoiBySportRow {
  result: string | null;
  sport: string | null;
  marketType: string | null;
  odds: number | null;
  stakeUnits: number | null;
  clvStatus: string | null;
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

export function summarizeStakeIntegrity(rows: RoiBySportRow[]): StakeIntegritySummary {
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

  if (typeof row.odds === 'number' && Number.isFinite(row.odds) && row.odds !== 0) {
    return row.odds > 0
      ? round2(row.stakeUnits * (row.odds / 100))
      : round2(row.stakeUnits * (100 / Math.abs(row.odds)));
  }

  return row.stakeUnits;
}

export function computeRoiPercent(rows: RoiBySportRow[]): number | null {
  const knownStakeRows = rows.filter((row) => hasMeasurableStake(row) && row.result !== 'push');
  const riskedUnits = knownStakeRows.reduce((sum, row) => sum + row.stakeUnits, 0);
  if (riskedUnits <= 0) return null;

  const profitUnits = knownStakeRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0);
  return (profitUnits / riskedUnits) * 100;
}

export function buildSportSummaries(rows: RoiBySportRow[]): SportSummary[] {
  const sports = [...new Set(rows.map((row) => row.sport ?? 'unknown'))].sort();
  return sports.map((sport) => {
    const sportRows = rows.filter((row) => (row.sport ?? 'unknown') === sport);
    const knownStakeRows = sportRows.filter(hasMeasurableStake);
    const riskRows = knownStakeRows.filter((row) => row.result !== 'push');
    const riskedUnits = round2(riskRows.reduce((sum, row) => sum + row.stakeUnits, 0));
    const profitUnits = round2(riskRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0));

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
      clvComputed: sportRows.filter((row) => row.clvStatus === 'computed').length,
    };
  });
}

async function fetchRows(afterDate: string): Promise<RoiBySportRow[]> {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  const { data, error } = await client
    .from('settlement_records')
    .select(`
      result,
      payload,
      settled_at,
      picks!inner(stake_units, odds, metadata)
    `)
    .gte('settled_at', afterDate)
    .is('corrects_id', null);

  if (error) {
    throw new Error(`Failed to fetch settled ROI rows: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const pick = Array.isArray(row.picks) ? row.picks[0] : row.picks;
    const metadata = asRecord(pick?.metadata);
    const payload = asRecord(row.payload);
    return {
      result: typeof row.result === 'string' ? row.result : null,
      sport: typeof metadata?.['sport'] === 'string' ? metadata['sport'] : null,
      marketType: typeof metadata?.['marketTypeId'] === 'string'
        ? metadata['marketTypeId']
        : typeof metadata?.['marketType'] === 'string'
          ? metadata['marketType']
          : null,
      odds: readNumber(pick?.odds),
      stakeUnits: readNumber(pick?.stake_units),
      clvStatus: typeof payload?.['clvStatus'] === 'string' ? payload['clvStatus'] : null,
      settledAt: row.settled_at,
    };
  });
}

export function printReport(rows: RoiBySportRow[], afterDate: string, generatedAt = new Date().toISOString()): string {
  const lines: string[] = [];
  const total = rows.length;
  const wins = rows.filter((row) => row.result === 'win').length;
  const losses = rows.filter((row) => row.result === 'loss').length;
  const pushes = rows.filter((row) => row.result === 'push').length;
  const knownRows = rows.filter(hasMeasurableStake);
  const riskRows = knownRows.filter((row) => row.result !== 'push');
  const totalRisked = round2(riskRows.reduce((sum, row) => sum + row.stakeUnits, 0));
  const netUnits = round2(riskRows.reduce((sum, row) => sum + (computeProfitUnits(row) ?? 0), 0));
  const stakeIntegrity = summarizeStakeIntegrity(rows);
  const roiPercent = totalRisked > 0 ? (netUnits / totalRisked) * 100 : null;

  lines.push('=== ROI / Win-Rate by Sport ===');
  lines.push(`Query window: settled_at >= ${afterDate}`);
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('## Overall (all sports)');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total settled | ${total} |`);
  lines.push(`| Wins | ${wins} (${pct(wins, total)}) |`);
  lines.push(`| Losses | ${losses} (${pct(losses, total)}) |`);
  lines.push(`| Pushes | ${pushes} |`);
  lines.push(`| Stake-known rows | ${stakeIntegrity.canonicalStakeRows} |`);
  lines.push(`| Historical unknown-stake rows | ${stakeIntegrity.historicalUnknownStakeRows} |`);
  lines.push(`| Total risked | ${totalRisked.toFixed(2)}u |`);
  lines.push(`| Net units | ${formatUnits(netUnits)} |`);
  lines.push(`| ROI (stake-based) | ${formatPercent(roiPercent)} |`);
  lines.push(`| Note | Rows with stake_units IS NULL are labeled historical_unknown and excluded from ROI |`);
  lines.push('');
  lines.push('## By Sport');
  lines.push('| Sport | Settled | Stake-known | Unknown stake | Wins | Win% | Losses | Risked | Net | ROI (stake-based) | CLV coverage |');
  lines.push('|-------|---------|-------------|---------------|------|------|--------|--------|-----|-------------------|-------------|');

  for (const summary of buildSportSummaries(rows)) {
    lines.push(
      `| ${summary.sport} | ${summary.rows.length} | ${summary.knownStakeRows.length} | ${summary.rows.length - summary.knownStakeRows.length} | ${summary.wins} | ${pct(summary.wins, summary.rows.length)} | ${summary.losses} | ${summary.riskedUnits.toFixed(2)}u | ${formatUnits(summary.profitUnits)} | ${formatPercent(summary.roiPercent)} | ${pct(summary.clvComputed, summary.rows.length)} |`,
    );
  }

  const markets = [...new Set(rows.map((row) => row.marketType).filter((value): value is string => Boolean(value)))].sort();
  if (markets.length > 0) {
    lines.push('');
    lines.push('## By Market Type');
    lines.push('| Market | Settled | Stake-known | Win% | ROI (stake-based) |');
    lines.push('|--------|---------|-------------|------|-------------------|');
    for (const market of markets) {
      const marketRows = rows.filter((row) => row.marketType === market);
      lines.push(`| ${market} | ${marketRows.length} | ${marketRows.filter(hasMeasurableStake).length} | ${pct(marketRows.filter((row) => row.result === 'win').length, marketRows.length)} | ${formatPercent(computeRoiPercent(marketRows))} |`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push(`- Data window: ${afterDate} onwards (post-UTV2-877 scorer fix merged 2026-05-10)`);
  lines.push('- Band data not available here; use band-specific reports when band persistence is required');
  lines.push('- Market type data may be sparse; marketTypeId is not consistently present in picks.metadata');
  lines.push('- ROI uses persisted picks.stake_units and persisted pick odds; no flat -110 fallback is used');
  lines.push('- Run with --after=2026-05-17 on that date for 7-day post-fix window');

  return lines.join('\n');
}

function hasMeasurableStake(row: RoiBySportRow): row is RoiBySportRow & { stakeUnits: number } {
  return typeof row.stakeUnits === 'number' && Number.isFinite(row.stakeUnits) && row.stakeUnits > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function main() {
  const afterArg = process.argv.find((arg) => arg.startsWith('--after='))?.split('=')[1];
  const afterDate = afterArg ?? '2026-05-10';
  const rows = await fetchRows(afterDate);
  console.log(printReport(rows, afterDate));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
