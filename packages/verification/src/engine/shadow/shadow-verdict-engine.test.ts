import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ShadowVerdictEngine } from './shadow-verdict.js';

import type { ClassifiedDivergences } from './types.js';

function classified(counts: ClassifiedDivergences['bySeverity']): ClassifiedDivergences {
  return {
    scoreDivergences: [],
    structuralDivergences: [],
    bySeverity: counts,
    totalCount: counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW,
  };
}

test('returns PASS verdict for an empty divergence list', () => {
  const result = ShadowVerdictEngine.determine(
    classified({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 })
  );

  assert.equal(result.verdict, 'PASS');
  assert.equal(result.freezeRecommended, false);
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('returns PASS_WITH_WARNINGS for only LOW divergences', () => {
  const result = ShadowVerdictEngine.determine(
    classified({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 2 })
  );

  assert.equal(result.verdict, 'PASS_WITH_WARNINGS');
  assert.equal(result.freezeRecommended, false);
});

test('returns FAIL verdict and freeze recommendation for any CRITICAL divergence', () => {
  const result = ShadowVerdictEngine.determine(
    classified({ CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 3 })
  );

  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.freezeRecommended, true);
});
