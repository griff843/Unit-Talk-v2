/**
 * candidate-scoring-service.test.ts
 *
 * Unit tests for CandidateScoringService using in-memory repositories.
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
import { runCandidateScoring } from './candidate-scoring-service.js';
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
    model_score: null,
    model_tier: null,
    model_confidence: null,
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

test('returns zero counts when no unscored candidates exist', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.ok(result.durationMs >= 0);
});

test('scores one qualified candidate with valid fair probs', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.56, fair_under_prob: 0.44, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ id: 'candidate-1', universe_id: 'universe-1', status: 'qualified', model_score: null });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  // Verify the model_score was written back
  const all = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const updated = all.get('universe-1');
  assert.ok(updated !== undefined, 'candidate row should exist');
  assert.ok(updated!.model_score !== null, 'model_score should be set');
  assert.ok(updated!.model_score! >= 0.5 && updated!.model_score! <= 1, `model_score should be in [0.5,1], got ${updated!.model_score}`);
  assert.ok(updated!.model_tier !== null, 'model_tier should be set');
  assert.ok(updated!.model_confidence !== null, 'model_confidence should be set');
});

test('skips candidate with stale market universe row', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', is_stale: true });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ id: 'candidate-1', universe_id: 'universe-1', status: 'qualified', model_score: null });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
});

test('skips candidate when fair probs are both null', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: null, fair_under_prob: null, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ id: 'candidate-1', universe_id: 'universe-1', status: 'qualified', model_score: null });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
});

test('never sets pick_id or shadow_mode=false on any row', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.6, fair_under_prob: 0.4, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ id: 'candidate-1', universe_id: 'universe-1', status: 'qualified', model_score: null });
  seedCandidateRows(pickCandidates, [candidate]);

  await runCandidateScoring({ pickCandidates, marketUniverse });

  const all = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  for (const row of all.values()) {
    assert.equal(row.pick_id, null, 'pick_id must remain null');
    assert.equal(row.shadow_mode, true, 'shadow_mode must remain true');
  }
});

test('skips already-scored candidates (model_score not null)', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.6, fair_under_prob: 0.4, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  // Already scored candidate
  const candidate = makeCandidate({
    id: 'candidate-1',
    universe_id: 'universe-1',
    status: 'qualified',
    model_score: 0.65,
    model_tier: 'B',
    model_confidence: 0.8,
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
});
