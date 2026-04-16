import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeProviderQualitySummary,
  providerTrustMultiplier,
  PROVIDER_QUALITY_THRESHOLDS,
  type ProviderExecutionRecord,
  type ProviderQualitySummary,
} from './provider-quality.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<ProviderExecutionRecord>): ProviderExecutionRecord {
  return {
    provider: 'pinnacle',
    marketFamily: 'game-line',
    sport: 'NBA',
    lineAgeAtCapture: 60,
    wasClosingLine: true,
    clvPercent: 1.5,
    edgeAtCapture: 3.2,
    capturedAt: '2026-04-01T18:00:00.000Z',
    ...overrides,
  };
}

function makeRecords(
  count: number,
  overrides?: Partial<ProviderExecutionRecord>,
): ProviderExecutionRecord[] {
  return Array.from({ length: count }, () => makeRecord(overrides));
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

test('computeProviderQualitySummary: groups by provider + sport + marketFamily', () => {
  const records = [
    ...makeRecords(10, { provider: 'pinnacle', sport: 'NBA', marketFamily: 'game-line' }),
    ...makeRecords(10, { provider: 'draftkings', sport: 'NBA', marketFamily: 'game-line' }),
  ];

  const summaries = computeProviderQualitySummary(records);

  assert.equal(summaries.length, 2);
  const providers = summaries.map(s => s.provider).sort();
  assert.deepEqual(providers, ['draftkings', 'pinnacle']);
});

test('computeProviderQualitySummary: excludes groups below minSampleSize', () => {
  const records = [
    ...makeRecords(PROVIDER_QUALITY_THRESHOLDS.minSampleSize - 1, { provider: 'small' }),
    ...makeRecords(PROVIDER_QUALITY_THRESHOLDS.minSampleSize, { provider: 'big' }),
  ];

  const summaries = computeProviderQualitySummary(records);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.provider, 'big');
});

test('computeProviderQualitySummary: returns empty array when all groups below minSampleSize', () => {
  const records = makeRecords(5, { provider: 'tiny' });
  const summaries = computeProviderQualitySummary(records);
  assert.equal(summaries.length, 0);
});

// ---------------------------------------------------------------------------
// Avg line age and closing line coverage
// ---------------------------------------------------------------------------

test('computeProviderQualitySummary: computes avgLineAgeSeconds correctly', () => {
  const records = [
    ...makeRecords(5, { lineAgeAtCapture: 100 }),
    ...makeRecords(5, { lineAgeAtCapture: 200 }),
  ];

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.avgLineAgeSeconds, 150);
});

test('computeProviderQualitySummary: computes closingLineCoverageRate correctly', () => {
  const records = [
    ...makeRecords(7, { wasClosingLine: true }),
    ...makeRecords(3, { wasClosingLine: false }),
  ];

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.closingLineCoverageRate, 0.7);
});

// ---------------------------------------------------------------------------
// Trust score degrades when closing line coverage is low
// ---------------------------------------------------------------------------

test('computeProviderQualitySummary: trust score is high when coverage is high and lines fresh', () => {
  const records = makeRecords(10, {
    wasClosingLine: true,
    lineAgeAtCapture: 30,
    clvPercent: 2.0,
  });

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.ok(summary.trustScore > 0.8, `Expected trust > 0.8, got ${summary.trustScore}`);
  assert.equal(summary.alertLevel, 'green');
});

test('computeProviderQualitySummary: alertLevel is warning when coverage is below warning threshold', () => {
  // Just under the warning threshold (0.6)
  const records = [
    ...makeRecords(5, { wasClosingLine: true }),
    ...makeRecords(5, { wasClosingLine: false }),
  ]; // coverage = 0.5 → warning

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.alertLevel, 'warning');
  assert.ok(summary.trustScore < 0.9);
});

test('computeProviderQualitySummary: alertLevel is degraded when coverage is very low', () => {
  const records = [
    ...makeRecords(2, { wasClosingLine: true }),
    ...makeRecords(8, { wasClosingLine: false }),
  ]; // coverage = 0.2 → degraded

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.alertLevel, 'degraded');
});

test('computeProviderQualitySummary: alertLevel is degraded when avg line age is very stale', () => {
  const records = makeRecords(10, {
    lineAgeAtCapture: PROVIDER_QUALITY_THRESHOLDS.maxLineAgeDegradedSeconds + 1,
    wasClosingLine: true,
  });

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.alertLevel, 'degraded');
});

test('computeProviderQualitySummary: alertLevel is warning when avg line age between thresholds', () => {
  const records = makeRecords(10, {
    lineAgeAtCapture: PROVIDER_QUALITY_THRESHOLDS.maxLineAgeWarningSeconds + 1,
    wasClosingLine: true,
  });

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.alertLevel, 'warning');
});

// ---------------------------------------------------------------------------
// CLV stats
// ---------------------------------------------------------------------------

test('computeProviderQualitySummary: avgClvPercent and positiveCLVRate computed correctly', () => {
  const records = [
    ...makeRecords(5, { clvPercent: 2.0 }),
    ...makeRecords(5, { clvPercent: -1.0 }),
  ];

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.avgClvPercent, 0.5);
  assert.equal(summary.positiveCLVRate, 0.5);
});

test('computeProviderQualitySummary: avgClvPercent is null when all records have null CLV', () => {
  const records = makeRecords(10, { clvPercent: null });

  const [summary] = computeProviderQualitySummary(records);
  assert.ok(summary);
  assert.equal(summary.avgClvPercent, null);
  assert.equal(summary.positiveCLVRate, null);
});

// ---------------------------------------------------------------------------
// providerTrustMultiplier
// ---------------------------------------------------------------------------

test('providerTrustMultiplier: returns 1.0 for green', () => {
  const summary: ProviderQualitySummary = {
    provider: 'pinnacle',
    sport: 'NBA',
    marketFamily: 'game-line',
    sampleSize: 50,
    avgLineAgeSeconds: 60,
    closingLineCoverageRate: 0.85,
    avgClvPercent: 1.5,
    positiveCLVRate: 0.6,
    trustScore: 0.9,
    alertLevel: 'green',
  };
  assert.equal(providerTrustMultiplier(summary), 1.0);
});

test('providerTrustMultiplier: returns 0.85 for warning', () => {
  const summary: ProviderQualitySummary = {
    provider: 'draftkings',
    sport: 'NBA',
    marketFamily: 'game-line',
    sampleSize: 20,
    avgLineAgeSeconds: 400,
    closingLineCoverageRate: 0.55,
    avgClvPercent: 0.5,
    positiveCLVRate: 0.5,
    trustScore: 0.6,
    alertLevel: 'warning',
  };
  assert.equal(providerTrustMultiplier(summary), 0.85);
});

test('providerTrustMultiplier: returns 0.7 for degraded', () => {
  const summary: ProviderQualitySummary = {
    provider: 'fanduel',
    sport: 'NFL',
    marketFamily: 'player-prop',
    sampleSize: 15,
    avgLineAgeSeconds: 1000,
    closingLineCoverageRate: 0.2,
    avgClvPercent: -2.0,
    positiveCLVRate: 0.2,
    trustScore: 0.3,
    alertLevel: 'degraded',
  };
  assert.equal(providerTrustMultiplier(summary), 0.7);
});
