import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await db.from('system_runs')
    .select('id, run_type, status, started_at, actor')
    .ilike('run_type', 'ingestor%')
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) { console.error('ERROR:', error.message); process.exit(1); }
  console.log('ingestor system_runs count:', data?.length ?? 0);
  for (const r of data ?? []) {
    console.log(`  ${r.id.slice(0,8)} type=${r.run_type} status=${r.status} started=${r.started_at?.slice(0,19)} actor=${r.actor}`);
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
