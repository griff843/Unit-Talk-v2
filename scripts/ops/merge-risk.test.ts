import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneManifest } from './shared.js';
import {
  detectBlockedDeps,
  detectBranchNoPr,
  detectFileOverlap,
  detectPrNoLane,
  detectStaleHeartbeat,
} from './merge-risk.js';

function createLane(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-973',
    lane_type: 'codex-cli',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-973-merge-risk',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/merge-risk.ts'],
    expected_proof_paths: [],
    status: 'started',
    started_at: '2026-05-15T12:00:00.000Z',
    heartbeat_at: '2026-05-15T12:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

test('detectFileOverlap emits FILE_OVERLAP block when active manifests share file scope', () => {
  const left = createLane({
    issue_id: 'UTV2-973',
    file_scope_lock: ['scripts/ops/merge-risk.ts', 'scripts/ops/shared.ts'],
  });
  const right = createLane({
    issue_id: 'UTV2-974',
    branch: 'codex/utv2-974-other-lane',
    file_scope_lock: ['scripts/ops/shared.ts'],
  });

  const conditions = detectFileOverlap([left, right]);

  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]?.code, 'FILE_OVERLAP');
  assert.equal(conditions[0]?.severity, 'block');
  assert.deepStrictEqual(conditions[0]?.lanes, ['UTV2-973', 'UTV2-974']);
});

test('detectBranchNoPr emits ACTIVE_BRANCH_NO_PR warning when remote branch has no open PR', () => {
  const lane = createLane({
    issue_id: 'UTV2-975',
    branch: 'codex/utv2-975-no-pr',
  });

  const conditions = detectBranchNoPr([lane], ['codex/utv2-975-no-pr'], []);

  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]?.code, 'ACTIVE_BRANCH_NO_PR');
  assert.equal(conditions[0]?.severity, 'warning');
  assert.deepStrictEqual(conditions[0]?.lanes, ['UTV2-975']);
});

test('detectPrNoLane emits PR_NO_ACTIVE_LANE warning when an open PR branch has no active manifest', () => {
  const lane = createLane({
    issue_id: 'UTV2-976',
    branch: 'codex/utv2-976-existing-lane',
  });

  const conditions = detectPrNoLane([lane], ['codex/utv2-999-orphan-pr']);

  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]?.code, 'PR_NO_ACTIVE_LANE');
  assert.equal(conditions[0]?.severity, 'warning');
  assert.deepStrictEqual(conditions[0]?.lanes, []);
});

test('detectBlockedDeps emits BLOCKED_DEP_NOT_DONE block when blocked_by references an active manifest', () => {
  const blocker = createLane({
    issue_id: 'UTV2-977',
    branch: 'codex/utv2-977-blocker',
  });
  const dependent = createLane({
    issue_id: 'UTV2-978',
    branch: 'codex/utv2-978-dependent',
    blocked_by: ['UTV2-977'],
  });

  const conditions = detectBlockedDeps([blocker, dependent]);

  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]?.code, 'BLOCKED_DEP_NOT_DONE');
  assert.equal(conditions[0]?.severity, 'block');
  assert.deepStrictEqual(conditions[0]?.lanes, ['UTV2-978', 'UTV2-977']);
});

test('detectStaleHeartbeat emits STALE_LANE_HEARTBEAT warning when heartbeat is older than 72 hours', () => {
  const lane = createLane({
    issue_id: 'UTV2-979',
    branch: 'codex/utv2-979-stale',
    heartbeat_at: '2026-05-12T08:59:59.000Z',
  });

  const nowMs = Date.parse('2026-05-15T09:00:00.000Z');
  const conditions = detectStaleHeartbeat([lane], nowMs);

  assert.equal(conditions.length, 1);
  assert.equal(conditions[0]?.code, 'STALE_LANE_HEARTBEAT');
  assert.equal(conditions[0]?.severity, 'warning');
  assert.deepStrictEqual(conditions[0]?.lanes, ['UTV2-979']);
});
