/**
 * UTV2-320: NBA pick metadata audit
 *
 * Queries live Supabase to:
 * 1. Inventory top-level metadata keys present on NBA picks
 * 2. Inventory promotion/domain-analysis subkeys
 * 3. Count commonly-needed player-prop fields
 * 4. Report what a benchmark/extraction harness can truthfully rely on
 *
 * Run: pnpm exec tsx scripts/utv2-320-nba-pick-metadata-audit.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

type PickRow = {
  id: string;
  market: string;
  metadata: Record<string, unknown> | null;
};

const COMMON_PROP_KEYS = [
  'sport',
  'eventName',
  'player',
  'team',
  'selection',
  'statType',
  'direction',
  'sportsbook',
  'line',
  'odds',
  'source',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function increment(map: Map<string, number>, key: string | null | undefined) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== UTV2-320: NBA Pick Metadata Audit ===\n');

  const { data: pickRows, error } = await db
    .from('picks')
    .select('id,market,metadata')
    .filter('metadata->>sport', 'eq', 'NBA');

  if (error) {
    throw new Error(`picks query failed: ${error.message}`);
  }

  const picks = (pickRows ?? []) as PickRow[];
  console.log(`NBA picks found: ${picks.length}`);

  const topLevelCounts = new Map<string, number>();
  const promotionScoreCounts = new Map<string, number>();
  const domainAnalysisCounts = new Map<string, number>();
  const marketCounts = new Map<string, number>();
  const propKeyPresence = new Map<string, number>();

  for (const pick of picks) {
    increment(marketCounts, pick.market);

    const metadata = asRecord(pick.metadata);
    if (!metadata) {
      continue;
    }

    for (const key of Object.keys(metadata)) {
      increment(topLevelCounts, key);
    }

    const promotionScores = asRecord(metadata.promotionScores);
    if (promotionScores) {
      for (const key of Object.keys(promotionScores)) {
        increment(promotionScoreCounts, key);
      }
    }

    const domainAnalysis = asRecord(metadata.domainAnalysis);
    if (domainAnalysis) {
      for (const key of Object.keys(domainAnalysis)) {
        increment(domainAnalysisCounts, key);
      }
    }

    for (const key of COMMON_PROP_KEYS) {
      if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') {
        increment(propKeyPresence, key);
      }
    }
  }

  console.log('\n--- Pick markets ---');
  for (const [market, count] of [...marketCounts.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${market}: ${count}`);
  }

  console.log('\n--- Top-level metadata keys ---');
  for (const [key, count] of [...topLevelCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 20)) {
    console.log(`  ${key}: ${count}`);
  }

  console.log('\n--- promotionScores keys ---');
  for (const [key, count] of [...promotionScoreCounts.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${key}: ${count}`);
  }

  if (domainAnalysisCounts.size > 0) {
    console.log('\n--- domainAnalysis keys ---');
    for (const [key, count] of [...domainAnalysisCounts.entries()].sort((left, right) => right[1] - left[1])) {
      console.log(`  ${key}: ${count}`);
    }
  }

  console.log('\n--- Common player-prop field presence ---');
  for (const key of COMMON_PROP_KEYS) {
    console.log(`  ${key}: ${propKeyPresence.get(key) ?? 0}`);
  }

  console.log('\n--- Recommendation ---');
  const hasPlayer = (propKeyPresence.get('player') ?? 0) > 0;
  const hasStatType = (propKeyPresence.get('statType') ?? 0) > 0;
  const hasLine = (propKeyPresence.get('line') ?? 0) > 0;
  const hasOdds = (propKeyPresence.get('odds') ?? 0) > 0;

  if (hasPlayer && hasStatType && hasLine && hasOdds) {
    console.log('NBA picks carry enough operator/runtime metadata to benchmark prop slices directly. Use this as the next extraction harness input.');
  } else {
    console.log('NBA pick metadata is incomplete for some prop fields. Benchmark harness should rely on market + promotionScores first, then backfill missing prop identity fields carefully.');
  }
}

main().catch((auditError) => {
  console.error('Metadata audit failed:', auditError);
  process.exit(1);
});
