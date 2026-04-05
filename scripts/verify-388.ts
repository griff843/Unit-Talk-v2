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

const sb = createClient(`https://feownrheeefbcsehtsiw.supabase.co`, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: mt } = await sb
    .from('market_types')
    .select('id,display_name')
    .in('id', [
      'player_goals_ou','player_hockey_points_ou','player_shots_ou','player_saves_ou','player_blocked_shots_ou',
      'player_passing_yards_ou','player_rushing_yards_ou','player_receiving_yards_ou','player_receptions_ou',
      'player_passing_tds_ou','player_fantasy_score_ou',
    ]);
  console.log('=== New market_types ===');
  for (const r of mt ?? []) console.log(`  ${r.id} | ${r.display_name}`);

  const { data: al } = await sb
    .from('provider_market_aliases')
    .select('provider,provider_market_key,market_type_id,sport_id')
    .eq('provider', 'sgo')
    .in('market_type_id', [
      'moneyline','spread','player_goals_ou','player_hockey_points_ou','player_shots_ou',
      'player_saves_ou','player_blocked_shots_ou','player_passing_yards_ou','player_rushing_yards_ou',
      'player_receiving_yards_ou','player_receptions_ou','player_passing_tds_ou','player_fantasy_score_ou',
    ])
    .order('sport_id');
  console.log('\n=== New SGO aliases ===');
  for (const r of al ?? []) console.log(`  ${r.provider_market_key} | sport=${r.sport_id ?? 'ALL'} -> ${r.market_type_id}`);

  const { data: smt } = await sb
    .from('sport_market_type_availability')
    .select('sport_id,market_type_id')
    .in('sport_id', ['NHL','NFL'])
    .order('sport_id');
  console.log('\n=== NHL/NFL sport_market_type_availability ===');
  const grouped: Record<string, string[]> = {};
  for (const r of smt ?? []) {
    (grouped[r.sport_id] ??= []).push(r.market_type_id);
  }
  for (const [sport, types] of Object.entries(grouped)) {
    console.log(`  ${sport} -> ${types.join(', ')}`);
  }
}

main().catch(console.error);
