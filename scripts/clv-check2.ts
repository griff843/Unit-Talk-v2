import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Get Jalen Brunson
  const { data: jb } = await db.from('participants').select('id,external_id,display_name').eq('external_id', 'JALEN_BRUNSON_1_NBA').single();
  console.log('Jalen Brunson:', jb?.id);

  // Get his events via event_participants
  const { data: eps } = await db.from('event_participants').select('event_id,participant_id').eq('participant_id', jb!.id);
  console.log('Event participant links:', eps?.length ?? 0);
  for (const ep of eps ?? []) {
    console.log(`  event_id=${ep.event_id}`);
    
    // Look up event
    const { data: evt } = await db.from('events').select('id,event_name,status,external_id').eq('id', ep.event_id).single();
    console.log(`  event: "${evt?.event_name}" status=${evt?.status}`);
    
    // Game results for this event with Jalen Brunson
    const { data: grs, error: grErr } = await db.from('game_results')
      .select('id,event_id,participant_id,market_key,actual_value')
      .eq('event_id', ep.event_id)
      .eq('participant_id', jb!.id)
      .limit(3);
    if (grErr) console.log(`  game_results error: ${grErr.message}`);
    console.log(`  game_results (participant_id match): ${grs?.length ?? 0}`);
    for (const gr of grs ?? []) {
      console.log(`    ${gr.id.slice(0,8)} market_key=${gr.market_key} actual_value=${gr.actual_value}`);
    }
    
    // All game results for this event (any participant)
    const { data: grsAll, error: grAllErr } = await db.from('game_results')
      .select('id,participant_id,market_key,actual_value')
      .eq('event_id', ep.event_id)
      .limit(5);
    if (grAllErr) console.log(`  all game_results error: ${grAllErr.message}`);
    console.log(`  all game_results for event: ${grsAll?.length ?? 0}`);
    for (const gr of grsAll ?? []) {
      console.log(`    ${gr.id.slice(0,8)} participant=${gr.participant_id?.slice(0,8)} market=${gr.market_key} val=${gr.actual_value}`);
    }
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
