import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // === TRUSTED EVENT: Timberwolves-Nuggets (de9a3fda) ===
  console.log('=== Timberwolves-Nuggets (trusted, de9a3fda) ===');
  const { data: twGr } = await db.from('game_results')
    .select('participant_id, market_key, actual_value')
    .eq('event_id', 'de9a3fda-6059-44ea-b1d4-b9b56c1e34b4')
    .eq('market_key', 'player_points_ou')
    .order('actual_value', { ascending: false })
    .limit(5);

  const _participantIds = twGr?.map(r => r.participant_id) ?? [];
  for (const r of twGr ?? []) {
    // Get player name
    const { data: parts } = await db.from('participants')
      .select('id, display_name, external_id')
      .eq('id', r.participant_id);
    const p = parts?.[0];
    console.log(`  ${p?.display_name ?? r.participant_id.slice(0,8)} | points=${r.actual_value}`);

    // Check provider_offers closing line
    const { data: offers } = await db.from('provider_offers')
      .select('market_key, over_price, under_price, line, close_time')
      .eq('event_id', 'de9a3fda-6059-44ea-b1d4-b9b56c1e34b4')
      .eq('participant_id', r.participant_id)
      .eq('market_key', 'player_points_ou')
      .not('close_time', 'is', null)
      .order('close_time', { ascending: false })
      .limit(1);
    if (offers?.length) {
      console.log(`    closing: line=${offers[0].line} over=${offers[0].over_price} under=${offers[0].under_price}`);
    } else {
      console.log(`    closing: no provider_offer`);
    }
  }

  // === UNTRUSTED EVENT: Senators-Hurricanes (d46d70f0) ===
  console.log('\n=== Senators-Hurricanes (untrusted, d46d70f0) ===');
  const { data: evSen } = await db.from('events')
    .select('id, event_name, status, external_id, metadata')
    .eq('id', 'd46d70f0-8a33-4d51-834c-6cb9a72e5285')
    .single();
  if (evSen) {
    const meta = (evSen.metadata ?? {}) as Record<string, unknown>;
    console.log(`  status=${evSen.status} external_id=${evSen.external_id}`);
    console.log(`  metadata keys: [${Object.keys(meta).join(', ')}]`);
    console.log(`  providerKey=${meta.providerKey ?? 'null'} ingestionCycleRunId=${meta.ingestionCycleRunId ?? 'null'}`);
  }

  const { data: senGr } = await db.from('game_results')
    .select('participant_id, market_key, actual_value')
    .eq('event_id', 'd46d70f0-8a33-4d51-834c-6cb9a72e5285')
    .eq('market_key', 'player_points_ou')
    .order('actual_value', { ascending: false })
    .limit(3);
  for (const r of senGr ?? []) {
    const { data: parts } = await db.from('participants').select('display_name').eq('id', r.participant_id);
    console.log(`  ${parts?.[0]?.display_name ?? r.participant_id.slice(0,8)} | points=${r.actual_value}`);
  }

  // Get event participant links for Timberwolves-Nuggets
  console.log('\n=== Event participants for Timberwolves-Nuggets ===');
  const { data: epLinks } = await db.from('event_participants')
    .select('participant_id')
    .eq('event_id', 'de9a3fda-6059-44ea-b1d4-b9b56c1e34b4');
  console.log(`  ${epLinks?.length ?? 0} event_participant links`);
  const linkedIds = new Set(epLinks?.map(e => e.participant_id) ?? []);
  const trustedWithLinks = twGr?.filter(r => linkedIds.has(r.participant_id));
  console.log(`  Top scorers with event_participant links:`);
  for (const r of trustedWithLinks ?? []) {
    const { data: parts } = await db.from('participants').select('display_name').eq('id', r.participant_id);
    console.log(`    ${parts?.[0]?.display_name ?? r.participant_id.slice(0,8)} | points=${r.actual_value} | participantId=${r.participant_id}`);
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
