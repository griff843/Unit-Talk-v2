/**
 * Backtest Scoring Weights — validate promotion weights against historical outcomes
 *
 * Uses the R1-R5 verification engine to replay historical picks through
 * different scoring weight configurations and compare outcomes.
 *
 * Usage:
 *   npx tsx scripts/backtest-weights.ts [--since YYYY-MM-DD] [--output path]
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Issue: UTV2-201
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Weight configurations to test
const WEIGHT_VARIANTS = [
  {
    name: 'current',
    weights: { edge: 0.35, trust: 0.25, readiness: 0.20, uniqueness: 0.10, boardFit: 0.10 },
  },
  {
    name: 'edge-heavy',
    weights: { edge: 0.50, trust: 0.20, readiness: 0.15, uniqueness: 0.05, boardFit: 0.10 },
  },
  {
    name: 'trust-heavy',
    weights: { edge: 0.25, trust: 0.40, readiness: 0.15, uniqueness: 0.10, boardFit: 0.10 },
  },
  {
    name: 'balanced',
    weights: { edge: 0.30, trust: 0.30, readiness: 0.20, uniqueness: 0.10, boardFit: 0.10 },
  },
  {
    name: 'edge-trust-only',
    weights: { edge: 0.45, trust: 0.35, readiness: 0.10, uniqueness: 0.00, boardFit: 0.10 },
  },
];

interface PickWithOutcome {
  id: string;
  market: string;
  selection: string;
  odds: number | null;
  confidence: number | null;
  source: string;
  metadata: Record<string, unknown>;
  status: string;
  result: string | null;
  clvRaw: number | null;
  clvPercent: number | null;
  promotionScore: number | null;
}

interface BacktestResult {
  variant: string;
  weights: Record<string, number>;
  picksEvaluated: number;
  wouldHavePromoted: number;
  promotedWinRate: number | null;
  promotedAvgClv: number | null;
  rejectedWouldHaveWon: number;
  totalClvOfPromoted: number;
  totalClvOfRejected: number;
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing: ${name}`);
  return val;
}

function computeWeightedScore(
  scores: { edge: number; trust: number; readiness: number; uniqueness: number; boardFit: number },
  weights: Record<string, number>,
): number {
  return (
    scores.edge * (weights.edge ?? 0) +
    scores.trust * (weights.trust ?? 0) +
    scores.readiness * (weights.readiness ?? 0) +
    scores.uniqueness * (weights.uniqueness ?? 0) +
    scores.boardFit * (weights.boardFit ?? 0)
  );
}

async function main() {
  const since = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] ??
    (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
  const outputPath = process.argv.find((a) => a.startsWith('--output='))?.split('=')[1] ??
    `out/backtest/weight_backtest_${since}.json`;

  console.log(`Backtest scoring weights since ${since}`);

  const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

  // Fetch settled picks with promotion history
  const { data: picks, error: picksErr } = await client
    .from('picks')
    .select('id, market, selection, odds, status, metadata, source, promotion_score, promotion_reason')
    .in('status', ['settled', 'voided'])
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (picksErr) throw new Error(`Picks query failed: ${picksErr.message}`);
  if (!picks || picks.length === 0) {
    console.log('No settled picks found. Need graded picks to backtest.');
    return;
  }

  // Fetch settlements for CLV data
  const { data: settlements, error: settErr } = await client
    .from('settlement_records')
    .select('pick_id, result, source, payload')
    .eq('source', 'grading')
    .in('result', ['win', 'loss', 'push']);

  if (settErr) throw new Error(`Settlements query failed: ${settErr.message}`);

  // Map settlements by pick_id
  const settlementMap = new Map<string, { result: string; clvRaw: number | null; clvPercent: number | null }>();
  for (const s of settlements ?? []) {
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    settlementMap.set(s.pick_id, {
      result: s.result,
      clvRaw: typeof payload.clvRaw === 'number' ? payload.clvRaw : null,
      clvPercent: typeof payload.clvPercent === 'number' ? payload.clvPercent : null,
    });
  }

  // Build enriched pick list
  const enrichedPicks: PickWithOutcome[] = picks.map((p) => {
    const settlement = settlementMap.get(p.id);
    return {
      id: p.id,
      market: p.market,
      selection: p.selection,
      odds: p.odds,
      confidence: (p.metadata as Record<string, unknown>)?.capperConviction != null
        ? Number((p.metadata as Record<string, unknown>).capperConviction) / 10
        : null,
      source: p.source,
      metadata: p.metadata as Record<string, unknown>,
      status: p.status,
      result: settlement?.result ?? null,
      clvRaw: settlement?.clvRaw ?? null,
      clvPercent: settlement?.clvPercent ?? null,
      promotionScore: p.promotion_score,
    };
  });

  console.log(`Loaded ${enrichedPicks.length} settled picks, ${settlementMap.size} settlements`);

  // Run each weight variant
  const results: BacktestResult[] = [];
  const PROMOTION_THRESHOLD = 70;

  for (const variant of WEIGHT_VARIANTS) {
    let promoted = 0;
    let promotedWins = 0;
    let promotedTotal = 0;
    let promotedClvSum = 0;
    let promotedClvCount = 0;
    let rejectedWouldHaveWon = 0;
    let rejectedClvSum = 0;
    let rejectedClvCount = 0;

    for (const pick of enrichedPicks) {
      if (pick.confidence == null) continue;

      // Simulate score components (simplified — uses available metadata)
      const meta = pick.metadata;
      const domainAnalysis = (meta.domainAnalysis ?? {}) as Record<string, unknown>;
      const realEdge = typeof meta.realEdge === 'number' ? meta.realEdge : null;
      const edge = typeof domainAnalysis.edge === 'number' ? domainAnalysis.edge : (pick.confidence - 0.5);
      const edgeScore = Math.max(0, Math.min(100, 50 + (realEdge ?? edge) * 400));

      const trustScore = pick.confidence * 100; // simplified
      const readinessScore = 60; // neutral default for backtest
      const uniquenessScore = 50;
      const boardFitScore = 75;

      const totalScore = computeWeightedScore(
        { edge: edgeScore, trust: trustScore, readiness: readinessScore, uniqueness: uniquenessScore, boardFit: boardFitScore },
        variant.weights,
      );

      const wouldPromote = totalScore >= PROMOTION_THRESHOLD;

      if (wouldPromote) {
        promoted++;
        if (pick.result === 'win') promotedWins++;
        if (pick.result) promotedTotal++;
        if (pick.clvPercent != null) {
          promotedClvSum += pick.clvPercent;
          promotedClvCount++;
        }
      } else {
        if (pick.result === 'win') rejectedWouldHaveWon++;
        if (pick.clvPercent != null) {
          rejectedClvSum += pick.clvPercent;
          rejectedClvCount++;
        }
      }
    }

    results.push({
      variant: variant.name,
      weights: variant.weights,
      picksEvaluated: enrichedPicks.filter((p) => p.confidence != null).length,
      wouldHavePromoted: promoted,
      promotedWinRate: promotedTotal > 0 ? promotedWins / promotedTotal : null,
      promotedAvgClv: promotedClvCount > 0 ? promotedClvSum / promotedClvCount : null,
      rejectedWouldHaveWon,
      totalClvOfPromoted: promotedClvSum,
      totalClvOfRejected: rejectedClvSum,
    });
  }

  // Print results
  console.log('\n=== Weight Backtest Results ===\n');
  console.log('| Variant | Promoted | Win Rate | Avg CLV | Rejected Winners | CLV Promoted | CLV Rejected |');
  console.log('|---------|----------|----------|---------|------------------|--------------|--------------|');
  for (const r of results) {
    console.log(
      `| ${r.variant.padEnd(15)} | ${String(r.wouldHavePromoted).padEnd(8)} | ${r.promotedWinRate != null ? (r.promotedWinRate * 100).toFixed(1) + '%' : '—'} | ${r.promotedAvgClv != null ? r.promotedAvgClv.toFixed(2) + '%' : '—'} | ${String(r.rejectedWouldHaveWon).padEnd(16)} | ${r.totalClvOfPromoted.toFixed(2).padEnd(12)} | ${r.totalClvOfRejected.toFixed(2)} |`,
    );
  }

  // Save results
  const outputDir = resolve(outputPath, '..');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputPath), JSON.stringify({ since, results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\nResults saved to ${resolve(outputPath)}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
