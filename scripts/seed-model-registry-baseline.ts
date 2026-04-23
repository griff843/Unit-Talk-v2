/**
 * Seed baseline champion models into model_registry.
 *
 * Registers a neutral baseline champion for each active sport/market_family
 * combination found in the current market_universe. The baseline champion:
 *   - Uses sharp_weight=0 and movement_weight=0 (pure market devig consensus)
 *   - Confidence=0.7 (moderate)
 *   - Marks itself as provisional (metadata.provisional=true) for future
 *     replacement with trained models
 *
 * This unblocks the candidate-scoring-service fail-closed gate (UTV2-553)
 * which skips all candidates when no champion model exists for a sport/family.
 *
 * Run: pnpm exec tsx scripts/seed-model-registry-baseline.ts
 * Safe to re-run: uses upsert logic, will not create duplicates.
 */
import { loadEnvironment } from '@unit-talk/config';
import { createClient } from '@supabase/supabase-js';

const BASELINE_VERSION = 'v0.1-baseline-2026-04-22';

function deriveMarketFamily(marketTypeId: string | null): string | null {
  if (!marketTypeId) return null;
  if (marketTypeId.startsWith('player_')) return 'player_prop';
  if (marketTypeId.includes('spread') || marketTypeId.includes('total') || marketTypeId.includes('moneyline')) return 'game_line';
  if (marketTypeId.includes('batting') || marketTypeId.includes('combo')) return 'combo';
  return 'player_prop';
}

async function main() {
  const env = loadEnvironment();
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Find distinct sport/market_family from recent market_universe
  const { data: universes, error: uError } = await db
    .from('market_universe')
    .select('sport_key,market_type_id')
    .order('created_at', { ascending: false })
    .limit(500);

  if (uError) { console.error('market_universe error:', uError.message); process.exit(1); }

  const needed = new Set<string>();
  for (const u of universes ?? []) {
    const mf = deriveMarketFamily(u.market_type_id);
    if (u.sport_key && mf) needed.add(`${u.sport_key}::${mf}`);
  }

  console.log('Sport/market_family combinations needing champions:');
  for (const k of needed) console.log(' ', k);

  // 2. Check existing champions
  const { data: existing } = await db
    .from('model_registry')
    .select('sport,market_family,status')
    .eq('status', 'champion');

  const existingKeys = new Set((existing ?? []).map(r => `${r.sport}::${r.market_family}`));
  console.log('\nExisting champions:', existingKeys.size);

  // 3. Register missing baseline champions
  const toInsert: Array<{
    model_name: string; version: string; sport: string; market_family: string;
    status: string; champion_since: string; metadata: object;
  }> = [];

  for (const key of needed) {
    if (existingKeys.has(key)) {
      console.log(`  SKIP (already champion): ${key}`);
      continue;
    }
    const [sport, market_family] = key.split('::');
    toInsert.push({
      model_name: `baseline-${sport.toLowerCase()}-${market_family.replace('_', '-')}`,
      version: BASELINE_VERSION,
      sport,
      market_family,
      status: 'champion',
      champion_since: new Date().toISOString(),
      metadata: {
        sharp_weight: 0,
        movement_weight: 0,
        confidence: 0.7,
        provisional: true,
        seeded_by: 'seed-model-registry-baseline.ts',
        seeded_at: new Date().toISOString(),
        note: 'Baseline champion to unblock scoring pipeline. Replace with trained model when available.',
      },
    });
  }

  if (toInsert.length === 0) {
    console.log('\nNo new champions to register.');
    return;
  }

  console.log(`\nRegistering ${toInsert.length} baseline champion(s)...`);
  const { data: inserted, error: insertError } = await db
    .from('model_registry')
    .insert(toInsert)
    .select('id,sport,market_family,status');

  if (insertError) {
    console.error('Insert error:', insertError.message);
    process.exit(1);
  }

  console.log('Registered:');
  for (const r of inserted ?? []) {
    console.log(`  ${r.id.slice(0,8)} ${r.sport}/${r.market_family} status=${r.status}`);
  }
  console.log('\nDone. Candidate scoring service will pick up champions on next cycle.');
}

main().catch(e => { console.error(e); process.exit(1); });
