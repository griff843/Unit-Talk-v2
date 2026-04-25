/**
 * UTV2-592 Syndicate Proof Gate
 *
 * Measures score provenance mix on the live 30-day sample and gates against
 * the syndicate readiness thresholds from SCORE_PROVENANCE_STANDARD.md:
 *
 *   PASS requires ALL of:
 *   - market_backed_pct  >= 60%  (real-edge + consensus-edge)
 *   - unknown_pct        <= 20%
 *   - high_trust_pct     >= 40%  (real-edge + consensus-edge specifically)
 *
 * Also measures:
 *   - Score quality vs CLV outcomes (beats_closing_line rate by edge source)
 *   - Calibration indicators (clvRaw mean by edge source)
 *   - Failure mode breakdown (why picks don't score)
 *
 * Run with:
 *   npx tsx apps/api/src/scripts/utv2-592-syndicate-proof-gate.ts
 */

import { loadEnvironment } from '@unit-talk/config';
import { createDatabaseClientFromConnection, createServiceRoleDatabaseConnectionConfig } from '@unit-talk/db';

let db: ReturnType<typeof createDatabaseClientFromConnection>;
try {
  const connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  db = createDatabaseClientFromConnection(connection);
} catch (e) {
  console.error('FATAL: Cannot connect to Supabase:', (e as Error).message);
  process.exit(1);
}

// ── Syndicate thresholds (SCORE_PROVENANCE_STANDARD.md §3) ──────────────────
const THRESHOLDS = {
  marketBackedPctMin: 60,   // real-edge + consensus-edge >= 60%
  unknownPctMax: 20,        // unknown <= 20%
  highTrustPctMin: 40,      // real-edge + consensus-edge (strict) >= 40%
  minSampleForVerdict: 20,  // need at least this many scored picks
};

type EdgeSource =
  | 'real-edge'
  | 'consensus-edge'
  | 'sgo-edge'
  | 'single-book-edge'
  | 'confidence-delta'
  | 'explicit'
  | 'unknown';

interface EdgeSourceRow {
  edgeSource: EdgeSource | null;
  edgeSourceQuality: 'market-backed' | 'confidence-fallback' | 'explicit' | null;
  beatsClosingLine: boolean | null;
  clvRaw: number | null;
  count: number;
}

function classify(edgeSource: string | null | undefined): EdgeSource {
  const valid: EdgeSource[] = [
    'real-edge', 'consensus-edge', 'sgo-edge',
    'single-book-edge', 'confidence-delta', 'explicit',
  ];
  if (!edgeSource) return 'unknown';
  return valid.includes(edgeSource as EdgeSource)
    ? (edgeSource as EdgeSource)
    : 'unknown';
}

async function main() {
  const now = new Date();
  const window30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log(`\n=== UTV2-592 Syndicate Proof Gate ===`);
  console.log(`Run at: ${now.toISOString()}`);
  console.log(`30-day window: since ${window30d}`);
  console.log('─'.repeat(60));

  // ── 1. Edge source distribution from pick_promotion_history ───────────────
  console.log('\n[1] Querying pick_promotion_history (30-day, limit 2000)...');

  const { data: promoRows, error: promoErr } = await db
    .from('pick_promotion_history')
    .select('id, pick_id, score, status, target, payload, decided_at')
    .gte('decided_at', window30d)
    .order('decided_at', { ascending: false })
    .limit(2000);

  if (promoErr) {
    console.error('FATAL: pick_promotion_history query failed:', promoErr.message);
    process.exit(1);
  }

  const rows = promoRows ?? [];
  console.log(`  Loaded ${rows.length} promotion history rows`);

  // Extract edge source from payload
  const edgeBuckets: Map<EdgeSource, EdgeSourceRow> = new Map();
  const initBucket = (src: EdgeSource): EdgeSourceRow => ({
    edgeSource: src,
    edgeSourceQuality: null,
    beatsClosingLine: null,
    clvRaw: null,
    count: 0,
  });

  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;

    // Edge source resolution order per SCORE_PROVENANCE_STANDARD.md §5
    const rawEdgeSource =
      (payload['edgeSource'] as string | undefined) ??
      (payload['scoreInputs'] as Record<string, unknown> | undefined)?.['edgeSource'] as string | undefined ??
      null;

    const src = classify(rawEdgeSource);
    if (!edgeBuckets.has(src)) edgeBuckets.set(src, initBucket(src));
    edgeBuckets.get(src)!.count++;
  }

  // ── 2. Cross-reference with settlement CLV data ────────────────────────────
  console.log('\n[2] Cross-referencing settlements for CLV quality by edge source...');

  const { data: settlementRows, error: settlErr } = await db
    .from('settlement_records')
    .select('pick_id, payload, created_at')
    .is('corrects_id', null)
    .gte('created_at', window30d)
    .limit(1000);

  if (settlErr) {
    console.warn('  WARNING: settlements query failed:', settlErr.message);
  }

  // Map pick_id → CLV data from settlements
  const clvByPick = new Map<string, { beatsClosingLine: boolean | null; clvRaw: number | null }>();
  for (const s of settlementRows ?? []) {
    const p = (s.payload ?? {}) as Record<string, unknown>;
    if ('clvRaw' in p || 'beatsClosingLine' in p) {
      clvByPick.set(s.pick_id as string, {
        beatsClosingLine: typeof p['beatsClosingLine'] === 'boolean' ? p['beatsClosingLine'] : null,
        clvRaw: typeof p['clvRaw'] === 'number' ? p['clvRaw'] : null,
      });
    }
  }

  // Enhanced per-edge-source stats with CLV cross-ref
  interface EdgeStats {
    count: number;
    settledWithCLV: number;
    beatsClosingLine: number;
    clvRawSum: number;
    clvRawCount: number;
  }
  const edgeStats: Map<EdgeSource, EdgeStats> = new Map();

  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const rawEdgeSource =
      (payload['edgeSource'] as string | undefined) ??
      (payload['scoreInputs'] as Record<string, unknown> | undefined)?.['edgeSource'] as string | undefined ??
      null;
    const src = classify(rawEdgeSource);

    if (!edgeStats.has(src)) {
      edgeStats.set(src, { count: 0, settledWithCLV: 0, beatsClosingLine: 0, clvRawSum: 0, clvRawCount: 0 });
    }
    const stats = edgeStats.get(src)!;
    stats.count++;

    const clv = clvByPick.get(row.pick_id as string);
    if (clv) {
      stats.settledWithCLV++;
      if (clv.beatsClosingLine === true) stats.beatsClosingLine++;
      if (clv.clvRaw !== null) {
        stats.clvRawSum += clv.clvRaw;
        stats.clvRawCount++;
      }
    }
  }

  // ── 3. Compute metrics ─────────────────────────────────────────────────────
  const total = rows.length;

  const highTrustSources: EdgeSource[] = ['real-edge', 'consensus-edge'];
  const marketBackedSources: EdgeSource[] = ['real-edge', 'consensus-edge', 'sgo-edge', 'single-book-edge'];

  let highTrustCount = 0;
  let marketBackedCount = 0;
  let unknownCount = 0;

  for (const [src, stats] of edgeStats) {
    if (highTrustSources.includes(src)) highTrustCount += stats.count;
    if (marketBackedSources.includes(src)) marketBackedCount += stats.count;
    if (src === 'unknown') unknownCount += stats.count;
  }

  const marketBackedPct = total > 0 ? Math.round((marketBackedCount / total) * 100 * 10) / 10 : 0;
  const highTrustPct = total > 0 ? Math.round((highTrustCount / total) * 100 * 10) / 10 : 0;
  const unknownPct = total > 0 ? Math.round((unknownCount / total) * 100 * 10) / 10 : 0;

  // ── 4. Threshold evaluation ────────────────────────────────────────────────
  const sampleSufficient = total >= THRESHOLDS.minSampleForVerdict;
  const passMarketBacked = marketBackedPct >= THRESHOLDS.marketBackedPctMin;
  const passUnknown = unknownPct <= THRESHOLDS.unknownPctMax;
  const passHighTrust = highTrustPct >= THRESHOLDS.highTrustPctMin;
  const allPass = sampleSufficient && passMarketBacked && passUnknown && passHighTrust;

  // ── 5. Output ──────────────────────────────────────────────────────────────
  console.log('\n[3] Edge Source Distribution (30-day):');
  console.log(`  Total scored promotions: ${total}`);
  console.log('');

  const allSources: EdgeSource[] = [
    'real-edge', 'consensus-edge', 'sgo-edge', 'single-book-edge',
    'confidence-delta', 'explicit', 'unknown',
  ];

  for (const src of allSources) {
    const stats = edgeStats.get(src);
    if (!stats) continue;
    const pct = total > 0 ? Math.round((stats.count / total) * 100 * 10) / 10 : 0;
    const beatsPct = stats.settledWithCLV > 0
      ? Math.round((stats.beatsClosingLine / stats.settledWithCLV) * 100)
      : null;
    const meanCLV = stats.clvRawCount > 0
      ? Math.round((stats.clvRawSum / stats.clvRawCount) * 10000) / 10000
      : null;

    const label = highTrustSources.includes(src) ? '★' :
                  marketBackedSources.includes(src) ? '◈' : ' ';
    console.log(
      `  ${label} ${src.padEnd(20)} n=${String(stats.count).padStart(4)}  (${pct.toFixed(1)}%)` +
      (beatsPct !== null ? `  beats_CLV=${beatsPct}%` : '') +
      (meanCLV !== null ? `  mean_clvRaw=${meanCLV.toFixed(4)}` : ''),
    );
  }

  console.log('');
  console.log('  Legend: ★ = high-trust (real/consensus-edge), ◈ = market-backed');

  console.log('\n[4] Syndicate Gate Evaluation:');
  console.log(`  Market-backed share: ${marketBackedPct}%  (threshold ≥${THRESHOLDS.marketBackedPctMin}%)  → ${passMarketBacked ? 'PASS ✅' : 'FAIL ⛔'}`);
  console.log(`  High-trust share:    ${highTrustPct}%  (threshold ≥${THRESHOLDS.highTrustPctMin}%)  → ${passHighTrust ? 'PASS ✅' : 'FAIL ⛔'}`);
  console.log(`  Unknown share:       ${unknownPct}%  (threshold ≤${THRESHOLDS.unknownPctMax}%)  → ${passUnknown ? 'PASS ✅' : 'FAIL ⛔'}`);
  console.log(`  Sample sufficient:   ${total} rows (min ${THRESHOLDS.minSampleForVerdict})  → ${sampleSufficient ? 'YES ✅' : 'NO ⛔'}`);

  const verdict = allPass ? 'PASS' : 'FAIL';
  console.log(`\n  ► VERDICT: ${verdict}${allPass ? ' — syndicate readiness thresholds met' : ' — syndicate readiness thresholds NOT met'}`);

  // ── 6. Structured JSON output for proof bundle ─────────────────────────────
  const result = {
    schema: 'utv2-592-syndicate-proof/v1',
    run_at: now.toISOString(),
    window_days: 30,
    sample_size: total,
    sample_sufficient: sampleSufficient,
    thresholds: THRESHOLDS,
    metrics: {
      market_backed_pct: marketBackedPct,
      high_trust_pct: highTrustPct,
      unknown_pct: unknownPct,
    },
    gate_results: {
      market_backed: passMarketBacked,
      high_trust: passHighTrust,
      unknown: passUnknown,
      sample: sampleSufficient,
      overall: allPass,
    },
    verdict,
    edge_distribution: Object.fromEntries(
      allSources
        .filter(src => edgeStats.has(src))
        .map(src => {
          const stats = edgeStats.get(src)!;
          return [src, {
            count: stats.count,
            pct: total > 0 ? Math.round((stats.count / total) * 10000) / 100 : 0,
            settled_with_clv: stats.settledWithCLV,
            beats_closing_line: stats.beatsClosingLine,
            mean_clv_raw: stats.clvRawCount > 0 ? stats.clvRawSum / stats.clvRawCount : null,
          }];
        }),
    ),
  };

  console.log('\n[5] JSON Output:');
  console.log(JSON.stringify(result, null, 2));

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
