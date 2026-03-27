import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Full settlement payload dump
  const { data: settlements } = await db
    .from('settlement_records')
    .select('id, pick_id, result, payload, source, created_at')
    .order('created_at', { ascending: true });

  console.log('=== Raw Settlement Records ===\n');
  for (const s of settlements ?? []) {
    console.log(`${s.id.slice(0,8)} result_col=${s.result} source=${s.source}`);
    const p = s.payload as Record<string,unknown> | null;
    console.log(`  payload keys: [${Object.keys(p ?? {}).join(', ')}]`);
    if (p) {
      for (const [k, v] of Object.entries(p)) {
        if (typeof v !== 'object') console.log(`  ${k}: ${v}`);
      }
    }
    console.log('');
  }

  // Check promotion_history table columns
  const { data: ph, error: phErr } = await db
    .from('pick_promotion_history')
    .select('*')
    .limit(3);
  if (phErr) console.log('promotion_history error:', phErr.message);
  else {
    console.log(`promotion_history rows: ${ph?.length ?? 0}`);
    if (ph?.length) console.log('columns:', Object.keys(ph[0]).join(', '));
    for (const row of ph ?? []) {
      console.log(`  ${row.id?.slice(0,8)} pick=${row.pick_id?.slice(0,8)} target=${row.promotion_target} decision=${row.decision} composite=${row.composite_score}`);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
