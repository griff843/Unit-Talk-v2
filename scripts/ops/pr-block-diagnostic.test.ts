import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrBlockDiagnostic, type CheckObservation } from './pr-block-diagnostic.js';

const HEAD_SHA = 'head123';
const OLD_SHA = 'old456';

function input(overrides: Partial<Parameters<typeof buildPrBlockDiagnostic>[0]> = {}) {
  return {
    pr: 761,
    mergeable: 'MERGEABLE',
    merge_state_status: 'CLEAN',
    branch_protection_required_checks: ['Merge Gate'],
    head_sha: HEAD_SHA,
    checks: [],
    ...overrides,
  };
}

function check(overrides: Partial<CheckObservation> & { name: string }): CheckObservation {
  return {
    conclusion: 'success',
    sha: HEAD_SHA,
    status: 'completed',
    completed_at: '2026-05-18T12:00:00.000Z',
    ...overrides,
  };
}

test('PR block diagnostic passes when current required checks pass despite stale failed duplicates', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    branch_protection_required_checks: ['Merge Gate', 'Tier Label Check'],
    checks: [
      check({ name: 'Merge Gate' }),
      check({ name: 'Merge Gate', sha: OLD_SHA, conclusion: 'failure', completed_at: '2026-05-18T11:00:00.000Z' }),
      check({ name: 'Tier Label Check' }),
    ],
  }));

  assert.strictEqual(diagnostic.verdict, 'PASS');
  assert.deepStrictEqual(diagnostic.blockers, []);
  assert.deepStrictEqual(diagnostic.duplicate_contexts, [{ name: 'Merge Gate', count: 2 }]);
  assert.deepStrictEqual(diagnostic.stale_failed_contexts, [
    { name: 'Merge Gate', sha: OLD_SHA, conclusion: 'failure' },
  ]);
});

test('PR block diagnostic blocks when a current required check is failing', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    pr: 762,
    merge_state_status: 'BLOCKED',
    checks: [check({ name: 'Merge Gate', conclusion: 'failure' })],
  }));

  assert.strictEqual(diagnostic.verdict, 'BLOCKED');
  assert.deepStrictEqual(diagnostic.blockers, [
    'required check not passing: Merge Gate (failure)',
  ]);
});

test('PR block diagnostic blocks when a required check is missing', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    pr: 763,
    merge_state_status: 'BLOCKED',
    branch_protection_required_checks: ['Merge Gate', 'Tier Label Check'],
    checks: [check({ name: 'Merge Gate' })],
  }));

  assert.strictEqual(diagnostic.verdict, 'BLOCKED');
  assert.deepStrictEqual(diagnostic.blockers, [
    'required check not passing: Tier Label Check (missing)',
  ]);
});

test('PR block diagnostic identifies stale failed contexts as the likely block source', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    pr: 764,
    merge_state_status: 'BLOCKED',
    checks: [
      check({ name: 'Merge Gate' }),
      check({ name: 'Merge Gate', sha: OLD_SHA, conclusion: 'timed_out', completed_at: '2026-05-18T10:00:00.000Z' }),
    ],
  }));

  assert.strictEqual(diagnostic.verdict, 'BLOCKED');
  assert.deepStrictEqual(diagnostic.blockers, [
    'mergeStateStatus is BLOCKED with stale failed duplicate contexts present',
  ]);
});

test('PR block diagnostic prefers current head checks over newer stale SHA observations', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    pr: 765,
    checks: [
      check({ name: 'Merge Gate', completed_at: '2026-05-18T12:00:00.000Z' }),
      check({ name: 'Merge Gate', sha: OLD_SHA, conclusion: 'failure', completed_at: '2026-05-18T13:00:00.000Z' }),
    ],
  }));

  assert.strictEqual(diagnostic.latest_required[0]?.sha, HEAD_SHA);
  assert.strictEqual(diagnostic.latest_required[0]?.conclusion, 'success');
  assert.strictEqual(diagnostic.verdict, 'PASS');
});

test('PR block diagnostic treats mixed-case passing conclusions as non-blocking', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    branch_protection_required_checks: ['verify', 'Executor Result Validation', 'Merge Gate', 'P0 Protocol'],
    checks: [
      check({ name: 'verify', conclusion: 'SUCCESS' }),
      check({ name: 'Executor Result Validation', conclusion: 'success' }),
      check({ name: 'Merge Gate', conclusion: 'NEUTRAL' }),
      check({ name: 'P0 Protocol', conclusion: 'skipped' }),
    ],
  }));

  assert.deepStrictEqual(diagnostic.blockers, []);
  assert.strictEqual(diagnostic.verdict, 'PASS');
});

test('PR block diagnostic reports a head branch behind its base branch', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    merge_state_status: 'BEHIND',
    checks: [check({ name: 'Merge Gate', conclusion: 'SUCCESS' })],
  }));

  assert.strictEqual(diagnostic.mergeable, 'MERGEABLE');
  assert.deepStrictEqual(diagnostic.blockers, [
    'head branch is not up to date with the base branch (mergeStateStatus: BEHIND)',
  ]);
  assert.strictEqual(diagnostic.verdict, 'BLOCKED');
});

test('PR block diagnostic reports merge conflicts and never reports passing checks as blockers', () => {
  const diagnostic = buildPrBlockDiagnostic(input({
    merge_state_status: 'DIRTY',
    branch_protection_required_checks: ['Merge Gate', 'Tier Label Check', 'P0 Protocol'],
    checks: [
      check({ name: 'Merge Gate', conclusion: 'SUCCESS' }),
      check({ name: 'Tier Label Check', conclusion: 'neutral' }),
      check({ name: 'P0 Protocol', conclusion: 'SKIPPED' }),
    ],
  }));

  assert.deepStrictEqual(diagnostic.blockers, [
    'head branch has merge conflicts with the base branch (mergeStateStatus: DIRTY)',
  ]);
});
