import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSubmissionDomainAnalysis,
  enrichMetadataWithDomainAnalysis,
  DOMAIN_ANALYSIS_VERSION,
} from './domain-analysis-service.js';
import type { CanonicalPick } from '@unit-talk/contracts';
import { processSubmission } from './submission-service.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

function makePick(overrides: Partial<CanonicalPick> = {}): CanonicalPick {
  return {
    id: 'test-pick-1',
    submissionId: 'test-sub-1',
    market: 'NBA points',
    selection: 'Player Over 22.5',
    source: 'api',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
    metadata: {},
    createdAt: '2026-03-21T00:00:00.000Z',
    ...overrides,
  };
}

test('computeSubmissionDomainAnalysis returns null when odds are missing', () => {
  const pick = makePick({ odds: undefined });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.equal(result, null);
});

test('computeSubmissionDomainAnalysis computes implied probability for -115 odds', () => {
  const pick = makePick({ odds: -115 });
  const result = computeSubmissionDomainAnalysis(pick, '2026-03-21T12:00:00.000Z');
  assert.ok(result !== null);
  // -115: implied = 115 / (115 + 100) = 115/215 ≈ 0.534884
  assert.ok(Math.abs(result.impliedProbability - 0.534884) < 0.001);
  // -115: decimal = 100/115 + 1 ≈ 1.8696
  assert.ok(Math.abs(result.decimalOdds - 1.8696) < 0.01);
  assert.equal(result.version, DOMAIN_ANALYSIS_VERSION);
  assert.equal(result.computedAt, '2026-03-21T12:00:00.000Z');
  assert.equal(result.edge, undefined);
  assert.equal(result.kellyFraction, undefined);
});

test('computeSubmissionDomainAnalysis computes implied probability for +150 odds', () => {
  const pick = makePick({ odds: 150 });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.ok(result !== null);
  // +150: implied = 100 / (150 + 100) = 100/250 = 0.4
  assert.ok(Math.abs(result.impliedProbability - 0.4) < 0.001);
  // +150: decimal = 150/100 + 1 = 2.5
  assert.ok(Math.abs(result.decimalOdds - 2.5) < 0.01);
});

test('computeSubmissionDomainAnalysis computes edge when confidence is present', () => {
  // odds -115 → implied ≈ 0.5349, confidence 0.60 → edge ≈ 0.0651
  const pick = makePick({ odds: -115, confidence: 0.60 });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.ok(result !== null);
  assert.ok(result.edge !== undefined);
  assert.ok(result.edge! > 0);
  assert.equal(result.hasPositiveEdge, true);
  // edge = 0.60 - 0.534884 ≈ 0.0651
  assert.ok(Math.abs(result.edge! - 0.0651) < 0.005);
});

test('computeSubmissionDomainAnalysis reports negative edge correctly', () => {
  // odds -115 → implied ≈ 0.5349, confidence 0.45 → edge ≈ -0.085
  const pick = makePick({ odds: -115, confidence: 0.45 });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.ok(result !== null);
  assert.ok(result.edge !== undefined);
  assert.ok(result.edge! < 0);
  assert.equal(result.hasPositiveEdge, false);
});

test('computeSubmissionDomainAnalysis computes Kelly fraction for positive edge', () => {
  // odds +150 → implied 0.4, decimal 2.5
  // confidence 0.55 → edge 0.15 (positive)
  // Kelly: (b*p - q) / b where b=1.5, p=0.55, q=0.45
  // = (1.5*0.55 - 0.45) / 1.5 = (0.825 - 0.45) / 1.5 = 0.25
  // fractional = 0.25 * 0.25 (default multiplier) = 0.0625
  // capped at min(0.0625, 0.05) = 0.05
  const pick = makePick({ odds: 150, confidence: 0.55 });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.ok(result !== null);
  assert.ok(result.kellyFraction !== undefined);
  assert.ok(result.kellyFraction! > 0);
  assert.equal(result.kellyFraction, 0.05);
});

test('computeSubmissionDomainAnalysis omits Kelly fraction for negative edge', () => {
  // odds -200 → implied ≈ 0.6667, decimal 1.5
  // confidence 0.50 → edge ≈ -0.167 (negative)
  // Kelly raw < 0 → fraction = 0
  const pick = makePick({ odds: -200, confidence: 0.50 });
  const result = computeSubmissionDomainAnalysis(pick);
  assert.ok(result !== null);
  assert.equal(result.hasPositiveEdge, false);
  assert.equal(result.kellyFraction, undefined);
});

test('enrichMetadataWithDomainAnalysis merges analysis into metadata', () => {
  const metadata = { sport: 'NBA', existing: true };
  const analysis = computeSubmissionDomainAnalysis(
    makePick({ odds: -110 }),
  );
  const enriched = enrichMetadataWithDomainAnalysis(metadata, analysis);
  assert.ok('domainAnalysis' in enriched);
  assert.equal(enriched['sport'], 'NBA');
  assert.equal(enriched['existing'], true);
});

test('enrichMetadataWithDomainAnalysis returns original metadata when analysis is null', () => {
  const metadata = { sport: 'NBA' };
  const enriched = enrichMetadataWithDomainAnalysis(metadata, null);
  assert.deepEqual(enriched, metadata);
  assert.ok(!('domainAnalysis' in enriched));
});

test('processSubmission enriches metadata with domainAnalysis when odds are present', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA assists',
      selection: 'Player Over 7.5',
      odds: -115,
      confidence: 0.65,
    },
    repositories,
  );

  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.ok(stored !== null);
  const metadata = stored!.metadata as Record<string, unknown>;
  assert.ok('domainAnalysis' in metadata);

  const da = metadata['domainAnalysis'] as Record<string, unknown>;
  assert.equal(da['version'], DOMAIN_ANALYSIS_VERSION);
  assert.ok(typeof da['impliedProbability'] === 'number');
  assert.ok(typeof da['decimalOdds'] === 'number');
  assert.ok(typeof da['edge'] === 'number');
  assert.ok(typeof da['computedAt'] === 'string');
});

test('processSubmission skips domainAnalysis when odds are absent', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await processSubmission(
    {
      source: 'api',
      market: 'NBA rebounds',
      selection: 'Player Under 10.5',
    },
    repositories,
  );

  const stored = await repositories.picks.findPickById(result.pick.id);
  assert.ok(stored !== null);
  const metadata = stored!.metadata as Record<string, unknown>;
  assert.ok(!('domainAnalysis' in metadata));
});
