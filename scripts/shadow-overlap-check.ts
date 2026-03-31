/**
 * Quick check: what data exists in V1 and V2 for shadow comparison?
 *
 * Usage: V1_SUPABASE_URL=... V1_SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/shadow-overlap-check.ts
 */
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing: ${name}`);
  return val;
}

async function main() {
  const v1 = createClient(requireEnv('V1_SUPABASE_URL'), requireEnv('V1_SUPABASE_SERVICE_ROLE_KEY'));
  const v2 = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'));

  // V1 checks
  console.log('=== V1 ===');
  const { count: picksCount, error: pe } = await v1.from('unified_picks').select('*', { count: 'exact', head: true });
  console.log('unified_picks:', picksCount ?? 0, pe ? `(error: ${pe.message})` : '');

  const { count: settCount, error: se } = await v1.from('prop_settlements').select('*', { count: 'exact', head: true });
  console.log('prop_settlements:', settCount ?? 0, se ? `(error: ${se.message})` : '');

  const { data: v1Sample } = await v1.from('unified_picks').select('id, settlement_result, settled_at, sport, player_name').not('settlement_result', 'is', null).order('settled_at', { ascending: false }).limit(3);
  console.log('V1 latest settled:', JSON.stringify(v1Sample, null, 2));

  // V2 checks
  console.log('\n=== V2 ===');
  const { count: v2Picks, error: v2pe } = await v2.from('picks').select('*', { count: 'exact', head: true });
  console.log('picks:', v2Picks ?? 0, v2pe ? `(error: ${v2pe.message})` : '');

  const { count: v2Sett, error: v2se } = await v2.from('settlement_records').select('*', { count: 'exact', head: true });
  console.log('settlement_records:', v2Sett ?? 0, v2se ? `(error: ${v2se.message})` : '');

  const { data: v2Sample } = await v2.from('settlement_records').select('id, pick_id, result, source, created_at').order('created_at', { ascending: false }).limit(3);
  console.log('V2 latest settlements:', JSON.stringify(v2Sample, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
