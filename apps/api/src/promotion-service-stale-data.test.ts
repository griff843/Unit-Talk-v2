import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalPick } from '@unit-talk/contracts';
import {
  createInMemoryRepositoryBundle,
  InMemoryMarketUniverseRepository,
  type MarketUniverseRow,
} from '@unit-talk/db';
import { evaluateAllPoliciesEagerAndPersist } from './promotion-service.js';

function seedUniverseRows(repo: InMemoryMarketUniverseRepository, rows: MarketUniverseRow[]): void {
  const internal = repo as unknown as { rows: Map<string, MarketUniverseRow> };
  for (const row of rows) {
    internal.rows.set([
      row.provider_key,
      row.provider_event_id,
      row.provider_participant_id ?? '',
      row.provider_market_key,
    ].join(':'), row);
  }
}

function makeUniverseRow(overrides: Partial<MarketUniverseRow> = {}): MarketUniverseRow {
  return {
    id: 'universe-promotion-stale',
    sport_key: 'nba',
    league_key: 'nba',
    event_id: null,
    participant_id: 'participant-1',
    market_type_id: 'player_points_ou',
    canonical_market_key: 'player_points_ou',
    provider_key: 'sgo',
    provider_event_id: 'event-promotion',
    provider_participant_id: 'player-1',
    provider_market_key: 'points-all-game-ou',
    current_line: 24.5,
    current_over_odds: -110,
    current_under_odds: -110,
    opening_line: 24.5,
    opening_over_odds: -110,
    opening_under_odds: -110,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: 0.5,
    fair_under_prob: 0.5,
    is_stale: true,
    last_offer_snapshot_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    refreshed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// AC-7: Promotion blocked with STALE_DATA_AT_PROMOTION when universe is stale
test('AC-7: promotion blocked with STALE_DATA_AT_PROMOTION when universe is stale', async () => {
  const repos = createInMemoryRepositoryBundle();
  const universe = makeUniverseRow();
  seedUniverseRows(repos.marketUniverse as InMemoryMarketUniverseRepository, [universe]);
  const pick: CanonicalPick = {
    id: 'pick-promotion-stale',
    submissionId: 'sub-promotion-stale',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.7,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      marketUniverseId: universe.id,
      data_freshness: 'fresh',
      eventStartTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
    repos.settlements,
    repos.marketUniverse,
  );

  assert.equal(result.resolvedTarget, null, 'AC-7: resolvedTarget must be null');
  assert.equal(result.pickRecord.promotion_status, 'suppressed', 'AC-7: promotion_status must be suppressed');
  assert.equal(result.pickRecord.promotion_reason, 'STALE_DATA_AT_PROMOTION', 'AC-7: promotion_reason must be STALE_DATA_AT_PROMOTION');
});

// UTV2-1200: Injury/player status guard — pick with playerAvailabilityStatus='OUT' must not be promoted
test('UTV2-1200: pick with playerAvailabilityStatus=OUT is suppressed (riskBlocked)', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1200-out',
    submissionId: 'sub-utv2-1200-out',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      playerAvailabilityStatus: 'OUT',
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  assert.equal(result.resolvedTarget, null, 'UTV2-1200: resolvedTarget must be null when player is OUT');
  assert.equal(result.bestBetsDecision.qualified, false, 'UTV2-1200: bestBetsDecision must not qualify');
  // riskBlocked causes not_eligible status (domain returns not_eligible for risk-gated picks)
  assert.equal(result.pickRecord.promotion_target, null, 'UTV2-1200: promotion_target must be null when player is OUT');
});

test('UTV2-1200: pick with playerAvailabilityStatus=OUT_INDEFINITELY is not promoted', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1200-out-indef',
    submissionId: 'sub-utv2-1200-out-indef',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      playerAvailabilityStatus: 'OUT_INDEFINITELY',
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  assert.equal(result.resolvedTarget, null, 'UTV2-1200: resolvedTarget must be null when player is OUT_INDEFINITELY');
  assert.equal(result.pickRecord.promotion_target, null, 'UTV2-1200: promotion_target must be null when player is OUT_INDEFINITELY');
});

test('UTV2-1200: pick with playerAvailabilityStatus=INJURED_OUT is not promoted', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1200-injured-out',
    submissionId: 'sub-utv2-1200-injured-out',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      playerAvailabilityStatus: 'INJURED_OUT',
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  assert.equal(result.resolvedTarget, null, 'UTV2-1200: resolvedTarget must be null when player is INJURED_OUT');
  assert.equal(result.pickRecord.promotion_target, null, 'UTV2-1200: promotion_target must be null when player is INJURED_OUT');
});

test('UTV2-1200: pick with playerAvailabilityStatus=ACTIVE is NOT suppressed by injury guard', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1200-active',
    submissionId: 'sub-utv2-1200-active',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      playerAvailabilityStatus: 'ACTIVE',
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  // ACTIVE status should not trigger injury guard — pick may qualify
  assert.notEqual(result.pickRecord.promotion_reason, 'PLAYER_AVAILABILITY_BLOCKED', 'UTV2-1200: ACTIVE player must not be blocked by injury guard');
});

// UTV2-1201: postingWindowClosed event-time gate tests
test('UTV2-1201: pick with event time in the PAST is suppressed (withinPostingWindow=false)', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1201-past-event',
    submissionId: 'sub-utv2-1201-past-event',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    // Event started 1 hour ago — posting window should be closed
    eventStartTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    metadata: {
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  assert.equal(result.resolvedTarget, null, 'UTV2-1201: resolvedTarget must be null when event has started');
  assert.equal(result.bestBetsDecision.qualified, false, 'UTV2-1201: bestBetsDecision must not qualify when event has started');
  assert.equal(result.pickRecord.promotion_target, null, 'UTV2-1201: promotion_target must be null when event has started');
});

test('UTV2-1201: pick with event time in the FUTURE is eligible to promote (withinPostingWindow=true)', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1201-future-event',
    submissionId: 'sub-utv2-1201-future-event',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    // Event starts in 3 hours — posting window should be open
    eventStartTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    metadata: {
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  // withinPostingWindow=true — not suppressed by posting window gate
  // (pick may still not qualify due to other gates, but posting window is not the blocker)
  const suppressedByPostingWindow =
    result.bestBetsDecision.explanation.suppressionReasons.includes('POSTING_WINDOW_CLOSED') ||
    result.bestBetsDecision.explanation.suppressionReasons.includes('withinPostingWindow');
  assert.equal(suppressedByPostingWindow, false, 'UTV2-1201: pick with future event must not be suppressed by posting window gate');
});

test('UTV2-1201: pick with no event time is not suppressed by posting window gate (fail-open)', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1201-no-event-time',
    submissionId: 'sub-utv2-1201-no-event-time',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    // No eventStartTime — fail-open: assume window is still open
    metadata: {
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  // No event time — isEventStarted returns false (fail-open), posting window gate does not suppress
  const suppressedByPostingWindow =
    result.bestBetsDecision.explanation.suppressionReasons.includes('POSTING_WINDOW_CLOSED') ||
    result.bestBetsDecision.explanation.suppressionReasons.includes('withinPostingWindow');
  assert.equal(suppressedByPostingWindow, false, 'UTV2-1201: pick with no event time must not be suppressed by posting window gate (fail-open)');
});

// Also verify metadata.eventStartTime fallback path works (for existing data in metadata bag)
test('UTV2-1201: pick with past eventStartTime in metadata is suppressed (metadata fallback path)', async () => {
  const repos = createInMemoryRepositoryBundle();
  const pick: CanonicalPick = {
    id: 'pick-utv2-1201-metadata-past',
    submissionId: 'sub-utv2-1201-metadata-past',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.9,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    // No top-level eventStartTime — eventStartTime carried only in metadata bag
    metadata: {
      eventStartTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  const result = await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
  );

  assert.equal(result.resolvedTarget, null, 'UTV2-1201: resolvedTarget must be null when metadata.eventStartTime is in the past');
  assert.equal(result.pickRecord.promotion_target, null, 'UTV2-1201: promotion_target must be null when metadata.eventStartTime is in the past');
});

// AC-8: Promotion block written to audit_log
test('AC-8: promotion block written to audit_log with promotion_blocked_stale_data event', async () => {
  const repos = createInMemoryRepositoryBundle();
  const universe = makeUniverseRow({ id: 'universe-ac8-stale', is_stale: true });
  seedUniverseRows(repos.marketUniverse as InMemoryMarketUniverseRepository, [universe]);
  const pick: CanonicalPick = {
    id: 'pick-ac8-stale',
    submissionId: 'sub-ac8-stale',
    market: 'player_points_ou',
    selection: 'over',
    line: 24.5,
    odds: -110,
    confidence: 0.7,
    source: 'system-pick-scanner',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'awaiting_approval',
    metadata: {
      marketUniverseId: universe.id,
      data_freshness: 'fresh',
      promotionScores: { edge: 95, trust: 95, readiness: 95, uniqueness: 95, boardFit: 95 },
    },
    createdAt: new Date().toISOString(),
  };
  await repos.picks.savePick(pick);

  await evaluateAllPoliciesEagerAndPersist(
    pick.id,
    'test',
    repos.picks,
    repos.audit,
    repos.settlements,
    repos.marketUniverse,
  );

  const audits = await repos.audit.listRecentByEntityType(
    'pick_promotion_history',
    new Date(Date.now() - 60_000).toISOString(),
    'promotion_blocked_stale_data',
  );
  assert.equal(audits.length, 1, 'AC-8: exactly one audit log entry');
  assert.equal((audits[0]!.payload as Record<string, unknown>)['code'], 'STALE_DATA_AT_PROMOTION', 'AC-8: payload.code must be STALE_DATA_AT_PROMOTION');
});
