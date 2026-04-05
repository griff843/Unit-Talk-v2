import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { computeAndAttachCLV } from './clv-service.js';

test('ProviderOfferRepository.findClosingLine returns latest offer before cutoff for player props', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_1',
      sportKey: 'NBA',
      line: 24.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-26T20:00:00.000Z',
      idempotencyKey: 'offer-1',
      bookmakerKey: null,
    },
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_1',
      sportKey: 'NBA',
      line: 24.5,
      overOdds: -105,
      underOdds: -115,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-26T21:00:00.000Z',
      idempotencyKey: 'offer-2',
      bookmakerKey: null,
    },
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_1',
      sportKey: 'NBA',
      line: 24.5,
      overOdds: -120,
      underOdds: 100,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-26T22:30:00.000Z',
      idempotencyKey: 'offer-3',
      bookmakerKey: null,
    },
  ]);

  const result = await repositories.providerOffers.findClosingLine({
    providerEventId: 'evt-1',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: 'PLAYER_1',
    before: '2026-03-26T22:00:00.000Z',
  });

  assert.equal(result?.idempotency_key, 'offer-2');
});

test('ProviderOfferRepository.findClosingLine returns null when no match exists', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await repositories.providerOffers.findClosingLine({
    providerEventId: 'missing-event',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: 'PLAYER_1',
    before: '2026-03-26T22:00:00.000Z',
  });

  assert.equal(result, null);
});

test('ProviderOfferRepository.findClosingLine handles participant-less markets', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-total',
      providerMarketKey: 'total-all-game-ou',
      providerParticipantId: null,
      sportKey: 'NBA',
      line: 222.5,
      overOdds: -112,
      underOdds: -108,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-26T22:00:00.000Z',
      idempotencyKey: 'total-1',
      bookmakerKey: null,
    },
  ]);

  const result = await repositories.providerOffers.findClosingLine({
    providerEventId: 'evt-total',
    providerMarketKey: 'total-all-game-ou',
    providerParticipantId: null,
    before: '2026-03-26T23:00:00.000Z',
  });

  assert.equal(result?.idempotency_key, 'total-1');
});

test('computeAndAttachCLV returns a positive CLV result when pick beats the closing line', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_1',
    displayName: 'Player One',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-1',
    sportId: 'NBA',
    eventName: 'Player One vs. Defense',
    eventDate: '2026-03-26',
    status: 'scheduled',
    metadata: {
      starts_at: '2026-03-26T23:30:00.000Z',
    },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_1',
      sportKey: 'NBA',
      line: 24.5,
      overOdds: 110,
      underOdds: -130,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-26T23:20:00.000Z',
      idempotencyKey: 'clv-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-clv-1',
      submission_id: 'submission-clv-1',
      participant_id: participant.id,
      market: 'points-all-game-ou',
      selection: 'Over 24.5',
      line: 24.5,
      odds: -105,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 91,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-03-26T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-03-26T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {
        eventName: 'Player One vs. Defense',
      },
      created_at: '2026-03-26T20:00:00.000Z',
      updated_at: '2026-03-26T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result);
  assert.equal(result.providerKey, 'sgo');
  assert.equal(result.closingOdds, 110);
  assert.equal(result.beatsClosingLine, true);
  assert.ok(result.clvRaw > 0);
});

test('computeAndAttachCLV falls back to event_date cutoff when starts_at is missing', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_2',
    displayName: 'Player Two',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-2',
    sportId: 'NBA',
    eventName: 'Fallback Event',
    eventDate: '2026-03-27',
    status: 'scheduled',
    metadata: {},
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-2',
      providerMarketKey: 'assists-all-game-ou',
      providerParticipantId: 'PLAYER_2',
      sportKey: 'NBA',
      line: 8.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-27T23:45:00.000Z',
      idempotencyKey: 'fallback-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-clv-2',
      submission_id: 'submission-clv-2',
      participant_id: participant.id,
      market: 'assists-all-game-ou',
      selection: 'Under 8.5',
      line: 8.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 88,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-03-27T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-03-27T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {},
      created_at: '2026-03-27T20:00:00.000Z',
      updated_at: '2026-03-27T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result);
  assert.equal(result.closingSnapshotAt, '2026-03-27T23:45:00.000Z');
});

test('computeAndAttachCLV logs market mismatches and returns null', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const warnings: string[] = [];
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_3',
    displayName: 'Player Three',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-3',
    sportId: 'NBA',
    eventName: 'Mismatch Event',
    eventDate: '2026-03-28',
    status: 'scheduled',
    metadata: {
      starts_at: '2026-03-28T23:00:00.000Z',
    },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-3',
      providerMarketKey: 'rebounds-all-game-ou',
      providerParticipantId: 'PLAYER_3',
      sportKey: 'NBA',
      line: 9.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-28T22:50:00.000Z',
      idempotencyKey: 'mismatch-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-clv-3',
      submission_id: 'submission-clv-3',
      participant_id: participant.id,
      market: 'assists-all-game-ou',
      selection: 'Over 8.5',
      line: 8.5,
      odds: -105,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 88,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-03-28T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-03-28T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {},
      created_at: '2026-03-28T20:00:00.000Z',
      updated_at: '2026-03-28T20:05:00.000Z',
    },
    repositories,
    {
      logger: {
        warn(message: string) {
          warnings.push(message);
        },
      },
    },
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /market mismatch/i);
});

test('computeAndAttachCLV resolves participant from metadata.player when participant_id is null', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_META',
    displayName: 'Meta Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-meta',
    sportId: 'NBA',
    eventName: 'Meta Player vs. Defense',
    eventDate: '2026-03-29',
    status: 'scheduled',
    metadata: { starts_at: '2026-03-29T23:30:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-meta',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_META',
      sportKey: 'NBA',
      line: 20.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-03-29T23:00:00.000Z',
      idempotencyKey: 'meta-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-meta-1',
      submission_id: 'submission-meta-1',
      participant_id: null,           // ← intentionally null
      market: 'points-all-game-ou',
      selection: 'Over 20.5',
      line: 20.5,
      odds: -105,
      stake_units: 1,
      confidence: 0.65,
      source: 'smart-form',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 85,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-03-29T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-03-29T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {
        player: 'Meta Player',   // ← resolved from here
        sport: 'NBA',
        eventName: 'Meta Player vs. Defense',
      },
      created_at: '2026-03-29T20:00:00.000Z',
      updated_at: '2026-03-29T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'CLV should be computed via metadata fallback when participant_id is null');
  assert.equal(result.providerKey, 'sgo');
});

test('computeAndAttachCLV returns null when metadata.player has no matching participant', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const result = await computeAndAttachCLV(
    {
      id: 'pick-no-participant',
      submission_id: 'sub-no-participant',
      participant_id: null,
      market: 'points-all-game-ou',
      selection: 'Over 25.5',
      line: 25.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.6,
      source: 'smart-form',
      approval_status: 'approved',
      promotion_status: 'not-evaluated',
      promotion_target: null,
      promotion_score: null,
      promotion_reason: null,
      promotion_version: null,
      promotion_decided_at: null,
      promotion_decided_by: null,
      status: 'posted',
      posted_at: '2026-03-29T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { player: 'Unknown Player' },
      created_at: '2026-03-29T20:00:00.000Z',
      updated_at: '2026-03-29T20:05:00.000Z',
    },
    repositories,
  );

  assert.equal(result, null, 'CLV should be null when no participant matches');
});
