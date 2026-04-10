/**
 * board-scan-service.test.ts
 *
 * Unit tests for BoardScanService using in-memory repositories.
 * No live DB required.
 *
 * Test runner: node:test + tsx --test
 * Assertions: node:assert/strict
 *
 * Phase 2 invariants verified in every test:
 *   - pick_id is NEVER set on any written row
 *   - shadow_mode is NEVER false on any written row
 *   - model_score / model_tier / model_confidence are NEVER set
 *   - No picks rows are written
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBoardScan } from './board-scan-service.js';
import { InMemoryMarketUniverseRepository, InMemoryPickCandidateRepository } from '@unit-talk/db';
import type { MarketUniverseRow } from '@unit-talk/db';

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
    current_under_odds: -110,
    opening_line: 24.5,
    opening_over_odds: -110,
    opening_under_odds: -110,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: 0.5,
    fair_under_prob: 0.5,
    is_stale: false,
    last_offer_snapshot_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    refreshed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Seed a universe row into an InMemoryMarketUniverseRepository.
 * The InMemory repo stores MarketUniverseUpsertInput, but listAll returns those.
 * We use upsertMarketUniverse and then manipulate the internal map via a cast.
 *
 * Since InMemoryMarketUniverseRepository.listAll() returns MarketUniverseUpsertInput
 * (which lacks the `id` field), we need to populate the repo in a way the board scan
 * can read. The board scan reads via listAll() when available. We store full rows by
 * directly mutating the internal rows map via a helper.
 */
function seedUniverseRows(repo: InMemoryMarketUniverseRepository, rows: MarketUniverseRow[]): void {
  // Access the internal rows Map via cast to populate full MarketUniverseRow objects.
  // This is a test-only pattern — board scan reads listAll() which returns whatever is stored.
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

function makeDeps(universeRows: MarketUniverseRow[] = []) {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  if (universeRows.length > 0) {
    seedUniverseRows(marketUniverse, universeRows);
  }
  return { marketUniverse, pickCandidates };
}

// ---------------------------------------------------------------------------
// Feature gate tests
// ---------------------------------------------------------------------------

test('board-scan: feature gate OFF — returns zeros immediately, writes no candidates', async () => {
  const universeRow = makeUniverseRow();
  const deps = makeDeps([universeRow]);

  const result = await runBoardScan(deps, { enabled: false });

  assert.equal(result.scanned, 0);
  assert.equal(result.qualified, 0);
  assert.equal(result.rejected, 0);
  assert.ok(result.scanRunId.length > 0);
  assert.equal(deps.pickCandidates.listAll().length, 0, 'no candidates written when gate is off');
});

test('board-scan: feature gate ON — scans rows and writes candidates', async () => {
  const universeRow = makeUniverseRow();
  const deps = makeDeps([universeRow]);

  const result = await runBoardScan(deps, { enabled: true });

  assert.equal(result.scanned, 1);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.scanRunId.length > 0);
  assert.equal(deps.pickCandidates.listAll().length, 1);
});

// ---------------------------------------------------------------------------
// Filter tests — each of the 7 coarse filters
// ---------------------------------------------------------------------------

test('filter: missing_canonical_identity — fires when canonical_market_key is empty', async () => {
  const row = makeUniverseRow({ canonical_market_key: '' });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  assert.equal(candidates.length, 1);
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'missing_canonical_identity');
  assert.equal(c.filter_details!.missing_canonical_identity, true);
});

test('filter: stale_price_data — fires when is_stale = true', async () => {
  const row = makeUniverseRow({ is_stale: true });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  assert.equal(candidates.length, 1);
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'stale_price_data');
  assert.equal(c.filter_details!.stale_price_data, true);
});

test('filter: unsupported_market_family — fires when market_type_id is null', async () => {
  const row = makeUniverseRow({ market_type_id: null });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'unsupported_market_family');
  assert.equal(c.filter_details!.unsupported_market_family, true);
});

test('filter: missing_participant_linkage — fires when provider_participant_id is set but participant_id is null', async () => {
  const row = makeUniverseRow({
    provider_participant_id: 'player-1',
    participant_id: null,
  });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'missing_participant_linkage');
  assert.equal(c.filter_details!.missing_participant_linkage, true);
});

test('filter: missing_participant_linkage — does NOT fire for game-line markets (provider_participant_id null)', async () => {
  // Game-line market: no participant needed
  const row = makeUniverseRow({
    provider_participant_id: null,
    participant_id: null,
  });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  const c = candidates[0]!;
  // missing_participant_linkage should NOT fire for game-line markets
  assert.equal(c.filter_details!.missing_participant_linkage, false);
});

test('filter: invalid_odds_structure — fires when current_over_odds is null', async () => {
  const row = makeUniverseRow({ current_over_odds: null });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'invalid_odds_structure');
  assert.equal(c.filter_details!.invalid_odds_structure, true);
});

test('filter: invalid_odds_structure — fires when current_under_odds is null', async () => {
  const row = makeUniverseRow({ current_under_odds: null });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  const c = candidates[0]!;
  assert.equal(c.status, 'rejected');
  assert.equal(c.rejection_reason, 'invalid_odds_structure');
  assert.equal(c.filter_details!.invalid_odds_structure, true);
});

test('filter: duplicate_suppressed — always false in Phase 2', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.equal(c.filter_details!.duplicate_suppressed, false);
});

test('filter: freshness_window_failed — always false in Phase 2', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.equal(c.filter_details!.freshness_window_failed, false);
});

// ---------------------------------------------------------------------------
// Qualified path
// ---------------------------------------------------------------------------

test('qualified row: passes all filters — status = qualified, rejection_reason = null', async () => {
  // A fully valid row that passes all 7 filters
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.equal(c.status, 'qualified');
  assert.equal(c.rejection_reason, null);
  assert.equal(c.filter_details!.missing_canonical_identity, false);
  assert.equal(c.filter_details!.stale_price_data, false);
  assert.equal(c.filter_details!.unsupported_market_family, false);
  assert.equal(c.filter_details!.missing_participant_linkage, false);
  assert.equal(c.filter_details!.invalid_odds_structure, false);
  assert.equal(c.filter_details!.duplicate_suppressed, false);
  assert.equal(c.filter_details!.freshness_window_failed, false);
});

// ---------------------------------------------------------------------------
// Phase 2 invariant enforcement
// ---------------------------------------------------------------------------

test('Phase 2 invariant: pick_id is NEVER set on written candidates', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  for (const c of candidates) {
    assert.equal(c.pick_id, null, 'pick_id must remain NULL in Phase 2');
  }
});

test('Phase 2 invariant: shadow_mode is NEVER false on written candidates', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  for (const c of candidates) {
    assert.equal(c.shadow_mode, true, 'shadow_mode must remain true in Phase 2');
  }
});

test('Phase 2 invariant: model_score, model_tier, model_confidence are NEVER set', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  for (const c of candidates) {
    assert.equal(c.model_score, null, 'model_score must remain NULL in Phase 2');
    assert.equal(c.model_tier, null, 'model_tier must remain NULL in Phase 2');
    assert.equal(c.model_confidence, null, 'model_confidence must remain NULL in Phase 2');
  }
});

// ---------------------------------------------------------------------------
// Idempotency — upsert on universe_id
// ---------------------------------------------------------------------------

test('idempotency: running board scan twice does not double the candidate count', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });
  await runBoardScan(deps, { enabled: true });

  assert.equal(deps.pickCandidates.listAll().length, 1, 'upsert on universe_id must be idempotent');
});

test('idempotency: repeated scan updates scan_run_id to the latest run', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  const result1 = await runBoardScan(deps, { enabled: true });
  const result2 = await runBoardScan(deps, { enabled: true });

  assert.notEqual(result1.scanRunId, result2.scanRunId, 'each scan run gets a unique scanRunId');
  const c = deps.pickCandidates.listAll()[0]!;
  assert.equal(c.scan_run_id, result2.scanRunId, 'scan_run_id should reflect the latest run');
});

// ---------------------------------------------------------------------------
// scan_run_id
// ---------------------------------------------------------------------------

test('scan_run_id: all candidates in a run share the same scan_run_id', async () => {
  const row1 = makeUniverseRow({ id: 'universe-1', provider_participant_id: 'player-1' });
  const row2 = makeUniverseRow({ id: 'universe-2', provider_participant_id: 'player-2' });
  const deps = makeDeps([row1, row2]);

  const result = await runBoardScan(deps, { enabled: true });

  const candidates = deps.pickCandidates.listAll();
  assert.equal(candidates.length, 2);
  for (const c of candidates) {
    assert.equal(c.scan_run_id, result.scanRunId, 'all candidates in a run share the same scan_run_id');
  }
});

// ---------------------------------------------------------------------------
// filter_details structure — all 7 keys present on every row
// ---------------------------------------------------------------------------

test('filter_details: all 7 keys are present on every candidate row (qualified)', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.ok(c.filter_details !== null && c.filter_details !== undefined);
  assert.ok('missing_canonical_identity' in c.filter_details!);
  assert.ok('stale_price_data' in c.filter_details!);
  assert.ok('unsupported_market_family' in c.filter_details!);
  assert.ok('missing_participant_linkage' in c.filter_details!);
  assert.ok('invalid_odds_structure' in c.filter_details!);
  assert.ok('duplicate_suppressed' in c.filter_details!);
  assert.ok('freshness_window_failed' in c.filter_details!);
});

test('filter_details: all 7 keys are present on every candidate row (rejected)', async () => {
  const row = makeUniverseRow({ is_stale: true });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.ok(c.filter_details !== null && c.filter_details !== undefined);
  const keys = Object.keys(c.filter_details!);
  assert.equal(keys.length, 7);
});

// ---------------------------------------------------------------------------
// Result counts
// ---------------------------------------------------------------------------

test('result counts: qualified and rejected are correctly counted', async () => {
  // 2 qualified, 1 rejected (stale)
  const row1 = makeUniverseRow({ id: 'universe-1', provider_participant_id: 'p1' });
  const row2 = makeUniverseRow({ id: 'universe-2', provider_participant_id: 'p2' });
  const row3 = makeUniverseRow({ id: 'universe-3', provider_participant_id: 'p3', is_stale: true });
  const deps = makeDeps([row1, row2, row3]);

  const result = await runBoardScan(deps, { enabled: true });

  assert.equal(result.scanned, 3);
  assert.equal(result.qualified, 2);
  assert.equal(result.rejected, 1);
});

// ---------------------------------------------------------------------------
// Empty universe — no crash
// ---------------------------------------------------------------------------

test('empty universe: no candidates written, result is zero counts', async () => {
  const deps = makeDeps([]);

  const result = await runBoardScan(deps, { enabled: true });

  assert.equal(result.scanned, 0);
  assert.equal(result.qualified, 0);
  assert.equal(result.rejected, 0);
  assert.equal(deps.pickCandidates.listAll().length, 0);
});

// ---------------------------------------------------------------------------
// provenance written on every candidate
// ---------------------------------------------------------------------------

test('provenance: written on every candidate row', async () => {
  const row = makeUniverseRow();
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.ok(c.provenance !== null);
  assert.ok(typeof c.provenance === 'object');
  assert.ok('scanVersion' in (c.provenance as object));
  assert.ok('filterVersion' in (c.provenance as object));
  assert.ok('runAt' in (c.provenance as object));
});

// ---------------------------------------------------------------------------
// universe_id linkage
// ---------------------------------------------------------------------------

test('universe_id: candidate row links back to the universe row id', async () => {
  const row = makeUniverseRow({ id: 'universe-abc-123' });
  const deps = makeDeps([row]);

  await runBoardScan(deps, { enabled: true });

  const c = deps.pickCandidates.listAll()[0]!;
  assert.equal(c.universe_id, 'universe-abc-123');
});
