import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const JB_PARTICIPANT_ID = '8c4d79d3-dbeb-41a6-a9cf-38724817012e';
  const KNICKS_NETS_EVENT_ID = '1c582d4b-97af-4f62-9861-a5026a8ab258';
  const KNICKS_NETS_EXT_ID = 'eIhf34I2IG6xAxWn0OgM';

  // 1. Check provider_offers for Knicks vs Nets + Jalen Brunson
  const { data: offers, error: offerErr } = await db.from('provider_offers')
    .select('id, provider_event_id, provider_market_key, provider_participant_id, snapshot_at, over_odds, under_odds, is_closing')
    .eq('provider_event_id', KNICKS_NETS_EXT_ID)
    .eq('provider_participant_id', 'JALEN_BRUNSON_1_NBA')
    .limit(10);
  if (offerErr) { console.error('Offer error:', offerErr.message); return; }
  console.log(`Provider offers for JB in Knicks vs Nets: ${offers?.length ?? 0}`);
  for (const o of offers ?? []) {
    console.log(`  ${o.id.slice(0,8)} market=${o.provider_market_key} snapshot=${o.snapshot_at?.slice(0,19)} over=${o.over_odds} under=${o.under_odds} closing=${o.is_closing}`);
  }

  // Get the closing offer for assists-all-game-ou
  const closingOffer = (offers ?? []).find(o => o.provider_market_key === 'assists-all-game-ou' && o.is_closing);
  const anyOffer = (offers ?? []).find(o => o.provider_market_key === 'assists-all-game-ou');
  const offer = closingOffer ?? anyOffer;
  console.log(`\nClosing/latest offer for assists-all-game-ou: ${offer ? `over=${offer.over_odds} under=${offer.under_odds}` : 'NONE'}`);

  if (!offer) {
    console.log('\nNo provider offer found for this game. CLV will be null/skipped.');
    return;
  }

  // 2. Insert a test pick for Jalen Brunson, assists-all-game-ou, Under 9.5 (actual was 8, so Under wins)
  // Actual value was 8, so Player Under 9.5 wins
  const { data: pick, error: pickErr } = await db.from('picks').insert({
    source: 'smart-form',
    submitted_by: 'clv-proof-test',
    participant_id: JB_PARTICIPANT_ID,
    market: 'assists-all-game-ou',
    selection: 'Player Under 9.5',
    line: 9.5,
    odds: Number(offer.under_odds ?? -115),
    stake_units: 1,
    status: 'posted',
    posted_at: new Date().toISOString(),
    metadata: {
      promotionScores: { trust: 80, edge: 70, readiness: 80, uniqueness: 70, boardFit: 70 },
      confidence: 0.8,
      source: 'clv-proof-test',
    },
  }).select('id, participant_id, market, selection, line, odds, status').single();
  if (pickErr) { console.error('Pick insert error:', pickErr.message); return; }
  console.log(`\n✓ Inserted test pick: ${pick?.id}`);
  console.log(`  participant_id=${pick?.participant_id?.slice(0,8)} market=${pick?.market} sel="${pick?.selection}" line=${pick?.line} odds=${pick?.odds} status=${pick?.status}`);

  // 3. Insert pick_lifecycle row (posted)
  const { error: lcErr } = await db.from('pick_lifecycle').insert({
    pick_id: pick!.id,
    from_state: 'validated',
    to_state: 'posted',
    transitioned_by: 'clv-proof-test',
  });
  if (lcErr) console.log(`  lifecycle insert warning: ${lcErr.message}`);

  console.log('\nReady to grade. Run: POST http://localhost:3000/api/grading/run');
  console.log(`Pick ID for verification: ${pick?.id}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
