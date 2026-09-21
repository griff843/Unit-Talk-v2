import { computeStats, pickProfitUnits, type Stats } from './analytics';
import { getPerformanceCohort, type PerformancePick } from './performance-cohort';

type Row = Record<string, unknown>;
export interface OperatorPerformanceStats extends Stats {
  voids: number;
  cancelled: number;
  unsettled: number;
  unitsReturned: number | null;
  refundUnits: number | null;
  unpricedRefunds: number;
  rateSample: number;
  flatBetRoiPct: number | null;
  flatBetSample: number;
  corrections: number;
  submissions: number;
  firstSubmittedAt: string | null;
  lastSubmittedAt: string | null;
}
export interface OperatorPerformanceGroup {
  id: string;
  name: string;
  stats: OperatorPerformanceStats;
  modes: Array<{ mode: string; count: number }>;
}
export interface OperatorPerformance {
  observedAt: string;
  windowDays: number | null;
  aggregate: OperatorPerformanceStats;
  cappers: OperatorPerformanceGroup[];
  modes: OperatorPerformanceGroup[];
}

export function summarizeOperatorPerformance(rows: Row[]): OperatorPerformanceStats {
  const stats = computeStats(rows);
  const decided = rows.filter((row) => ['win', 'loss', 'push'].includes(String(row.result)));
  const refunds = rows.filter((row) => row.result === 'void' || row.result === 'cancelled');
  const knownRefunds = refunds.filter((row) => typeof row.stake_units === 'number' && Number.isFinite(row.stake_units) && row.stake_units > 0);
  const flatRows = decided.filter((row) => pickProfitUnits(row.result as 'win' | 'loss' | 'push', row.odds, 1) !== null);
  const flatStats = computeStats(flatRows.map((row) => ({ ...row, stake_units: 1 })));
  const dates = rows.map((row) => row.created_at).filter((value): value is string => typeof value === 'string').sort();
  return {
    ...stats,
    voids: rows.filter((row) => row.result === 'void').length,
    cancelled: rows.filter((row) => row.result === 'cancelled').length,
    unsettled: rows.filter((row) => row.result === null).length,
    unitsReturned: stats.unitsStaked === null || stats.unitsNet === null ? null : Math.round((stats.unitsStaked + stats.unitsNet) * 10_000) / 10_000,
    refundUnits: knownRefunds.length > 0 ? knownRefunds.reduce((sum, row) => sum + Number(row.stake_units), 0) : refunds.length === 0 ? 0 : null,
    unpricedRefunds: refunds.length - knownRefunds.length,
    rateSample: stats.wins + stats.losses,
    flatBetRoiPct: flatStats.roiPct,
    flatBetSample: flatStats.settled,
    corrections: rows.reduce((sum, row) => sum + Number(row.corrections ?? 0), 0),
    submissions: rows.filter((row) => row.submittedInWindow === true).length,
    firstSubmittedAt: dates[0] ?? null,
    lastSubmittedAt: dates.at(-1) ?? null,
  };
}

function metadata(pick: PerformancePick): Row {
  return pick.metadata !== null && typeof pick.metadata === 'object' && !Array.isArray(pick.metadata) ? pick.metadata : {};
}
function modeCounts(rows: Row[]) {
  const modes = new Map<string, number>();
  for (const row of rows) modes.set(String(row.mode), (modes.get(String(row.mode)) ?? 0) + 1);
  return [...modes].map(([mode, count]) => ({ mode, count }));
}

export async function getOperatorPerformance(windowDays: number | null): Promise<OperatorPerformance> {
  const cohort = await getPerformanceCohort();
  const cutoff = windowDays === null ? null : new Date(Date.parse(cohort.observedAt) - windowDays * 86_400_000).toISOString();
  const settlementByPick = new Map(cohort.settlements.map((record) => [record.pick_id, record]));
  const rows: Row[] = cohort.picks.flatMap((pick) => {
    const record = settlementByPick.get(pick.id ?? '');
    const result = record?.status === 'settled' ? record.result : null;
    if (result !== null && !['win', 'loss', 'push', 'void', 'cancelled'].includes(result)) {
      throw new Error('Performance settlement result is unsupported');
    }
    const recordedAt = result === null ? pick.created_at : record?.settled_at;
    if (cutoff !== null && (!recordedAt || recordedAt < cutoff)) return [];
    return [{
      ...pick, result, payload: record?.payload ?? {},
      mode: typeof metadata(pick).distributionMode === 'string' ? metadata(pick).distributionMode : 'not-recorded',
      corrections: cohort.correctionCounts.get(pick.id ?? '') ?? 0,
      submittedInWindow: cutoff === null || (pick.created_at !== null && pick.created_at >= cutoff),
    }];
  });
  const grouped = (key: 'capper_id' | 'mode'): OperatorPerformanceGroup[] => {
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const id = typeof row[key] === 'string' && row[key] ? String(row[key]) : 'unassigned';
      const group = groups.get(id) ?? [];
      group.push(row);
      groups.set(id, group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, group]) => ({
      id,
      name: key === 'capper_id' ? id === 'unassigned' ? 'No capper assigned' : String(group[0]?.capper_display_name ?? id) : id,
      stats: summarizeOperatorPerformance(group), modes: modeCounts(group),
    }));
  };
  const aggregate = summarizeOperatorPerformance(rows);
  const cappers = grouped('capper_id');
  for (const key of ['total', 'wins', 'losses', 'pushes', 'voids', 'cancelled', 'unsettled', 'corrections'] as const) {
    if (cappers.reduce((sum, capper) => sum + capper.stats[key], 0) !== aggregate[key]) {
      throw new Error('Performance capper partitions do not reconcile');
    }
  }
  for (const key of ['unitsStaked', 'unitsNet', 'unitsReturned'] as const) {
    const sum = cappers.reduce((total, capper) => total + (capper.stats[key] ?? 0), 0);
    if (Math.abs(sum - (aggregate[key] ?? 0)) > Math.max(0.0001, cappers.length * 0.0001)) {
      throw new Error('Performance capper units do not reconcile');
    }
  }
  return { observedAt: cohort.observedAt, windowDays, aggregate, cappers, modes: grouped('mode') };
}
