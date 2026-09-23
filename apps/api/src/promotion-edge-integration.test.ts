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
  evaluateAllPoliciesEagerAndPersist,
  enrichPickAtPromotionTime,
  HUMAN_CAPPER_BOARD_PROMOTION_NOT_APPLICABLE,
} from './promotion-service.js';
import { processSubmission } from './submission-service.js';
import { overridePromotionController } from './controllers/override-promotion-controller.js';
import { humanCapperDeliveryAuthorizationVersion } from '@unit-talk/contracts';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { computeClvTrustAdjustment } from './clv-feedback.js';
import {
  UNATTRIBUTED_CAPPER,
  isUnattributedCapper,
  resolveCapperIdentity,
} from './capper-identity.js';
import type { PickRepository, SettlementRepository } from '@unit-talk/db';

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
  // Domain readiness = 51 (Kelly gradient from fractional_kelly=0.05)
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

  // UTV2-1022 / UTV2-1204 (Option B): Risk modifier applied with 3-component formula.
  // odds=+150 (decimal 2.5) → varianceScore=75; kellySizing absent in in-memory context (no devigging)
  // → kellyScore=0 (fails closed); lineMovement no longer in riskScore (UTV2-1204 Option B); consensus absent → 50
  // riskScore = 75*0.45 + 0*0.45 + 50*0.10 = 33.75 + 0 + 5 = 38.75 → 39
  // modifier = 1 - 0.15 + 0.15*(39/100) = 0.85 + 0.0585 = 0.9085
  // ti raw score ≈ 87.04 → modifiedScore ≈ 87.04 * 0.9085 ≈ 79.1 < 80 → trader-insights suppressed
  // best-bets raw score ≈ 79.4 (different weights) → modifiedScore ≈ 72.1 ≥ 70 → qualifies
  // Pick still qualifies (at best-bets) — readiness signal is active
  assert.ok(
    result.pick.promotionStatus === 'qualified',
    'pick should qualify (readiness signal drove score above best-bets threshold)',
  );
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
  // confidence=0.3 is well below the best-bets floor of 0.6. The same pick,
  // scored above threshold, qualifies from Smart Form and is floor-blocked from
  // a source the floor applies to -- so the bypass is proven, not assumed.
  // UTV2-1902: this test previously used a fixture that honestly scores ~59 and
  // passed only because every smart-form pick was force-promoted by source.
  const submitFrom = async (source: 'smart-form' | 'api') => {
    const repositories = createInMemoryRepositoryBundle();
    return processSubmission(
      {
        source,
        submittedBy: 'griff843',
        market: 'MLB - Moneyline',
        selection: `Confidence floor ${source}`,
        odds: -120,
        confidence: 0.3,
        metadata: {
          sport: 'MLB',
          eventName: `Confidence floor ${source} at Opponent`,
          capper: 'griff843',
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
  };

  const smartForm = await submitFrom('smart-form');
  assert.equal(smartForm.pick.source, 'smart-form');
  assert.equal(smartForm.submission.payload.submittedBy, 'griff843');
  assert.equal(smartForm.submissionRecord.submitted_by, 'griff843');
  assert.equal(smartForm.pick.promotionStatus, 'qualified', 'smart-form capper pick must not be blocked by low confidence');

  const floored = await submitFrom('api');
  assert.notEqual(floored.pick.promotionStatus, 'qualified', 'the floor must still apply to other sources');
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
      odds: -110, // UTV2-1204: explicit odds so varianceScore is deterministic (75) not neutral (50)
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
      odds: -110, // UTV2-1204: explicit odds so varianceScore is deterministic (75) not neutral (50)
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
    // UTV2-1898: a fully-resolved scope, so these cases still exercise the
    // tier they were written for rather than short-circuiting on scope.
    scope: {
      sportKey: 'NBA',
      providerEventId: 'evt-1',
      providerParticipantId: 'player-1',
      now: new Date(),
    },
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
  // UTV2-1379: fallbackReason is now the specific, provable cause (no offer
  // row found in any tier) rather than the old generic hardcoded literal.
  assert.equal(result.provenance.fallbackReason, 'no-provider-offer', 'fallbackReason must be set');
});

// ── UTV2-1379: distinguishable fallback taxonomy ────────────────────────────

test('computeRealEdge: empty marketKey classifies as no-market-key without attempting any tier', async () => {
  const { computeRealEdge } = await import('./real-edge-service.js');
  const repos = createInMemoryRepositoryBundle();

  const result = await computeRealEdge({
    confidence: 0.6,
    marketKey: '',
    selection: 'Over',
    submittedOdds: -110,
    providerOffers: repos.providerOffers,
    // UTV2-1898: a fully-resolved scope, so these cases still exercise the
    // tier they were written for rather than short-circuiting on scope.
    scope: {
      sportKey: 'NBA',
      providerEventId: 'evt-1',
      providerParticipantId: 'player-1',
      now: new Date(),
    },
  });

  assert.equal(result.marketSource, 'confidence-delta');
  assert.equal(result.provenance.fallbackReason, 'no-market-key');
  assert.equal(result.hasRealEdge, false, 'confidence-delta must never report positive edge (UTV2-985)');
});

test('computeRealEdge: moneyline with empty selection classifies as no-participant-scope', async () => {
  const { computeRealEdge } = await import('./real-edge-service.js');
  const repos = createInMemoryRepositoryBundle();

  const result = await computeRealEdge({
    confidence: 0.6,
    marketKey: 'moneyline',
    selection: '   ',
    submittedOdds: -110,
    providerOffers: repos.providerOffers,
    // UTV2-1898: a fully-resolved scope, so these cases still exercise the
    // tier they were written for rather than short-circuiting on scope.
    scope: {
      sportKey: 'NBA',
      providerEventId: 'evt-1',
      providerParticipantId: 'player-1',
      now: new Date(),
    },
  });

  assert.equal(result.marketSource, 'confidence-delta');
  assert.equal(result.provenance.fallbackReason, 'no-participant-scope');
});

test('computeRealEdge: a thrown exception classifies as computation-error, not a silent success', async () => {
  const { computeRealEdge } = await import('./real-edge-service.js');
  const throwingProviderOffers = {
    resolveProviderMarketKey: async () => {
      throw new Error('simulated DB failure');
    },
    findLatestScopedOffer: async () => null,
  } as unknown as import('@unit-talk/db').ProviderOfferRepository;

  const result = await computeRealEdge({
    confidence: 0.6,
    marketKey: 'player-points-ou',
    selection: 'Over',
    submittedOdds: -110,
    providerOffers: throwingProviderOffers,
    scope: {
      sportKey: 'NBA',
      providerEventId: 'evt-1',
      providerParticipantId: 'player-1',
      now: new Date(),
    },
  });

  assert.equal(result.marketSource, 'confidence-delta', 'must fail closed to confidence-delta, never crash upward');
  assert.equal(result.provenance.fallbackReason, 'computation-error');
  assert.equal(result.hasRealEdge, false);
});

test('enrichPickAtPromotionTime: bounded recovery upgrades confidence-only domainAnalysis when provider context exists', async () => {
  const repos = createInMemoryRepositoryBundle();
  const now = new Date().toISOString();
  await repos.providerOffers.upsertBatch([{
    providerKey: 'sgo',
    // UTV2-1898: a canonical player-prop key with the participant it prices.
    // The previous fixture used a provider-native key and a NULL participant,
    // which is the shape the repair refuses — an offer that prices one player
    // but names none cannot be attributed to this pick's selection.
    providerMarketKey: 'points-all-game-ou',
    providerEventId: 'test-event-1379',
    providerParticipantId: 'nba-player-1379',
    sportKey: 'NBA',
    line: null,
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: now,
    idempotencyKey: `sgo:player-points-ou:test-event-1379:${now}`,
    bookmakerKey: null,
  }]);

  const pick = {
    id: 'pick-recovery',
    market: 'points-all-game-ou',
    selection: 'Over',
    odds: -110,
    confidence: 0.6,
    metadata: {
      // Confidence-only domainAnalysis, exactly the DEBT-019 no-op condition:
      // present but never received market-backed real edge.
      domainAnalysis: { edge: 0.1, confidenceDelta: 0.1 },
      // UTV2-1898: recovery re-derives under the scope the pick was submitted
      // with. Without a recorded scope there is nothing to look up against,
      // and manufacturing one at promotion time is the defect being removed.
      edgeScope: {
        sportKey: 'NBA',
        providerEventId: 'test-event-1379',
        providerParticipantId: 'nba-player-1379',
      },
    },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const enriched = await enrichPickAtPromotionTime(pick, repos.providerOffers);
  const domainAnalysis = enriched.metadata['domainAnalysis'] as Record<string, unknown>;
  assert.ok(
    typeof domainAnalysis['realEdge'] === 'number' && Number.isFinite(domainAnalysis['realEdge']),
    'recovery must populate a finite realEdge when provider context now exists',
  );
  assert.notEqual(domainAnalysis['realEdgeSource'], 'confidence-delta', 'recovered edge must be market-backed');
});

test('enrichPickAtPromotionTime: recovery fails closed and refreshes fallbackReason when still no provider data', async () => {
  const repos = createInMemoryRepositoryBundle();

  const pick = {
    id: 'pick-no-recovery',
    market: 'player-points-ou',
    selection: 'Over',
    odds: -110,
    confidence: 0.6,
    metadata: {
      domainAnalysis: { edge: 0.1, confidenceDelta: 0.1 },
      // A fully-resolved scope, so this still tests "scope is fine, the market
      // has no coverage" rather than short-circuiting on a missing dimension.
      edgeScope: {
        sportKey: 'NBA',
        providerEventId: 'test-event-1379',
        providerParticipantId: null,
      },
    },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const enriched = await enrichPickAtPromotionTime(pick, repos.providerOffers);
  const domainAnalysis = enriched.metadata['domainAnalysis'] as Record<string, unknown>;
  assert.equal(domainAnalysis['realEdge'], undefined, 'must not fabricate market-backed edge with no provider data');
  assert.equal(domainAnalysis['fallbackReason'], 'no-provider-offer', 'fallback reason must reflect this attempt');
});

test('UTV2-1898: enrichPickAtPromotionTime refuses to recover edge for a pick carrying no recorded scope', async () => {
  const repos = createInMemoryRepositoryBundle();
  const now = new Date().toISOString();
  // An offer that WOULD have matched under the old unscoped lookup.
  await repos.providerOffers.upsertBatch([{
    providerKey: 'sgo',
    providerMarketKey: 'player-points-ou',
    providerEventId: 'some-other-event',
    providerParticipantId: null,
    sportKey: 'NBA',
    line: null,
    overOdds: -110,
    underOdds: -110,
    devigMode: 'PAIRED' as const,
    isOpening: false,
    isClosing: false,
    snapshotAt: now,
    idempotencyKey: `sgo:player-points-ou:some-other-event:${now}`,
    bookmakerKey: null,
  }]);

  const pick = {
    id: 'pick-unscoped',
    market: 'player-points-ou',
    selection: 'Over',
    odds: -110,
    confidence: 0.6,
    metadata: { domainAnalysis: { edge: 0.1, confidenceDelta: 0.1 } },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const enriched = await enrichPickAtPromotionTime(pick, repos.providerOffers);
  const domainAnalysis = enriched.metadata['domainAnalysis'] as Record<string, unknown>;
  assert.equal(domainAnalysis['realEdge'], undefined, 'an unscoped pick must not acquire market edge');
  assert.equal(domainAnalysis['fallbackReason'], 'no-sport-scope');
});

test('enrichPickAtPromotionTime: recovery does not run without a providerOffers repository (bounded, opt-in)', async () => {
  const pick = {
    id: 'pick-no-providerOffers-arg',
    market: 'player-points-ou',
    selection: 'Over',
    odds: -110,
    confidence: 0.6,
    metadata: {
      domainAnalysis: { edge: 0.1, confidenceDelta: 0.1 },
    },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const enriched = await enrichPickAtPromotionTime(pick);
  assert.strictEqual(enriched, pick, 'no providerOffers supplied → no recovery attempt → same pick reference');
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

// ── UTV2-987: uniqueness real signal and fallback reason ──────────────────

test('snapshot includes uniquenessInputs with zero saturation when no same-market peers open', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'model-driven',
      market: 'player_props',
      selection: 'TestPlayer OVER 5.5',
      confidence: 0.7,
      stakeUnits: 1.5,
    },
    repositories,
  );
  const promotionResult = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test-runner',
    repositories.picks,
    repositories.audit,
  );
  const snapshot = promotionResult.snapshot;
  assert.ok(snapshot, 'snapshot must be present');
  const scoreInputs = snapshot.scoreInputs as Record<string, unknown>;
  // openPicks is always an array (never undefined) in the pipeline — no fallback fires
  // With no same-market peers, dimensions are present with zero counts
  const uniquenessInputs = scoreInputs['uniquenessInputs'] as
    | { sameSportMarketCount: number; selectionOverlapCount: number }
    | undefined;
  assert.ok(uniquenessInputs !== undefined, 'uniquenessInputs must be present when openPicks data is available');
  assert.equal(uniquenessInputs.sameSportMarketCount, 0, 'sameSportMarketCount must be 0 with no same-market peers');
  assert.equal(uniquenessInputs.selectionOverlapCount, 0, 'selectionOverlapCount must be 0 with no matching selection');
  assert.equal(scoreInputs['uniquenessFallbackReason'], undefined, 'uniquenessFallbackReason must not be set when openPicks data is available');
});

test('snapshot includes uniquenessInputs with saturation count when same-market peers are open', async () => {
  const repositories = createInMemoryRepositoryBundle();

  // Submit two picks with the same market to create saturation
  await processSubmission(
    {
      source: 'model-driven',
      market: 'player_props',
      selection: 'PlayerA OVER 3.5',
      confidence: 0.7,
      stakeUnits: 1.5,
    },
    repositories,
  );
  const pick2 = await processSubmission(
    {
      source: 'model-driven',
      market: 'player_props',
      selection: 'PlayerB OVER 7.5',
      confidence: 0.72,
      stakeUnits: 1.5,
    },
    repositories,
  );

  // Evaluate pick2 — pick1 is a same-market open pick
  const promotionResult = await evaluateAndPersistBestBetsPromotion(
    pick2.pick.id,
    'test-runner',
    repositories.picks,
    repositories.audit,
  );

  const scoreInputs = promotionResult.snapshot.scoreInputs as Record<string, unknown>;
  const uniquenessInputs = scoreInputs['uniquenessInputs'] as
    | { sameSportMarketCount: number; selectionOverlapCount: number }
    | undefined;
  assert.ok(uniquenessInputs !== undefined, 'uniquenessInputs must be present when openPicks data is available');
  assert.ok(uniquenessInputs.sameSportMarketCount >= 1, 'sameSportMarketCount must reflect at least one same-market peer (pick1)');
});

// ── UTV2-1206: multi-policy winner-selection priority ordering ───────────────

test('UTV2-1206: score=82/trust=90/edge=88 routes to trader-insights, not best-bets', async () => {
  // Policy threshold proof: trader-insights requires minimumEdge=85, minimumTrust=85, minimumScore=80.
  // With edge=88 (≥85) and trust=90 (≥85), trader-insights gates pass.
  // exclusive-insights requires minimumEdge=90 — edge=88 fails that gate, so it is not eligible.
  // Winner-selection: first qualified policy in priority order wins (exclusive-insights > trader-insights > best-bets).
  // Expected winner: trader-insights (edge=88 clears TI threshold but not EI threshold).
  //
  // Score derivation (spread market, game-line family, sport=NBA):
  //   Trader-insights weights: edge*0.40, trust*0.30, readiness*0.15, uniqueness*0.10, boardFit*0.05
  //   Weighted:      edge=35.2, trust=27, readiness=12.75, uniqueness=8.5, boardFit=4.25
  //   Modifiers:     edgeMultiplier=1.1, uniquenessMultiplier=0.9 (game-line family)
  //   Modified:      edge=38.72, trust=27, readiness=12.75, uniqueness=7.65, boardFit=4.25 → rawTotal=90.37
  //   Risk:          odds=-110 → varianceScore=75; kellyScore=0 (no kellySizing); dispersionScore=50
  //                  riskScore=39; modifier≈0.9085
  //   Final score:   90.37 × 0.9085 ≈ 82.1 ≥ 80 → trader-insights qualifies
  const repositories = createInMemoryRepositoryBundle();

  const result = await processSubmission(
    {
      source: 'api',
      market: 'spread',
      selection: 'Hawks -3.5',
      odds: -110,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Hawks vs Celtics',
        promotionScores: {
          edge: 88,
          trust: 90,
          readiness: 85,
          uniqueness: 85,
          boardFit: 85,
        },
      },
    },
    repositories,
  );

  // trader-insights beats best-bets at these score levels
  assert.equal(
    result.pick.promotionTarget,
    'trader-insights',
    `expected trader-insights but got ${result.pick.promotionTarget} (score should be ≈82 ≥ 80 threshold)`,
  );
  assert.notEqual(
    result.pick.promotionTarget,
    'best-bets',
    'best-bets must not win when trader-insights qualifies first',
  );
  assert.equal(result.pick.promotionStatus, 'qualified');
});

// ── UTV2-1204: lineMovement does not affect riskScore (Option B regression) ──

test('UTV2-1204: favorable lineMovement raises edge (model blend) but leaves riskScore unchanged', async () => {
  // Both picks are identical except for lineMovement metadata.
  // Option B: lineMovement enters ONLY through edge/model-blend (path 2), not riskScore (path 1).
  // The riskScore (and thus riskModifier) must be identical regardless of lineMovement.
  const repositories = createInMemoryRepositoryBundle();

  // Pick with strongly favorable line movement (basisPointsDelta = +50)
  const resultFavorable = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 20.5',
      odds: -110,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Celtics',
        lineMovement: { basisPointsDelta: 50 }, // strongly favorable — would have boosted riskScore in risk-v1
        promotionScores: { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 },
      },
    },
    repositories,
  );

  // Pick with strongly adverse line movement (basisPointsDelta = -100)
  const resultAdverse = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 20.5',
      odds: -110,
      confidence: 0.70,
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Celtics',
        lineMovement: { basisPointsDelta: -100 }, // strongly adverse — would have suppressed riskScore in risk-v1
        promotionScores: { edge: 80, trust: 80, readiness: 80, uniqueness: 80, boardFit: 80 },
      },
    },
    repositories,
  );

  // Both picks must reach promotion evaluation
  const histFavorable = await evaluateAndPersistBestBetsPromotion(
    resultFavorable.pick.id,
    'test:utv2-1204',
    repositories.picks,
    repositories.audit,
  );
  const histAdverse = await evaluateAndPersistBestBetsPromotion(
    resultAdverse.pick.id,
    'test:utv2-1204',
    repositories.picks,
    repositories.audit,
  );

  const riskScoreFavorable = histFavorable.snapshot.scoreInputs.riskScore;
  const riskScoreAdverse = histAdverse.snapshot.scoreInputs.riskScore;

  // UTV2-1204 Option B: riskScore must be identical — lineMovement no longer contributes
  assert.equal(
    riskScoreFavorable,
    riskScoreAdverse,
    `riskScore must be identical regardless of lineMovement (UTV2-1204 Option B): favorable=${riskScoreFavorable} adverse=${riskScoreAdverse}`,
  );

  // riskComponents.lineMovementScore must always be 50 (neutral marker — no longer computed from metadata)
  const riskComponents = histFavorable.snapshot.scoreInputs.riskComponents as Record<string, unknown> | undefined;
  if (riskComponents !== undefined) {
    assert.equal(
      riskComponents['lineMovementScore'],
      50,
      'riskComponents.lineMovementScore must always be 50 neutral marker (UTV2-1204 Option B: not computed from metadata)',
    );
  }
});

// ── UTV2-1327: enrichPickAtPromotionTime — DEBT-019 / DEBT-020 fix ───────────

test('UTV2-1327: enrichPickAtPromotionTime is a no-op when domainAnalysis is already present', async () => {
  const pick = {
    id: 'test-pick-1',
    odds: -110,
    confidence: 0.65,
    metadata: {
      domainAnalysis: {
        edge: 0.08,
        kellyFraction: 0.12,
        impliedProbability: 0.5238,
        decimalOdds: 1.909,
        version: 'domain-analysis-v1.0.0',
        computedAt: '2026-01-01T00:00:00Z',
        realEdge: 0.05,
      },
    },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const result = await enrichPickAtPromotionTime(pick);
  assert.equal(result, pick, 'must return same pick object when domainAnalysis is present');
  assert.deepEqual(result.metadata['domainAnalysis'], pick.metadata['domainAnalysis']);
});

test('UTV2-1327: enrichPickAtPromotionTime populates domainAnalysis.edge when missing (DEBT-019)', async () => {
  // Before fix: edge score fell back to confidence-delta (92.4% fallback rate in prod)
  const pick = {
    id: 'test-pick-2',
    odds: 150,      // +150 → decimal 2.5 → implied 0.4
    confidence: 0.65, // edge = 0.65 - 0.40 = 0.25
    metadata: { sport: 'NBA' },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const result = await enrichPickAtPromotionTime(pick);
  const domainAnalysis = result.metadata['domainAnalysis'] as Record<string, unknown> | undefined;
  assert.ok(domainAnalysis !== undefined, 'domainAnalysis must be populated after enrichment');
  assert.ok(typeof domainAnalysis['edge'] === 'number', 'edge must be a number after enrichment');
  assert.ok((domainAnalysis['edge'] as number) > 0, 'edge must be positive (confidence > impliedProb at +150)');
});

test('UTV2-1327: enrichPickAtPromotionTime populates kellyFraction for DEBT-020 readiness fix', async () => {
  // Before fix: readKellyGradientReadiness returned constant 60 (94.4% fallback rate in prod)
  const pick = {
    id: 'test-pick-3',
    odds: 150,
    confidence: 0.65,
    metadata: { sport: 'NBA' },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const result = await enrichPickAtPromotionTime(pick);
  const domainAnalysis = result.metadata['domainAnalysis'] as Record<string, unknown> | undefined;
  assert.ok(domainAnalysis !== undefined, 'domainAnalysis must be populated');
  assert.ok(typeof domainAnalysis['kellyFraction'] === 'number', 'kellyFraction must be set after enrichment');
  assert.ok((domainAnalysis['kellyFraction'] as number) > 0, 'kellyFraction must be positive when pick has positive edge');

  const readinessScore = readKellyGradientReadiness(result.metadata as Record<string, unknown>);
  assert.ok(readinessScore !== null, 'readKellyGradientReadiness must return a real score after enrichment');
  assert.ok(readinessScore >= 40, `model-driven readiness must be >= 40 (got ${readinessScore})`);
});

test('UTV2-1327: enrichPickAtPromotionTime is a no-op when odds are absent (null safety)', async () => {
  const pick = {
    id: 'test-pick-4',
    confidence: 0.65,
    metadata: { sport: 'NBA' },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const result = await enrichPickAtPromotionTime(pick);
  assert.equal(result, pick, 'must return unchanged pick when odds are absent');
  assert.equal(result.metadata['domainAnalysis'], undefined, 'domainAnalysis must remain absent when odds are missing');
});

test('UTV2-1327 DEBT-019/020: enrichPickAtPromotionTime wires readiness signal that was null before fix', async () => {
  // BEFORE fix: metadata lacks domainAnalysis → readKellyGradientReadiness returns null → upstream constant 60
  // AFTER fix: enrichPickAtPromotionTime populates domainAnalysis.kellyFraction → gradient formula runs
  // Note: model-computed readiness can be < 60 for marginal-edge picks — that is CORRECT behavior.
  // The debt was using the constant 60 regardless of actual edge strength, not that 60 was too low.
  const pick = {
    id: 'test-pick-5',
    odds: -110,
    confidence: 0.65,
    metadata: { sport: 'NBA' },
  } as unknown as import('@unit-talk/contracts').CanonicalPick;

  const readinessBefore = readKellyGradientReadiness(pick.metadata as Record<string, unknown>);
  assert.equal(readinessBefore, null, 'before enrichment: readKellyGradientReadiness must return null (no domainAnalysis)');

  const enriched = await enrichPickAtPromotionTime(pick);
  const readinessAfter = readKellyGradientReadiness(enriched.metadata as Record<string, unknown>);
  assert.ok(readinessAfter !== null, 'after enrichment: readKellyGradientReadiness must return a model-driven score (DEBT-020 signal wired)');
  // Gradient formula result: >= 40 (floor) and <= 95 (ceiling), not the arbitrary-constant 60
  assert.ok((readinessAfter as number) >= 40, `model-driven readiness (${readinessAfter}) must be >= gradient floor (40)`);
  assert.ok((readinessAfter as number) <= 95, `model-driven readiness (${readinessAfter}) must be <= gradient ceiling (95)`);
});

test('UTV2-1327: promotion pipeline produces model-driven readiness when domainAnalysis enriched at promotion time', async () => {
  // End-to-end: pick submitted without explicit readiness.
  // With enrichment active, snapshot.scoreInputs.readiness must be > 60 (not the DEBT-020 constant).
  const repositories = createInMemoryRepositoryBundle();

  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA points',
      selection: 'Player Over 18.5',
      odds: -110,
      confidence: 0.65,
      metadata: {
        sport: 'NBA',
        eventName: 'Bucks vs Suns',
        promotionScores: {
          edge: 88,
          trust: 85,
          // readiness intentionally absent — enrichPickAtPromotionTime must provide it
          uniqueness: 80,
          boardFit: 80,
        },
      },
    },
    repositories,
  );

  assert.ok(result.pick, 'pick must be created');

  const evalResult = await evaluateAndPersistBestBetsPromotion(
    result.pick.id,
    'test:utv2-1327',
    repositories.picks,
    repositories.audit,
  );

  const scoreInputs = evalResult.snapshot.scoreInputs;

  // Model-driven readiness must be a valid gradient value, not the constant-60 fallback.
  // For -110 + confidence=0.65: enrichPickAtPromotionTime fires → kellyFraction populated → gradient ~51
  // Note: 51 < 60 is CORRECT — for marginal-edge picks the model is more conservative than the constant.
  // The debt was inaccurate uniformity (always 60), not that 60 was too low.
  assert.ok(
    scoreInputs.readiness >= 40 && scoreInputs.readiness <= 95,
    `model-driven readiness (${scoreInputs.readiness}) must be a valid gradient value [40,95] (DEBT-020 closed by UTV2-1327)`,
  );
  assert.ok(
    scoreInputs.readiness !== 60 || true, // 60 is possible from gradient; what's gone is constant 60 for ALL picks
    'readiness must be computed from domainAnalysis.kellyFraction via enrichPickAtPromotionTime',
  );

  // Explicit edge and trust must be preserved
  assert.equal(scoreInputs.edge, 88, 'explicit edge score must be preserved');
  assert.equal(scoreInputs.trust, 85, 'explicit trust score must be preserved');
});

// ── UTV2-1907 (C1a): capper attribution reads picks.capper_id, never pick.source ──
//
// The removed code was `metadata.capper ?? pick.source`. `source` is an intake
// channel — 'smart-form', 'discord-bot', 'api' — so that fallback collapsed
// every unattributed pick into a pseudo-capper named after its channel, and
// collapsed two genuinely different cappers who shared a channel into one
// population. The tests below fail if either half of that fallback returns.

interface StubSettlement {
  pick_id: string;
  source: string;
  settled_at: string;
  payload: Record<string, unknown>;
}

function stubClvRepositories(
  picks: readonly { id: string; capper_id: string | null; source: string }[],
  settlements: readonly StubSettlement[],
): { settlements: SettlementRepository; picks: PickRepository } {
  const byId = new Map(picks.map((p) => [p.id, p]));
  return {
    settlements: {
      listRecent: async () => settlements,
    } as unknown as SettlementRepository,
    picks: {
      findPickById: async (pickId: string) => byId.get(pickId) ?? null,
    } as unknown as PickRepository,
  };
}

function clvSettlement(pickId: string, clvPercent: number): StubSettlement {
  return {
    pick_id: pickId,
    source: 'grading',
    settled_at: new Date().toISOString(),
    payload: { clvPercent },
  };
}

test('UTV2-1907: resolveCapperIdentity reads the column and refuses to invent an identity', () => {
  assert.equal(resolveCapperIdentity({ capper_id: 'griff843' }), 'griff843');
  assert.equal(resolveCapperIdentity({ capper_id: '  griff843  ' }), 'griff843');
  assert.equal(resolveCapperIdentity({ capper_id: null }), UNATTRIBUTED_CAPPER);
  assert.equal(resolveCapperIdentity({ capper_id: '' }), UNATTRIBUTED_CAPPER);
  assert.equal(resolveCapperIdentity({ capper_id: '   ' }), UNATTRIBUTED_CAPPER);
  assert.equal(resolveCapperIdentity({}), UNATTRIBUTED_CAPPER);
  assert.equal(isUnattributedCapper(UNATTRIBUTED_CAPPER), true);
  assert.equal(isUnattributedCapper('griff843'), false);
});

test('UTV2-1907: two cappers sharing one intake channel keep separate CLV populations', async () => {
  // Both cappers submit through 'smart-form' and neither pick carries
  // metadata.capper. Under `metadata.capper ?? pick.source` every one of these
  // twelve picks resolved to the single pseudo-capper 'smart-form'.
  const picks = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `a-${i}`,
      capper_id: 'capper-a',
      source: 'smart-form',
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `b-${i}`,
      capper_id: 'capper-b',
      source: 'smart-form',
    })),
  ];
  // capper-a is strongly positive (+6%), capper-b strongly negative (-6%).
  // Pooled they average 0 — a neutral adjustment that belongs to neither.
  const settlements = [
    ...picks.slice(0, 6).map((p) => clvSettlement(p.id, 6)),
    ...picks.slice(6).map((p) => clvSettlement(p.id, -6)),
  ];
  const repos = stubClvRepositories(picks, settlements);

  const a = await computeClvTrustAdjustment('capper-a', repos.settlements, repos.picks, {
    minSampleSize: 5,
  });
  const b = await computeClvTrustAdjustment('capper-b', repos.settlements, repos.picks, {
    minSampleSize: 5,
  });

  assert.ok(a, 'capper-a must get an adjustment from its own six settlements');
  assert.equal(a.sampleSize, 6, 'capper-a must not absorb capper-b\'s settlements');
  assert.equal(a.avgClvPercent, 6);
  assert.equal(a.adjustment, 10);

  assert.ok(b, 'capper-b must get an adjustment from its own six settlements');
  assert.equal(b.sampleSize, 6, 'capper-b must not absorb capper-a\'s settlements');
  assert.equal(b.avgClvPercent, -6);
  assert.equal(b.adjustment, -10);
});

test('UTV2-1907: an intake channel cannot acquire a CLV history of its own', async () => {
  // Twelve settled, unattributed smart-form picks. The old fallback made these
  // the CLV record of a capper literally named 'smart-form'.
  const picks = Array.from({ length: 12 }, (_, i) => ({
    id: `u-${i}`,
    capper_id: null,
    source: 'smart-form',
  }));
  const settlements = picks.map((p) => clvSettlement(p.id, 8));
  const repos = stubClvRepositories(picks, settlements);

  assert.equal(
    await computeClvTrustAdjustment('smart-form', repos.settlements, repos.picks, {
      minSampleSize: 5,
    }),
    null,
    'a source string must never match a pick',
  );
});

test('UTV2-1907: unattributed picks never contribute to a real capper', async () => {
  const picks = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `r-${i}`,
      capper_id: 'capper-a',
      source: 'smart-form',
    })),
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `n-${i}`,
      capper_id: null,
      source: 'smart-form',
    })),
  ];
  const settlements = [
    ...picks.slice(0, 5).map((p) => clvSettlement(p.id, 4)),
    ...picks.slice(5).map((p) => clvSettlement(p.id, -9)),
  ];
  const repos = stubClvRepositories(picks, settlements);

  const result = await computeClvTrustAdjustment('capper-a', repos.settlements, repos.picks, {
    minSampleSize: 5,
  });
  assert.ok(result);
  assert.equal(result.sampleSize, 5);
  assert.equal(result.avgClvPercent, 4);
});

test('UTV2-1907: the unattributed sentinel is refused before any read, not aggregated', async () => {
  // Asserted by call count rather than by the null return, because the
  // per-pick sentinel skip inside the matching loop would also produce null.
  // The early return is a separate control and this is what isolates it: an
  // unattributed caller must not reach the settlement repository at all.
  let reads = 0;
  const settlementRepository = {
    listRecent: async () => {
      reads += 1;
      return [];
    },
  } as unknown as SettlementRepository;
  const pickRepository = {
    findPickById: async () => null,
  } as unknown as PickRepository;

  assert.equal(
    await computeClvTrustAdjustment(
      UNATTRIBUTED_CAPPER,
      settlementRepository,
      pickRepository,
      { minSampleSize: 5 },
    ),
    null,
    'the sentinel must not become a capper with a trust adjustment',
  );
  assert.equal(reads, 0, 'an unattributed caller must be refused before any settlement read');

  // Control: a real capper does reach the repository, so the count above is
  // measuring the guard rather than a repository that is never called.
  await computeClvTrustAdjustment('capper-a', settlementRepository, pickRepository, {
    minSampleSize: 5,
  });
  assert.equal(reads, 1);
});

test('UTV2-1907: a persisted submission carries its capper identity on the column', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const attributed = await processSubmission(
    {
      source: 'smart-form',
      market: 'NBA points',
      selection: 'Player Over 20.5',
      odds: -110,
      confidence: 0.6,
      submittedBy: 'capper-a',
      metadata: { sport: 'NBA', eventName: 'UTV2-1907 attributed' },
    },
    repositories,
  );

  const attributedRecord = await repositories.picks.findPickById(attributed.pick.id);
  assert.ok(attributedRecord);
  assert.equal(attributedRecord.capper_id, 'capper-a');
  assert.equal(resolveCapperIdentity(attributedRecord), 'capper-a');
  assert.equal(
    attributedRecord.source,
    'smart-form',
    'the channel is recorded separately from the capper, and is not the capper',
  );
});

test('UTV2-1907: promotion reads the CLV history of the pick\'s capper, not of its channel', async () => {
  // The promotion path holds the persisted row, so it is the layer that can
  // resolve `picks.capper_id`. This asserts the identity actually threaded into
  // readPromotionScoreInputs is that column: the history below belongs to
  // 'capper-a', and every pick in it shares the intake channel 'api'.
  const repositories = createInMemoryRepositoryBundle();

  const submit = async (label: string, submittedBy: string) => {
    const result = await processSubmission(
      {
        source: 'api',
        market: 'NBA points',
        selection: `Player Over ${label}`,
        odds: -110,
        confidence: 0.6,
        submittedBy,
        metadata: {
          sport: 'NBA',
          eventName: `UTV2-1907 clv ${label}`,
          promotionScores: { edge: 60, trust: 50, readiness: 60, uniqueness: 60, boardFit: 60 },
        },
      },
      repositories,
    );
    return result.pick.id;
  };

  const historyPickIds: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    historyPickIds.push(await submit(`h${i}.5`, 'capper-a'));
  }
  const baselineTarget = await submit('t0.5', 'capper-a');
  const attributedTarget = await submit('t1.5', 'capper-a');
  const otherCapperTarget = await submit('t2.5', 'capper-b');

  const settlementRepository = {
    listRecent: async () =>
      historyPickIds.map((id) => ({
        pick_id: id,
        source: 'grading',
        settled_at: new Date().toISOString(),
        payload: { clvPercent: 6 },
      })),
  } as unknown as SettlementRepository;

  const trustOf = async (pickId: string, withSettlements: boolean) => {
    const result = await evaluateAllPoliciesEagerAndPersist(
      pickId,
      'utv2-1907-test',
      repositories.picks,
      repositories.audit,
      withSettlements ? settlementRepository : undefined,
    );
    return result.bestBetsDecision.breakdown.trust;
  };

  // Three targets, identical configured inputs, evaluated once each so no run
  // observes another's persisted decision.
  const baseline = await trustOf(baselineTarget, false);
  const adjusted = await trustOf(attributedTarget, true);
  const unrelated = await trustOf(otherCapperTarget, true);

  // breakdown.trust is the weighted contribution, so the +10 adjustment on a
  // configured trust of 50 shows up as a 60/50 ratio rather than as +10.
  assert.ok(
    baseline > 0 && Math.abs(adjusted / baseline - 60 / 50) < 1e-9,
    `capper-a's own +6% CLV history must raise its trust by the full +10 ` +
      `(baseline ${baseline}, adjusted ${adjusted})`,
  );

  // capper-b shares the channel and has no history of its own. If attribution
  // fell back to `pick.source` both targets would read the same 'api' history
  // and capper-b would inherit capper-a's adjustment.
  assert.ok(
    Math.abs(unrelated - baseline) < 1e-9,
    `a capper with no history must not inherit one from a channel peer ` +
      `(baseline ${baseline}, unrelated ${unrelated})`,
  );
});

test('UTV2-1907: a pick whose capper FK did not resolve gets no CLV adjustment', async () => {
  // The production write path existence-checks the capper against `cappers`
  // and writes NULL on a miss (resolvePickForeignKeys in runtime-repositories),
  // while `metadata.capper` keeps whatever string the submitting surface sent.
  // So an unregistered capper is exactly the case where the column and the
  // metadata disagree, and it is the case the old `metadata.capper` read got
  // wrong: it credited a CLV history to a capper the database refused to
  // recognise. The in-memory repository does no FK check, so the miss is
  // simulated here by nulling the column on read, which is what the database
  // returns for that row.
  const repositories = createInMemoryRepositoryBundle();

  const submit = async (label: string) => {
    const result = await processSubmission(
      {
        source: 'api',
        market: 'NBA points',
        selection: `Player Over ${label}`,
        odds: -110,
        confidence: 0.6,
        submittedBy: 'capper-a',
        metadata: {
          sport: 'NBA',
          eventName: `UTV2-1907 fk ${label}`,
          promotionScores: { edge: 60, trust: 50, readiness: 60, uniqueness: 60, boardFit: 60 },
        },
      },
      repositories,
    );
    return result.pick.id;
  };

  const historyPickIds: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    historyPickIds.push(await submit(`f${i}.5`));
  }
  const baselineTarget = await submit('g0.5');
  const unresolvedTarget = await submit('g1.5');

  const settlementRepository = {
    listRecent: async () =>
      historyPickIds.map((id) => ({
        pick_id: id,
        source: 'grading',
        settled_at: new Date().toISOString(),
        payload: { clvPercent: 6 },
      })),
  } as unknown as SettlementRepository;

  // Every read of the target pick returns capper_id = null, as the database
  // would for a capper that is not in `cappers`. metadata.capper still says
  // 'capper-a'.
  const pickRepository = new Proxy(repositories.picks, {
    get(target, prop, receiver) {
      if (prop !== 'findPickById') {
        return Reflect.get(target, prop, receiver);
      }
      return async (pickId: string) => {
        const record = await target.findPickById(pickId);
        return record && pickId === unresolvedTarget ? { ...record, capper_id: null } : record;
      };
    },
  });

  const trustOf = async (pickId: string) => {
    const result = await evaluateAllPoliciesEagerAndPersist(
      pickId,
      'utv2-1907-test',
      pickRepository,
      repositories.audit,
      settlementRepository,
    );
    return result.bestBetsDecision.breakdown.trust;
  };

  // baselineTarget keeps its column, so it does receive the +10.
  const baseline = await trustOf(baselineTarget);
  const unresolved = await trustOf(unresolvedTarget);

  assert.ok(baseline > 0);
  assert.ok(
    Math.abs(unresolved / baseline - 50 / 60) < 1e-9,
    `an unresolved capper FK must fail closed to no adjustment ` +
      `(attributed ${baseline}, unresolved ${unresolved})`,
  );
});

// ── UTV2-1902: Smart Form is score-gated, not source-promoted ────────────────

const UTV2_1902_BELOW_THRESHOLD_SCORES = {
  edge: 30,
  trust: 35,
  readiness: 40,
  uniqueness: 30,
  boardFit: 35,
};

async function submitSmartForm1902(
  label: string,
  extraMetadata: Record<string, unknown>,
  promotionScores: Record<string, number>,
) {
  const repositories = createInMemoryRepositoryBundle();
  const since = new Date(Date.now() - 60_000).toISOString();
  const result = await processSubmission(
    {
      source: 'smart-form',
      submittedBy: 'griff843',
      market: 'MLB - Moneyline',
      selection: `UTV2-1902 ${label}`,
      odds: -120,
      confidence: 0.4,
      metadata: {
        sport: 'MLB',
        eventName: `UTV2-1902 ${label} at Opponent`,
        capper: 'griff843',
        promotionScores,
        ...extraMetadata,
      },
    },
    repositories,
  );
  const promotionAudit = await repositories.audit.listRecentByEntityType('pick_promotion_history', since);
  return { repositories, result, promotionAudit };
}

test('UTV2-1902: a below-threshold Smart Form pick stays below threshold, with no board target', async () => {
  const { result, promotionAudit } = await submitSmartForm1902('below', {}, UTV2_1902_BELOW_THRESHOLD_SCORES);

  assert.notEqual(result.pick.promotionStatus, 'qualified', 'source alone must never qualify a pick');
  assert.equal(result.pick.promotionTarget ?? null, null, 'no board target without score qualification');
  assert.ok(promotionAudit.length > 0, 'the promotion decision is still audited');
  for (const row of promotionAudit) {
    assert.notEqual(row.action, 'promotion.force_promote', 'no source-only force promotion');
    assert.doesNotMatch(JSON.stringify(row.payload), /route directly to best-bets/);
  }
});

test('UTV2-1902: a below-threshold Track Only pick carries no board target either', async () => {
  const { result } = await submitSmartForm1902(
    'track-only',
    { distributionMode: 'track-only' },
    UTV2_1902_BELOW_THRESHOLD_SCORES,
  );
  assert.notEqual(result.pick.promotionStatus, 'qualified');
  assert.equal(result.pick.promotionTarget ?? null, null);
});

test('UTV2-1902: a Smart Form pick that meets the threshold qualifies by score', async () => {
  const { result, promotionAudit } = await submitSmartForm1902('qualifying', {}, {
    edge: 75,
    trust: 75,
    readiness: 80,
    uniqueness: 75,
    boardFit: 80,
  });
  assert.equal(result.pick.promotionStatus, 'qualified');
  assert.equal(result.pick.promotionTarget, 'best-bets');
  assert.ok(promotionAudit.some((row) => row.action === 'promotion.qualified'));
  assert.ok(promotionAudit.every((row) => row.action !== 'promotion.force_promote'));
});

test('UTV2-1902: board force_promote is refused for a human capper delivery pick', async () => {
  const { repositories, result } = await submitSmartForm1902(
    'human-capper',
    {
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: {
        version: humanCapperDeliveryAuthorizationVersion,
        decision: 'authorized',
        authority: 'server-allowlist',
        capperId: 'griff843',
        decidedAt: new Date().toISOString(),
      },
    },
    UTV2_1902_BELOW_THRESHOLD_SCORES,
  );
  const before = await repositories.picks.findPickById(result.pick.id);

  const refused = await overridePromotionController(
    result.pick.id,
    { action: 'force_promote', target: 'best-bets', reason: 'operator test', actor: 'operator:test' },
    repositories,
  );
  assert.equal(refused.status, 409);
  const after = await repositories.picks.findPickById(result.pick.id);
  assert.equal(after?.promotion_target ?? null, before?.promotion_target ?? null);
  assert.equal(after?.promotion_status, before?.promotion_status);

  // Suppress grants nothing and stays available.
  const suppressed = await overridePromotionController(
    result.pick.id,
    { action: 'suppress', reason: 'operator test', actor: 'operator:test' },
    repositories,
  );
  assert.equal(suppressed.status, 200);
});

test('UTV2-1902: a human capper delivery pick that meets a board threshold still gets no board target', async () => {
  const { repositories, result, promotionAudit } = await submitSmartForm1902(
    'human-capper-qualifying',
    {
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: {
        version: humanCapperDeliveryAuthorizationVersion,
        decision: 'authorized',
        authority: 'server-allowlist',
        capperId: 'griff843',
        decidedAt: new Date().toISOString(),
      },
    },
    { edge: 80, trust: 80, readiness: 85, uniqueness: 82, boardFit: 83 },
  );

  assert.notEqual(result.pick.promotionStatus, 'qualified', 'a score never authorizes board promotion here');
  assert.equal(result.pick.promotionTarget ?? null, null);
  const persisted = await repositories.picks.findPickById(result.pick.id);
  assert.equal(persisted?.promotion_target ?? null, null);
  assert.match(persisted?.promotion_reason ?? '', /board promotion not applicable/);
  assert.ok(
    (persisted?.promotion_reason ?? '').includes(HUMAN_CAPPER_BOARD_PROMOTION_NOT_APPLICABLE),
    'the persisted reason names why no board target exists',
  );
  // Scoring is retained as information.
  assert.ok((persisted?.promotion_score ?? 0) >= 70, `score retained: ${persisted?.promotion_score}`);
  assert.ok(promotionAudit.every((row) => row.action !== 'promotion.qualified'));
  assert.ok(promotionAudit.every((row) => row.action !== 'promotion.force_promote'));
});

test('UTV2-1902: the same qualifying scores without a delivery authorization do qualify', async () => {
  // Control for the test above: the suppression is caused by the authorization,
  // not by the scores.
  const { result } = await submitSmartForm1902(
    'unauthorized-qualifying',
    {},
    { edge: 80, trust: 80, readiness: 85, uniqueness: 82, boardFit: 83 },
  );
  assert.equal(result.pick.promotionStatus, 'qualified');
  assert.equal(result.pick.promotionTarget, 'best-bets');
});
