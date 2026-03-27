import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const s = await db.from('settlement_records').select('id,created_at,pick_id').order('created_at',{ascending:false}).limit(5);
  console.log('settlements err:', s.error?.message ?? 'none', 'count:', s.data?.length ?? 0);
  if (s.data?.length) console.log('  latest:', s.data[0].id.slice(0,8), s.data[0].created_at?.slice(0,19));
  const p = await db.from('picks').select('id,status').eq('status','posted').limit(5);
  console.log('posted picks err:', p.error?.message ?? 'none', 'count:', p.data?.length ?? 0);
  const g = await db.from('game_results').select('id').limit(3);
  console.log('game_results err:', g.error?.message ?? 'none', 'count:', g.data?.length ?? 0);
}
main().catch(e => { console.error(String(e)); process.exit(1); });
