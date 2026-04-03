import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestBetsScoreWeights,
  bestBetsPromotionPolicy,
  traderInsightsPromotionPolicy,
  exclusiveInsightsPromotionPolicy,
  defaultScoringProfile,
  conservativeScoringProfile,
  resolveScoringProfile,
} from '@unit-talk/contracts';
import { evaluatePromotionEligibility } from '@unit-talk/domain';
import { processSubmission } from './submission-service.js';
import { evaluateAndPersistPromotion } from './promotion-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import type { BoardPromotionEvaluationInput } from '@unit-talk/contracts';

// ── Step 1: PromotionPolicy.weights field exists on all policies ──────────────

test('bestBetsPromotionPolicy carries bestBetsScoreWeights', () => {
  assert.deepEqual(bestBetsPromotionPolicy.weights, bestBetsScoreWeights);
});

test('traderInsightsPromotionPolicy carries its own weights (edge: 0.40)', () => {
  assert.equal(traderInsightsPromotionPolicy.weights.edge, 0.40);
  assert.equal(traderInsightsPromotionPolicy.weights.trust, 0.30);
  assert.equal(traderInsightsPromotionPolicy.weights.readiness, 0.15);
  assert.equal(traderInsightsPromotionPolicy.weights.uniqueness, 0.10);
  assert.equal(traderInsightsPromotionPolicy.weights.boardFit, 0.05);
});

test('exclusiveInsightsPromotionPolicy carries its own weights (edge: 0.45)', () => {
  assert.equal(exclusiveInsightsPromotionPolicy.weights.edge, 0.45);
  assert.equal(exclusiveInsightsPromotionPolicy.weights.trust, 0.30);
  assert.equal(exclusiveInsightsPromotionPolicy.weights.readiness, 0.10);
  assert.equal(exclusiveInsightsPromotionPolicy.weights.uniqueness, 0.10);
  assert.equal(exclusiveInsightsPromotionPolicy.weights.boardFit, 0.05);
});

// ── Step 2: calculateScore uses policy.weights, not hardcoded bestBets ────────

function makeBaseInput(
  policy: typeof bestBetsPromotionPolicy,
): BoardPromotionEvaluationInput {
  return {
    target: policy.target,
    pick: {
      id: 'test-pick',
      submissionId: 'sub-1',
      market: 'NBA points',
      selection: 'Player Over 22.5',
      source: 'api',
      approvalStatus: 'approved',
      promotionStatus: 'not_eligible',
      lifecycleState: 'validated',
      metadata: {},
      createdAt: new Date().toISOString(),
    },
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    scoreInputs: { edge: 90, trust: 90, readiness: 80, uniqueness: 84, boardFit: 89 },
    minimumScore: policy.minimumScore,
    confidenceFloor: policy.confidenceFloor,
    boardCaps: policy.boardCaps,
    boardState: { currentBoardCount: 0, sameSportCount: 0, sameGameCount: 0, duplicateCount: 0 },
    decidedAt: new Date().toISOString(),
    decidedBy: 'test',
    version: policy.version,
  };
}

test('calculateScore uses best-bets weights for best-bets policy', () => {
  const input = makeBaseInput(bestBetsPromotionPolicy);
  const decision = evaluatePromotionEligibility(input, bestBetsPromotionPolicy);
  // edge=90, trust=90, readiness=80, uniqueness=84, boardFit=89
  // BB weights: edge=0.35, trust=0.25, readiness=0.20, uniqueness=0.10, boardFit=0.10
  // expected total: 90*0.35 + 90*0.25 + 80*0.20 + 84*0.10 + 89*0.10
  //               = 31.5 + 22.5 + 16 + 8.4 + 8.9 = 87.3
  assert.ok(Math.abs(decision.score - 87.3) < 0.01, `Expected ~87.3 got ${decision.score}`);
  assert.deepEqual(decision.explanation.weights, bestBetsPromotionPolicy.weights);
});

test('calculateScore uses trader-insights weights for trader-insights policy', () => {
  const input = makeBaseInput(traderInsightsPromotionPolicy);
  const decision = evaluatePromotionEligibility(input, traderInsightsPromotionPolicy);
  // Same inputs, but TI weights: edge=0.40, trust=0.30, readiness=0.15, uniqueness=0.10, boardFit=0.05
  // expected total: 90*0.40 + 90*0.30 + 80*0.15 + 84*0.10 + 89*0.05
  //               = 36 + 27 + 12 + 8.4 + 4.45 = 87.85
  assert.ok(Math.abs(decision.score - 87.85) < 0.01, `Expected ~87.85 got ${decision.score}`);
  assert.deepEqual(decision.explanation.weights, traderInsightsPromotionPolicy.weights);
});

test('calculateScore uses exclusive-insights weights for exclusive-insights policy', () => {
  const input = makeBaseInput(exclusiveInsightsPromotionPolicy);
  // Override confidence to pass EI floor
  const eiInput = { ...input, pick: { ...input.pick, confidence: 0.95 } };
  const decision = evaluatePromotionEligibility(eiInput, exclusiveInsightsPromotionPolicy);
  // EI weights: edge=0.45, trust=0.30, readiness=0.10, uniqueness=0.10, boardFit=0.05
  // edge=90 < 90 threshold (fails minimumEdge=90), so this should be suppressed
  // But the score itself should still use EI weights:
  // 90*0.45 + 90*0.30 + 80*0.10 + 84*0.10 + 89*0.05 = 40.5 + 27 + 8 + 8.4 + 4.45 = 88.35
  assert.ok(Math.abs(decision.score - 88.35) < 0.01, `Expected ~88.35 got ${decision.score}`);
  assert.deepEqual(decision.explanation.weights, exclusiveInsightsPromotionPolicy.weights);
});

test('best-bets and trader-insights produce different scores for same inputs', () => {
  const inputBB = makeBaseInput(bestBetsPromotionPolicy);
  const inputTI = makeBaseInput(traderInsightsPromotionPolicy);
  const decisionBB = evaluatePromotionEligibility(inputBB, bestBetsPromotionPolicy);
  const decisionTI = evaluatePromotionEligibility(inputTI, traderInsightsPromotionPolicy);
  // Scores should differ since weights differ
  assert.notEqual(decisionBB.score, decisionTI.score);
});

// ── Step 3 & 4: ScoringProfile type and named profiles ────────────────────────

test('defaultScoringProfile has name "default"', () => {
  assert.equal(defaultScoringProfile.name, 'default');
});

test('defaultScoringProfile has all three canonical policies', () => {
  assert.ok(defaultScoringProfile.policies['best-bets']);
  assert.ok(defaultScoringProfile.policies['trader-insights']);
  assert.ok(defaultScoringProfile.policies['exclusive-insights']);
});

test('conservativeScoringProfile has name "conservative"', () => {
  assert.equal(conservativeScoringProfile.name, 'conservative');
});

test('conservativeScoringProfile has edge weight 0.40 on best-bets (vs 0.35 default)', () => {
  assert.equal(conservativeScoringProfile.policies['best-bets'].weights.edge, 0.40);
  assert.equal(defaultScoringProfile.policies['best-bets'].weights.edge, 0.35);
});

test('conservativeScoringProfile produces different scores than defaultScoringProfile for same inputs', () => {
  const scores = { edge: 80, trust: 75, readiness: 80, uniqueness: 80, boardFit: 75 };
  const baseInput = makeBaseInput(bestBetsPromotionPolicy);
  const inputWithScores = { ...baseInput, scoreInputs: scores };

  const defaultBBPolicy = defaultScoringProfile.policies['best-bets'];
  const conservativeBBPolicy = conservativeScoringProfile.policies['best-bets'];

  const defaultInput = { ...inputWithScores, minimumScore: defaultBBPolicy.minimumScore, boardCaps: defaultBBPolicy.boardCaps };
  const conservativeInput = { ...inputWithScores, minimumScore: conservativeBBPolicy.minimumScore, boardCaps: conservativeBBPolicy.boardCaps };

  const defaultDecision = evaluatePromotionEligibility(defaultInput, defaultBBPolicy);
  const conservativeDecision = evaluatePromotionEligibility(conservativeInput, conservativeBBPolicy);

  // Default: 80*0.35 + 75*0.25 + 80*0.20 + 80*0.10 + 75*0.10 = 28+18.75+16+8+7.5 = 78.25
  // Conservative: 80*0.40 + 75*0.20 + 80*0.20 + 80*0.10 + 75*0.10 = 32+15+16+8+7.5 = 78.5
  assert.notEqual(defaultDecision.score, conservativeDecision.score);
});

// ── Step 5 & 6: resolveScoringProfile and scoringProfile in metadata ──────────

test('resolveScoringProfile with undefined returns default profile', () => {
  const profile = resolveScoringProfile(undefined);
  assert.equal(profile.name, 'default');
});

test('resolveScoringProfile with "default" returns default profile', () => {
  const profile = resolveScoringProfile('default');
  assert.equal(profile.name, 'default');
});

test('resolveScoringProfile with "conservative" returns conservative profile', () => {
  const profile = resolveScoringProfile('conservative');
  assert.equal(profile.name, 'conservative');
});

test('resolveScoringProfile throws on unknown profile name', () => {
  assert.throws(
    () => resolveScoringProfile('unknown-profile'),
    /Unknown scoring profile "unknown-profile"/,
  );
});

test('scoringProfile written to pick_promotion_history payload via evaluateAndPersistPromotion', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // First create a pick via processSubmission so the pick exists
  const subResult = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 22.5',
      confidence: 0.75,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Celtics',
        promotionScores: {
          edge: 75,
          trust: 75,
          readiness: 80,
          uniqueness: 80,
          boardFit: 75,
        },
      },
    },
    repositories,
  );

  // evaluateAndPersistPromotion returns the full result including the history row with payload
  const promoResult = await evaluateAndPersistPromotion(
    subResult.pickRecord.id,
    'test-actor',
    repositories.picks,
    repositories.audit,
    bestBetsPromotionPolicy,
  );

  // The history row payload must contain scoringProfile
  const payload = promoResult.history.payload;
  assert.ok(payload, 'payload must exist on history row');
  assert.ok(
    typeof payload === 'object' && payload !== null && !Array.isArray(payload),
    'payload must be an object',
  );
  const payloadObj = payload as Record<string, unknown>;
  assert.ok(
    typeof payloadObj['scoringProfile'] === 'string',
    `scoringProfile must be a string, got: ${JSON.stringify(payloadObj['scoringProfile'])}`,
  );
  // The profile name must be a known profile
  assert.ok(
    ['default', 'conservative'].includes(payloadObj['scoringProfile'] as string),
    `scoringProfile must be a known profile, got: ${payloadObj['scoringProfile']}`,
  );
});

test('scoringProfile in promotion history is "default" when no env override', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const subResult = await processSubmission(
    {
      source: 'api',
      market: 'NBA blocks',
      selection: 'Player Over 0.5',
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Warriors vs Clippers',
        promotionScores: { edge: 72, trust: 72, readiness: 80, uniqueness: 80, boardFit: 75 },
      },
    },
    repositories,
  );

  const promoResult = await evaluateAndPersistPromotion(
    subResult.pickRecord.id,
    'test-actor',
    repositories.picks,
    repositories.audit,
    bestBetsPromotionPolicy,
  );

  const payload = promoResult.history.payload as Record<string, unknown>;
  // In test environment, UNIT_TALK_SCORING_PROFILE is unset → defaults to 'default'
  assert.equal(payload['scoringProfile'], 'default');
});
