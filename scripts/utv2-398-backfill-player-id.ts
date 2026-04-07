/**
 * UTV2-398 Phase 1: Backfill picks.player_id from provider_entity_aliases
 *
 * Reports how many existing picks were resolved by the migration's inline UPDATE.
 * Run after applying migration 202604070011_utv2_398_picks_player_id.sql.
 *
 * Usage:
 *   npx tsx scripts/utv2-398-backfill-player-id.ts
 */

import { createServiceRoleDatabaseConnectionConfig, createDatabaseClientFromConnection } from '../packages/db/src/client.js';

const connection = createServiceRoleDatabaseConnectionConfig();
const client = createDatabaseClientFromConnection(connection);

async function main() {
  // Total picks
  const { count: totalPicks, error: totalErr } = await client
    .from('picks')
    .select('*', { count: 'exact', head: true });
  if (totalErr) throw new Error(`Failed to count picks: ${totalErr.message}`);

  // Picks with player_id resolved
  const { count: resolvedPicks, error: resolvedErr } = await client
    .from('picks')
    .select('*', { count: 'exact', head: true })
    .not('player_id', 'is', null);
  if (resolvedErr) throw new Error(`Failed to count resolved picks: ${resolvedErr.message}`);

  // Picks still unresolved
  const { count: unresolvedPicks, error: unresolvedErr } = await client
    .from('picks')
    .select('*', { count: 'exact', head: true })
    .is('player_id', null);
  if (unresolvedErr) throw new Error(`Failed to count unresolved picks: ${unresolvedErr.message}`);

  console.log('UTV2-398 Phase 1 — picks.player_id backfill report');
  console.log('====================================================');
  console.log(`Total picks:          ${totalPicks ?? 0}`);
  console.log(`  player_id resolved: ${resolvedPicks ?? 0}`);
  console.log(`  player_id null:     ${unresolvedPicks ?? 0}`);

  const pct = totalPicks && totalPicks > 0
    ? ((resolvedPicks ?? 0) / totalPicks * 100).toFixed(1)
    : '0.0';
  console.log(`  Resolution rate:    ${pct}%`);
  console.log('');
  console.log('Note: null player_id means no canonical player row exists yet for that participant.');
  console.log('These will resolve as players are bootstrapped in the canonical players table.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
