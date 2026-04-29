import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/202604291002_utv2_772_provider_offer_history_partitioning.sql'),
  'utf8',
);

test('provider_offer_history design uses range partitioning on snapshot_at', () => {
  assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.provider_offer_history/i);
  assert.match(SOURCE, /PARTITION BY RANGE \(snapshot_at\)/i);
});

test('provider_offer_history design includes partition create and drop helpers', () => {
  assert.match(SOURCE, /ensure_provider_offer_history_partition/i);
  assert.match(SOURCE, /ensure_provider_offer_history_partitions/i);
  assert.match(SOURCE, /drop_provider_offer_history_partitions_before/i);
});

test('provider_offer_history design defines per-partition index strategy', () => {
  assert.match(SOURCE, /provider_snapshot_idx/i);
  assert.match(SOURCE, /event_market_snapshot_idx/i);
  assert.match(SOURCE, /idempotency_idx/i);
  assert.match(SOURCE, /created_at_idx/i);
});
