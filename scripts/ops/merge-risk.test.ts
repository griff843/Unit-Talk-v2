import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneManifest } from './shared.js';
import {
  buildMergeConflictForecast,
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

test('buildMergeConflictForecast reports candidate branch drift against main', () => {
  const forecast = buildMergeConflictForecast({
    candidateBranch: 'codex/utv2-1164-conflict-forecasting',
    baseBranch: 'main',
    candidateFiles: ['scripts/ops/merge-risk.ts'],
    activeLanes: [],
    baseChangedFiles: ['scripts/ops/merge-risk.ts', 'scripts/ops/other.ts'],
  });

  assert.deepStrictEqual(forecast.conditions.map((condition) => condition.code), [
    'CANDIDATE_MAIN_DRIFT',
  ]);
  assert.equal(forecast.conditions[0]?.severity, 'warning');
  assert.match(forecast.merge_order_recommendation, /Rebase candidate branch/);
});

test('buildMergeConflictForecast blocks active lane branch file conflicts', () => {
  const lane = createLane({
    issue_id: 'UTV2-1161',
    branch: 'codex/utv2-1161-live-lane-telemetry-board',
    file_scope_lock: ['scripts/ops/telemetry.ts'],
  });

  const forecast = buildMergeConflictForecast({
    candidateBranch: 'codex/utv2-1164-conflict-forecasting',
    baseBranch: 'main',
    candidateFiles: ['scripts/ops/merge-risk.ts'],
    activeLanes: [lane],
    activeLaneChangedFiles: {
      'codex/utv2-1161-live-lane-telemetry-board': ['scripts/ops/merge-risk.ts'],
    },
  });

  assert.deepStrictEqual(forecast.conditions.map((condition) => condition.code), [
    'CANDIDATE_ACTIVE_BRANCH_CONFLICT',
  ]);
  assert.equal(forecast.conditions[0]?.severity, 'block');
  assert.deepStrictEqual(forecast.conditions[0]?.lanes, ['UTV2-1161']);
  assert.match(forecast.merge_order_recommendation, /Must merge after UTV2-1161/);
});

test('buildMergeConflictForecast detects declared scope overlap and scope bleed', () => {
  const lane = createLane({
    issue_id: 'UTV2-1162',
    branch: 'codex/utv2-1162-queue-intake-wave-builder',
    file_scope_lock: ['scripts/ops'],
  });

  const forecast = buildMergeConflictForecast({
    candidateBranch: 'codex/utv2-1164-conflict-forecasting',
    baseBranch: 'main',
    candidateFiles: ['scripts/ops/merge-risk.ts', 'docs/06_status/proof/UTV2-1164/diff-summary.md'],
    declaredFileScope: ['scripts/ops/merge-risk.ts'],
    activeLanes: [lane],
  });

  assert.deepStrictEqual(forecast.conditions.map((condition) => condition.code), [
    'CANDIDATE_SCOPE_BLEED',
    'CANDIDATE_SCOPE_OVERLAP',
  ]);
  assert.equal(forecast.conditions[0]?.severity, 'warning');
  assert.equal(forecast.conditions[1]?.severity, 'block');
  assert.deepStrictEqual(forecast.conditions[1]?.lanes, ['UTV2-1162']);
});

test('buildMergeConflictForecast recommends independent merge when no conflicts are forecast', () => {
  const forecast = buildMergeConflictForecast({
    candidateBranch: 'codex/utv2-1164-conflict-forecasting',
    baseBranch: 'main',
    candidateFiles: ['scripts/ops/merge-risk.ts'],
    declaredFileScope: ['scripts/ops/merge-risk.ts'],
    activeLanes: [
      createLane({
        issue_id: 'UTV2-1163',
        branch: 'codex/utv2-1163-one-command-lane-closeout',
        file_scope_lock: ['scripts/ops/lane-finalize.ts'],
      }),
    ],
    baseChangedFiles: ['scripts/ops/other.ts'],
    activeLaneChangedFiles: {
      'codex/utv2-1163-one-command-lane-closeout': ['scripts/ops/lane-finalize.ts'],
    },
  });

  assert.deepStrictEqual(forecast.conditions, []);
  assert.equal(forecast.merge_order_recommendation, 'No active lane or main-drift conflicts forecast.');
});
