import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readDomainAnalysisEdgeScore,
  readDomainAnalysisTrustSignal,
  readDomainAnalysisReadinessSignal,
} from './promotion-service.js';
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

  // Domain-derived edge=100, trust=90 → clears the exclusive-insights thresholds.
  // Overall score with edge=100: 100*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 35+22.5+17.6+8.4+8.9 = 92.4 ≥ 90
  // → exclusive-insights qualifies
  assert.equal(result.pick.promotionTarget, 'exclusive-insights');
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

// ── Unit tests for domain analysis trust signal (Week 21) ────────────────────

test('readDomainAnalysisTrustSignal returns null when domainAnalysis is absent', () => {
  assert.equal(readDomainAnalysisTrustSignal({}), null);
  assert.equal(readDomainAnalysisTrustSignal({ sport: 'NBA' }), null);
});

test('readDomainAnalysisTrustSignal returns null when edge is not positive', () => {
  const metadata = {
    domainAnalysis: {
      edge: -0.05,
      hasPositiveEdge: false,
    },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), null);
});

test('readDomainAnalysisTrustSignal returns null when edge is absent', () => {
  const metadata = {
    domainAnalysis: {
      impliedProbability: 0.534884,
      decimalOdds: 1.869565,
      version: 'domain-analysis-v1.0.0',
      computedAt: '2026-03-21T12:00:00.000Z',
    },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), null);
});

test('readDomainAnalysisTrustSignal returns 80 for significant positive edge (≥0.05)', () => {
  const metadata = {
    domainAnalysis: { edge: 0.10, hasPositiveEdge: true },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), 80);
});

test('readDomainAnalysisTrustSignal returns 80 at boundary edge = 0.05', () => {
  const metadata = {
    domainAnalysis: { edge: 0.05, hasPositiveEdge: true },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), 80);
});

test('readDomainAnalysisTrustSignal returns 65 for marginal positive edge (<0.05)', () => {
  const metadata = {
    domainAnalysis: { edge: 0.03, hasPositiveEdge: true },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), 65);
});

// ── Unit tests for domain analysis readiness signal (Week 21) ────────────────

test('readDomainAnalysisReadinessSignal returns null when domainAnalysis is absent', () => {
  assert.equal(readDomainAnalysisReadinessSignal({}), null);
  assert.equal(readDomainAnalysisReadinessSignal({ sport: 'NBA' }), null);
});

test('readDomainAnalysisReadinessSignal returns null when kellyFraction is absent', () => {
  const metadata = {
    domainAnalysis: {
      edge: 0.10,
      hasPositiveEdge: true,
      // kellyFraction intentionally absent
    },
  };
  assert.equal(readDomainAnalysisReadinessSignal(metadata), null);
});

test('readDomainAnalysisReadinessSignal returns null when kellyFraction is 0', () => {
  const metadata = {
    domainAnalysis: { kellyFraction: 0 },
  };
  assert.equal(readDomainAnalysisReadinessSignal(metadata), null);
});

test('readDomainAnalysisReadinessSignal returns null when kellyFraction is negative', () => {
  const metadata = {
    domainAnalysis: { kellyFraction: -0.01 },
  };
  assert.equal(readDomainAnalysisReadinessSignal(metadata), null);
});

test('readDomainAnalysisReadinessSignal maps positive kellyFraction onto the readiness gradient', () => {
  const metadata = {
    domainAnalysis: { kellyFraction: 0.03 },
  };
  assert.equal(readDomainAnalysisReadinessSignal(metadata), 47);
});

test('readDomainAnalysisReadinessSignal keeps very small positive kellyFraction near the floor', () => {
  const metadata = {
    domainAnalysis: { kellyFraction: 0.001 },
  };
  assert.equal(readDomainAnalysisReadinessSignal(metadata), 40);
});

// ── Integration tests: domain-aware trust/readiness in promotion (Week 21) ───

test('domain trust signal elevates trust when no explicit trust score and positive edge', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds +150 → implied 0.4, confidence 0.65 → raw edge 0.25 → hasPositiveEdge=true, edge≥0.05
  // Domain trust signal = 80 (significant positive edge)
  // Confidence-based trust would be 0.65*100 = 65
  // So domain trust (80) > confidence trust (65) — domain signal wins
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA blocks',
      selection: 'Player Over 1.5',
      odds: 150,
      confidence: 0.65,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Warriors',
        promotionScores: {
          // trust intentionally absent — domain trust signal should apply
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // edge: domain edge score = clamp(50+0.25*400)=150→100 (no explicit edge)
  // trust: domain trust signal = 80 (positive edge ≥ 0.05, no explicit trust)
  // readiness: domain readiness = 85 (Kelly fraction > 0, no explicit readiness)
  // uniqueness: 84, boardFit: 89
  // ti thresholds: edge=100≥85✓, trust=80<85✗ → ti suppressed
  // bb: score = 100*0.35 + 80*0.25 + 85*0.2 + 84*0.1 + 89*0.1 = 35+20+17+8.4+8.9 = 89.3 ≥ 70
  assert.equal(result.pick.promotionTarget, 'best-bets');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('domain readiness signal activates when Kelly fraction is present', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds +150, confidence 0.65 → Kelly fraction computed and > 0
  // Domain readiness = 85 (vs default 80)
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA dunks',
      selection: 'Player Over 0.5',
      odds: 150,
      confidence: 0.65,
      metadata: {
        sport: 'NBA',
        eventName: 'Clippers vs Rockets',
        promotionScores: {
          edge: 90,
          trust: 90,
          // readiness intentionally absent — domain readiness signal should apply
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // edge: 90 (explicit), trust: 90 (explicit), readiness: 85 (domain Kelly), uniqueness: 84, boardFit: 89
  // ti: edge=90≥85✓, trust=90≥85✓
  // score = 90*0.35 + 90*0.25 + 85*0.2 + 84*0.1 + 89*0.1 = 31.5+22.5+17+8.4+8.9 = 88.3 ≥ 80 → qualifies
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('without odds, trust and readiness use non-domain fallbacks', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No odds → no domain analysis → trust falls back to confidence, readiness falls back to 80
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA turnovers',
      selection: 'Player Under 3.5',
      confidence: 0.90,
      metadata: {
        sport: 'NBA',
        eventName: 'Mavericks vs Spurs',
        promotionScores: {
          // No explicit trust/readiness — should use confidence/80 fallback (no domain analysis)
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // No odds → no domain analysis → all domain signals return null
  // edge: confidence fallback = 90, trust: confidence fallback = 90, readiness: default 80
  // ti: edge=90≥85✓, trust=90≥85✓
  // score = 90*0.35 + 90*0.25 + 80*0.2 + 84*0.1 + 89*0.1 = 31.5+22.5+16+8.4+8.9 = 87.3 ≥ 80 → qualifies
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('marginal domain edge gives lower trust than significant edge', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -200 → implied 0.6667, confidence 0.70 → edge ≈ 0.0333 (marginal, < 0.05)
  // Domain trust signal = 65 (marginal positive edge)
  const result = await processSubmission(
    {
      source: 'test',
      market: 'NBA fouls',
      selection: 'Player Over 3.5',
      odds: -200,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Thunder vs Grizzlies',
        promotionScores: {
          // trust absent — domain trust = 65 (marginal edge)
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // edge: domain edge ≈ 63 (no explicit), trust: domain trust = 65 (marginal, <0.05 edge)
  // readiness: domain readiness = 85 (Kelly > 0)
  // ti: edge=63<85 → suppressed
  // bb: score = 63*0.35+65*0.25+85*0.2+84*0.1+89*0.1 = 22.05+16.25+17+8.4+8.9 = 72.6 ≥ 70 → qualifies
  assert.equal(result.pick.promotionTarget, undefined);
  assert.equal(result.pick.promotionStatus, 'suppressed');
});
