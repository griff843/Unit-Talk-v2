import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/performance
 *
 * Returns enriched performance data:
 *   - Overall stats for multiple time windows (today, 7d, 30d, mtd)
 *   - Source split (capper vs system)
 *   - Decision outcome tracking (approved picks performance, denied counterfactual)
 *   - Operator insight summary
 *
 * No query params — returns all windows in one response.
 */
export async function handlePerformanceRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: createEmptyPerformance() });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  // Fetch all picks + settlements (with CLV payload) + reviews
  const [picksResult, settlementsResult, reviewsResult] = await Promise.all([
    client.from('picks').select('id, source, market, status, approval_status, promotion_score, stake_units, odds, confidence, created_at, settled_at'),
    client.from('settlement_records').select('pick_id, result, status, source, payload, created_at').order('created_at', { ascending: false }),
    client.from('pick_reviews').select('pick_id, decision, decided_by, decided_at'),
  ]);

  const picks = (picksResult.data ?? []) as Array<Record<string, unknown>>;
  const settlements = (settlementsResult.data ?? []) as Array<Record<string, unknown>>;
  const reviews = (reviewsResult.data ?? []) as Array<Record<string, unknown>>;

  // Build effective result map (latest settlement per pick)
  const resultByPick = new Map<string, string>();
  // Build CLV map from settlement payloads (latest per pick)
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

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  function computeStats(pickList: Array<Record<string, unknown>>) {
    const settled = pickList.filter((p) => resultByPick.has(p['id'] as string));
    let wins = 0, losses = 0, pushes = 0, scoreSum = 0, scoreCount = 0;
    let clvSum = 0, clvCount = 0, stakeSum = 0, stakeCount = 0;
    for (const p of settled) {
      const r = resultByPick.get(p['id'] as string)!;
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      else if (r === 'push') pushes++;
      const score = p['promotion_score'] as number | null;
      if (score != null) { scoreSum += score; scoreCount++; }
      const clv = clvByPick.get(p['id'] as string);
      if (clv != null) { clvSum += clv; clvCount++; }
      const stake = p['stake_units'] as number | null;
      if (stake != null && Number.isFinite(stake)) { stakeSum += stake; stakeCount++; }
    }
    const total = wins + losses + pushes;
    const hitRate = total > 0 ? (wins / (wins + losses)) * 100 : 0;
    const roi = total > 0 ? ((wins * 100 - losses * 110) / (total * 110)) * 100 : 0;
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

  function filterByWindow(list: Array<Record<string, unknown>>, since: string) {
    return list.filter((p) => (p['created_at'] as string) >= since);
  }

  // Source split
  const capperPicks = picks.filter((p) => {
    const src = p['source'] as string;
    return src === 'smart-form' || src === 'discord' || src === 'api';
  });
  const systemPicks = picks.filter((p) => {
    const src = p['source'] as string;
    return src !== 'smart-form' && src !== 'discord' && src !== 'api';
  });

  // Decision outcome tracking
  const approvedPicks = picks.filter((p) => {
    const d = reviewByPick.get(p['id'] as string);
    return d === 'approve';
  });
  const deniedPicks = picks.filter((p) => {
    const d = reviewByPick.get(p['id'] as string);
    return d === 'deny';
  });
  const heldPicks = picks.filter((p) => {
    const d = reviewByPick.get(p['id'] as string);
    return d === 'hold';
  });

  // Sport split (extract sport prefix from market key)
  const sportMap = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const market = (p['market'] as string) ?? '';
    const sport = market.split('-')[0]?.split('_')[0]?.toUpperCase() || 'UNKNOWN';
    if (!sportMap.has(sport)) sportMap.set(sport, []);
    sportMap.get(sport)!.push(p);
  }

  const bySport: Record<string, ReturnType<typeof computeStats>> = {};
  for (const [sport, sportPicks] of sportMap) {
    if (sportPicks.length >= 2) {
      bySport[sport] = computeStats(sportPicks);
    }
  }

  // Insights
  const capperStats = computeStats(capperPicks);
  const systemStats = computeStats(systemPicks);
  const approvedStats = computeStats(approvedPicks);
  const deniedStats = computeStats(deniedPicks);
  const heldStats = computeStats(heldPicks);

  // Per-individual-source breakdown
  const sourceMap = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const src = p['source'] as string;
    if (!sourceMap.has(src)) sourceMap.set(src, []);
    sourceMap.get(src)!.push(p);
  }
  const byIndividualSource: Record<string, ReturnType<typeof computeStats>> = {};
  let topCapper = { name: '—', roiPct: 0, sampleSize: 0 };
  let worstSegment = { name: '—', roiPct: 0, sampleSize: 0 };
  for (const [name, srcPicks] of sourceMap) {
    const s = computeStats(srcPicks);
    byIndividualSource[name] = s;
    if (s.settled >= 3 && s.roiPct > topCapper.roiPct) {
      topCapper = { name, roiPct: s.roiPct, sampleSize: s.settled };
    }
    if (s.settled >= 3 && s.roiPct < worstSegment.roiPct) {
      worstSegment = { name, roiPct: s.roiPct, sampleSize: s.settled };
    }
  }

  // Strongest/weakest sport
  let strongestSport = { name: '—', roiPct: 0, sampleSize: 0 };
  let weakestSport = { name: '—', roiPct: 0, sampleSize: 0 };
  for (const [sport, stats] of Object.entries(bySport)) {
    if (stats.settled >= 3 && stats.roiPct > strongestSport.roiPct) {
      strongestSport = { name: sport, roiPct: stats.roiPct, sampleSize: stats.settled };
    }
    if (stats.settled >= 3 && stats.roiPct < weakestSport.roiPct) {
      weakestSport = { name: sport, roiPct: stats.roiPct, sampleSize: stats.settled };
    }
  }

  writeJson(response, 200, {
    ok: true,
    data: {
      windows: {
        today: computeStats(filterByWindow(picks, todayStart)),
        last7d: computeStats(filterByWindow(picks, d7)),
        last30d: computeStats(filterByWindow(picks, d30)),
        mtd: computeStats(filterByWindow(picks, mtdStart)),
      },
      bySource: {
        capper: capperStats,
        system: systemStats,
      },
      bySport,
      byIndividualSource,
      decisions: {
        approved: approvedStats,
        denied: deniedStats,
        held: heldStats,
        heldCount: heldPicks.length,
      },
      insights: {
        capperRoiPct: capperStats.roiPct,
        systemRoiPct: systemStats.roiPct,
        approvedRoiPct: approvedStats.roiPct,
        deniedRoiPct: deniedStats.roiPct,
        approvedVsDeniedDelta: Math.round((approvedStats.roiPct - deniedStats.roiPct) * 10) / 10,
        topCapper,
        worstSegment,
        strongestSport,
        weakestSport,
      },
    },
  });
}

function createEmptyPerformance() {
  const empty = { total: 0, settled: 0, wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, avgScore: null, avgClvPct: null, avgStakeUnits: null };
  return {
    windows: { today: empty, last7d: empty, last30d: empty, mtd: empty },
    bySource: { capper: empty, system: empty },
    bySport: {},
    byIndividualSource: {},
    decisions: { approved: empty, denied: empty, held: empty, heldCount: 0 },
    insights: {
      capperRoiPct: 0, systemRoiPct: 0, approvedRoiPct: 0, deniedRoiPct: 0,
      approvedVsDeniedDelta: 0,
      topCapper: { name: '—', roiPct: 0, sampleSize: 0 },
      worstSegment: { name: '—', roiPct: 0, sampleSize: 0 },
      strongestSport: { name: '—', roiPct: 0, sampleSize: 0 },
      weakestSport: { name: '—', roiPct: 0, sampleSize: 0 },
    },
  };
}
