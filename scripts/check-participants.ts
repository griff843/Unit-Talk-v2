import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Check if participants have external_id
  const { data: withExternal } = await db
    .from('participants')
    .select('id, name, external_id')
    .not('external_id', 'is', null)
    .limit(10);

  console.log(`Participants with external_id: ${withExternal?.length ?? 0}`);
  for (const p of withExternal ?? []) {
    console.log(`  ${p.name}: ${p.external_id}`);
  }

  const { count } = await db
    .from('participants')
    .select('*', { count: 'exact', head: true })
    .not('external_id', 'is', null);
  console.log(`Total participants with external_id: ${count}`);

  // Check provider_offers participant IDs
  const { data: offerPids } = await db
    .from('provider_offers')
    .select('provider_participant_id')
    .not('provider_participant_id', 'is', null)
    .limit(5);
  console.log('\nSample provider_participant_ids from provider_offers:');
  for (const o of offerPids ?? []) {
    console.log(`  ${o.provider_participant_id}`);
  }
}

main().catch(e => { console.error(String(e)); process.exit(1); });
