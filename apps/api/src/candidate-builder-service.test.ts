/**
 * candidate-builder-service.test.ts
 *
 * Unit tests for CandidateBuilderService using in-memory repositories.
 *
 * Test runner: node:test + tsx --test
 * Assertions: node:assert/strict
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CandidateBuilderService,
  evaluateBuilderQualityGates,
  CANDIDATE_STALE_THRESHOLD_MS,
  EXTREME_JUICE_THRESHOLD,
} from './candidate-builder-service.js';
import {
  InMemoryMarketUniverseRepository,
  InMemoryPickCandidateRepository,
  InMemoryProviderOfferRepository,
  InMemoryAuditLogRepository,
} from '@unit-talk/db';
import type { MarketUniverseUpsertInput, ProviderOfferUpsertInput } from '@unit-talk/db';

function makeProviderOffer(overrides: Partial<ProviderOfferUpsertInput> = {}): ProviderOfferUpsertInput {
  const now = new Date().toISOString();
  return {
    idempotencyKey: 'offer-evt-1-points-all-game-ou-player-1-bk-1',
    providerKey: 'sgo',
    providerEventId: 'event-1',
    providerMarketKey: 'points-all-game-ou',
    providerParticipantId: 'player-1',
    bookmakerKey: 'book-1',
    isOpening: true,
    isClosing: false,
    overOdds: -110,
    underOdds: -120,
    line: 25.5,
    snapshotAt: now,
    devigMode: 'PAIRED',
    sportKey: 'mlb',
    ...overrides,
  };
}

function makeUniverseRow(overrides: Partial<MarketUniverseUpsertInput> = {}): MarketUniverseUpsertInput {
  return {
    provider_key: 'sgo',
    provider_event_id: 'event-1',
    provider_participant_id: 'player-1',
    provider_market_key: 'points-all-game-ou',
    sport_key: 'mlb',
    league_key: 'mlb',
    event_id: null,
    participant_id: 'participant-1',
    market_type_id: 'player_points_ou',
    canonical_market_key: 'player_points_ou',
    current_line: 25.5,
    current_over_odds: -110,
    current_under_odds: -120,
    opening_line: 25.5,
    opening_over_odds: -110,
    opening_under_odds: -120,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: 0.5,
    fair_under_prob: 0.5,
    is_stale: false,
    last_offer_snapshot_at: new Date().toISOString(),
    ...overrides,
  };
}

async function getQualifiedCandidateIds(
  repo: InMemoryPickCandidateRepository,
): Promise<string[]> {
  const candidates = await repo.findByStatus('qualified');
  return candidates.map((candidate) => candidate.id);
}

test('happy path: build() creates qualified pick_candidates from opening offers', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  await providerOffers.upsertBatch([
    makeProviderOffer(),
  ]);

  await marketUniverse.upsertMarketUniverse([makeUniverseRow()]);

  const fixedNow = new Date('2026-01-01T00:00:00.000Z');
  const service = new CandidateBuilderService(
    { providerOffers, marketUniverse, pickCandidates },
    { now: () => fixedNow.getTime(), lookbackHours: 24, universeScanLimit: 100 },
  );

  const result = await service.build();

  assert.equal(result.scanned, 1);
  assert.equal(result.createdOrUpdated, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  const candidates = await pickCandidates.findByStatus('qualified');
  assert.equal(candidates.length, 1);
  for (const candidate of candidates) {
    assert.equal(candidate.status, 'qualified');
    assert.equal(candidate.rejection_reason, null);
    assert.deepEqual(candidate.filter_details, {
      missing_canonical_identity: false,
      stale_price_data: false,
      unsupported_market_family: false,
      missing_participant_linkage: false,
      invalid_odds_structure: false,
      duplicate_suppressed: false,
      freshness_window_failed: false,
    });
  }
});

test('duplicate prevention: calling build() twice does not create duplicate candidate rows', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  await providerOffers.upsertBatch([makeProviderOffer()]);
  await marketUniverse.upsertMarketUniverse([makeUniverseRow()]);

  const fixedNow = new Date('2026-01-01T00:00:00.000Z');
  const service = new CandidateBuilderService(
    { providerOffers, marketUniverse, pickCandidates },
    { now: () => fixedNow.getTime(), lookbackHours: 24 },
  );

  const first = await service.build();
  const afterFirst = await getQualifiedCandidateIds(pickCandidates);
  assert.equal(first.createdOrUpdated, 1);
  assert.equal(afterFirst.length, 1);

  const second = await service.build();
  const afterSecond = await getQualifiedCandidateIds(pickCandidates);
  assert.equal(second.createdOrUpdated, 1);
  assert.equal(afterSecond.length, 1);

  const afterFirstIds = [...afterFirst];
  assert.equal(afterSecond.length, 1);
  assert.equal(afterSecond[0], afterFirstIds[0]);
  assert.equal(second.errors, 0);
});

// ---------------------------------------------------------------------------
// UTV2-1364: evaluateBuilderQualityGates — pure function unit tests
// ---------------------------------------------------------------------------

test('evaluateBuilderQualityGates: passes a normal offer', () => {
  const nowMs = Date.now();
  const result = evaluateBuilderQualityGates(
    { overOdds: -110, underOdds: -120, snapshotAt: new Date(nowMs - 1000).toISOString() },
    nowMs,
  );
  assert.equal(result.rejected, false);
  assert.equal(result.reason, undefined);
});

test('evaluateBuilderQualityGates: Gate 1 — rejects extreme negative over odds', () => {
  const nowMs = Date.now();
  const result = evaluateBuilderQualityGates(
    { overOdds: -(EXTREME_JUICE_THRESHOLD + 1), underOdds: -110, snapshotAt: new Date().toISOString() },
    nowMs,
  );
  assert.equal(result.rejected, true);
  assert.equal(result.reason, 'extreme_juice');
});

test('evaluateBuilderQualityGates: Gate 1 — rejects extreme positive under odds', () => {
  const nowMs = Date.now();
  const result = evaluateBuilderQualityGates(
    { overOdds: -110, underOdds: EXTREME_JUICE_THRESHOLD + 1, snapshotAt: new Date().toISOString() },
    nowMs,
  );
  assert.equal(result.rejected, true);
  assert.equal(result.reason, 'extreme_juice');
});

test('evaluateBuilderQualityGates: Gate 1 — accepts odds exactly at threshold', () => {
  const nowMs = Date.now();
  const result = evaluateBuilderQualityGates(
    { overOdds: -EXTREME_JUICE_THRESHOLD, underOdds: EXTREME_JUICE_THRESHOLD, snapshotAt: new Date().toISOString() },
    nowMs,
  );
  assert.equal(result.rejected, false);
});

test('evaluateBuilderQualityGates: Gate 3 — rejects stale snapshot older than 1 hour', () => {
  const nowMs = Date.now();
  const staleSnapshotAt = new Date(nowMs - CANDIDATE_STALE_THRESHOLD_MS - 1).toISOString();
  const result = evaluateBuilderQualityGates(
    { overOdds: -110, underOdds: -120, snapshotAt: staleSnapshotAt },
    nowMs,
  );
  assert.equal(result.rejected, true);
  assert.equal(result.reason, 'stale_odds_data');
});

test('evaluateBuilderQualityGates: Gate 3 — accepts fresh snapshot just under 1 hour', () => {
  const nowMs = Date.now();
  const freshSnapshotAt = new Date(nowMs - CANDIDATE_STALE_THRESHOLD_MS + 1000).toISOString();
  const result = evaluateBuilderQualityGates(
    { overOdds: -110, underOdds: -120, snapshotAt: freshSnapshotAt },
    nowMs,
  );
  assert.equal(result.rejected, false);
});

// ---------------------------------------------------------------------------
// UTV2-1364: CandidateBuilderService integration — gates block creation
// ---------------------------------------------------------------------------

test('Gate 1 integration: extreme juice offer is rejected and logged to audit', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const audit = new InMemoryAuditLogRepository();

  await providerOffers.upsertBatch([
    makeProviderOffer({ overOdds: -600, underOdds: -110 }), // extreme juice on over
  ]);
  await marketUniverse.upsertMarketUniverse([makeUniverseRow()]);

  const fixedNow = new Date('2026-01-01T12:00:00.000Z');
  const service = new CandidateBuilderService(
    { providerOffers, marketUniverse, pickCandidates, audit },
    { now: () => fixedNow.getTime(), lookbackHours: 24 },
  );

  const result = await service.build();
  assert.equal(result.gateRejected, 1);
  assert.equal(result.createdOrUpdated, 0);

  const qualified = await pickCandidates.findByStatus('qualified');
  assert.equal(qualified.length, 0, 'extreme juice offer must not create a candidate');

  const auditEntries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(auditEntries.length, 1);
  const entry = auditEntries[0]!;
  assert.equal(entry.action, 'candidate.rejected');
  assert.equal((entry.payload as Record<string, unknown>)['reason'], 'extreme_juice');
});

test('Gate 3 integration: stale snapshot offer is rejected and logged to audit', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const audit = new InMemoryAuditLogRepository();

  const fixedNow = new Date('2026-01-01T12:00:00.000Z');
  // Snapshot older than 1 hour
  const staleSnapshotAt = new Date(fixedNow.getTime() - CANDIDATE_STALE_THRESHOLD_MS - 5000).toISOString();

  await providerOffers.upsertBatch([
    makeProviderOffer({ snapshotAt: staleSnapshotAt }),
  ]);
  await marketUniverse.upsertMarketUniverse([makeUniverseRow()]);

  const service = new CandidateBuilderService(
    { providerOffers, marketUniverse, pickCandidates, audit },
    { now: () => fixedNow.getTime(), lookbackHours: 24 },
  );

  const result = await service.build();
  assert.equal(result.gateRejected, 1);
  assert.equal(result.createdOrUpdated, 0);

  const auditEntries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(auditEntries.length, 1);
  const entry = auditEntries[0]!;
  assert.equal((entry.payload as Record<string, unknown>)['reason'], 'stale_odds_data');
});

test('happy path: fresh normal offer passes gates and creates a candidate', async () => {
  const providerOffers = new InMemoryProviderOfferRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const audit = new InMemoryAuditLogRepository();

  const fixedNow = new Date('2026-01-01T12:00:00.000Z');
  const freshSnapshot = new Date(fixedNow.getTime() - 60_000).toISOString(); // 1 min ago

  await providerOffers.upsertBatch([
    makeProviderOffer({ overOdds: -110, underOdds: -120, snapshotAt: freshSnapshot }),
  ]);
  await marketUniverse.upsertMarketUniverse([makeUniverseRow()]);

  const service = new CandidateBuilderService(
    { providerOffers, marketUniverse, pickCandidates, audit },
    { now: () => fixedNow.getTime(), lookbackHours: 24 },
  );

  const result = await service.build();
  assert.equal(result.gateRejected, 0);
  assert.equal(result.createdOrUpdated, 1);

  const auditEntries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(auditEntries.length, 0, 'no rejections for a valid offer');
});
