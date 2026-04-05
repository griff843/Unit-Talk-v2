/**
 * UTV2-320: NBA prop segment benchmark
 *
 * Uses settled NBA picks to:
 * 1. Segment player props by stat type / market label
 * 2. Compare win rates and average trust / edge by segment
 * 3. Identify the first realistic NBA prop families to benchmark further
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-prop-segment-benchmark.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';
import { buildSegmentReadinessResult } from '../packages/domain/src/models/segment-readiness.ts';

type PickRow = {
  id: string;
  market: string;
  metadata: Record<string, unknown> | null;
};

type SettlementRow = {
  pick_id: string;
  result: 'win' | 'loss' | 'push' | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function deriveSegmentLabel(pick: PickRow) {
  const metadata = asRecord(pick.metadata);
  const statType = readString(metadata, 'statType');
  const marketType = readString(metadata, 'marketType');

  if (statType) {
    return statType;
  }

  if (marketType === 'player-prop') {
    return pick.market;
  }

  return marketType ?? pick.market;
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Prop Segment Benchmark ===\n');

  const { data: pickRows, error: picksError } = await db
    .from('picks')
    .select('id,market,metadata')
    .filter('metadata->>sport', 'eq', 'NBA');

  if (picksError) {
    throw new Error(`picks query failed: ${picksError.message}`);
  }

  const picks = (pickRows ?? []) as PickRow[];
  const pickIds = picks.map((pick) => pick.id);

  if (pickIds.length === 0) {
    console.log('No NBA picks found.');
    return;
  }

  const { data: settlementRows, error: settlementError } = await db
    .from('settlement_records')
    .select('pick_id,result')
    .in('pick_id', pickIds);

  if (settlementError) {
    throw new Error(`settlement_records query failed: ${settlementError.message}`);
  }

  const settlementByPickId = new Map(
    ((settlementRows ?? []) as SettlementRow[])
      .filter((row) => row.result === 'win' || row.result === 'loss')
      .map((row) => [row.pick_id, row.result as 'win' | 'loss']),
  );

  const rows: Array<{ segment: string; outcome: 'win' | 'loss'; trust?: number | null; edge?: number | null }> = [];

  for (const pick of picks) {
    const result = settlementByPickId.get(pick.id);
    if (!result) {
      continue;
    }

    const metadata = asRecord(pick.metadata);
    const promotionScores = asRecord(metadata?.promotionScores);
    const domainAnalysis = asRecord(metadata?.domainAnalysis);
    const trust =
      readNumber(promotionScores, 'trust') ??
      readNumber(domainAnalysis, 'trust') ??
      null;
    const edge =
      readNumber(promotionScores, 'edge') ??
      readNumber(domainAnalysis, 'edge') ??
      readNumber(metadata, 'realEdge') ??
      null;

    const label = deriveSegmentLabel(pick);
    rows.push({ segment: label, outcome: result, trust, edge });
  }

  const readiness = buildSegmentReadinessResult(rows, { minimumSample: 2, limit: 3 });
  const aggregates = readiness.summaries;

  console.log('--- Segments with settled NBA outcomes ---');
  if (aggregates.length === 0) {
    console.log('No settled NBA segments available yet.');
    return;
  }

  for (const segment of aggregates) {
    console.log(
      `${segment.segment} | picks=${segment.picks} | wins=${segment.wins} | losses=${segment.losses} | winRate=${segment.winRate}% | avgTrust=${segment.avgTrust ?? 'n/a'} | avgEdge=${segment.avgEdge ?? 'n/a'}`,
    );
  }

  console.log('\n--- Recommendation ---');
  if (readiness.benchmarkCandidates.length === 0) {
    console.log('Settled NBA sample is still too thin for segment-level claims. Keep accumulating picks while using this report to watch for emerging prop families.');
    return;
  }

  console.log(
    `First benchmark candidates: ${readiness.benchmarkCandidates
      .map((segment) => segment.segment)
      .join(', ')}`,
  );
}

main().catch((error) => {
  console.error('Segment benchmark failed:', error);
  process.exit(1);
});
