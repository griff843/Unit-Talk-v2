/**
 * UTV2-320: NBA baseline benchmark against current scoring / intelligence truth
 *
 * Uses settled NBA picks to measure whether current promotion score inputs
 * separate outcomes at all, and whether CLV-backed tuning can run yet.
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-baseline-benchmark.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeWeightEffectiveness,
  runWalkForwardBacktest,
  testAllComponentSignificance,
  type ScoredPickOutcome,
} from '../packages/domain/src/clv-weight-tuner.ts';

type PickAuditRow = {
  id: string;
  market: string;
  metadata: Record<string, unknown> | null;
};

type SettlementAuditRow = {
  pick_id: string;
  result: 'win' | 'loss' | 'push' | null;
  payload: Record<string, unknown> | null;
};

interface OutcomeBackedScoreRow {
  pickId: string;
  market: string;
  outcome: 'win' | 'loss' | 'push';
  scoreInputs: ScoredPickOutcome['scoreInputs'];
  clvPercent: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function defaultScoreInput(value: number | null, fallback = 50) {
  return value == null ? fallback : value;
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Baseline Benchmark ===\n');

  const { data: picksRows, error: picksError } = await db
    .from('picks')
    .select('id,market,metadata')
    .filter('metadata->>sport', 'eq', 'NBA');

  if (picksError) {
    throw new Error(`picks query failed: ${picksError.message}`);
  }

  const picks = (picksRows ?? []) as PickAuditRow[];
  const pickIds = picks.map((pick) => pick.id);

  if (pickIds.length === 0) {
    console.log('No NBA picks found. Benchmark cannot run yet.');
    return;
  }

  const { data: settlementRows, error: settlementError } = await db
    .from('settlement_records')
    .select('pick_id,result,payload')
    .in('pick_id', pickIds);

  if (settlementError) {
    throw new Error(`settlement_records query failed: ${settlementError.message}`);
  }

  const settlements = (settlementRows ?? []) as SettlementAuditRow[];
  const settlementByPickId = new Map(settlements.map((row) => [row.pick_id, row]));

  const outcomeRows: OutcomeBackedScoreRow[] = [];
  for (const pick of picks) {
    const settlement = settlementByPickId.get(pick.id);
    if (!settlement?.result || settlement.result === 'push') {
      continue;
    }

    const metadata = asRecord(pick.metadata);
    const promotionScores = asRecord(metadata?.promotionScores);
    const settlementPayload = asRecord(settlement.payload);

    const clvPercent =
      readNumber(settlementPayload, 'clvPercent') ??
      readNumber(metadata, 'clvPercent') ??
      null;

    outcomeRows.push({
      pickId: pick.id,
      market: pick.market,
      outcome: settlement.result,
      scoreInputs: {
        edge: defaultScoreInput(readNumber(promotionScores, 'edge')),
        trust: defaultScoreInput(readNumber(promotionScores, 'trust')),
        readiness: defaultScoreInput(readNumber(promotionScores, 'readiness')),
        uniqueness: defaultScoreInput(readNumber(promotionScores, 'uniqueness')),
        boardFit: defaultScoreInput(readNumber(promotionScores, 'boardFit')),
      },
      clvPercent,
    });
  }

  const clvOutcomes: ScoredPickOutcome[] = outcomeRows
    .filter((row) => row.clvPercent != null)
    .map((row) => ({
      scoreInputs: row.scoreInputs,
      clvPercent: row.clvPercent!,
      won: row.outcome === 'win',
    }));

  const wins = outcomeRows.filter((row) => row.outcome === 'win').length;
  const losses = outcomeRows.filter((row) => row.outcome === 'loss').length;

  const average = (values: number[]) =>
    values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;

  const avgEdgeWin = average(outcomeRows.filter((row) => row.outcome === 'win').map((row) => row.scoreInputs.edge));
  const avgEdgeLoss = average(outcomeRows.filter((row) => row.outcome === 'loss').map((row) => row.scoreInputs.edge));
  const avgTrustWin = average(outcomeRows.filter((row) => row.outcome === 'win').map((row) => row.scoreInputs.trust));
  const avgTrustLoss = average(outcomeRows.filter((row) => row.outcome === 'loss').map((row) => row.scoreInputs.trust));

  console.log('--- Outcome-backed NBA scoring sample ---');
  console.log(`Settled NBA picks (win/loss only): ${outcomeRows.length}`);
  console.log(`Wins / losses:                    ${wins} / ${losses}`);
  console.log(`CLV-backed outcomes:              ${clvOutcomes.length}`);
  console.log(`Average edge on wins:             ${avgEdgeWin ?? 'n/a'}`);
  console.log(`Average edge on losses:           ${avgEdgeLoss ?? 'n/a'}`);
  console.log(`Average trust on wins:            ${avgTrustWin ?? 'n/a'}`);
  console.log(`Average trust on losses:          ${avgTrustLoss ?? 'n/a'}`);

  if (clvOutcomes.length < 5) {
    console.log('\n--- CLV benchmark ---');
    console.log('Not enough CLV-backed NBA outcomes yet for weight-effectiveness tuning.');
    console.log('Needed: at least 5 CLV-bearing outcomes for a weak signal, 20+ for low-confidence tuning.');
    return;
  }

  const effectiveness = analyzeWeightEffectiveness(clvOutcomes);
  const walkForward = runWalkForwardBacktest(clvOutcomes, { trainSize: 5, testSize: 2 });
  const significance = testAllComponentSignificance(clvOutcomes);

  console.log('\n--- CLV benchmark ---');
  console.log(`Sample size:                      ${effectiveness.sampleSize}`);
  console.log(`Confidence:                       ${effectiveness.confidence}`);
  console.log(`Edge correlation:                 ${effectiveness.componentCorrelations.edge.correlation}`);
  console.log(`Trust correlation:                ${effectiveness.componentCorrelations.trust.correlation}`);
  console.log(`Suggested edge weight:            ${effectiveness.suggestedAdjustments.edge}`);
  console.log(`Suggested trust weight:           ${effectiveness.suggestedAdjustments.trust}`);
  console.log(`Walk-forward windows:             ${walkForward.windowCount}`);
  console.log(`Edge stable:                      ${walkForward.edgeIsStable}`);

  console.log('\nSignificance tests:');
  for (const row of significance) {
    console.log(
      `  ${row.component}: r=${row.observedCorrelation} p=${row.pValue} significant=${row.significant}`,
    );
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
