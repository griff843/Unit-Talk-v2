import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const KNICKS_HORNETS_EXT = 'bIUrzoAFiGovbutrHC2e';
  const JB_EXT = 'JALEN_BRUNSON_1_NBA';
  const HORNETS_EVENT_ID = 'a003026a-bc03-48f7-8fa3-e3135fd865e2';
  const JB_PARTICIPANT_ID = '8c4d79d3-dbeb-41a6-a9cf-38724817012e';

  // Get all offers for JB in the Hornets game
  const { data: offers, error } = await db.from('provider_offers')
    .select('id, provider_event_id, provider_market_key, provider_participant_id, snapshot_at, over_odds, under_odds, line, is_closing, provider_key')
    .eq('provider_event_id', KNICKS_HORNETS_EXT)
    .eq('provider_participant_id', JB_EXT)
    .order('snapshot_at', { ascending: false });
  if (error) { console.error('Error:', error.message); return; }
  console.log(`Offers for JB in Hornets game: ${offers?.length ?? 0}`);
  for (const o of offers ?? []) {
    console.log(`  ${o.id.slice(0,8)} market=${o.provider_market_key} line=${o.line} over=${o.over_odds} under=${o.under_odds} snapshot=${o.snapshot_at?.slice(0,19)} closing=${o.is_closing}`);
  }

  // Game starts at 2026-03-26T23:00:00.000Z — offers need snapshot_at < that
  const eventStart = '2026-03-26T23:00:00.000Z';
  const preGameOffers = (offers ?? []).filter(o => o.snapshot_at < eventStart);
  console.log(`\nPre-game offers (snapshot_at < ${eventStart}): ${preGameOffers.length}`);

  const closingOffer = preGameOffers.find(o => o.is_closing && o.provider_market_key === 'assists-all-game-ou');
  const assistsOffer = preGameOffers.find(o => o.provider_market_key === 'assists-all-game-ou');
  console.log(`Assists-all-game-ou offer: ${assistsOffer ? `over=${assistsOffer.over_odds} under=${assistsOffer.under_odds} line=${assistsOffer.line}` : 'NONE'}`);

  // Insert synthetic game_result for JB in Hornets event
  if (assistsOffer) {
    console.log('\nInserting synthetic game_result for JB in Hornets event...');
    // JB had ~8 assists vs Hornets (use 8 for realism)
    const { data: gr, error: grErr } = await db.from('game_results').insert({
      event_id: HORNETS_EVENT_ID,
      participant_id: JB_PARTICIPANT_ID,
      market_key: 'assists-all-game-ou',
      actual_value: 8,
      sourced_at: new Date().toISOString(),
      source: 'clv-proof-synthetic',
      metadata: { note: 'synthetic for UTV2-48 CLV proof' },
    }).select('id').single();
    if (grErr) { console.error('game_result insert error:', grErr.message); return; }
    console.log(`✓ Inserted game_result: ${gr?.id}`);
  }

  // Insert posted pick for JB, assists-all-game-ou, Over 5.5 
  // Using a line of 5.5 and Over selection (actual 8 > 5.5 → Over wins)
  const targetOffer = preGameOffers.find(o => o.provider_market_key === 'assists-all-game-ou');
  if (!targetOffer) { console.log('No assists offer found, cannot insert pick'); return; }

  const { data: pick, error: pickErr } = await db.from('picks').insert({
    source: 'smart-form',
    submitted_by: 'clv-proof-test',
    participant_id: JB_PARTICIPANT_ID,
    market: 'assists-all-game-ou',
    selection: 'Player Over 5.5',
    line: targetOffer.line ?? 5.5,
    odds: Number(targetOffer.over_odds ?? -112),
    stake_units: 1,
    status: 'posted',
    posted_at: new Date().toISOString(),
    metadata: {
      promotionScores: { trust: 80, edge: 70, readiness: 80, uniqueness: 70, boardFit: 70 },
      confidence: 0.8,
      eventName: 'New York Knicks vs. Charlotte Hornets',
      source: 'clv-proof-test',
    },
  }).select('id, market, selection, line, odds, status, participant_id').single();
  if (pickErr) { console.error('Pick insert error:', pickErr.message); return; }
  console.log(`\n✓ Inserted test pick: ${pick?.id}`);
  console.log(`  market=${pick?.market} sel="${pick?.selection}" line=${pick?.line} odds=${pick?.odds} participant_id=${pick?.participant_id?.slice(0,8)}`);
  console.log(`\nReady to grade. Pick ID: ${pick?.id}`);
  console.log('Run: npx tsx scripts/clv-grade.ts');
}

main().catch(e => { console.error(String(e)); process.exit(1); });
