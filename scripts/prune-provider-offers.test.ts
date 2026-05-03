import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCutoffIso,
  parseCliOptions,
} from './prune-provider-offers.ts';

test('prune-provider-offers defaults to 7-day bounded cleanup', () => {
  const options = parseCliOptions([]);

  assert.equal(options.retentionDays, 7);
  assert.equal(options.batchSize, 5_000);
  assert.equal(options.maxBatches, 20);
});

test('prune-provider-offers parses explicit batch controls', () => {
  const options = parseCliOptions([
    '--retention-days', '5',
    '--batch-size', '250',
    '--max-batches', '8',
  ]);

  assert.equal(options.retentionDays, 5);
  assert.equal(options.batchSize, 250);
  assert.equal(options.maxBatches, 8);
});

test('buildCutoffIso subtracts retention days from now', () => {
  const cutoff = buildCutoffIso(7, '2026-04-29T19:00:00.000Z');
  assert.equal(cutoff, '2026-04-22T19:00:00.000Z');
});
