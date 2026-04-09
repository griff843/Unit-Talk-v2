/**
 * board-pick-writer.test.ts — Phase 5 UTV2-476
 *
 * Verifies the governed candidate-to-pick write path:
 *   - Picks are created with source='board-construction'
 *   - pick_candidates.pick_id is linked after write
 *   - pick_candidates.shadow_mode is cleared
 *   - Idempotent: re-run skips already-linked candidates
 *   - Skips candidates with missing universe or invalid odds
 *   - Empty board run returns zeros without error
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import { runBoardPickWriter } from './board-pick-writer.js';
import type {
  SyndicateBoardInsertInput,
  PickCandidateUpsertInput,
  MarketUniverseUpsertInput,
} from '@unit-talk/db';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUniverseInput(overrides: Partial<MarketUniverseUpsertInput> = {}): MarketUniverseUpsertInput {
  return {
    sport_key: 'baseball_mlb',
    league_key: 'mlb',
    provider_key: 'sgo',
    provider_event_id: `evt_${crypto.randomUUID()}`,
    provider_participant_id: `player_${crypto.randomUUID()}`,
    provider_market_key: 'batting_homeRuns-all-game-ou',
    canonical_market_key: 'batting_homeRuns',
    current_line: 0.5,
    current_over_odds: -115,
    current_under_odds: -105,
    opening_line: 0.5,
    opening_over_odds: -115,
    opening_under_odds: -105,
    ...overrides,
  };
}

function makeCandidateInput(universeId: string, overrides: Partial<PickCandidateUpsertInput> = {}): PickCandidateUpsertInput {
  return {
    universe_id: universeId,
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
    scan_run_id: crypto.randomUUID(),
    provenance: { scanVersion: '1.0.0', filterVersion: '1.0.0', runAt: new Date().toISOString() },
    expires_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('empty board run returns zeros', async () => {
  const repos = createInMemoryRepositoryBundle();
  const result = await runBoardPickWriter(repos);
  assert.equal(result.boardSize, 0);
  assert.equal(result.written, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.deepEqual(result.pickIds, []);
});

test('writes pick for a board candidate and links pick_id', async () => {
  const repos = createInMemoryRepositoryBundle();

  // Seed universe
  const universeInput = makeUniverseInput();
  await repos.marketUniverse.upsertMarketUniverse([universeInput]);
  const [universe] = await repos.marketUniverse.listForScan(10);
  assert.ok(universe, 'universe should exist after upsert');

  // Seed candidate
  const candidateInput = makeCandidateInput(universe.id);
  await repos.pickCandidates.upsertCandidates([candidateInput]);
  let [candidate] = await repos.pickCandidates.findByStatus('qualified');
  assert.ok(candidate, 'candidate should exist after upsert');

  // Set selection_rank + is_board_candidate (Phase 4 state)
  await repos.pickCandidates.updateSelectionRankBatch([
    { id: candidate.id, selection_rank: 1, is_board_candidate: true },
  ]);

  // Seed board run
  const boardRunId = crypto.randomUUID();
  const boardRows: SyndicateBoardInsertInput[] = [
    {
      candidate_id: candidate.id,
      board_rank: 1,
      board_tier: 'ELITE',
      sport_key: 'baseball_mlb',
      market_type_id: null,
      model_score: 0.75,
      board_run_id: boardRunId,
    },
  ];
  await repos.syndicateBoard.insertBoardRun(boardRows);

  // Run the board pick writer
  const result = await runBoardPickWriter(repos);

  assert.equal(result.boardSize, 1);
  assert.equal(result.written, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.equal(result.pickIds.length, 1);

  // Verify pick was created with correct source
  const pickId = result.pickIds[0]!;
  const pick = await repos.picks.findPickById(pickId);
  assert.ok(pick, 'pick should exist');
  assert.equal(pick.source, 'board-construction');
  assert.ok(pick.metadata !== null && typeof pick.metadata === 'object');
  const meta = pick.metadata as Record<string, unknown>;
  assert.equal(meta['boardRunId'], boardRunId);
  assert.equal(meta['boardRank'], 1);
  assert.equal(meta['candidateId'], candidate.id);
  assert.equal(meta['governedBoardWrite'], true);

  // Verify pick_id was linked back on the candidate
  [candidate] = await repos.pickCandidates.findByStatus('qualified');
  assert.equal(candidate!.pick_id, pickId, 'pick_id should be linked on candidate');
  assert.equal(candidate!.shadow_mode, false, 'shadow_mode should be cleared');
});

test('idempotent: second run skips already-linked candidates', async () => {
  const repos = createInMemoryRepositoryBundle();

  const universeInput = makeUniverseInput();
  await repos.marketUniverse.upsertMarketUniverse([universeInput]);
  const [universe] = await repos.marketUniverse.listForScan(10);

  await repos.pickCandidates.upsertCandidates([makeCandidateInput(universe!.id)]);
  const [candidate] = await repos.pickCandidates.findByStatus('qualified');

  await repos.pickCandidates.updateSelectionRankBatch([
    { id: candidate!.id, selection_rank: 1, is_board_candidate: true },
  ]);

  const boardRunId = crypto.randomUUID();
  await repos.syndicateBoard.insertBoardRun([
    {
      candidate_id: candidate!.id,
      board_rank: 1,
      board_tier: 'STRONG',
      sport_key: 'baseball_mlb',
      market_type_id: null,
      model_score: 0.65,
      board_run_id: boardRunId,
    },
  ]);

  // First run
  const first = await runBoardPickWriter(repos);
  assert.equal(first.written, 1);

  // Second run — same board, candidate already linked
  const second = await runBoardPickWriter(repos);
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 1);

  // Only one pick in DB
  const candidates = await repos.pickCandidates.findByStatus('qualified');
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0]!.pick_id, 'pick_id should remain set');
});

test('skips board row with no matching candidate', async () => {
  const repos = createInMemoryRepositoryBundle();

  const boardRunId = crypto.randomUUID();
  await repos.syndicateBoard.insertBoardRun([
    {
      candidate_id: crypto.randomUUID(), // non-existent
      board_rank: 1,
      board_tier: 'STRONG',
      sport_key: 'baseball_mlb',
      market_type_id: null,
      model_score: 0.6,
      board_run_id: boardRunId,
    },
  ]);

  const result = await runBoardPickWriter(repos);
  assert.equal(result.boardSize, 1);
  assert.equal(result.written, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
});

test('skips candidate with invalid odds', async () => {
  const repos = createInMemoryRepositoryBundle();

  // Universe with null odds
  const universeInput = makeUniverseInput({
    current_over_odds: null as unknown as number,
    current_under_odds: null as unknown as number,
  });
  await repos.marketUniverse.upsertMarketUniverse([universeInput]);
  const [universe] = await repos.marketUniverse.listForScan(10);

  await repos.pickCandidates.upsertCandidates([makeCandidateInput(universe!.id)]);
  const [candidate] = await repos.pickCandidates.findByStatus('qualified');

  const boardRunId = crypto.randomUUID();
  await repos.syndicateBoard.insertBoardRun([
    {
      candidate_id: candidate!.id,
      board_rank: 1,
      board_tier: 'STANDARD',
      sport_key: 'baseball_mlb',
      market_type_id: null,
      model_score: 0.55,
      board_run_id: boardRunId,
    },
  ]);

  const result = await runBoardPickWriter(repos);
  assert.equal(result.written, 0);
  assert.equal(result.skipped, 1);
});

test('source attribution is board-construction on every written pick', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  // Seed 3 candidates
  const pickIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const universeInput = makeUniverseInput({
      provider_event_id: `evt_${i}`,
      current_over_odds: -110,
      current_under_odds: -110,
    });
    await repos.marketUniverse.upsertMarketUniverse([universeInput]);
    const universes = await repos.marketUniverse.listForScan(100);
    const universe = universes.find((u) => u.provider_event_id === `evt_${i}`)!;

    await repos.pickCandidates.upsertCandidates([makeCandidateInput(universe.id)]);
    const candidates = await repos.pickCandidates.findByStatus('qualified');
    const candidate = candidates.find((c) => c.universe_id === universe.id)!;

    await repos.pickCandidates.updateSelectionRankBatch([
      { id: candidate.id, selection_rank: i + 1, is_board_candidate: true },
    ]);

    await repos.syndicateBoard.insertBoardRun([
      {
        candidate_id: candidate.id,
        board_rank: i + 1,
        board_tier: 'STANDARD',
        sport_key: 'baseball_mlb',
        market_type_id: null,
        model_score: 0.6,
        board_run_id: boardRunId,
      },
    ]);
  }

  const result = await runBoardPickWriter(repos);
  assert.equal(result.written, 3);

  for (const pickId of result.pickIds) {
    const pick = await repos.picks.findPickById(pickId);
    assert.equal(pick!.source, 'board-construction', `pick ${pickId} must have source board-construction`);
    pickIds.push(pickId);
  }
  assert.equal(pickIds.length, 3);
});
