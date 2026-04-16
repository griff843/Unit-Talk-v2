/**
 * Contrarian Pick Review — ops summary script
 *
 * Queries settled picks that carry a contrarySignal in metadata and
 * outputs a summary table: contrarianism level | count | win_rate | avg_clv |
 * overconfident_count | justified_count
 *
 * Usage:
 *   npx tsx scripts/ops/contrarian-review.ts
 *   npx tsx scripts/ops/contrarian-review.ts --json
 *
 * Issue: UTV2-636
 */

import { loadEnvironment } from '@unit-talk/config';
import {
  createServiceRoleDatabaseConnectionConfig,
  createDatabaseClientFromConnection,
} from '@unit-talk/db';
import { evaluateContraryVerdict, type Contrarianism, type ContrarySignal } from '@unit-talk/domain';

// ── Types ────────────────────────────────────────────────────────────────────

interface BucketStats {
  contrarianism: Contrarianism;
  count: number;
  winCount: number;
  lossCount: number;
  pushCount: number;
  winRate: number | null;
  avgClv: number | null;
  justifiedCount: number;
  overconfidentCount: number;
  inconclusiveCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readContrarySignal(metadata: Record<string, unknown> | null): ContrarySignal | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata['contrarySignal'];
  if (!isRecord(raw)) return null;
  if (
    typeof raw['contrarianism'] !== 'string' ||
    typeof raw['divergence'] !== 'number' ||
    typeof raw['direction'] !== 'string' ||
    typeof raw['marketSource'] !== 'string'
  ) return null;
  return {
    contrarianism: raw['contrarianism'] as Contrarianism,
    divergence: raw['divergence'],
    direction: raw['direction'] as ContrarySignal['direction'],
    marketSource: raw['marketSource'],
    threshold: typeof raw['threshold'] === 'number' ? raw['threshold'] : 0,
  };
}

function formatPercent(n: number | null): string {
  if (n === null || n === undefined) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function formatAvgClv(n: number | null): string {
  if (n === null || n === undefined) return 'n/a';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const jsonMode = process.argv.includes('--json');

  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  const client = createDatabaseClientFromConnection(connection);

  // Query settled picks that have a contrarySignal in metadata.
  // We use metadata->>'contrarySignal' IS NOT NULL to filter — the value is
  // stored as a JSON object so we check for the key existence.
  const { data: picks, error } = await client
    .from('picks')
    .select(`
      id,
      metadata,
      promotion_status,
      settlement_records (
        outcome,
        clv_percent
      )
    `)
    .eq('status', 'settled')
    .not('metadata->contrarySignal', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  if (!picks || picks.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ picks: 0, buckets: [] }, null, 2));
    } else {
      console.log('No contrarian settled picks found.');
    }
    return;
  }

  // ── Aggregate into buckets by contrarianism level ─────────────────────────

  const buckets = new Map<Contrarianism, {
    rows: Array<{ outcome: string | null; clvPercent: number | null; signal: ContrarySignal }>;
  }>();

  for (const pick of picks) {
    const signal = readContrarySignal(pick.metadata as Record<string, unknown> | null);
    if (!signal) continue;

    // Settlement data — Supabase returns the relation as an array
    const settlements = (pick as unknown as { settlement_records: Array<{ outcome: string | null; clv_percent: number | null }> }).settlement_records;
    const latestSettlement = Array.isArray(settlements) ? settlements[0] ?? null : null;
    const outcome = latestSettlement?.outcome ?? null;
    const clvPercent = latestSettlement?.clv_percent ?? null;

    const existing = buckets.get(signal.contrarianism) ?? { rows: [] };
    existing.rows.push({ outcome, clvPercent, signal });
    buckets.set(signal.contrarianism, existing);
  }

  // ── Build summary stats ───────────────────────────────────────────────────

  const contrariarnismOrder: Contrarianism[] = [
    'strongly-contrarian',
    'mildly-contrarian',
    'consensus-fade',
    'aligned',
  ];

  const summaries: BucketStats[] = [];

  for (const level of contrariarnismOrder) {
    const bucket = buckets.get(level);
    if (!bucket) continue;

    const { rows } = bucket;
    const count = rows.length;

    let winCount = 0;
    let lossCount = 0;
    let pushCount = 0;
    let clvSum = 0;
    let clvCount = 0;
    let justifiedCount = 0;
    let overconfidentCount = 0;
    let inconclusiveCount = 0;

    for (const { outcome, clvPercent, signal } of rows) {
      const normalizedOutcome = outcome?.toUpperCase() as 'WIN' | 'LOSS' | 'PUSH' | null ?? null;
      if (normalizedOutcome === 'WIN') winCount++;
      else if (normalizedOutcome === 'LOSS') lossCount++;
      else if (normalizedOutcome === 'PUSH') pushCount++;

      if (typeof clvPercent === 'number' && Number.isFinite(clvPercent)) {
        clvSum += clvPercent;
        clvCount++;
      }

      const verdict = evaluateContraryVerdict(signal, clvPercent ?? null, normalizedOutcome);
      if (verdict === 'justified') justifiedCount++;
      else if (verdict === 'overconfident') overconfidentCount++;
      else inconclusiveCount++;
    }

    const settledCount = winCount + lossCount; // exclude PUSH for win rate
    const winRate = settledCount > 0 ? winCount / settledCount : null;
    const avgClv = clvCount > 0 ? clvSum / clvCount : null;

    summaries.push({
      contrarianism: level,
      count,
      winCount,
      lossCount,
      pushCount,
      winRate,
      avgClv,
      justifiedCount,
      overconfidentCount,
      inconclusiveCount,
    });
  }

  // ── Output ────────────────────────────────────────────────────────────────

  if (jsonMode) {
    console.log(JSON.stringify({ total: picks.length, buckets: summaries }, null, 2));
    return;
  }

  const header = [
    'contrarianism'.padEnd(22),
    'count'.padStart(6),
    'win_rate'.padStart(9),
    'avg_clv'.padStart(9),
    'justified'.padStart(10),
    'overconfident'.padStart(14),
    'inconclusive'.padStart(13),
  ].join('  ');

  console.log('\nContrarian Pick Review');
  console.log('='.repeat(header.length));
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const s of summaries) {
    const row = [
      s.contrarianism.padEnd(22),
      String(s.count).padStart(6),
      formatPercent(s.winRate).padStart(9),
      formatAvgClv(s.avgClv).padStart(9),
      String(s.justifiedCount).padStart(10),
      String(s.overconfidentCount).padStart(14),
      String(s.inconclusiveCount).padStart(13),
    ].join('  ');
    console.log(row);
  }

  console.log('-'.repeat(header.length));
  console.log(`Total contrarian settled picks: ${picks.length}`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
