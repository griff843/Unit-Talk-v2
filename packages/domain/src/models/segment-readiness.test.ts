import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSegmentReadinessResult,
  determineBenchmarkCandidates,
  summarizeSegmentPerformance,
  type SegmentOutcomeRow,
} from './segment-readiness.js';

test('summarizeSegmentPerformance aggregates outcomes and averages', () => {
  const rows: SegmentOutcomeRow[] = [
    { segment: 'Points', outcome: 'win', trust: 60, edge: 0.2 },
    { segment: 'Points', outcome: 'loss', trust: 40, edge: -0.1 },
    { segment: 'Assists', outcome: 'win', trust: 70, edge: 0.05 },
  ];

  const summaries = summarizeSegmentPerformance(rows);

  assert.deepEqual(summaries, [
    {
      segment: 'Points',
      picks: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      avgTrust: 50,
      avgEdge: 0.05,
    },
    {
      segment: 'Assists',
      picks: 1,
      wins: 1,
      losses: 0,
      winRate: 100,
      avgTrust: 70,
      avgEdge: 0.05,
    },
  ]);
});

test('determineBenchmarkCandidates respects minimum sample and limit', () => {
  const candidates = determineBenchmarkCandidates(
    [
      { segment: 'Moneyline', picks: 3, wins: 2, losses: 1, winRate: 66.67, avgTrust: 70, avgEdge: 0.1 },
      { segment: 'Total', picks: 3, wins: 3, losses: 0, winRate: 100, avgTrust: 65, avgEdge: 0.2 },
      { segment: 'Points', picks: 2, wins: 1, losses: 1, winRate: 50, avgTrust: 50, avgEdge: -0.1 },
      { segment: 'Assists', picks: 1, wins: 1, losses: 0, winRate: 100, avgTrust: 60, avgEdge: 0.05 },
    ],
    { minimumSample: 2, limit: 2 },
  );

  assert.deepEqual(candidates, [
    { segment: 'Moneyline', picks: 3, wins: 2, losses: 1, winRate: 66.67, avgTrust: 70, avgEdge: 0.1 },
    { segment: 'Total', picks: 3, wins: 3, losses: 0, winRate: 100, avgTrust: 65, avgEdge: 0.2 },
  ]);
});

test('buildSegmentReadinessResult combines summaries and candidate selection', () => {
  const result = buildSegmentReadinessResult([
    { segment: 'Points', outcome: 'win', trust: 60, edge: 0.2 },
    { segment: 'Points', outcome: 'loss', trust: 40, edge: -0.1 },
    { segment: 'Moneyline', outcome: 'win', trust: 75, edge: 0.3 },
    { segment: 'Moneyline', outcome: 'win', trust: 80, edge: 0.25 },
  ]);

  assert.equal(result.summaries.length, 2);
  assert.deepEqual(result.benchmarkCandidates.map((entry) => entry.segment), [
    'Moneyline',
    'Points',
  ]);
});
