/**
 * UTV2-255: Conviction trust signal proof
 *
 * Proves that conviction=8/9/4 trust scores interact correctly with the
 * trader-insights minimumTrust=85 gate and best-bets minimumTrust=0 gate.
 *
 * Trust score is always conviction * 10 (set by Smart Form before submission).
 * normalizeScore() clamps to [0, 100] — no division — so trust=80 stays 80.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestBetsPromotionPolicy,
  traderInsightsPromotionPolicy,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
} from '@unit-talk/contracts';
import { evaluatePromotionEligibility } from './promotion.js';

function makeMinimalPick(confidence: number): CanonicalPick {
  return {
    id: 'pick-test',
    submissionId: 'sub-test',
    market: 'player.assists',
    selection: 'Jamal Murray Assists O 7',
    odds: -140,
    stakeUnits: 1,
    confidence,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

function makeInput(
  pick: CanonicalPick,
  trustScore: number,
  otherScores: { edge: number; readiness: number; uniqueness: number; boardFit: number } = {
    edge: 90,
    readiness: 90,
    uniqueness: 90,
    boardFit: 90,
  },
): BoardPromotionEvaluationInput {
  return {
    target: 'trader-insights',
    pick,
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    scoreInputs: {
      edge: otherScores.edge,
      trust: trustScore,
      readiness: otherScores.readiness,
      uniqueness: otherScores.uniqueness,
      boardFit: otherScores.boardFit,
    },
    minimumScore: traderInsightsPromotionPolicy.minimumScore,
    boardCaps: { perSlate: 20, perSport: 10, perGame: 5 },
    boardState: { currentBoardCount: 0, sameSportCount: 0, sameGameCount: 0, duplicateCount: 0 },
  };
}

// conviction=9 → trust=90 qualifies for trader-insights (minimumTrust=85)
test('conviction=9: trust=90 qualifies for trader-insights', () => {
  const pick = makeMinimalPick(0.9);
  const input = makeInput(pick, 90);
  const decision = evaluatePromotionEligibility(input, traderInsightsPromotionPolicy);
  assert.equal(
    decision.qualified,
    true,
    `Expected qualified but got: ${JSON.stringify(decision.explanation.suppressionReasons)}`,
  );
  assert.equal(decision.status, 'qualified');
});

// conviction=8 → trust=80 blocked by trader-insights trust gate (80 < 85)
test('conviction=8: trust=80 is blocked by trader-insights trust gate', () => {
  const pick = makeMinimalPick(0.8);
  const input = makeInput(pick, 80);
  const decision = evaluatePromotionEligibility(input, traderInsightsPromotionPolicy);
  assert.equal(decision.qualified, false);
  assert.ok(
    decision.explanation.suppressionReasons.some((r) => r.includes('trust score')),
    `Expected trust score suppression, got: ${JSON.stringify(decision.explanation.suppressionReasons)}`,
  );
});

// conviction=4 → trust=40 blocked by trader-insights trust gate (40 < 85)
test('conviction=4: trust=40 is blocked by trader-insights trust gate', () => {
  const pick = makeMinimalPick(0.4);
  const input = makeInput(pick, 40);
  const decision = evaluatePromotionEligibility(input, traderInsightsPromotionPolicy);
  assert.equal(decision.qualified, false);
  assert.ok(
    decision.explanation.suppressionReasons.some((r) => r.includes('trust score')),
    `Expected trust score suppression, got: ${JSON.stringify(decision.explanation.suppressionReasons)}`,
  );
});

// conviction=4 → trust=40 qualifies for best-bets (minimumTrust=0)
test('conviction=4: trust=40 qualifies for best-bets (minimumTrust=0)', () => {
  const pick = makeMinimalPick(0.4);
  const input: BoardPromotionEvaluationInput = {
    target: 'best-bets',
    pick,
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    scoreInputs: {
      edge: 85,
      trust: 40,
      readiness: 80,
      uniqueness: 80,
      boardFit: 80,
    },
    // edge=85*0.35 + 40*0.25 + 80*0.2 + 80*0.1 + 80*0.1 = 29.75+10+16+8+8 = 71.75 ≥ 70
    minimumScore: bestBetsPromotionPolicy.minimumScore,
    boardCaps: { perSlate: 20, perSport: 10, perGame: 5 },
    boardState: { currentBoardCount: 0, sameSportCount: 0, sameGameCount: 0, duplicateCount: 0 },
  };
  const decision = evaluatePromotionEligibility(input, bestBetsPromotionPolicy);
  assert.equal(
    decision.qualified,
    true,
    `Expected qualified but got: ${JSON.stringify(decision.explanation.suppressionReasons)}`,
  );
  assert.equal(decision.status, 'qualified');
});

// conviction=8 → trust=80 qualifies for best-bets (minimumTrust=0)
test('conviction=8: trust=80 qualifies for best-bets (minimumTrust=0)', () => {
  const pick = makeMinimalPick(0.8);
  const input: BoardPromotionEvaluationInput = {
    target: 'best-bets',
    pick,
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    scoreInputs: { edge: 85, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 },
    // edge=85*0.35 + 80*0.25 + 80*0.2 + 80*0.1 + 80*0.1 = 29.75+20+16+8+8 = 81.75 ≥ 70
    minimumScore: bestBetsPromotionPolicy.minimumScore,
    boardCaps: { perSlate: 20, perSport: 10, perGame: 5 },
    boardState: { currentBoardCount: 0, sameSportCount: 0, sameGameCount: 0, duplicateCount: 0 },
  };
  const decision = evaluatePromotionEligibility(input, bestBetsPromotionPolicy);
  assert.equal(
    decision.qualified,
    true,
    `Expected qualified but got: ${JSON.stringify(decision.explanation.suppressionReasons)}`,
  );
});
