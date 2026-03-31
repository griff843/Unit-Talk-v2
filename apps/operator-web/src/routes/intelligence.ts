import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';
import {
  fetchIntelligenceDataset,
  computeMiniStats,
  computePickPayout,
  computeScoreCorrelation,
  evaluateScoreSignal,
  sliceBySource,
  sliceByDecision,
  bucketBySport,
  bucketBySource,
  extractSport,
} from './shared-intelligence.js';

/**
 * GET /api/operator/intelligence
 *
 * Wave 4 intelligence surface. Returns:
 *   - Recent form windows (last 5/10/20) for each slice
 *   - Score quality analysis (score bands, score-vs-outcome with sample sizes)
 *   - Decision quality analysis (approved/denied/held accuracy)
 *   - Feedback loop (recent picks with probabilistic score signal evaluation)
 */
export async function handleIntelligenceRequest(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: OperatorRouteDependencies,
): Promise<void> {
  const provider = deps.provider as unknown as { _supabaseClient?: unknown };
  if (!provider._supabaseClient) {
    writeJson(response, 200, { ok: true, data: createEmptyIntelligence() });
    return;
  }

  const client = provider._supabaseClient;
  const dataset = await fetchIntelligenceDataset(client);
  const { picks, resultByPick, reviewByPick, queryError } = dataset;

  const settledPicks = picks.filter((p) => resultByPick.has(p['id'] as string));

  // ── Recent Form / Trend Windows ──────────────────────────────────
  function computeRecentForm(pickList: Array<Record<string, unknown>>) {
    const settled = pickList.filter((p) => resultByPick.has(p['id'] as string));
    return {
      last5: computeMiniStats(settled.slice(0, 5), resultByPick),
      last10: computeMiniStats(settled.slice(0, 10), resultByPick),
      last20: computeMiniStats(settled.slice(0, 20), resultByPick),
    };
  }

  const { capperPicks, systemPicks } = sliceBySource(picks);
  const { approvedPicks, deniedPicks, heldPicks } = sliceByDecision(picks, reviewByPick);
  const sportBuckets = bucketBySport(picks);
  const sourceBuckets = bucketBySource(picks);

  const recentFormBySport: Record<string, ReturnType<typeof computeRecentForm>> = {};
  for (const [sport, sportPicks] of sportBuckets) {
    if (sportPicks.length >= 3) {
      recentFormBySport[sport] = computeRecentForm(sportPicks);
    }
  }

  const recentFormBySource: Record<string, ReturnType<typeof computeRecentForm>> = {};
  for (const [src, srcPicks] of sourceBuckets) {
    if (srcPicks.length >= 3) {
      recentFormBySource[src] = computeRecentForm(srcPicks);
    }
  }

  const recentForm = {
    overall: computeRecentForm(picks),
    capper: computeRecentForm(capperPicks),
    system: computeRecentForm(systemPicks),
    approved: computeRecentForm(approvedPicks),
    denied: computeRecentForm(deniedPicks),
    bySport: recentFormBySport,
    bySource: recentFormBySource,
  };

  // ── Score Quality Analysis ───────────────────────────────────────
  const scoreBands = [
    { range: '90-100', min: 90, max: 100 },
    { range: '80-89', min: 80, max: 89.99 },
    { range: '70-79', min: 70, max: 79.99 },
    { range: '60-69', min: 60, max: 69.99 },
    { range: '<60', min: -Infinity, max: 59.99 },
  ];

  const scoreBandResults = scoreBands.map((band) => {
    const bandPicks = settledPicks.filter((p) => {
      const score = p['promotion_score'] as number | null;
      if (score == null) return false;
      return score >= band.min && score <= band.max;
    });
    let wins = 0, losses = 0, pushes = 0;
    let totalRisked = 0, totalProfit = 0;
    for (const p of bandPicks) {
      const r = resultByPick.get(p['id'] as string)!;
      const payout = computePickPayout(p['odds'] as number | null);
      if (r === 'win') { wins++; totalRisked += payout.riskPerUnit; totalProfit += payout.profitPerUnit; }
      else if (r === 'loss') { losses++; totalRisked += payout.riskPerUnit; totalProfit -= payout.riskPerUnit; }
      else if (r === 'push') { pushes++; }
    }
    const total = wins + losses + pushes;
    const decided = wins + losses;
    const hitRate = decided > 0 ? (wins / decided) * 100 : 0;
    const roi = totalRisked > 0 ? (totalProfit / totalRisked) * 100 : 0;
    return {
      range: band.range,
      total,
      wins,
      losses,
      pushes,
      hitRatePct: Math.round(hitRate * 10) / 10,
      roiPct: Math.round(roi * 10) / 10,
    };
  });

  // Score-outcome correlation with sample sizes (#7)
  const scoredSettled = settledPicks.filter((p) => p['promotion_score'] != null);
  const scoreCorrelation = computeScoreCorrelation(scoredSettled, resultByPick);

  // ── Decision Quality Analysis ────────────────────────────────────
  const settledApproved = approvedPicks.filter((p) => resultByPick.has(p['id'] as string));
  const settledDenied = deniedPicks.filter((p) => resultByPick.has(p['id'] as string));

  let approvedWins = 0, approvedDecided = 0;
  for (const p of settledApproved) {
    const r = resultByPick.get(p['id'] as string)!;
    if (r === 'win' || r === 'loss') approvedDecided++;
    if (r === 'win') approvedWins++;
  }
  let deniedWouldHaveWon = 0, deniedDecided = 0;
  for (const p of settledDenied) {
    const r = resultByPick.get(p['id'] as string)!;
    if (r === 'win' || r === 'loss') deniedDecided++;
    if (r === 'win') deniedWouldHaveWon++;
  }

  const approvedWinRate = approvedDecided > 0
    ? Math.round((approvedWins / approvedDecided) * 1000) / 10
    : null;
  const deniedWouldHaveWonRate = deniedDecided > 0
    ? Math.round((deniedWouldHaveWon / deniedDecided) * 1000) / 10
    : null;

  // Approved vs denied ROI delta (using odds-aware shared computation would
  // require the full stats pipeline — keep simple ROI here for delta only)
  function simpleDecisionRoi(pickList: Array<Record<string, unknown>>) {
    let w = 0, l = 0;
    for (const p of pickList) {
      const r = resultByPick.get(p['id'] as string);
      if (r === 'win') w++;
      else if (r === 'loss') l++;
    }
    const t = w + l;
    return t > 0 ? ((w - l) / t) * 100 : 0;
  }
  const approvedRoi = simpleDecisionRoi(settledApproved);
  const deniedRoi = simpleDecisionRoi(settledDenied);

  const holdsResolved = heldPicks.filter((p) => resultByPick.has(p['id'] as string)).length;

  const decisionQuality = {
    approvedWinRate,
    deniedWouldHaveWonRate,
    approvedVsDeniedRoiDelta: Math.round((approvedRoi - deniedRoi) * 10) / 10,
    holdsResolvedCount: holdsResolved,
    holdsTotal: heldPicks.length,
  };

  // ── Feedback Loop with probabilistic score signal (#6) ──────────
  const feedbackLoop = settledPicks.slice(0, 50).map((p) => {
    const pickId = p['id'] as string;
    const source = p['source'] as string;
    const sport = extractSport((p['market'] as string) ?? '');
    const score = p['promotion_score'] as number | null;
    const decision = reviewByPick.get(pickId) ?? null;
    const result = resultByPick.get(pickId)!;

    const scoreSignal = evaluateScoreSignal(score, result);

    let reviewWasRight: boolean | null = null;
    if (decision && (result === 'win' || result === 'loss')) {
      if (decision === 'approve') reviewWasRight = result === 'win';
      else if (decision === 'deny') reviewWasRight = result === 'loss';
    }

    return {
      pickId,
      source,
      sport,
      promotionScore: score,
      reviewDecision: decision,
      result,
      scoreSignal,
      reviewWasRight,
    };
  });

  // ── Warnings ────────────────────────────────────────────────────
  const warnings: Array<{ segment: string; message: string }> = [];

  for (const [sport, sportPicks] of sportBuckets) {
    const recentSettled = sportPicks
      .filter((p) => resultByPick.has(p['id'] as string))
      .slice(0, 20);
    if (recentSettled.length >= 5) {
      const mini = computeMiniStats(recentSettled, resultByPick);
      if (mini.roiPct < -15) {
        warnings.push({
          segment: sport,
          message: `${sport} last ${recentSettled.length} settled: ${mini.roiPct.toFixed(1)}% ROI, ${mini.hitRatePct.toFixed(1)}% hit rate`,
        });
      }
    }
  }
  for (const [src, srcPicks] of sourceBuckets) {
    const recentSettled = srcPicks
      .filter((p) => resultByPick.has(p['id'] as string))
      .slice(0, 20);
    if (recentSettled.length >= 5) {
      const mini = computeMiniStats(recentSettled, resultByPick);
      if (mini.roiPct < -15) {
        warnings.push({
          segment: `source:${src}`,
          message: `${src} last ${recentSettled.length} settled: ${mini.roiPct.toFixed(1)}% ROI, ${mini.hitRatePct.toFixed(1)}% hit rate`,
        });
      }
    }
  }

  if (approvedWinRate != null && deniedWouldHaveWonRate != null && deniedWouldHaveWonRate > approvedWinRate) {
    warnings.push({
      segment: 'decisions',
      message: `Denied picks win rate (${deniedWouldHaveWonRate.toFixed(1)}%) exceeds approved (${approvedWinRate.toFixed(1)}%)`,
    });
  }

  let bestScoreBand: { range: string; roiPct: number } | null = null;
  for (const band of scoreBandResults) {
    if (band.total >= 3 && (bestScoreBand == null || band.roiPct > bestScoreBand.roiPct)) {
      bestScoreBand = { range: band.range, roiPct: band.roiPct };
    }
  }

  writeJson(response, 200, {
    ok: true,
    ...(queryError ? { warning: `Partial data: ${queryError}` } : {}),
    data: {
      recentForm,
      scoreQuality: {
        bands: scoreBandResults,
        scoreVsOutcome: scoreCorrelation,
      },
      decisionQuality,
      feedbackLoop,
      insights: {
        bestScoreBand,
        warnings,
      },
      observedAt: new Date().toISOString(),
    },
  });
}

function createEmptyIntelligence() {
  const emptyForm = {
    last5: { wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, streak: '—' },
    last10: { wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, streak: '—' },
    last20: { wins: 0, losses: 0, pushes: 0, hitRatePct: 0, roiPct: 0, streak: '—' },
  };
  return {
    recentForm: {
      overall: emptyForm,
      capper: emptyForm,
      system: emptyForm,
      approved: emptyForm,
      denied: emptyForm,
      bySport: {},
      bySource: {},
    },
    scoreQuality: {
      bands: [],
      scoreVsOutcome: { avgScoreWins: null, avgScoreLosses: null, correlation: 'insufficient_data', sampleSize: 0, confidence: 'none' },
    },
    decisionQuality: {
      approvedWinRate: null,
      deniedWouldHaveWonRate: null,
      approvedVsDeniedRoiDelta: 0,
      holdsResolvedCount: 0,
      holdsTotal: 0,
    },
    feedbackLoop: [],
    insights: {
      bestScoreBand: null,
      warnings: [],
    },
    observedAt: new Date().toISOString(),
  };
}
