import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/202604300002_utv2_803_provider_offer_compact_and_pick_snapshots.sql',
  ),
  'utf8',
);

const FOLLOW_UP_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/202604300003_utv2_803_pick_offer_snapshots_posting_kind.sql',
  ),
  'utf8',
);

test('provider_offer_history_compact migration creates compact history and immutable pick snapshots', () => {
  assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.provider_offer_history_compact/i);
  assert.match(SOURCE, /CREATE TABLE IF NOT EXISTS public\.pick_offer_snapshots/i);
  assert.match(SOURCE, /snapshot_kind IN \('submission', 'approval', 'queue', 'closing_for_clv', 'settlement_proof'\)/i);
});

test('provider_offer_history_compact migration dual-writes compact deltas from merge_provider_offer_staging_cycle', () => {
  assert.match(SOURCE, /CREATE OR REPLACE FUNCTION public\.merge_provider_offer_staging_cycle/i);
  assert.match(SOURCE, /INSERT INTO public\.provider_offer_history_compact/i);
  assert.match(SOURCE, /change_reason/i);
  assert.match(SOURCE, /current_before/i);
});

test('pick_offer_snapshots follow-up migration replaces queue proof with posting proof', () => {
  assert.match(FOLLOW_UP_SOURCE, /delete from public\.pick_offer_snapshots\s+where snapshot_kind = 'queue'/i);
  assert.match(
    FOLLOW_UP_SOURCE,
    /snapshot_kind in \(\s*'submission',\s*'approval',\s*'posting',\s*'closing_for_clv',\s*'settlement_proof'\s*\)/i,
  );
});
