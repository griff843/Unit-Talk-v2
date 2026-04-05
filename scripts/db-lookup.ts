import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('local.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const sb = createClient(
  `https://feownrheeefbcsehtsiw.supabase.co`,
  env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  const { data: mf, error: mfErr } = await sb.from('market_families').select('id,display_name').order('id');
  if (mfErr) console.log('market_families error:', mfErr.message);
  console.log('=== market_families ===');
  for (const r of mf ?? []) console.log(`  ${r.id} | ${r.display_name}`);

  const { data: st, error: stErr } = await sb.from('selection_types').select('id,display_name').order('id');
  if (stErr) console.log('selection_types error:', stErr.message);
  console.log('\n=== selection_types ===');
  for (const r of st ?? []) console.log(`  ${r.id} | ${r.display_name}`);

  const { data: sp, error: spErr } = await sb.from('sports').select('id,display_name').order('id');
  if (spErr) console.log('sports error:', spErr.message);
  console.log('\n=== sports ===');
  for (const r of sp ?? []) console.log(`  ${r.id} | ${r.display_name}`);
}

main().catch(console.error);
