/**
 * Model performance analytics service — UTV2-798.
 *
 * Joins posted picks → settlements → CLV outcomes to produce a calibration
 * report. Output is CALIBRATION EVIDENCE ONLY; never a scoring input.
 *
 * Design notes:
 * - model_score / model_tier / model_confidence are read from pick.metadata.
 *   These fields are nullable and not production-trusted; their presence is
 *   tracked as a coverage gap signal, not a quality gate.
 * - No new DB tables are created. All data comes from existing repositories.
 * - CLV data lives in settlement_records.payload.clvPercent (same path used
 *   by clv-feedback.ts and analytics.ts).
 */

import type { PickRepository, SettlementRecord, SettlementRepository } from '@unit-talk/db';
import { resolveEffectiveSettlement, type SettlementInput } from '@unit-talk/domain';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ModelPerformanceFilters {
  sport?: string | undefined;
  tier?: string | undefined;
  dateRange?: { from: Date; to: Date } | undefined;
}

export interface TierPerformanceBucket {
  /** model_tier read from pick.metadata — null if not set */
  tier: string | null;
  totalPicks: number;
  settledPicks: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  avgClv: number | null;
  avgModelScore: number | null;
}

export interface SportMarketBreakdown {
  sportKey: string;
  marketKeyFamily: string;
  totalPicks: number;
  settledPicks: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgClv: number | null;
}

export interface ChampionModelCoverage {
  totalPicks: number;
  withModelConfidence: number;
  withoutModelConfidence: number;
  coverageRate: number | null;
  missingGapCount: number;
}

export interface StaleBucket {
  stalePicks: number;
  settledStalePicks: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgClv: number | null;
}

export interface ModelPerformanceReport {
  /**
   * WARNING: this report is calibration evidence only — model_score /
   * model_tier / model_confidence are NOT production-trusted inputs.
   */
  calibrationNotice: 'CALIBRATION_EVIDENCE_ONLY';
  generatedAt: string;
  totalPostedPicks: number;
  totalSettledPicks: number;
  /** Picks whose market string is empty and cannot be classified. Excluded from breakdown buckets. */
  unknownMarketPickCount: number;
  /**
   * Picks with settlement records whose correction chain does not resolve to one
   * effective record (an orphan correction, two roots, two corrections of one
   * record, a cycle). They are not counted as settled -- and are counted here so
   * the exclusion is never silent.
   */
  unresolvedSettlementPickCount: number;
  filters: {
    sport: string | null;
    tier: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  };
  tierPerformance: TierPerformanceBucket[];
  sportMarketBreakdown: SportMarketBreakdown[];
  championModelCoverage: ChampionModelCoverage;
  staleBucket: StaleBucket;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Derives a coarse market key family from a pick's market string.
 * Example: 'player_points_ou' → 'player_points', 'nba_winner' → 'nba'
 */
function deriveMarketFamily(market: string): string {
  // Strip trailing _ou / _over / _under / _ml / _spread suffixes
  return market
    .replace(/_ou$/, '')
    .replace(/_over$/, '')
    .replace(/_under$/, '')
    .replace(/_ml$/, '')
    .replace(/_spread$/, '');
}

/** A correction chain is complete when every `corrects_id` targets a row in the set. */
function isChainComplete(rows: SettlementRecord[]): boolean {
  const ids = new Set(rows.map((row) => row.id));
  return rows.every((row) => row.corrects_id === null || ids.has(row.corrects_id));
}

/**
 * The effective settlement record for one pick: the tip of its correction chain
 * (`corrects_id` -> prior record), never the root. Returns null -- fail closed --
 * when the chain does not resolve to exactly one path covering every row.
 */
function resolveEffectiveRecord(rows: SettlementRecord[]): SettlementRecord | null {
  if (!isChainComplete(rows)) return null;
  if (rows.some((row) => row.status !== 'settled' && row.status !== 'manual_review')) return null;
  const resolved = resolveEffectiveSettlement(
    rows.map(
      (row): SettlementInput => ({
        id: row.id,
        pick_id: row.pick_id,
        status: row.status as SettlementInput['status'],
        result: row.result,
        confidence: row.confidence,
        corrects_id: row.corrects_id,
        settled_at: row.settled_at,
      }),
    ),
  );
  if (!resolved.ok || resolved.settlement.correction_depth + 1 !== rows.length) return null;
  return rows.find((row) => row.id === resolved.settlement.effective_record_id) ?? null;
}

// ---------------------------------------------------------------------------
// Core report function
// ---------------------------------------------------------------------------

export async function getModelPerformanceReport(
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
  },
  filters?: ModelPerformanceFilters,
): Promise<ModelPerformanceReport> {
  // Resolve filter params
  const filterSport = filters?.sport ?? null;
  const filterTier = filters?.tier ?? null;
  const filterFrom = filters?.dateRange?.from ?? null;
  const filterTo = filters?.dateRange?.to ?? null;
  const filterFromIso = filterFrom?.toISOString() ?? null;
  const filterToIso = filterTo?.toISOString() ?? null;

  // 1. Load all settled picks
  const settledPicks = await repositories.picks.listByLifecycleState('settled', 2000);

  // Apply optional date filter on pick.created_at
  const dateFilteredPicks = settledPicks.filter((p) => {
    if (filterFromIso && p.created_at < filterFromIso) return false;
    if (filterToIso && p.created_at > filterToIso) return false;
    return true;
  });

  // Apply sport filter via metadata
  const sportFilteredPicks = filterSport
    ? dateFilteredPicks.filter((p) => {
        const metadata = asRecord(p.metadata);
        const sport = readString(metadata['sport'] ?? metadata['league']);
        return sport === filterSport;
      })
    : dateFilteredPicks;

  // Apply model_tier filter via metadata
  const filteredPicks = filterTier
    ? sportFilteredPicks.filter((p) => {
        const metadata = asRecord(p.metadata);
        const tier = readString(metadata['model_tier'] ?? metadata['tier']);
        return tier === filterTier;
      })
    : sportFilteredPicks;

  // 2. Load latest settlement for each pick
  // Group by pick id — settlement_records.pick_id FK
  // We load recent settlements (generous limit) and key by pick_id
  // Enforce a 30-day lower bound to avoid full-table ORDER BY scan (UTV2-1355)
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentSettlements = await repositories.settlements.listRecent(5000, since30d);

  // Build a map: pick_id → effective settlement. A pick's result is the tip of
  // its correction chain, never the root: keeping only corrects_id-null rows
  // reported every corrected pick with its superseded result and CLV. A chain
  // whose root predates the read window is completed from the pick's full
  // history; one that still does not resolve is excluded and counted.
  const rowsByPick = new Map<string, SettlementRecord[]>();
  for (const sr of recentSettlements) {
    const group = rowsByPick.get(sr.pick_id);
    if (group) group.push(sr);
    else rowsByPick.set(sr.pick_id, [sr]);
  }

  const reportedPickIds = new Set(filteredPicks.map((p) => p.id));
  const settlementMap = new Map<string, SettlementRecord>();
  let unresolvedSettlementPickCount = 0;
  for (const [pickId, windowRows] of rowsByPick) {
    if (!reportedPickIds.has(pickId)) continue;
    const rows = isChainComplete(windowRows)
      ? windowRows
      : await repositories.settlements.listByPick(pickId);
    const effective = resolveEffectiveRecord(rows);
    if (effective === null) {
      unresolvedSettlementPickCount++;
      continue;
    }
    if (effective.status === 'settled') settlementMap.set(pickId, effective);
  }

  // 3. Build enriched rows
  interface EnrichedRow {
    pickId: string;
    sport: string | null;
    market: string;
    marketFamily: string;
    modelTier: string | null;
    modelScore: number | null;
    modelConfidence: number | null;
    isStale: boolean;
    settlement: (typeof recentSettlements)[0] | null;
    result: string | null;
    clvPercent: number | null;
  }

  const totalPostedPicks = filteredPicks.length;
  let totalSettledPicks = 0;
  let unknownMarketPickCount = 0;

  const enriched: EnrichedRow[] = filteredPicks.map((pick) => {
    const metadata = asRecord(pick.metadata);
    const sport = readString(metadata['sport'] ?? metadata['league']);
    const modelTier = readString(metadata['model_tier'] ?? metadata['tier']);
    const modelScore = readFiniteNumber(metadata['model_score']);
    const modelConfidence = readFiniteNumber(metadata['model_confidence'] ?? metadata['confidence']);
    const dataFreshness = readString(metadata['data_freshness']);
    const isStale = dataFreshness === 'stale';
    const market = typeof pick.market === 'string' ? pick.market : '';
    if (market === '') unknownMarketPickCount++;
    const marketFamily = deriveMarketFamily(market);

    const settlement = settlementMap.get(pick.id) ?? null;
    if (settlement) totalSettledPicks++;

    const payload = settlement ? asRecord(settlement.payload) : {};
    const clvPercent = settlement ? readFiniteNumber(payload['clvPercent']) : null;
    const result = settlement?.result ?? null;

    return {
      pickId: pick.id,
      sport,
      market,
      marketFamily,
      modelTier,
      modelScore,
      modelConfidence,
      isStale,
      settlement,
      result,
      clvPercent,
    };
  });

  // 4. Tier performance grouping
  const tierMap = new Map<string | null, EnrichedRow[]>();
  for (const row of enriched) {
    const key = row.modelTier;
    if (!tierMap.has(key)) tierMap.set(key, []);
    tierMap.get(key)!.push(row);
  }

  const tierPerformance: TierPerformanceBucket[] = [];
  for (const [tier, rows] of tierMap.entries()) {
    const settled = rows.filter((r) => r.settlement !== null);
    const wins = settled.filter((r) => r.result === 'win').length;
    const losses = settled.filter((r) => r.result === 'loss').length;
    const pushes = settled.filter((r) => r.result === 'push').length;
    const winDenominator = wins + losses;
    const winRate = winDenominator > 0 ? wins / winDenominator : null;

    const clvValues = settled.map((r) => r.clvPercent).filter((v): v is number => v !== null);
    const avgClv =
      clvValues.length > 0
        ? clvValues.reduce((s, v) => s + v, 0) / clvValues.length
        : null;

    const scoreValues = rows.map((r) => r.modelScore).filter((v): v is number => v !== null);
    const avgModelScore =
      scoreValues.length > 0
        ? scoreValues.reduce((s, v) => s + v, 0) / scoreValues.length
        : null;

    tierPerformance.push({
      tier,
      totalPicks: rows.length,
      settledPicks: settled.length,
      wins,
      losses,
      pushes,
      winRate,
      avgClv,
      avgModelScore,
    });
  }

  // Sort: named tiers first (T1, T2, T3 alphabetically), null tier last
  tierPerformance.sort((a, b) => {
    if (a.tier === null && b.tier !== null) return 1;
    if (a.tier !== null && b.tier === null) return -1;
    return (a.tier ?? '').localeCompare(b.tier ?? '');
  });

  // 5. Sport / market family breakdown (exclude picks with no market string)
  type SportMarketKey = `${string}::${string}`;
  const sportMarketMap = new Map<SportMarketKey, EnrichedRow[]>();

  for (const row of enriched.filter((r) => r.market !== '')) {
    const sportKey = row.sport ?? 'unknown';
    const key: SportMarketKey = `${sportKey}::${row.marketFamily}`;
    if (!sportMarketMap.has(key)) sportMarketMap.set(key, []);
    sportMarketMap.get(key)!.push(row);
  }

  const sportMarketBreakdown: SportMarketBreakdown[] = [];
  for (const [key, rows] of sportMarketMap.entries()) {
    const [sportKey, marketKeyFamily] = key.split('::') as [string, string];
    const settled = rows.filter((r) => r.settlement !== null);
    const wins = settled.filter((r) => r.result === 'win').length;
    const losses = settled.filter((r) => r.result === 'loss').length;
    const winDenominator = wins + losses;
    const winRate = winDenominator > 0 ? wins / winDenominator : null;
    const clvValues = settled.map((r) => r.clvPercent).filter((v): v is number => v !== null);
    const avgClv =
      clvValues.length > 0
        ? clvValues.reduce((s, v) => s + v, 0) / clvValues.length
        : null;

    sportMarketBreakdown.push({
      sportKey,
      marketKeyFamily,
      totalPicks: rows.length,
      settledPicks: settled.length,
      wins,
      losses,
      winRate,
      avgClv,
    });
  }

  // Sort by sport then market family
  sportMarketBreakdown.sort(
    (a, b) =>
      a.sportKey.localeCompare(b.sportKey) ||
      a.marketKeyFamily.localeCompare(b.marketKeyFamily),
  );

  // 6. Champion model coverage
  const withConfidence = enriched.filter((r) => r.modelConfidence !== null).length;
  const withoutConfidence = enriched.filter((r) => r.modelConfidence === null).length;
  const coverageRate =
    totalPostedPicks > 0 ? withConfidence / totalPostedPicks : null;

  const championModelCoverage: ChampionModelCoverage = {
    totalPicks: totalPostedPicks,
    withModelConfidence: withConfidence,
    withoutModelConfidence: withoutConfidence,
    coverageRate,
    missingGapCount: withoutConfidence,
  };

  // 7. Stale data bucket
  const staleRows = enriched.filter((r) => r.isStale);
  const staleSettled = staleRows.filter((r) => r.settlement !== null);
  const staleWins = staleSettled.filter((r) => r.result === 'win').length;
  const staleLosses = staleSettled.filter((r) => r.result === 'loss').length;
  const staleWinDenominator = staleWins + staleLosses;
  const staleWinRate = staleWinDenominator > 0 ? staleWins / staleWinDenominator : null;
  const staleClvValues = staleSettled
    .map((r) => r.clvPercent)
    .filter((v): v is number => v !== null);
  const staleAvgClv =
    staleClvValues.length > 0
      ? staleClvValues.reduce((s, v) => s + v, 0) / staleClvValues.length
      : null;

  const staleBucket: StaleBucket = {
    stalePicks: staleRows.length,
    settledStalePicks: staleSettled.length,
    wins: staleWins,
    losses: staleLosses,
    winRate: staleWinRate,
    avgClv: staleAvgClv,
  };

  return {
    calibrationNotice: 'CALIBRATION_EVIDENCE_ONLY',
    generatedAt: new Date().toISOString(),
    totalPostedPicks,
    totalSettledPicks,
    unknownMarketPickCount,
    unresolvedSettlementPickCount,
    filters: {
      sport: filterSport,
      tier: filterTier,
      dateFrom: filterFromIso,
      dateTo: filterToIso,
    },
    tierPerformance,
    sportMarketBreakdown,
    championModelCoverage,
    staleBucket,
  };
}
