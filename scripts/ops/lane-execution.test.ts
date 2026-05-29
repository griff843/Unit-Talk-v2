import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  blockLaneManifest,
  buildLaneExecutionLocation,
  laneRequiresIsolatedInstall,
  packageTouchingLaneRequiresSingleton,
  prepareLaneExecutionDirectory,
  resumeLaneManifest,
  validateExecutionCwd,
  validateLaneCwd,
  validateLeaseCwdCoherence,
} from './lane-execution.js';
import {
  type LaneManifest,
  createManifest,
  worktreePathForBranch,
} from './shared.js';

function withTempLane(run: (laneCwd: string) => void): void {
  const laneCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-lane-cwd-'));
  try {
    run(laneCwd);
  } finally {
    fs.rmSync(laneCwd, { recursive: true, force: true });
  }
}

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    ...createManifest({
      issue_id: 'UTV2-1188',
      tier: 'T2',
      branch: 'codex/utv2-1188-block-resume',
      worktree_path: worktreePathForBranch('codex/utv2-1188-block-resume'),
      file_scope_lock: [
        'scripts/ops/lane-block.ts',
        'scripts/ops/lane-resume.ts',
      ],
      expected_proof_paths: [
        'docs/06_status/proof/UTV2-1188/diff-summary.md',
        'docs/06_status/proof/UTV2-1188/verification.log',
      ],
      preflight_token: '.out/ops/preflight/codex/utv2-1188-block-resume.json',
      status: 'in_progress',
      now: '2026-05-29T12:00:00.000Z',
    }),
    ...overrides,
  };
}

test('docs/scripts-only worktree lanes run pnpm install when node_modules is absent', () => {
  withTempLane((laneCwd) => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runner = ((
      command: string,
      args: string[],
      options: { cwd?: string },
    ) => {
      calls.push({ command, args, cwd: options.cwd ?? '' });
      return { status: 0, stdout: '', stderr: '', signal: null, output: [] };
    }) as typeof spawnSync;

    const setup = prepareLaneExecutionDirectory({
      cwd: laneCwd,
      fileScope: ['scripts/ops/lane-start.ts'],
      runner,
    });

    assert.deepStrictEqual(calls, [
      {
        command: 'pnpm',
        args: ['install', '--frozen-lockfile'],
        cwd: laneCwd.replaceAll('\\', '/'),
      },
    ]);
    assert.strictEqual(setup.ran_install, true);
    assert.strictEqual(
      setup.execution_location.cwd,
      laneCwd.replaceAll('\\', '/'),
    );
    assert.strictEqual(setup.execution_location.package_install, 'verified');
  });
});

test('docs/scripts-only worktree lanes skip install when node_modules already exists', () => {
  withTempLane((laneCwd) => {
    fs.mkdirSync(path.join(laneCwd, 'node_modules'));

    const setup = prepareLaneExecutionDirectory({
      cwd: laneCwd,
      fileScope: ['scripts/ops/lane-start.ts'],
      runner: (() => {
        throw new Error('runner should not be called when node_modules exists');
      }) as typeof spawnSync,
    });

    assert.strictEqual(setup.ran_install, false);
    assert.strictEqual(
      setup.execution_location.package_install,
      'not_required',
    );
  });
});

test('package-touching lanes require singleton until isolated install is verified', () => {
  assert.strictEqual(
    laneRequiresIsolatedInstall(['packages/db/src/index.ts']),
    true,
  );
  assert.strictEqual(
    packageTouchingLaneRequiresSingleton(['apps/api/src/server.ts'], false),
    true,
  );
  assert.strictEqual(
    packageTouchingLaneRequiresSingleton(['apps/api/src/server.ts'], true),
    false,
  );
});

test('wrong cwd validation rejects dispatch packet execution from another directory', () => {
  const errors = validateExecutionCwd(
    'C:/Dev/Unit-Talk-v2-main/.out/worktrees/lane-a',
    'C:/Dev/Unit-Talk-v2-main',
  );

  assert.match(errors[0] ?? '', /wrong cwd/);
});

test('missing isolated install fails for package-touching lane cwd', () => {
  withTempLane((laneCwd) => {
    const errors = validateLaneCwd({
      cwd: laneCwd,
      fileScope: ['packages/config/src/env.ts'],
      requireInstallVerified: true,
    });

    assert.match(errors[0] ?? '', /isolated install missing/);
  });
});

test('invalid cwd fails closed', () => {
  const missingCwd = path.join(os.tmpdir(), `utv2-missing-${Date.now()}`);

  assert.match(
    validateLaneCwd({
      cwd: missingCwd,
      fileScope: ['scripts/ops/lane-start.ts'],
    })[0] ?? '',
    /cwd does not exist/,
  );
});

test('package-touching setup runs frozen pnpm install inside the lane cwd', () => {
  withTempLane((laneCwd) => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runner = ((
      command: string,
      args: string[],
      options: { cwd?: string },
    ) => {
      calls.push({ command, args, cwd: options.cwd ?? '' });
      fs.mkdirSync(path.join(laneCwd, 'node_modules', '.pnpm'), {
        recursive: true,
      });
      return { status: 0, stdout: '', stderr: '', signal: null, output: [] };
    }) as typeof spawnSync;

    const setup = prepareLaneExecutionDirectory({
      cwd: laneCwd,
      fileScope: ['apps/worker/src/runtime.ts'],
      runner,
    });

    assert.deepStrictEqual(calls, [
      {
        command: 'pnpm',
        args: ['install', '--frozen-lockfile'],
        cwd: laneCwd.replaceAll('\\', '/'),
      },
    ]);
    assert.strictEqual(setup.ran_install, true);
    assert.strictEqual(setup.execution_location.package_install, 'verified');
  });
});

test('lease cwd, worktree_path, and execution_location cwd must agree', () => {
  withTempLane((laneCwd) => {
    const executionLocation = buildLaneExecutionLocation(laneCwd, [
      'scripts/ops/lane-start.ts',
    ]);

    assert.deepStrictEqual(
      validateLeaseCwdCoherence({
        lease_cwd: laneCwd,
        worktree_path: laneCwd,
        execution_location: executionLocation,
      }),
      [],
    );
    assert.deepStrictEqual(
      validateLeaseCwdCoherence({
        lease_cwd: laneCwd,
        worktree_path: path.join(laneCwd, 'other'),
        execution_location: executionLocation,
      }),
      ['worktree_path must match lease cwd'],
    );
  });
});

test('blockLaneManifest transitions active lane to blocked with normalized blockers', () => {
  const result = blockLaneManifest({
    manifest: manifest(),
    blockedBy: [
      ' missing PM decision ',
      'missing PM decision',
      'upstream PR not merged',
    ],
    now: '2026-05-29T13:00:00.000Z',
  });

  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.manifest.status, 'blocked');
  assert.deepStrictEqual(result.manifest.blocked_by, [
    'missing PM decision',
    'upstream PR not merged',
  ]);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-29T13:00:00.000Z');
});

test('blockLaneManifest fails closed without a concrete blocker', () => {
  assert.throws(
    () =>
      blockLaneManifest({
        manifest: manifest(),
        blockedBy: ['  '],
        now: '2026-05-29T13:00:00.000Z',
      }),
    /non-empty blocker/,
  );
});

test('resumeLaneManifest moves blocked lane to in_progress and clears blockers', () => {
  const result = resumeLaneManifest({
    manifest: manifest({
      status: 'blocked',
      blocked_by: ['upstream PR not merged'],
    }),
    now: '2026-05-29T14:00:00.000Z',
  });

  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.manifest.status, 'in_progress');
  assert.deepStrictEqual(result.manifest.blocked_by, []);
  assert.strictEqual(result.manifest.heartbeat_at, '2026-05-29T14:00:00.000Z');
});

test('resumeLaneManifest rejects non-blocked lanes', () => {
  assert.throws(
    () =>
      resumeLaneManifest({
        manifest: manifest({ status: 'in_review' }),
        now: '2026-05-29T14:00:00.000Z',
      }),
    /Only blocked lanes can be resumed/,
  );
});
