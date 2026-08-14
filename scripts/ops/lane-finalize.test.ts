import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyLinearTierLabel,
  buildLaneFinalizePlan,
  parseLaneFinalizeCliArgs,
  readLaneFinalizeProgress,
  resolveLaneFinalizeInput,
  runLaneFinalizePlan,
  writeLaneFinalizeProgress,
  type LaneFinalizeRunner,
  type LinearTierQuery,
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
    status: 'in_review',
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
    [
      'record_merge',
      'apply_tier_label',
      'apply_linear_tier_label',
      'generate_proof',
      'generate_t2_proof_bundle',
      'close_lane',
      'reconcile_current',
    ],
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
    'exec',
    'tsx',
    'scripts/ops/lane-finalize.ts',
    '--issue',
    'UTV2-1073',
    '--apply-linear-tier-label',
    'T2',
    '--json',
  ]);
  assert.deepEqual(plan.steps[3]?.args, [
    'ops:proof-generate',
    'UTV2-1073',
    '--json',
    '--current',
    '--branch',
    'codex/utv2-1073-closeout',
    '--pr-url',
    'https://github.com/griff843/Unit-Talk-v2/pull/123',
  ]);
  assert.deepEqual(plan.steps[4]?.args, [
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
    [
      'record_merge',
      'apply_tier_label',
      'apply_linear_tier_label',
      'generate_proof',
      'close_lane',
      'reconcile_current',
    ],
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
  assert.equal(
    result.steps.every((step) => step.status === 'planned'),
    true,
  );
});

test('lane finalize stops at the first required failed command', () => {
  const result = runLaneFinalizePlan(
    buildLaneFinalizePlan({ manifest: manifest(), pr: '123' }),
    {
      runner: ((_, args) => {
        // Fail generate_t2_proof_bundle (args[2] === 't2-proof-bundle.ts')
        const isT2Bundle =
          args.includes('scripts/ops/t2-proof-bundle.ts') ||
          args[2] === 'scripts/ops/t2-proof-bundle.ts';
        return {
          status: isT2Bundle ? 1 : 0,
          stdout: '',
          stderr: isT2Bundle ? 'missing proof' : '',
        };
      }) as LaneFinalizeRunner,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'lane_finalize_failed');
  assert.equal(
    result.steps.find((s) => s.status === 'failed')?.id,
    'generate_t2_proof_bundle',
  );
});

test('already closed lane only reconciles current state', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({
      status: 'done',
      closed_at: '2026-05-19T13:00:00.000Z',
    }),
    pr: '123',
  });

  assert.equal(plan.already_closed, true);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['reconcile_current'],
  );
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

test('tier label application failure aborts lane finalize', () => {
  const result = runLaneFinalizePlan(
    buildLaneFinalizePlan({ manifest: manifest({ tier: 'T2' }), pr: '456' }),
    {
      runner: ((command, args) => {
        // Simulate apply_tier_label failing (gh pr edit)
        if (command === 'gh' && args.includes('edit'))
          return { status: 1, stdout: '', stderr: 'auth error' };
        return { status: 0, stdout: '', stderr: '' };
      }) as LaneFinalizeRunner,
    },
  );

  const tierStep = result.steps.find((s) => s.id === 'apply_tier_label');
  assert.ok(tierStep, 'apply_tier_label step must exist');
  assert.equal(
    tierStep.status,
    'failed',
    'apply_tier_label must fail closed when GitHub labeling fails',
  );
  assert.equal(
    result.ok,
    false,
    'finalize must fail when the authoritative tier label cannot be applied',
  );
  assert.equal(result.code, 'lane_finalize_failed');
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['record_merge', 'apply_tier_label'],
    'finalize must stop before proof generation when tier labeling fails',
  );
});

test('Linear tier label application failure aborts before proof generation', () => {
  const result = runLaneFinalizePlan(
    buildLaneFinalizePlan({ manifest: manifest({ tier: 'T2' }), pr: '456' }),
    {
      runner: ((command, args) => {
        if (command === 'pnpm' && args.includes('--apply-linear-tier-label')) {
          return { status: 1, stdout: '', stderr: 'Linear write failed' };
        }
        return { status: 0, stdout: '', stderr: '' };
      }) as LaneFinalizeRunner,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.steps.at(-1)?.id, 'apply_linear_tier_label');
  assert.equal(result.steps.at(-1)?.status, 'failed');
  assert.match(result.message, /incomplete.*apply_linear_tier_label.*Re-run/s);
  assert.deepEqual(result.completed_step_ids, [
    'record_merge',
    'apply_tier_label',
  ]);
});

test('Linear tier label writer is idempotent when the authoritative label is already present', async () => {
  let calls = 0;
  const query: LinearTierQuery = async <T>() => {
    calls += 1;
    return {
      ok: true,
      data: {
        issue: {
          id: 'issue-id',
          identifier: 'UTV2-1073',
          labels: { nodes: [{ id: 'tier-t1', name: 'tier:T1' }] },
          team: { labels: { nodes: [{ id: 'tier-t1', name: 'tier:T1' }] } },
        },
        issueLabels: { nodes: [{ id: 'tier-t1', name: 'tier:T1' }] },
      } as T,
    };
  };

  const result = await applyLinearTierLabel({
    issueId: 'UTV2-1073',
    tier: 'T1',
    token: 'test-token',
    query,
  });

  assert.equal(result.code, 'linear_tier_label_already_applied');
  assert.equal(result.changed, false);
  assert.equal(calls, 1, 'an idempotent re-run must not issue a mutation');
});

test('Linear tier label writer replaces conflicting tier labels, preserves other labels, and verifies the write', async () => {
  const variables: Array<Record<string, unknown>> = [];
  const query: LinearTierQuery = async <T>(_query, input) => {
    variables.push(input);
    if (variables.length === 1) {
      return {
        ok: true,
        data: {
          issue: {
            id: 'issue-id',
            identifier: 'UTV2-1073',
            labels: {
              nodes: [
                { id: 'area-ops', name: 'area:tooling' },
                { id: 'tier-t2', name: 'tier:T2' },
              ],
            },
            team: {
              labels: {
                nodes: [
                  { id: 'tier-t1', name: 'tier:T1' },
                  { id: 'tier-t2', name: 'tier:T2' },
                ],
              },
            },
          },
          issueLabels: {
            nodes: [
              { id: 'tier-t1', name: 'tier:T1' },
              { id: 'tier-t2', name: 'tier:T2' },
            ],
          },
        } as T,
      };
    }
    return {
      ok: true,
      data: {
        issueUpdate: {
          success: true,
          issue: {
            identifier: 'UTV2-1073',
            labels: {
              nodes: [
                { id: 'area-ops', name: 'area:tooling' },
                { id: 'tier-t1', name: 'tier:T1' },
              ],
            },
          },
        },
      } as T,
    };
  };

  const result = await applyLinearTierLabel({
    issueId: 'UTV2-1073',
    tier: 'T1',
    token: 'test-token',
    query,
  });

  assert.equal(result.code, 'linear_tier_label_applied');
  assert.equal(result.changed, true);
  assert.deepEqual(variables[1], {
    issueId: 'issue-id',
    labelIds: ['area-ops', 'tier-t1'],
  });
});

test('Linear tier label writer fails closed when the mutation response does not verify the requested tier', async () => {
  let calls = 0;
  const query: LinearTierQuery = async <T>() => {
    calls += 1;
    return {
      ok: true,
      data: (calls === 1
        ? {
            issue: {
              id: 'issue-id',
              identifier: 'UTV2-1073',
              labels: { nodes: [{ id: 'tier-t2', name: 'tier:T2' }] },
              team: {
                labels: { nodes: [{ id: 'tier-t1', name: 'tier:T1' }] },
              },
            },
            issueLabels: { nodes: [] },
          }
        : {
            issueUpdate: {
              success: true,
              issue: {
                identifier: 'UTV2-1073',
                labels: { nodes: [{ id: 'tier-t2', name: 'tier:T2' }] },
              },
            },
          }) as T,
    };
  };

  await assert.rejects(
    applyLinearTierLabel({
      issueId: 'UTV2-1073',
      tier: 'T1',
      token: 'test-token',
      query,
    }),
    /verification failed.*tier:T2/,
  );
});

test('a partial finalize durably resumes without repeating completed steps', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({ tier: 'T1' }),
    pr: '456',
  });
  const durable: Array<(typeof plan.steps)[number]['id']> = [];
  const first = runLaneFinalizePlan(plan, {
    runner: ((_command, args) => ({
      status: args.includes('ops:proof-generate') ? 1 : 0,
      stdout: '',
      stderr: args.includes('ops:proof-generate') ? 'proof failed' : '',
    })) as LaneFinalizeRunner,
    onStepCompleted: (step) => durable.push(step.id),
  });
  assert.equal(first.ok, false);
  assert.deepEqual(durable, [
    'record_merge',
    'apply_tier_label',
    'apply_linear_tier_label',
  ]);

  const rerunCommands: string[] = [];
  const resumed = runLaneFinalizePlan(plan, {
    completedStepIds: durable,
    runner: ((command, args) => {
      rerunCommands.push(`${command} ${args.join(' ')}`);
      return { status: 0, stdout: '', stderr: '' };
    }) as LaneFinalizeRunner,
  });

  assert.equal(resumed.ok, true);
  assert.equal(resumed.resumed, true);
  assert.deepEqual(
    resumed.steps.slice(0, 3).map((step) => step.status),
    ['skipped', 'skipped', 'skipped'],
  );
  assert.equal(
    rerunCommands.some((command) => command.includes('record-merge')),
    false,
  );
  assert.equal(
    rerunCommands.some((command) =>
      command.includes('--apply-linear-tier-label'),
    ),
    false,
  );
});

test('merged manifest truth skips an already-recorded merge without requiring a progress journal', () => {
  const plan = buildLaneFinalizePlan({
    manifest: manifest({ status: 'merged', commit_sha: 'a'.repeat(40) }),
    pr: '456',
  });

  assert.equal(
    plan.steps.some((step) => step.id === 'record_merge'),
    false,
  );
  assert.equal(plan.steps[0]?.id, 'apply_tier_label');
});

test('finalize progress is atomic, reloadable, and bound to lane identity', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lane-finalize-progress-'),
  );
  try {
    const plan = buildLaneFinalizePlan({ manifest: manifest(), pr: '456' });
    const progress = readLaneFinalizeProgress(plan, root);
    progress.completed_step_ids = ['record_merge'];
    progress.status = 'incomplete';
    progress.last_failure = 'proof failed';
    writeLaneFinalizeProgress(progress, root);

    assert.deepEqual(readLaneFinalizeProgress(plan, root), progress);
    assert.throws(
      () =>
        readLaneFinalizeProgress(
          { ...plan, branch: 'codex/other-branch' },
          root,
        ),
      /identity mismatch/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveLaneFinalizeInput falls back to manifest PR URL', () => {
  const resolved = resolveLaneFinalizeInput({
    manifest: manifest({
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/853',
    }),
  });

  assert.deepStrictEqual(resolved, { issueId: 'UTV2-1073', pr: '853' });
});

test('CLI accepts positional issue identity after pnpm forwards its separator', () => {
  assert.equal(
    parseLaneFinalizeCliArgs(['--', 'UTV2-1073', '--dry-run', '--json'])
      .issueId,
    'UTV2-1073',
  );
  assert.equal(
    parseLaneFinalizeCliArgs(['--', '--issue', 'UTV2-1073', '--json']).issueId,
    'UTV2-1073',
  );
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
