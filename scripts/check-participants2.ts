import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Check participants table columns
  const { data, error } = await db
    .from('participants')
    .select('*')
    .limit(3);

  if (error) { console.error('Error:', error.message); return; }
  console.log('Participants sample (first 3):');
  for (const p of data ?? []) {
    console.log(JSON.stringify(p, null, 2));
  }

  // Check picks with external participant
  const { data: picks, error: picksErr } = await db
    .from('picks')
    .select('id, participant_id, market, selection, odds, status')
    .eq('status', 'posted')
    .limit(5);
  if (picksErr) console.error('Picks error:', picksErr.message);
  console.log(`\nPosted picks: ${picks?.length ?? 0}`);
  for (const p of picks ?? []) {
    console.log(`  ${p.id.slice(0,8)} market="${p.market}" sel="${p.selection}" odds=${p.odds} participant=${p.participant_id?.slice(0,8)}`);
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
