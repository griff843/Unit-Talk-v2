import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLaneFinalizePlan,
  resolveLaneFinalizeInput,
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
    ['record_merge', 'apply_tier_label', 'generate_proof', 'generate_t2_proof_bundle', 'close_lane', 'reconcile_current'],
  );
  assert.deepEqual(plan.steps[0]?.args, [
    'ops:lane-manifest',
    'record-merge',
    'UTV2-1073',
    '--pr',
    '123',
    '--json',
  ]);
  assert.deepEqual(plan.steps[2]?.args, [
    'ops:proof-generate',
    'UTV2-1073',
    '--json',
    '--current',
    '--branch',
    'codex/utv2-1073-closeout',
    '--pr-url',
    'https://github.com/griff843/Unit-Talk-v2/pull/123',
  ]);
  assert.deepEqual(plan.steps[3]?.args, [
    'exec',
    'tsx',
    'scripts/ops/t2-proof-bundle.ts',
    'UTV2-1073',
    '--json',
    '--force',
    '--diff-summary',
    'docs/06_status/proof/UTV2-1073/diff-summary.md',
    '--verification-log',
    'docs/06_status/proof/UTV2-1073/runtime-verification.md',
  ]);
});

test('lane finalize leaves runtime T2 proof generation to the existing proof path', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({ lane_type: 'runtime' }),
    pr: '123',
  });

  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['record_merge', 'apply_tier_label', 'generate_proof', 'close_lane', 'reconcile_current'],
  );
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

test('lane finalize stops at the first required failed command', () => {
  const result = runLaneFinalizePlan(buildLaneFinalizePlan({ manifest: manifest(), pr: '123' }), {
    runner: ((_, args) => {
      // Fail generate_t2_proof_bundle (args[2] === 't2-proof-bundle.ts')
      const isT2Bundle = args.includes('scripts/ops/t2-proof-bundle.ts') || args[2] === 'scripts/ops/t2-proof-bundle.ts';
      return { status: isT2Bundle ? 1 : 0, stdout: '', stderr: isT2Bundle ? 'missing proof' : '' };
    }) as LaneFinalizeRunner,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'lane_finalize_failed');
  assert.equal(result.steps.find((s) => s.status === 'failed')?.id, 'generate_t2_proof_bundle');
});

test('already closed lane only reconciles current state', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({ status: 'done', closed_at: '2026-05-19T13:00:00.000Z' }),
    pr: '123',
  });

  assert.equal(plan.already_closed, true);
  assert.deepEqual(plan.steps.map((step) => step.id), ['reconcile_current']);
});

test('merge sha is threaded into generate_proof args when provided', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest(),
    pr: '123',
    mergeSha: 'aabbcc1122334455aabbcc1122334455aabbcc11',
  });

  const generateProofStep = plan.steps.find((s) => s.id === 'generate_proof');
  assert.ok(generateProofStep, 'generate_proof step must exist');
  assert.ok(
    generateProofStep.args.includes('--merge-sha'),
    'generate_proof args must include --merge-sha flag',
  );
  assert.ok(
    generateProofStep.args.includes('aabbcc1122334455aabbcc1122334455aabbcc11'),
    'generate_proof args must include the merge SHA value',
  );
});

test('generate_proof args contain no --merge-sha when mergeSha is not provided', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest(),
    pr: '123',
  });

  const generateProofStep = plan.steps.find((s) => s.id === 'generate_proof');
  assert.ok(generateProofStep, 'generate_proof step must exist');
  assert.equal(
    generateProofStep.args.includes('--merge-sha'),
    false,
    'generate_proof args must not include --merge-sha when not provided',
  );
});

test('non-required step (apply_tier_label) is skipped on failure without aborting finalize', () => {
  const calls: string[] = [];
  const result = runLaneFinalizePlan(
    buildLaneFinalizePlan({ manifest: manifest({ tier: 'T2' }), pr: '456' }),
    {
      runner: ((command, args) => {
        calls.push(`${command} ${args[0] ?? ''}`);
        // Simulate apply_tier_label failing (gh pr edit)
        if (command === 'gh' && args.includes('edit')) return { status: 1, stdout: '', stderr: 'auth error' };
        return { status: 0, stdout: '', stderr: '' };
      }) as LaneFinalizeRunner,
    },
  );

  const tierStep = result.steps.find((s) => s.id === 'apply_tier_label');
  assert.ok(tierStep, 'apply_tier_label step must exist');
  assert.equal(tierStep.status, 'skipped', 'apply_tier_label must be skipped on failure, not abort');
  assert.equal(result.ok, true, 'finalize must succeed even when non-required step fails');
});

test('resolveLaneFinalizeInput falls back to manifest PR URL', () => {
  const resolved = resolveLaneFinalizeInput({
    manifest: manifest({ pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/853' }),
  });

  assert.deepStrictEqual(resolved, { issueId: 'UTV2-1073', pr: '853' });
});

test('resolveLaneFinalizeInput rejects issue ids that do not match the manifest', () => {
  assert.throws(
    () =>
      resolveLaneFinalizeInput({
        issueId: 'UTV2-9999',
        manifest: manifest(),
        pr: '123',
      }),
    /does not match manifest issue/,
  );
});
