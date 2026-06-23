/**
 * UTV2-1296 — Read-only live-DB proof: provider_offer_history dedup pre-load
 * prunes partitions when scoped by snapshot_at.
 *
 * Context: DatabaseProviderOfferRepository.upsertBatch's dedup pre-load queried
 * provider_offer_history by idempotency_key only. The table is RANGE(snapshot_at)
 * partitioned (60+ partitions, ~1.39M rows) and its only idempotency_key index is
 * the composite unique (snapshot_at, idempotency_key). Without a snapshot_at
 * predicate the lookup scans every partition and trips the 120s statement_timeout
 * (the production MLB odds-cycle failure). The fix scopes the pre-load to the
 * batch's distinct snapshot_at value(s).
 *
 * This proof exercises the EXACT new PostgREST query shape against the live table
 * and shows it returns well under the statement_timeout, and contrasts it with the
 * old (idempotency_key-only) shape, which does not return within a short bound —
 * consistent with the production statement_timeout.
 *
 * READ-ONLY. No writes, no DDL, no mutation. GET requests only.
 *
 * Run: npx tsx apps/api/src/scripts/utv2-1296-dedup-pruning-proof.ts
 * Exits 0 when the new (snapshot_at-scoped) shape returns fast; exits 1 otherwise.
 */

import { loadEnvironment } from '@unit-talk/config';

const env = loadEnvironment();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (read-only).');
  process.exit(1);
}

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// The new query shape must return comfortably under the 120s statement_timeout.
// Partition pruning + composite-index seek should make it sub-second; we assert a
// generous 10s ceiling to stay robust against network/cold-cache variance.
const NEW_SHAPE_CEILING_MS = 10_000;
// We do not wait the full 120s statement_timeout for the old shape; aborting at
// this bound is sufficient to demonstrate the contrast without hammering prod.
const OLD_SHAPE_ABORT_MS = 15_000;

async function restGet(
  path: string,
  signal?: AbortSignal,
): Promise<{ rows: unknown[]; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: BASE_HEADERS,
    ...(signal ? { signal } : {}),
  });
  const ms = performance.now() - started;
  if (!res.ok) {
    throw new Error(`Supabase REST ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  return { rows: (await res.json()) as unknown[], ms };
}

function encodeInList(values: string[]): string {
  // PostgREST in.(...) — quote each value (timestamps contain '+'/':') and
  // percent-encode so the '+' is not decoded to a space in the query string.
  return `in.(${values.map((v) => `"${encodeURIComponent(v)}"`).join(',')})`;
}

async function main(): Promise<void> {
  console.log('# UTV2-1296 dedup partition-pruning proof (read-only, live Supabase)');

  // 1) Sample a recent snapshot_at + idempotency_keys from the live table (read-only).
  const sample = (await restGet(
    'provider_offer_history?select=snapshot_at,idempotency_key&order=snapshot_at.desc&limit=50',
  )).rows as Array<{ snapshot_at: string; idempotency_key: string }>;

  if (sample.length === 0) {
    console.error('not ok - no provider_offer_history rows available to sample');
    process.exit(1);
  }

  const snapshotAt = sample[0]!.snapshot_at;
  const idempotencyKeys = [...new Set(sample.map((r) => r.idempotency_key))].slice(0, 50);
  console.log(`# sampled snapshot_at=${snapshotAt}`);
  console.log(`# sampled idempotency_keys=${idempotencyKeys.length}`);

  // 2) NEW shape — scoped by snapshot_at (mirrors the fix). Must return fast.
  const newPath =
    `provider_offer_history?select=snapshot_at,idempotency_key` +
    `&snapshot_at=${encodeInList([snapshotAt])}` +
    `&idempotency_key=${encodeInList(idempotencyKeys)}`;
  const newResult = await restGet(newPath);
  console.log(
    `# NEW shape (snapshot_at + idempotency_key): ${newResult.ms.toFixed(0)}ms, rows=${newResult.rows.length}`,
  );

  // 3) OLD shape — idempotency_key only (no snapshot_at). Abort at OLD_SHAPE_ABORT_MS.
  let oldOutcome: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLD_SHAPE_ABORT_MS);
  try {
    const oldPath =
      `provider_offer_history?select=idempotency_key` +
      `&idempotency_key=${encodeInList(idempotencyKeys)}`;
    const oldResult = await restGet(oldPath, controller.signal);
    oldOutcome = `returned in ${oldResult.ms.toFixed(0)}ms (rows=${oldResult.rows.length})`;
  } catch (error) {
    oldOutcome =
      controller.signal.aborted
        ? `did NOT return within ${OLD_SHAPE_ABORT_MS}ms (aborted; consistent with the 120s statement_timeout)`
        : `errored: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
  console.log(`# OLD shape (idempotency_key only): ${oldOutcome}`);

  // 4) Verdict.
  if (newResult.ms <= NEW_SHAPE_CEILING_MS) {
    console.log(
      `ok 1 - snapshot_at-scoped dedup pre-load returns in ${newResult.ms.toFixed(0)}ms (<= ${NEW_SHAPE_CEILING_MS}ms ceiling) against the live ~1.39M-row partitioned table`,
    );
    console.log('# 1..1');
    console.log('# pass 1');
    console.log('# fail 0');
    process.exit(0);
  }
  console.error(
    `not ok 1 - snapshot_at-scoped dedup pre-load took ${newResult.ms.toFixed(0)}ms (> ${NEW_SHAPE_CEILING_MS}ms ceiling)`,
  );
  console.log('# fail 1');
  process.exit(1);
}

main().catch((error) => {
  console.error(`not ok - proof script threw: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
