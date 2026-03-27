import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const JB_PARTICIPANT_ID = '8c4d79d3-dbeb-41a6-a9cf-38724817012e';

  // Check picks table columns by looking at an existing pick
  const { data: samplePick } = await db.from('picks').select('*').limit(1).single();
  console.log('Pick columns:', Object.keys(samplePick ?? {}).join(', '));

  // Insert pick with correct columns
  const pickData: Record<string, unknown> = {
    source: 'smart-form',
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
  };
  // Add submitter if column exists
  if (samplePick && 'submitter' in samplePick) pickData.submitter = 'clv-proof-test';
  if (samplePick && 'submitted_by' in samplePick) pickData.submitted_by = 'clv-proof-test';
  if (samplePick && 'capper' in samplePick) pickData.capper = 'clv-proof-test';

  const { data: pick, error: pickErr } = await db.from('picks').insert(pickData).select('id, market, selection, line, odds, status').single();
  if (pickErr) { console.error('Pick insert error:', pickErr.message); return; }
  console.log(`✓ Inserted test pick: ${pick?.id}`);
  console.log(`  market=${pick?.market} sel="${pick?.selection}" line=${pick?.line} odds=${pick?.odds}`);
  console.log(`\nTest pick ID: ${pick?.id}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
