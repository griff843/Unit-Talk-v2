import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildLaneExecutionLocation,
  laneRequiresIsolatedInstall,
  packageTouchingLaneRequiresSingleton,
  prepareLaneExecutionDirectory,
  validateExecutionCwd,
  validateLaneCwd,
  validateLeaseCwdCoherence,
} from './lane-execution.js';

function withTempLane(run: (laneCwd: string) => void): void {
  const laneCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-lane-cwd-'));
  try {
    run(laneCwd);
  } finally {
    fs.rmSync(laneCwd, { recursive: true, force: true });
  }
}

test('docs/scripts-only isolated lanes do not require pnpm install', () => {
  withTempLane((laneCwd) => {
    const setup = prepareLaneExecutionDirectory({
      cwd: laneCwd,
      fileScope: ['scripts/ops/lane-start.ts'],
      runner: (() => {
        throw new Error('runner should not be called');
      }) as typeof spawnSync,
    });

    assert.strictEqual(setup.ran_install, false);
    assert.strictEqual(setup.execution_location.cwd, laneCwd.replaceAll('\\', '/'));
    assert.strictEqual(setup.execution_location.package_install, 'not_required');
  });
});

test('package-touching lanes require singleton until isolated install is verified', () => {
  assert.strictEqual(laneRequiresIsolatedInstall(['packages/db/src/index.ts']), true);
  assert.strictEqual(packageTouchingLaneRequiresSingleton(['apps/api/src/server.ts'], false), true);
  assert.strictEqual(packageTouchingLaneRequiresSingleton(['apps/api/src/server.ts'], true), false);
});

test('wrong cwd validation rejects dispatch packet execution from another directory', () => {
  const errors = validateExecutionCwd('C:/Dev/Unit-Talk-v2-main/.out/worktrees/lane-a', 'C:/Dev/Unit-Talk-v2-main');

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
    validateLaneCwd({ cwd: missingCwd, fileScope: ['scripts/ops/lane-start.ts'] })[0] ?? '',
    /cwd does not exist/,
  );
});

test('package-touching setup runs frozen pnpm install inside the lane cwd', () => {
  withTempLane((laneCwd) => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runner = ((command: string, args: string[], options: { cwd?: string }) => {
      calls.push({ command, args, cwd: options.cwd ?? '' });
      fs.mkdirSync(path.join(laneCwd, 'node_modules', '.pnpm'), { recursive: true });
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
    const executionLocation = buildLaneExecutionLocation(laneCwd, ['scripts/ops/lane-start.ts']);

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
