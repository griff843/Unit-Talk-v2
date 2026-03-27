import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const HORNETS_EVENT_ID = 'a003026a-bc03-48f7-8fa3-e3135fd865e2';
  const JB_PARTICIPANT_ID = '8c4d79d3-dbeb-41a6-a9cf-38724817012e';

  // Insert synthetic game_result for JB in Hornets event
  // Actual assists: 8 (reasonable for JB vs Hornets 2026-03-26)
  const { data: gr, error: grErr } = await db.from('game_results').insert({
    event_id: HORNETS_EVENT_ID,
    participant_id: JB_PARTICIPANT_ID,
    market_key: 'assists-all-game-ou',
    actual_value: 8,
    sourced_at: new Date().toISOString(),
    source: 'clv-proof-synthetic',
  }).select('id').single();
  if (grErr) { console.error('game_result insert error:', grErr.message); return; }
  console.log(`✓ Inserted game_result: ${gr?.id}`);

  // Insert posted pick for JB: Over 6.5 assists at -139 (actual 8 → Over wins)
  const { data: pick, error: pickErr } = await db.from('picks').insert({
    source: 'smart-form',
    submitter: 'clv-proof-test',
    participant_id: JB_PARTICIPANT_ID,
    market: 'assists-all-game-ou',
    selection: 'Player Over 6.5',
    line: 6.5,
    odds: -139,
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
  console.log(`✓ Inserted test pick: ${pick?.id}`);
  console.log(`  market=${pick?.market} sel="${pick?.selection}" line=${pick?.line} odds=${pick?.odds}`);
  console.log(`\nTest pick ID: ${pick?.id}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
