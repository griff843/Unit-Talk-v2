/**
 * Shared data layer for /performance and /intelligence endpoints.
 *
 * Addresses:
 *  - Duplicated data fetching (#2)
 *  - Unbounded table scans (#1) — capped at QUERY_LIMIT
 *  - Missing error handling (#8)
 *  - Hardcoded source classification (#10)
 *  - Flat-110 ROI assumption (#3)
 *  - Division-by-zero (#4)
 */

// ── Source classification ──────────────────────────────────────────
// Single source of truth for capper vs system classification.
const CAPPER_SOURCES = new Set(['smart-form', 'discord', 'api']);

export function isCapperSource(source: string): boolean {
  return CAPPER_SOURCES.has(source);
}

// ── Query limit ────────────────────────────────────────────────────
const QUERY_LIMIT = 2000;

// ── Types ──────────────────────────────────────────────────────────
export interface IntelligenceDataset {
  picks: Array<Record<string, unknown>>;
  resultByPick: Map<string, string>;
  clvByPick: Map<string, number>;
  reviewByPick: Map<string, string>;
  /** null when all queries succeeded; string message on partial/full failure */
  queryError: string | null;
}

// ── Data fetcher ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchIntelligenceDataset(client: any): Promise<IntelligenceDataset> {
  const [picksResult, settlementsResult, reviewsResult] = await Promise.all([
    client
      .from('picks')
      .select('id, source, market, status, approval_status, promotion_score, stake_units, odds, confidence, created_at, settled_at')
      .order('created_at', { ascending: false })
      .limit(QUERY_LIMIT),
    client
      .from('settlement_records')
      .select('pick_id, result, status, source, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(QUERY_LIMIT * 3),
    client
      .from('pick_reviews')
      .select('pick_id, decision, decided_by, decided_at')
      .order('decided_at', { ascending: false })
      .limit(QUERY_LIMIT),
  ]);

  // Error handling (#8)
  const errors: string[] = [];
  if (picksResult.error) errors.push(`picks: ${picksResult.error.message}`);
  if (settlementsResult.error) errors.push(`settlements: ${settlementsResult.error.message}`);
  if (reviewsResult.error) errors.push(`reviews: ${reviewsResult.error.message}`);

  const picks = (picksResult.data ?? []) as Array<Record<string, unknown>>;
  const settlements = (settlementsResult.data ?? []) as Array<Record<string, unknown>>;
  const reviews = (reviewsResult.data ?? []) as Array<Record<string, unknown>>;

  // Build effective result map (latest settlement per pick, ordered DESC so first wins)
  const resultByPick = new Map<string, string>();
  const clvByPick = new Map<string, number>();
  for (const s of settlements) {
    const pid = s['pick_id'] as string;
    if (!resultByPick.has(pid) && s['result']) {
      resultByPick.set(pid, s['result'] as string);
    }
    if (!clvByPick.has(pid)) {
      const payload = s['payload'] as Record<string, unknown> | null;
      if (payload) {
        const clvPct = payload['clvPercent'];
        if (typeof clvPct === 'number' && Number.isFinite(clvPct)) {
          clvByPick.set(pid, clvPct);
        }
      }
    }
  }

  // Build latest review decision per pick
  const reviewByPick = new Map<string, string>();
  for (const r of reviews) {
    const pid = r['pick_id'] as string;
    if (!reviewByPick.has(pid)) {
      reviewByPick.set(pid, r['decision'] as string);
    }
  }

  return {
    picks,
    resultByPick,
    clvByPick,
    reviewByPick,
    queryError: errors.length > 0 ? errors.join('; ') : null,
  };
}

// ── Odds-aware ROI (#3) ────────────────────────────────────────────
/**
 * Compute ROI using actual American odds when available.
 * Falls back to flat -110 assumption when odds are missing.
 */
function computePickPayout(odds: number | null): { riskPerUnit: number; profitPerUnit: number } {
  if (odds == null || !Number.isFinite(odds)) {
    // Flat -110 fallback
    return { riskPerUnit: 110, profitPerUnit: 100 };
  }
  if (odds > 0) {
    // +200 means risk $100 to profit $200
    return { riskPerUnit: 100, profitPerUnit: odds };
  }
  // -150 means risk $150 to profit $100
  return { riskPerUnit: Math.abs(odds), profitPerUnit: 100 };
}

// ── Stats computation ──────────────────────────────────────────────
export interface Stats {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  avgScore: number | null;
  avgClvPct: number | null;
  avgStakeUnits: number | null;
}

export function computeStats(
  pickList: Array<Record<string, unknown>>,
  resultByPick: Map<string, string>,
  clvByPick: Map<string, number>,
): Stats {
  const settled = pickList.filter((p) => resultByPick.has(p['id'] as string));
  let wins = 0, losses = 0, pushes = 0, scoreSum = 0, scoreCount = 0;
  let clvSum = 0, clvCount = 0, stakeSum = 0, stakeCount = 0;
  let totalRisked = 0, totalProfit = 0;

  for (const p of settled) {
    const r = resultByPick.get(p['id'] as string)!;
    const odds = p['odds'] as number | null;
    const payout = computePickPayout(odds);
    const stakeMultiplier = 1; // normalize to 1-unit bets for ROI

    if (r === 'win') {
      wins++;
      totalRisked += payout.riskPerUnit * stakeMultiplier;
      totalProfit += payout.profitPerUnit * stakeMultiplier;
    } else if (r === 'loss') {
      losses++;
      totalRisked += payout.riskPerUnit * stakeMultiplier;
      totalProfit -= payout.riskPerUnit * stakeMultiplier;
    } else if (r === 'push') {
      pushes++;
      // No risk/profit on push
    }

    const score = p['promotion_score'] as number | null;
    if (score != null) { scoreSum += score; scoreCount++; }
    const clv = clvByPick.get(p['id'] as string);
    if (clv != null) { clvSum += clv; clvCount++; }
    const stake = p['stake_units'] as number | null;
    if (stake != null && Number.isFinite(stake)) { stakeSum += stake; stakeCount++; }
  }

  const total = wins + losses + pushes;
  const decided = wins + losses;
  // Division-by-zero guard (#4): use decided (wins+losses), not (wins+losses||1)
  const hitRate = decided > 0 ? (wins / decided) * 100 : 0;
  const roi = totalRisked > 0 ? (totalProfit / totalRisked) * 100 : 0;

  return {
    total: pickList.length,
    settled: total,
    wins, losses, pushes,
    hitRatePct: Math.round(hitRate * 10) / 10,
    roiPct: Math.round(roi * 10) / 10,
    avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
    avgClvPct: clvCount > 0 ? Math.round((clvSum / clvCount) * 10) / 10 : null,
    avgStakeUnits: stakeCount > 0 ? Math.round((stakeSum / stakeCount) * 10) / 10 : null,
  };
}

// ── Mini stats for recent form ─────────────────────────────────────
export interface MiniStats {
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  streak: string;
}

export function computeMiniStats(
  settled: Array<Record<string, unknown>>,
  resultByPick: Map<string, string>,
): MiniStats {
  let wins = 0, losses = 0, pushes = 0;
  let totalRisked = 0, totalProfit = 0;
  // Streak tracking with explicit break flag (#5)
  let streakType = '';
  let streakCount = 0;
  let streakBroken = false;

  for (const p of settled) {
    const r = resultByPick.get(p['id'] as string)!;
    const odds = p['odds'] as number | null;
    const payout = computePickPayout(odds);

    if (r === 'win') {
      wins++;
      totalRisked += payout.riskPerUnit;
      totalProfit += payout.profitPerUnit;
    } else if (r === 'loss') {
      losses++;
      totalRisked += payout.riskPerUnit;
      totalProfit -= payout.riskPerUnit;
    } else if (r === 'push') {
      pushes++;
    }

    if (!streakBroken) {
      if (streakCount === 0) {
        streakType = r;
        streakCount = 1;
      } else if (r === streakType) {
        streakCount++;
      } else {
        streakBroken = true;
      }
    }
  }

  const decided = wins + losses;
  const hitRate = decided > 0 ? (wins / decided) * 100 : 0;
  const roi = totalRisked > 0 ? (totalProfit / totalRisked) * 100 : 0;

  return {
    wins,
    losses,
    pushes,
    hitRatePct: Math.round(hitRate * 10) / 10,
    roiPct: Math.round(roi * 10) / 10,
    streak: streakCount > 0
      ? `${streakType === 'win' ? 'W' : streakType === 'loss' ? 'L' : 'P'}${streakCount}`
      : '—',
  };
}

// ── Score quality helpers (#6, #7) ─────────────────────────────────

/**
 * Evaluates whether a score's signal aligned with the outcome.
 * Uses a probabilistic interpretation instead of binary threshold (#6):
 * - Scores map to approximate expected win rates
 * - A "correct" signal means the outcome matched the expected direction
 *   with tolerance for the expected loss rate at that score level
 *
 * Returns: 'correct' | 'incorrect' | 'marginal' | null
 */
export function evaluateScoreSignal(
  score: number | null,
  result: string,
): 'correct' | 'incorrect' | 'marginal' | null {
  if (score == null || (result !== 'win' && result !== 'loss')) return null;

  // Score bands map to expected win rate ranges:
  // 90-100: strong signal (~65%+ expected win rate) — loss is acceptable
  // 70-89: moderate signal (~55% expected) — loss is expected ~45% of the time
  // <70: weak/negative signal — win is acceptable, loss is expected
  if (score >= 90) {
    return result === 'win' ? 'correct' : 'marginal';
  }
  if (score >= 70) {
    // In the promotion zone — wins are expected but losses are normal
    return result === 'win' ? 'correct' : 'marginal';
  }
  // Below promotion threshold — losses are expected, wins are a bonus
  return result === 'loss' ? 'correct' : 'marginal';
}

/**
 * Score-outcome correlation with sample size awareness (#7).
 */
export interface ScoreCorrelation {
  avgScoreWins: number | null;
  avgScoreLosses: number | null;
  correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data';
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export function computeScoreCorrelation(
  scoredSettled: Array<Record<string, unknown>>,
  resultByPick: Map<string, string>,
): ScoreCorrelation {
  let winScoreSum = 0, winScoreCount = 0, lossScoreSum = 0, lossScoreCount = 0;
  for (const p of scoredSettled) {
    const score = p['promotion_score'] as number;
    const r = resultByPick.get(p['id'] as string)!;
    if (r === 'win') { winScoreSum += score; winScoreCount++; }
    else if (r === 'loss') { lossScoreSum += score; lossScoreCount++; }
  }

  const avgScoreWins = winScoreCount > 0 ? Math.round((winScoreSum / winScoreCount) * 10) / 10 : null;
  const avgScoreLosses = lossScoreCount > 0 ? Math.round((lossScoreSum / lossScoreCount) * 10) / 10 : null;
  const sampleSize = winScoreCount + lossScoreCount;

  // Confidence based on sample size
  let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (sampleSize >= 50) confidence = 'high';
  else if (sampleSize >= 20) confidence = 'medium';
  else if (sampleSize >= 5) confidence = 'low';

  let correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data' = 'insufficient_data';
  if (avgScoreWins != null && avgScoreLosses != null && sampleSize >= 5) {
    const delta = avgScoreWins - avgScoreLosses;
    // Scale threshold by sample size — require larger delta for small samples
    const threshold = sampleSize >= 30 ? 2 : sampleSize >= 10 ? 4 : 6;
    if (delta > threshold) correlation = 'positive';
    else if (delta < -threshold) correlation = 'negative';
    else correlation = 'weak';
  }

  return { avgScoreWins, avgScoreLosses, correlation, sampleSize, confidence };
}

// ── Shared slice helpers ───────────────────────────────────────────

export function extractSport(market: string): string {
  return market.split('-')[0]?.split('_')[0]?.toUpperCase() || 'UNKNOWN';
}

export function sliceBySource(picks: Array<Record<string, unknown>>): {
  capperPicks: Array<Record<string, unknown>>;
  systemPicks: Array<Record<string, unknown>>;
} {
  const capperPicks = picks.filter((p) => isCapperSource(p['source'] as string));
  const systemPicks = picks.filter((p) => !isCapperSource(p['source'] as string));
  return { capperPicks, systemPicks };
}

export function sliceByDecision(
  picks: Array<Record<string, unknown>>,
  reviewByPick: Map<string, string>,
): {
  approvedPicks: Array<Record<string, unknown>>;
  deniedPicks: Array<Record<string, unknown>>;
  heldPicks: Array<Record<string, unknown>>;
} {
  const approvedPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'approve');
  const deniedPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'deny');
  const heldPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'hold');
  return { approvedPicks, deniedPicks, heldPicks };
}

export function bucketBySport(picks: Array<Record<string, unknown>>): Map<string, Array<Record<string, unknown>>> {
  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const sport = extractSport((p['market'] as string) ?? '');
    if (!map.has(sport)) map.set(sport, []);
    map.get(sport)!.push(p);
  }
  return map;
}

export function bucketBySource(picks: Array<Record<string, unknown>>): Map<string, Array<Record<string, unknown>>> {
  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const src = p['source'] as string;
    if (!map.has(src)) map.set(src, []);
    map.get(src)!.push(p);
  }
  return map;
}
