import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCutoffIso,
  buildDeleteBatchQuery,
  buildOldRowProofQuery,
  parseCliOptions,
} from './provider-offers-legacy-retention-mitigation.ts';

test('legacy retention mitigation defaults to 7-day dry-run with bounded batches', () => {
  const options = parseCliOptions([]);

  assert.equal(options.retentionDays, 7);
  assert.equal(options.batchSize, 5_000);
  assert.equal(options.maxBatches, 20);
  assert.equal(options.apply, false);
});

test('legacy retention mitigation parses explicit apply controls', () => {
  const options = parseCliOptions([
    '--retention-days', '9',
    '--batch-size', '250',
    '--max-batches', '4',
    '--apply',
  ]);

  assert.equal(options.retentionDays, 9);
  assert.equal(options.batchSize, 250);
  assert.equal(options.maxBatches, 4);
  assert.equal(options.apply, true);
});

test('buildCutoffIso subtracts retention days from now', () => {
  const cutoff = buildCutoffIso(7, '2026-04-30T15:00:00.000Z');
  assert.equal(cutoff, '2026-04-23T15:00:00.000Z');
});

test('old-row proof query preserves unresolved pick events', () => {
  const query = buildOldRowProofQuery('2026-04-23T15:00:00.000Z');

  assert.match(query, /pick\.status NOT IN \('settled', 'voided'\)/);
  assert.match(query, /LEFT JOIN public\.events event_by_id/i);
  assert.match(query, /LEFT JOIN public\.events event_by_name/i);
  assert.match(query, /old_rows_deletable/i);
});

test('delete batch query removes only old rows outside the preserve set', () => {
  const query = buildDeleteBatchQuery('2026-04-23T15:00:00.000Z', 250);

  assert.match(query, /DELETE FROM public\.provider_offers/i);
  assert.match(query, /preserve_event_ids/i);
  assert.match(query, /preserve\.provider_event_id IS NULL/i);
  assert.match(query, /LIMIT 250/i);
});
