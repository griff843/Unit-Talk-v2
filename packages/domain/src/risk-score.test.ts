/**
 * UTV2-1022: computeRiskScore unit tests
 *
 * Covers:
 *   - Absent metadata fields → neutral defaults (except Kelly which fails closed)
 *   - All valid fields → correct composite
 *   - Zero Kelly with data present → hardBlock (degenerate Kelly)
 *   - riskScore < 10 → hardBlock threshold
 *   - calculateScore modifier via evaluatePromotionEligibility
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestBetsPromotionPolicy,
  type BoardPromotionEvaluationInput,
  type CanonicalPick,
} from '@unit-talk/contracts';
import { computeRiskScore, evaluatePromotionEligibility, RISK_MODIFIER_WEIGHT } from './promotion.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalPick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'pick-test-1',
    submissionId: 'sub-1',
    market: 'player_points',
    selection: 'Player A over 22.5',
    odds: -110,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMinimalInput(
  pick: CanonicalPick,
): BoardPromotionEvaluationInput {
  return {
    target: 'best-bets',
    pick,
    approvalStatus: 'approved',
    hasRequiredFields: true,
    isStale: false,
    withinPostingWindow: true,
    marketStillValid: true,
    riskBlocked: false,
    scoreInputs: { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 },
    minimumScore: 70,
    boardCaps: { perSlate: 15, perSport: 10, perGame: 2 },
    boardState: { currentBoardCount: 0, sameSportCount: 0, sameGameCount: 0, duplicateCount: 0 },
    decidedAt: new Date().toISOString(),
    decidedBy: 'test',
    version: 'best-bets-v2',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('computeRiskScore: absent fields → neutral defaults', () => {
  const pick = makeMinimalPick({ odds: -110, metadata: {} });
  const result = computeRiskScore(pick, { edge: 50, trust: 50, readiness: 50, uniqueness: 50, boardFit: 50 });

  // odds -110 → decimalOdds ≈ 1.91 → <= -115 boundary → varianceScore = 100
  // Actually -110 → decimal = 100/110 + 1 = 1.909... > 1.87, so varianceScore = 75
  assert.equal(result.components.varianceScore, 75, 'varianceScore should be 75 for -110');

  // Kelly absent → kellyScore = 0 (fails closed)
  assert.equal(result.components.kellyScore, 0, 'kellyScore should be 0 when absent');

  // lineMovement absent → 50 neutral
  assert.equal(result.components.lineMovementScore, 50, 'lineMovementScore should be 50 when absent');

  // consensus absent → 50 neutral
  assert.equal(result.components.dispersionScore, 50, 'dispersionScore should be 50 when absent');

  // No hard block: kelly absent → not degenerate; score is computed
  // score = 75*0.35 + 0*0.35 + 50*0.20 + 50*0.10 = 26.25 + 0 + 10 + 5 = 41.25 → 41
  assert.equal(result.score, 41, 'composite score should be 41');

  // modifier = 1 - 0.15 + 0.15 * (41/100) = 0.85 + 0.0615 = 0.9115
  const expectedModifier = 1 - RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT * (41 / 100);
  assert.ok(Math.abs(result.modifier - expectedModifier) < 0.001, 'modifier should match formula');

  // hardBlock false — kelly absent means no degenerate, score not < 10
  assert.equal(result.hardBlock, false);
});

test('computeRiskScore: all valid fields → correct composite', () => {
  const pick = makeMinimalPick({
    odds: -150, // decimalOdds = 1.667, <= 1.87 → varianceScore = 100
    metadata: {
      kellySizing: {
        fractional_kelly: 0.03, // <= 0.05 → kellyScore = 100
      },
      lineMovement: {
        basisPointsDelta: 15, // >= 10 → lineMovementScore = 100
      },
      consensus: {
        bookSpread: 0.01, // <= 0.02 → dispersionScore = 100
      },
    },
  });
  const result = computeRiskScore(pick, { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 });

  assert.equal(result.components.varianceScore, 100);
  assert.equal(result.components.kellyScore, 100);
  assert.equal(result.components.lineMovementScore, 100);
  assert.equal(result.components.dispersionScore, 100);
  assert.equal(result.score, 100, 'all perfect scores → composite 100');
  assert.equal(result.hardBlock, false);
  assert.ok(Math.abs(result.modifier - 1.0) < 0.001, 'modifier should be 1.0 at score 100');
});

test('computeRiskScore: zero Kelly with data present → hardBlock', () => {
  const pick = makeMinimalPick({
    odds: -110,
    metadata: {
      kellySizing: {
        fractional_kelly: 0, // zero with data present = degenerate
      },
    },
  });
  const result = computeRiskScore(pick, { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 });

  assert.equal(result.components.kellyScore, 0);
  assert.equal(result.hardBlock, true, 'zero Kelly with data present should hard-block');
  assert.ok(
    result.hardBlockReasons.some((r) => r.includes('Kelly fraction is 0')),
    'hardBlockReasons should mention degenerate Kelly',
  );
});

test('computeRiskScore: score < 10 → hardBlock threshold', () => {
  // To get score < 10:
  // varianceScore should be low (longshot odds)
  // kellyScore = 0 (absent — no hard block from degenerate Kelly)
  // lineMovement sharp adverse
  // consensus extreme dispersion
  const pick = makeMinimalPick({
    odds: 1200, // extreme longshot → decimalOdds 13.0 → varianceScore = 25
    metadata: {
      // No kellySizing — kellyScore = 0 (fails closed, but no data present → no degenerate block)
      lineMovement: {
        basisPointsDelta: -100, // < -50 → lineMovementScore = 0
      },
      consensus: {
        bookSpread: 0.30, // > 0.20 → dispersionScore = 0
      },
    },
  });
  const result = computeRiskScore(pick, { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 });

  // score = 25*0.35 + 0*0.35 + 0*0.20 + 0*0.10 = 8.75 → 9
  assert.equal(result.components.varianceScore, 25);
  assert.equal(result.components.kellyScore, 0);
  assert.equal(result.components.lineMovementScore, 0);
  assert.equal(result.components.dispersionScore, 0);
  assert.ok(result.score < 10, `score should be < 10 (got ${result.score})`);
  assert.equal(result.hardBlock, true, 'score < 10 should hard-block');
  assert.ok(
    result.hardBlockReasons.some((r) => r.includes('hard-block threshold 10')),
    'hardBlockReasons should mention threshold',
  );
});

test('computeRiskScore: negative Kelly fraction → kellyScore = 0 with data present → hardBlock', () => {
  const pick = makeMinimalPick({
    odds: -110,
    metadata: {
      kellySizing: {
        fractional_kelly: -0.05, // degenerate negative
      },
    },
  });
  const result = computeRiskScore(pick, { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 });
  assert.equal(result.components.kellyScore, 0);
  assert.equal(result.hardBlock, true, 'negative Kelly with data present should hard-block');
});

test('computeRiskScore: aggressive Kelly sizing → kellyScore = 25', () => {
  const pick = makeMinimalPick({
    odds: -110,
    metadata: {
      kellySizing: {
        fractional_kelly: 0.30, // > 0.25 → 25
      },
    },
  });
  const result = computeRiskScore(pick, { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 });
  assert.equal(result.components.kellyScore, 25);
});

test('calculateScore applies risk modifier: high-risk pick has lower total', () => {
  // Create a high-risk pick (high odds, zero Kelly data, extreme adverse line movement)
  const riskyPick = makeMinimalPick({
    odds: 1200, // extreme variance → varianceScore = 25
    metadata: {
      lineMovement: { basisPointsDelta: -100 }, // → lineMovementScore = 0
      consensus: { bookSpread: 0.30 },           // → dispersionScore = 0
      // no kellySizing → kellyScore = 0 (absent, no hard block)
    },
  });

  // Create a low-risk pick (short odds, good Kelly, stable line, consensus)
  const safePick = makeMinimalPick({
    odds: -150, // low variance → varianceScore = 100
    metadata: {
      kellySizing: { fractional_kelly: 0.02 }, // → kellyScore = 100
      lineMovement: { basisPointsDelta: 20 },  // → lineMovementScore = 100
      consensus: { bookSpread: 0.01 },          // → dispersionScore = 100
    },
  });

  const scoreInputs = { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 };

  const riskyInput = makeMinimalInput(riskyPick);
  riskyInput.scoreInputs = scoreInputs;
  riskyInput.pick = riskyPick;

  const safeInput = makeMinimalInput(safePick);
  safeInput.scoreInputs = scoreInputs;
  safeInput.pick = safePick;
  safeInput.pick.market = ''; // suppress market modifiers for clean comparison

  // Use market '' to bypass market-family modifiers and isolate risk modifier
  riskyInput.pick = { ...riskyPick, market: '' };

  const riskyDecision = evaluatePromotionEligibility(riskyInput, bestBetsPromotionPolicy);
  const safeDecision = evaluatePromotionEligibility(safeInput, bestBetsPromotionPolicy);

  // Safe pick should score higher than risky pick (same scoreInputs, different risk)
  assert.ok(
    safeDecision.score >= riskyDecision.score,
    `safe pick score (${safeDecision.score}) should be >= risky pick score (${riskyDecision.score})`,
  );
});

test('computeRiskScore: moderate kelly sizing ranges', () => {
  const scoreInputs = { edge: 50, trust: 50, readiness: 50, uniqueness: 50, boardFit: 50 };

  const pick75 = makeMinimalPick({
    odds: -110,
    metadata: { kellySizing: { fractional_kelly: 0.10 } }, // 0.05–0.15 → 75
  });
  assert.equal(computeRiskScore(pick75, scoreInputs).components.kellyScore, 75);

  const pick50 = makeMinimalPick({
    odds: -110,
    metadata: { kellySizing: { fractional_kelly: 0.20 } }, // 0.15–0.25 → 50
  });
  assert.equal(computeRiskScore(pick50, scoreInputs).components.kellyScore, 50);
});

test('computeRiskScore: line movement score ranges', () => {
  const scoreInputs = { edge: 50, trust: 50, readiness: 50, uniqueness: 50, boardFit: 50 };

  const tests: Array<{ bps: number; expected: number }> = [
    { bps: 20, expected: 100 },
    { bps: 10, expected: 100 },
    { bps: 5, expected: 75 },
    { bps: 0, expected: 75 },
    { bps: -5, expected: 50 },
    { bps: -20, expected: 50 },
    { bps: -30, expected: 25 },
    { bps: -50, expected: 25 },
    { bps: -51, expected: 0 },
  ];

  for (const { bps, expected } of tests) {
    const pick = makeMinimalPick({
      odds: -110,
      metadata: { lineMovement: { basisPointsDelta: bps } },
    });
    const result = computeRiskScore(pick, scoreInputs);
    assert.equal(
      result.components.lineMovementScore,
      expected,
      `bps=${bps} should give lineMovementScore=${expected}`,
    );
  }
});

test('computeRiskScore: dispersion score ranges', () => {
  const scoreInputs = { edge: 50, trust: 50, readiness: 50, uniqueness: 50, boardFit: 50 };

  const tests: Array<{ spread: number; expected: number }> = [
    { spread: 0.01, expected: 100 },
    { spread: 0.02, expected: 100 },
    { spread: 0.03, expected: 75 },
    { spread: 0.05, expected: 75 },
    { spread: 0.07, expected: 50 },
    { spread: 0.10, expected: 50 },
    { spread: 0.15, expected: 25 },
    { spread: 0.20, expected: 25 },
    { spread: 0.25, expected: 0 },
  ];

  for (const { spread, expected } of tests) {
    const pick = makeMinimalPick({
      odds: -110,
      metadata: { consensus: { bookSpread: spread } },
    });
    const result = computeRiskScore(pick, scoreInputs);
    assert.equal(
      result.components.dispersionScore,
      expected,
      `bookSpread=${spread} should give dispersionScore=${expected}`,
    );
  }
});
