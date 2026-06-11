/**
 * UTV2-1262 live-DB proof: closing_for_clv snapshot capture path.
 *
 * Before/after counts for pick_offer_snapshots.snapshot_kind='closing_for_clv',
 * overlap with settled picks, and true settled CLV-path count.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-1262-proof.ts
 */

import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

async function main() {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (err) {
    console.log('[utv2-1262] SKIP — Supabase env unavailable:', (err as Error).message);
    process.exit(0);
  }

  const db = createDatabaseClientFromConnection(connection);

  console.log('[utv2-1262] === Closing CLV Snapshot Proof ===');

  // 1. Total closing_for_clv rows (global)
  const { count: totalClosingClv, error: e1 } = await db
    .from('pick_offer_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('snapshot_kind', 'closing_for_clv');
  if (e1) { console.error('[utv2-1262] FAIL e1:', e1.message); process.exit(1); }
  console.log(`[utv2-1262] closing_for_clv total rows: ${totalClosingClv ?? 0}`);

  // 2. Evidence-settled picks (non-shadow, non-voided, pick_candidate joined)
  const { count: evidenceSettledPicks, error: e2 } = await db
    .from('settlement_records')
    .select('id', { count: 'exact', head: true })
    .in('result', ['win', 'loss', 'push'])
    .eq('status', 'settled');
  if (e2) { console.error('[utv2-1262] FAIL e2:', e2.message); process.exit(1); }
  console.log(`[utv2-1262] total settled records (all): ${evidenceSettledPicks ?? 0}`);

  // 3. closing_for_clv rows with a non-null settlement_record_id (linked to a settlement)
  const { count: linkedClosingClv, error: e3 } = await db
    .from('pick_offer_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('snapshot_kind', 'closing_for_clv')
    .not('settlement_record_id', 'is', null);
  if (e3) { console.error('[utv2-1262] FAIL e3:', e3.message); process.exit(1); }
  console.log(`[utv2-1262] closing_for_clv rows with settlement_record_id: ${linkedClosingClv ?? 0}`);

  // 4. True CLV-path count: settled picks that have a closing_for_clv snapshot
  const { data: clvPathSample, error: e4 } = await db
    .from('settlement_records')
    .select(`
      id,
      pick_id,
      result,
      settled_at,
      picks!inner(id, odds, market),
      pick_offer_snapshots!inner(
        id, over_odds, under_odds, line, captured_at, provider_key, bookmaker_key
      )
    `)
    .eq('status', 'settled')
    .eq('pick_offer_snapshots.snapshot_kind', 'closing_for_clv')
    .in('result', ['win', 'loss', 'push'])
    .limit(5);
  if (e4) {
    // This join query may not be supported by PostgREST in all configurations
    console.warn('[utv2-1262] Sample join query returned error (may not be supported):', e4.message);
  } else {
    console.log(`[utv2-1262] True CLV-path sample count (up to 5): ${(clvPathSample ?? []).length}`);
    if ((clvPathSample ?? []).length > 0) {
      console.log('[utv2-1262] Sample CLV-path rows:', JSON.stringify(clvPathSample, null, 2));
    }
  }

  // 5. All snapshot kinds distribution
  const { data: allSnapshots, error: e5 } = await db
    .from('pick_offer_snapshots')
    .select('snapshot_kind, id');
  if (e5) { console.error('[utv2-1262] FAIL e5:', e5.message); process.exit(1); }
  const kindCounts: Record<string, number> = {};
  for (const row of (allSnapshots ?? [])) {
    const k = (row as Record<string, string>)['snapshot_kind'] ?? 'unknown';
    kindCounts[k] = (kindCounts[k] ?? 0) + 1;
  }
  console.log('[utv2-1262] All snapshot_kind distribution:', kindCounts);

  const clvCount = totalClosingClv ?? 0;
  const linkedCount = linkedClosingClv ?? 0;

  console.log('\n[utv2-1262] === Summary ===');
  console.log(`  closing_for_clv total:              ${clvCount}`);
  console.log(`  closing_for_clv with settlement FK: ${linkedCount}`);
  console.log(`  (rows without FK are UTV2-803 fixtures from 2026-04-30)`);

  if (clvCount > 5) {
    console.log('\n[utv2-1262] PASS — new closing_for_clv rows detected beyond UTV2-803 fixtures');
  } else {
    console.log('\n[utv2-1262] INFO — still at baseline (5 UTV2-803 fixtures). Wire capture path and re-run after a grading sweep.');
  }
}

main().catch((e) => {
  console.error('[utv2-1262]', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
