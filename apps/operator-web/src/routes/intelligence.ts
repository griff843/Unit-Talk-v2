import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OperatorRouteDependencies } from '../server.js';
import { writeJson } from '../http-utils.js';

/**
 * GET /api/operator/intelligence
 *
 * Wave 4 intelligence surface. Returns:
 *   - Recent form windows (last 5/10/20) for each slice
 *   - Score quality analysis (score bands, score-vs-outcome)
 *   - Decision quality analysis (approved/denied/held accuracy)
 *   - Feedback loop (recent picks with score-right / review-right)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = provider._supabaseClient as any;

  const [picksResult, settlementsResult, reviewsResult] = await Promise.all([
    client
      .from('picks')
      .select('id, source, market, status, approval_status, promotion_score, stake_units, odds, confidence, created_at, settled_at')
      .order('created_at', { ascending: false }),
    client
      .from('settlement_records')
      .select('pick_id, result, status, source, payload, created_at')
      .order('created_at', { ascending: false }),
    client
      .from('pick_reviews')
      .select('pick_id, decision, decided_by, decided_at')
      .order('decided_at', { ascending: false }),
  ]);

  const picks = (picksResult.data ?? []) as Array<Record<string, unknown>>;
  const settlements = (settlementsResult.data ?? []) as Array<Record<string, unknown>>;
  const reviews = (reviewsResult.data ?? []) as Array<Record<string, unknown>>;

  // Build result map (latest settlement per pick, ordered DESC so first wins)
  const resultByPick = new Map<string, string>();
  for (const s of settlements) {
    const pid = s['pick_id'] as string;
    if (!resultByPick.has(pid) && s['result']) {
      resultByPick.set(pid, s['result'] as string);
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

  // Helper: get settled picks in order (most recent first — picks already ordered DESC)
  const settledPicks = picks.filter((p) => resultByPick.has(p['id'] as string));

  // ── 4B: Recent Form / Trend Windows ──────────────────────────────
  function computeRecentForm(pickList: Array<Record<string, unknown>>) {
    // pickList should already be in DESC order (most recent first)
    const settled = pickList.filter((p) => resultByPick.has(p['id'] as string));
    return {
      last5: computeMiniStats(settled.slice(0, 5)),
      last10: computeMiniStats(settled.slice(0, 10)),
      last20: computeMiniStats(settled.slice(0, 20)),
    };
  }

  function computeMiniStats(settled: Array<Record<string, unknown>>) {
    let wins = 0, losses = 0, pushes = 0;
    // Compute streak from most recent
    let streakType = '';
    let streakCount = 0;
    for (const p of settled) {
      const r = resultByPick.get(p['id'] as string)!;
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      else if (r === 'push') pushes++;
      // Streak: track consecutive same-result from most recent
      if (streakCount === 0) {
        streakType = r;
        streakCount = 1;
      } else if (r === streakType) {
        streakCount++;
      }
      // Once streak breaks, stop counting (but continue W/L/P totals)
    }
    const total = wins + losses + pushes;
    const hitRate = total > 0 ? (wins / (wins + losses || 1)) * 100 : 0;
    const roi = total > 0 ? ((wins * 100 - losses * 110) / (total * 110)) * 100 : 0;
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

  // Source splits
  const capperPicks = picks.filter((p) => {
    const src = p['source'] as string;
    return src === 'smart-form' || src === 'discord' || src === 'api';
  });
  const systemPicks = picks.filter((p) => {
    const src = p['source'] as string;
    return src !== 'smart-form' && src !== 'discord' && src !== 'api';
  });

  // Decision splits
  const approvedPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'approve');
  const deniedPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'deny');

  // Sport splits
  const sportBuckets = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const market = (p['market'] as string) ?? '';
    const sport = market.split('-')[0]?.split('_')[0]?.toUpperCase() || 'UNKNOWN';
    if (!sportBuckets.has(sport)) sportBuckets.set(sport, []);
    sportBuckets.get(sport)!.push(p);
  }

  // Per-source splits
  const sourceBuckets = new Map<string, Array<Record<string, unknown>>>();
  for (const p of picks) {
    const src = p['source'] as string;
    if (!sourceBuckets.has(src)) sourceBuckets.set(src, []);
    sourceBuckets.get(src)!.push(p);
  }

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

  // ── 4C: Score Quality Analysis ───────────────────────────────────
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
    for (const p of bandPicks) {
      const r = resultByPick.get(p['id'] as string)!;
      if (r === 'win') wins++;
      else if (r === 'loss') losses++;
      else if (r === 'push') pushes++;
    }
    const total = wins + losses + pushes;
    const hitRate = total > 0 ? (wins / (wins + losses || 1)) * 100 : 0;
    const roi = total > 0 ? ((wins * 100 - losses * 110) / (total * 110)) * 100 : 0;
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

  // Score vs outcome correlation
  const scoredSettled = settledPicks.filter((p) => p['promotion_score'] != null);
  let avgScoreWins: number | null = null;
  let avgScoreLosses: number | null = null;
  {
    let winScoreSum = 0, winScoreCount = 0, lossScoreSum = 0, lossScoreCount = 0;
    for (const p of scoredSettled) {
      const score = p['promotion_score'] as number;
      const r = resultByPick.get(p['id'] as string)!;
      if (r === 'win') { winScoreSum += score; winScoreCount++; }
      else if (r === 'loss') { lossScoreSum += score; lossScoreCount++; }
    }
    avgScoreWins = winScoreCount > 0 ? Math.round((winScoreSum / winScoreCount) * 10) / 10 : null;
    avgScoreLosses = lossScoreCount > 0 ? Math.round((lossScoreSum / lossScoreCount) * 10) / 10 : null;
  }

  let correlation: 'positive' | 'weak' | 'negative' | 'insufficient_data' = 'insufficient_data';
  if (avgScoreWins != null && avgScoreLosses != null) {
    const delta = avgScoreWins - avgScoreLosses;
    if (delta > 3) correlation = 'positive';
    else if (delta < -3) correlation = 'negative';
    else correlation = 'weak';
  }

  // ── 4C: Decision Quality Analysis ────────────────────────────────
  const settledApproved = approvedPicks.filter((p) => resultByPick.has(p['id'] as string));
  const settledDenied = deniedPicks.filter((p) => resultByPick.has(p['id'] as string));

  let approvedWins = 0, approvedTotal = 0;
  for (const p of settledApproved) {
    const r = resultByPick.get(p['id'] as string)!;
    if (r === 'win' || r === 'loss') approvedTotal++;
    if (r === 'win') approvedWins++;
  }
  let deniedWouldHaveWon = 0, deniedTotal = 0;
  for (const p of settledDenied) {
    const r = resultByPick.get(p['id'] as string)!;
    if (r === 'win' || r === 'loss') deniedTotal++;
    if (r === 'win') deniedWouldHaveWon++;
  }

  const approvedWinRate = approvedTotal > 0
    ? Math.round((approvedWins / approvedTotal) * 1000) / 10
    : null;
  const deniedWouldHaveWonRate = deniedTotal > 0
    ? Math.round((deniedWouldHaveWon / deniedTotal) * 1000) / 10
    : null;

  // Approved vs denied ROI delta
  function simpleRoi(pickList: Array<Record<string, unknown>>) {
    let w = 0, l = 0;
    for (const p of pickList) {
      const r = resultByPick.get(p['id'] as string);
      if (r === 'win') w++;
      else if (r === 'loss') l++;
    }
    const t = w + l;
    return t > 0 ? ((w * 100 - l * 110) / (t * 110)) * 100 : 0;
  }
  const approvedRoi = simpleRoi(settledApproved);
  const deniedRoi = simpleRoi(settledDenied);

  // Held picks resolved count
  const heldPicks = picks.filter((p) => reviewByPick.get(p['id'] as string) === 'hold');
  const holdsResolved = heldPicks.filter((p) => resultByPick.has(p['id'] as string)).length;

  const decisionQuality = {
    approvedWinRate,
    deniedWouldHaveWonRate,
    approvedVsDeniedRoiDelta: Math.round((approvedRoi - deniedRoi) * 10) / 10,
    holdsResolvedCount: holdsResolved,
    holdsTotal: heldPicks.length,
  };

  // ── 4D: Feedback Loop ───────────────────────────────────────────
  const feedbackLoop = settledPicks.slice(0, 50).map((p) => {
    const pickId = p['id'] as string;
    const source = p['source'] as string;
    const market = (p['market'] as string) ?? '';
    const sport = market.split('-')[0]?.split('_')[0]?.toUpperCase() || 'UNKNOWN';
    const score = p['promotion_score'] as number | null;
    const decision = reviewByPick.get(pickId) ?? null;
    const result = resultByPick.get(pickId)!;

    // Score quality: was the score's signal correct?
    // High score (>=70) + win = correct; Low score (<70) + loss = correct
    let scoreWasRight: boolean | null = null;
    if (score != null && (result === 'win' || result === 'loss')) {
      scoreWasRight = (score >= 70 && result === 'win') || (score < 70 && result === 'loss');
    }

    // Decision quality: was the review decision correct?
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
      scoreWasRight,
      reviewWasRight,
    };
  });

  // ── 4D: Warnings ────────────────────────────────────────────────
  const warnings: Array<{ segment: string; message: string }> = [];

  // Check for degrading segments (negative ROI with >= 5 settled in recent 20)
  for (const [sport, sportPicks] of sportBuckets) {
    const recentSettled = sportPicks
      .filter((p) => resultByPick.has(p['id'] as string))
      .slice(0, 20);
    if (recentSettled.length >= 5) {
      const mini = computeMiniStats(recentSettled);
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
      const mini = computeMiniStats(recentSettled);
      if (mini.roiPct < -15) {
        warnings.push({
          segment: `source:${src}`,
          message: `${src} last ${recentSettled.length} settled: ${mini.roiPct.toFixed(1)}% ROI, ${mini.hitRatePct.toFixed(1)}% hit rate`,
        });
      }
    }
  }

  // Warn if denied picks are outperforming approved
  if (approvedWinRate != null && deniedWouldHaveWonRate != null && deniedWouldHaveWonRate > approvedWinRate) {
    warnings.push({
      segment: 'decisions',
      message: `Denied picks win rate (${deniedWouldHaveWonRate.toFixed(1)}%) exceeds approved (${approvedWinRate.toFixed(1)}%)`,
    });
  }

  // ── Best score band (for insight) ────────────────────────────────
  let bestScoreBand: { range: string; roiPct: number } | null = null;
  for (const band of scoreBandResults) {
    if (band.total >= 3 && (bestScoreBand == null || band.roiPct > bestScoreBand.roiPct)) {
      bestScoreBand = { range: band.range, roiPct: band.roiPct };
    }
  }

  writeJson(response, 200, {
    ok: true,
    data: {
      recentForm,
      scoreQuality: {
        bands: scoreBandResults,
        scoreVsOutcome: {
          avgScoreWins,
          avgScoreLosses,
          correlation,
        },
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
      scoreVsOutcome: { avgScoreWins: null, avgScoreLosses: null, correlation: 'insufficient_data' },
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
