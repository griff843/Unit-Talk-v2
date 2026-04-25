/**
 * Tests for BoardConstructionService — Phase 4 UTV2-474
 *
 * TC1:  empty pool → boardSize=0, no errors
 * TC2:  single eligible candidate → boardSize=1, board_rank=1
 * TC3:  SUPPRESS candidates are excluded from board
 * TC4:  board size cap — >20 eligible candidates → board capped at 20
 * TC5:  sport cap — >6 from same sport → only 6 make it
 * TC6:  market dedup — >3 from same market_type_id → only 3 make it
 * TC7:  market_type_id=null candidates count independently (not limited by market dedup)
 * TC8:  never sets pick_id
 * TC9:  never sets shadow_mode=false
 * TC10: board_rank is contiguous 1..boardSize
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import type {
  IPickCandidateRepository,
  IMarketUniverseRepository,
  ISyndicateBoardRepository,
  PickCandidateRow,
  MarketUniverseRow,
  SyndicateBoardInsertInput,
  SyndicateBoardRow,
  ModelScoreUpdate,
  SelectionRankUpdate,
  PickCandidateUpsertInput,
  PickIdUpdate,
} from '@unit-talk/db';

import {
  BoardConstructionService,
  BOARD_SIZE_CAP,
  SPORT_CAP,
  MARKET_DUP_CAP,
} from './board-construction-service.js';

// =============================================================================
// Minimal in-memory test doubles (NOT mocks — real data stores)
// =============================================================================

class StubPickCandidateRepository implements IPickCandidateRepository {
  private rows: PickCandidateRow[] = [];

  seed(rows: PickCandidateRow[]) {
    this.rows = [...rows];
  }

  async findByStatus(status: string): Promise<PickCandidateRow[]> {
    return this.rows.filter((r) => r.status === status);
  }

  async upsertCandidates(_rows: PickCandidateUpsertInput[]): Promise<void> {
    // no-op for these tests
  }

  async updateModelScoreBatch(_updates: ModelScoreUpdate[]): Promise<void> {
    // no-op
  }

  async updateSelectionRankBatch(_updates: SelectionRankUpdate[]): Promise<void> {
    // no-op
  }

  async resetSelectionRanks(): Promise<void> {
    // no-op
  }

  async findByIds(ids: string[]): Promise<PickCandidateRow[]> {
    return this.rows.filter((r) => ids.includes(r.id));
  }

  async updatePickIdBatch(_updates: PickIdUpdate[]): Promise<void> {
    // no-op
  }
}

class StubMarketUniverseRepository implements IMarketUniverseRepository {
  private rows: MarketUniverseRow[] = [];

  seed(rows: MarketUniverseRow[]) {
    this.rows = [...rows];
  }

  async findByIds(ids: string[]): Promise<MarketUniverseRow[]> {
    return this.rows.filter((r) => ids.includes(r.id));
  }

  async upsertMarketUniverse(): Promise<void> {
    // no-op
  }

  async listForScan(): Promise<MarketUniverseRow[]> {
    return this.rows;
  }

  async findClosingLineByProviderKey(): Promise<null> {
    return null;
  }
}

class StubSyndicateBoardRepository implements ISyndicateBoardRepository {
  insertedRows: SyndicateBoardInsertInput[] = [];
  insertedRunId: string = '';

  async insertBoardRun(rows: SyndicateBoardInsertInput[]): Promise<string> {
    this.insertedRows = [...rows];
    this.insertedRunId = rows[0]?.board_run_id ?? '';
    return this.insertedRunId;
  }

  async listLatestBoardRun(): Promise<SyndicateBoardRow[]> {
    return [];
  }
}

// =============================================================================
// Helpers
// =============================================================================

function makeUniverseRow(overrides: Partial<MarketUniverseRow> & { id: string }): MarketUniverseRow {
  return {
    id: overrides.id,
    sport_key: overrides.sport_key ?? 'nba',
    league_key: overrides.league_key ?? 'nba',
    event_id: overrides.event_id ?? null,
    participant_id: overrides.participant_id ?? null,
    market_type_id: 'market_type_id' in overrides ? (overrides.market_type_id ?? null) : 'points',
    canonical_market_key: overrides.canonical_market_key ?? 'player-points-ou',
    provider_key: overrides.provider_key ?? 'sgo',
    provider_event_id: overrides.provider_event_id ?? 'evt1',
    provider_participant_id: overrides.provider_participant_id ?? null,
    provider_market_key: overrides.provider_market_key ?? 'points-all-game-ou',
    current_line: overrides.current_line ?? 20,
    current_over_odds: overrides.current_over_odds ?? -110,
    current_under_odds: overrides.current_under_odds ?? -110,
    opening_line: overrides.opening_line ?? null,
    opening_over_odds: overrides.opening_over_odds ?? null,
    opening_under_odds: overrides.opening_under_odds ?? null,
    closing_line: overrides.closing_line ?? null,
    closing_over_odds: overrides.closing_over_odds ?? null,
    closing_under_odds: overrides.closing_under_odds ?? null,
    fair_over_prob: overrides.fair_over_prob ?? 0.52,
    fair_under_prob: overrides.fair_under_prob ?? 0.48,
    is_stale: overrides.is_stale ?? false,
    last_offer_snapshot_at: overrides.last_offer_snapshot_at ?? new Date().toISOString(),
    refreshed_at: overrides.refreshed_at ?? new Date().toISOString(),
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

function makeCandidateRow(overrides: Partial<PickCandidateRow> & { id: string; universe_id: string }): PickCandidateRow {
  return {
    id: overrides.id,
    universe_id: overrides.universe_id,
    status: overrides.status ?? 'qualified',
    rejection_reason: overrides.rejection_reason ?? null,
    filter_details: overrides.filter_details ?? null,
    model_score: overrides.model_score ?? 0.75,
    model_tier: overrides.model_tier ?? 'A',
    model_confidence: overrides.model_confidence ?? 0.8,
    selection_rank: overrides.selection_rank ?? 1,
    is_board_candidate: overrides.is_board_candidate ?? true,
    shadow_mode: overrides.shadow_mode ?? true,
    pick_id: overrides.pick_id ?? null,
    scan_run_id: overrides.scan_run_id ?? null,
    provenance: overrides.provenance ?? null,
    expires_at: overrides.expires_at ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

function makeRepos(
  candidates: PickCandidateRow[] = [],
  universeRows: MarketUniverseRow[] = [],
): {
  pickCandidates: StubPickCandidateRepository;
  marketUniverse: StubMarketUniverseRepository;
  syndicateBoard: StubSyndicateBoardRepository;
} {
  const pickCandidates = new StubPickCandidateRepository();
  pickCandidates.seed(candidates);

  const marketUniverse = new StubMarketUniverseRepository();
  marketUniverse.seed(universeRows);

  const syndicateBoard = new StubSyndicateBoardRepository();

  return { pickCandidates, marketUniverse, syndicateBoard };
}

// =============================================================================
// TC1: empty pool → boardSize=0, no errors
// =============================================================================

test('TC1: empty candidate pool yields boardSize=0 with no errors', async () => {
  const repos = makeRepos([], []);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, 0);
  assert.equal(result.errors, 0);
  assert.equal(repos.syndicateBoard.insertedRows.length, 0);
});

// =============================================================================
// TC2: single eligible candidate → boardSize=1, board_rank=1
// =============================================================================

test('TC2: single eligible candidate produces boardSize=1 with board_rank=1', async () => {
  const universeId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();

  const universeRows = [makeUniverseRow({ id: universeId, sport_key: 'nba', market_type_id: 'points' })];
  const candidates = [
    makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: 1,
      is_board_candidate: true,
    }),
  ];

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, 1);
  assert.equal(result.errors, 0);
  assert.equal(repos.syndicateBoard.insertedRows.length, 1);
  assert.equal(repos.syndicateBoard.insertedRows[0]!.board_rank, 1);
  assert.equal(repos.syndicateBoard.insertedRows[0]!.candidate_id, candidateId);
});

// =============================================================================
// TC3: SUPPRESS candidates are excluded from board
// =============================================================================

test('TC3: SUPPRESS candidates are excluded from the board', async () => {
  const universeId = crypto.randomUUID();
  const suppressId = crypto.randomUUID();
  const goodId = crypto.randomUUID();

  const universeRows = [
    makeUniverseRow({ id: universeId, sport_key: 'nba', market_type_id: 'points' }),
  ];
  const candidates = [
    makeCandidateRow({
      id: suppressId,
      universe_id: universeId,
      model_tier: 'SUPPRESS',
      selection_rank: 1,
      is_board_candidate: true,
    }),
    makeCandidateRow({
      id: goodId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: 2,
      is_board_candidate: true,
    }),
  ];

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.skippedSuppress, 1);
  // goodId has same universe_id, so it will be found in the map
  // but only one candidate per universe_id can be in the filtered list
  // The SUPPRESS candidate is counted but not included in the greedy walk
  const insertedIds = repos.syndicateBoard.insertedRows.map((r) => r.candidate_id);
  assert.equal(insertedIds.includes(suppressId), false);
});

// =============================================================================
// TC4: board size cap — >20 eligible candidates → board capped at 20
// =============================================================================

test('TC4: board size cap limits board to BOARD_SIZE_CAP rows', async () => {
  const N = BOARD_SIZE_CAP + 5; // 25 candidates
  const candidates: PickCandidateRow[] = [];
  const universeRows: MarketUniverseRow[] = [];

  for (let i = 0; i < N; i++) {
    const universeId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    // Use unique sport per candidate to avoid sport cap triggering first
    universeRows.push(makeUniverseRow({
      id: universeId,
      sport_key: `sport_${i}`,
      market_type_id: `market_${i}`,
    }));
    candidates.push(makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: i + 1,
      is_board_candidate: true,
    }));
  }

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, BOARD_SIZE_CAP);
  assert.equal(result.skippedBoardCap, N - BOARD_SIZE_CAP);
  assert.equal(repos.syndicateBoard.insertedRows.length, BOARD_SIZE_CAP);
});

// =============================================================================
// TC5: sport cap — >6 from same sport → only 6 make it
// =============================================================================

test('TC5: sport cap limits candidates from same sport to SPORT_CAP', async () => {
  const N = SPORT_CAP + 4; // 10 from same sport
  const candidates: PickCandidateRow[] = [];
  const universeRows: MarketUniverseRow[] = [];

  for (let i = 0; i < N; i++) {
    const universeId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    universeRows.push(makeUniverseRow({
      id: universeId,
      sport_key: 'nba', // all same sport
      market_type_id: `market_${i}`, // different market types to avoid market dup cap
    }));
    candidates.push(makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: i + 1,
      is_board_candidate: true,
    }));
  }

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, SPORT_CAP);
  assert.equal(result.skippedSportCap, N - SPORT_CAP);
});

// =============================================================================
// TC6: market dedup — >3 from same market_type_id → only 3 make it
// =============================================================================

test('TC6: market dedup cap limits candidates from same market_type_id to MARKET_DUP_CAP', async () => {
  const N = MARKET_DUP_CAP + 4; // 7 from same market type
  const candidates: PickCandidateRow[] = [];
  const universeRows: MarketUniverseRow[] = [];

  for (let i = 0; i < N; i++) {
    const universeId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    universeRows.push(makeUniverseRow({
      id: universeId,
      sport_key: `sport_${i}`, // different sports to avoid sport cap
      market_type_id: 'points', // all same market type
    }));
    candidates.push(makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: i + 1,
      is_board_candidate: true,
    }));
  }

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, MARKET_DUP_CAP);
  assert.equal(result.skippedMarketDup, N - MARKET_DUP_CAP);
});

// =============================================================================
// TC7: market_type_id=null candidates count independently (not limited by market dedup)
// =============================================================================

test('TC7: market_type_id=null candidates bypass market dedup cap', async () => {
  // Put MARKET_DUP_CAP + 2 candidates, all with market_type_id=null
  const N = MARKET_DUP_CAP + 2; // 5
  const candidates: PickCandidateRow[] = [];
  const universeRows: MarketUniverseRow[] = [];

  for (let i = 0; i < N; i++) {
    const universeId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    universeRows.push(makeUniverseRow({
      id: universeId,
      sport_key: `sport_${i}`, // different sports to avoid sport cap
      market_type_id: null, // null market type — bypasses market dedup
    }));
    candidates.push(makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: i + 1,
      is_board_candidate: true,
    }));
  }

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  // All N should make it — no market dedup applies to null market_type_id
  assert.equal(result.boardSize, N);
  assert.equal(result.skippedMarketDup, 0);
});

// =============================================================================
// TC8: never sets pick_id
// =============================================================================

test('TC8: board construction never sets pick_id on inserted rows', async () => {
  const universeId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();

  const universeRows = [makeUniverseRow({ id: universeId, sport_key: 'nba', market_type_id: 'points' })];
  const candidates = [
    makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: 1,
      is_board_candidate: true,
      pick_id: null, // must remain null
    }),
  ];

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  await svc.run();

  // SyndicateBoardInsertInput does not have pick_id — verify it's not present
  for (const row of repos.syndicateBoard.insertedRows) {
    assert.equal(Object.hasOwn(row, 'pick_id'), false,
      'pick_id must not be set on syndicate_board rows');
  }

  // Also verify the candidate's pick_id was never touched (it remains null in the stub)
  const candidateRows = await repos.pickCandidates.findByStatus('qualified');
  for (const c of candidateRows) {
    assert.equal(c.pick_id, null, 'candidate pick_id must remain null');
  }
});

// =============================================================================
// TC9: never sets shadow_mode=false
// =============================================================================

test('TC9: board construction never sets shadow_mode=false on candidates', async () => {
  const universeId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();

  const universeRows = [makeUniverseRow({ id: universeId, sport_key: 'nba', market_type_id: 'points' })];
  const candidates = [
    makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: 1,
      is_board_candidate: true,
      shadow_mode: true, // must remain true
    }),
  ];

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  await svc.run();

  // Verify candidates still have shadow_mode=true after the run
  const candidateRows = await repos.pickCandidates.findByStatus('qualified');
  for (const c of candidateRows) {
    assert.equal(c.shadow_mode, true, 'shadow_mode must remain true');
  }

  // SyndicateBoardInsertInput does not have shadow_mode — verify it's not present
  for (const row of repos.syndicateBoard.insertedRows) {
    assert.equal(Object.hasOwn(row, 'shadow_mode'), false,
      'shadow_mode must not be set on syndicate_board rows');
  }
});

// =============================================================================
// TC10: board_rank is contiguous 1..boardSize
// =============================================================================

test('TC10: board_rank is contiguous 1..boardSize', async () => {
  const N = 5;
  const candidates: PickCandidateRow[] = [];
  const universeRows: MarketUniverseRow[] = [];

  for (let i = 0; i < N; i++) {
    const universeId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    universeRows.push(makeUniverseRow({
      id: universeId,
      sport_key: `sport_${i}`,
      market_type_id: `market_${i}`,
    }));
    candidates.push(makeCandidateRow({
      id: candidateId,
      universe_id: universeId,
      model_tier: 'A',
      selection_rank: i + 1,
      is_board_candidate: true,
    }));
  }

  const repos = makeRepos(candidates, universeRows);
  const svc = new BoardConstructionService(repos);
  const result = await svc.run();

  assert.equal(result.boardSize, N);

  const ranks = repos.syndicateBoard.insertedRows.map((r) => r.board_rank).sort((a, b) => a - b);
  for (let i = 0; i < N; i++) {
    assert.equal(ranks[i], i + 1, `board_rank at position ${i} should be ${i + 1}`);
  }
});
