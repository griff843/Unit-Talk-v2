import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderTrustContext,
  computeProviderTrustScore,
  summarizeProviderTrust,
  TRUST_MULTIPLIERS,
} from './provider-quality.js';
import type { ProviderQualityInput } from './provider-quality.js';

function makeReport(overrides: Partial<ProviderQualityInput> = {}): ProviderQualityInput {
  return {
    providerKey: 'draftkings',
    sportKey: 'NFL',
    marketFamily: 'spread',
    sampleSize: 50,
    avgLineDelta: 2,
    winRate: null,
    roi: null,
    ...overrides,
  };
}

// ── computeProviderTrustScore ─────────────────────────────────────────────

test('green when delta is small', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: 2 }));
  assert.equal(result.alertLevel, 'green');
  assert.equal(result.trustMultiplier, TRUST_MULTIPLIERS.green);
});

test('warning when delta >= 5', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: 7 }));
  assert.equal(result.alertLevel, 'warning');
  assert.equal(result.trustMultiplier, TRUST_MULTIPLIERS.warning);
});

test('degraded when delta >= 15', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: 20 }));
  assert.equal(result.alertLevel, 'degraded');
  assert.equal(result.trustMultiplier, TRUST_MULTIPLIERS.degraded);
});

test('green when sample size is below minimum', () => {
  const result = computeProviderTrustScore(makeReport({ sampleSize: 5, avgLineDelta: 25 }));
  assert.equal(result.alertLevel, 'green');
  assert.equal(result.trustMultiplier, 1.0);
});

test('green when avgLineDelta is null', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: null }));
  assert.equal(result.alertLevel, 'green');
  assert.equal(result.trustMultiplier, 1.0);
});

test('negative delta treated as absolute value', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: -20 }));
  assert.equal(result.alertLevel, 'degraded');
});

test('boundary: delta exactly 5 is warning', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: 5 }));
  assert.equal(result.alertLevel, 'warning');
});

test('boundary: delta exactly 15 is degraded', () => {
  const result = computeProviderTrustScore(makeReport({ avgLineDelta: 15 }));
  assert.equal(result.alertLevel, 'degraded');
});

// ── buildProviderTrustContext ─────────────────────────────────────────────

test('buildProviderTrustContext returns multipliers keyed by provider', () => {
  const reports = [
    makeReport({ providerKey: 'draftkings', avgLineDelta: 2 }),
    makeReport({ providerKey: 'fanduel', avgLineDelta: 8 }),
  ];
  const ctx = buildProviderTrustContext(reports);
  assert.equal(ctx['draftkings'], 1.0);
  assert.equal(ctx['fanduel'], TRUST_MULTIPLIERS.warning);
});

test('worst-multiplier wins across sport/market rows for same provider', () => {
  const reports = [
    makeReport({ providerKey: 'betmgm', sportKey: 'NFL', avgLineDelta: 3 }),
    makeReport({ providerKey: 'betmgm', sportKey: 'NBA', avgLineDelta: 20 }),
  ];
  const ctx = buildProviderTrustContext(reports);
  assert.equal(ctx['betmgm'], TRUST_MULTIPLIERS.degraded);
});

test('buildProviderTrustContext returns empty for no reports', () => {
  const ctx = buildProviderTrustContext([]);
  assert.deepEqual(ctx, {});
});

// ── summarizeProviderTrust ────────────────────────────────────────────────

test('summarizeProviderTrust sorts worst trust first', () => {
  const reports = [
    makeReport({ providerKey: 'pinnacle', avgLineDelta: 1 }),
    makeReport({ providerKey: 'betmgm', avgLineDelta: 20 }),
    makeReport({ providerKey: 'fanduel', avgLineDelta: 7 }),
  ];
  const summary = summarizeProviderTrust(reports);
  assert.equal(summary[0]?.providerKey, 'betmgm');
  assert.equal(summary[1]?.providerKey, 'fanduel');
  assert.equal(summary[2]?.providerKey, 'pinnacle');
});

test('summarizeProviderTrust shows degraded alert level', () => {
  const reports = [makeReport({ avgLineDelta: 20 })];
  const summary = summarizeProviderTrust(reports);
  assert.equal(summary[0]?.alertLevel, 'degraded');
});
