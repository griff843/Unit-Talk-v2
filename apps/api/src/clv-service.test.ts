import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { computeAndAttachCLV, computeCLVOutcome } from './clv-service.js';

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

test('computeCLVOutcome uses marketUniverseId provenance before event resolution', async () => {
  const repositories = createInMemoryRepositoryBundle();

  await repositories.marketUniverse.upsertMarketUniverse([
    {
      provider_key: 'sgo',
      provider_event_id: 'mlb-event-754',
      provider_participant_id: 'MLB_PLAYER_754',
      provider_market_key: 'batting-hits-all-game-ou',
      sport_key: 'MLB',
      league_key: 'MLB',
      event_id: null,
      participant_id: null,
      market_type_id: 'player_batting_hits_ou',
      canonical_market_key: 'player_batting_hits_ou',
      current_line: 1.5,
      current_over_odds: -110,
      current_under_odds: -110,
      opening_line: 1.5,
      opening_over_odds: -110,
      opening_under_odds: -110,
      closing_line: 1.5,
      closing_over_odds: -135,
      closing_under_odds: 115,
      fair_over_prob: null,
      fair_under_prob: null,
      is_stale: false,
      last_offer_snapshot_at: '2026-04-24T18:55:00.000Z',
    },
  ]);
  const [universe] = await repositories.marketUniverse.listForScan(1);
  assert.ok(universe);

  const outcome = await computeCLVOutcome(
    {
      id: 'pick-provenance-754',
      submission_id: 'sub-provenance-754',
      participant_id: null,
      player_id: null,
      capper_id: null,
      market_type_id: 'player_batting_hits_ou',
      sport_id: 'MLB',
      market: 'player_batting_hits_ou',
      selection: 'Over 1.5',
      line: 1.5,
      odds: -120,
      stake_units: 1,
      confidence: 0.7,
      source: 'board-construction',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 91,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-24T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-24T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { marketUniverseId: universe.id, scoredCandidateId: 'candidate-754' },
      created_at: '2026-04-24T20:00:00.000Z',
      updated_at: '2026-04-24T20:05:00.000Z',
    },
    repositories,
  );

  assert.equal(outcome.status, 'computed');
  assert.equal(outcome.resolvedMarketKey, 'batting-hits-all-game-ou');
  assert.equal(outcome.result?.closingOdds, -135);
  assert.equal(typeof outcome.result?.clvRaw, 'number');
});

test('computeCLVOutcome resolves provider market from market_type_id before legacy pick.market', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const resolvedAliases: string[] = [];
  repositories.providerOffers.resolveProviderMarketKey = async (canonicalKey, provider) => {
    resolvedAliases.push(`${provider}:${canonicalKey}`);
    return canonicalKey === 'game_total_ou' && provider === 'sgo'
      ? 'points-all-game-ou'
      : null;
  };

  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-mlb-total',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: null,
      sportKey: 'MLB',
      line: 8.5,
      overOdds: -102,
      underOdds: -118,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: true,
      snapshotAt: '2026-04-24T22:00:00.000Z',
      idempotencyKey: 'mlb-total-closing',
      bookmakerKey: null,
    },
  ]);

  const outcome = await computeCLVOutcome(
    {
      id: 'pick-mlb-total',
      submission_id: 'submission-mlb-total',
      participant_id: null,
      player_id: null,
      capper_id: null,
      market_type_id: 'game_total_ou',
      sport_id: 'MLB',
      market: 'totals',
      selection: 'Over 8.5',
      line: 8.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 91,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-24T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-24T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {},
      created_at: '2026-04-24T20:00:00.000Z',
      updated_at: '2026-04-24T20:05:00.000Z',
    },
    repositories,
    {
      preResolvedContext: {
        providerEventId: 'evt-mlb-total',
        eventStartTime: '2026-04-24T23:00:00.000Z',
        participantExternalId: null,
      },
    },
  );

  assert.equal(outcome.status, 'computed');
  assert.equal(outcome.resolvedMarketKey, 'points-all-game-ou');
  assert.deepEqual(resolvedAliases, ['sgo:game_total_ou']);
  assert.equal(outcome.result?.providerKey, 'sgo');
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
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
  // Two warnings: market-mismatch string (from resolveAvailableMarkets) +
  // structured CLV skip object (from computeAndAttachCLV).
  assert.equal(warnings.length, 2);
  const marketMismatchWarning = warnings.find((w) => typeof w === 'string' && /market mismatch/i.test(w));
  assert.ok(marketMismatchWarning, 'expected a market-mismatch warning string');
});

test('computeCLVOutcome returns missing_closing_line diagnostics with available markets', async () => {
  const repositories = createInMemoryRepositoryBundle();
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

  const outcome = await computeCLVOutcome(
    {
      id: 'pick-clv-3',
      submission_id: 'submission-clv-3',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
  );

  assert.equal(outcome.result, null);
  assert.equal(outcome.status, 'missing_closing_line');
  assert.equal(outcome.resolvedMarketKey, 'assists-all-game-ou');
  assert.deepEqual(outcome.availableMarkets, ['rebounds-all-game-ou']);
});

test('computeCLVOutcome reports opening_line_fallback when opening line is used', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_OL_1',
    displayName: 'Opening Line Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-opening-1',
    sportId: 'NBA',
    eventName: 'Bulls vs. Knicks',
    eventDate: '2026-02-01',
    status: 'completed',
    metadata: { starts_at: '2026-02-01T23:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-opening-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_OL_1',
      sportKey: 'NBA',
      line: 25.5,
      overOdds: -115,
      underOdds: -105,
      devigMode: 'PAIRED',
      isOpening: true,
      isClosing: false,
      snapshotAt: '2026-02-01T23:30:00.000Z',
      idempotencyKey: 'opening-line-offer-1',
      bookmakerKey: null,
    },
  ]);

  const outcome = await computeCLVOutcome(
    {
      id: 'pick-opening-1',
      submission_id: 'sub-opening-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'points-all-game-ou',
      selection: 'Opening Line Player Over 25.5',
      line: 25.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 75,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-02-01T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-02-01T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Bulls vs. Knicks' },
      created_at: '2026-02-01T20:00:00.000Z',
      updated_at: '2026-02-01T20:05:00.000Z',
    },
    repositories,
  );

  assert.equal(outcome.status, 'opening_line_fallback');
  assert.equal(outcome.result?.isOpeningLineFallback, true);
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
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
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

test('computeAndAttachCLV resolves canonical pick.market to provider market key via alias', async () => {
  // Simulates the production case where pick.market = 'player_turnovers_ou' (canonical)
  // but provider_offers stores 'turnovers-all-game-ou' (SGO format).
  // resolveProviderMarketKey is stubbed to return the SGO key.
  const repositories = createInMemoryRepositoryBundle();

  // Stub alias resolution on the InMemory repo (which returns null by default)
  const originalResolve = repositories.providerOffers.resolveProviderMarketKey.bind(repositories.providerOffers);
  repositories.providerOffers.resolveProviderMarketKey = async (canonicalKey: string, provider: string) => {
    if (canonicalKey === 'player_turnovers_ou' && provider === 'sgo') {
      return 'turnovers-all-game-ou';
    }
    return originalResolve(canonicalKey, provider);
  };

  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'GARLAND_1_NBA',
    displayName: 'Darius Garland',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-alias-1',
    sportId: 'NBA',
    eventName: 'Cavaliers vs. Raptors',
    eventDate: '2026-01-10',
    status: 'completed',
    metadata: { starts_at: '2026-01-10T23:30:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-alias-1',
      providerMarketKey: 'turnovers-all-game-ou', // SGO format
      providerParticipantId: 'GARLAND_1_NBA',
      sportKey: 'NBA',
      line: 2.5,
      overOdds: -120,
      underOdds: 100,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-01-10T23:00:00.000Z',
      idempotencyKey: 'turnovers-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-alias-1',
      submission_id: 'sub-alias-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'player_turnovers_ou', // canonical format — must be resolved via alias
      selection: 'Darius Garland Under',
      line: 2.5,
      odds: -112,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 80,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-01-10T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-01-10T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Cavaliers vs. Raptors' },
      created_at: '2026-01-10T20:00:00.000Z',
      updated_at: '2026-01-10T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'CLV result should be non-null when alias resolves the market key');
  assert.equal(result.providerKey, 'sgo');
  assert.equal(result.closingOdds, 100); // under side (pick is Under)
});

test('computeAndAttachCLV falls back to opening line when no closing line exists', async () => {
  // Validates UTV2-449: opening line is used as CLV proxy when Odds API is unavailable
  const repositories = createInMemoryRepositoryBundle();

  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_OL_1',
    displayName: 'Opening Line Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-opening-1',
    sportId: 'NBA',
    eventName: 'Bulls vs. Knicks',
    eventDate: '2026-02-01',
    status: 'completed',
    metadata: { starts_at: '2026-02-01T23:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  // Opening line ingested after game start — findClosingLine won't find it (after cutoff),
  // but findOpeningLine will (no before filter on opening line lookup).
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-opening-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_OL_1',
      sportKey: 'NBA',
      line: 25.5,
      overOdds: -115,
      underOdds: -105,
      devigMode: 'PAIRED',
      isOpening: true,
      isClosing: false,
      snapshotAt: '2026-02-01T23:30:00.000Z', // after game start at 23:00 — findClosingLine misses it
      idempotencyKey: 'opening-line-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-opening-1',
      submission_id: 'sub-opening-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'points-all-game-ou',
      selection: 'Opening Line Player Over 25.5',
      line: 25.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 75,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-02-01T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-02-01T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Bulls vs. Knicks' },
      created_at: '2026-02-01T20:00:00.000Z',
      updated_at: '2026-02-01T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result !== null, 'CLV should not be null when opening line is available as fallback');
  assert.equal(result.isOpeningLineFallback, true, 'isOpeningLineFallback should be true');
  assert.equal(result.providerKey, 'sgo');
  assert.equal(result.closingOdds, -115); // over side
});

test('computeAndAttachCLV does not set isOpeningLineFallback when closing line is found', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_CL_1',
    displayName: 'Closing Line Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-closing-1',
    sportId: 'NBA',
    eventName: 'Heat vs. Celtics',
    eventDate: '2026-02-02',
    status: 'completed',
    metadata: { starts_at: '2026-02-02T23:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-closing-1',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_CL_1',
      sportKey: 'NBA',
      line: 22.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-02-02T22:30:00.000Z',
      idempotencyKey: 'closing-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-closing-1',
      submission_id: 'sub-closing-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'points-all-game-ou',
      selection: 'Closing Line Player Over 22.5',
      line: 22.5,
      odds: -108,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 78,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-02-02T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-02-02T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Heat vs. Celtics' },
      created_at: '2026-02-02T20:00:00.000Z',
      updated_at: '2026-02-02T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result !== null, 'CLV should not be null when a snapshot is available');
  assert.equal(result.isOpeningLineFallback, undefined, 'isOpeningLineFallback should not be set when closing line found');
});

test('computeCLVOutcome computes CLV for smart-form abbreviated O/U selections', async () => {
  const cases = [
    { selection: 'O 20.5', expectedClosingOdds: -108, expectedSide: 'over' },
    { selection: 'U 20.5', expectedClosingOdds: -112, expectedSide: 'under' },
  ] as const;

  for (const { selection, expectedClosingOdds, expectedSide } of cases) {
    const repositories = createInMemoryRepositoryBundle();
    await repositories.providerOffers.upsertBatch([
      {
        providerKey: 'sgo',
        providerEventId: `evt-short-${expectedSide}`,
        providerMarketKey: 'points-all-game-ou',
        providerParticipantId: 'PLAYER_SHORT_OU',
        sportKey: 'NBA',
        line: 20.5,
        overOdds: -108,
        underOdds: -112,
        devigMode: 'PAIRED',
        isOpening: false,
        isClosing: false,
        snapshotAt: '2026-04-01T22:30:00.000Z',
        idempotencyKey: `short-ou-offer-${expectedSide}`,
        bookmakerKey: null,
      },
    ]);

    const outcome = await computeCLVOutcome(
      {
        id: `pick-short-${expectedSide}`,
        submission_id: `sub-short-${expectedSide}`,
        participant_id: null,
        player_id: null,
        capper_id: null,
        market_type_id: null,
        sport_id: null,
        market: 'points-all-game-ou',
        selection,
        line: 20.5,
        odds: -105,
        stake_units: 1,
        confidence: 0.7,
        source: 'smart-form',
        approval_status: 'approved',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        promotion_score: 82,
        promotion_reason: 'test',
        promotion_version: 'v1',
        promotion_decided_at: '2026-04-01T20:00:00.000Z',
        promotion_decided_by: 'api',
        status: 'posted',
        posted_at: '2026-04-01T20:05:00.000Z',
        settled_at: null,
        idempotency_key: null,
        metadata: {},
        created_at: '2026-04-01T20:00:00.000Z',
        updated_at: '2026-04-01T20:05:00.000Z',
      },
      repositories,
      {
        preResolvedContext: {
          providerEventId: `evt-short-${expectedSide}`,
          eventStartTime: '2026-04-01T23:00:00.000Z',
          participantExternalId: 'PLAYER_SHORT_OU',
        },
      },
    );

    assert.equal(outcome.status, 'computed');
    assert.notEqual(outcome.status, 'missing_selection_side');
    assert.ok(outcome.result, `${selection} should produce a CLV result`);
    assert.equal(outcome.result.closingOdds, expectedClosingOdds);
    assert.equal(typeof outcome.result.clvRaw, 'number');
  }
});

// ── UTV2-715: moneyline CLV ────────────────────────────────────────────────

test('computeAndAttachCLV computes CLV for home-team moneyline pick using over_odds column', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const team = await repositories.participants.upsertByExternalId({
    externalId: 'TEAM_LAL',
    displayName: 'Lakers',
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-ml-1',
    sportId: 'NBA',
    eventName: 'Lakers vs. Heat',
    eventDate: '2026-04-21',
    status: 'scheduled',
    metadata: { starts_at: '2026-04-21T23:30:00.000Z' },
  });
  // Lakers are home team — role: 'home'
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: team.id,
    role: 'home',
  });
  // Moneyline offer: over_odds = home (Lakers), under_odds = away (Heat)
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-ml-1',
      providerMarketKey: 'moneyline',
      providerParticipantId: null,
      sportKey: 'NBA',
      line: null,
      overOdds: -150,
      underOdds: 130,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-21T23:20:00.000Z',
      idempotencyKey: 'ml-offer-home',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-ml-home',
      submission_id: 'sub-ml-home',
      participant_id: team.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'moneyline',
      selection: 'Lakers',
      line: null,
      odds: -130,
      stake_units: 1,
      confidence: 0.6,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 80,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-21T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-21T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Lakers vs. Heat' },
      created_at: '2026-04-21T20:00:00.000Z',
      updated_at: '2026-04-21T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'moneyline pick should produce a CLV result');
  // pick at -130 vs closing -150: closing overFair ~58% > pickImplied ~56.5% → negative CLV
  assert.equal(result.closingOdds, -150);
  assert.equal(result.beatsClosingLine, false);
  assert.ok(result.clvRaw < 0);
});

test('computeAndAttachCLV computes CLV for away-team moneyline pick using under_odds column', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const team = await repositories.participants.upsertByExternalId({
    externalId: 'TEAM_MIA',
    displayName: 'Heat',
    participantType: 'team',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-ml-2',
    sportId: 'NBA',
    eventName: 'Lakers vs. Heat',
    eventDate: '2026-04-21',
    status: 'scheduled',
    metadata: { starts_at: '2026-04-21T23:30:00.000Z' },
  });
  // Heat are away team — role: 'away'
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: team.id,
    role: 'away',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-ml-2',
      providerMarketKey: 'moneyline',
      providerParticipantId: null,
      sportKey: 'NBA',
      line: null,
      overOdds: -150,
      underOdds: 130,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-21T23:20:00.000Z',
      idempotencyKey: 'ml-offer-away',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-ml-away',
      submission_id: 'sub-ml-away',
      participant_id: team.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'moneyline',
      selection: 'Heat',
      line: null,
      odds: 115,
      stake_units: 1,
      confidence: 0.55,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 78,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-21T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-21T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Lakers vs. Heat' },
      created_at: '2026-04-21T20:00:00.000Z',
      updated_at: '2026-04-21T20:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'away moneyline pick should produce a CLV result');
  // pick at +115 vs closing +130: pickImplied ~46.5% > underFair ~42% → positive CLV
  assert.equal(result.closingOdds, 130);
  assert.equal(result.beatsClosingLine, true);
  assert.ok(result.clvRaw > 0);
});

test('computeCLVOutcome returns missing_selection_side for moneyline pick without participant context', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No participant seeded — event context will fail to resolve → missing_selection_side
  const outcome = await computeCLVOutcome(
    {
      id: 'pick-ml-no-ctx',
      submission_id: 'sub-ml-no-ctx',
      participant_id: null,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'moneyline',
      selection: 'Lakers',
      line: null,
      odds: -130,
      stake_units: 1,
      confidence: 0.6,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 80,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-21T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-21T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: {},
      created_at: '2026-04-21T20:00:00.000Z',
      updated_at: '2026-04-21T20:05:00.000Z',
    },
    repositories,
  );

  assert.equal(outcome.result, null);
  // No participant → event context unresolvable → missing_event_context
  assert.equal(outcome.status, 'missing_event_context');
});

test('existing O/U CLV behavior is unchanged by moneyline path (regression)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_REG',
    displayName: 'Regression Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-reg',
    sportId: 'NBA',
    eventName: 'Regression Game',
    eventDate: '2026-04-22',
    status: 'scheduled',
    metadata: { starts_at: '2026-04-22T20:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-reg',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_REG',
      sportKey: 'NBA',
      line: 20.5,
      overOdds: -110,
      underOdds: -110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-22T19:50:00.000Z',
      idempotencyKey: 'reg-offer',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-reg-ou',
      submission_id: 'sub-reg-ou',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'points-all-game-ou',
      selection: 'Over 20.5',
      line: 20.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.6,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 80,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-22T18:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-22T18:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Regression Game' },
      created_at: '2026-04-22T18:00:00.000Z',
      updated_at: '2026-04-22T18:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'O/U pick should still compute CLV after moneyline path added');
  assert.equal(result.closingOdds, -110);
});

// ── UTV2-744: Multi-sport CLV fidelity ────────────────────────────────────

test('computeAndAttachCLV computes CLV for MLB player prop (hits-all-game-ou)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'MLB_PLAYER_1',
    displayName: 'MLB Player One',
    participantType: 'player',
    sport: 'MLB',
    league: 'MLB',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'mlb-evt-1',
    sportId: 'MLB',
    eventName: 'Cubs vs. Cardinals',
    eventDate: '2026-04-20',
    status: 'completed',
    metadata: { starts_at: '2026-04-20T17:10:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'mlb-evt-1',
      providerMarketKey: 'hits-all-game-ou',
      providerParticipantId: 'MLB_PLAYER_1',
      sportKey: 'MLB',
      line: 1.5,
      overOdds: -130,
      underOdds: 110,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-20T17:00:00.000Z',
      idempotencyKey: 'mlb-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-mlb-1',
      submission_id: 'sub-mlb-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'hits-all-game-ou',
      selection: 'Over 1.5',
      line: 1.5,
      odds: -120,
      stake_units: 1,
      confidence: 0.65,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 82,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-20T14:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-20T14:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Cubs vs. Cardinals' },
      created_at: '2026-04-20T14:00:00.000Z',
      updated_at: '2026-04-20T14:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'MLB player prop must produce a CLV result');
  assert.equal(result.providerKey, 'sgo');
  // pick at -120 vs closing -130: pick is better odds → positive CLV
  assert.equal(result.closingOdds, -130);
  assert.equal(result.beatsClosingLine, true);
  assert.ok(result.clvRaw > 0);
});

test('computeAndAttachCLV computes CLV for NHL player prop (shots-all-game-ou)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'NHL_PLAYER_1',
    displayName: 'NHL Player One',
    participantType: 'player',
    sport: 'NHL',
    league: 'NHL',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'nhl-evt-1',
    sportId: 'NHL',
    eventName: 'Oilers vs. Flames',
    eventDate: '2026-04-21',
    status: 'completed',
    metadata: { starts_at: '2026-04-21T19:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'nhl-evt-1',
      providerMarketKey: 'shots-all-game-ou',
      providerParticipantId: 'NHL_PLAYER_1',
      sportKey: 'NHL',
      line: 2.5,
      overOdds: -115,
      underOdds: -105,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-21T18:50:00.000Z',
      idempotencyKey: 'nhl-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-nhl-1',
      submission_id: 'sub-nhl-1',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'shots-all-game-ou',
      selection: 'Under 2.5',
      line: 2.5,
      odds: -110,
      stake_units: 1,
      confidence: 0.6,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 76,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-21T15:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-21T15:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Oilers vs. Flames' },
      created_at: '2026-04-21T15:00:00.000Z',
      updated_at: '2026-04-21T15:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'NHL player prop must produce a CLV result');
  assert.equal(result.providerKey, 'sgo');
  // Under pick at -110 (implied ~52.4%) vs closing fair under (~48.9% after devig from -115/-105)
  // pickImplied > closingFair → clvRaw > 0 → beatsClosingLine = true
  assert.equal(result.closingOdds, -105);
  assert.equal(result.beatsClosingLine, true);
  assert.ok(result.clvRaw > 0);
});

test('computeAndAttachCLV: pre-commence closing offer is used when available before game starts', async () => {
  // Validates that findClosingLine correctly selects an offer whose snapshot_at
  // is BEFORE the game start time — the canonical "closing line" in SGO.
  const repositories = createInMemoryRepositoryBundle();
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'PLAYER_PRECOMMENCE',
    displayName: 'Pre-Commence Player',
    participantType: 'player',
    sport: 'MLB',
    league: 'MLB',
    metadata: {},
  });
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-precommence',
    sportId: 'MLB',
    eventName: 'Red Sox vs. Yankees',
    eventDate: '2026-04-22',
    status: 'completed',
    metadata: { starts_at: '2026-04-22T19:05:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  // Snapshot at 18:55 — 10 min before game start (pre-commence, within cutoff window)
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-precommence',
      providerMarketKey: 'strikeouts-all-game-ou',
      providerParticipantId: 'PLAYER_PRECOMMENCE',
      sportKey: 'MLB',
      line: 5.5,
      overOdds: -140,
      underOdds: 120,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-22T18:55:00.000Z',
      idempotencyKey: 'precommence-offer-1',
      bookmakerKey: null,
    },
    // Post-game snapshot — should NOT be selected (after cutoff)
    {
      providerKey: 'sgo',
      providerEventId: 'evt-precommence',
      providerMarketKey: 'strikeouts-all-game-ou',
      providerParticipantId: 'PLAYER_PRECOMMENCE',
      sportKey: 'MLB',
      line: 5.5,
      overOdds: -160,
      underOdds: 140,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: false,
      snapshotAt: '2026-04-22T22:30:00.000Z',
      idempotencyKey: 'postgame-offer-1',
      bookmakerKey: null,
    },
  ]);

  const result = await computeAndAttachCLV(
    {
      id: 'pick-precommence',
      submission_id: 'sub-precommence',
      participant_id: participant.id,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'strikeouts-all-game-ou',
      selection: 'Over 5.5',
      line: 5.5,
      odds: -130,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 84,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-22T16:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-22T16:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { eventName: 'Red Sox vs. Yankees' },
      created_at: '2026-04-22T16:00:00.000Z',
      updated_at: '2026-04-22T16:05:00.000Z',
    },
    repositories,
  );

  assert.ok(result, 'pre-commence closing line must produce a CLV result');
  // findClosingLine uses before: game_starts_at — must select the 18:55 snapshot, not the 22:30 one
  assert.equal(result.closingSnapshotAt, '2026-04-22T18:55:00.000Z');
  assert.equal(result.closingOdds, -140); // over side from 18:55 snapshot
});

test('computeCLVOutcome returns null when marketUniverseId references unknown row', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // marketUniverse repo is empty — findByIds will return []

  const outcome = await computeCLVOutcome(
    {
      id: 'pick-unknown-universe',
      submission_id: 'sub-unknown-universe',
      participant_id: null,
      player_id: null,
      capper_id: null,
      market_type_id: null,
      sport_id: null,
      market: 'player_batting_hits_ou',
      selection: 'Over 1.5',
      line: 1.5,
      odds: -120,
      stake_units: 1,
      confidence: 0.7,
      source: 'api',
      approval_status: 'approved',
      promotion_status: 'qualified',
      promotion_target: 'best-bets',
      promotion_score: 84,
      promotion_reason: 'test',
      promotion_version: 'v1',
      promotion_decided_at: '2026-04-24T20:00:00.000Z',
      promotion_decided_by: 'api',
      status: 'posted',
      posted_at: '2026-04-24T20:05:00.000Z',
      settled_at: null,
      idempotency_key: null,
      metadata: { marketUniverseId: 'nonexistent-universe-id' },
      created_at: '2026-04-24T20:00:00.000Z',
      updated_at: '2026-04-24T20:05:00.000Z',
    },
    repositories,
  );

  assert.equal(outcome.result, null);
});
