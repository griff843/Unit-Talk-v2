/**
 * market-universe-materializer.test.ts
 *
 * Unit tests for MarketUniverseMaterializer using in-memory repositories.
 * No live DB required.
 *
 * Test runner: node:test + tsx --test
 * Assertions: node:assert/strict
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketUniverseMaterializer } from './market-universe-materializer.js';
import { InMemoryMarketUniverseRepository } from '@unit-talk/db';
import type { ProviderOfferRecord } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Minimal stub for ProviderOfferRepository (only listRecentOffers is needed)
// ---------------------------------------------------------------------------

function makeOffer(overrides: Partial<ProviderOfferRecord> = {}): ProviderOfferRecord {
  return {
    id: 'offer-1',
    idempotency_key: 'idem-1',
    provider_key: 'sgo',
    provider_event_id: 'event-abc',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'player-1',
    bookmaker_key: null,
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    is_opening: true,
    is_closing: false,
    snapshot_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    sport_key: 'nba',
    devig_mode: 'PAIRED',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeProviderOffersRepo(offers: ProviderOfferRecord[]) {
  return {
    async listRecentOffers(_since: string, _limit?: number) {
      return offers;
    },
    // Satisfy interface — unused in these tests
    upsertBatch: async () => ({ insertedCount: 0, updatedCount: 0, totalProcessed: 0 }),
    findClosingLine: async () => null,
    findOpeningLine: async () => null,
    findLatestByMarketKey: async () => null,
    listAll: async () => [],
    listByProvider: async () => [],
    findExistingCombinations: async () => new Set<string>(),
    markClosingLines: async () => 0,
    resolveProviderMarketKey: async () => null,
    resolveCanonicalMarketKey: async () => null,
    listOpeningOffers: async () => [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('materializer: returns zero result when no offers exist', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  const result = await materializer.run();

  assert.equal(result.upserted, 0);
  assert.equal(result.errors, 0);
  assert.ok(result.durationMs >= 0);
  assert.equal(marketUniverse.listAll().length, 0);
});

test('materializer: upserts one row from a single offer', async () => {
  const offer = makeOffer();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  const result = await materializer.run();

  assert.equal(result.upserted, 1);
  assert.equal(result.errors, 0);
  assert.equal(marketUniverse.listAll().length, 1);

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.provider_key, 'sgo');
  assert.equal(row.provider_event_id, 'event-abc');
  assert.equal(row.provider_market_key, 'points-all-game-ou');
  assert.equal(row.current_line, 24.5);
  assert.equal(row.current_over_odds, -110);
  assert.equal(row.current_under_odds, -110);
  // Opening values set because is_opening = true
  assert.equal(row.opening_line, 24.5);
  assert.equal(row.opening_over_odds, -110);
  assert.equal(row.opening_under_odds, -110);
  // No closing values
  assert.equal(row.closing_line, null);
});

test('materializer: idempotent — running twice does not increase row count', async () => {
  const offer = makeOffer();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();
  await materializer.run();

  assert.equal(marketUniverse.listAll().length, 1);
});

test('materializer: two offers with different natural keys produce two rows', async () => {
  const offer1 = makeOffer({ id: 'o1', idempotency_key: 'i1', provider_participant_id: 'player-1' });
  const offer2 = makeOffer({ id: 'o2', idempotency_key: 'i2', provider_participant_id: 'player-2' });
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer1, offer2]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  const result = await materializer.run();

  assert.equal(result.upserted, 2);
  assert.equal(marketUniverse.listAll().length, 2);
});

test('materializer: opening values are not overwritten on second run', async () => {
  const snapshotAt1 = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
  const snapshotAt2 = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30min ago

  const openingOffer = makeOffer({
    id: 'o1',
    idempotency_key: 'i1',
    is_opening: true,
    is_closing: false,
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: snapshotAt1,
  });
  const laterOffer = makeOffer({
    id: 'o2',
    idempotency_key: 'i2',
    is_opening: false,
    is_closing: false,
    line: 25.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: snapshotAt2,
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();

  // First run: both offers
  const firstMaterializer = new MarketUniverseMaterializer({
    providerOffers: makeProviderOffersRepo([openingOffer, laterOffer]),
    marketUniverse,
  });
  await firstMaterializer.run();

  // Check opening was set from the earliest is_opening=true offer
  const rowAfterFirst = marketUniverse.listAll()[0]!;
  assert.equal(rowAfterFirst.opening_line, 24.5);
  assert.equal(rowAfterFirst.current_line, 25.5); // current = latest

  // Second run: only laterOffer (simulate a window that doesn't include the opening)
  const secondMaterializer = new MarketUniverseMaterializer({
    providerOffers: makeProviderOffersRepo([laterOffer]),
    marketUniverse,
  });
  await secondMaterializer.run();

  // Opening values must be preserved
  const rowAfterSecond = marketUniverse.listAll()[0]!;
  assert.equal(rowAfterSecond.opening_line, 24.5, 'opening_line must not be overwritten');
  assert.equal(rowAfterSecond.opening_over_odds, -110, 'opening_over_odds must not be overwritten');
});

test('materializer: closing values are set from is_closing=true offer', async () => {
  const snapshotAt1 = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const snapshotAt2 = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  const openingOffer = makeOffer({
    id: 'o1',
    idempotency_key: 'i1',
    is_opening: true,
    is_closing: false,
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: snapshotAt1,
  });
  const closingOffer = makeOffer({
    id: 'o2',
    idempotency_key: 'i2',
    is_opening: false,
    is_closing: true,
    line: 26.5,
    over_odds: -120,
    under_odds: -100,
    snapshot_at: snapshotAt2,
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([openingOffer, closingOffer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.closing_line, 26.5);
  assert.equal(row.closing_over_odds, -120);
  assert.equal(row.closing_under_odds, -100);
});

test('materializer: is_stale=true when last snapshot older than 2 hours', async () => {
  // Snapshot more than 2 hours ago
  const staleOffer = makeOffer({
    snapshot_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    is_opening: true,
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([staleOffer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.is_stale, true);
});

test('materializer: is_stale=false when last snapshot is recent', async () => {
  const freshOffer = makeOffer({
    snapshot_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    is_opening: true,
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([freshOffer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.is_stale, false);
});

test('materializer: fair probabilities are computed for valid odds', async () => {
  const offer = makeOffer({ over_odds: -110, under_odds: -110 });
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.ok(row.fair_over_prob !== null, 'fair_over_prob should be computed');
  assert.ok(row.fair_under_prob !== null, 'fair_under_prob should be computed');
  // -110/-110 should produce ~0.5/0.5 after devig
  assert.ok(row.fair_over_prob! > 0.49 && row.fair_over_prob! < 0.51);
  assert.ok(row.fair_under_prob! > 0.49 && row.fair_under_prob! < 0.51);
});

test('materializer: fair probabilities are null when odds are null', async () => {
  const offer = makeOffer({ over_odds: null, under_odds: null });
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.fair_over_prob, null);
  assert.equal(row.fair_under_prob, null);
});

test('materializer: current line reflects the latest snapshot among multiple offers for same natural key', async () => {
  const earlier = makeOffer({
    id: 'o1',
    idempotency_key: 'i1',
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    is_opening: true,
    is_closing: false,
  });
  const later = makeOffer({
    id: 'o2',
    idempotency_key: 'i2',
    line: 25.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    is_opening: false,
    is_closing: false,
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([earlier, later]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.current_line, 25.5, 'current_line should reflect the latest snapshot');
  assert.equal(row.opening_line, 24.5, 'opening_line should come from is_opening=true snapshot');
});
