import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const FIX_MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations_archive/202605090002_utv2_870_provider_offer_history_summarize_fix.sql',
  ),
  'utf8',
);

const PROOF_SCRIPT = readFileSync(
  resolve(
    process.cwd(),
    'apps/ingestor/src/scripts/utv2-772-retention-proof.ts',
  ),
  'utf8',
);

test('summarize fix migration removes the snapshot_date alias collision', () => {
  assert.match(
    FIX_MIGRATION,
    /CREATE OR REPLACE FUNCTION public\.summarize_provider_offer_history_partition/i,
  );
  assert.match(FIX_MIGRATION, /p_date\s+AS\s+snap_dt/i);
  assert.match(FIX_MIGRATION, /SELECT[\s\S]*snap_dt,[\s\S]*FROM agg/i);
  assert.doesNotMatch(FIX_MIGRATION, /p_date\s+AS\s+snapshot_date\s*,/i);
});

test('retention proof script calls summarize RPC with p_date', () => {
  assert.match(PROOF_SCRIPT, /summarize_provider_offer_history_partition/);
  assert.match(
    PROOF_SCRIPT,
    /\{\s*p_date:\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\s*\}/,
  );
  assert.doesNotMatch(PROOF_SCRIPT, /p_cutoff_date/);
});
