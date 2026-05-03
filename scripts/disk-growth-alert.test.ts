import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDiskProjection } from './disk-growth-alert.js';

test('disk growth summary marks 14 day projections as watch', () => {
  const summary = summarizeDiskProjection({
    diskUsedBytes: 100,
    diskAvailBytes: 1400,
    projectedDaysToFull: 14,
    sources: [],
  });

  assert.equal(summary.severity, 'watch');
});

test('disk growth summary escalates 7 and 3 day thresholds', () => {
  const warning = summarizeDiskProjection({
    diskUsedBytes: 100,
    diskAvailBytes: 700,
    projectedDaysToFull: 7,
    sources: [],
  });
  const critical = summarizeDiskProjection({
    diskUsedBytes: 100,
    diskAvailBytes: 300,
    projectedDaysToFull: 3,
    sources: [],
  });

  assert.equal(warning.severity, 'warning');
  assert.equal(critical.severity, 'critical');
});

test('disk growth summary sorts top growth sources by daily growth', () => {
  const summary = summarizeDiskProjection({
    diskUsedBytes: 100,
    diskAvailBytes: 700,
    projectedDaysToFull: 7,
    sources: [
      { source: 'audit_log', totalBytes: 10, estimatedGrowthBytesPerDay: 1 },
      { source: 'provider_payload_archive', totalBytes: 20, estimatedGrowthBytesPerDay: 4 },
      { source: 'provider_offers', totalBytes: 30, estimatedGrowthBytesPerDay: 3 },
    ],
  });

  assert.deepEqual(
    summary.topSources.map((source) => source.source),
    ['provider_payload_archive', 'provider_offers', 'audit_log'],
  );
});
