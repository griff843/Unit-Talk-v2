import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLaneFinalizePlan,
  runLaneFinalizePlan,
  type LaneFinalizeRunner,
} from './lane-finalize.js';
import type { LaneManifest } from './shared.js';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1073',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '/repo/.out/worktrees/codex__utv2-1073-closeout',
    branch: 'codex/utv2-1073-closeout',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/lane-finalize.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-1073/diff-summary.md'],
    status: 'merged',
    started_at: '2026-05-19T12:00:00.000Z',
    heartbeat_at: '2026-05-19T12:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1073-closeout.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

test('lane finalize plan chains merge record, proof generation, lane close, and reconcile', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest(),
    pr: '123',
  });

  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['record_merge', 'generate_proof', 'close_lane', 'reconcile_current'],
  );
  assert.deepEqual(plan.steps[0]?.args, [
    'ops:lane-manifest',
    'record-merge',
    'UTV2-1073',
    '--pr',
    '123',
    '--json',
  ]);
});

test('lane finalize dry run returns planned steps without executing commands', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest(),
    pr: '123',
    dryRun: true,
  });
  const result = runLaneFinalizePlan(plan, {
    runner: (() => {
      throw new Error('runner should not execute during dry-run');
    }) as LaneFinalizeRunner,
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'lane_finalize_dry_run');
  assert.equal(result.steps.every((step) => step.status === 'planned'), true);
});

test('lane finalize stops at the first failed command', () => {
  const calls: string[] = [];
  const result = runLaneFinalizePlan(buildLaneFinalizePlan({ manifest: manifest(), pr: '123' }), {
    runner: ((command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      return { status: calls.length === 2 ? 1 : 0, stdout: '', stderr: 'missing proof' };
    }) as LaneFinalizeRunner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'lane_finalize_failed');
  assert.equal(result.steps.at(-1)?.id, 'generate_proof');
  assert.equal(calls.length, 2);
});

test('already closed lane only reconciles current state', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({ status: 'done', closed_at: '2026-05-19T13:00:00.000Z' }),
    pr: '123',
  });

  assert.equal(plan.already_closed, true);
  assert.deepEqual(plan.steps.map((step) => step.id), ['reconcile_current']);
});
