/**
 * UTV2-384: Auto-settle E2E proof script
 * Checks DB state for SGO grading pipeline readiness:
 * - game_results rows (source, market_key, actual_value)
 * - provider_offers SGO count + latest snapshot
 * - open picks that could be auto-settled
 * - settlement_records with source='sgo' (if any)
 */
import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log('\n=== UTV2-384: Auto-settle pipeline DB state ===\n');

  // game_results
  const gr = await db
    .from('game_results')
    .select('market_key,actual_value,source,sourced_at')
    .order('sourced_at', { ascending: false })
    .limit(10);
  console.log(`game_results rows: ${gr.data?.length ?? 0}`);
  if (gr.data?.length) {
    for (const r of gr.data) {
      console.log(`  ${r.market_key} | value=${r.actual_value} | source=${r.source} | ${r.sourced_at}`);
    }
  }

  // provider_offers SGO
  const poCount = await db
    .from('provider_offers')
    .select('id', { count: 'exact', head: true })
    .eq('provider_key', 'sgo');
  console.log(`\nprovider_offers (sgo): ${poCount.count ?? 0} rows`);

  // Latest SGO snapshot
  const poLatest = await db
    .from('provider_offers')
    .select('snapshot_at,provider_market_key,is_opening,is_closing')
    .eq('provider_key', 'sgo')
    .order('snapshot_at', { ascending: false })
    .limit(3);
  if (poLatest.data?.length) {
    for (const r of poLatest.data) {
      console.log(`  latest: ${r.provider_market_key} | opening=${r.is_opening} closing=${r.is_closing} | ${r.snapshot_at}`);
    }
  }

  // Open picks
  const picks = await db
    .from('picks')
    .select('id,status,market_key,source,created_at')
    .in('status', ['validated', 'queued', 'posted'])
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(`\nopen picks (validated/queued/posted): ${picks.data?.length ?? 0}`);
  if (picks.data?.length) {
    for (const p of picks.data) {
      console.log(`  ${p.id.slice(0, 8)} | ${p.status} | ${p.market_key} | source=${p.source}`);
    }
  }

  // Auto-settlement records (source = 'grading', backed by SGO game_results)
  const autoSettle = await db
    .from('settlement_records')
    .select('id,pick_id,result,source,created_at')
    .eq('source', 'grading')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log(`\nauto-settlement records (source='grading'): ${autoSettle.data?.length ?? 0}`);
  if (autoSettle.data?.length) {
    for (const r of autoSettle.data) {
      console.log(`  ${r.id.slice(0, 8)} | pick=${r.pick_id.slice(0, 8)} | result=${r.result} | ${r.created_at}`);
    }
  }

  // All settlement records for context
  const allSettle = await db
    .from('settlement_records')
    .select('source,result', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(20);
  console.log(`\nall settlement_records: ${allSettle.data?.length ?? 0} (recent)`);
  const bySource: Record<string, number> = {};
  for (const r of allSettle.data ?? []) {
    bySource[r.source ?? 'null'] = (bySource[r.source ?? 'null'] ?? 0) + 1;
  }
  console.log('  by source:', JSON.stringify(bySource));

  console.log('\n=== Verdict ===');
  const hasGameResults = (gr.data?.length ?? 0) > 0;
  const hasSGOOffers = (poCount.count ?? 0) > 0;
  const hasOpenPicks = (picks.data?.length ?? 0) > 0;
  const hasAutoSettle = (autoSettle.data?.length ?? 0) > 0;

  if (!hasSGOOffers) console.log('⚠  No SGO provider_offers yet — backfill still running or ingestor not run');
  if (!hasGameResults) console.log('⚠  No game_results yet — need finalized SGO events with scoringSupported=true');
  if (!hasOpenPicks) console.log('⚠  No open picks to auto-settle');
  if (hasAutoSettle) console.log('✓  Auto-settlement records with source=grading FOUND — pipeline working!');
  if (hasGameResults && !hasAutoSettle) console.log('→  game_results exist but no grading auto-settlements yet — run POST /api/grading/run');
  if (hasGameResults && hasOpenPicks) console.log('→  Ready to attempt grading: game_results + open picks both present');
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
