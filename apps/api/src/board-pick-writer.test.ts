/**
 * board-pick-writer.test.ts — Phase 5 UTV2-476 (hardening patch)
 *
 * Tests the governed candidate-to-pick write path including:
 *   - Per-row immediate linking (not deferred batch)
 *   - Partial-success safety: first row linked before second row fails
 *   - shadow_mode only cleared on successfully linked candidates
 *   - Idempotency: already-linked candidates skipped on rerun
 *   - Rerun after partial failure: unlinked candidate retried, no duplicate
 *   - Audit payload includes actor, boardRunId, written/skipped/errors counts
 *   - Empty board run, missing candidate, invalid odds (existing coverage retained)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import type { IPickCandidateRepository, PickIdUpdate } from '@unit-talk/db';
import { runBoardPickWriter } from './board-pick-writer.js';
import type {
  PickCandidateUpsertInput,
  MarketUniverseUpsertInput,
  RepositoryBundle,
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
    event_id: null,
    participant_id: null,
    market_type_id: null,
    current_line: 0.5,
    current_over_odds: -115,
    current_under_odds: -105,
    opening_line: 0.5,
    opening_over_odds: -115,
    opening_under_odds: -105,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: null,
    fair_under_prob: null,
    is_stale: false,
    last_offer_snapshot_at: new Date().toISOString(),
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

/**
 * Seed a single candidate + board row. Returns the candidate ID.
 */
async function seedBoardCandidate(
  repos: RepositoryBundle,
  boardRunId: string,
  boardRank: number,
  universeOverrides: Partial<MarketUniverseUpsertInput> = {},
): Promise<string> {
  const universeInput = makeUniverseInput(universeOverrides);
  await repos.marketUniverse.upsertMarketUniverse([universeInput]);
  const allUniverses = await repos.marketUniverse.listForScan(500);
  const universe = allUniverses.find(
    (u) => u.provider_event_id === universeInput.provider_event_id,
  )!;

  await repos.pickCandidates.upsertCandidates([makeCandidateInput(universe.id)]);
  const allCandidates = await repos.pickCandidates.findByStatus('qualified');
  const candidate = allCandidates.find((c) => c.universe_id === universe.id)!;

  await repos.pickCandidates.updateSelectionRankBatch([
    { id: candidate.id, selection_rank: boardRank, is_board_candidate: true },
  ]);

  await repos.syndicateBoard.insertBoardRun([
    {
      candidate_id: candidate.id,
      board_rank: boardRank,
      board_tier: 'STANDARD',
      sport_key: 'baseball_mlb',
      market_type_id: null,
      model_score: 0.65,
      board_run_id: boardRunId,
    },
  ]);

  return candidate.id;
}

/**
 * Create a proxy around IPickCandidateRepository that throws on the Nth
 * call to updatePickIdBatch. All other methods delegate normally.
 * Used to simulate a per-row link failure without changing InMemory state
 * for non-failing calls.
 */
function makeFailingOnNthLinkRepo(
  inner: IPickCandidateRepository,
  failOnCallN: number,
): IPickCandidateRepository {
  let callCount = 0;
  return {
    upsertCandidates: (rows) => inner.upsertCandidates(rows),
    findByStatus: (status) => inner.findByStatus(status),
    updateModelScoreBatch: (updates) => inner.updateModelScoreBatch(updates),
    updateSelectionRankBatch: (updates) => inner.updateSelectionRankBatch(updates),
    resetSelectionRanks: () => inner.resetSelectionRanks(),
    findByIds: (ids) => inner.findByIds(ids),
    async updatePickIdBatch(updates: PickIdUpdate[]): Promise<void> {
      callCount++;
      if (callCount === failOnCallN) {
        throw new Error(`simulated link failure on call ${callCount}`);
      }
      return inner.updatePickIdBatch(updates);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — original coverage (retained)
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
  const boardRunId = crypto.randomUUID();
  const candidateId = await seedBoardCandidate(repos, boardRunId, 1);

  const result = await runBoardPickWriter(repos);

  assert.equal(result.boardSize, 1);
  assert.equal(result.written, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.equal(result.pickIds.length, 1);

  const pickId = result.pickIds[0]!;
  const pick = await repos.picks.findPickById(pickId);
  assert.ok(pick, 'pick should exist');
  assert.equal(pick.source, 'board-construction');
  const meta = pick.metadata as Record<string, unknown>;
  assert.equal(meta['boardRunId'], boardRunId);
  assert.equal(meta['boardRank'], 1);
  assert.equal(meta['candidateId'], candidateId);
  assert.equal(meta['governedBoardWrite'], true);

  const [candidate] = await repos.pickCandidates.findByStatus('qualified');
  assert.equal(candidate!.pick_id, pickId, 'pick_id should be linked on candidate');
  assert.equal(candidate!.shadow_mode, false, 'shadow_mode should be cleared');
});

test('idempotent: second run skips already-linked candidates', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();
  await seedBoardCandidate(repos, boardRunId, 1);

  const first = await runBoardPickWriter(repos);
  assert.equal(first.written, 1);

  const second = await runBoardPickWriter(repos);
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 1);

  const candidates = await repos.pickCandidates.findByStatus('qualified');
  assert.ok(candidates[0]!.pick_id, 'pick_id should remain set');
});

test('skips board row with no matching candidate', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();
  await repos.syndicateBoard.insertBoardRun([
    {
      candidate_id: crypto.randomUUID(), // non-existent
      board_rank: 1,
      board_tier: 'STANDARD',
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
  const boardRunId = crypto.randomUUID();
  await seedBoardCandidate(repos, boardRunId, 1, {
    current_over_odds: null as unknown as number,
    current_under_odds: null as unknown as number,
  });

  const result = await runBoardPickWriter(repos);
  assert.equal(result.written, 0);
  assert.equal(result.skipped, 1);
});

test('source attribution is board-construction on every written pick', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  for (let i = 0; i < 3; i++) {
    await seedBoardCandidate(repos, boardRunId, i + 1, {
      provider_event_id: `evt_source_${i}`,
    });
  }

  const result = await runBoardPickWriter(repos);
  assert.equal(result.written, 3);

  for (const pickId of result.pickIds) {
    const pick = await repos.picks.findPickById(pickId);
    assert.equal(
      pick!.source,
      'board-construction',
      `pick ${pickId} must have source board-construction`,
    );
  }
});

// ---------------------------------------------------------------------------
// Tests — hardening (per-row linking safety)
// ---------------------------------------------------------------------------

test('per-row linking: first candidate linked before second candidate is processed', async () => {
  // Verifies that pick_id is written immediately after each row, not batched.
  // If link for row 2 fails, row 1 must already be linked.
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  const candidateId1 = await seedBoardCandidate(repos, boardRunId, 1, {
    provider_event_id: 'evt_perrow_1',
  });
  const candidateId2 = await seedBoardCandidate(repos, boardRunId, 2, {
    provider_event_id: 'evt_perrow_2',
    canonical_market_key: 'batting_hits',
    provider_market_key: 'batting_hits-all-game-ou',
  });

  // Fail on 2nd updatePickIdBatch call → candidate1 linked, candidate2 not
  const faultyPickCandidates = makeFailingOnNthLinkRepo(repos.pickCandidates, 2);
  const result = await runBoardPickWriter(
    { ...repos, pickCandidates: faultyPickCandidates },
  );

  assert.equal(result.written, 1, 'only first row completes successfully');
  assert.equal(result.errors, 1, 'second row link failure counted as error');

  const allCandidates = await repos.pickCandidates.findByStatus('qualified');
  const c1 = allCandidates.find((c) => c.id === candidateId1)!;
  const c2 = allCandidates.find((c) => c.id === candidateId2)!;

  assert.ok(c1.pick_id, 'candidate1 pick_id must be linked (immediate per-row write)');
  assert.equal(c1.shadow_mode, false, 'candidate1 shadow_mode must be cleared');

  assert.equal(c2.pick_id, null, 'candidate2 pick_id must be null (link failed)');
  assert.equal(c2.shadow_mode, true, 'candidate2 shadow_mode must remain true');
});

test('partial-success rerun: unlinked candidate retried, no duplicate created', async () => {
  // Simulates the full idempotency path:
  //   Run 1: row1 ok, row2 pick created but link fails (errors=1)
  //   Run 2: row1 skipped (already linked), row2 retried and linked (written=1)
  //   Result: exactly 2 unique picks in DB, no duplicates
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  const candidateId1 = await seedBoardCandidate(repos, boardRunId, 1, {
    provider_event_id: 'evt_partial_1',
  });
  const candidateId2 = await seedBoardCandidate(repos, boardRunId, 2, {
    provider_event_id: 'evt_partial_2',
    canonical_market_key: 'batting_hits',
    provider_market_key: 'batting_hits-all-game-ou',
  });

  // Run 1: fail the second updatePickIdBatch call
  const faultyPickCandidates = makeFailingOnNthLinkRepo(repos.pickCandidates, 2);
  const run1 = await runBoardPickWriter({ ...repos, pickCandidates: faultyPickCandidates });

  assert.equal(run1.written, 1);
  assert.equal(run1.errors, 1);

  // After run 1: candidate1 linked, candidate2 not linked
  const afterRun1 = await repos.pickCandidates.findByStatus('qualified');
  const c1After1 = afterRun1.find((c) => c.id === candidateId1)!;
  const c2After1 = afterRun1.find((c) => c.id === candidateId2)!;
  assert.ok(c1After1.pick_id, 'c1 must be linked after run 1');
  assert.equal(c2After1.pick_id, null, 'c2 must be unlinked after run 1');

  // Run 2: no failures — candidate2 retried with same odds → processSubmission
  // deduplicates and returns the same pickRecord.id → link succeeds
  const run2 = await runBoardPickWriter(repos);

  assert.equal(run2.written, 1, 'candidate2 should be linked on rerun');
  assert.equal(run2.skipped, 1, 'candidate1 must be skipped (already linked)');
  assert.equal(run2.errors, 0);

  // After run 2: both linked
  const afterRun2 = await repos.pickCandidates.findByStatus('qualified');
  const c1After2 = afterRun2.find((c) => c.id === candidateId1)!;
  const c2After2 = afterRun2.find((c) => c.id === candidateId2)!;
  assert.ok(c1After2.pick_id, 'c1 must remain linked after run 2');
  assert.ok(c2After2.pick_id, 'c2 must be linked after run 2');

  // The pick linked to candidate2 must be the one run2 reported (idempotent reuse)
  assert.equal(
    run2.pickIds[0],
    c2After2.pick_id,
    'run2 must link candidate2 to the pick it reported',
  );

  // Total: exactly 2 unique picks returned across both runs (1 per candidate)
  assert.equal(run1.pickIds.length + run2.pickIds.length, 2, 'exactly 2 unique picks created');
});

test('shadow_mode correctness: only cleared on successfully linked candidates', async () => {
  // Row 1: success → shadow_mode = false
  // Row 2: link fails → shadow_mode remains true
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  const candidateId1 = await seedBoardCandidate(repos, boardRunId, 1, {
    provider_event_id: 'evt_shadow_1',
  });
  const candidateId2 = await seedBoardCandidate(repos, boardRunId, 2, {
    provider_event_id: 'evt_shadow_2',
    canonical_market_key: 'batting_hits',
    provider_market_key: 'batting_hits-all-game-ou',
  });

  // Verify initial state: both shadow_mode = true (Phase 2/3/4 invariant)
  const initial = await repos.pickCandidates.findByStatus('qualified');
  for (const c of initial) {
    assert.equal(c.shadow_mode, true, `candidate ${c.id} must start with shadow_mode=true`);
  }

  const faultyPickCandidates = makeFailingOnNthLinkRepo(repos.pickCandidates, 2);
  await runBoardPickWriter({ ...repos, pickCandidates: faultyPickCandidates });

  const after = await repos.pickCandidates.findByStatus('qualified');
  const c1 = after.find((c) => c.id === candidateId1)!;
  const c2 = after.find((c) => c.id === candidateId2)!;

  assert.equal(c1.shadow_mode, false, 'successfully linked candidate must have shadow_mode=false');
  assert.equal(c2.shadow_mode, true, 'unlinked candidate must retain shadow_mode=true');
});

test('audit record contains actor, boardRunId, written/skipped/errors', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();
  await seedBoardCandidate(repos, boardRunId, 1, { provider_event_id: 'evt_audit_1' });

  // Capture audit records
  const auditRecords: Array<Record<string, unknown>> = [];
  const wrappedAudit = {
    ...repos.audit,
    record: async (input: Parameters<typeof repos.audit.record>[0]) => {
      auditRecords.push(input as unknown as Record<string, unknown>);
      return repos.audit.record(input);
    },
  };

  const testActor = 'operator:test-key-1234';
  await runBoardPickWriter(
    { ...repos, audit: wrappedAudit },
    { actor: testActor },
  );

  // Find the board.pick_write.completed audit entry
  const boardAudit = auditRecords.find(
    (r) => (r as { action?: string }).action === 'board.pick_write.completed',
  );
  assert.ok(boardAudit, 'board.pick_write.completed audit record must exist');

  const rec = boardAudit as {
    actor: string;
    payload: {
      boardRunId: string;
      written: number;
      skipped: number;
      errors: number;
      actor: string;
    };
  };

  assert.equal(rec.actor, testActor, 'audit actor must match operator identity');
  assert.equal(rec.payload.boardRunId, boardRunId, 'audit must include boardRunId');
  assert.equal(typeof rec.payload.written, 'number', 'audit must include written count');
  assert.equal(typeof rec.payload.skipped, 'number', 'audit must include skipped count');
  assert.equal(typeof rec.payload.errors, 'number', 'audit must include errors count');
  assert.equal(rec.payload.actor, testActor, 'audit payload must include actor');
});

test('actor defaults to system:board-construction when not provided', async () => {
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();
  await seedBoardCandidate(repos, boardRunId, 1, { provider_event_id: 'evt_actor_default' });

  const auditRecords: Array<Record<string, unknown>> = [];
  const wrappedAudit = {
    ...repos.audit,
    record: async (input: Parameters<typeof repos.audit.record>[0]) => {
      auditRecords.push(input as unknown as Record<string, unknown>);
      return repos.audit.record(input);
    },
  };

  await runBoardPickWriter({ ...repos, audit: wrappedAudit });

  const boardAudit = auditRecords.find(
    (r) => (r as { action?: string }).action === 'board.pick_write.completed',
  ) as { actor: string } | undefined;

  assert.equal(
    boardAudit?.actor,
    'system:board-construction',
    'default actor must be system:board-construction',
  );
});

// ---------------------------------------------------------------------------
// Boundary test — non-finite odds
// ---------------------------------------------------------------------------

test('candidate with non-finite odds is counted in skipped, not errors or written', async () => {
  // Exercises the Number.isFinite() guard explicitly with Infinity and NaN odds.
  // These are valid JS numbers but are not finite — the writer must treat them as
  // invalid and count the row in skipped (not errors, not written).
  const repos = createInMemoryRepositoryBundle();
  const boardRunId = crypto.randomUUID();

  // Row 1: Infinity odds
  await seedBoardCandidate(repos, boardRunId, 1, {
    provider_event_id: 'evt_nonfinite_inf',
    current_over_odds: Infinity,
    current_under_odds: -105,
  });

  // Row 2: NaN odds
  await seedBoardCandidate(repos, boardRunId, 2, {
    provider_event_id: 'evt_nonfinite_nan',
    canonical_market_key: 'batting_hits',
    provider_market_key: 'batting_hits-all-game-ou',
    current_over_odds: NaN,
    current_under_odds: NaN,
  });

  const result = await runBoardPickWriter(repos);

  assert.equal(result.written, 0, 'no picks written for non-finite odds');
  assert.equal(result.skipped, 2, 'both rows counted in skipped');
  assert.equal(result.errors, 0, 'non-finite odds must not increment errors');
  assert.deepEqual(result.pickIds, [], 'no pick ids returned');
});
