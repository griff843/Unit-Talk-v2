import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFireBoard,
  countBySeverity,
  formatRelativeAge,
  severityRank,
  sortFireBoardItems,
  type FireBoardExceptionCounts,
  type FireBoardInputs,
} from './fire-board-model';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

const emptyExceptions: FireBoardExceptionCounts = {
  failedDelivery: 0,
  deadLetter: 0,
  pendingManualReview: 0,
  staleValidated: 0,
  awaitingApprovalDrift: 0,
  rerunCandidates: 0,
  missingBookAliases: 0,
  missingMarketAliases: 0,
};

function baseInputs(overrides: Partial<FireBoardInputs> = {}): FireBoardInputs {
  return {
    exceptions: emptyExceptions,
    providerCycle: null,
    pipeline: null,
    runtime: { apiStatus: 'healthy', warnings: [] },
    nowMs: NOW,
    ...overrides,
  };
}

test('all healthy inputs produce an empty board', () => {
  assert.deepEqual(buildFireBoard(baseInputs()), []);
});

test('dead letter and failed delivery are critical outbox items', () => {
  const items = buildFireBoard(
    baseInputs({ exceptions: { ...emptyExceptions, deadLetter: 3, failedDelivery: 2 } }),
  );
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.severity === 'critical' && item.system === 'Outbox'));
  assert.equal(items[0]!.href, '/operations/outbox?status=dead_letter');
});

test('manual review settlements are needs-pm', () => {
  const items = buildFireBoard(
    baseInputs({ exceptions: { ...emptyExceptions, pendingManualReview: 4 } }),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.severity, 'needs-pm');
  assert.equal(items[0]!.href, '/operations/results');
});

test('provider failed/stale lanes rank critical; blocked lanes rank warning', () => {
  const critical = buildFireBoard(
    baseInputs({
      providerCycle: {
        overallStatus: 'critical', trackedLanes: 5, failedLanes: 1, staleLanes: 2,
        blockedLanes: 0, proofRequiredLanes: 0, latestUpdatedAt: '2026-07-06T10:00:00.000Z',
      },
    }),
  );
  assert.equal(critical[0]!.severity, 'critical');

  const warning = buildFireBoard(
    baseInputs({
      providerCycle: {
        overallStatus: 'warning', trackedLanes: 5, failedLanes: 0, staleLanes: 0,
        blockedLanes: 1, proofRequiredLanes: 0, latestUpdatedAt: null,
      },
    }),
  );
  assert.equal(warning[0]!.severity, 'warning');
});

test('runtime unavailable produces a warning item, not a crash', () => {
  const items = buildFireBoard(baseInputs({ runtime: null, runtimeUnavailable: true }));
  assert.equal(items.length, 1);
  assert.equal(items[0]!.severity, 'warning');
  assert.equal(items[0]!.title, 'Runtime health unavailable');
});

test('runtime down is critical; degraded is warning; warnings-only is info', () => {
  assert.equal(buildFireBoard(baseInputs({ runtime: { apiStatus: 'down', warnings: [] } }))[0]!.severity, 'critical');
  assert.equal(buildFireBoard(baseInputs({ runtime: { apiStatus: 'degraded', warnings: ['x'] } }))[0]!.severity, 'warning');
  assert.equal(buildFireBoard(baseInputs({ runtime: { apiStatus: 'healthy', warnings: ['x'] } }))[0]!.severity, 'info');
});

test('non-healthy pipeline status maps by keyword', () => {
  const critical = buildFireBoard(baseInputs({
    pipeline: { overallStatus: 'blocked', itemsInFlight: 10, errorCount: 2, observedAt: '2026-07-06T11:00:00.000Z' },
  }));
  assert.equal(critical[0]!.severity, 'critical');
  const warning = buildFireBoard(baseInputs({
    pipeline: { overallStatus: 'degraded', itemsInFlight: 10, errorCount: 2, observedAt: '2026-07-06T11:00:00.000Z' },
  }));
  assert.equal(warning[0]!.severity, 'warning');
});

test('items are sorted critical → warning → needs-pm → info', () => {
  const items = buildFireBoard(baseInputs({
    exceptions: { ...emptyExceptions, deadLetter: 1, pendingManualReview: 1, staleValidated: 1, missingBookAliases: 2 },
  }));
  const ranks = items.map((item) => severityRank(item.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(items[0]!.severity, 'critical');
  assert.equal(items[items.length - 1]!.severity, 'info');
});

test('sortFireBoardItems does not mutate its input', () => {
  const input = buildFireBoard(baseInputs({ exceptions: { ...emptyExceptions, deadLetter: 1 } }));
  const copy = [...input];
  sortFireBoardItems(input);
  assert.deepEqual(input, copy);
});

test('countBySeverity tallies each bucket', () => {
  const items = buildFireBoard(baseInputs({
    exceptions: { ...emptyExceptions, deadLetter: 1, failedDelivery: 1, pendingManualReview: 1 },
  }));
  const counts = countBySeverity(items);
  assert.equal(counts.critical, 2);
  assert.equal(counts['needs-pm'], 1);
  assert.equal(counts.warning, 0);
});

test('formatRelativeAge handles minutes, hours, days, and bad input', () => {
  assert.equal(formatRelativeAge('2026-07-06T11:45:00.000Z', NOW), '15m ago');
  assert.equal(formatRelativeAge('2026-07-06T09:00:00.000Z', NOW), '3h ago');
  assert.equal(formatRelativeAge('2026-07-01T12:00:00.000Z', NOW), '5d ago');
  assert.equal(formatRelativeAge(null, NOW), null);
  assert.equal(formatRelativeAge('not-a-date', NOW), null);
});
