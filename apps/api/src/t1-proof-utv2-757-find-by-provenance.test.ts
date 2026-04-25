/**
 * t1-proof-utv2-757-find-by-provenance.test.ts
 *
 * Live-DB proof that DatabaseMarketUniverseRepository.findByProvenance
 * correctly resolves a market_universe row by its natural key and
 * returns null for non-existent keys.
 *
 * Skipped when SUPABASE_SERVICE_ROLE_KEY is not set.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDatabaseRepositoryBundle,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';
import { loadEnvironment } from '@unit-talk/config';

test('UTV2-757 findByProvenance — resolves existing market_universe row by natural key', async (t) => {
  let connection;
  try {
    connection = createServiceRoleDatabaseConnectionConfig(loadEnvironment());
  } catch {
    t.skip('Supabase service-role environment unavailable');
    return;
  }

  const repos = createDatabaseRepositoryBundle(connection);

  // Fetch any live market_universe row to use as the lookup target.
  const allRows = await repos.marketUniverse.listForScan(1);
  const target = allRows[0];
  if (!target) {
    t.skip('No market_universe rows in DB — cannot exercise findByProvenance');
    return;
  }

  // Happy path: natural-key lookup must return the same row.
  const found = await repos.marketUniverse.findByProvenance({
    providerKey: target.provider_key,
    providerEventId: target.provider_event_id,
    providerMarketKey: target.provider_market_key,
    providerParticipantId: target.provider_participant_id,
  });

  assert.ok(found !== null, 'findByProvenance must return a row for a valid natural key');
  assert.equal(found.id, target.id, 'returned row id must match the queried row');
  assert.equal(found.provider_key, target.provider_key);
  assert.equal(found.provider_event_id, target.provider_event_id);
  assert.equal(found.provider_market_key, target.provider_market_key);

  // Null path: non-existent natural key must return null without throwing.
  const missing = await repos.marketUniverse.findByProvenance({
    providerKey: '__no_such_provider__',
    providerEventId: '__no_such_event__',
    providerMarketKey: '__no_such_market__',
    providerParticipantId: null,
  });

  assert.equal(missing, null, 'findByProvenance must return null for non-existent natural key');
});
