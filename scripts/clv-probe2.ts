import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Get game_results with full event_id
  const { data: gr } = await db.from('game_results').select('id,event_id,created_at').order('created_at',{ascending:false}).limit(3);
  console.log('Game results:');
  for (const g of gr ?? []) console.log(`  ${g.id} event_id=${g.event_id}`);

  // Get all posted picks with their participant_id status
  const { data: picks } = await db.from('picks').select('id,market,market_key,selection,odds,status,participant_id,event_name').eq('status','posted').limit(10);
  console.log(`\nPosted picks (${picks?.length ?? 0}):`);
  for (const p of picks ?? []) {
    console.log(`  ${p.id.slice(0,8)} participant=${p.participant_id?.slice(0,8) ?? 'NULL'} market="${p.market}" sel="${p.selection?.slice(0,30)}"`);
  }

  // Check if any participant has external_id matching provider_offers  
  const { data: offerParticipants } = await db.from('provider_offers')
    .select('provider_participant_id').not('provider_participant_id','is',null).limit(100);
  const uniqueProvIds = [...new Set(offerParticipants?.map(o => o.provider_participant_id))];
  console.log(`\nUnique provider_participant_ids in offers: ${uniqueProvIds.length}`);
  console.log('  Sample:', uniqueProvIds.slice(0,5).join(', '));

  const { data: matchedParts } = await db.from('participants')
    .select('id,external_id,name').in('external_id', uniqueProvIds.slice(0,20) as string[]).limit(10);
  console.log(`\nParticipants in DB matching offer participant IDs: ${matchedParts?.length ?? 0}`);
  for (const p of matchedParts ?? []) console.log(`  ${p.id.slice(0,8)} extId=${p.external_id} name=${p.name}`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
