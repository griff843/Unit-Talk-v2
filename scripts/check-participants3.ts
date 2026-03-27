import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Find players (not teams) with SGO-format external_id
  const { data: sgoPlayers, error } = await db
    .from('participants')
    .select('id, external_id, display_name, participant_type')
    .like('external_id', '%NBA%')
    .not('external_id', 'like', 'team:%')
    .limit(10);

  if (error) { console.error('Error:', error.message); return; }
  console.log(`Players with NBA external_id (non-team): ${sgoPlayers?.length ?? 0}`);
  for (const p of sgoPlayers ?? []) {
    console.log(`  ${p.display_name}: ${p.external_id} (${p.participant_type})`);
  }

  // Check if any participant external_id matches SGO format
  const { data: sgoFormat } = await db
    .from('participants')
    .select('id, external_id, display_name')
    .like('external_id', '%_1_NBA%')
    .limit(5);
  console.log(`\nSGO-format (X_1_NBA) external_ids: ${sgoFormat?.length ?? 0}`);
  for (const p of sgoFormat ?? []) {
    console.log(`  ${p.display_name}: ${p.external_id}`);
  }

  // Total participants by type
  for (const type of ['player', 'team', 'league', 'event']) {
    const { count } = await db.from('participants').select('*', { count: 'exact', head: true }).eq('participant_type', type);
    console.log(`\n${type}: ${count ?? 0}`);
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
