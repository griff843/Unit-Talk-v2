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
