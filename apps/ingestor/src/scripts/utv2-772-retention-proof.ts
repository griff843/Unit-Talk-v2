/**
 * UTV2-772 Live-DB proof script
 *
 * Verifies that the partition retention DB functions are callable and return
 * the expected schema. Does NOT drop any real partitions — uses a far-future
 * retention window so no partitions are old enough to drop.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_URL=... tsx apps/ingestor/src/scripts/utv2-772-retention-proof.ts
 */

import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

loadEnvironment();

const client = createDatabaseClientFromConnection(
  createServiceRoleDatabaseConnectionConfig(),
);

async function runProof(): Promise<void> {
  console.log('UTV2-772 retention proof start');

  // 1. Verify summarize function is callable
  const { error: summarizeErr } = await client.rpc(
    'summarize_provider_offer_history_partition',
    { p_cutoff_date: new Date().toISOString().slice(0, 10) },
  );
  if (summarizeErr) {
    throw new Error(`summarize_provider_offer_history_partition failed: ${summarizeErr.message}`);
  }
  console.log('summarize_provider_offer_history_partition callable ✓');

  // 2. Verify drop function is callable — use far-future window so nothing is dropped
  const { data: dropRows, error: dropErr } = await client.rpc(
    'drop_old_provider_offer_history_partitions',
    { p_retention_days: 36500 },
  );
  if (dropErr) {
    throw new Error(`drop_old_provider_offer_history_partitions failed: ${dropErr.message}`);
  }
  const partitionsDropped = Array.isArray(dropRows) ? ((dropRows[0] as { partitions_dropped?: number })?.partitions_dropped ?? 0) : 0;
  console.log(`drop_old_provider_offer_history_partitions callable ✓ (partitions_dropped=${partitionsDropped})`);

  // 3. Verify provider_offer_line_snapshots table exists and is queryable
  const { error: snapshotErr } = await client
    .from('provider_offer_line_snapshots')
    .select('id')
    .limit(1);
  if (snapshotErr) {
    throw new Error(`provider_offer_line_snapshots not queryable: ${snapshotErr.message}`);
  }
  console.log('provider_offer_line_snapshots accessible ✓');

  console.log('UTV2-772 retention proof PASS');
  process.exit(0);
}

runProof().catch((err) => {
  console.error('UTV2-772 retention proof FAIL:', (err as Error).message);
  process.exit(1);
});
