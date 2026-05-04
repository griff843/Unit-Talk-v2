/**
 * candidate-pick-scanner.test.ts
 *
 * Verifies:
 *  - happy path: qualified+scored candidate → pick created, pick_id linked, awaiting_approval
 *  - duplicate prevention: candidate with pick_id already set is skipped
 *  - governance brake: pick lifecycle state is awaiting_approval after scan
 *  - no-op: unscored candidates are ignored
 *
 * Uses InMemory repositories — no live DB required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCandidatePickScan } from './candidate-pick-scanner.js';
import {
  InMemoryMarketUniverseRepository,
  InMemoryPickCandidateRepository,
  createInMemoryRepositoryBundle,
} from '@unit-talk/db';
import type { MarketUniverseRow, PickCandidateRow } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Helpers — mirror pattern from candidate-scoring-service.test.ts
// ---------------------------------------------------------------------------

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

function seedCandidateRows(
  repo: InMemoryPickCandidateRepository,
  rows: PickCandidateRow[],
): void {
  const internal = repo as unknown as { rows: Map<string, PickCandidateRow> };
  for (const row of rows) {
    internal.rows.set(row.universe_id, row);
  }
}

function makeUniverseRow(overrides: Partial<MarketUniverseRow> = {}): MarketUniverseRow {
  return {
    id: 'universe-test-1',
    sport_key: 'nba',
    league_key: 'nba',
    event_id: null,
    participant_id: 'participant-test-1',
    market_type_id: 'player_points_ou',
    canonical_market_key: 'player.points',
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

function makeCandidate(overrides: Partial<PickCandidateRow> = {}): PickCandidateRow {
  return {
    id: 'candidate-test-1',
    universe_id: 'universe-test-1',
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
    model_score: 0.62,
    model_tier: 'A',
    model_confidence: 0.72,
    selection_rank: 1,
    is_board_candidate: true,
    shadow_mode: true,
    pick_id: null,
    sport_key: null,
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

test('candidate-pick-scanner: happy path — qualified+scored candidate becomes an awaiting_approval pick', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  const universe = makeUniverseRow();
  const candidate = makeCandidate({ id: 'cand-happy', universe_id: universe.id });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  const result = await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.submitted, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  // Candidate must have pick_id linked
  const qualified = await repos.pickCandidates.findByStatus('qualified');
  const linked = qualified[0];
  assert.ok(linked !== undefined, 'must have a qualified candidate in DB');
  assert.ok(linked.pick_id !== null, 'pick_id must be linked after successful scan');
  assert.equal(linked.shadow_mode, false, 'shadow_mode must be cleared when pick_id is set');

  // Created pick must be in awaiting_approval (governance brake)
  const pickId = linked.pick_id;
  assert.ok(pickId !== null, 'pick_id must not be null');
  const pick = await repos.picks.findPickById(pickId);
  assert.ok(pick, 'pick record must exist in DB');
  assert.equal(pick!.status, 'awaiting_approval', 'governance brake must set status to awaiting_approval');
  assert.equal(pick!.source, 'system-pick-scanner', 'pick source must be system-pick-scanner');
  const metadata = pick!.metadata as Record<string, unknown>;
  assert.equal(metadata['scoredCandidateId'], candidate.id);
  assert.equal(metadata['marketUniverseId'], universe.id);
});

test('candidate-pick-scanner: duplicate prevention — candidate with pick_id already set is skipped', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  const universe = makeUniverseRow({ id: 'universe-dup-1' });
  const candidate = makeCandidate({
    id: 'cand-dup',
    universe_id: 'universe-dup-1',
    pick_id: 'already-linked-pick-id',
  });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  const result = await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  // The candidate has model_score set but pick_id is already set — filter catches it
  assert.equal(result.submitted, 0);
  assert.equal(result.errors, 0);
});

test('candidate-pick-scanner: no-op when no scored candidates exist', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  const universe = makeUniverseRow({ id: 'universe-noscore-1' });
  // model_score is null — must be ignored
  const candidate = makeCandidate({
    id: 'cand-noscore',
    universe_id: 'universe-noscore-1',
    model_score: null,
    model_tier: null,
    model_confidence: null,
  });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  const result = await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  assert.equal(result.scanned, 0, 'unscored candidates must not be counted as scanned');
  assert.equal(result.submitted, 0);
});

// ---------------------------------------------------------------------------
// UTV2-775: Staleness re-check at scan time (AC-4, AC-5)
// ---------------------------------------------------------------------------

test('AC-4: candidate scanner skips stale universe at scan time and increments skipped', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  // Universe is stale at scan time
  const universe = makeUniverseRow({ id: 'universe-stale-ac4', is_stale: true });
  const candidate = makeCandidate({ id: 'cand-stale-ac4', universe_id: 'universe-stale-ac4' });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  const result = await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  assert.equal(result.scanned, 1, 'AC-4: one candidate scanned');
  assert.equal(result.submitted, 0, 'AC-4: processSubmission must NOT be called for stale universe');
  assert.equal(result.skipped, 1, 'AC-4: skipped must be incremented');
  assert.equal(result.errors, 0, 'AC-4: no errors');
});

test('AC-5: candidate provenance updated with stale_at_scan_time: true on skip', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  // Universe is stale at scan time
  const universe = makeUniverseRow({ id: 'universe-stale-ac5', is_stale: true });
  const candidate = makeCandidate({
    id: 'cand-stale-ac5',
    universe_id: 'universe-stale-ac5',
    provenance: { scan_run_id: 'run-original', snapshot_age_ms: 1000 },
  });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  // After the scan, the candidate's provenance should have stale_at_scan_time: true
  const updatedCandidates = await repos.pickCandidates.findByStatus('qualified');
  const updatedCandidate = updatedCandidates.find((c) => c.id === 'cand-stale-ac5');
  assert.ok(updatedCandidate !== undefined, 'AC-5: candidate must still exist');
  const prov = updatedCandidate!.provenance as Record<string, unknown> | null;
  assert.ok(prov !== null, 'AC-5: provenance must not be null');
  assert.equal(prov!['stale_at_scan_time'], true, 'AC-5: stale_at_scan_time must be true');
  assert.equal(prov!['stale_reason'], 'stale_at_scan_time', 'AC-5: stale_reason must be set');
  assert.ok(typeof prov!['stale_checked_at'] === 'string', 'AC-5: stale_checked_at must be set');
});

test('candidate-pick-scanner: skips non-O/U markets that grading cannot settle', async () => {
  const repos = createInMemoryRepositoryBundle();
  const muRepo = repos.marketUniverse as InMemoryMarketUniverseRepository;
  const pcRepo = repos.pickCandidates as InMemoryPickCandidateRepository;

  const universe = makeUniverseRow({
    id: 'universe-moneyline-1',
    canonical_market_key: 'f3_moneyline',
    market_type_id: 'f3_moneyline',
    provider_market_key: 'points-all-1ix3-ml3way',
    participant_id: null,
    provider_participant_id: null,
    current_line: null,
  });
  const candidate = makeCandidate({
    id: 'cand-moneyline',
    universe_id: 'universe-moneyline-1',
  });

  seedUniverseRows(muRepo, [universe]);
  seedCandidateRows(pcRepo, [candidate]);

  const result = await runCandidatePickScan({
    pickCandidates: repos.pickCandidates,
    marketUniverse: repos.marketUniverse,
    picks: repos.picks,
    submissions: repos.submissions,
    audit: repos.audit,
    participants: repos.participants,
    events: repos.events,
    providerOffers: repos.providerOffers,
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.submitted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);

  const qualified = await repos.pickCandidates.findByStatus('qualified');
  const unlinked = qualified.find((row) => row.id === candidate.id);
  assert.equal(unlinked?.pick_id, null, 'unsupported candidate must not link to a pick');
});
