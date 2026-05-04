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

import type { PickRepository, SettlementRepository } from '@unit-talk/db';

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
  const recentSettlements = await repositories.settlements.listRecent(5000);

  // Build a map: pick_id → latest settlement (canonical — corrects_id is null = canonical)
  const settlementMap = new Map<string, (typeof recentSettlements)[0]>();
  for (const sr of recentSettlements) {
    if (sr.status !== 'settled') continue;
    // Skip correction rows — only keep canonical originals
    if (sr.corrects_id !== null) continue;
    const existing = settlementMap.get(sr.pick_id);
    if (!existing || sr.settled_at > existing.settled_at) {
      settlementMap.set(sr.pick_id, sr);
    }
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

  const enriched: EnrichedRow[] = filteredPicks.map((pick) => {
    const metadata = asRecord(pick.metadata);
    const sport = readString(metadata['sport'] ?? metadata['league']);
    const modelTier = readString(metadata['model_tier'] ?? metadata['tier']);
    const modelScore = readFiniteNumber(metadata['model_score']);
    const modelConfidence = readFiniteNumber(metadata['model_confidence'] ?? metadata['confidence']);
    const dataFreshness = readString(metadata['data_freshness']);
    const isStale = dataFreshness === 'stale';
    const market = typeof pick.market === 'string' ? pick.market : '';
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

  // 5. Sport / market family breakdown
  type SportMarketKey = `${string}::${string}`;
  const sportMarketMap = new Map<SportMarketKey, EnrichedRow[]>();

  for (const row of enriched) {
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
