import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

async function main() {
  const env = readFileSync('local.env', 'utf8');
  const get = (k: string) =>
    env.split('\n').find((l) => l.startsWith(k + '='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') ?? '';

  const sb = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

  const { data: mt, error: mtErr } = await sb.from('market_types').select('id,display_name,market_family_id').order('market_family_id');
  if (mtErr) console.log('market_types error:', mtErr.message);
  console.log('=== market_types ===');
  for (const r of mt ?? []) console.log(`  ${r.id} | ${r.display_name} | ${r.market_family_id}`);

  const { data: smt, error: smtErr } = await sb.from('sport_market_type_availability').select('sport_id,market_type_id').order('sport_id');
  if (smtErr) console.log('sport_market_type_availability error:', smtErr.message);
  console.log('\n=== sport_market_type_availability ===');
  const byS: Record<string, string[]> = {};
  for (const r of smt ?? []) (byS[r.sport_id] ??= []).push(r.market_type_id);
  for (const [s, ms] of Object.entries(byS)) console.log(`  ${s} -> ${ms.join(', ')}`);

  const { data: st } = await sb.from('stat_types').select('id,display_name,sport_id').order('sport_id,id');
  console.log('\n=== stat_types ===');
  for (const r of st ?? []) console.log(`  ${r.sport_id ?? 'any'} | ${r.id} | ${r.display_name}`);

  const { data: al, error: alErr } = await sb.from('provider_market_aliases').select('provider,provider_market_key,market_type_id,stat_type_id,sport_id').eq('provider', 'sgo').order('provider_market_key');
  if (alErr) console.log('provider_market_aliases error:', alErr.message);
  console.log('\n=== SGO provider_market_aliases ===');
  for (const r of al ?? []) console.log(`  ${r.provider_market_key} -> mt:${r.market_type_id} st:${r.stat_type_id ?? '-'} sport:${r.sport_id ?? '-'}`);

  // Sample offer keys from a live NBA event to understand actual stored key format
  // Get distinct market keys across all sports by fetching large page and deduplicating
  const allKeys = new Map<string, string>(); // key -> sport_key
  let offset = 0;
  while (true) {
    const { data: batch, error: bErr } = await sb
      .from('provider_offers')
      .select('provider_market_key,sport_key')
      .eq('provider_key', 'sgo')
      .order('provider_market_key')
      .range(offset, offset + 999);
    if (bErr) { console.log('provider_offers error:', bErr.message); break; }
    if (!batch || batch.length === 0) break;
    for (const r of batch) {
      if (!allKeys.has(r.provider_market_key)) allKeys.set(r.provider_market_key, r.sport_key ?? '');
    }
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log('\n=== Distinct SGO provider_market_keys ===');
  for (const [key, sport] of [...allKeys.entries()].sort()) {
    console.log(`  ${key} | sport=${sport}`);
  }
  console.log(`Total distinct keys: ${allKeys.size}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
