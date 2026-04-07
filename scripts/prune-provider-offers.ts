/**
 * prune-provider-offers.ts
 *
 * Deletes provider_offers rows older than 30 days in small batches.
 * Uses select+delete pattern to avoid timeout on large single DELETE.
 *
 * Run: npx tsx scripts/prune-provider-offers.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RETENTION_DAYS = 30;
const BATCH_SIZE = 5_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'public' },
  global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) }) },
});

async function deleteBatch(): Promise<number> {
  // Fetch a batch of old IDs
  const { data, error } = await db
    .from('provider_offers')
    .select('id')
    .lt('created_at', cutoff)
    .limit(BATCH_SIZE);

  if (error) throw new Error(`Select failed: ${error.message}`);
  if (!data || data.length === 0) return 0;

  const ids = (data as { id: string }[]).map((r) => r.id);

  const { error: delError } = await db
    .from('provider_offers')
    .delete()
    .in('id', ids);

  if (delError) throw new Error(`Delete failed: ${delError.message}`);
  return ids.length;
}

async function main() {
  console.log(`Pruning provider_offers older than ${RETENTION_DAYS} days`);
  console.log(`Cutoff: ${cutoff}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  let deleted = 0;
  let batch = 0;

  while (true) {
    batch++;
    process.stdout.write(`Batch ${batch}... `);
    const n = await deleteBatch();
    if (n === 0) {
      console.log('done (no more rows to delete)');
      break;
    }
    deleted += n;
    console.log(`deleted ${n} (running total: ${deleted.toLocaleString()})`);
  }

  console.log(`\nCompleted. Total deleted: ${deleted.toLocaleString()} rows`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
