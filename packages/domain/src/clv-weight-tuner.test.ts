import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWeightEffectiveness, type ScoredPickOutcome } from './clv-weight-tuner.js';

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
