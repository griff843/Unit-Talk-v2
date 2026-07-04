import assert from 'node:assert/strict';
import test from 'node:test';

import { computeProductTruthScoreboard, formatProductTruthScoreboard } from './product-truth-scoreboard.js';

function baseRow(overrides: Record<string, unknown> = {}) {
  const { picks: pickOverrides, ...rowOverrides } = overrides;
  return {
    pick_id: 'pick-default',
    result: 'won',
    settled_at: '2026-07-01T00:00:00.000Z',
    payload: {},
    ...rowOverrides,
    picks: {
      id: 'pick-default',
      source: 'system-pick-scanner',
      selection: 'default selection',
      status: 'settled',
      metadata: {},
      ...(pickOverrides as Record<string, unknown> | undefined),
    },
  };
}

test('UTV2-1449: excludes testRun and legacy proof-fixture rows from the measured denominator', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');

  const scoreboard = await computeProductTruthScoreboard({
    now,
    rows: [
      baseRow({ pick_id: 'clean-1' }),
      baseRow({ pick_id: 'test-run', picks: { metadata: { testRun: true } } }),
      baseRow({ pick_id: 'legacy-proof-issue', picks: { metadata: { proof_issue: 'UTV2-1022' } } }),
      baseRow({ pick_id: 'non-production-source', picks: { source: 'api' } }),
    ],
  });

  assert.equal(scoreboard.settledPicksTotal, 4);
  assert.equal(scoreboard.settledPicksMeasured, 1, 'only the one clean row should survive exclusion');
  assert.equal(scoreboard.settledPicksExcludedFixture, 3);
});

test('UTV2-1449: classifies edge source quality and Kelly presence per row', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');

  const scoreboard = await computeProductTruthScoreboard({
    now,
    rows: [
      baseRow({
        pick_id: 'explicit-edge',
        picks: { metadata: { promotionScores: { edge: 90 }, kellySizing: { fractional_kelly: 0.02 } } },
      }),
      baseRow({
        pick_id: 'market-backed-edge',
        picks: { metadata: { domainAnalysis: { realEdge: 0.05 } } },
      }),
      baseRow({
        pick_id: 'confidence-fallback',
        picks: { metadata: { domainAnalysis: { confidenceDelta: 0.1 } } },
      }),
    ],
  });

  assert.equal(scoreboard.settledPicksMeasured, 3);
  assert.equal(scoreboard.edgeSourceQuality.explicitPct, 33.33);
  assert.equal(scoreboard.edgeSourceQuality.marketBackedPct, 33.33);
  assert.equal(scoreboard.edgeSourceQuality.confidenceFallbackPct, 33.33);
  assert.equal(scoreboard.kellySizingPopulatedPct, 33.33, 'only the explicit-edge row has kellySizing populated');
  assert.equal(scoreboard.marketBackedSettledCount, 2, 'explicit + market-backed count toward the sample; confidence-fallback does not');
});

test('UTV2-1449: computes CLV coverage from settlement payload, including nested clv object', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');

  const scoreboard = await computeProductTruthScoreboard({
    now,
    rows: [
      baseRow({ pick_id: 'top-level-clv', payload: { clvPercent: 1.2 } }),
      baseRow({ pick_id: 'nested-clv', payload: { clv: { clvRaw: 0.5 } } }),
      baseRow({ pick_id: 'no-clv', payload: {} }),
    ],
  });

  assert.equal(scoreboard.settledPicksMeasured, 3);
  assert.equal(scoreboard.clvCoveragePct, 66.67);
});

test('UTV2-1449: DEVELOPING/STRONG thresholds report remaining distance and MET flag correctly', async () => {
  const now = new Date('2026-07-02T00:00:00.000Z');

  const marketBackedRows = Array.from({ length: 12 }, (_, i) =>
    baseRow({ pick_id: `market-backed-${i}`, picks: { metadata: { domainAnalysis: { realEdge: 0.05 } } } }),
  );

  const scoreboard = await computeProductTruthScoreboard({ now, rows: marketBackedRows });

  assert.equal(scoreboard.marketBackedSettledCount, 12);
  assert.equal(scoreboard.developing.met, false);
  assert.equal(scoreboard.developing.remaining, 38);
  assert.equal(scoreboard.strong.met, false);
  assert.equal(scoreboard.strong.remaining, 188);
});

test('UTV2-1449: formatProductTruthScoreboard renders threshold-distance framing', () => {
  const lines = formatProductTruthScoreboard({
    windowDays: 30,
    settledPicksTotal: 10,
    settledPicksExcludedFixture: 2,
    settledPicksMeasured: 8,
    clvCoveragePct: 75,
    edgeSourceQuality: { explicitPct: 10, marketBackedPct: 40, confidenceFallbackPct: 50 },
    kellySizingPopulatedPct: 20,
    marketBackedSettledCount: 34,
    developing: { threshold: 50, remaining: 16, met: false },
    strong: { threshold: 200, remaining: 166, met: false },
    generatedAt: '2026-07-02T00:00:00.000Z',
  });

  assert.ok(lines.some((line) => line.includes('34/50') && line.includes('16 to go')));
  assert.ok(lines.some((line) => line.includes('34/200') && line.includes('166 to go')));
});
