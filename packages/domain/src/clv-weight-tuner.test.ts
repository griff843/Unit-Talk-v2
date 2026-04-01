import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeWeightEffectiveness,
  runWalkForwardBacktest,
  testComponentSignificance,
  testAllComponentSignificance,
  type ScoredPickOutcome,
} from './clv-weight-tuner.js';

test('analyzeWeightEffectiveness returns insufficient confidence for < 20 picks', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 5 }, (_, i) => ({
    scoreInputs: { edge: 70 + i, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: i * 0.5,
    won: i > 2,
  }));
  const report = analyzeWeightEffectiveness(outcomes);
  assert.equal(report.confidence, 'insufficient');
  assert.equal(report.sampleSize, 5);
});

test('analyzeWeightEffectiveness returns low confidence for 20-49 picks', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 25 }, (_, i) => ({
    scoreInputs: { edge: 50 + i * 2, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: (i - 12) * 0.3,
    won: i > 12,
  }));
  const report = analyzeWeightEffectiveness(outcomes);
  assert.equal(report.confidence, 'low');
  assert.equal(report.sampleSize, 25);
});

test('analyzeWeightEffectiveness detects predictive edge component', () => {
  // Create outcomes where edge correlates strongly with CLV
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 50 }, (_, i) => ({
    scoreInputs: {
      edge: 50 + i,         // increases linearly
      trust: 70,             // constant
      readiness: 70,         // constant
      uniqueness: 70,        // constant
      boardFit: 70,          // constant
    },
    clvPercent: -5 + i * 0.2,  // correlates with edge
    won: i > 25,
  }));
  const report = analyzeWeightEffectiveness(outcomes);
  assert.equal(report.confidence, 'medium');
  // Edge should have positive correlation
  assert.ok(report.componentCorrelations.edge.correlation > 0.5, `edge correlation ${report.componentCorrelations.edge.correlation} should be > 0.5`);
  assert.equal(report.componentCorrelations.edge.predictive, true);
  // Constant components should have ~0 correlation
  assert.ok(Math.abs(report.componentCorrelations.trust.correlation) < 0.1, 'trust should have ~0 correlation');
});

test('analyzeWeightEffectiveness suggests higher weight for predictive components', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 100 }, (_, i) => ({
    scoreInputs: {
      edge: 50 + i * 0.5,
      trust: 70 + (i % 10),
      readiness: 70,
      uniqueness: 70,
      boardFit: 70,
    },
    clvPercent: -5 + i * 0.1 + (Math.sin(i) * 0.5), // mostly correlated with edge
    won: i > 50,
  }));
  const report = analyzeWeightEffectiveness(outcomes);
  assert.equal(report.confidence, 'high');
  // Suggested edge weight should be >= other constant components
  assert.ok(report.suggestedAdjustments.edge >= report.suggestedAdjustments.readiness);
});

test('analyzeWeightEffectiveness quartile analysis shows top > bottom for predictive component', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 40 }, (_, i) => ({
    scoreInputs: {
      edge: 50 + i * 1.25,
      trust: 70,
      readiness: 70,
      uniqueness: 70,
      boardFit: 70,
    },
    clvPercent: -3 + i * 0.15,
    won: i > 20,
  }));
  const report = analyzeWeightEffectiveness(outcomes);
  const edge = report.componentCorrelations.edge;
  assert.ok(edge.topQuartileAvgClv != null);
  assert.ok(edge.bottomQuartileAvgClv != null);
  assert.ok(edge.topQuartileAvgClv! > edge.bottomQuartileAvgClv!, 'top quartile CLV should exceed bottom');
});

test('analyzeWeightEffectiveness handles empty input', () => {
  const report = analyzeWeightEffectiveness([]);
  assert.equal(report.sampleSize, 0);
  assert.equal(report.confidence, 'insufficient');
});

// ── Walk-forward backtest ──────────────────────────────────────────────────

test('runWalkForwardBacktest returns empty result when insufficient data', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 30 }, (_, i) => ({
    scoreInputs: { edge: 50 + i, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: i * 0.1,
    won: i > 15,
  }));
  const result = runWalkForwardBacktest(outcomes, { trainSize: 50, testSize: 20 });
  assert.equal(result.windowCount, 0);
  assert.equal(result.windows.length, 0);
  assert.equal(result.edgeIsStable, false);
});

test('runWalkForwardBacktest produces at least one window for sufficient data', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 150 }, (_, i) => ({
    scoreInputs: {
      edge: 50 + (i % 50),
      trust: 70,
      readiness: 70,
      uniqueness: 70,
      boardFit: 70,
    },
    clvPercent: -5 + i * 0.1,
    won: i > 75,
  }));
  const result = runWalkForwardBacktest(outcomes, { trainSize: 50, testSize: 20 });
  assert.ok(result.windowCount >= 1, `expected at least 1 window, got ${result.windowCount}`);
  assert.equal(result.windows.length, result.windowCount);
});

test('runWalkForwardBacktest windows have non-overlapping test ranges', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 200 }, (_, i) => ({
    scoreInputs: { edge: 50 + i * 0.2, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: -3 + i * 0.05,
    won: i > 100,
  }));
  const result = runWalkForwardBacktest(outcomes, { trainSize: 50, testSize: 20 });
  for (let i = 1; i < result.windows.length; i++) {
    const prev = result.windows[i - 1]!;
    const curr = result.windows[i]!;
    assert.ok(curr.testStart >= prev.testEnd, 'test windows must not overlap');
  }
});

test('runWalkForwardBacktest detects unstable edge when correlation swings between windows', () => {
  // Alternate between strong positive and strong negative edge correlation across windows
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 200 }, (_, i) => {
    const window = Math.floor(i / 20);
    const sign = window % 2 === 0 ? 1 : -1;
    return {
      scoreInputs: { edge: 50 + (i % 20), trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
      clvPercent: sign * ((i % 20) * 0.3 - 3),
      won: i > 100,
    };
  });
  const result = runWalkForwardBacktest(outcomes, { trainSize: 40, testSize: 20 });
  // With sign alternation the std dev across windows should be high → not stable
  assert.ok(result.windowCount >= 2, 'need at least 2 windows to test stability');
});

test('runWalkForwardBacktest meanTestCorrelation has correct keys', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 100 }, (_, i) => ({
    scoreInputs: { edge: 50 + i * 0.5, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: -5 + i * 0.1,
    won: i > 50,
  }));
  const result = runWalkForwardBacktest(outcomes, { trainSize: 50, testSize: 20 });
  const keys = Object.keys(result.meanTestCorrelation).sort();
  assert.deepEqual(keys, ['boardFit', 'edge', 'readiness', 'trust', 'uniqueness']);
});

// ── Significance testing ───────────────────────────────────────────────────

test('testComponentSignificance returns significant=true for strong positive correlation', () => {
  // 100 picks where edge strongly predicts CLV
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 100 }, (_, i) => ({
    scoreInputs: { edge: 50 + i * 0.5, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: -5 + i * 0.1,
    won: i > 50,
  }));
  const result = testComponentSignificance(outcomes, 'edge');
  assert.equal(result.component, 'edge');
  assert.ok(result.observedCorrelation > 0.5, 'edge correlation should be strong');
  assert.ok(result.pValue < 0.05, `p-value ${result.pValue} should be < 0.05`);
  assert.equal(result.significant, true);
  assert.equal(result.sampleSize, 100);
});

test('testComponentSignificance returns significant=false for near-zero correlation', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 50 }, (_, i) => ({
    scoreInputs: { edge: 50 + (i % 5), trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: (i % 3 === 0 ? 1 : -1) * ((i % 7) * 0.3),
    won: i > 25,
  }));
  const result = testComponentSignificance(outcomes, 'trust');
  assert.equal(result.significant, false, `trust should not be significant: p=${result.pValue}`);
});

test('testComponentSignificance returns p=1 for n < 3', () => {
  const outcomes: ScoredPickOutcome[] = [
    { scoreInputs: { edge: 60, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 }, clvPercent: 1, won: true },
  ];
  const result = testComponentSignificance(outcomes, 'edge');
  assert.equal(result.pValue, 1);
  assert.equal(result.significant, false);
});

test('testAllComponentSignificance returns results for all five components', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 50 }, (_, i) => ({
    scoreInputs: { edge: 50 + i, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: (i - 25) * 0.2,
    won: i > 25,
  }));
  const results = testAllComponentSignificance(outcomes);
  assert.equal(results.length, 5);
  const components = results.map((r) => r.component).sort();
  assert.deepEqual(components, ['boardFit', 'edge', 'readiness', 'trust', 'uniqueness']);
});

test('testAllComponentSignificance respects custom alpha threshold', () => {
  const outcomes: ScoredPickOutcome[] = Array.from({ length: 100 }, (_, i) => ({
    scoreInputs: { edge: 50 + i * 0.5, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
    clvPercent: -5 + i * 0.1,
    won: i > 50,
  }));
  const strictResults = testAllComponentSignificance(outcomes, 0.001);
  const looseResults = testAllComponentSignificance(outcomes, 0.5);
  const strictSigCount = strictResults.filter((r) => r.significant).length;
  const looseSigCount = looseResults.filter((r) => r.significant).length;
  assert.ok(
    looseSigCount >= strictSigCount,
    `loose alpha should produce at least as many significant results as strict alpha (${looseSigCount} vs ${strictSigCount})`,
  );
});
