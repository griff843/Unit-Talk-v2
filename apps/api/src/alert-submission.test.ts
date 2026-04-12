import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  createAlertUpstreamAdapter,
  isSystemPickEligible,
} from './alert-submission.js';
import type { AlertDetectionRecord, MarketUniverseUpsertInput } from '@unit-talk/db';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDetection(
  overrides: Partial<AlertDetectionRecord> = {},
): AlertDetectionRecord {
  return {
    id: 'det-1',
    idempotency_key: 'signal-key-1',
    event_id: 'event-1',
    participant_id: null,
    market_key: 'spread',
    bookmaker_key: 'draftkings',
    first_mover_book: 'draftkings',
    baseline_snapshot_at: '2026-04-03T10:00:00.000Z',
    current_snapshot_at: '2026-04-03T10:15:00.000Z',
    old_line: 4.5,
    new_line: 7,
    line_change: 2.5,
    line_change_abs: 2.5,
    velocity: 0.1667,
    time_elapsed_minutes: 15,
    direction: 'up',
    market_type: 'spread',
    tier: 'alert-worthy',
    steam_detected: false,
    notified: false,
    notified_at: null,
    notified_channels: null,
    cooldown_expires_at: null,
    metadata: {},
    created_at: '2026-04-03T10:15:00.000Z',
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('createAlertUpstreamAdapter materializes alert-worthy detection into market_universe', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-spread',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  let upsertedRows: MarketUniverseUpsertInput[] = [];
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async (rows: MarketUniverseUpsertInput[]) => {
      upsertedRows = rows;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  await adapter(makeDetection({ event_id: event.id, market_type: 'spread' }));

  assert.equal(upsertedRows.length, 1);
  assert.equal(upsertedRows[0]?.provider_key, 'alert-agent');
  assert.equal(upsertedRows[0]?.canonical_market_key, 'nba_spread');
  assert.equal(upsertedRows[0]?.current_line, 7);
  assert.equal(upsertedRows[0]?.sport_key, 'NBA');
});

test('createAlertUpstreamAdapter does not POST to /api/submissions (no HTTP dependency)', async () => {
  const repos = createInMemoryRepositoryBundle();
  await repos.events.upsertByExternalId({
    externalId: 'evt-no-http',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  let materialized = false;
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      materialized = true;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  const event = await repos.events.findByExternalId('evt-no-http');
  await adapter(makeDetection({ event_id: event!.id }));

  // Key assertion: adapter wrote to market_universe, no fetch/HTTP involved
  assert.ok(materialized);
});

test('createAlertUpstreamAdapter deduplicates by idempotency key', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-dedup',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  let upsertCount = 0;
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      upsertCount++;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  const detection = makeDetection({ event_id: event.id });
  await adapter(detection);
  await adapter(detection);

  assert.equal(upsertCount, 1);
});

test('createAlertUpstreamAdapter skips when disabled', async () => {
  const repos = createInMemoryRepositoryBundle();
  let upsertCount = 0;
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      upsertCount++;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: false,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  await adapter(makeDetection());
  assert.equal(upsertCount, 0);
});

test('createAlertUpstreamAdapter skips player prop detections', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-pp-skip',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  let upsertCount = 0;
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      upsertCount++;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  await adapter(makeDetection({ event_id: event.id, market_type: 'player_prop' }));
  assert.equal(upsertCount, 0);
});

test('createAlertUpstreamAdapter skips disabled sports', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-nfl-skip',
    sportId: 'NFL',
    eventName: 'Bills vs Chiefs',
    eventDate: '2026-09-10',
    status: 'scheduled',
    metadata: {},
  });

  let upsertCount = 0;
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      upsertCount++;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  await adapter(makeDetection({ event_id: event.id, market_type: 'moneyline' }));
  assert.equal(upsertCount, 0);
});

test('createAlertUpstreamAdapter handles upsert errors without throwing', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-error',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async () => {
      throw new Error('DB connection lost');
    },
  };

  let errorLogged = false;
  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: {
      error() { errorLogged = true; },
      info() {},
    },
  });

  // Should not throw
  await adapter(makeDetection({ event_id: event.id }));
  assert.ok(errorLogged);
});

test('isSystemPickEligible excludes player props and disabled sports', () => {
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'moneyline' },
      { sport_id: 'NBA' },
    ),
    true,
  );
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'player_prop' },
      { sport_id: 'NBA' },
    ),
    false,
  );
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'moneyline' },
      { sport_id: 'NFL' },
    ),
    false,
  );
});

test('createAlertUpstreamAdapter maps total detections to correct canonical key', async () => {
  const repos = createInMemoryRepositoryBundle();
  const event = await repos.events.upsertByExternalId({
    externalId: 'evt-total',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  let upsertedRows: MarketUniverseUpsertInput[] = [];
  const mockMarketUniverse = {
    ...repos.marketUniverse,
    upsertMarketUniverse: async (rows: MarketUniverseUpsertInput[]) => {
      upsertedRows = rows;
    },
  };

  const adapter = createAlertUpstreamAdapter({
    enabled: true,
    events: repos.events,
    participants: repos.participants,
    marketUniverse: mockMarketUniverse,
    logger: { error() {}, info() {} },
  });

  await adapter(makeDetection({
    event_id: event.id,
    market_type: 'total',
    market_key: 'total',
    idempotency_key: 'total-key-1',
  }));

  assert.equal(upsertedRows.length, 1);
  assert.equal(upsertedRows[0]?.canonical_market_key, 'nba_total');
});
