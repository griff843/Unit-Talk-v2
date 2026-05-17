import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveClvPayloadPaths,
  hasClvCoveragePayload,
  summarizeClvCoverage,
} from './clvCoverage.js';

test('CLV coverage counts active top-level settlement payload fields', () => {
  const settlement = {
    payload: {
      clvRaw: -0.0123,
      clvPercent: -1.23,
      beatsClosingLine: false,
      clvStatus: 'computed',
    },
  };

  assert.equal(hasClvCoveragePayload(settlement), true);
  assert.deepEqual(getActiveClvPayloadPaths(settlement), [
    'payload.clvRaw',
    'payload.clvPercent',
    'payload.beatsClosingLine',
  ]);
});

test('CLV coverage counts nested legacy clv object fields', () => {
  const settlement = {
    payload: {
      clv: {
        clvRaw: 0.02,
        clvPercent: 2,
        beatsClosingLine: true,
      },
    },
  };

  assert.equal(hasClvCoveragePayload(settlement), true);
  assert.deepEqual(getActiveClvPayloadPaths(settlement), [
    'payload.clv.clvRaw',
    'payload.clv.clvPercent',
    'payload.clv.beatsClosingLine',
  ]);
});

test('CLV coverage does not count null clv or unavailable diagnostics', () => {
  const settlement = {
    payload: {
      clv: null,
      clvStatus: 'missing_closing_line',
      clvUnavailableReason: 'missing_closing_line',
      clvSkipReason: 'No closing line available for this market',
    },
  };

  assert.equal(hasClvCoveragePayload(settlement), false);
  assert.deepEqual(getActiveClvPayloadPaths(settlement), []);
});

test('CLV coverage summary reports one denominator for readiness and scoring', () => {
  const summary = summarizeClvCoverage([
    { payload: { clvRaw: 0.01, clvPercent: 1, beatsClosingLine: true } },
    { payload: { clv: { clvRaw: -0.01, clvPercent: -1, beatsClosingLine: false } } },
    { payload: { clv: null, clvStatus: 'missing_closing_line' } },
    { payload: null },
  ]);

  assert.equal(summary.totalRecords, 4);
  assert.equal(summary.withClv, 2);
  assert.equal(summary.coveragePct, 50);
  assert.equal(summary.pathCounts['payload.clvRaw'], 1);
  assert.equal(summary.pathCounts['payload.clv.clvRaw'], 1);
});
