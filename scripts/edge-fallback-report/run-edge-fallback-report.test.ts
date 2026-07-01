import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runEdgeFallbackReport } from './run-edge-fallback-report.js';

function fixtureRows(nowIso: string) {
  const createdAt = new Date(new Date(nowIso).getTime() - 60_000).toISOString();
  return [
    {
      id: 'pick-domain-analysis',
      source: 'system-pick-scanner',
      created_at: createdAt,
      metadata: { domainAnalysis: { realEdge: 0.04, confidenceDelta: 0.1 } },
    },
    {
      id: 'pick-no-confidence',
      source: 'smart-form',
      created_at: createdAt,
      metadata: { domainAnalysis: { fallbackReason: 'no-confidence' } },
    },
    {
      id: 'pick-no-provider-offer',
      source: 'api',
      created_at: createdAt,
      metadata: {
        domainAnalysis: { confidenceDelta: 0.05 },
        edgeProvenance: { fallbackReason: 'no-provider-offer' },
      },
    },
    {
      id: 'pick-no-market-key',
      source: 'system-pick-scanner',
      created_at: createdAt,
      metadata: {
        domainAnalysis: { confidenceDelta: 0.02 },
        edgeProvenance: { fallbackReason: 'no-market-key' },
      },
    },
    {
      id: 'pick-no-participant-scope',
      source: 'board-construction',
      created_at: createdAt,
      metadata: {
        domainAnalysis: { confidenceDelta: 0.03 },
        edgeProvenance: { fallbackReason: 'no-participant-scope' },
      },
    },
    {
      id: 'pick-computation-error',
      source: 'api',
      created_at: createdAt,
      metadata: {
        domainAnalysis: { confidenceDelta: 0.01 },
        edgeProvenance: { fallbackReason: 'computation-error' },
      },
    },
    {
      id: 'pick-generic-confidence-delta',
      source: 'smart-form',
      created_at: createdAt,
      metadata: { domainAnalysis: { confidenceDelta: 0.08 } },
    },
    {
      id: 'pick-unknown-legacy',
      source: null,
      created_at: createdAt,
      metadata: {},
    },
    {
      id: 'pick-synthetic',
      source: 'synthetic',
      created_at: createdAt,
      metadata: { domainAnalysis: { fallbackReason: 'no-confidence' } },
    },
  ];
}

test('UTV2-1379: classifies each fallback category correctly from metadata', async () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fallback-report-'));

  const summary = await runEdgeFallbackReport({
    now,
    outDir,
    rows: fixtureRows(now.toISOString()),
  });

  const counts = summary['fallback_category_counts'] as Record<string, number>;
  assert.equal(counts['domain-analysis'], 1);
  assert.equal(counts['no-confidence'], 2, 'smart-form no-confidence + synthetic no-confidence');
  assert.equal(counts['no-provider-offer'], 1);
  assert.equal(counts['no-market-key'], 1);
  assert.equal(counts['no-participant-scope'], 1);
  assert.equal(counts['computation-error'], 1);
  assert.equal(counts['confidence-delta'], 1, 'generic confidence-delta with no distinguishable provenance reason');
  assert.equal(counts['unknown-legacy'], 1);

  assert.equal(summary['total_picks_analyzed'], 9);
});

test('UTV2-1379: real market-backed edge always wins over any recorded fallbackReason', async () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fallback-report-'));

  const summary = await runEdgeFallbackReport({
    now,
    outDir,
    rows: [
      {
        id: 'pick-recovered',
        source: 'system-pick-scanner',
        created_at: now.toISOString(),
        // Promotion-time recovery succeeded: realEdge is now present even
        // though a stale fallbackReason from a prior attempt still exists.
        metadata: {
          domainAnalysis: { realEdge: 0.02, fallbackReason: 'no-provider-offer' },
        },
      },
    ],
  });

  const counts = summary['fallback_category_counts'] as Record<string, number>;
  assert.equal(counts['domain-analysis'], 1);
  assert.equal(counts['no-provider-offer'], 0, 'stale fallbackReason must not override a proven real edge');
});

test('UTV2-1379: non-production sources are separately bucketed, not silently dropped', async () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fallback-report-'));

  const summary = await runEdgeFallbackReport({
    now,
    outDir,
    rows: fixtureRows(now.toISOString()),
  });

  const bySource = summary['by_source'] as Record<string, unknown>;
  assert.ok('non-production:api' in bySource, 'api source must be bucketed separately, not merged into production sources');
  assert.ok('non-production:synthetic' in bySource, 'synthetic source must be bucketed separately');
  assert.equal(summary['total_picks_analyzed'], 9, 'no rows silently excluded');
});

test('UTV2-1379B: productionOnly excludes non-production sources entirely from totals', async () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fallback-report-'));

  const summary = await runEdgeFallbackReport({
    now,
    outDir,
    productionOnly: true,
    rows: fixtureRows(now.toISOString()),
  });

  const bySource = summary['by_source'] as Record<string, unknown>;
  assert.ok(!('non-production:api' in bySource), 'production-only run must exclude api source entirely');
  assert.ok(!('non-production:synthetic' in bySource), 'production-only run must exclude synthetic source entirely');
  assert.equal(summary['production_only'], true);
  assert.equal(summary['excluded_non_production_count'], 3, 'two api rows + one synthetic row in the fixture');
  assert.equal(summary['total_picks_analyzed'], 6, '9 fixture rows minus 3 non-production');
});

test('UTV2-1379: writes required output files', async () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fallback-report-'));

  await runEdgeFallbackReport({ now, outDir, rows: fixtureRows(now.toISOString()) });

  assert.ok(fs.existsSync(path.join(outDir, 'edge-fallback-summary.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'edge-fallback-by-source.csv')));
});
