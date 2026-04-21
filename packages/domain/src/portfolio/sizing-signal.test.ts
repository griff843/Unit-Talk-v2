import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSizingSignal } from './sizing-signal.js';
import type { SizingSignalInputs } from './sizing-signal.js';
import { DEFAULT_BANKROLL_CONFIG } from '../risk/kelly-sizer.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NO_BOARD_FIT_PENALTY = {
  score: 100,
  concentrationPenaltyFactor: 1.0,
  correlationPenaltyFactor: 1.0,
  concentrationReasons: [],
  correlatedCount: 0,
};

function makeInputs(overrides: Partial<SizingSignalInputs> = {}): SizingSignalInputs {
  return {
    edge: 70,
    trust: 65,
    readiness: 60,
    uniqueness: 50,
    winProbability: 0.55,
    decimalOdds: 1.95,
    boardFitResult: NO_BOARD_FIT_PENALTY,
    modelUncertainty: 0,
    portfolioDrawdownFraction: 0,
    boardEdgeScores: [],
    boardAllocationFractions: [],
    bankroll: DEFAULT_BANKROLL_CONFIG,
    ...overrides,
  };
}

// ─── pickQualityScore ────────────────────────────────────────────────────────

test('pickQualityScore excludes boardFit — uses only edge/trust/readiness/uniqueness', () => {
  const sig = computeSizingSignal(makeInputs({ edge: 100, trust: 100, readiness: 100, uniqueness: 100 }));
  assert.equal(sig.pickQualityScore, 100);
});

test('pickQualityScore reflects weighted components without boardFit', () => {
  // edge=100 only, rest=0 → ~38.9
  const sig = computeSizingSignal(makeInputs({ edge: 100, trust: 0, readiness: 0, uniqueness: 0 }));
  assert.ok(sig.pickQualityScore > 38 && sig.pickQualityScore < 40, `expected ~38.9, got ${sig.pickQualityScore}`);
});

// ─── hasEdge / no edge ───────────────────────────────────────────────────────

test('hasEdge=false when Kelly finds no positive edge (p < break-even)', () => {
  // p=0.45 at -110 American ≈ 1.91 decimal → negative edge
  const sig = computeSizingSignal(makeInputs({ winProbability: 0.45, decimalOdds: 1.91 }));
  assert.equal(sig.hasEdge, false);
  assert.equal(sig.adjustedExposureFraction, 0);
  assert.equal(sig.adjustedExposureUnits, 0);
  assert.equal(sig.adjustmentReasons.length, 1);
});

test('hasEdge=true when probability overcomes vig', () => {
  const sig = computeSizingSignal(makeInputs({ winProbability: 0.58, decimalOdds: 1.91 }));
  assert.equal(sig.hasEdge, true);
  assert.ok(sig.adjustedExposureFraction > 0);
});

// ─── Board-fit penalty ───────────────────────────────────────────────────────

test('boardFitFactor=1.0 when boardFit score is 100 — no penalty', () => {
  const sig = computeSizingSignal(makeInputs());
  assert.equal(sig.penalties.boardFitFactor, 1.0);
  assert.equal(sig.penalties.combined, 1.0);
});

test('boardFitFactor reduces adjusted exposure proportionally', () => {
  const reduced = computeSizingSignal(makeInputs({
    boardFitResult: { ...NO_BOARD_FIT_PENALTY, score: 50 },
  }));
  const full = computeSizingSignal(makeInputs());

  assert.equal(reduced.penalties.boardFitFactor, 0.5);
  assert.ok(Math.abs(reduced.adjustedExposureFraction - full.adjustedExposureFraction * 0.5) < 0.001);
});

test('boardFitFactor=0 when boardFit score=0 — fully suppressed', () => {
  const sig = computeSizingSignal(makeInputs({
    boardFitResult: { ...NO_BOARD_FIT_PENALTY, score: 0 },
  }));
  assert.equal(sig.adjustedExposureFraction, 0);
  assert.equal(sig.adjustedExposureUnits, 0);
});

// ─── Variance penalty ────────────────────────────────────────────────────────

test('varianceFactor=1.0 when modelUncertainty=0', () => {
  const sig = computeSizingSignal(makeInputs({ modelUncertainty: 0 }));
  assert.equal(sig.penalties.varianceFactor, 1.0);
});

test('varianceFactor=0.75 when modelUncertainty=0.5', () => {
  const sig = computeSizingSignal(makeInputs({ modelUncertainty: 0.5 }));
  assert.equal(sig.penalties.varianceFactor, 0.75);
});

test('varianceFactor=0.5 at maximum uncertainty (modelUncertainty=1.0)', () => {
  const sig = computeSizingSignal(makeInputs({ modelUncertainty: 1.0 }));
  assert.equal(sig.penalties.varianceFactor, 0.5);
});

test('variance penalty appears in adjustmentReasons', () => {
  const sig = computeSizingSignal(makeInputs({ modelUncertainty: 0.8 }));
  assert.ok(sig.adjustmentReasons.some((r) => r.includes('uncertainty')));
});

// ─── Drawdown penalty ────────────────────────────────────────────────────────

test('drawdownFactor=1.0 when portfolioDrawdownFraction=0', () => {
  const sig = computeSizingSignal(makeInputs({ portfolioDrawdownFraction: 0 }));
  assert.equal(sig.penalties.drawdownFactor, 1.0);
});

test('drawdownFactor=0.9 at 10% drawdown', () => {
  const sig = computeSizingSignal(makeInputs({ portfolioDrawdownFraction: 0.1 }));
  assert.equal(sig.penalties.drawdownFactor, 0.9);
});

test('drawdownFactor=0.5 at 50%+ drawdown (capped)', () => {
  const sig = computeSizingSignal(makeInputs({ portfolioDrawdownFraction: 0.7 }));
  assert.equal(sig.penalties.drawdownFactor, 0.5);
});

test('drawdown penalty appears in adjustmentReasons', () => {
  const sig = computeSizingSignal(makeInputs({ portfolioDrawdownFraction: 0.2 }));
  assert.ok(sig.adjustmentReasons.some((r) => r.includes('drawdown')));
});

// ─── Rank comparison ─────────────────────────────────────────────────────────

test('isHighestEdge=true when board is empty', () => {
  const sig = computeSizingSignal(makeInputs({ boardEdgeScores: [] }));
  assert.equal(sig.isHighestEdge, true);
});

test('isHighestEdge=true when this edge exceeds all board edges', () => {
  const sig = computeSizingSignal(makeInputs({ edge: 90, boardEdgeScores: [70, 60, 50] }));
  assert.equal(sig.isHighestEdge, true);
});

test('isHighestEdge=false when another board pick has higher edge', () => {
  const sig = computeSizingSignal(makeInputs({ edge: 60, boardEdgeScores: [80, 50] }));
  assert.equal(sig.isHighestEdge, false);
});

test('isHighestAllocation=true when board is empty (highest by default)', () => {
  // no edge case → false; with edge, empty board = true
  const sig = computeSizingSignal(makeInputs({ boardAllocationFractions: [] }));
  assert.equal(sig.isHighestAllocation, true);
});

test('isHighestAllocation can differ from isHighestEdge when penalties apply', () => {
  // Highest edge on board but heavy portfolio penalty reduces allocation below existing
  const sig = computeSizingSignal(makeInputs({
    edge: 95,
    boardEdgeScores: [60],
    boardFitResult: { ...NO_BOARD_FIT_PENALTY, score: 10 }, // 90% penalty
    boardAllocationFractions: [0.03], // existing pick has 3% allocation
    winProbability: 0.60,
    decimalOdds: 1.91,
  }));

  // Highest edge but allocation crushed by boardFit
  assert.equal(sig.isHighestEdge, true);
  assert.equal(sig.isHighestAllocation, false);
  assert.ok(sig.adjustmentReasons.some((r) => r.includes('Highest-edge pick')));
});

// ─── Combined penalties ──────────────────────────────────────────────────────

test('combined penalty is product of all factors', () => {
  const sig = computeSizingSignal(makeInputs({
    boardFitResult: { ...NO_BOARD_FIT_PENALTY, score: 80 },
    modelUncertainty: 0.4,
    portfolioDrawdownFraction: 0.1,
  }));

  const expected = 0.8 * (1 - 0.5 * 0.4) * (1 - 0.1);
  assert.ok(Math.abs(sig.penalties.combined - expected) < 0.001,
    `expected combined ≈ ${expected.toFixed(4)}, got ${sig.penalties.combined}`);
});

test('rawKellyFraction is unaffected by portfolio penalties', () => {
  const nopenalty = computeSizingSignal(makeInputs());
  const penalized = computeSizingSignal(makeInputs({
    boardFitResult: { ...NO_BOARD_FIT_PENALTY, score: 50 },
    modelUncertainty: 0.5,
    portfolioDrawdownFraction: 0.2,
  }));

  assert.equal(nopenalty.rawKellyFraction, penalized.rawKellyFraction);
  assert.ok(penalized.adjustedExposureFraction < nopenalty.adjustedExposureFraction);
});

test('adjustedExposureUnits = adjustedExposureFraction * bankroll', () => {
  const sig = computeSizingSignal(makeInputs());
  const expected = sig.adjustedExposureFraction * DEFAULT_BANKROLL_CONFIG.total_bankroll;
  assert.ok(Math.abs(sig.adjustedExposureUnits - expected) < 0.01);
});
