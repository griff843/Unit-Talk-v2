import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/202604291003_utv2_772_provider_offer_current_table_cutover.sql'),
  'utf8',
);

test('provider_offer_current cutover replaces the view with a table', () => {
  assert.match(SOURCE, /DROP VIEW IF EXISTS public\.provider_offer_current/i);
  assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.provider_offer_current/i);
  assert.match(SOURCE, /identity_key text PRIMARY KEY/i);
});

test('provider_offer_current cutover seeds hot rows from legacy provider_offers', () => {
  assert.match(SOURCE, /INSERT INTO public\.provider_offer_current/i);
  assert.match(SOURCE, /FROM public\.provider_offers/i);
  assert.match(SOURCE, /DISTINCT ON \(/i);
});

test('provider_offer_current cutover routes staged merges into history plus current', () => {
  assert.match(SOURCE, /INSERT INTO public\.provider_offer_history/i);
  assert.match(SOURCE, /ON CONFLICT \(snapshot_at, idempotency_key\) DO NOTHING/i);
  assert.match(SOURCE, /INSERT INTO public\.provider_offer_current/i);
  assert.match(SOURCE, /ON CONFLICT \(identity_key\) DO UPDATE/i);
});

test('provider_offer_current opening rpc reads from the hot current table', () => {
  assert.match(SOURCE, /CREATE OR REPLACE FUNCTION public\.list_provider_offer_current_opening/i);
  assert.match(SOURCE, /FROM public\.provider_offer_current current_offer/i);
});
