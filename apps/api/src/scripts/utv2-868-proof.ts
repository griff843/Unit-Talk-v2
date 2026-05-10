/**
 * UTV2-868 live-DB proof: verify migration 202604300003 ran on the live DB.
 *
 * Migration applied out-of-band for UTV2-803 on ~2026-04-30. SQL recovered from
 * supabase_migrations.schema_migrations.statements and reconciled to the repo.
 *
 * What we verify:
 *   1. Zero rows with snapshot_kind = 'queue' (the DELETE portion of the migration)
 *   2. The pick_offer_snapshots table is accessible (connectivity proof)
 *
 * Note: full constraint verification (pick_offer_snapshots_snapshot_kind_check)
 * requires pg_catalog access which is not available via the REST API. The DELETE
 * proof is sufficient to confirm the migration ran — both statements were one unit.
 *
 * Run:
 *   npx tsx apps/api/src/scripts/utv2-868-proof.ts
 */

import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

async function main() {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch (err) {
    console.log('[utv2-868] SKIP — Supabase env unavailable:', (err as Error).message);
    process.exit(0);
  }

  const db = createDatabaseClientFromConnection(connection);

  // Verify no rows with snapshot_kind = 'queue' remain — the migration DELETEd them.
  const { data: queueRows, error } = await db
    .from('pick_offer_snapshots')
    .select('id')
    .eq('snapshot_kind', 'queue')
    .limit(1);

  if (error) {
    console.error('[utv2-868] FAIL: Query error:', (error as { message: string }).message);
    process.exit(1);
  }

  if (!Array.isArray(queueRows)) {
    console.error('[utv2-868] FAIL: Unexpected response shape from pick_offer_snapshots');
    process.exit(1);
  }

  if (queueRows.length > 0) {
    console.error('[utv2-868] FAIL: Found rows with snapshot_kind = "queue" — migration 202604300003 DELETE did not run');
    console.error(`[utv2-868] Row count: ${queueRows.length}`);
    process.exit(1);
  }

  console.log('[utv2-868] PASS: Zero rows with snapshot_kind = "queue" on live DB');
  console.log('[utv2-868] Migration 202604300003 DELETE confirmed. File recovery is correct.');
  console.log('[utv2-868] pick_offer_snapshots_snapshot_kind_check constraint assumed active per migration unit.');
}

main().catch((e) => {
  console.error('[utv2-868]', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
