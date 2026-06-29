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
  InMemoryMarketFamilyTrustRepository,
  InMemoryModelRegistryRepository,
  InMemoryParticipantRepository,
  InMemorySystemRunRepository,
  InMemoryAuditLogRepository,
  InMemoryEventRepository,
} from '@unit-talk/db';
import type { MarketUniverseRow, ParticipantRow, PickCandidateRow, EventRow } from '@unit-talk/db';

/** Seed a champion model so scoring doesn't skip for missing champion (Phase 7E fail-closed). */
async function seedChampion(modelRegistry: InMemoryModelRegistryRepository, sport = 'nba', marketFamily = 'player_prop') {
  await modelRegistry.create({
    modelName: 'test-champion',
    version: '1.0.0',
    sport,
    marketFamily,
    status: 'champion',
    registryEntityType: 'champion_model',
    sourceTypeCompatibility: ['board-construction'],
    activeState: 'champion',
    metadata: { confidence: 0.8 },
  });
}

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
    // Use 0.6/0.4 so that computeModelBlend output (~0.54) clears both
    // the SUPPRESS band threshold (edge >= 0.015) and Kelly breakeven (~0.524 at -110).
    fair_over_prob: 0.6,
    fair_under_prob: 0.4,
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
    selection_rank: null,
    is_board_candidate: false,
    shadow_mode: true,
    pick_id: null,
    model_registry_id: null,
    scoring_run_id: null,
    ownership_timestamp: null,
    sport_key: null,
    scan_run_id: 'run-1',
    provenance: null,
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  const now = new Date().toISOString();
  return {
    id: 'participant-1',
    display_name: 'Test Player',
    external_id: 'player-1',
    league: null,
    metadata: {},
    participant_type: 'player',
    sport: 'NBA',
    created_at: now,
    updated_at: now,
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
  const modelRegistry = new InMemoryModelRegistryRepository();
  const runs = new InMemorySystemRunRepository();
  await seedChampion(modelRegistry);

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.6, fair_under_prob: 0.4, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ id: 'candidate-1', universe_id: 'universe-1', status: 'qualified', model_score: null });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, runs });

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
  assert.ok(updated!.model_registry_id, 'model_registry_id should be set');
  assert.ok(updated!.scoring_run_id, 'scoring_run_id should be set');
  assert.ok(updated!.ownership_timestamp, 'ownership_timestamp should be set');

  const scoringRuns = await runs.listByType('candidate.scoring');
  assert.equal(scoringRuns.length, 1);
  const runtimeVersion = (scoringRuns[0]?.details as { runtimeVersion?: { scorerRuntimeVersion?: string } })?.runtimeVersion;
  assert.equal(runtimeVersion?.scorerRuntimeVersion, 'candidate-scoring-ownership-v1');
});

test('scores rejected candidates only when explicitly included for shadow proof', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [
    makeUniverseRow({
      id: 'universe-rejected',
      fair_over_prob: 0.6,
      fair_under_prob: 0.4,
      is_stale: false,
    }),
  ]);
  seedCandidateRows(pickCandidates, [
    makeCandidate({
      id: 'candidate-rejected',
      universe_id: 'universe-rejected',
      status: 'rejected',
      rejection_reason: 'shadow_proof_sample',
      model_score: null,
    }),
  ]);

  const defaultResult = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });
  assert.equal(defaultResult.scored, 0);

  const allBefore = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.equal(allBefore.get('universe-rejected')?.model_score, null);

  const shadowResult = await runCandidateScoring(
    { pickCandidates, marketUniverse, modelRegistry },
    { statuses: ['qualified', 'rejected'] },
  );

  assert.equal(shadowResult.scored, 1);
  const allAfter = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const updated = allAfter.get('universe-rejected');
  assert.ok(updated?.model_score !== null);
  assert.equal(updated?.shadow_mode, true);
  assert.equal(updated?.pick_id, null);
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

test('skips candidates that already have ownership attribution (model_registry_id not null)', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.6, fair_under_prob: 0.4, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({
    id: 'candidate-1',
    universe_id: 'universe-1',
    status: 'qualified',
    model_score: 0.65,
    model_tier: 'B',
    model_confidence: 0.8,
    model_registry_id: 'existing-registry-id',
    scoring_run_id: 'existing-run-id',
    ownership_timestamp: new Date().toISOString(),
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
});

test('re-scores pre-scored candidates that lack ownership attribution', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const runs = new InMemorySystemRunRepository();
  await seedChampion(modelRegistry);

  const universeRow = makeUniverseRow({ id: 'universe-1', fair_over_prob: 0.6, fair_under_prob: 0.4, is_stale: false });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({
    id: 'candidate-1',
    universe_id: 'universe-1',
    status: 'qualified',
    model_score: 0.65,
    model_tier: 'B',
    model_confidence: 0.8,
    model_registry_id: null,
    scoring_run_id: null,
    ownership_timestamp: null,
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, runs });

  assert.equal(result.scored, 1, 'pre-scored candidate without ownership should be attributed');
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const updated = rows.get('universe-1');
  assert.ok(updated?.model_registry_id !== null, 'model_registry_id should be set');
  assert.ok(updated?.scoring_run_id !== null, 'scoring_run_id should be set');
  assert.ok(updated?.ownership_timestamp !== null, 'ownership_timestamp should be set');
});

// ---------------------------------------------------------------------------
// UTV2-501: Runtime proof — trust data changes scoring output
// ---------------------------------------------------------------------------

test('P7C runtime proof: trust data with sufficient sample adjusts model_score', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const marketFamilyTrust = new InMemoryMarketFamilyTrustRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry);

  const universeRow = makeUniverseRow({ market_type_id: 'player_points_ou' });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({ universe_id: 'universe-1' });
  seedCandidateRows(pickCandidates, [candidate]);

  // Run scoring WITHOUT trust data
  const baseResult = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });
  assert.equal(baseResult.scored, 1);
  assert.equal(baseResult.trustAdjusted, 0);

  const baseScoredRows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const baseScore = [...baseScoredRows.values()][0]!.model_score;
  assert.ok(typeof baseScore === 'number' && baseScore > 0, 'base score should be positive');

  // Reset candidate for re-scoring
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-1' })]);

  // Seed trust data: high win rate (0.65) with sufficient sample (10)
  await marketFamilyTrust.insertTuningRun([{
    tuning_run_id: 'trust-run-1',
    market_type_id: 'player_points_ou',
    sport_key: 'nba',
    sample_size: 10,
    win_count: 65,
    loss_count: 35,
    push_count: 0,
    win_rate: 0.65,
    roi: 0.08,
    avg_model_score: 0.62,
    confidence_band: 'B',
    metadata: {},
  }]);

  // Run scoring WITH trust data
  const trustResult = await runCandidateScoring({ pickCandidates, marketUniverse, marketFamilyTrust, modelRegistry });
  assert.equal(trustResult.scored, 1);
  assert.equal(trustResult.trustAdjusted, 1, 'trust adjustment should fire');

  const trustScoredRows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const trustScore = [...trustScoredRows.values()][0]!.model_score;
  assert.ok(typeof trustScore === 'number' && trustScore > 0, 'trust score should be positive');
  assert.notEqual(trustScore, baseScore, 'trust-adjusted score should differ from base score');
});

test('P7C runtime proof: insufficient sample trust data leaves scoring inert', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const marketFamilyTrust = new InMemoryMarketFamilyTrustRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow({ market_type_id: 'player_points_ou' })]);
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-1' })]);

  // Seed trust with sample_size=2 (below MIN_TRUST_SAMPLE_SIZE=5)
  await marketFamilyTrust.insertTuningRun([{
    tuning_run_id: 'trust-run-low',
    market_type_id: 'player_points_ou',
    sport_key: 'nba',
    sample_size: 2,
    win_count: 2,
    loss_count: 0,
    push_count: 0,
    win_rate: 1.0,
    roi: 0.5,
    avg_model_score: null,
    confidence_band: null,
    metadata: {},
  }]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, marketFamilyTrust, modelRegistry });
  assert.equal(result.scored, 1);
  assert.equal(result.trustAdjusted, 0, 'insufficient sample should not trigger adjustment');
});

test('P7C runtime proof: missing trust repo leaves scoring inert', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-1' })]);

  // No marketFamilyTrust passed — undefined, but champion exists so scoring proceeds
  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });
  assert.equal(result.scored, 1);
  assert.equal(result.trustAdjusted, 0, 'no trust repo means no adjustment');
});

test('P7E: missing champion model skips candidate fail-closed', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  // No modelRegistry — all candidates should be skipped

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-1' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });
  assert.equal(result.scored, 0, 'no champion → no scoring');
  assert.equal(result.noChampionSkipped, 1, 'candidate skipped for missing champion');
  assert.equal(result.skipped, 1);
});

test('UTV2-634: fresh confirmed availability keeps player-prop scoring live', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const participants = new InMemoryParticipantRepository([
    makeParticipant({
      metadata: {
        availability: {
          source: 'sportsdata',
          status: 'confirmed',
          lastUpdatedAt: new Date().toISOString(),
        },
      },
    }),
  ]);
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({
    pickCandidates,
    marketUniverse,
    modelRegistry,
    participants,
  });

  assert.equal(result.scored, 1);
  assert.equal(result.availabilityAdjusted, 0);
  assert.equal(result.availabilityNoDataSkipped, 0);
});

test('UTV2-634: missing availability data skips player-prop candidates distinctly', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const participants = new InMemoryParticipantRepository([makeParticipant()]);
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({
    pickCandidates,
    marketUniverse,
    modelRegistry,
    participants,
  });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.availabilityNoDataSkipped, 1);
});

test('UTV2-634: questionable availability reduces model confidence from real participant metadata', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const participants = new InMemoryParticipantRepository([
    makeParticipant({
      metadata: {
        availability: {
          source: 'sportsdata',
          status: 'questionable',
          lastUpdatedAt: new Date().toISOString(),
          injuryNote: 'Hamstring',
        },
      },
    }),
  ]);
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({
    pickCandidates,
    marketUniverse,
    modelRegistry,
    participants,
  });

  assert.equal(result.scored, 1);
  assert.equal(result.availabilityAdjusted, 1);

  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const updated = rows.get('universe-1');
  assert.ok(updated, 'candidate should be updated');
  assert.ok(updated.model_confidence !== null);
  assert.ok(updated.model_confidence < 0.8);
});

test('UTV2-634: out availability suppresses scoring instead of degrading silently', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const participants = new InMemoryParticipantRepository([
    makeParticipant({
      metadata: {
        availability: {
          source: 'sportsdata',
          status: 'out',
          lastUpdatedAt: new Date().toISOString(),
        },
      },
    }),
  ]);
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({
    pickCandidates,
    marketUniverse,
    modelRegistry,
    participants,
  });

  assert.equal(result.scored, 0);
  assert.equal(result.availabilitySuppressed, 1);
});

test('rejects scoring when the resolved registry owner has an invalid entity type', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();

  await modelRegistry.create({
    modelName: 'bad-owner',
    version: '1.0.0',
    sport: 'nba',
    marketFamily: 'player_prop',
    status: 'champion',
    registryEntityType: 'heuristic_system',
    sourceTypeCompatibility: ['board-construction'],
    activeState: 'champion',
    metadata: { confidence: 0.8 },
  });

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });

  assert.equal(result.scored, 0);
  assert.equal(result.errors, 1);
  assert.equal(result.invalidEntityTypeRejected, 1);
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.equal(rows.get('universe-1')?.model_score, null);
});

test('persists ownership but quarantines degraded registry ownership', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();

  await modelRegistry.create({
    modelName: 'degraded-owner',
    version: '1.0.0',
    sport: 'nba',
    marketFamily: 'player_prop',
    status: 'champion',
    registryEntityType: 'champion_model',
    sourceTypeCompatibility: ['board-construction'],
    activeState: 'degraded',
    metadata: { confidence: 0.8 },
  });

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });

  assert.equal(result.scored, 1);
  assert.equal(result.degradedOwnership, 1);
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.ok(rows.get('universe-1')?.model_registry_id);
});

// ---------------------------------------------------------------------------
// UTV2-905 regression — champion lookup path (source_type + marketFamily guards)
// ---------------------------------------------------------------------------

test('candidate is skipped when universe has null market_type_id (market_type_id_null path)', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry);

  seedUniverseRows(marketUniverse, [makeUniverseRow({ market_type_id: null })]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 1);
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.equal(rows.get('universe-1')?.model_registry_id, null);
});

test('candidate is skipped when no champion exists for sport+marketFamily (missing_registry_owner path)', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();

  seedUniverseRows(marketUniverse, [makeUniverseRow({ sport_key: 'mlb', market_type_id: 'player_hits_ou' })]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });

  assert.equal(result.scored, 0);
  assert.equal(result.skipped, 1);
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.equal(rows.get('universe-1')?.model_registry_id, null);
});

test('board-construction champion is matched for nba player_prop (source_type gate confirms intentional)', async () => {
  const pickCandidates = new InMemoryPickCandidateRepository();
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  await seedChampion(modelRegistry, 'nba', 'player_prop');

  seedUniverseRows(marketUniverse, [makeUniverseRow()]);
  seedCandidateRows(pickCandidates, [makeCandidate()]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry });

  assert.equal(result.scored, 1);
  assert.equal(result.skipped, 0);
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  assert.ok(rows.get('universe-1')?.model_registry_id, 'model_registry_id should be set when board-construction champion exists');
});

// ---------------------------------------------------------------------------
// UTV2-1202: both-sides fair probability guard
// ---------------------------------------------------------------------------

test('UTV2-1202: skips candidate when fair_over_prob is set but fair_under_prob is null', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  // Partial fair prob: over set, under null — must be skipped (not scored, not promoted)
  const universeRow = makeUniverseRow({
    id: 'universe-partial-prob',
    fair_over_prob: 0.62,
    fair_under_prob: null,
    is_stale: false,
  });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({
    id: 'candidate-partial-prob',
    universe_id: 'universe-partial-prob',
    status: 'qualified',
    model_score: null,
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0, 'candidate with one-sided fair prob must not be scored');
  assert.equal(result.skipped, 1, 'candidate with one-sided fair prob must be skipped');
  assert.equal(result.errors, 0);

  // Confirm the row was not mutated (model_score remains null)
  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const row = rows.get('universe-partial-prob');
  assert.equal(row?.model_score, null, 'model_score must remain null for skipped candidate');
  assert.equal(row?.pick_id, null, 'pick_id must remain null');
  assert.equal(row?.shadow_mode, true, 'shadow_mode must remain true');
});

test('UTV2-1202: skips candidate when fair_under_prob is set but fair_over_prob is null', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();

  // Partial fair prob: under set, over null — must be skipped
  const universeRow = makeUniverseRow({
    id: 'universe-partial-prob-under',
    fair_over_prob: null,
    fair_under_prob: 0.58,
    is_stale: false,
  });
  seedUniverseRows(marketUniverse, [universeRow]);

  const candidate = makeCandidate({
    id: 'candidate-partial-prob-under',
    universe_id: 'universe-partial-prob-under',
    status: 'qualified',
    model_score: null,
  });
  seedCandidateRows(pickCandidates, [candidate]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse });

  assert.equal(result.scored, 0, 'candidate with one-sided fair prob must not be scored');
  assert.equal(result.skipped, 1, 'candidate with one-sided fair prob must be skipped');
  assert.equal(result.errors, 0);

  const rows = (pickCandidates as unknown as { rows: Map<string, PickCandidateRow> }).rows;
  const row = rows.get('universe-partial-prob-under');
  assert.equal(row?.model_score, null, 'model_score must remain null for skipped candidate');
});

// ---------------------------------------------------------------------------
// UTV2-1364: Candidate quality gates — scoring service
// ---------------------------------------------------------------------------

function makeEventRow(overrides: Partial<EventRow> = {}): EventRow {
  const now = new Date().toISOString();
  return {
    id: 'event-1',
    sport_id: 'nba',
    event_name: 'Test NBA Game',
    event_date: '2020-01-01', // past date — triggers postgame gate
    status: 'completed',
    external_id: null,
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

test('UTV2-1364 Gate 3 (scorer): stale universe logs candidate.rejected to audit', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const audit = new InMemoryAuditLogRepository();

  const universeRow = makeUniverseRow({ id: 'universe-stale', is_stale: true });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ id: 'candidate-stale', universe_id: 'universe-stale' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, audit });

  assert.equal(result.skipped, 1);
  assert.equal(result.qualityGateRejected, 1);

  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.payload as Record<string, unknown>)['reason'], 'stale_odds_data');
});

test('UTV2-1364 Gate 4: postgame event rejects candidate with audit log', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const audit = new InMemoryAuditLogRepository();
  const events = new InMemoryEventRepository([makeEventRow()]);

  // Universe with event_id pointing to a past event
  const universeRow = makeUniverseRow({
    id: 'universe-postgame',
    event_id: 'event-1',
    is_stale: false,
    fair_over_prob: 0.6,
    fair_under_prob: 0.4,
  });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ id: 'candidate-postgame', universe_id: 'universe-postgame' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, audit, events });

  assert.equal(result.skipped, 1);
  assert.equal(result.qualityGateRejected, 1);

  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.payload as Record<string, unknown>)['reason'], 'postgame_candidate');
});

test('UTV2-1364 Gate 4: future event date does NOT trigger postgame rejection', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const audit = new InMemoryAuditLogRepository();
  // Future event date (well past today to avoid flakiness)
  const events = new InMemoryEventRepository([makeEventRow({ event_date: '2099-12-31' })]);
  await seedChampion(modelRegistry);

  const universeRow = makeUniverseRow({
    id: 'universe-future',
    event_id: 'event-1',
    is_stale: false,
    fair_over_prob: 0.6,
    fair_under_prob: 0.4,
  });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-future' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, audit, events });

  assert.equal(result.qualityGateRejected, 0, 'future event must not trigger postgame gate');
  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 0);
});

test('UTV2-1364 Gate 5: SUPPRESS band rejects candidate with audit log', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const audit = new InMemoryAuditLogRepository();
  await seedChampion(modelRegistry);

  // fair_over_prob = 0.51 → p_market_devig = 0.51 → model_score ≈ 0.51
  // edge = 0.01 < 0.015 (C threshold) → SUPPRESS band
  const universeRow = makeUniverseRow({
    id: 'universe-suppress',
    fair_over_prob: 0.51,
    fair_under_prob: 0.49,
    is_stale: false,
    current_over_odds: -110,
    current_under_odds: -110,
  });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ id: 'candidate-suppress', universe_id: 'universe-suppress' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, audit });

  assert.equal(result.skipped, 1);
  assert.equal(result.qualityGateRejected, 1, 'SUPPRESS band must be rejected by Gate 5');

  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.payload as Record<string, unknown>)['reason'], 'suppress_band');
});

test('UTV2-1364 Gate 2: Kelly<=0 rejects candidate with audit log', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const audit = new InMemoryAuditLogRepository();
  await seedChampion(modelRegistry);

  // fair_over_prob = 0.575 → p_market_devig = 0.575
  // model_score = 0.9 * 0.575 = 0.5175 → edge = 0.0175 >= 0.015 → C band (not SUPPRESS)
  // Kelly at -110 odds: breakeven ≈ 0.524; 0.5175 < 0.524 → Kelly < 0 → Gate 2 fires
  const universeRow = makeUniverseRow({
    id: 'universe-kelly-zero',
    fair_over_prob: 0.575,
    fair_under_prob: 0.425,
    is_stale: false,
    current_over_odds: -110,
    current_under_odds: -110,
  });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ id: 'candidate-kelly-zero', universe_id: 'universe-kelly-zero' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, audit });

  assert.equal(result.skipped, 1);
  assert.equal(result.qualityGateRejected, 1, 'Kelly<=0 must be rejected by Gate 2');

  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 1);
  assert.equal((entries[0]!.payload as Record<string, unknown>)['reason'], 'kelly_zero_no_positive_ev');
});

test('UTV2-1364 Gate 2: positive Kelly passes through (no rejection)', async () => {
  const marketUniverse = new InMemoryMarketUniverseRepository();
  const pickCandidates = new InMemoryPickCandidateRepository();
  const modelRegistry = new InMemoryModelRegistryRepository();
  const audit = new InMemoryAuditLogRepository();
  await seedChampion(modelRegistry);

  // fair_over_prob = 0.6 → p_market_devig = 0.6
  // model_score = 0.9 * 0.6 = 0.54 → edge = 0.04 → B band (not SUPPRESS)
  // Kelly at -110: (0.909 * 0.54 - 0.46) / 0.909 ≈ 0.034 > 0 → passes Gate 2
  const universeRow = makeUniverseRow({
    id: 'universe-positive-kelly',
    fair_over_prob: 0.6,
    fair_under_prob: 0.4,
    is_stale: false,
    current_over_odds: -110,
    current_under_odds: -110,
  });
  seedUniverseRows(marketUniverse, [universeRow]);
  seedCandidateRows(pickCandidates, [makeCandidate({ universe_id: 'universe-positive-kelly' })]);

  const result = await runCandidateScoring({ pickCandidates, marketUniverse, modelRegistry, audit });

  assert.equal(result.qualityGateRejected, 0, 'positive Kelly must not be rejected');
  const entries = await audit.listRecentByEntityType('pick_candidates', new Date(0).toISOString(), 'candidate.rejected');
  assert.equal(entries.length, 0, 'no audit entries for valid candidate');
});
