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
import type {
  ProviderEntityAliasRow,
  ProviderMarketAliasRow,
  ProviderCycleStatusRow,
  ProviderOfferRecord,
  ProviderOfferRepository,
} from '@unit-talk/db';

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

function makeProviderOffersRepo(
  offers: ProviderOfferRecord[],
  aliasRows: ProviderMarketAliasRow[] = [],
  participantAliasRows: ProviderEntityAliasRow[] = [],
): ProviderOfferRepository {
  const cycleStatus: ProviderCycleStatusRow = {
    run_id: 'run-1',
    provider_key: 'sgo',
    league: 'nba',
    cycle_snapshot_at: new Date().toISOString(),
    stage_status: 'merged',
    freshness_status: 'fresh',
    proof_status: 'verified',
    staged_count: 0,
    merged_count: 0,
    duplicate_count: 0,
    failure_category: null,
    failure_scope: null,
    affected_provider_key: null,
    affected_sport_key: null,
    affected_market_key: null,
    last_error: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return {
    async listRecentOffers(_since: string, _limit?: number) {
      return offers;
    },
    // Satisfy interface — unused in these tests
    upsertBatch: async () => ({ insertedCount: 0, updatedCount: 0, totalProcessed: 0 }),
    stageBatch: async () => ({ stagedCount: 0, duplicateCount: 0, totalProcessed: 0 }),
    mergeStagedCycle: async () => ({ processedCount: 0, mergedCount: 0, duplicateCount: 0 }),
    upsertCycleStatus: async () => cycleStatus,
    getCycleStatus: async () => null,
    listStagedOffers: async () => [],
    findClosingLine: async () => null,
    findOpeningLine: async () => null,
    findLatestByMarketKey: async () => null,
    findCurrentOffer: async () => null,
    listAll: async () => [],
    listByProvider: async () => [],
    findExistingCombinations: async () => new Set<string>(),
    markClosingLines: async () => 0,
    resolveProviderMarketKey: async () => null,
    resolveCanonicalMarketKey: async () => null,
    listAliasLookup: async () => aliasRows,
    listParticipantAliasLookup: async () => participantAliasRows,
    listOpeningOffers: async () => [],
    listOpeningCurrentOffers: async () => [],
    listClosingOffers: async () => offers.filter((o) => o.is_closing),
    savePickOfferSnapshot: async () => {
      throw new Error('unused in test');
    },
    listPickOfferSnapshots: async () => [],
    listCompactHistory: async () => [],
  };
}

function makeAliasRow(
  overrides: Partial<ProviderMarketAliasRow> = {},
): ProviderMarketAliasRow {
  const now = new Date().toISOString();
  return {
    id: 'alias-1',
    provider: 'sgo',
    provider_market_key: 'points-all-game-ou',
    provider_display_name: 'Points',
    market_type_id: 'player_points_ou',
    sport_id: null,
    stat_type_id: null,
    combo_stat_type_id: null,
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeParticipantAliasRow(
  overrides: Partial<ProviderEntityAliasRow> = {},
): ProviderEntityAliasRow {
  const now = new Date().toISOString();
  return {
    id: 'participant-alias-1',
    provider: 'sgo',
    entity_kind: 'player',
    provider_entity_key: 'LEBRON_JAMES_2544_NBA',
    provider_entity_id: 'LEBRON_JAMES_2544_NBA',
    provider_display_name: 'LeBron James',
    participant_id: 'participant-lebron',
    team_id: null,
    player_id: null,
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides,
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

test('materializer: SGO participant rows fail closed for participant-forbidden game-total aliases', async () => {
  const offer = makeOffer({
    provider_market_key: 'points-all-1h-ou',
    provider_participant_id: 'AARON_GORDON_1_NBA',
  });
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo([offer], [
    makeAliasRow({
      provider_market_key: 'points-all-1h-ou',
      market_type_id: '1h_total_ou',
    }),
  ]);

  const materializer = new MarketUniverseMaterializer({
    providerOffers,
    marketUniverse,
  });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.provider_participant_id, 'AARON_GORDON_1_NBA');
  assert.equal(row.provider_market_key, 'points-all-1h-ou');
  assert.equal(row.market_type_id, null);
  assert.equal(row.canonical_market_key, 'points-all-1h-ou');
});

test('materializer: SGO participant contract covers required, forbidden, and optional market families', async () => {
  const playerProp = makeOffer({
    id: 'player-prop',
    idempotency_key: 'player-prop',
    provider_market_key: 'rebounds-all-game-ou',
    provider_participant_id: 'LEBRON_JAMES_2544_NBA',
  });
  const gameTotalWithParticipant = makeOffer({
    id: 'game-total',
    idempotency_key: 'game-total',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'LEBRON_JAMES_2544_NBA',
    line: 224.5,
  });
  const optionalSpread = makeOffer({
    id: 'spread',
    idempotency_key: 'spread',
    provider_market_key: 'points-all-game-spread',
    provider_participant_id: 'home',
    line: -4.5,
  });
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepo(
    [playerProp, gameTotalWithParticipant, optionalSpread],
    [
      makeAliasRow({
        provider_market_key: 'rebounds-all-game-ou',
        market_type_id: 'player_rebounds_ou',
      }),
      makeAliasRow({
        id: 'alias-game-total',
        provider_market_key: 'points-all-game-ou',
        market_type_id: 'game_total_ou',
        sport_id: 'NBA',
      }),
      makeAliasRow({
        id: 'alias-spread',
        provider_market_key: 'points-all-game-spread',
        market_type_id: 'game_spread',
      }),
    ],
    [makeParticipantAliasRow()],
  );

  const materializer = new MarketUniverseMaterializer({
    providerOffers,
    marketUniverse,
  });
  await materializer.run();

  const rows = marketUniverse.listAll();
  const playerRow = rows.find(
    (row) => row.provider_market_key === 'rebounds-all-game-ou',
  );
  const gameTotalRow = rows.find(
    (row) =>
      row.provider_market_key === 'points-all-game-ou' &&
      row.provider_participant_id === 'LEBRON_JAMES_2544_NBA',
  );
  const spreadRow = rows.find(
    (row) => row.provider_market_key === 'points-all-game-spread',
  );

  assert.ok(playerRow);
  assert.equal(playerRow.market_type_id, 'player_rebounds_ou');
  assert.equal(playerRow.participant_id, 'participant-lebron');

  assert.ok(gameTotalRow);
  assert.equal(gameTotalRow.market_type_id, null);
  assert.equal(gameTotalRow.canonical_market_key, 'points-all-game-ou');

  assert.ok(spreadRow);
  assert.equal(spreadRow.market_type_id, 'game_spread');
  assert.equal(spreadRow.canonical_market_key, 'game_spread');
});

// ---------------------------------------------------------------------------
// UTV2-744: Historical CLV fidelity — provider-faithful closing line selection
// ---------------------------------------------------------------------------

function makeProviderOffersRepoSplit(
  recentOffers: ProviderOfferRecord[],
  closingOffers: ProviderOfferRecord[],
  aliasRows: ProviderMarketAliasRow[] = [],
  participantAliasRows: ProviderEntityAliasRow[] = [],
): ProviderOfferRepository {
  const base = makeProviderOffersRepo(
    recentOffers,
    aliasRows,
    participantAliasRows,
  );
  return {
    ...base,
    async listRecentOffers(_since: string, _limit?: number) {
      return recentOffers;
    },
    async listClosingOffers(_since: string) {
      return closingOffers;
    },
  };
}

test('materializer: pre-commence closing offer absent from listRecentOffers is fetched via listClosingOffers and sets closing_line', async () => {
  // Key regression: SGO closing offers carry pre-commence timestamps — they sort
  // behind live offers and get cut by the row cap in listRecentOffers.
  // The materializer fetches them separately and must still set closing_line.
  const liveOffer = makeOffer({
    id: 'live-1',
    idempotency_key: 'live-1',
    is_opening: false,
    is_closing: false,
    line: 26.5,
    over_odds: -120,
    under_odds: 100,
    snapshot_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago (recent)
  });
  // Closing offer has an OLD timestamp (pre-commence) — NOT in listRecentOffers
  const closingOffer = makeOffer({
    id: 'closing-precommence-1',
    idempotency_key: 'closing-precommence-1',
    is_opening: false,
    is_closing: true,
    line: 25.5,
    over_odds: -108,
    under_odds: -112,
    snapshot_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h ago (pre-commence)
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  // listRecentOffers returns only the live offer — closing offer excluded by row cap
  const providerOffers = makeProviderOffersRepoSplit([liveOffer], [closingOffer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.current_line, 26.5, 'current_line from the live (recent) offer');
  assert.equal(row.closing_line, 25.5, 'closing_line must be set from the separate closing-offers fetch');
  assert.equal(row.closing_over_odds, -108);
  assert.equal(row.closing_under_odds, -112);
});

test('materializer: closing offer appearing in both result sets is deduplicated by id', async () => {
  const closingOffer = makeOffer({
    id: 'closing-dup-1',
    idempotency_key: 'closing-dup-1',
    is_opening: false,
    is_closing: true,
    line: 23.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  // Same offer in both result sets — merged via offerById Map, so only one row
  const providerOffers = makeProviderOffersRepoSplit([closingOffer], [closingOffer]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  const result = await materializer.run();

  assert.equal(result.upserted, 1, 'duplicate closing offer must not produce two market_universe rows');
  assert.equal(marketUniverse.listAll().length, 1);
  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.closing_line, 23.5);
});

test('materializer: multiple is_closing offers for same natural key — earliest snapshot_at wins', async () => {
  const baseFields = {
    provider_key: 'sgo',
    provider_event_id: 'event-abc',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'player-1',
    is_opening: false,
    is_closing: true,
  };
  const earlierClosing = makeOffer({
    ...baseFields,
    id: 'closing-a',
    idempotency_key: 'closing-a',
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(), // 2h ago — earliest
  });
  const laterClosing = makeOffer({
    ...baseFields,
    id: 'closing-b',
    idempotency_key: 'closing-b',
    line: 25.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago — later
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepoSplit([earlierClosing, laterClosing], []);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.closing_line, 24.5, 'earliest is_closing offer wins for closing_line');
  assert.equal(row.closing_over_odds, -110);
});

test('materializer: MLB sport_key — closing_line set correctly from separate closing fetch', async () => {
  const mlbLive = makeOffer({
    id: 'mlb-live-1',
    idempotency_key: 'mlb-live-1',
    provider_event_id: 'mlb-event-1',
    provider_market_key: 'hits-all-game-ou',
    provider_participant_id: 'MLB_PLAYER_1',
    sport_key: 'mlb',
    is_opening: false,
    is_closing: false,
    line: 1.5,
    over_odds: -130,
    under_odds: 110,
    snapshot_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const mlbClosing = makeOffer({
    id: 'mlb-closing-1',
    idempotency_key: 'mlb-closing-1',
    provider_event_id: 'mlb-event-1',
    provider_market_key: 'hits-all-game-ou',
    provider_participant_id: 'MLB_PLAYER_1',
    sport_key: 'mlb',
    is_opening: false,
    is_closing: true,
    line: 1.5,
    over_odds: -140,
    under_odds: 120,
    snapshot_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // pre-commence
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepoSplit([mlbLive], [mlbClosing]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.sport_key, 'mlb');
  assert.equal(row.closing_line, 1.5);
  assert.equal(row.closing_over_odds, -140, 'MLB closing_over_odds from is_closing=true row');
  assert.equal(row.closing_under_odds, 120);
  assert.equal(row.current_over_odds, -130, 'current odds from live (most recent) row');
});

test('materializer: NHL sport_key — closing_line set correctly from separate closing fetch', async () => {
  const nhlLive = makeOffer({
    id: 'nhl-live-1',
    idempotency_key: 'nhl-live-1',
    provider_event_id: 'nhl-event-1',
    provider_market_key: 'shots-all-game-ou',
    provider_participant_id: 'NHL_PLAYER_1',
    sport_key: 'nhl',
    is_opening: false,
    is_closing: false,
    line: 2.5,
    over_odds: -120,
    under_odds: 100,
    snapshot_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  });
  const nhlClosing = makeOffer({
    id: 'nhl-closing-1',
    idempotency_key: 'nhl-closing-1',
    provider_event_id: 'nhl-event-1',
    provider_market_key: 'shots-all-game-ou',
    provider_participant_id: 'NHL_PLAYER_1',
    sport_key: 'nhl',
    is_opening: false,
    is_closing: true,
    line: 2.5,
    over_odds: -125,
    under_odds: 105,
    snapshot_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), // pre-commence
  });

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const providerOffers = makeProviderOffersRepoSplit([nhlLive], [nhlClosing]);

  const materializer = new MarketUniverseMaterializer({ providerOffers, marketUniverse });
  await materializer.run();

  const row = marketUniverse.listAll()[0]!;
  assert.equal(row.sport_key, 'nhl');
  assert.equal(row.closing_line, 2.5);
  assert.equal(row.closing_over_odds, -125, 'NHL closing_over_odds from is_closing=true row');
});

test('materializer: listClosingOffers failure throws — no silent CLV substitution', async () => {
  const offer = makeOffer({
    id: 'ok-1',
    idempotency_key: 'ok-1',
    is_opening: true,
    is_closing: false,
    line: 20.5,
    over_odds: -110,
    under_odds: -110,
    snapshot_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  });

  const faultyRepo = {
    ...makeProviderOffersRepo([offer]),
    async listClosingOffers(): Promise<ProviderOfferRecord[]> {
      throw new Error('closing offers fetch timeout');
    },
  };

  const marketUniverse = new InMemoryMarketUniverseRepository();
  const materializer = new MarketUniverseMaterializer({ providerOffers: faultyRepo, marketUniverse });

  await assert.rejects(
    () => materializer.run(),
    /closing offers fetch timeout/,
    'materializer must throw when closing-offer fetch fails — no silent CLV substitution',
  );
});
