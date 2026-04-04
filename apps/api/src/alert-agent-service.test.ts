import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderOfferRecord } from '@unit-talk/db';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  classifyMovement,
  detectLineMovement,
  isAlertSportActive,
  loadAlertAgentConfig,
  loadAlertThresholds,
  runAlertDetectionPass,
  shouldNotify,
} from './alert-agent-service.js';

test('detectLineMovement computes change, velocity, direction, and market type for spreads', () => {
  const detection = detectLineMovement(
    makeOfferRecord({
      providerMarketKey: 'spread',
      line: 6,
      snapshotAt: '2026-03-28T10:30:00.000Z',
    }),
    makeOfferRecord({
      providerMarketKey: 'spread',
      line: 4.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  );

  assert.ok(detection);
  assert.equal(detection.marketType, 'spread');
  assert.equal(detection.lineChange, 1.5);
  assert.equal(detection.lineChangeAbs, 1.5);
  assert.equal(detection.direction, 'up');
  assert.equal(detection.timeElapsedMinutes, 30);
  assert.equal(detection.velocity, 0.05);
});

test('classifyMovement returns watch for spread movement at watch threshold', () => {
  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'spread',
    lineChange: 0.5,
    lineChangeAbs: 0.5,
  });

  assert.equal(signal?.tier, 'watch');
});

test('classifyMovement returns alert-worthy for totals at alert threshold', () => {
  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'total',
    lineChange: 3,
    lineChangeAbs: 3,
  });

  assert.equal(signal?.tier, 'alert-worthy');
});

test('classifyMovement uses juice movement for moneyline classification', () => {
  const detection = detectLineMovement(
    makeOfferRecord({
      providerMarketKey: 'moneyline',
      line: null,
      overOdds: -130,
      underOdds: -105,
      snapshotAt: '2026-03-28T10:10:00.000Z',
    }),
    makeOfferRecord({
      providerMarketKey: 'moneyline',
      line: null,
      overOdds: -110,
      underOdds: -110,
      snapshotAt: '2026-03-28T10:00:00.000Z',
    }),
  );

  assert.ok(detection);
  assert.equal(detection.marketType, 'moneyline');
  assert.equal(detection.oldLine, -110);
  assert.equal(detection.newLine, -130);
  assert.equal(detection.lineChangeAbs, 20);

  const signal = classifyMovement(detection);
  assert.equal(signal?.tier, 'alert-worthy');
});

test('classifyMovement returns notable for player props at 0.5 units', () => {
  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'player_prop',
    lineChange: 0.5,
    lineChangeAbs: 0.5,
  });

  assert.equal(signal?.tier, 'notable');
});

test('classifyMovement elevates notable spread movement to alert-worthy on velocity override', () => {
  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'spread',
    lineChange: 2,
    lineChangeAbs: 2,
    timeElapsedMinutes: 10,
    velocity: 0.2,
  });

  assert.equal(signal?.tier, 'alert-worthy');
  assert.equal(signal?.metadata.velocityElevated, true);
});

test('classifyMovement discards detections below the watch threshold', () => {
  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'player_prop',
    lineChange: 0.2,
    lineChangeAbs: 0.2,
  });

  assert.equal(signal, null);
});

test('loadAlertThresholds returns the current hardcoded defaults when env is absent', () => {
  const thresholds = loadAlertThresholds({});

  assert.deepEqual(thresholds, {
    markets: {
      spread: { watch: 0.5, notable: 2.0, alertWorthy: 3.5, velocityElevate: 0.5 },
      total: { watch: 0.5, notable: 1.5, alertWorthy: 3.0, velocityElevate: 0.5 },
      moneyline: { watch: 5, notable: 10, alertWorthy: 20, velocityElevate: 10 },
      player_prop: { watch: 0.25, notable: 0.5, alertWorthy: 1.5, velocityElevate: 0.25 },
    },
    velocityWindowMinutes: 15,
  });
});

test('classifyMovement uses env-backed threshold overrides via config loader', () => {
  const config = loadAlertAgentConfig({
    ALERT_THRESHOLD_SPREAD_WATCH: '1.0',
    ALERT_THRESHOLD_SPREAD_NOTABLE: '2.5',
    ALERT_THRESHOLD_SPREAD_ALERT_WORTHY: '4.0',
    ALERT_THRESHOLD_SPREAD_VELOCITY: '1.25',
    ALERT_VELOCITY_WINDOW_MINUTES: '8',
  });

  const watchSignal = classifyMovement(
    {
      ...baseDetection(),
      marketType: 'spread',
      lineChange: 1,
      lineChangeAbs: 1,
    },
    config.thresholds,
  );
  const elevatedSignal = classifyMovement(
    {
      ...baseDetection(),
      marketType: 'spread',
      lineChange: 2.5,
      lineChangeAbs: 2.5,
      timeElapsedMinutes: 7,
      velocity: 0.3571,
    },
    config.thresholds,
  );

  assert.equal(watchSignal?.tier, 'watch');
  assert.equal(elevatedSignal?.tier, 'alert-worthy');
  assert.equal(elevatedSignal?.metadata.velocityElevated, true);
});

test('loadAlertThresholds throws on invalid numeric env values', () => {
  assert.throws(
    () =>
      loadAlertThresholds({
        ALERT_THRESHOLD_ML_WATCH: 'abc',
      }),
    /ALERT_THRESHOLD_ML_WATCH must be a positive number/,
  );
});

test('shouldNotify returns false when a matching notified row is still in cooldown', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.alertDetections.saveDetection({
    idempotencyKey: 'cooldown-1',
    eventId: 'event-uuid-1',
    participantId: 'player-1',
    marketKey: 'spread',
    bookmakerKey: 'sgo',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:15:00.000Z',
    oldLine: 4.5,
    newLine: 6,
    lineChange: 1.5,
    lineChangeAbs: 1.5,
    velocity: 0.1,
    timeElapsedMinutes: 15,
    direction: 'up',
    marketType: 'spread',
    tier: 'notable',
    notified: true,
    notifiedAt: '2026-03-28T10:15:00.000Z',
    cooldownExpiresAt: '2026-03-28T10:45:00.000Z',
    notifiedChannels: ['discord:canary'],
    metadata: {},
  });

  const signal = classifyMovement({
    ...baseDetection(),
    marketType: 'spread',
    lineChange: 2,
    lineChangeAbs: 2,
  });

  assert.equal(
    await shouldNotify(signal!, repositories.alertDetections, {
      eventId: 'event-uuid-1',
      now: '2026-03-28T10:30:00.000Z',
    }),
    false,
  );
});

test('runAlertDetectionPass persists rows and deduplicates on repeated passes', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-1',
    sportId: 'NBA',
    eventName: 'Lakers vs Celtics',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-1',
      providerMarketKey: 'spread',
      line: 4.5,
      snapshotAt: '2026-03-28T09:30:00.000Z',
      idempotencyKey: 'evt-1:spread:sgo:all:4.5:0930',
    }),
    makeOfferInsert({
      providerEventId: 'evt-1',
      providerMarketKey: 'spread',
      line: 6,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      idempotencyKey: 'evt-1:spread:sgo:all:6.0:1000',
    }),
  ]);

  const first = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });
  const second = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.equal(first.persisted, 1);
  assert.equal(first.shouldNotifyCount, 0);
  assert.equal(second.persisted, 0);
  assert.equal(second.duplicateSignals, 1);

  const rows = await repositories.alertDetections.listRecent();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.tier, 'watch');
  assert.equal(rows[0]?.line_change_abs, 1.5);
});

test('runAlertDetectionPass skips detections for disabled sports like NFL', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-nfl',
    sportId: 'NFL',
    eventName: 'Bills vs Chiefs',
    eventDate: '2026-09-10',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-nfl',
      providerMarketKey: 'spread',
      line: 2.5,
      snapshotAt: '2026-09-10T09:00:00.000Z',
      idempotencyKey: 'evt-nfl:spread:sgo:all:2.5:0900',
    }),
    makeOfferInsert({
      providerEventId: 'evt-nfl',
      providerMarketKey: 'spread',
      line: 6,
      snapshotAt: '2026-09-10T10:00:00.000Z',
      idempotencyKey: 'evt-nfl:spread:sgo:all:6.0:1000',
    }),
  ]);

  const result = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-09-10T10:30:00.000Z',
  });

  assert.equal(result.detections, 1);
  assert.equal(result.persisted, 0);
  assert.equal(result.disabledSportCount, 1);
  assert.equal((await repositories.alertDetections.listRecent()).length, 0);
});

test('isAlertSportActive only enables the current live sports set', () => {
  assert.equal(isAlertSportActive('NBA'), true);
  assert.equal(isAlertSportActive('nhl'), true);
  assert.equal(isAlertSportActive('MLB'), true);
  assert.equal(isAlertSportActive('NFL'), false);
  assert.equal(isAlertSportActive('WNBA'), false);
});

test('runAlertDetectionPass uses earliest baseline within the lookback window', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-2',
    sportId: 'NBA',
    eventName: 'Knicks vs Heat',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-2',
      providerMarketKey: 'total',
      providerParticipantId: null,
      line: 221,
      snapshotAt: '2026-03-28T09:00:00.000Z',
      idempotencyKey: 'evt-2:total:sgo:all:221:0900',
    }),
    makeOfferInsert({
      providerEventId: 'evt-2',
      providerMarketKey: 'total',
      providerParticipantId: null,
      line: 221.5,
      snapshotAt: '2026-03-28T09:20:00.000Z',
      idempotencyKey: 'evt-2:total:sgo:all:221.5:0920',
    }),
    makeOfferInsert({
      providerEventId: 'evt-2',
      providerMarketKey: 'total',
      providerParticipantId: null,
      line: 222.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      idempotencyKey: 'evt-2:total:sgo:all:222.5:1000',
    }),
  ]);

  const result = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.equal(result.persisted, 1);
  const row = result.persistedSignals[0];
  assert.equal(row?.baseline_snapshot_at, '2026-03-28T09:00:00.000Z');
  assert.equal(row?.line_change, 1.5);
});

test('runAlertDetectionPass persists separate signals for distinct bookmaker tuples', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-3',
    sportId: 'NBA',
    eventName: 'Bucks vs Bulls',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-3',
      providerKey: 'draftkings',
      providerMarketKey: 'spread',
      line: 4.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
      idempotencyKey: 'evt-3:spread:draftkings:player-1:4.5:0900',
    }),
    makeOfferInsert({
      providerEventId: 'evt-3',
      providerKey: 'draftkings',
      providerMarketKey: 'spread',
      line: 6.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      idempotencyKey: 'evt-3:spread:draftkings:player-1:6.5:1000',
    }),
    makeOfferInsert({
      providerEventId: 'evt-3',
      providerKey: 'fanduel',
      providerMarketKey: 'spread',
      line: 3.5,
      snapshotAt: '2026-03-28T09:00:00.000Z',
      idempotencyKey: 'evt-3:spread:fanduel:player-1:3.5:0900',
    }),
    makeOfferInsert({
      providerEventId: 'evt-3',
      providerKey: 'fanduel',
      providerMarketKey: 'spread',
      line: 5.5,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      idempotencyKey: 'evt-3:spread:fanduel:player-1:5.5:1000',
    }),
  ]);

  const result = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  assert.equal(result.persisted, 2);
  const rows = await repositories.alertDetections.listRecent();
  assert.deepEqual(
    rows.map((row) => row.bookmaker_key).sort(),
    ['draftkings', 'fanduel'],
  );
});

test('shouldNotify scopes cooldown by participant identity as well as market tuple', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.alertDetections.saveDetection({
    idempotencyKey: 'cooldown-entity-1',
    eventId: 'event-uuid-2',
    participantId: 'player-1',
    marketKey: 'player_points',
    bookmakerKey: 'draftkings',
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:15:00.000Z',
    oldLine: 24.5,
    newLine: 25,
    lineChange: 0.5,
    lineChangeAbs: 0.5,
    velocity: 0.0333,
    timeElapsedMinutes: 15,
    direction: 'up',
    marketType: 'player_prop',
    tier: 'notable',
    notified: true,
    notifiedAt: '2026-03-28T10:15:00.000Z',
    cooldownExpiresAt: '2026-03-28T10:45:00.000Z',
    notifiedChannels: ['discord:canary'],
    metadata: {},
  });

  const signal = classifyMovement({
    ...baseDetection(),
    participantId: 'player-2',
    marketKey: 'player_points',
    bookmakerKey: 'draftkings',
    marketType: 'player_prop',
    lineChange: 0.5,
    lineChangeAbs: 0.5,
  });

  assert.equal(
    await shouldNotify(signal!, repositories.alertDetections, {
      eventId: 'event-uuid-2',
      now: '2026-03-28T10:30:00.000Z',
    }),
    true,
  );
});

test('listRecentOffers excludes offers older than the since boundary', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-bound-1',
      line: 4.5,
      snapshotAt: '2026-03-28T08:00:00.000Z',
      idempotencyKey: 'old-offer',
    }),
    makeOfferInsert({
      providerEventId: 'evt-bound-1',
      line: 6.0,
      snapshotAt: '2026-03-28T10:00:00.000Z',
      idempotencyKey: 'recent-offer',
    }),
  ]);

  const recent = await repositories.providerOffers.listRecentOffers('2026-03-28T09:00:00.000Z');
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.idempotency_key, 'recent-offer');
});

test('listRecentOffers respects the limit parameter', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const offers = Array.from({ length: 5 }, (_, i) =>
    makeOfferInsert({
      providerEventId: 'evt-limit-1',
      line: 4.5 + i,
      snapshotAt: `2026-03-28T10:0${i}:00.000Z`,
      idempotencyKey: `limit-offer-${i}`,
    }),
  );
  await repositories.providerOffers.upsertBatch(offers);

  const limited = await repositories.providerOffers.listRecentOffers('2026-03-28T10:00:00.000Z', 3);
  assert.equal(limited.length, 3);
});

test('runAlertDetectionPass only considers offers within lookback window', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.events.upsertByExternalId({
    externalId: 'evt-window-1',
    sportId: 'NBA',
    eventName: 'Suns vs Nuggets',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {},
  });

  // Offer well outside the 60-minute lookback window
  await repositories.providerOffers.upsertBatch([
    makeOfferInsert({
      providerEventId: 'evt-window-1',
      line: 4.5,
      snapshotAt: '2026-03-28T06:00:00.000Z',
      idempotencyKey: 'stale-1',
    }),
    makeOfferInsert({
      providerEventId: 'evt-window-1',
      line: 10.0,
      snapshotAt: '2026-03-28T06:30:00.000Z',
      idempotencyKey: 'stale-2',
    }),
  ]);

  const result = await runAlertDetectionPass(repositories, {
    enabled: true,
    lookbackMinutes: 60,
    minTier: 'watch',
    now: '2026-03-28T10:30:00.000Z',
  });

  // Both offers are outside the 60-min window (before 09:30), so no detections
  assert.equal(result.evaluatedGroups, 0);
  assert.equal(result.detections, 0);
  assert.equal(result.persisted, 0);
});

function baseDetection() {
  return {
    providerEventId: 'evt-1',
    participantId: 'player-1',
    marketKey: 'spread',
    bookmakerKey: 'sgo',
    marketType: 'spread' as const,
    baselineSnapshotAt: '2026-03-28T10:00:00.000Z',
    currentSnapshotAt: '2026-03-28T10:30:00.000Z',
    oldLine: 4.5,
    newLine: 6.5,
    lineChange: 2,
    lineChangeAbs: 2,
    velocity: 0.0667,
    timeElapsedMinutes: 30,
    direction: 'up' as const,
    metadata: {},
  };
}

function makeOfferRecord(
  overrides: Partial<{
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    sportKey: string | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    snapshotAt: string;
    idempotencyKey: string;
  }> = {},
) : ProviderOfferRecord {
  return {
    id: `offer:${overrides.idempotencyKey ?? 'default'}`,
    provider_key: overrides.providerKey ?? 'sgo',
    provider_event_id: overrides.providerEventId ?? 'evt-1',
    provider_market_key: overrides.providerMarketKey ?? 'spread',
    provider_participant_id:
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
    sport_key: overrides.sportKey ?? 'NBA',
    line: overrides.line ?? 4.5,
    over_odds: overrides.overOdds ?? -110,
    under_odds: overrides.underOdds ?? -110,
    devig_mode: 'PAIRED',
    is_opening: false,
    is_closing: false,
    snapshot_at: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    idempotency_key:
      overrides.idempotencyKey ??
      [
        overrides.providerEventId ?? 'evt-1',
        overrides.providerMarketKey ?? 'spread',
        overrides.providerKey ?? 'sgo',
        overrides.providerParticipantId !== undefined
          ? overrides.providerParticipantId
          : 'player-1',
        String(overrides.line ?? 4.5),
        overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
      ].join(':'),
    created_at: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
  };
}

function makeOfferInsert(
  overrides: Partial<{
    providerKey: string;
    providerEventId: string;
    providerMarketKey: string;
    providerParticipantId: string | null;
    sportKey: string | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    snapshotAt: string;
    idempotencyKey: string;
  }> = {},
) {
  return {
    providerKey: overrides.providerKey ?? 'sgo',
    providerEventId: overrides.providerEventId ?? 'evt-1',
    providerMarketKey: overrides.providerMarketKey ?? 'spread',
    providerParticipantId:
      overrides.providerParticipantId !== undefined ? overrides.providerParticipantId : 'player-1',
    sportKey: overrides.sportKey ?? 'NBA',
    line: overrides.line ?? 4.5,
    overOdds: overrides.overOdds ?? -110,
    underOdds: overrides.underOdds ?? -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
    idempotencyKey:
      overrides.idempotencyKey ??
      [
        overrides.providerEventId ?? 'evt-1',
        overrides.providerMarketKey ?? 'spread',
        overrides.providerKey ?? 'sgo',
        overrides.providerParticipantId !== undefined
          ? overrides.providerParticipantId
          : 'player-1',
        String(overrides.line ?? 4.5),
        overrides.snapshotAt ?? '2026-03-28T10:00:00.000Z',
      ].join(':'),
  };
}
