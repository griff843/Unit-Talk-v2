import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DivergenceClassifier } from './divergence-classifier.js';

import type { DivergenceEntry, DivergenceReport } from '../shadow-comparator.js';

function report(divergences: DivergenceEntry[]): DivergenceReport {
  return {
    runId: 'classifier-test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    referenceEventCount: 0,
    shadowEventCount: 0,
    totalDivergences: divergences.length,
    bySeverity: { critical: 0, warning: 0, informational: 0 },
    byCategory: {
      pick_state: 0,
      lifecycle_trace: 0,
      publish: 0,
      settlement: 0,
      recap: 0,
    },
    divergences,
    passed: divergences.length === 0,
    verdict: divergences.length === 0 ? 'CLEAN' : 'CRITICAL_DIVERGENCE',
  };
}

function divergence(field: string): DivergenceEntry {
  return {
    pickId: 'pick-critical',
    category: 'pick_state',
    field,
    referenceValue: false,
    shadowValue: true,
    level: 'critical',
    description: `${field} mismatch`,
    detectedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('classifies critical structural field divergences as CRITICAL', () => {
  const classified = DivergenceClassifier.classify(
    report([divergence('posted_to_discord')]),
    new Map(),
    new Map()
  );

  assert.equal(classified.totalCount, 1);
  assert.equal(classified.bySeverity.CRITICAL, 1);
  assert.equal(classified.structuralDivergences[0]?.field, 'posted_to_discord');
  assert.equal(classified.structuralDivergences[0]?.level, 'CRITICAL');
});

test('classifies score divergences as HIGH, MEDIUM, and LOW by percent difference', () => {
  const referenceState = new Map<string, Record<string, unknown>>([
    ['pick-high', { professional_score: 100 }],
    ['pick-medium', { grade_score: 100 }],
    ['pick-low', { confidence: 100 }],
  ]);
  const shadowState = new Map<string, Record<string, unknown>>([
    ['pick-high', { professional_score: 94 }],
    ['pick-medium', { grade_score: 96 }],
    ['pick-low', { confidence: 99.5 }],
  ]);

  const classified = DivergenceClassifier.classify(report([]), referenceState, shadowState);

  assert.equal(classified.totalCount, 3);
  assert.deepEqual(classified.bySeverity, { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 1 });
  assert.deepEqual(
    classified.scoreDivergences.map(entry => [entry.pickId, entry.field, entry.level]),
    [
      ['pick-high', 'professional_score', 'HIGH'],
      ['pick-medium', 'grade_score', 'MEDIUM'],
      ['pick-low', 'confidence', 'LOW'],
    ]
  );
});

test('returns no classifications when no structural or score divergences exist', () => {
  const classified = DivergenceClassifier.classify(
    report([]),
    new Map([['pick-clean', { professional_score: 100 }]]),
    new Map([['pick-clean', { professional_score: 100 }]])
  );

  assert.equal(classified.totalCount, 0);
  assert.deepEqual(classified.bySeverity, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
  assert.deepEqual(classified.structuralDivergences, []);
  assert.deepEqual(classified.scoreDivergences, []);
});
