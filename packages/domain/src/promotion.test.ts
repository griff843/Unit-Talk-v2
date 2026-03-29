import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPromotion } from './promotion.js';
import { bestBetsPromotionPolicy } from '@unit-talk/contracts';
import type { PromotionDecisionSnapshot } from '@unit-talk/contracts';

// Shared qualified snapshot fixture
const qualifiedSnapshot: PromotionDecisionSnapshot = {
  scoringProfile: 'production-v1',
  policyVersion: 'best-bets-v1',
  scoreInputs: {
    edge: 85,
    trust: 80,
    readiness: 90,
    uniqueness: 75,
    boardFit: 80,
  },
  gateInputs: {
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    confidenceFloor: 0.6,
    pickConfidence: 0.75,
  },
  boardStateAtDecision: {
    currentBoardCount: 1,
    sameSportCount: 1,
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

test('replayPromotion returns qualified: true given inputs that produced a qualified decision', () => {
  const decision = replayPromotion(qualifiedSnapshot, bestBetsPromotionPolicy);
  assert.equal(decision.qualified, true);
  assert.equal(decision.status, 'qualified');
  assert.ok(decision.score >= bestBetsPromotionPolicy.minimumScore);
});

test('replayPromotion returns qualified: false with a higher minimumScore threshold (counterfactual)', () => {
  const strictPolicy = {
    ...bestBetsPromotionPolicy,
    minimumScore: 99,
    version: 'best-bets-strict',
  };
  const decision = replayPromotion(qualifiedSnapshot, strictPolicy);
  assert.equal(decision.qualified, false);
  assert.ok(decision.score < 99);
});

test('replayPromotion uses provided decidedAt timestamp', () => {
  const ts = '2026-01-01T00:00:00.000Z';
  const decision = replayPromotion(qualifiedSnapshot, bestBetsPromotionPolicy, ts);
  assert.equal(decision.decidedAt, ts);
  assert.equal(decision.decidedBy, 'replay');
});

test('replayPromotion returns not_eligible when isStale is true', () => {
  const staleSnapshot: PromotionDecisionSnapshot = {
    ...qualifiedSnapshot,
    gateInputs: { ...qualifiedSnapshot.gateInputs, isStale: true },
  };
  const decision = replayPromotion(staleSnapshot, bestBetsPromotionPolicy);
  assert.equal(decision.qualified, false);
  assert.equal(decision.status, 'expired');
});
