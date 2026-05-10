/**
 * Performance Report — hit rate, ROI, and breakdowns
 */

import { isDirectionallyCorrect, computeFlatBetROI } from './outcome-resolver.js';

import type { ScoredOutcome, PerformanceReport, PerformanceBucket } from './types.js';
import { classifyMarket, buildQuarantineSummary } from '../market-quarantine.js';

/**
 * Generate a full performance report from scored outcomes.
 * Records with unresolved market_type_key are quarantined and excluded from
 * all analytics buckets to prevent low-trust markets from polluting edge signals.
 */
export function generatePerformanceReport(records: ScoredOutcome[]): PerformanceReport {
  const quarantined_markets = buildQuarantineSummary(records);
  const trusted = records.filter((r) => classifyMarket(r) === 'trusted');

  const wins = trusted.filter((r) => r.outcome === 'WIN').length;
  const losses = trusted.filter((r) => r.outcome === 'LOSS').length;
  const pushes = trusted.filter((r) => r.outcome === 'PUSH').length;
  const nonPush = trusted.filter((r) => r.outcome !== 'PUSH');

  let directionalCorrect = 0;
  let directionalTotal = 0;
  for (const r of trusted) {
    const correct = isDirectionallyCorrect(r.p_final, r.outcome);
    if (correct !== null) {
      directionalTotal++;
      if (correct) directionalCorrect++;
    }
  }

  const flatBet = computeFlatBetROI(trusted.map((r) => r.outcome));

  const overall = {
    total: trusted.length,
    wins,
    losses,
    pushes,
    hit_rate_pct: nonPush.length > 0 ? round((wins / nonPush.length) * 100, 2) : 0,
    directional_accuracy_pct:
      directionalTotal > 0 ? round((directionalCorrect / directionalTotal) * 100, 2) : 0,
    flat_bet_roi_pct: round(flatBet.roi_pct, 3),
  };

  // By market type (trusted records only — market_type_key is always defined here)
  const by_market_type = buildBuckets(trusted, (r) => r.market_type_key!);

  // By p_final bin
  const by_p_final_bin = buildBuckets(trusted, (r) => {
    const p = r.p_final;
    if (p < 0.5) return '<0.50';
    if (p < 0.55) return '0.50-0.55';
    if (p < 0.6) return '0.55-0.60';
    if (p < 0.65) return '0.60-0.65';
    return '0.65+';
  });

  // By edge quartile
  const edges = trusted.map((r) => r.edge_final).sort((a, b) => a - b);
  const q1 = edges[Math.floor(edges.length * 0.25)] ?? 0;
  const q2 = edges[Math.floor(edges.length * 0.5)] ?? 0;
  const q3 = edges[Math.floor(edges.length * 0.75)] ?? 0;

  const by_edge_quartile = buildBuckets(trusted, (r) => {
    if (r.edge_final <= q1) return `Q1 (≤${q1.toFixed(4)})`;
    if (r.edge_final <= q2) return `Q2 (≤${q2.toFixed(4)})`;
    if (r.edge_final <= q3) return `Q3 (≤${q3.toFixed(4)})`;
    return `Q4 (>${q3.toFixed(4)})`;
  });

  return { overall, by_market_type, by_p_final_bin, by_edge_quartile, quarantined_markets };
}

function buildBuckets(
  records: ScoredOutcome[],
  labeler: (r: ScoredOutcome) => string,
): PerformanceBucket[] {
  const groups = new Map<string, ScoredOutcome[]>();
  for (const r of records) {
    const label = labeler(r);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }

  const buckets: PerformanceBucket[] = [];
  for (const [label, group] of Array.from(groups.entries())) {
    const wins = group.filter((r) => r.outcome === 'WIN').length;
    const losses = group.filter((r) => r.outcome === 'LOSS').length;
    const pushes = group.filter((r) => r.outcome === 'PUSH').length;
    const nonPush = group.filter((r) => r.outcome !== 'PUSH');
    const flatBet = computeFlatBetROI(group.map((r) => r.outcome));

    buckets.push({
      label,
      count: group.length,
      wins,
      losses,
      pushes,
      hit_rate_pct: nonPush.length > 0 ? round((wins / nonPush.length) * 100, 2) : 0,
      roi_pct: round(flatBet.roi_pct, 3),
    });
  }

  return buckets.sort((a, b) => b.count - a.count);
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
