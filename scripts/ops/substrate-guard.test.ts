import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSubstrate,
  robustExists,
  type SubstrateFacts,
} from './substrate-guard.js';

// A fully-healthy fact set. Individual tests override one field at a time.
function healthyFacts(): SubstrateFacts {
  return {
    leaseDir: { exists: true, initializable: true },
    mergeLock: { state: 'missing' },
    activeLanes: [
      { issue_id: 'UTV2-1196', worktree_path: '.out/worktrees/codex__utv2-1196', worktree_exists: true },
    ],
    orphanWorktrees: [],
    mergeRisk: { included: true, available: true, hardFails: [] },
    linear: { checked: true, conflicts: [] },
  };
}

test('healthy substrate passes with zero hard_fail and zero warning', () => {
  const report = evaluateSubstrate(healthyFacts());
  assert.equal(report.ok, true);
  assert.equal(report.summary.hard_fail, 0);
  assert.equal(report.summary.warning, 0);
  assert.equal(report.checks.lease_dir, 'pass');
  assert.equal(report.checks.merge_lock, 'pass');
  assert.equal(report.checks.active_lane_worktrees, 'pass');
  assert.equal(report.checks.board_hard_fail, 'pass');
  assert.equal(report.checks.linear_conflict, 'pass');
});

test('lease dir missing AND not initializable -> hard_fail', () => {
  const facts = healthyFacts();
  facts.leaseDir = { exists: false, initializable: false };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'lease_dir_uninitializable' && f.severity === 'hard_fail'));
  assert.equal(report.checks.lease_dir, 'fail');
});

test('lease dir missing BUT initializable -> pass (no hard_fail)', () => {
  const facts = healthyFacts();
  facts.leaseDir = { exists: false, initializable: true };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, true);
  assert.equal(report.checks.lease_dir, 'pass');
});

test('invalid/corrupt merge lock -> hard_fail', () => {
  const facts = healthyFacts();
  facts.mergeLock = { state: 'invalid', detail: 'unexpected token' };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'merge_lock_invalid' && f.severity === 'hard_fail'));
  assert.equal(report.checks.merge_lock, 'fail');
});

for (const state of ['missing', 'released', 'held'] as const) {
  test(`merge lock state "${state}" is not a failure`, () => {
    const facts = healthyFacts();
    facts.mergeLock = { state };
    const report = evaluateSubstrate(facts);
    assert.equal(report.checks.merge_lock, 'pass');
    assert.ok(!report.findings.some((f) => f.code === 'merge_lock_invalid'));
  });
}

test('active lane with missing worktree -> hard_fail naming the lane', () => {
  const facts = healthyFacts();
  facts.activeLanes = [
    { issue_id: 'UTV2-1196', worktree_path: '.out/worktrees/codex__utv2-1196', worktree_exists: false },
  ];
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  const finding = report.findings.find((f) => f.code === 'active_lane_missing_worktree');
  assert.ok(finding);
  assert.deepEqual(finding?.lanes, ['UTV2-1196']);
  assert.equal(report.checks.active_lane_worktrees, 'fail');
});

test('orphan worktree missing dir is a warning, not a hard_fail', () => {
  const facts = healthyFacts();
  facts.orphanWorktrees = [{ path: '/repo/.out/worktrees/stale', exists: false }];
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, true);
  assert.equal(report.summary.warning, 1);
  assert.ok(report.findings.some((f) => f.code === 'orphan_worktree_missing_dir' && f.severity === 'warning'));
});

test('existing board hard_fail lane (merge-risk) -> hard_fail passthrough', () => {
  const facts = healthyFacts();
  facts.mergeRisk = {
    included: true,
    available: true,
    hardFails: [
      { code: 'MERGED_PR_ACTIVE_LANE', lanes: ['UTV2-1150'], detail: 'merged PR but lane started' },
    ],
  };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  const finding = report.findings.find((f) => f.code === 'board_hard_fail:MERGED_PR_ACTIVE_LANE');
  assert.ok(finding);
  assert.deepEqual(finding?.lanes, ['UTV2-1150']);
  assert.equal(report.checks.board_hard_fail, 'fail');
});

test('merge-risk unavailable -> warning only, board check skipped', () => {
  const facts = healthyFacts();
  facts.mergeRisk = { included: true, available: false, hardFails: [], error: 'gh timeout' };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, true);
  assert.equal(report.checks.board_hard_fail, 'skipped');
  assert.ok(report.findings.some((f) => f.code === 'merge_risk_unavailable' && f.severity === 'warning'));
});

test('merge-risk not included -> board check skipped, no warning noise from it', () => {
  const facts = healthyFacts();
  facts.mergeRisk = { included: false, available: false, hardFails: [] };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, true);
  assert.equal(report.checks.board_hard_fail, 'skipped');
  assert.ok(!report.findings.some((f) => f.code === 'merge_risk_unavailable'));
});

test('linear conflict (checked) -> hard_fail', () => {
  const facts = healthyFacts();
  facts.linear = {
    checked: true,
    conflicts: [{ issue_id: 'UTV2-1196', detail: 'Linear=Done but manifest=started' }],
  };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'linear_manifest_conflict' && f.severity === 'hard_fail'));
  assert.equal(report.checks.linear_conflict, 'fail');
});

test('linear check skipped -> warning, not a pass-through and not a hard_fail', () => {
  const facts = healthyFacts();
  facts.linear = { checked: false, conflicts: [], reason: 'no token' };
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, true);
  assert.equal(report.checks.linear_conflict, 'skipped');
  assert.ok(report.findings.some((f) => f.code === 'linear_check_skipped' && f.severity === 'warning'));
});

test('multiple hard_fails are all reported and counted', () => {
  const facts = healthyFacts();
  facts.leaseDir = { exists: false, initializable: false };
  facts.mergeLock = { state: 'invalid' };
  facts.activeLanes = [
    { issue_id: 'UTV2-1', worktree_path: 'a', worktree_exists: false },
    { issue_id: 'UTV2-2', worktree_path: 'b', worktree_exists: false },
  ];
  const report = evaluateSubstrate(facts);
  assert.equal(report.ok, false);
  assert.equal(report.summary.hard_fail, 4);
});

// ---- robustExists: the WSL transient-ENOENT defense ----

test('robustExists returns true once existsFn hits (transient ENOENT recovery)', () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = robustExists('/some/path', {
    retries: 5,
    delayMs: 25,
    existsFn: () => {
      calls += 1;
      return calls >= 3; // miss, miss, then hit (transient ENOENT for 2 stats)
    },
    sleepFn: (ms) => sleeps.push(ms),
  });
  assert.equal(result, true);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [25, 25]); // slept only between the two misses
});

test('robustExists returns false only after exhausting retries (genuine absence)', () => {
  let calls = 0;
  const result = robustExists('/missing', {
    retries: 3,
    delayMs: 0,
    existsFn: () => {
      calls += 1;
      return false;
    },
    sleepFn: () => {},
  });
  assert.equal(result, false);
  assert.equal(calls, 4); // initial attempt + 3 retries
});

test('robustExists returns true immediately when present (no sleeps)', () => {
  const sleeps: number[] = [];
  const result = robustExists('/present', {
    existsFn: () => true,
    sleepFn: (ms) => sleeps.push(ms),
  });
  assert.equal(result, true);
  assert.equal(sleeps.length, 0);
});
