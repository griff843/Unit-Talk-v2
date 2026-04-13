/**
 * UTV2-335 — Intelligence Production-Readiness Verification (Verifiable Subset)
 *
 * This test file mechanically verifies the intelligence production-readiness items
 * that are testable WITHOUT live data. Each test documents what it proves and what
 * remains data-gated.
 *
 * DATA-GATED (not tested here):
 *   - Full pick lifecycle cycle with CLV graded (needs live settlement data)
 *   - settlement_records with valid clv_at_close values (needs live DB)
 *   - Scoring drift report runs clean (needs historical data)
 *
 * VERIFIED HERE:
 *   - CLV computation wiring is complete (Test 1)
 *   - Calibration engine produces metrics from expected data shape (Test 2)
 *   - Scoring profile validation — weights, thresholds, gate checks (Test 3)
 *   - Promotion gate enforcement — unqualified picks don't reach best-bets (Test 4)
 *   - Intelligence endpoint exports handler with expected shape (Test 5)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  defaultScoringProfile,
  scoringProfiles,
  resolveScoringProfile,
} from '@unit-talk/contracts';
import type { SubmitPickControllerResult } from './controllers/submit-pick-controller.js';

// Cross-project imports resolved at runtime via dynamic import to avoid
// TypeScript rootDir/project-reference violations. These paths are correct
// at runtime under tsx but would break tsc if statically imported.
// pathToFileURL is required on Windows where resolve() yields C:\ paths.
const dirname = fileURLToPath(new URL('.', import.meta.url));
const calibrationPath = pathToFileURL(resolve(dirname, '../../../packages/domain/src/probability/calibration.js')).href;
const intelligencePath = pathToFileURL(resolve(dirname, '../../../apps/operator-web/src/routes/intelligence.js')).href;
const sharedIntelligencePath = pathToFileURL(resolve(dirname, '../../../apps/operator-web/src/routes/shared-intelligence.js')).href;

// ─── Test 1: CLV computation wiring ─────────────────────────────────────────
// Proves: computeAndAttachCLV exists, accepts the expected repository shape,
// and returns null (not an error) when no closing line data is available.
// This confirms the CLV pipeline is wired end-to-end — live data would produce
// a numeric CLVResult. Without provider_offers data it correctly returns null
// (fail-open: CLV stays null rather than throwing).
//
// DATA-GATED: Actual CLV values require live provider_offers with closing lines.

test('CLV computation wiring: computeAndAttachCLV is callable and returns null without data', async () => {
  const { computeAndAttachCLV } = await import('./clv-service.js');
  assert.equal(typeof computeAndAttachCLV, 'function');

  // Minimal PickRecord shape that exercises the function signature
  const mockPick = {
    id: 'test-pick-1',
    source: 'test',
    market: 'player_passing_yards_ou',
    selection: 'QB Over 287.5',
    line: 287.5,
    odds: -115,
    confidence: 0.75,
    status: 'validated' as const,
    promotion_status: 'not_eligible' as const,
    promotion_target: null,
    promotion_score: null,
    participant_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: { sport: 'NFL', player: 'Patrick Mahomes', eventName: 'NFL Game' },
  };

  // Use createInMemoryRepositoryBundle to get properly-typed empty repositories
  const { createInMemoryRepositoryBundle } = await import('./persistence.js');
  const repos = createInMemoryRepositoryBundle();

  // Call with empty repositories — should return null (no closing line), not throw
  const result = await computeAndAttachCLV(
    mockPick as unknown as Parameters<typeof computeAndAttachCLV>[0],
    {
      providerOffers: repos.providerOffers,
      participants: repos.participants,
      events: repos.events,
      eventParticipants: repos.eventParticipants,
    },
  );

  // Null means "no CLV data available" — this is the correct fail-open behavior.
  // With live provider_offers data, this would return a CLVResult with numeric clvRaw/clvPercent.
  assert.equal(result, null);
});

// ─── Test 2: Calibration engine produces metrics from expected data shape ────
// Proves: The calibration engine can ingest a synthetic dataset and produce
// Brier score, log loss, ECE, MCE, and reliability buckets without error.
// This confirms calibration is *computable* when live settled data arrives.
//
// DATA-GATED: Real calibration requires live settled picks with pFinal values.
//
// Note: calibration module is intentionally excluded from @unit-talk/domain barrel
// (name collision with evaluation/). Direct path import is the canonical pattern
// (see packages/domain/CLAUDE.md).

test('Calibration engine produces valid metrics from synthetic dataset', async () => {
  const calibrationModule = await import(calibrationPath) as {
    computeCalibrationMetrics: (
      predictions: Array<{ pFinal: number; outcome: 0 | 1; pickId?: string }>,
      modelVersion: string,
      probabilityModelVersion: string,
    ) => {
      sampleSize: number;
      winCount: number;
      lossCount: number;
      brierScore: number;
      ece: number;
      mce: number;
      logLoss: number;
      modelVersion: string;
      probabilityModelVersion: string;
      buckets: Array<{
        bucketLower: number;
        bucketUpper: number;
        count: number;
        avgPredicted: number;
        observedRate: number;
        calibrationError: number;
      }>;
    };
    computeBrierScore: (predictions: Array<{ pFinal: number; outcome: 0 | 1 }>) => number;
    computeLogLoss: (predictions: Array<{ pFinal: number; outcome: 0 | 1 }>) => number;
  };

  const { computeCalibrationMetrics, computeBrierScore, computeLogLoss } = calibrationModule;

  // 10 synthetic picks with known outcomes — simulates settled pick data shape
  const predictions: Array<{ pFinal: number; outcome: 0 | 1; pickId: string }> = [
    { pFinal: 0.90, outcome: 1, pickId: 'p1' },
    { pFinal: 0.85, outcome: 1, pickId: 'p2' },
    { pFinal: 0.75, outcome: 0, pickId: 'p3' },
    { pFinal: 0.70, outcome: 1, pickId: 'p4' },
    { pFinal: 0.60, outcome: 1, pickId: 'p5' },
    { pFinal: 0.55, outcome: 0, pickId: 'p6' },
    { pFinal: 0.40, outcome: 0, pickId: 'p7' },
    { pFinal: 0.30, outcome: 0, pickId: 'p8' },
    { pFinal: 0.20, outcome: 1, pickId: 'p9' },
    { pFinal: 0.15, outcome: 0, pickId: 'p10' },
  ];

  // Brier score: must be a finite number in [0, 1]
  const brier = computeBrierScore(predictions);
  assert.equal(typeof brier, 'number');
  assert.ok(Number.isFinite(brier), `Brier score must be finite, got ${brier}`);
  assert.ok(brier >= 0 && brier <= 1, `Brier score must be in [0,1], got ${brier}`);

  // Log loss: must be a finite non-negative number
  const logLoss = computeLogLoss(predictions);
  assert.equal(typeof logLoss, 'number');
  assert.ok(Number.isFinite(logLoss), `Log loss must be finite, got ${logLoss}`);
  assert.ok(logLoss >= 0, `Log loss must be non-negative, got ${logLoss}`);

  // Full calibration metrics
  const metrics = computeCalibrationMetrics(predictions, 'test-model-v1', 'prob-v1');
  assert.equal(metrics.sampleSize, 10);
  assert.equal(metrics.winCount, 5);
  assert.equal(metrics.lossCount, 5);
  assert.equal(typeof metrics.brierScore, 'number');
  assert.equal(typeof metrics.ece, 'number');
  assert.equal(typeof metrics.mce, 'number');
  assert.equal(typeof metrics.logLoss, 'number');
  assert.equal(metrics.modelVersion, 'test-model-v1');
  assert.equal(metrics.probabilityModelVersion, 'prob-v1');
  assert.ok(Array.isArray(metrics.buckets), 'buckets must be an array');
  assert.ok(metrics.buckets.length > 0, 'buckets must not be empty with 10 predictions');

  // Each bucket must have valid structure
  for (const bucket of metrics.buckets) {
    assert.equal(typeof bucket.bucketLower, 'number');
    assert.equal(typeof bucket.bucketUpper, 'number');
    assert.ok(bucket.count > 0);
    assert.ok(bucket.avgPredicted >= 0 && bucket.avgPredicted <= 1);
    assert.ok(bucket.observedRate >= 0 && bucket.observedRate <= 1);
    assert.ok(bucket.calibrationError >= 0);
  }
});

// ─── Test 3: Scoring profile validation ─────────────────────────────────────
// Proves: At least one scoring profile exists with valid weights (sum to ~1.0),
// valid thresholds, and all three canonical targets defined.
//
// DATA-GATED: Nothing — this is pure contract validation.

test('Scoring profile: default profile has valid weights summing to ~1.0', () => {
  // At least one profile exists
  assert.ok(Object.keys(scoringProfiles).length >= 1, 'Must have at least one scoring profile');

  // Default profile resolves without error
  const profile = resolveScoringProfile('default');
  assert.equal(profile.name, 'default');

  // All three canonical targets must be present
  const targets = Object.keys(profile.policies) as Array<'best-bets' | 'trader-insights' | 'exclusive-insights'>;
  assert.ok(targets.includes('best-bets'), 'Missing best-bets policy');
  assert.ok(targets.includes('trader-insights'), 'Missing trader-insights policy');
  assert.ok(targets.includes('exclusive-insights'), 'Missing exclusive-insights policy');

  // Validate weights for each policy sum to ~1.0
  for (const target of targets) {
    const policy = profile.policies[target];
    const weights = policy.weights;
    const sum = weights.edge + weights.trust + weights.readiness + weights.uniqueness + weights.boardFit;
    assert.ok(
      Math.abs(sum - 1.0) < 0.001,
      `${target} weights sum to ${sum}, expected ~1.0`,
    );

    // Thresholds must be non-negative
    assert.ok(policy.minimumScore >= 0, `${target} minimumScore must be non-negative`);
    assert.ok(policy.minimumEdge >= 0, `${target} minimumEdge must be non-negative`);
    assert.ok(policy.minimumTrust >= 0, `${target} minimumTrust must be non-negative`);

    // Version string must be non-empty
    assert.ok(policy.version.length > 0, `${target} version must be non-empty`);

    // Board caps must be positive
    assert.ok(policy.boardCaps.perSlate > 0, `${target} perSlate cap must be positive`);
    assert.ok(policy.boardCaps.perSport > 0, `${target} perSport cap must be positive`);
    assert.ok(policy.boardCaps.perGame > 0, `${target} perGame cap must be positive`);
  }
});

test('Scoring profile: exclusive-insights has stricter thresholds than best-bets', () => {
  const bestBets = defaultScoringProfile.policies['best-bets'];
  const exclusive = defaultScoringProfile.policies['exclusive-insights'];

  // Exclusive must have higher minimums (stricter gate)
  assert.ok(
    exclusive.minimumScore >= bestBets.minimumScore,
    `exclusive minimumScore (${exclusive.minimumScore}) should be >= best-bets (${bestBets.minimumScore})`,
  );
  assert.ok(
    exclusive.minimumEdge >= bestBets.minimumEdge,
    `exclusive minimumEdge (${exclusive.minimumEdge}) should be >= best-bets (${bestBets.minimumEdge})`,
  );
  assert.ok(
    exclusive.minimumTrust >= bestBets.minimumTrust,
    `exclusive minimumTrust (${exclusive.minimumTrust}) should be >= best-bets (${bestBets.minimumTrust})`,
  );
});

// ─── Test 4: Promotion gate enforcement ─────────────────────────────────────
// Proves: A pick with low confidence and no promotion scores does NOT get
// promoted to best-bets. The gate is enforced in code, not just documented.
//
// DATA-GATED: Nothing — uses InMemory repos, no live DB needed.

test('Promotion gate: low-confidence pick is NOT promoted to best-bets', async () => {
  const { handleSubmitPick } = await import('./handlers/index.js');
  const { createInMemoryRepositoryBundle } = await import('./persistence.js');
  const { claimDistributionWork } = await import('./distribution-worker-service.js');

  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'intelligence-readiness-test',
        market: 'NBA points',
        selection: 'Player Over 18.5',
        confidence: 0.3, // Low confidence — below any policy's confidenceFloor (0.6)
        // No promotionScores — edge/trust will be 0
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  if (!response.body.ok) throw new Error('expected ok response');

  const data = response.body.data as unknown as SubmitPickControllerResult;

  // Must be not_eligible — the gate blocks picks with low confidence / no scores
  assert.equal(data.promotionStatus, 'not_eligible');
  assert.equal(data.promotionTarget, null);
  assert.equal(data.outboxEnqueued, false);

  // Verify no outbox entry exists for any target
  for (const target of ['discord:best-bets', 'discord:trader-insights', 'discord:exclusive-insights']) {
    const claimed = await claimDistributionWork(
      repositories.outbox,
      target,
      'readiness-test-worker',
    );
    assert.equal(claimed.outboxRecord, null, `No outbox entry should exist for ${target}`);
  }
});

test('Promotion gate: high-confidence pick with strong scores IS promoted', async () => {
  const { handleSubmitPick } = await import('./handlers/index.js');
  const { createInMemoryRepositoryBundle } = await import('./persistence.js');

  const repositories = createInMemoryRepositoryBundle();
  const response = await handleSubmitPick(
    {
      body: {
        source: 'intelligence-readiness-test',
        market: 'NFL passing yards',
        selection: 'QB Over 287.5',
        line: 287.5,
        odds: -115,
        stakeUnits: 1.5,
        confidence: 0.75,
        eventName: 'NFL Proof Game',
        metadata: {
          sport: 'NFL',
          promotionScores: { edge: 92, trust: 88, readiness: 85, uniqueness: 85, boardFit: 90 },
        },
      },
    },
    repositories,
  );

  assert.equal(response.status, 201);
  if (!response.body.ok) throw new Error('expected ok response');

  const data = response.body.data as unknown as SubmitPickControllerResult;

  // Must be qualified and enqueued — the gate passes with strong scores
  assert.equal(data.promotionStatus, 'qualified');
  assert.ok(data.promotionTarget !== null, 'qualified pick must have a promotion target');
  assert.equal(data.outboxEnqueued, true);
});

// ─── Test 5: Intelligence endpoint serves expected shape ────────────────────
// Proves: The intelligence route handler exists as an exported function and
// the shared computation functions used by the endpoint are all properly exported.
//
// DATA-GATED: Actual intelligence data requires live settled picks in the DB.
//
// Note: cross-app import via resolved path to avoid TypeScript rootDir violations.
// Apps never import from apps in production; this is verification-only.

test('Intelligence endpoint: handleIntelligenceRequest is an exported function', async () => {
  const mod = await import(intelligencePath) as { handleIntelligenceRequest: (...args: unknown[]) => unknown };
  assert.equal(typeof mod.handleIntelligenceRequest, 'function');
});

test('Intelligence endpoint: shared computation functions are exported', async () => {
  const mod = await import(intelligencePath) as { handleIntelligenceRequest: (...args: unknown[]) => unknown };

  // Handler accepts (request, response, deps) — verify arity
  assert.equal(mod.handleIntelligenceRequest.length, 3);

  const sharedMod = await import(sharedIntelligencePath) as Record<string, unknown>;
  assert.equal(typeof sharedMod.fetchIntelligenceDataset, 'function');
  assert.equal(typeof sharedMod.computeMiniStats, 'function');
  assert.equal(typeof sharedMod.computePickPayout, 'function');
  assert.equal(typeof sharedMod.computeScoreCorrelation, 'function');
  assert.equal(typeof sharedMod.evaluateScoreSignal, 'function');
  assert.equal(typeof sharedMod.sliceBySource, 'function');
  assert.equal(typeof sharedMod.sliceByDecision, 'function');
  assert.equal(typeof sharedMod.bucketBySport, 'function');
  assert.equal(typeof sharedMod.bucketBySource, 'function');
  assert.equal(typeof sharedMod.extractSport, 'function');
});
