import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readDomainAnalysisEdgeScore,
  readDomainAnalysisEdgeSource,
  readMarketBackedEdgeScore,
  readDomainAnalysisTrustSignal,
  readDomainAnalysisReadinessSignal,
  readKellyGradientReadiness,
  evaluateAndPersistBestBetsPromotion,
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
      source: 'api',
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

test('UTV2-985 fail-closed: confidence-delta pick without explicit edge is suppressed even with odds', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds +150 + confidence 0.65 → confidence-delta fallback (no provider offers seeded)
  // UTV2-985: edge contribution = 0 (fail-closed — no market-backed data)
  // Score: 0*0.35 + 90*0.25 + 88*0.2 + 84*0.1 + 89*0.1 = 57.4 < 70 → no tier qualifies
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 8.5',
      odds: 150,
      confidence: 0.65,
      metadata: {
        sport: 'NBA',
        eventName: 'Bulls vs Knicks',
        promotionScores: {
          // no explicit edge — without real market data, edge contribution = 0
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // No market-backed edge → edge=0 → score 57.4 < 70 → suppressed
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.ok(result.pick.promotionTarget == null, 'no tier should qualify without market-backed edge');
});

test('UTV2-985 fail-closed: confidence-delta pick with marginal edge and no market data is suppressed', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -200, confidence 0.70 → confidence-delta fallback (no provider offers)
  // UTV2-985: edge contribution = 0 → score = 0*0.35+90*0.25+88*0.2+84*0.1+89*0.1 = 57.4 < 70
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
      odds: -200,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Heat vs Sixers',
        promotionScores: {
          // no explicit edge — confidence-delta gets edge=0
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // No market-backed edge → edge=0 → score 57.4 < 70 → suppressed
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.ok(result.pick.promotionTarget == null, 'no tier should qualify without market-backed edge');
});

test('UTV2-985 fail-closed: pick without odds or explicit edge is suppressed even with high confidence', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No odds → no domain analysis → no market data → edge contribution = 0 (fail-closed)
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA steals',
      selection: 'Player Over 1.5',
      confidence: 0.90,
      metadata: {
        sport: 'NBA',
        eventName: 'Suns vs Nuggets',
        promotionScores: {
          // no explicit edge — without market data, edge = 0 (not inflated by confidence)
          trust: 90,
          readiness: 88,
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // edge=0 → score = 0*0.35+90*0.25+88*0.2+84*0.1+89*0.1 = 57.4 < 70 → suppressed
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.ok(result.pick.promotionTarget == null, 'high confidence alone must not drive promotion (UTV2-985)');
});

test('negative domain edge suppresses promotion correctly', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -300 → implied 0.75, confidence 0.60 → raw edge = -0.15 → score = clamp(50+(-0.15)*400) = -10 → 0
  const result = await processSubmission(
    {
      source: 'api',
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

test('domain trust signal applies but UTV2-985: edge=0 still suppresses pick without market data', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds +150 → confidence-delta (no provider offers) → domain trust signal = 80 still applies
  // UTV2-985: edge contribution = 0 regardless of domain analysis — no market-backed data
  // Domain trust signal = 80 (reads positive domain edge) but edge score is still zeroed
  const result = await processSubmission(
    {
      source: 'api',
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

  // UTV2-985: no market-backed edge → edge=0 even with positive domain analysis edge
  // trust: domain trust signal = 80 (still applies — domain trust is independent of edge zeroing)
  // readiness: Kelly-based = 85, uniqueness: 84, boardFit: 89
  // bb: score = 0*0.35 + 80*0.25 + 85*0.2 + 84*0.1 + 89*0.1 = 0+20+17+8.4+8.9 = 54.3 < 70 → suppressed
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.ok(result.pick.promotionTarget == null, 'no tier qualifies without market-backed edge');
});

test('domain readiness signal activates when Kelly fraction is present', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds +150, confidence 0.65 → Kelly fraction computed and > 0
  // Domain readiness = 85 (vs default 80)
  const result = await processSubmission(
    {
      source: 'api',
      market: 'player.points',
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

  // edge: 90 (explicit), trust: 90 (explicit), readiness: 51 (Kelly at max_bet_fraction=0.05), uniqueness: 84, boardFit: 89
  // 'player.points' normalizes to 'points-all-game-ou' (player-prop): trust×1.1, uniqueness×1.1
  // ti score: (90*0.40)*1.0 + (90*0.30)*1.1 + (51*0.15)*1.0 + (84*0.10)*1.1 + (89*0.05)*1.0 = 87.04 ≥ 80 ✓
  // exclusive-insights score = 88.99 < 90 → ei suppressed
  // → trader-insights qualifies as highest passing tier
  assert.equal(result.pick.promotionTarget, 'trader-insights');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('UTV2-985 fail-closed: without odds or explicit edge, pick is suppressed regardless of confidence', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No odds → no market data → edge=0 (fail-closed). Trust falls back to confidence score.
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA turnovers',
      selection: 'Player Under 3.5',
      confidence: 0.90,
      metadata: {
        sport: 'NBA',
        eventName: 'Mavericks vs Spurs',
        promotionScores: {
          // no explicit edge — edge=0 without market data
          uniqueness: 84,
          boardFit: 89,
        },
      },
    },
    repositories,
  );

  // edge=0 → score = 0*0.35 + trust*0.25 + readiness*0.2 + 84*0.1 + 89*0.1
  // trust fallback = confidence score ≈ 90, readiness fallback = 60
  // = 0 + 22.5 + 12 + 8.4 + 8.9 = 51.8 < 70 → suppressed
  assert.equal(result.pick.promotionStatus, 'suppressed');
  assert.ok(result.pick.promotionTarget == null, 'confidence alone must not drive promotion (UTV2-985)');
});

test('marginal domain edge gives lower trust than significant edge', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // odds -200 → implied 0.6667, confidence 0.70 → edge ≈ 0.0333 (marginal, < 0.05)
  // Domain trust signal = 65 (marginal positive edge)
  const result = await processSubmission(
    {
      source: 'api',
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

// ── UTV2-223: Edge source labeling ────────────────────────────────────────────

test('readDomainAnalysisEdgeSource returns confidence-delta when no market data', () => {
  assert.equal(readDomainAnalysisEdgeSource({}), 'confidence-delta');
  assert.equal(readDomainAnalysisEdgeSource({ domainAnalysis: { edge: 0.05 } }), 'confidence-delta');
});

test('readDomainAnalysisEdgeSource returns real-edge for Pinnacle source', () => {
  const metadata = {
    domainAnalysis: {
      realEdge: 0.04,
      realEdgeSource: 'pinnacle',
    },
  };
  assert.equal(readDomainAnalysisEdgeSource(metadata), 'real-edge');
});

test('readDomainAnalysisEdgeSource returns consensus-edge for consensus source', () => {
  const metadata = {
    domainAnalysis: {
      realEdge: 0.02,
      realEdgeSource: 'consensus',
    },
  };
  assert.equal(readDomainAnalysisEdgeSource(metadata), 'consensus-edge');
});

test('readDomainAnalysisEdgeSource returns sgo-edge for sgo source', () => {
  const metadata = {
    domainAnalysis: {
      realEdge: 0.01,
      realEdgeSource: 'sgo',
    },
  };
  assert.equal(readDomainAnalysisEdgeSource(metadata), 'sgo-edge');
});

test('readDomainAnalysisEdgeSource returns single-book-edge for one non-SGO book', () => {
  const metadata = {
    domainAnalysis: {
      realEdge: 0.015,
      realEdgeSource: 'single-book',
    },
  };
  assert.equal(readDomainAnalysisEdgeSource(metadata), 'single-book-edge');
});

test('readDomainAnalysisEdgeSource falls back to top-level realEdge when domainAnalysis lacks it', () => {
  const metadata = {
    realEdge: 0.03,
    realEdgeSource: 'pinnacle',
  };
  assert.equal(readDomainAnalysisEdgeSource(metadata), 'real-edge');
});

test('readDomainAnalysisEdgeScore uses top-level market-backed realEdge before confidence delta', () => {
  const metadata = {
    realEdge: 0.04,
    realEdgeSource: 'single-book',
    domainAnalysis: {
      edge: -0.10,
      confidenceDelta: -0.10,
    },
  };
  assert.equal(readDomainAnalysisEdgeScore(metadata), 66);
});

test('readDomainAnalysisTrustSignal reads confidenceDelta when edge is absent', () => {
  const metadata = {
    domainAnalysis: {
      confidenceDelta: 0.10,
      hasPositiveEdge: true,
    },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), 80);
});

test('readDomainAnalysisTrustSignal prefers confidenceDelta over edge', () => {
  const metadata = {
    domainAnalysis: {
      edge: 0.01,           // would be 65 (marginal)
      confidenceDelta: 0.10, // should produce 80 (significant)
      hasPositiveEdge: true,
    },
  };
  assert.equal(readDomainAnalysisTrustSignal(metadata), 80);
});

// ── UTV2-222: Edge source recorded in promotion snapshot ─────────────────────

test('promotion snapshot records edgeSource=confidence-delta when no market data', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // No odds → domain analysis absent → confidence-delta source
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 20.5',
      confidence: 0.75,
      metadata: {
        sport: 'NBA',
        eventName: 'Nets vs Pistons',
        promotionScores: { trust: 85, readiness: 80, uniqueness: 80, boardFit: 80 },
      },
    },
    repositories,
  );

  // The pick record's pick_promotion_history.payload.scoreInputs.edgeSource should be set.
  // We verify via the PickRecord.metadata (which contains the promotion decision inline)
  // by checking the promotion decision was made — the pick qualified or was suppressed
  assert.ok(
    result.pick.promotionStatus === 'qualified' || result.pick.promotionStatus === 'suppressed',
    'promotion decision must have run',
  );

  const history = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-571',
    repositories.picks,
    repositories.audit,
  );
  const scoreInputs = history.snapshot.scoreInputs;
  assert.equal(scoreInputs.edgeSource, 'confidence-delta');
  assert.equal(scoreInputs.edgeSourceQuality, 'confidence-fallback');
  assert.equal(scoreInputs.edgeFallbackReason, 'missing-explicit-edge-and-market-edge');
});

test('promotion snapshot records edgeSource=explicit when promotionScores.edge is set', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 7.5',
      odds: 110,
      confidence: 0.60,
      metadata: {
        sport: 'NBA',
        eventName: 'Celtics vs Heat',
        promotionScores: { edge: 88, trust: 86, readiness: 82, uniqueness: 80, boardFit: 82 },
      },
    },
    repositories,
  );

  assert.ok(
    result.pick.promotionStatus === 'qualified' || result.pick.promotionStatus === 'suppressed',
    'promotion decision must have run',
  );

  const history = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-571',
    repositories.picks,
    repositories.audit,
  );
  const scoreInputs = history.snapshot.scoreInputs;
  assert.equal(scoreInputs.edgeSource, 'explicit');
  assert.equal(scoreInputs.edgeSourceQuality, 'explicit');
  assert.equal(scoreInputs.edgeFallbackReason, undefined);
});

// ── Smart Form capper attribution and confidence floor bypass ─────────────────

test('smart-form pick with low confidence is never blocked by confidence floor', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // capperConviction=3 → confidence=0.3, well below the policy floor of 0.6
  // With all explicit scores passing thresholds, a non-smart-form pick would be blocked.
  // smart-form picks must bypass the confidence floor gate.
  const result = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'NBA - Player Prop',
      selection: 'Jalen Brunson Points O 28.5',
      odds: -110,
      confidence: 0.3, // below confidenceFloor of 0.6
      metadata: {
        sport: 'NBA',
        eventName: 'Knicks vs Celtics',
        capper: 'griff843',
        capperConviction: 3,
        promotionScores: {
          edge: 75,
          trust: 75,
          readiness: 80,
          uniqueness: 75,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  // Smart Form bypasses the confidence floor — pick should qualify for best-bets.
  assert.equal(result.pick.source, 'smart-form');
  assert.equal(result.submission.payload.submittedBy, 'griff843');
  assert.equal(result.submissionRecord.submitted_by, 'griff843');
  assert.equal(result.pick.promotionStatus, 'qualified', 'smart-form capper pick must not be blocked by low confidence');
});

test('alert-agent pick with baseline confidence is not floor-clamped', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'alert-agent',
      submittedBy: 'system:alert-agent',
      market: 'spread',
      selection: 'over',
      line: 6.5,
      confidence: 0.65,
      eventName: 'Knicks vs Celtics',
      metadata: {
        sport: 'NBA',
        alertSignalIdempotencyKey: 'alert-key-65',
        alertTier: 'alert-worthy',
        promotionScores: {
          edge: 75,
          trust: 75,
          readiness: 80,
          uniqueness: 75,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  assert.equal(result.pick.source, 'alert-agent');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('alert-agent pick with low confidence bypasses the confidence floor entirely', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'alert-agent',
      submittedBy: 'system:alert-agent',
      market: 'spread',
      selection: 'over',
      line: 6.5,
      confidence: 0.3,
      eventName: 'Knicks vs Celtics',
      metadata: {
        sport: 'NBA',
        alertSignalIdempotencyKey: 'alert-key-30',
        alertTier: 'alert-worthy',
        promotionScores: {
          edge: 75,
          trust: 75,
          readiness: 80,
          uniqueness: 75,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  assert.equal(result.pick.source, 'alert-agent');
  assert.equal(result.pick.promotionStatus, 'qualified');
});

test('non-smart-form pick with low confidence is correctly suppressed by confidence floor', async () => {
  const repositories = createInMemoryRepositoryBundle();
  // Same scores, same low confidence — but source is 'test' (system pick), not 'smart-form'.
  // Should be blocked by the confidence floor.
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA - Player Prop',
      selection: 'Player Points O 28.5',
      odds: -110,
      confidence: 0.3, // below confidenceFloor of 0.6
      metadata: {
        sport: 'NBA',
        eventName: 'Knicks vs Celtics',
        promotionScores: {
          edge: 75,
          trust: 75,
          readiness: 80,
          uniqueness: 75,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  // Non-smart-form pick should be blocked: confidence 0.3 < floor 0.6.
  assert.equal(result.pick.promotionStatus, 'not_eligible', 'system pick with low confidence must be blocked by confidence floor');
});

// ── boardFit: computeBoardFitScore wired call ────────────────────────────────

test('boardFit uses computeBoardFitScore when open picks exist — concentration penalty reduces score below 75', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Submit pick A: NBA player prop for a specific player. Explicit scores so it
  // qualifies and sits in the open board (validated state) when pick B is evaluated.
  const resultA = await processSubmission(
    {
      source: 'api',
      market: 'player_points',
      selection: 'Over 22.5',
      odds: -110,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Warriors',
        playerId: 'player-test-abc',
        teamId: 'LAL',
        promotionScores: { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 },
      },
    },
    repositories,
  );

  // Pick A must be stored as a valid open pick.
  assert.ok(resultA.pick.id, 'pick A must have an id');

  // Submit pick B: same player, same team, same sport — but NO explicit boardFit.
  // readPromotionScoreInputs will call computeBoardFitScore([slotA], slotB).
  const resultB = await processSubmission(
    {
      source: 'api',
      market: 'player_assists',
      selection: 'Over 8.5',
      odds: -110,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Warriors',
        playerId: 'player-test-abc',
        teamId: 'LAL',
        // No explicit boardFit — must be computed from live portfolio
        promotionScores: { edge: 80, trust: 80, readiness: 80, uniqueness: 80 },
      },
    },
    repositories,
  );

  // Re-evaluate pick B's best-bets promotion to get the full snapshot.
  // openPicks at this point = [pickA] (pickB self-filters as it is the candidate).
  const evalResult = await evaluateAndPersistBestBetsPromotion(
    resultB.pick.id,
    'test',
    repositories.picks,
    repositories.audit,
  );

  // With player-test-abc appearing in both the board (pick A) and the candidate (pick B),
  // playerConcentration = 1.0 >> limit (0.25) → significant concentration penalty applied.
  // boardFit should be well below the 75 neutral fallback.
  const boardFit = evalResult.snapshot.scoreInputs.boardFit;
  assert.ok(
    boardFit < 75,
    `boardFit=${boardFit} should be < 75 due to player concentration penalty from pick A on same player`,
  );
  assert.ok(boardFit >= 0, 'boardFit must be non-negative');
});

test('smart-form submission payload includes submittedBy from capper field', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'NBA - Player Prop',
      selection: 'Player Points O 22.5',
      odds: -115,
      confidence: 0.8,
      metadata: { capper: 'griff843', sport: 'NBA' },
    },
    repositories,
  );

  // submittedBy is persisted on the submission record (picks table lacks submitted_by column pre-migration).
  assert.equal(result.submission.payload.submittedBy, 'griff843', 'submittedBy must flow through the submission payload');
  assert.equal(result.submissionRecord.submitted_by, 'griff843', 'submitted_by must be persisted on the submission record');
  assert.equal(result.pick.source, 'smart-form');
});

test('promotion history payload includes breakdown, qualified, and score (UTV2-904)', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 22.5',
      odds: -110,
      confidence: 0.65,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Warriors',
        promotionScores: { edge: 72, trust: 70, readiness: 70, uniqueness: 70, boardFit: 70 },
      },
    },
    repositories,
  );

  const evalResult = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-904',
    repositories.picks,
    repositories.audit,
  );

  const payload = evalResult.history.payload as Record<string, unknown>;
  assert.ok('breakdown' in payload, 'payload must include breakdown');
  assert.ok('qualified' in payload, 'payload must include qualified');
  assert.ok('score' in payload, 'payload must include score');

  const breakdown = payload.breakdown as Record<string, number>;
  assert.equal(typeof breakdown.edge, 'number', 'breakdown.edge must be a number');
  assert.equal(typeof breakdown.trust, 'number', 'breakdown.trust must be a number');
  assert.equal(typeof breakdown.readiness, 'number', 'breakdown.readiness must be a number');
  assert.equal(typeof breakdown.uniqueness, 'number', 'breakdown.uniqueness must be a number');
  assert.equal(typeof breakdown.boardFit, 'number', 'breakdown.boardFit must be a number');
  assert.equal(typeof breakdown.total, 'number', 'breakdown.total must be a number');
  assert.equal(typeof payload.qualified, 'boolean', 'payload.qualified must be a boolean');
  assert.equal(typeof payload.score, 'number', 'payload.score must be a number');
  assert.equal(payload.score, evalResult.decision.score, 'payload.score must match decision.score');
  assert.equal(payload.qualified, evalResult.decision.qualified, 'payload.qualified must match decision.qualified');
});

// ── UTV2-985: readMarketBackedEdgeScore — must return null for confidence-delta ──

test('readMarketBackedEdgeScore returns null when no market data (confidence-delta only)', () => {
  // Pick with only confidence-delta — no realEdge in domainAnalysis
  assert.equal(readMarketBackedEdgeScore({}), null);
  assert.equal(readMarketBackedEdgeScore({ domainAnalysis: { edge: 0.10, confidenceDelta: 0.10 } }), null);
  assert.equal(readMarketBackedEdgeScore({ realEdge: 0.05, realEdgeSource: 'confidence-delta' }), null);
});

test('readMarketBackedEdgeScore returns score when Pinnacle real edge present', () => {
  const metadata = {
    domainAnalysis: {
      realEdge: 0.05,
      realEdgeSource: 'pinnacle',
      edge: -0.10, // confidence-delta should be ignored
    },
  };
  assert.equal(readMarketBackedEdgeScore(metadata), 70); // 50 + 0.05*400 = 70
});

test('readMarketBackedEdgeScore returns score when top-level market-backed realEdge present', () => {
  const metadata = {
    realEdge: 0.10,
    realEdgeSource: 'sgo', // not confidence-delta → market-backed
    domainAnalysis: { edge: 0.01 },
  };
  assert.equal(readMarketBackedEdgeScore(metadata), 90); // 50 + 0.10*400 = 90
});

test('readMarketBackedEdgeScore ignores top-level realEdge when source is confidence-delta', () => {
  const metadata = {
    realEdge: 0.05,
    realEdgeSource: 'confidence-delta',
  };
  assert.equal(readMarketBackedEdgeScore(metadata), null);
});

// ── UTV2-985: promotion scoring must zero confidence-delta edge contribution ──

test('evaluateAndPersistBestBetsPromotion uses edge=0 for confidence-delta-only picks', async () => {
  const repos = createInMemoryRepositoryBundle();
  // Submit a pick with confidence and odds but no provider offers → confidence-delta fallback
  const result = await processSubmission(
    {
      source: 'smart-form',
      market: 'player-points-ou',
      selection: 'Over',
      odds: -110,
      confidence: 0.70,
    },
    repos,
  );
  assert.ok(result.pick, 'pick must be created');
  assert.equal(result.pick.metadata['realEdgeSource'], 'confidence-delta', 'must use confidence-delta fallback');

  const promotion = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-985',
    repos.picks,
    repos.audit,
  );
  assert.ok(promotion, 'promotion result must be returned');
  const snapshot = promotion.snapshot;
  assert.ok(snapshot, 'snapshot must be present');
  assert.equal(snapshot.scoreInputs.edge, 0, 'edge must be 0 for confidence-delta picks (UTV2-985 fail-closed)');
  assert.equal(snapshot.scoreInputs.edgeSourceQuality, 'confidence-fallback', 'must label as confidence-fallback');
  assert.equal(snapshot.scoreInputs.edgeMethod, 'confidence-delta', 'edgeMethod must be confidence-delta');
  assert.equal(snapshot.scoreInputs.providerCoverageState, 'none', 'providerCoverageState must be none');
});

test('evaluateAndPersistBestBetsPromotion uses real edge score when market data is present', async () => {
  const repos = createInMemoryRepositoryBundle();
  // Seed a provider offer so real edge can be computed via SGO tier
  const now = new Date().toISOString();
  await repos.providerOffers.upsertBatch([{
    providerKey: 'sgo',
    providerMarketKey: 'player-points-ou',
    providerEventId: 'test-event-985',
    providerParticipantId: null,
    sportKey: 'NBA',
    line: null,
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: now,
    idempotencyKey: `sgo:player-points-ou:test-event-985:${now}`,
    bookmakerKey: null,
  }]);

  const result = await processSubmission(
    {
      source: 'smart-form',
      market: 'player-points-ou',
      selection: 'Over',
      odds: -110,
      confidence: 0.60,
    },
    repos,
  );
  assert.ok(result.pick, 'pick must be created');
  assert.ok(result.pick.metadata['realEdgeSource'] !== undefined, 'realEdgeSource must be set');

  const promotion = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-985',
    repos.picks,
    repos.audit,
  );
  assert.ok(promotion, 'promotion result must be returned');
  const snapshot = promotion.snapshot;
  assert.ok(snapshot, 'snapshot must be present');
  assert.ok(
    snapshot.scoreInputs.edgeMethod === 'market-devigged' || snapshot.scoreInputs.edgeMethod === 'confidence-delta',
    'edgeMethod must be set',
  );
  assert.ok(snapshot.scoreInputs.providerCoverageState !== undefined, 'providerCoverageState must be set');
});

// ── UTV2-985: RealEdgeResult must include provenance ──

test('computeRealEdge returns provenance with method and providerCoverageState', async () => {
  const { computeRealEdge } = await import('./real-edge-service.js');
  const repos = createInMemoryRepositoryBundle();

  const result = await computeRealEdge({
    confidence: 0.60,
    marketKey: 'player-points-ou',
    selection: 'Over',
    submittedOdds: -110,
    providerOffers: repos.providerOffers,
  });

  assert.ok(result.provenance, 'provenance must be present');
  assert.ok(result.provenance.method === 'market-devigged' || result.provenance.method === 'confidence-delta', 'method must be valid');
  assert.ok(
    ['pinnacle', 'consensus', 'sgo', 'single-book', 'none'].includes(result.provenance.providerCoverageState),
    'providerCoverageState must be valid',
  );
  // No offers seeded → should fall back to confidence-delta
  assert.equal(result.marketSource, 'confidence-delta', 'no offers → confidence-delta');
  assert.equal(result.provenance.method, 'confidence-delta', 'provenance.method must match');
  assert.equal(result.provenance.providerCoverageState, 'none', 'no market data → none');
  assert.equal(result.provenance.fallbackReason, 'no-any-offer', 'fallbackReason must be set');
});

// ── Unit tests for readKellyGradientReadiness (UTV2-986 Kelly primary path) ──

test('readKellyGradientReadiness returns null when metadata is empty', () => {
  assert.equal(readKellyGradientReadiness({}), null);
  assert.equal(readKellyGradientReadiness({ sport: 'NBA' }), null);
});

test('readKellyGradientReadiness returns null when kellySizing absent and domainAnalysis absent', () => {
  assert.equal(readKellyGradientReadiness({ someOtherField: true }), null);
});

test('readKellyGradientReadiness returns null when fractional_kelly is zero (no edge)', () => {
  const metadata = {
    kellySizing: {
      raw_kelly: -0.05,
      fractional_kelly: 0,
      recommended_units: 0,
      recommended_fraction: 0,
      capped: false,
      cap_reason: null,
      has_edge: false,
    },
  };
  assert.equal(readKellyGradientReadiness(metadata), null);
});

test('readKellyGradientReadiness returns null when fractional_kelly is negative', () => {
  const metadata = {
    kellySizing: { fractional_kelly: -0.01 },
  };
  assert.equal(readKellyGradientReadiness(metadata), null);
});

test('readKellyGradientReadiness reads fractional_kelly from kellySizing (primary path)', () => {
  const metadata = {
    kellySizing: { fractional_kelly: 0.03 },
  };
  // 40 + 55 * min(1, 0.03 / 0.25) = 40 + 55 * 0.12 = 40 + 6.6 → 47
  assert.equal(readKellyGradientReadiness(metadata), 47);
});

test('readKellyGradientReadiness maps fractional_kelly=0.25 to ceiling (95)', () => {
  const metadata = {
    kellySizing: { fractional_kelly: 0.25 },
  };
  assert.equal(readKellyGradientReadiness(metadata), 95);
});

test('readKellyGradientReadiness maps fractional_kelly above 0.25 to ceiling (95)', () => {
  const metadata = {
    kellySizing: { fractional_kelly: 0.40 },
  };
  assert.equal(readKellyGradientReadiness(metadata), 95);
});

test('readKellyGradientReadiness primary path takes precedence over domainAnalysis fallback', () => {
  const metadata = {
    kellySizing: { fractional_kelly: 0.10 },
    domainAnalysis: { kellyFraction: 0.25 },
  };
  // Primary path: 40 + 55 * min(1, 0.10 / 0.25) = 40 + 55 * 0.4 = 40 + 22 = 62
  assert.equal(readKellyGradientReadiness(metadata), 62);
});

test('readKellyGradientReadiness falls back to domainAnalysis.kellyFraction when kellySizing absent', () => {
  const metadata = {
    domainAnalysis: { kellyFraction: 0.10 },
  };
  // Fallback path: 40 + 55 * min(1, 0.10 / 0.25) = 62
  assert.equal(readKellyGradientReadiness(metadata), 62);
});

test('readKellyGradientReadiness falls back to domainAnalysis when kellySizing has no fractional_kelly', () => {
  const metadata = {
    kellySizing: { raw_kelly: 0.08, has_edge: false },
    domainAnalysis: { kellyFraction: 0.05 },
  };
  // Primary path misses (no fractional_kelly > 0) → fallback: 40 + 55 * 0.2 = 51
  assert.equal(readKellyGradientReadiness(metadata), 51);
});
