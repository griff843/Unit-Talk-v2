import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Check the event that has game_results
  const { data: ev } = await db.from('events').select('id,external_id,event_name,event_date,metadata').eq('id','9f55c709-5de3-4900-8d58-1cb3e9c15af1').maybeSingle();
  if (!ev) {
    // Try partial ID search
    const { data: evs } = await db.from('events').select('id,external_id,event_name,event_date,metadata').limit(5);
    console.log('Events sample:', JSON.stringify(evs?.map(e => ({id:e.id.slice(0,8),extId:e.external_id,name:e.event_name})), null,2));
  } else {
    console.log('Event:', JSON.stringify({id:ev.id.slice(0,8), extId:ev.external_id, name:ev.event_name, date:ev.event_date}));
  }

  // Find event by prefix
  const { data: events } = await db.from('events').select('id,external_id,event_name,event_date').limit(10);
  console.log('\nAll events:');
  for (const e of events ?? []) console.log(`  ${e.id.slice(0,8)} extId=${e.external_id} "${e.event_name}" ${e.event_date}`);

  // Check provider_offers for these event external_ids
  const extIds = (events ?? []).map(e => e.external_id).filter(Boolean) as string[];
  if (extIds.length) {
    const { data: offers } = await db.from('provider_offers').select('id,provider_event_id,provider_market_key,provider_participant_id,is_closing').in('provider_event_id', extIds).limit(10);
    console.log(`\nProvider offers for known events: ${offers?.length ?? 0}`);
    for (const o of offers ?? []) console.log(`  eventId=${o.provider_event_id} market=${o.provider_market_key} participant=${o.provider_participant_id} closing=${o.is_closing}`);
  }

  // Check posted picks with participant_id set
  const { data: picks } = await db.from('picks').select('id,market,market_key,selection,odds,status,participant_id').eq('status','posted').not('participant_id','is',null).limit(10);
  console.log(`\nPosted picks with participant_id: ${picks?.length ?? 0}`);
  for (const p of picks ?? []) console.log(`  ${p.id.slice(0,8)} participant=${p.participant_id?.slice(0,8)} market="${p.market}" sel="${p.selection}"`);
}

main().catch(e => { console.error(String(e)); process.exit(1); });
