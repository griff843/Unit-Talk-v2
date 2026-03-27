import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Find Jalen Brunson participant_id
  const { data: jb } = await db.from('participants').select('id,external_id,display_name').eq('external_id', 'JALEN_BRUNSON_1_NBA').single();
  console.log('Jalen Brunson participant:', JSON.stringify(jb));

  // Find the Knicks vs Hornets event
  const { data: events } = await db.from('events').select('id,external_id,event_name,event_date,metadata').ilike('event_name', '%Knicks%').limit(5);
  console.log('\nKnicks events:', events?.length ?? 0);
  for (const e of events ?? []) {
    const meta = e.metadata as Record<string,unknown> | null;
    console.log(`  ${e.id.slice(0,8)} "${e.event_name}" date=${e.event_date} ext=${e.external_id} starts_at=${meta?.starts_at}`);
  }

  // Check game_results for these events
  if (events?.length) {
    const evtIds = events.map(e => e.id);
    const { data: grs } = await db.from('game_results').select('id,event_id,result_data,created_at').in('event_id', evtIds);
    console.log('\nGame results for Knicks events:', grs?.length ?? 0);
    for (const gr of grs ?? []) {
      console.log(`  ${gr.id.slice(0,8)} event=${gr.event_id?.slice(0,8)} created=${gr.created_at?.slice(0,19)}`);
    }
  }

  // Also check what event the existing game results point to
  const { data: grs2 } = await db.from('game_results').select('id,event_id,created_at').order('created_at', { ascending: false }).limit(5);
  console.log('\nAll game results:');
  for (const gr of grs2 ?? []) {
    const { data: evt } = await db.from('events').select('id,event_name,external_id').eq('id', gr.event_id).single();
    console.log(`  ${gr.id.slice(0,8)} event="${evt?.event_name}" ext=${evt?.external_id}`);
  }

  // Check if Jalen Brunson is linked to any event via event_participants
  if (jb) {
    const { data: eps } = await db.from('event_participants').select('event_id').eq('participant_id', jb.id);
    console.log(`\nJalen Brunson event_participants: ${eps?.length ?? 0}`);
    for (const ep of eps ?? []) {
      const { data: evt } = await db.from('events').select('id,event_name,external_id').eq('id', ep.event_id).single();
      console.log(`  event="${evt?.event_name}" ext=${evt?.external_id}`);
      // Check game_results for this event
      const { data: gr } = await db.from('game_results').select('id').eq('event_id', ep.event_id).limit(1);
      console.log(`  has_game_result=${!!gr?.length}`);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
