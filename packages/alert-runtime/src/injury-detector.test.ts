import assert from 'node:assert/strict';
import test from 'node:test';

import { STALENESS_THRESHOLD_HOURS } from '@unit-talk/domain';

import { detectInjuryChanges } from './injury-detector.js';
import type {
  InjuryDetectorInput,
} from './injury-detector.js';
import type {
  InjuryStatus,
  NormalizedInjuryReport,
} from './injury-types.js';

const NOW_ISO = '2026-05-11T12:00:00.000Z';

function buildReport(
  overrides: Partial<NormalizedInjuryReport> = {},
): NormalizedInjuryReport {
  return {
    participantId: 'p1',
    playerName: 'Player One',
    sport: 'nba',
    status: 'out',
    sourceTier: 'official',
    reportedAt: NOW_ISO,
    fetchedAt: NOW_ISO,
    ...overrides,
  };
}

function runDetector(
  overrides: Partial<InjuryDetectorInput> = {},
) {
  return detectInjuryChanges({
    reports: [buildReport()],
    previousStatuses: new Map<string, InjuryStatus>([['p1', 'out']]),
    activePickParticipants: new Set<string>(['p1']),
    nowIso: NOW_ISO,
    ...overrides,
  });
}

test('does not emit changes when status is unchanged', () => {
  const result = runDetector();

  assert.equal(result.reportsEvaluated, 1);
  assert.equal(result.participantsChecked, 1);
  assert.equal(result.staleReportsSkipped, 0);
  assert.deepEqual(result.changes, []);
});

test('detects out to available transition', () => {
  const result = runDetector({
    reports: [buildReport({ status: 'available' })],
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.previousStatus, 'out');
  assert.equal(result.changes[0]?.currentStatus, 'available');
  assert.deepEqual(result.changes[0]?.affectedPickIds, []);
});

test('detects available to out transition', () => {
  const result = runDetector({
    reports: [buildReport({ status: 'out' })],
    previousStatuses: new Map<string, InjuryStatus>([['p1', 'available']]),
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.previousStatus, 'available');
  assert.equal(result.changes[0]?.currentStatus, 'out');
});

test('skips stale reports older than the staleness threshold', () => {
  const staleFetchedAt = new Date(
    Date.parse(NOW_ISO) - (STALENESS_THRESHOLD_HOURS + 1) * 3600000,
  ).toISOString();

  const result = runDetector({
    reports: [buildReport({ fetchedAt: staleFetchedAt })],
    previousStatuses: new Map<string, InjuryStatus>([['p1', 'available']]),
  });

  assert.equal(result.staleReportsSkipped, 1);
  assert.equal(result.participantsChecked, 0);
  assert.deepEqual(result.changes, []);
});

test('does not emit changes for participants outside active picks', () => {
  const result = runDetector({
    reports: [buildReport({ participantId: 'p2' })],
    previousStatuses: new Map<string, InjuryStatus>([['p2', 'available']]),
    activePickParticipants: new Set<string>(['p1']),
  });

  assert.equal(result.participantsChecked, 1);
  assert.deepEqual(result.changes, []);
});

test('emits first seen change when participant status is out', () => {
  const result = runDetector({
    reports: [buildReport({ participantId: 'p3', status: 'out' })],
    previousStatuses: new Map<string, InjuryStatus>(),
    activePickParticipants: new Set<string>(['p3']),
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.previousStatus, null);
  assert.equal(result.changes[0]?.currentStatus, 'out');
});

test('does not emit first seen change when participant status is available', () => {
  const result = runDetector({
    reports: [buildReport({ participantId: 'p4', status: 'available' })],
    previousStatuses: new Map<string, InjuryStatus>(),
    activePickParticipants: new Set<string>(['p4']),
  });

  assert.deepEqual(result.changes, []);
});
