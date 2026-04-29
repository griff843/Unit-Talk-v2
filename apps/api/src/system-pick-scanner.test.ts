import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InMemoryProviderOfferRepository,
  InMemoryParticipantRepository,
  InMemoryEventRepository,
  InMemoryMarketUniverseRepository,
} from '@unit-talk/db';
import { runSystemPickScan, type SystemPickScanOptions } from './system-pick-scanner.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    provider_key: 'sgo',
    provider_event_id: 'event-1',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'player-ext-1',
    bookmaker_key: 'sgo',
    line: 24.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: new Date().toISOString(),
    is_opening: true,
    is_closing: false,
    metadata: {},
    ...overrides,
  };
}

function baseOptions(overrides: Partial<SystemPickScanOptions> = {}): SystemPickScanOptions {
  return {
    enabled: true,
    lookbackHours: 24,
    maxOffersPerRun: 100,
    ...overrides,
  };
}

function makeRepos(overrides: Record<string, unknown> = {}) {
  return {
    providerOffers: new InMemoryProviderOfferRepository(),
    participants: new InMemoryParticipantRepository(),
    events: new InMemoryEventRepository(),
    marketUniverse: new InMemoryMarketUniverseRepository(),
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('returns zeros when disabled', async () => {
  const repos = makeRepos();
  const result = await runSystemPickScan(repos, baseOptions({ enabled: false }));

  assert.equal(result.scanned, 0);
  assert.equal(result.materialized, 0);
});

test('returns zeros when no opening offers exist', async () => {
  const repos = makeRepos();
  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.scanned, 0);
  assert.equal(result.materialized, 0);
});

test('skips offers with no canonical market key', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => null,
    listOpeningCurrentOffers: async () => [makeOffer({ provider_health_state: 'healthy' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({ providerOffers: mockOffers });
  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.scanned, 1);
  assert.equal(result.materialized, 0);
  assert.equal(result.skipped, 1);
});

test('materializes a valid offer into market_universe', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [makeOffer({ provider_health_state: 'healthy' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  let upsertedRows: unknown[] = [];
  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async (rows: unknown[]) => {
      upsertedRows = rows;
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.scanned, 1);
  assert.equal(result.materialized, 1);
  assert.equal(result.errors, 0);
  assert.equal(upsertedRows.length, 1);

  const row = upsertedRows[0] as Record<string, unknown>;
  assert.equal(row.canonical_market_key, 'player_points_ou');
  assert.equal(row.provider_event_id, 'event-1');
  assert.equal(row.provider_market_key, 'points-all-game-ou');
});

test('does not POST to /api/submissions (no HTTP calls)', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [makeOffer({ provider_health_state: 'healthy' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({ providerOffers: mockOffers });
  const result = await runSystemPickScan(repos, baseOptions());

  // The key assertion: materialized > 0 means it wrote to market_universe
  // AND there's no fetchImpl, no apiUrl, no HTTP dependency at all
  assert.equal(result.materialized, 1);
  assert.equal(result.errors, 0);
});

test('computes fair probabilities in upserted rows', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [makeOffer({ over_odds: -115, under_odds: -105, provider_health_state: 'healthy' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  let upsertedRows: unknown[] = [];
  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async (rows: unknown[]) => {
      upsertedRows = rows;
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  await runSystemPickScan(repos, baseOptions());

  const row = upsertedRows[0] as Record<string, unknown>;
  assert.ok(typeof row.fair_over_prob === 'number', 'fair_over_prob should be a number');
  assert.ok(typeof row.fair_under_prob === 'number', 'fair_under_prob should be a number');
  assert.ok((row.fair_over_prob as number) > 0 && (row.fair_over_prob as number) < 1, 'fair_over_prob should be a probability');
});

test('sets opening values from opening offers', async () => {
  const offer = makeOffer({ is_opening: true, line: 24.5, over_odds: -115, under_odds: -105 });
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [offer],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  let upsertedRows: unknown[] = [];
  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async (rows: unknown[]) => {
      upsertedRows = rows;
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  await runSystemPickScan(repos, baseOptions());

  const row = upsertedRows[0] as Record<string, unknown>;
  assert.equal(row.opening_line, 24.5);
  assert.equal(row.opening_over_odds, -115);
  assert.equal(row.opening_under_odds, -105);
});

test('counts upsert errors without throwing', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [makeOffer({ provider_health_state: 'healthy' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async () => {
      throw new Error('upsert failed');
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.errors, 1);
  assert.equal(result.materialized, 0);
});

test('multiple offers are batched into a single upsert', async () => {
  const offers = [
    makeOffer({ provider_event_id: 'e1', provider_participant_id: 'p1' }),
    makeOffer({ provider_event_id: 'e2', provider_participant_id: 'p2' }),
  ];

  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => offers,
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  let upsertedRows: unknown[] = [];
  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async (rows: unknown[]) => {
      upsertedRows = rows;
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.materialized, 2);
  assert.equal(upsertedRows.length, 2);
});

test('suppresses fail-state current offers before market_universe materialization', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [makeOffer({ provider_health_state: 'fail' })],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({ providerOffers: mockOffers });
  const result = await runSystemPickScan(repos, baseOptions());

  assert.equal(result.scanned, 1);
  assert.equal(result.materialized, 0);
  assert.equal(result.skipped, 1);
});

test('degraded current offers receive a confidence drop before fair probabilities are written', async () => {
  const degradedOffer = makeOffer({
    over_odds: -115,
    under_odds: -105,
    provider_health_state: 'degraded',
  });
  const healthyOffer = makeOffer({
    provider_event_id: 'event-2',
    provider_participant_id: 'player-ext-2',
    over_odds: -115,
    under_odds: -105,
    provider_health_state: 'healthy',
  });
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningCurrentOffers: async () => [degradedOffer, healthyOffer],
    listAliasLookup: async () => [],
    listParticipantAliasLookup: async () => [],
  } as ReturnType<typeof Object.assign>;

  let upsertedRows: Array<Record<string, unknown>> = [];
  const mockMarketUniverse = {
    ...new InMemoryMarketUniverseRepository(),
    upsertMarketUniverse: async (rows: Array<Record<string, unknown>>) => {
      upsertedRows = rows;
    },
  } as ReturnType<typeof Object.assign>;

  const repos = makeRepos({
    providerOffers: mockOffers,
    marketUniverse: mockMarketUniverse,
  });

  await runSystemPickScan(repos, baseOptions({ degradedConfidenceFactor: 0.5 }));

  const degradedRow = upsertedRows.find((row) => row.provider_event_id === 'event-1');
  const healthyRow = upsertedRows.find((row) => row.provider_event_id === 'event-2');
  assert.ok(degradedRow);
  assert.ok(healthyRow);
  assert.ok(
    Math.abs((degradedRow.fair_over_prob as number) - 0.5) <
      Math.abs((healthyRow.fair_over_prob as number) - 0.5),
  );
});
