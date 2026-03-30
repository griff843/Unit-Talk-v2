import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestBetsPromotionPolicy,
  type PromotionDecisionSnapshot,
} from '@unit-talk/contracts';
import { replayPromotion } from '@unit-talk/domain';
import { processSubmission } from './submission-service.js';
import { evaluateAndPersistPromotion } from './promotion-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeQualifyingSnapshot(): PromotionDecisionSnapshot {
  return {
    scoringProfile: 'default',
    policyVersion: 'best-bets-v1',
    scoreInputs: {
      edge: 90,
      trust: 85,
      readiness: 80,
      uniqueness: 80,
      boardFit: 75,
    },
    gateInputs: {
      approvalStatus: 'approved',
      hasRequiredFields: true,
      isStale: false,
      withinPostingWindow: true,
      marketStillValid: true,
      riskBlocked: false,
      confidenceFloor: 0.6,
      pickConfidence: 0.72,
    },
    boardStateAtDecision: {
      currentBoardCount: 1,
      sameSportCount: 0,
      sameGameCount: 0,
      duplicateCount: 0,
    },
    weightsUsed: {
      edge: 0.35,
      trust: 0.25,
      readiness: 0.2,
      uniqueness: 0.1,
      boardFit: 0.1,
    },
  };
}

// ── Step 1: replayPromotion reproduces a qualifying decision ──────────────────

test('replayPromotion: returns qualified=true given snapshot that produced a qualifying decision', () => {
  const snapshot = makeQualifyingSnapshot();
  const result = replayPromotion(snapshot, bestBetsPromotionPolicy, '2026-01-01T00:00:00.000Z');

  assert.equal(result.qualified, true);
  assert.equal(result.status, 'qualified');
  assert.equal(result.decidedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(result.decidedBy, 'replay');
  assert.equal(result.version, 'best-bets-v1');
});

test('replayPromotion: score matches expected weighted calculation', () => {
  const snapshot = makeQualifyingSnapshot();
  const result = replayPromotion(snapshot, bestBetsPromotionPolicy);

  // edge=90*0.35 + trust=85*0.25 + readiness=80*0.20 + uniqueness=80*0.10 + boardFit=75*0.10
  // = 31.5 + 21.25 + 16 + 8 + 7.5 = 84.25
  assert.ok(result.score > 70, `score ${result.score} should exceed minimumScore 70`);
  assert.ok(Math.abs(result.score - 84.25) < 0.01, `score ${result.score} should be ~84.25`);
});

// ── Step 2: counterfactual — higher threshold suppresses the same snapshot ────

test('replayPromotion: returns qualified=false when alternate policy has higher minimumScore (counterfactual)', () => {
  const snapshot = makeQualifyingSnapshot();

  // traderInsightsPromotionPolicy requires minimumScore: 80, minimumEdge: 85, minimumTrust: 85
  // The snapshot's trust (85) passes exactly, but the edge score (90) passes too.
  // However, traderInsights uses different weights (edge: 0.40, trust: 0.30, readiness: 0.15, uniqueness: 0.10, boardFit: 0.05)
  // score = 90*0.40 + 85*0.30 + 80*0.15 + 80*0.10 + 75*0.05 = 36 + 25.5 + 12 + 8 + 3.75 = 85.25 >= 80
  // But trader-insights minimumEdge=85 and minimumTrust=85 — both pass at 90 and 85.
  // Use a stricter synthetic policy for counterfactual: minimumScore=90
  const strictPolicy = {
    ...bestBetsPromotionPolicy,
    minimumScore: 90,
    version: 'best-bets-strict-test',
  };

  const result = replayPromotion(snapshot, strictPolicy);

  assert.equal(result.qualified, false);
  // Score ~84.25 is below threshold 90
  assert.ok(result.score < 90, `score ${result.score} should be below minimumScore 90`);
});

test('replayPromotion: snapshot with suppression gate returns qualified=false', () => {
  const snapshot: PromotionDecisionSnapshot = {
    ...makeQualifyingSnapshot(),
    gateInputs: {
      ...makeQualifyingSnapshot().gateInputs,
      approvalStatus: 'pending', // not approved — should be suppressed
    },
  };

  const result = replayPromotion(snapshot, bestBetsPromotionPolicy);
  assert.equal(result.qualified, false);
  assert.ok(
    result.explanation.suppressionReasons.some((r) => r.includes('approval status')),
    'should explain approval status suppression',
  );
});

// ── Step 3: snapshot is stored in pick_promotion_history payload ──────────────

test('snapshot is returned in PromotionEvaluationResult', async () => {
  const repos = createInMemoryRepositoryBundle();

  const subResult = await processSubmission(
    {
      market: 'NBA Moneyline',
      selection: 'Lakers ML',
      source: 'operator',
      metadata: {
        promotionScores: { edge: 90, trust: 85, readiness: 82, uniqueness: 78, boardFit: 75 },
      },
    },
    repos,
  );

  const pickId = subResult.pickRecord.id;
  const evalResult = await evaluateAndPersistPromotion(
    pickId,
    'test-actor',
    repos.picks,
    repos.audit,
    bestBetsPromotionPolicy,
  );

  assert.ok(evalResult.snapshot, 'snapshot should be present on result');
  assert.equal(evalResult.snapshot.scoringProfile, 'default');
  assert.equal(evalResult.snapshot.policyVersion, 'best-bets-v1');
  assert.ok(typeof evalResult.snapshot.scoreInputs.edge === 'number', 'scoreInputs.edge should be a number');
  assert.ok(typeof evalResult.snapshot.gateInputs.approvalStatus === 'string', 'gateInputs.approvalStatus should be a string');
  assert.ok(typeof evalResult.snapshot.boardStateAtDecision.currentBoardCount === 'number');
  assert.equal(evalResult.snapshot.weightsUsed.edge, bestBetsPromotionPolicy.weights.edge);
});

test('snapshot scoreInputs match the score inputs used for the decision', async () => {
  const repos = createInMemoryRepositoryBundle();

  const subResult = await processSubmission(
    {
      market: 'NBA Moneyline',
      selection: 'Celtics ML',
      source: 'operator',
      metadata: {
        promotionScores: { edge: 88, trust: 82, readiness: 79, uniqueness: 76, boardFit: 72 },
      },
    },
    repos,
  );

  const evalResult = await evaluateAndPersistPromotion(
    subResult.pickRecord.id,
    'test-actor',
    repos.picks,
    repos.audit,
    bestBetsPromotionPolicy,
  );

  assert.equal(evalResult.snapshot.scoreInputs.edge, 88);
  assert.equal(evalResult.snapshot.scoreInputs.trust, 82);
  assert.equal(evalResult.snapshot.scoreInputs.readiness, 79);
  assert.equal(evalResult.snapshot.scoreInputs.uniqueness, 76);
  assert.equal(evalResult.snapshot.scoreInputs.boardFit, 72);
});
