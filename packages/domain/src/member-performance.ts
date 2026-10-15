/** Pure public performance math. Callers must first prove public delivery eligibility. */
export interface MemberPerformanceSettlement {
  id: string;
  pick_id: string;
  corrects_id: string | null;
  created_at: string;
  settled_at: string;
  status: string;
  result: string | null;
  confidence: string;
  stake_units: number | null;
  payload: unknown;
}
export interface PublicPerformanceRecord {
  pickId: string;
  capperId: string;
  capperName: string;
  sport: string | null;
  odds: number | null;
  stakeUnits: number | null;
  settlement: MemberPerformanceSettlement;
}
export interface MemberPerformanceOptions {
  window: 7 | 14 | 30 | 90;
  sport: string | null;
  capper: string | null;
  limit: number;
  minPicks: number;
  observedAt: string;
}
export interface MemberPerformanceStats {
  scope: 'capper' | 'server';
  capper: string | null;
  window: 7 | 14 | 30 | 90;
  sport: string | null;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  beatsLine: number | null;
  picksWithClv: number;
  lastFive: Array<'W' | 'L' | 'P'>;
}
export interface MemberPerformanceLeaderboardEntry {
  rank: number;
  capper: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  roiPct: number | null;
  avgClvPct: number | null;
  streak: number;
}
export interface MemberPerformanceLeaderboard {
  window: 7 | 14 | 30 | 90;
  sport: string | null;
  minPicks: number;
  entries: MemberPerformanceLeaderboardEntry[];
  observedAt: string;
}
const results = new Set(['win', 'loss', 'push', 'void', 'cancelled']);
function timestamp(value: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant))
    throw new Error('Invalid performance timestamp');
  return instant;
}
function validateSettlement(
  row: MemberPerformanceSettlement,
  pickId: string,
): void {
  if (
    !row.id ||
    row.pick_id !== pickId ||
    row.status !== 'settled' ||
    row.confidence !== 'confirmed' ||
    !results.has(row.result ?? '')
  ) {
    throw new Error('Unverified public performance settlement');
  }
  timestamp(row.created_at);
  timestamp(row.settled_at);
}
/** Refuses partial, branched or unverified histories rather than selecting by newest date. */
export function resolvePublicPerformanceSettlement(
  pickId: string,
  settlementRows: readonly MemberPerformanceSettlement[],
): MemberPerformanceSettlement {
  const byId = new Map<string, MemberPerformanceSettlement>();
  const children = new Map<string, MemberPerformanceSettlement>();
  for (const row of settlementRows) {
    validateSettlement(row, pickId);
    if (byId.has(row.id)) throw new Error('Duplicate settlement identity');
    byId.set(row.id, row);
    if (row.corrects_id !== null) {
      if (children.has(row.corrects_id))
        throw new Error('Branched settlement correction');
      children.set(row.corrects_id, row);
    }
  }
  const roots = settlementRows.filter((row) => row.corrects_id === null);
  if (roots.length !== 1)
    throw new Error('Incomplete settlement correction root');
  for (const row of settlementRows) {
    if (row.corrects_id !== null) {
      const parent = byId.get(row.corrects_id);
      if (!parent) throw new Error('Missing settlement correction link');
      if (
        timestamp(row.created_at) < timestamp(parent.created_at) ||
        timestamp(row.settled_at) < timestamp(parent.settled_at)
      ) {
        throw new Error('Nonchronological settlement correction');
      }
    }
  }
  let effective = roots[0]!;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(effective.id))
      throw new Error('Cyclic settlement correction');
    visited.add(effective.id);
    const next = children.get(effective.id);
    if (!next) break;
    effective = next;
  }
  if (visited.size !== settlementRows.length)
    throw new Error('Disconnected settlement correction');
  return effective;
}
function fold(value: string): string {
  return value.trim().toLowerCase();
}
function decided(record: PublicPerformanceRecord): boolean {
  return (
    record.settlement.result === 'win' || record.settlement.result === 'loss'
  );
}
function summarize(records: readonly PublicPerformanceRecord[]) {
  const wins = records.filter((r) => r.settlement.result === 'win').length;
  const losses = records.filter((r) => r.settlement.result === 'loss').length;
  const pushes = records.filter((r) => r.settlement.result === 'push').length;
  let priced = true;
  let net = 0;
  let stake = 0;
  for (const record of records.filter(decided)) {
    const units = record.stakeUnits;
    const odds = record.odds;
    if (
      units === null ||
      !Number.isFinite(units) ||
      units <= 0 ||
      odds === null ||
      !Number.isFinite(odds) ||
      Math.abs(odds) < 100 ||
      (record.settlement.stake_units !== null &&
        record.settlement.stake_units !== units)
    ) {
      priced = false;
      continue;
    }
    stake += units;
    net +=
      record.settlement.result === 'loss'
        ? -units
        : units * (odds > 0 ? odds / 100 : 100 / Math.abs(odds));
  }
  if (!Number.isFinite(net) || !Number.isFinite(stake))
    throw new Error('Performance arithmetic overflow');
  const roiPct = priced && stake > 0 ? (net / stake) * 100 : null;
  if (roiPct !== null && !Number.isFinite(roiPct))
    throw new Error('Performance arithmetic overflow');
  return {
    picks: records.length,
    wins,
    losses,
    pushes,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    roiPct,
    avgClvPct: null,
    beatsLine: null,
    picksWithClv: 0,
  };
}
function streak(records: readonly PublicPerformanceRecord[]): number {
  const last = records.at(-1)?.settlement.result;
  if (last !== 'win' && last !== 'loss') return 0;
  let count = 0;
  for (let index = records.length - 1; index >= 0; index--) {
    if (records[index]!.settlement.result !== last) break;
    count++;
  }
  return last === 'win' ? count : -count;
}
/** Aggregates verified records without returning their identities, payloads or private fields. */
export function aggregateMemberPerformance(
  records: readonly PublicPerformanceRecord[],
  options: MemberPerformanceOptions,
): {
  stats: MemberPerformanceStats;
  leaderboard: MemberPerformanceLeaderboard;
} {
  const observed = timestamp(options.observedAt);
  if (
    ![7, 14, 30, 90].includes(options.window) ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 25 ||
    !Number.isInteger(options.minPicks) ||
    options.minPicks < 1
  ) {
    throw new Error('Invalid performance options');
  }
  const identities = new Set<string>();
  const labels = new Map<string, string>();
  for (const record of records) {
    validateSettlement(record.settlement, record.pickId);
    if (
      !record.pickId ||
      !record.capperId.trim() ||
      !record.capperName.trim() ||
      identities.has(record.pickId)
    ) {
      throw new Error('Invalid or duplicate public performance identity');
    }
    identities.add(record.pickId);
    const label = labels.get(record.capperId);
    if (label !== undefined && label !== record.capperName)
      throw new Error('Inconsistent canonical capper label');
    labels.set(record.capperId, record.capperName);
  }
  const lower = observed - options.window * 86_400_000;
  const selected = records
    .filter((record) => {
      const settled = timestamp(record.settlement.settled_at);
      return (
        settled >= lower &&
        settled <= observed &&
        (options.sport === null ||
          fold(record.sport ?? '') === fold(options.sport))
      );
    })
    .slice()
    .sort(
      (a, b) =>
        timestamp(a.settlement.settled_at) -
          timestamp(b.settlement.settled_at) ||
        (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0),
    );
  let capperId: string | null = null;
  if (options.capper !== null) {
    const matches = [...labels].filter(
      ([id, name]) =>
        fold(id) === fold(options.capper!) ||
        fold(name) === fold(options.capper!),
    );
    if (matches.length > 1)
      throw new Error('Ambiguous canonical capper filter');
    capperId = matches[0]?.[0] ?? null;
  }
  const statsRecords =
    options.capper === null
      ? selected
      : selected.filter((r) => r.capperId === capperId);
  const lastFive: Array<'W' | 'L' | 'P'> = statsRecords
    .flatMap(
      (record): Array<'W' | 'L' | 'P'> =>
        record.settlement.result === 'win'
          ? ['W']
          : record.settlement.result === 'loss'
            ? ['L']
            : record.settlement.result === 'push'
              ? ['P']
              : [],
    )
    .slice(-5);
  const stats: MemberPerformanceStats = {
    scope: options.capper === null ? 'server' : 'capper',
    capper:
      options.capper === null
        ? null
        : capperId === null
          ? options.capper
          : labels.get(capperId)!,
    window: options.window,
    sport: options.sport,
    ...summarize(statsRecords),
    lastFive,
  };
  const groups = new Map<string, PublicPerformanceRecord[]>();
  for (const record of selected) {
    const group = groups.get(record.capperId) ?? [];
    group.push(record);
    groups.set(record.capperId, group);
  }
  const ranked = [...groups]
    .map(([id, group]) => ({ id, group, summary: summarize(group) }))
    .filter(
      ({ summary }) =>
        summary.wins + summary.losses + summary.pushes >= options.minPicks,
    )
    .sort(
      (a, b) =>
        (b.summary.winRate ?? -1) - (a.summary.winRate ?? -1) ||
        (a.summary.roiPct === b.summary.roiPct
          ? 0
          : a.summary.roiPct === null
            ? 1
            : b.summary.roiPct === null
              ? -1
              : b.summary.roiPct - a.summary.roiPct) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const entries = ranked
    .slice(0, options.limit)
    .map(({ id, group, summary }, index) => ({
      rank: index + 1,
      capper: labels.get(id)!,
      picks: summary.picks,
      wins: summary.wins,
      losses: summary.losses,
      pushes: summary.pushes,
      winRate: summary.winRate,
      roiPct: summary.roiPct,
      avgClvPct: null,
      streak: streak(group),
    }));
  return {
    stats,
    leaderboard: {
      window: options.window,
      sport: options.sport,
      minPicks: options.minPicks,
      entries,
      observedAt: options.observedAt,
    },
  };
}
