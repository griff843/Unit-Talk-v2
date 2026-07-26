import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateTierCAuthorization, type ParsedTierCApprovalRecord } from './tier-c-authorization-gate.ts';

function approval(overrides: Partial<ParsedTierCApprovalRecord> = {}): ParsedTierCApprovalRecord {
  return {
    issue_id: 'UTV2-1570',
    pr_number: 1300,
    head_sha: 'abc123def456abc123def456abc123def456abc1',
    paths: ['packages/domain/src/example.ts'],
    reason: 'test',
    authorized_by: 'griff843',
    ...overrides,
  };
}

test('passes when the diff touches no Tier C paths, regardless of tier', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['apps/api/src/harmless-file.ts', 'docs/README.md'],
    approvals: [],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.matched_tier_c_paths, []);
});

test('passes for a T1 lane touching Tier C paths with no approval comment at all', () => {
  // T1 is already covered by t1-approved + pm-verdict/v1 via merge-gate.yml --
  // this gate does not require a second artifact for T1.
  const report = evaluateTierCAuthorization({
    tier: 'T1',
    changedFiles: ['packages/domain/src/example.ts'],
    approvals: [],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'PASS');
  assert.match(report.reason, /t1-approved/);
});

test('fails a non-T1 lane touching a Tier C path with no approval comment', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['packages/domain/src/example.ts'],
    approvals: [],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(report.uncovered_paths, ['packages/domain/src/example.ts']);
  assert.equal(report.approval_used, null);
});

test('passes a non-T1 lane touching a Tier C path with a full-coverage approval bound to the exact head SHA', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['packages/domain/src/example.ts'],
    approvals: [approval()],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.uncovered_paths, []);
  assert.equal(report.approval_used?.authorized_by, 'griff843');
});

test('fails when the approval covers only some of the matched Tier C paths', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['packages/domain/src/example.ts', 'supabase/migrations/0001_new.sql'],
    approvals: [approval({ paths: ['packages/domain/src/example.ts'] })],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(report.uncovered_paths, ['supabase/migrations/0001_new.sql']);
  assert.deepEqual(report.covered_paths, ['packages/domain/src/example.ts']);
});

test('a directory-glob Paths entry (/**) covers every file under that directory', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['supabase/migrations/0001_new.sql', 'supabase/migrations/0002_more.sql'],
    approvals: [approval({ paths: ['supabase/migrations/**'] })],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'PASS');
});

test('fails closed when the approval is bound to a stale head SHA (later push not covered)', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['packages/domain/src/example.ts'],
    approvals: [approval({ head_sha: 'stale0000000000000000000000000000000000' })],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'FAIL');
});

test('fails closed when the approval is bound to a different PR number', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['packages/domain/src/example.ts'],
    approvals: [approval({ pr_number: 999 })],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'FAIL');
});

test('fails closed for T3 the same as T2 (only T1 is exempt)', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T3',
    changedFiles: ['apps/worker/src/delivery.ts'],
    approvals: [],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'FAIL');
});

test('a non-matching (non-Tier-C) changed file alongside a Tier C one only requires coverage of the Tier C file', () => {
  const report = evaluateTierCAuthorization({
    tier: 'T2',
    changedFiles: ['apps/api/src/harmless-file.ts', 'packages/domain/src/example.ts'],
    approvals: [approval()],
    prNumber: 1300,
    headSha: 'abc123def456abc123def456abc123def456abc1',
  });
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.matched_tier_c_paths, ['packages/domain/src/example.ts']);
});
