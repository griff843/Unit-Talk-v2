import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import {
  fetchIntelligenceDataset,
  computeStats,
  sliceBySource,
  sliceByDecision,
  bucketBySport,
  bucketBySource,
  type Stats,
} from './shared-intelligence.js';

/**
 * GET /api/operator/performance
 *
 * Returns enriched performance data:
 *   - Overall stats for multiple time windows (today, 7d, 30d, mtd)
 *   - Source split (capper vs system)
 *   - Decision outcome tracking (approved picks performance, denied counterfactual)
 *   - Per-individual-source and per-sport breakdowns
 *   - Operator insight summary
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

  const client = provider._supabaseClient;
  const dataset = await fetchIntelligenceDataset(client);
  const { picks, resultByPick, clvByPick, reviewByPick, queryError } = dataset;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  function stats(list: Array<Record<string, unknown>>): Stats {
    return computeStats(list, resultByPick, clvByPick);
  }

  function filterByWindow(list: Array<Record<string, unknown>>, since: string) {
    return list.filter((p) => (p['created_at'] as string) >= since);
  }

  const { capperPicks, systemPicks } = sliceBySource(picks);
  const { approvedPicks, deniedPicks, heldPicks } = sliceByDecision(picks, reviewByPick);

  const sportBuckets = bucketBySport(picks);
  const bySport: Record<string, Stats> = {};
  for (const [sport, sportPicks] of sportBuckets) {
    if (sportPicks.length >= 2) {
      bySport[sport] = stats(sportPicks);
    }
  }

  const sourceBuckets = bucketBySource(picks);
  const byIndividualSource: Record<string, Stats> = {};
  let topCapper = { name: '—', roiPct: 0, sampleSize: 0 };
  let worstSegment = { name: '—', roiPct: 0, sampleSize: 0 };
  for (const [name, srcPicks] of sourceBuckets) {
    const s = stats(srcPicks);
    byIndividualSource[name] = s;
    if (s.settled >= 3 && s.roiPct > topCapper.roiPct) {
      topCapper = { name, roiPct: s.roiPct, sampleSize: s.settled };
    }
    if (s.settled >= 3 && s.roiPct < worstSegment.roiPct) {
      worstSegment = { name, roiPct: s.roiPct, sampleSize: s.settled };
    }
  }

  let strongestSport = { name: '—', roiPct: 0, sampleSize: 0 };
  let weakestSport = { name: '—', roiPct: 0, sampleSize: 0 };
  for (const [sport, s] of Object.entries(bySport)) {
    if (s.settled >= 3 && s.roiPct > strongestSport.roiPct) {
      strongestSport = { name: sport, roiPct: s.roiPct, sampleSize: s.settled };
    }
    if (s.settled >= 3 && s.roiPct < weakestSport.roiPct) {
      weakestSport = { name: sport, roiPct: s.roiPct, sampleSize: s.settled };
    }
  }

  const capperStats = stats(capperPicks);
  const systemStats = stats(systemPicks);
  const approvedStats = stats(approvedPicks);
  const deniedStats = stats(deniedPicks);
  const heldStats = stats(heldPicks);

  writeJson(response, 200, {
    ok: true,
    ...(queryError ? { warning: `Partial data: ${queryError}` } : {}),
    data: {
      windows: {
        today: stats(filterByWindow(picks, todayStart)),
        last7d: stats(filterByWindow(picks, d7)),
        last30d: stats(filterByWindow(picks, d30)),
        mtd: stats(filterByWindow(picks, mtdStart)),
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
  const empty: Stats = { total: 0, settled: 0, wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, avgScore: null, avgClvPct: null, avgStakeUnits: null };
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
