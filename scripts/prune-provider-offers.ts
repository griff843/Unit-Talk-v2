/**
 * prune-provider-offers.ts
 *
 * Deletes provider_offers rows older than the configured retention in small batches.
 * Uses select+delete pattern to avoid timeout on large single DELETE.
 *
 * Run: npx tsx scripts/prune-provider-offers.ts
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';
import { pathToFileURL } from 'node:url';

loadEnvironment();

export interface PruneProviderOffersCliOptions {
  retentionDays: number;
  batchSize: number;
  maxBatches: number;
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function parseCliOptions(args: string[]): PruneProviderOffersCliOptions {
  return {
    retentionDays: parsePositiveInt(readFlagValue(args, '--retention-days')) ?? 7,
    batchSize: parsePositiveInt(readFlagValue(args, '--batch-size')) ?? 5_000,
    maxBatches: parsePositiveInt(readFlagValue(args, '--max-batches')) ?? 20,
  };
}

export function buildCutoffIso(retentionDays: number, nowIso = new Date().toISOString()) {
  return new Date(
    Date.parse(nowIso) - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

async function deleteBatch(cutoff: string, batchSize: number): Promise<number> {
  const db = createDatabaseClient();

  // Fetch a batch of old IDs
  const { data, error } = await db
    .from('provider_offers')
    .select('id')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(batchSize);

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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const options = parseCliOptions(process.argv.slice(2));
  const cutoff = buildCutoffIso(options.retentionDays);

  console.log(`Pruning provider_offers older than ${options.retentionDays} days`);
  console.log(`Cutoff: ${cutoff}`);
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Max batches: ${options.maxBatches}\n`);

  let deleted = 0;
  let batch = 0;

  while (batch < options.maxBatches) {
    batch++;
    process.stdout.write(`Batch ${batch}... `);
    const n = await deleteBatch(cutoff, options.batchSize);
    if (n === 0) {
      console.log('done (no more rows to delete)');
      break;
    }
    deleted += n;
    console.log(`deleted ${n} (running total: ${deleted.toLocaleString()})`);
  }

  if (batch >= options.maxBatches) {
    console.log(`Reached max batch limit (${options.maxBatches}); stop here and rerun if more cleanup is needed.`);
  }

  console.log(`\nCompleted. Total deleted: ${deleted.toLocaleString()} rows`);
}

function readFlagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function parsePositiveInt(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function createDatabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'public' },
    global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) }) },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}
