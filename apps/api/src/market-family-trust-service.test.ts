/**
 * Unit tests for market-family-trust-service.ts — UTV2-480 P6-02
 *
 * Uses node:test + node:assert/strict. In-memory repositories only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMarketFamilyTuning } from './market-family-trust-service.js';
import type {
  IGovernedPickPerformanceRepository,
  GovernedPickPerformanceRow,
} from './market-family-trust-service.js';
import { InMemoryMarketFamilyTrustRepository } from '@unit-talk/db';
import type { AuditLogRepository, AuditLogCreateInput, AuditLogRow } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<GovernedPickPerformanceRow> = {}): GovernedPickPerformanceRow {
  return {
    pick_id: 'pick-' + Math.random().toString(36).slice(2),
    market: 'player_points',
    selection: 'over',
    odds: -110,
    pick_status: 'settled',
    settled_at: new Date().toISOString(),
    pick_created_at: new Date().toISOString(),
    metadata: {},
    board_run_id: 'run-1',
    board_rank: 1,
    board_tier: 'A',
    sport_key: 'nba',
    market_type_id: 'player-points-ou',
    board_model_score: 0.72,
    candidate_id: 'cand-1',
    universe_id: 'uni-1',
    candidate_model_score: 0.70,
    model_confidence: 0.8,
    model_tier: 'A',
    selection_rank: 1,
    provider_key: 'sgo',
    provider_market_key: 'points-all-game-ou',
    settlement_id: 'settle-' + Math.random().toString(36).slice(2),
    settlement_result: 'win',
    settlement_status: 'settled',
    settlement_settled_at: new Date().toISOString(),
    settled_by: 'system',
    settlement_confidence: 'high',
    ...overrides,
  };
}

class InMemoryGovernedPerformanceRepo implements IGovernedPickPerformanceRepository {
  constructor(private readonly rows: GovernedPickPerformanceRow[]) {}
  async listSettled(): Promise<GovernedPickPerformanceRow[]> {
    return this.rows.filter((r) => r.settlement_result !== null);
  }
}

class InMemoryAuditRepo implements AuditLogRepository {
  readonly recorded: AuditLogCreateInput[] = [];

  async record(input: AuditLogCreateInput): Promise<AuditLogRow> {
    this.recorded.push(input);
    return {
      id: 'audit-' + Math.random().toString(36).slice(2),
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_ref: input.entityRef ?? null,
      action: input.action,
      actor: input.actor ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: input.payload as any,
      created_at: new Date().toISOString(),
    };
  }

  async listRecentByEntityType(
    _entityType: string,
    _since: string,
    _action?: string,
  ): Promise<AuditLogRow[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('market-family: groups settled picks correctly by market_type_id', async () => {
  // 5 wins for 'player-points-ou', 3 wins + 2 losses for 'player-rebounds-ou'
  const rows: GovernedPickPerformanceRow[] = [
    ...Array.from({ length: 5 }, () => makeRow({ market_type_id: 'player-points-ou', settlement_result: 'win' })),
    ...Array.from({ length: 3 }, () => makeRow({ market_type_id: 'player-rebounds-ou', settlement_result: 'win' })),
    ...Array.from({ length: 2 }, () => makeRow({ market_type_id: 'player-rebounds-ou', settlement_result: 'loss' })),
  ];

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  const result = await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  assert.equal(result.marketFamilyCount, 2);
  assert.equal(result.totalSettled, 10);

  const stored = trustRepo.listAll();
  assert.equal(stored.length, 2);

  const pointsRow = stored.find((r) => r.market_type_id === 'player-points-ou');
  const reboundsRow = stored.find((r) => r.market_type_id === 'player-rebounds-ou');

  assert.ok(pointsRow, 'player-points-ou row should exist');
  assert.ok(reboundsRow, 'player-rebounds-ou row should exist');

  assert.equal(pointsRow!.win_count, 5);
  assert.equal(pointsRow!.loss_count, 0);
  assert.equal(reboundsRow!.win_count, 3);
  assert.equal(reboundsRow!.loss_count, 2);
});

test('market-family: win_rate and ROI are null when sample_size < 5', async () => {
  // Only 4 settled picks for a family — below MIN_SAMPLE
  const rows = Array.from({ length: 4 }, () =>
    makeRow({ market_type_id: 'rare-market', settlement_result: 'win' }),
  );

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  const stored = trustRepo.listAll();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.win_rate, null, 'win_rate should be null when < MIN_SAMPLE');
  assert.equal(stored[0]!.roi, null, 'roi should be null when < MIN_SAMPLE');
});

test('market-family: win_rate and ROI are computed when sample_size >= 5', async () => {
  // 3 wins + 2 losses = sample_size 5 (exactly at threshold)
  const rows = [
    ...Array.from({ length: 3 }, () => makeRow({ market_type_id: 'mkt', settlement_result: 'win', candidate_model_score: null, board_model_score: null })),
    ...Array.from({ length: 2 }, () => makeRow({ market_type_id: 'mkt', settlement_result: 'loss', candidate_model_score: null, board_model_score: null })),
  ];

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  const stored = trustRepo.listAll();
  assert.equal(stored.length, 1);
  const row = stored[0]!;

  // win_rate = 3/5 = 0.6
  assert.ok(row.win_rate !== null, 'win_rate should not be null at MIN_SAMPLE');
  assert.equal(Number(row.win_rate!.toFixed(4)), 0.6);

  // roi = (3 - 2) / 5 = 0.2
  assert.ok(row.roi !== null, 'roi should not be null at MIN_SAMPLE');
  assert.equal(Number(row.roi!.toFixed(4)), 0.2);
});

test('market-family: confidence_band is computed correctly', async () => {
  // Create three separate families with different sample sizes
  const rows9 = Array.from({ length: 9 }, () => makeRow({ market_type_id: 'fam-low', settlement_result: 'win' }));
  const rows15 = Array.from({ length: 15 }, () => makeRow({ market_type_id: 'fam-medium', settlement_result: 'win' }));
  const rows30 = Array.from({ length: 30 }, () => makeRow({ market_type_id: 'fam-high', settlement_result: 'win' }));

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo([...rows9, ...rows15, ...rows30]),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  const stored = trustRepo.listAll();
  const low = stored.find((r) => r.market_type_id === 'fam-low');
  const medium = stored.find((r) => r.market_type_id === 'fam-medium');
  const high = stored.find((r) => r.market_type_id === 'fam-high');

  assert.equal(low!.confidence_band, 'low', 'sample_size=9 → low');
  assert.equal(medium!.confidence_band, 'medium', 'sample_size=15 → medium');
  assert.equal(high!.confidence_band, 'high', 'sample_size=30 → high');
});

test('market-family: unsettled picks (settlement_result=null) are excluded', async () => {
  const rows: GovernedPickPerformanceRow[] = [
    makeRow({ market_type_id: 'mkt-a', settlement_result: 'win' }),
    makeRow({ market_type_id: 'mkt-a', settlement_result: null }), // unsettled — must be excluded
    makeRow({ market_type_id: 'mkt-a', settlement_result: null }),
    makeRow({ market_type_id: 'mkt-a', settlement_result: 'win' }),
    makeRow({ market_type_id: 'mkt-a', settlement_result: 'win' }),
    makeRow({ market_type_id: 'mkt-a', settlement_result: 'win' }),
    makeRow({ market_type_id: 'mkt-a', settlement_result: 'win' }),
  ];

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  const result = await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  // totalSettled = 5 (the 2 nulls are excluded by the repo filter)
  assert.equal(result.totalSettled, 5);

  const stored = trustRepo.listAll();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.sample_size, 5, 'sample_size must exclude null settlement_result rows');
  assert.equal(stored[0]!.win_count, 5);
});

test('market-family: audit record is written with correct action', async () => {
  const rows = Array.from({ length: 6 }, () =>
    makeRow({ market_type_id: 'audit-test', settlement_result: 'win' }),
  );

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  const result = await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
    actor: 'operator:test',
  });

  assert.equal(auditRepo.recorded.length, 1);
  const entry = auditRepo.recorded[0]!;
  assert.equal(entry.action, 'market_family_trust.tuning_run.completed');
  assert.equal(entry.entityType, 'market_family_trust');
  assert.equal(entry.entityId, result.tuningRunId);
  assert.equal(entry.actor, 'operator:test');
  assert.equal(
    (entry.payload as Record<string, unknown>).tuningRunId,
    result.tuningRunId,
  );
});

test('market-family: push picks are counted but excluded from win_rate', async () => {
  const rows = [
    ...Array.from({ length: 3 }, () => makeRow({ market_type_id: 'push-test', settlement_result: 'win', candidate_model_score: null, board_model_score: null })),
    ...Array.from({ length: 1 }, () => makeRow({ market_type_id: 'push-test', settlement_result: 'loss', candidate_model_score: null, board_model_score: null })),
    ...Array.from({ length: 2 }, () => makeRow({ market_type_id: 'push-test', settlement_result: 'push', candidate_model_score: null, board_model_score: null })),
  ];

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  const stored = trustRepo.listAll();
  const row = stored[0]!;

  assert.equal(row.sample_size, 6);
  assert.equal(row.win_count, 3);
  assert.equal(row.loss_count, 1);
  assert.equal(row.push_count, 2);

  // win_rate = 3/(3+1) = 0.75 (pushes excluded from denominator)
  assert.ok(row.win_rate !== null);
  assert.equal(Number(row.win_rate!.toFixed(4)), 0.75);

  // roi = (3 - 1) / 6 = 0.3333...
  assert.ok(row.roi !== null);
  assert.equal(Number(row.roi!.toFixed(4)), 0.3333);
});

test('market-family: market_type_id null falls back to unknown', async () => {
  const rows = Array.from({ length: 5 }, () =>
    makeRow({ market_type_id: null, settlement_result: 'win' }),
  );

  const trustRepo = new InMemoryMarketFamilyTrustRepository();
  const auditRepo = new InMemoryAuditRepo();

  await runMarketFamilyTuning({
    governedPerformance: new InMemoryGovernedPerformanceRepo(rows),
    marketFamilyTrust: trustRepo,
    audit: auditRepo,
  });

  const stored = trustRepo.listAll();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.market_type_id, 'unknown');
});
