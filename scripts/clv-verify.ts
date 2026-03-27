import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const PICK_ID = '3f8e9119-5a7a-40dd-abae-360a33348920';

  const { data: settlement, error } = await db
    .from('settlement_records')
    .select('id, pick_id, payload, created_at')
    .eq('pick_id', PICK_ID)
    .single();

  if (error || !settlement) { console.error('Settlement not found:', error?.message); return; }

  const p = settlement.payload as Record<string,unknown>;
  const keys = Object.keys(p);
  console.log('=== UTV2-48 CLV Live Proof — AC-4 ===\n');
  console.log(`Settlement ID: ${settlement.id}`);
  console.log(`Pick ID: ${settlement.pick_id}`);
  console.log(`Created: ${settlement.created_at?.slice(0,19)}`);
  console.log(`Payload keys: [${keys.join(', ')}]`);
  console.log('');
  console.log(`clvRaw present: ${'clvRaw' in p}`);
  console.log(`clvPercent present: ${'clvPercent' in p}`);
  console.log(`beatsClosingLine present: ${'beatsClosingLine' in p}`);
  console.log('');

  if ('clvRaw' in p) {
    console.log(`✓ AC-4 PASS`);
    console.log(`  clvRaw = ${p.clvRaw}`);
    console.log(`  clvPercent = ${p.clvPercent}`);
    console.log(`  beatsClosingLine = ${p.beatsClosingLine}`);
    console.log(`  pickOdds = ${(p as Record<string,unknown> & {clv?: Record<string,unknown>}).clv ? JSON.stringify(p.clv) : p.pickOdds}`);
    console.log('');
    console.log('Full payload:');
    console.log(JSON.stringify(p, null, 2));
  } else {
    console.log(`✗ AC-4 FAIL — clvRaw key absent from payload`);
    console.log('Full payload:', JSON.stringify(p, null, 2));
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
