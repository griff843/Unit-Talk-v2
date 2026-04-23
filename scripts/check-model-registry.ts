import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Check model_registry
  const { data: models, error: modelsError } = await db
    .from('model_registry')
    .select('id,model_name,version,sport,market_family,status,metadata,champion_since')
    .order('created_at', { ascending: false })
    .limit(50);

  if (modelsError) console.error('model_registry error:', modelsError.message);
  console.log('=== Model Registry ===');
  console.log('Total models:', models?.length ?? 0);
  const champions = (models ?? []).filter(m => m.status === 'champion');
  console.log('Champions:', champions.length);
  for (const c of champions) {
    console.log(`  ${c.id.slice(0,8)} sport=${c.sport} family=${c.market_family} since=${c.champion_since?.slice(0,10)}`);
  }
  if (champions.length === 0) console.log('  NO CHAMPION MODELS REGISTERED');

  // Check market_universe sport_key / market_type_id distribution
  const { data: universes, error: uError } = await db
    .from('market_universe')
    .select('sport_key,market_type_id')
    .order('created_at', { ascending: false })
    .limit(200);

  if (uError) console.error('market_universe error:', uError.message);
  console.log('\n=== Market Universe sport_key/market_type_id (recent 200) ===');
  const dist: Record<string, number> = {};
  for (const u of universes ?? []) {
    const mf = deriveMarketFamily(u.market_type_id);
    const k = `${u.sport_key}/${mf} (type=${u.market_type_id?.slice(0,20)})`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${v}  ${k}`);
  }

  // Check pick_candidates count and model_score coverage
  const { count: totalCands } = await db
    .from('pick_candidates')
    .select('*', { count: 'exact', head: true });
  const { count: scoredCands } = await db
    .from('pick_candidates')
    .select('*', { count: 'exact', head: true })
    .not('model_score', 'is', null);
  console.log(`\n=== Pick Candidates ===`);
  console.log(`Total: ${totalCands}, Scored: ${scoredCands}`);
}

function deriveMarketFamily(marketTypeId: string | null): string | null {
  if (!marketTypeId) return null;
  if (marketTypeId.startsWith('player_')) return 'player_prop';
  if (marketTypeId.includes('spread') || marketTypeId.includes('total') || marketTypeId.includes('moneyline')) return 'game_line';
  if (marketTypeId.includes('batting') || marketTypeId.includes('combo')) return 'combo';
  return 'player_prop';
}

main().catch(e => { console.error(e); process.exit(1); });
