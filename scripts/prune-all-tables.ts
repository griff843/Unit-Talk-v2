/**
 * prune-all-tables.ts
 *
 * Enforces retention policies across all high-volume tables.
 * Runs in batch mode to avoid REST API timeouts.
 *
 * Retention policy:
 *   provider_offers   — 30 days
 *   audit_log         — 90 days
 *   alert_detections  — 30 days
 *   submission_events — 90 days
 *   distribution_outbox (delivered) — 7 days
 *   distribution_receipts           — 7 days
 *
 * Run: npx tsx scripts/prune-all-tables.ts
 */

import { createClient } from '@supabase/supabase-js';
import { loadEnvironment } from '@unit-talk/config';

loadEnvironment();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BATCH_SIZE = 5_000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'public' },
  global: { fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) }) },
});

interface PruneTarget {
  table: string;
  dateColumn: string;
  retentionDays: number;
}

const PRUNE_TARGETS: PruneTarget[] = [
  { table: 'provider_offers', dateColumn: 'created_at', retentionDays: 30 },
  { table: 'audit_log', dateColumn: 'created_at', retentionDays: 90 },
  { table: 'alert_detections', dateColumn: 'created_at', retentionDays: 30 },
  { table: 'submission_events', dateColumn: 'created_at', retentionDays: 90 },
  { table: 'distribution_receipts', dateColumn: 'created_at', retentionDays: 7 },
];

async function pruneBatch(target: PruneTarget): Promise<number> {
  const cutoff = new Date(
    Date.now() - target.retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  let totalDeleted = 0;
  let batch = 0;

  while (true) {
    batch++;
    process.stdout.write(`  Batch ${batch}... `);

    const { data, error } = await db
      .from(target.table)
      .select('id')
      .lt(target.dateColumn, cutoff)
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Select failed on ${target.table}: ${error.message}`);
    if (!data || data.length === 0) {
      console.log('done (no more rows)');
      break;
    }

    const ids = (data as { id: string }[]).map((r) => r.id);

    const { error: delError } = await db.from(target.table).delete().in('id', ids);

    if (delError) throw new Error(`Delete failed on ${target.table}: ${delError.message}`);

    totalDeleted += ids.length;
    console.log(`deleted ${ids.length} (running: ${totalDeleted.toLocaleString()})`);
  }

  return totalDeleted;
}

async function pruneDeliveredOutbox(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;
  let batch = 0;

  while (true) {
    batch++;
    process.stdout.write(`  Batch ${batch}... `);

    const { data, error } = await db
      .from('distribution_outbox')
      .select('id')
      .eq('status', 'delivered')
      .lt('updated_at', cutoff)
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Select failed on distribution_outbox: ${error.message}`);
    if (!data || data.length === 0) {
      console.log('done (no more rows)');
      break;
    }

    const ids = (data as { id: string }[]).map((r) => r.id);
    const { error: delError } = await db.from('distribution_outbox').delete().in('id', ids);
    if (delError) throw new Error(`Delete failed on distribution_outbox: ${delError.message}`);

    totalDeleted += ids.length;
    console.log(`deleted ${ids.length} (running: ${totalDeleted.toLocaleString()})`);
  }

  return totalDeleted;
}

async function main() {
  console.log('=== Unit Talk V2 — Retention Pruning ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  let grandTotal = 0;

  for (const target of PRUNE_TARGETS) {
    const cutoff = new Date(
      Date.now() - target.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    console.log(
      `[${target.table}] Pruning rows older than ${target.retentionDays} days (cutoff: ${cutoff})`,
    );
    const deleted = await pruneBatch(target);
    console.log(`  => Total deleted: ${deleted.toLocaleString()}\n`);
    grandTotal += deleted;
  }

  console.log('[distribution_outbox] Pruning delivered rows older than 7 days');
  const outboxDeleted = await pruneDeliveredOutbox();
  console.log(`  => Total deleted: ${outboxDeleted.toLocaleString()}\n`);
  grandTotal += outboxDeleted;

  console.log(`=== Complete. Grand total deleted: ${grandTotal.toLocaleString()} rows ===`);
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error('Pruning failed:', err.message);
  process.exit(1);
});
