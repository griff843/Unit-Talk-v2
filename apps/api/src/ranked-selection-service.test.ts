/**
 * ranked-selection-service.test.ts
 *
 * Unit tests for RankedCandidateSelectionService using in-memory repositories.
 * No live DB required.
 *
 * Test runner: node:test + tsx --test
 * Assertions: node:assert/strict
 *
 * Hard boundary invariants verified in every test:
 *   - pick_id is NEVER set on any row
 *   - shadow_mode is NEVER false
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRankedSelection } from './ranked-selection-service.js';
import {
  InMemoryMarketUniverseRepository,
  InMemoryPickCandidateRepository,
} from '@unit-talk/db';
import type { MarketUniverseRow, PickCandidateRow } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeUniverseRow(overrides: Partial<MarketUniverseRow> = {}): MarketUniverseRow {
  return {
    id: 'universe-1',
    sport_key: 'nba',
    league_key: 'nba',
    event_id: null,
    participant_id: 'participant-1',
    market_type_id: 'player_points_ou',
    canonical_market_key: 'player_points_ou',
    provider_key: 'sgo',
    provider_event_id: 'event-abc',
    provider_participant_id: 'player-1',
    provider_market_key: 'points-all-game-ou',
    current_line: 24.5,
    current_over_odds: -110,
    current_under_odds: -125,
    opening_line: 24.5,
    opening_over_odds: -110,
    opening_under_odds: -125,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: 0.56,
    fair_under_prob: 0.44,
    is_stale: false,
    last_offer_snapshot_at: new Date().toISOString(),
    refreshed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Seed full MarketUniverseRow objects into the InMemory repo's internal map. */
function seedUniverseRows(
  repo: InMemoryMarketUniverseRepository,
  rows: MarketUniverseRow[],
): void {
  const internal = repo as unknown as { rows: Map<string, MarketUniverseRow> };
  for (const row of rows) {
    const key = [
      row.provider_key,
      row.provider_event_id,
      row.provider_participant_id ?? '',
      row.provider_market_key,
    ].join(':');
    internal.rows.set(key, row);
  }
}

/** Seed full PickCandidateRow objects into the InMemory repo's internal map (keyed by universe_id). */
function seedCandidateRows(
  repo: InMemoryPickCandidateRepository,
  rows: PickCandidateRow[],
): void {
  const internal = repo as unknown as { rows: Map<string, PickCandidateRow> };
  for (const row of rows) {
    internal.rows.set(row.universe_id, row);
  }
}

function makeCandidate(overrides: Partial<PickCandidateRow> = {}): PickCandidateRow {
  return {
    id: 'candidate-1',
    universe_id: 'universe-1',
    status: 'qualified',
    rejection_reason: null,
    filter_details: {
      missing_canonical_identity: false,
      stale_price_data: false,
      unsupported_market_family: false,
      missing_participant_linkage: false,
      invalid_odds_structure: false,
      duplicate_suppressed: false,
      freshness_window_failed: false,
    },
    model_score: 0.75,
    model_tier: 'A',
    model_confidence: 0.8,
    selection_rank: null,
    is_board_candidate: false,
    shadow_mode: true,
    pick_id: null,
    scan_run_id: 'run-1',
    provenance: null,
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('TC1: empty pool returns { ranked: 0, skipped: 0, errors: 0 }', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const result = await runRankedSelection({ pickCandidates, marketUniverse });

  assert.equal(result.ranked, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.ok(result.durationMs >= 0);
});

test('TC2: single qualified+scored non-stale candidate gets selection_rank=1 and is_board_candidate=true', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({
    id: 'candidate-1',
    universe_id: 'universe-1',
    model_score: 0.75,
    model_tier: 'A',
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runRankedSelection({ pickCandidates, marketUniverse });

  assert.equal(result.ranked, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  const rows = pickCandidates.listAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.selection_rank, 1);
  assert.equal(rows[0]!.is_board_candidate, true);
});

test('TC3: multiple candidates ordered correctly — higher score gets rank 1', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
    makeUniverseRow({ id: 'universe-3', provider_market_key: 'market-3', is_stale: false }),
  ]);

  const now = new Date().toISOString();
  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'c1', universe_id: 'universe-1', model_score: 0.60, model_tier: 'B', created_at: now }),
    makeCandidate({ id: 'c2', universe_id: 'universe-2', model_score: 0.90, model_tier: 'A+', created_at: now }),
    makeCandidate({ id: 'c3', universe_id: 'universe-3', model_score: 0.75, model_tier: 'A', created_at: now }),
  ]);

  await runRankedSelection({ pickCandidates, marketUniverse });

  const rows = pickCandidates.listAll();
  const byId = new Map(rows.map(r => [r.id, r]));

  // Rank 1 = highest score (0.90), Rank 2 = 0.75, Rank 3 = 0.60
  assert.equal(byId.get('c2')!.selection_rank, 1);
  assert.equal(byId.get('c3')!.selection_rank, 2);
  assert.equal(byId.get('c1')!.selection_rank, 3);

  for (const row of rows) {
    assert.equal(row.is_board_candidate, true);
  }
});

test('TC4: SUPPRESS-tier ranked after A-tier when scores are equal', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
  ]);

  const now = '2026-04-09T10:00:00.000Z';
  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'suppress', universe_id: 'universe-1', model_score: 0.80, model_tier: 'SUPPRESS', created_at: now }),
    makeCandidate({ id: 'atier',    universe_id: 'universe-2', model_score: 0.80, model_tier: 'A',        created_at: now }),
  ]);

  await runRankedSelection({ pickCandidates, marketUniverse });

  const rows = pickCandidates.listAll();
  const byId = new Map(rows.map(r => [r.id, r]));

  // Scores equal — tier is secondary. A has higher priority than SUPPRESS.
  assert.equal(byId.get('atier')!.selection_rank, 1);
  assert.equal(byId.get('suppress')!.selection_rank, 2);
});

test('TC5: SUPPRESS with HIGHER score than A-tier ranks first (score is primary sort)', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
  ]);

  const now = '2026-04-09T10:00:00.000Z';
  seedCandidateRows(pickCandidates, [
    // SUPPRESS has higher model_score — score is primary, so SUPPRESS ranks first
    makeCandidate({ id: 'suppress', universe_id: 'universe-1', model_score: 0.95, model_tier: 'SUPPRESS', created_at: now }),
    makeCandidate({ id: 'atier',    universe_id: 'universe-2', model_score: 0.70, model_tier: 'A',        created_at: now }),
  ]);

  await runRankedSelection({ pickCandidates, marketUniverse });

  const rows = pickCandidates.listAll();
  const byId = new Map(rows.map(r => [r.id, r]));

  // Score is primary sort: SUPPRESS (0.95) > A-tier (0.70) → SUPPRESS gets rank 1
  assert.equal(byId.get('suppress')!.selection_rank, 1);
  assert.equal(byId.get('atier')!.selection_rank, 2);
});

test('TC6: stale market universe row — candidate skipped, counted in skipped', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: true }),   // stale
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),  // live
  ]);

  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'c-stale', universe_id: 'universe-1', model_score: 0.80, model_tier: 'A' }),
    makeCandidate({ id: 'c-live',  universe_id: 'universe-2', model_score: 0.75, model_tier: 'B' }),
  ]);

  const result = await runRankedSelection({ pickCandidates, marketUniverse });

  assert.equal(result.ranked, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);

  const rows = pickCandidates.listAll();
  const byId = new Map(rows.map(r => [r.id, r]));

  // Stale candidate: not ranked, not board candidate
  assert.equal(byId.get('c-stale')!.selection_rank, null);
  assert.equal(byId.get('c-stale')!.is_board_candidate, false);

  // Live candidate: ranked 1
  assert.equal(byId.get('c-live')!.selection_rank, 1);
  assert.equal(byId.get('c-live')!.is_board_candidate, true);
});

test('TC7: re-rank idempotent — second run produces identical rank assignment', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
    makeUniverseRow({ id: 'universe-3', provider_market_key: 'market-3', is_stale: false }),
  ]);

  const now = '2026-04-09T10:00:00.000Z';
  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'c1', universe_id: 'universe-1', model_score: 0.60, model_tier: 'B', created_at: now }),
    makeCandidate({ id: 'c2', universe_id: 'universe-2', model_score: 0.90, model_tier: 'A+', created_at: now }),
    makeCandidate({ id: 'c3', universe_id: 'universe-3', model_score: 0.75, model_tier: 'A', created_at: now }),
  ]);

  // Run once
  const result1 = await runRankedSelection({ pickCandidates, marketUniverse });

  // Capture ranks after first run
  const rowsAfterRun1 = pickCandidates.listAll();
  const rankMap1 = new Map(rowsAfterRun1.map(r => [r.id, r.selection_rank]));

  // Run again with same pool
  const result2 = await runRankedSelection({ pickCandidates, marketUniverse });

  const rowsAfterRun2 = pickCandidates.listAll();
  const rankMap2 = new Map(rowsAfterRun2.map(r => [r.id, r.selection_rank]));

  // Same ranked count
  assert.equal(result1.ranked, result2.ranked);

  // Ranks are identical across both runs
  for (const [id, rank] of rankMap1) {
    assert.equal(rankMap2.get(id), rank, `Rank mismatch for candidate ${id}`);
  }

  // Ranks are contiguous 1..N
  const ranks = rowsAfterRun2.map(r => r.selection_rank).filter(r => r !== null).sort((a, b) => a! - b!);
  assert.deepStrictEqual(ranks, [1, 2, 3]);
});

test('TC8: pick_id never set on any row after run', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
  ]);

  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'c1', universe_id: 'universe-1', model_score: 0.80, pick_id: null }),
    makeCandidate({ id: 'c2', universe_id: 'universe-2', model_score: 0.65, pick_id: null }),
  ]);

  await runRankedSelection({ pickCandidates, marketUniverse });

  const rows = pickCandidates.listAll();
  for (const row of rows) {
    assert.equal(row.pick_id, null, `pick_id must remain null for candidate ${row.id}`);
  }
});

test('TC9: shadow_mode never false on any row after run', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({ id: 'universe-1', provider_market_key: 'market-1', is_stale: false }),
    makeUniverseRow({ id: 'universe-2', provider_market_key: 'market-2', is_stale: false }),
  ]);

  seedCandidateRows(pickCandidates, [
    makeCandidate({ id: 'c1', universe_id: 'universe-1', model_score: 0.80, shadow_mode: true }),
    makeCandidate({ id: 'c2', universe_id: 'universe-2', model_score: 0.65, shadow_mode: true }),
  ]);

  await runRankedSelection({ pickCandidates, marketUniverse });

  const rows = pickCandidates.listAll();
  for (const row of rows) {
    assert.equal(row.shadow_mode, true, `shadow_mode must remain true for candidate ${row.id}`);
  }
});
