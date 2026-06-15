import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const FIX_MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations_archive/202605090003_utv2_871_provider_offers_quarantine_prune_fix.sql',
  ),
  'utf8',
);

test('provider_offers quarantine prune fix builds the live-safe index concurrently', () => {
  assert.match(
    FIX_MIGRATION,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS provider_offers_legacy_quarantine_created_at_id_idx/i,
  );
  assert.match(
    FIX_MIGRATION,
    /ON public\.provider_offers_legacy_quarantine \(created_at ASC,\s*id ASC\)/i,
  );
});

test('provider_offers bounded prune targets the quarantine base table directly', () => {
  assert.match(
    FIX_MIGRATION,
    /CREATE OR REPLACE FUNCTION public\.prune_provider_offers_bounded/i,
  );
  assert.match(
    FIX_MIGRATION,
    /FROM public\.provider_offers_legacy_quarantine[\s\S]*WHERE created_at < v_cutoff/i,
  );
  assert.match(
    FIX_MIGRATION,
    /DELETE FROM public\.provider_offers_legacy_quarantine[\s\S]*WHERE id IN \(SELECT id FROM doomed\)/i,
  );
  assert.doesNotMatch(
    FIX_MIGRATION,
    /DELETE FROM public\.provider_offers\s/i,
  );
});
