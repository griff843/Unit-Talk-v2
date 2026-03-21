import test from 'node:test';
import assert from 'node:assert/strict';
import { readDomainAnalysisEdgeScore } from './promotion-service.js';
import { processSubmission } from './submission-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

// ── Unit tests for edge-to-score conversion ──────────────────────────────────

test('readDomainAnalysisEdgeScore returns null when domainAnalysis is absent', () => {
  assert.equal(readDomainAnalysisEdgeScore({}), null);
  assert.equal(readDomainAnalysisEdgeScore({ sport: 'NBA' }), null);
});

test('readDomainAnalysisEdgeScore returns null when edge is not computed', () => {
  const metadata = {
    domainAnalysis: {
      impliedProbability: 0.534884,
      decimalOdds: 1.869565,
      version: 'domain-analysis-v1.0.0',
      computedAt: '2026-03-21T12:00:00.000Z',
      // edge intentionally absent (no confidence at submission)
    },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), null);
});

test('readDomainAnalysisEdgeScore converts +0.10 raw edge to 90', () => {
  const metadata = {
    domainAnalysis: { edge: 0.10 },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), 90);
});

test('readDomainAnalysisEdgeScore converts +0.05 raw edge to 70', () => {
  const metadata = {
    domainAnalysis: { edge: 0.05 },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), 70);
});

test('readDomainAnalysisEdgeScore converts 0.00 raw edge to 50', () => {
  const metadata = {
    domainAnalysis: { edge: 0.0 },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), 50);
});

test('readDomainAnalysisEdgeScore converts -0.05 raw edge to 30', () => {
  const metadata = {
    domainAnalysis: { edge: -0.05 },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), 30);
});

test('readDomainAnalysisEdgeScore clamps extreme positive edge to 100', () => {
  const metadata = {
    domainAnalysis: { edge: 0.25 },
  };
  // 50 + 0.25 * 400 = 150 → clamped to 100
  assert.equal(readDomainAnalysisEdgeScore(metadata), 100);
});

test('readDomainAnalysisEdgeScore clamps extreme negative edge to 0', () => {
  const metadata = {
    domainAnalysis: { edge: -0.20 },
  };
  // 50 + (-0.20) * 400 = -30 → clamped to 0
  assert.equal(readDomainAnalysisEdgeScore(metadata), 0);
});

// ── Integration tests: three-tier edge fallback in promotion ─────────────────

test('explicit promotionScores.edge wins over domain analysis edge', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // Submitting with odds (domain analysis will compute edge) AND explicit promotionScores.edge
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA points',
      selection: 'Player Over 22.5',
      odds: 150, // +150 → implied 0.4, with confidence 0.65 → raw edge 0.25 → domain score 100
      confidence: 0.65, // above confidenceFloor (0.6)
      metadata: {
        sport: 'NBA',
        eventName: 'Hawks vs Celtics',
        promotionScores: {
          edge: 78, // Explicit: should be used, not the domain-computed 100
          trust: 79,
          readiness: 88,
          uniqueness: 82,
          boardFit: 90,
        },
      },
    },
    repositories,
  );

  // Explicit edge=78 wins over domain edge score=100.
  // edge=78 < 85 → trader-insights suppressed; bb: score = 78*0.35+79*0.25+88*0.2+82*0.1+90*0.1 = 81.85 ≥ 70 → qualifies
  assert.equal(result.pick.promotionTarget, 'best-bets');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('domain analysis edge is used when promotionScores.edge is absent and odds are present', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // Submitting with odds + confidence but NO explicit promotionScores.edge
  // odds +150 → implied 0.4, confidence 0.65 → raw edge 0.25 → score clamp(50+0.25*400)=150→100
  // Domain-derived edge score = 100 ≥ 85 → trader-insights edge threshold passes
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      odds: 150,
      confidence: 0.65, // above confidenceFloor (0.6)
      metadata: {
        sport: 'NBA',
        eventName: 'Bulls vs Knicks',
        promotionScores: {
          // edge intentionally absent — domain analysis should fill this
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // Domain-derived edge=100, trust=90 → both clear ti thresholds (85).
  // Overall score with edge=100: 100*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 35+22.5+17.6+8.4+8.9 = 92.4 ≥ 80
  // → trader-insights qualifies
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('domain analysis edge below ti threshold routes to best-bets when explicit edge absent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -200 → implied 0.6667, confidence 0.70 → raw edge ≈ 0.0333 → score ≈ 63.3
  // Domain-derived edge score ≈ 63 < 85 → trader-insights edge suppressed → best-bets
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
      odds: -200,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Heat vs Sixers',
        promotionScores: {
          // edge intentionally absent
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // Domain-derived edge ≈ 63 < 85 → ti suppressed. bb: score with edge=63 ≥ 70? Let's check:
  // 63*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 22.05+22.5+17.6+8.4+8.9 = 79.45 ≥ 70 → bb qualifies
  assert.equal(result.pick.promotionTarget, 'best-bets');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('confidence fallback is used when both promotionScores.edge and domain analysis are absent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No odds → no domain analysis → no domain edge → confidence fallback
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA steals',
      selection: 'Player Over 1.5',
      confidence: 0.90,
      metadata: {
        sport: 'NBA',
        eventName: 'Suns vs Nuggets',
        promotionScores: {
          // edge absent, no odds → confidence fallback = 90
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // Confidence=0.90 → fallback edge score=90 ≥ 85 → ti edge passes
  // trust=90 ≥ 85 → ti trust passes
  // overall = 90*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 31.5+22.5+17.6+8.4+8.9 = 88.9 ≥ 80
  // → trader-insights qualifies
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('negative domain edge suppresses promotion correctly', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -300 → implied 0.75, confidence 0.60 → raw edge = -0.15 → score = clamp(50+(-0.15)*400) = -10 → 0
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA threes',
      selection: 'Player Over 3.5',
      odds: -300,
      confidence: 0.60,
      metadata: {
        sport: 'NBA',
        eventName: 'Pacers vs Bucks',
        promotionScores: {
          // edge absent
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // Domain-derived edge=0 < 85 → ti suppressed (not_eligible).
  // bb: no hard suppression, but score = 0*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 57.4 < 70
  // → bb status = 'suppressed' (score below minimumScore). Neither qualifies.
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.equal(result.pick.promotionTarget, undefined);
});
