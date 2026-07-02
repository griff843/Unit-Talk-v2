import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runScoringValidationAudit } from './utv2-1382-scoring-validation.js';

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 'pick-default',
    source: 'system-pick-scanner',
    selection: 'default selection',
    market: 'moneyline',
    sport_id: 'MLB',
    status: 'posted',
    approval_status: 'approved',
    promotion_status: 'suppressed',
    promotion_target: null,
    promotion_score: 40,
    promotion_reason: 'test',
    confidence: 60,
    created_at: '2026-07-01T00:00:00.000Z',
    posted_at: null,
    metadata: {},
    ...overrides,
  };
}

test('UTV2-1382: excludes metadata.testRun and legacy proof-tagged rows from the production denominator', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-validation-'));

  const summary = await runScoringValidationAudit({
    now,
    outDir,
    rows: [
      baseRow({ id: 'clean-1' }),
      baseRow({ id: 'test-run', metadata: { testRun: true } }),
      baseRow({ id: 'legacy-proof-issue', metadata: { proof_issue: 'UTV2-1022' } }),
      baseRow({ id: 'legacy-proof-fixture-id', metadata: { proof_fixture_id: 'utv2-1022-abc' } }),
      baseRow({ id: 'selection-proof', selection: 'UTV2-1022 RISK PROOF something' }),
      baseRow({ id: 'non-production-source', source: 'api' }),
    ],
  });

  assert.equal(summary['total_picks_analyzed'], 1, 'only the one clean row should survive exclusion');
  assert.equal(summary['excluded_test_fixture_count'], 4, 'testRun + proof_issue + proof_fixture_id + selection-proof');
  assert.equal(summary['excluded_non_production_source_count'], 1);
});

test('UTV2-1382: band/edgeSourceQuality/fallbackReason classification matches promotion-service semantics', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-validation-'));

  const summary = await runScoringValidationAudit({
    now,
    outDir,
    rows: [
      baseRow({
        id: 'explicit-edge',
        metadata: { band: 'A', promotionScores: { edge: 90 } },
      }),
      baseRow({
        id: 'market-backed-edge',
        metadata: { band: 'B', domainAnalysis: { realEdge: 0.05 } },
      }),
      baseRow({
        id: 'confidence-fallback',
        metadata: { band: 'SUPPRESS', domainAnalysis: { confidenceDelta: 0.1 } },
      }),
      baseRow({ id: 'no-band', metadata: {} }),
    ],
  });

  assert.equal(
    (summary['edge_source_quality_overall'] as Record<string, number>)['explicit'],
    1,
  );
  assert.equal(
    (summary['edge_source_quality_overall'] as Record<string, number>)['market-backed'],
    1,
  );
  assert.equal(
    (summary['edge_source_quality_overall'] as Record<string, number>)['confidence-fallback'],
    2,
    'the confidence-delta row and the no-metadata row both fall back to confidence-fallback',
  );
  assert.equal((summary['band_distribution_overall'] as Record<string, number>)['A'], 1);
  assert.equal((summary['band_distribution_overall'] as Record<string, number>)['B'], 1);
  assert.equal((summary['band_distribution_overall'] as Record<string, number>)['SUPPRESS'], 1);
  assert.equal((summary['band_distribution_overall'] as Record<string, number>)['none'], 1);
});

test('UTV2-1382: flags a fully test/proof-saturated source as unmeasurable in the verdict', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-validation-'));

  const summary = await runScoringValidationAudit({
    now,
    outDir,
    rows: [
      baseRow({ id: 'clean-scanner-pick', metadata: { band: 'B', domainAnalysis: { realEdge: 0.03 } } }),
      baseRow({ id: 'alert-fixture-1', source: 'alert-agent', metadata: { testRun: true } }),
      baseRow({ id: 'alert-fixture-2', source: 'alert-agent', metadata: { proof_issue: 'UTV2-1022' } }),
    ],
  });

  const saturation = summary['fixture_saturation_by_source'] as Record<string, { total: number; clean_count: number }>;
  assert.equal(saturation['alert-agent']?.clean_count, 0);
  assert.deepEqual(summary['fully_saturated_sources'], ['alert-agent']);
  assert.notEqual(summary['verdict'], 'PASS', 'a fully saturated source must prevent an unqualified PASS verdict');
});

test('UTV2-1382: a promoted pick carrying band=SUPPRESS is reported as leakage', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-validation-'));

  const summary = await runScoringValidationAudit({
    now,
    outDir,
    rows: [
      baseRow({
        id: 'suppressed-but-promoted',
        promotion_status: 'qualified',
        promotion_target: 'best-bets',
        metadata: { band: 'SUPPRESS' },
      }),
    ],
  });

  const leakage = summary['stale_postgame_suppress_leakage'] as { suppress_band_but_promoted_count: number };
  assert.equal(leakage.suppress_band_but_promoted_count, 1);
  assert.equal(summary['verdict'], 'FAIL');
});
