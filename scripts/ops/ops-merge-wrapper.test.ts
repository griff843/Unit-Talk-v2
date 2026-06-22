/**
 * ops-merge-wrapper.test.ts — UTV2-1061
 *
 * Tests for the mandatory merge mutex wrapper CLI covering:
 *   - Command construction for all five operations
 *   - Held-lock rejection (fail closed)
 *   - Release-on-failure guarantee
 *   - Deferred auto-merge recording
 *   - git-merge-main and git-rebase-main mutex enforcement
 *   - Guard sub-command (lock assertion)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildExtendedCommand,
  runExtendedMergeWrapper,
  guardMergeLockHeld,
  BLOCKED_RAW_COMMANDS,
  type CommandRunner,
} from './ops-merge-wrapper.js';
import { acquireMergeLock, readMergeLock } from './merge-mutex.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempOps(
  run: (paths: { lockPath: string; deferredDir: string }) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-ops-merge-wrapper-'));
  try {
    run({
      lockPath: path.join(dir, 'merge-lock.json'),
      deferredDir: path.join(dir, 'deferred-merges'),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function okRunner(calls: string[][]): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    return {
      status: 0,
      stdout: Buffer.from('ok'),
      stderr: Buffer.from(''),
      error: undefined,
    };
  };
}

function failRunner(calls: string[][]): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    return {
      status: 128,
      stdout: Buffer.from(''),
      stderr: Buffer.from('conflict'),
      error: undefined,
    };
  };
}

const BASE = {
  issue_id: 'UTV2-1061',
  branch: 'codex/utv2-1061-merge-mutex-wrapper',
  cwd: process.cwd(),
};

// ---------------------------------------------------------------------------
// BLOCKED_RAW_COMMANDS catalogue
// ---------------------------------------------------------------------------

test('BLOCKED_RAW_COMMANDS lists every bypassable raw command', () => {
  const expected = [
    'gh pr merge',
    'gh pr update-branch',
    'git pull origin main',
    'git merge origin/main',
    'git rebase origin/main',
  ];
  for (const cmd of expected) {
    assert.ok(
      BLOCKED_RAW_COMMANDS.includes(cmd),
      `Expected ${cmd} in BLOCKED_RAW_COMMANDS`,
    );
  }
  assert.strictEqual(BLOCKED_RAW_COMMANDS.length, expected.length);
});

// ---------------------------------------------------------------------------
// buildExtendedCommand — command construction
// ---------------------------------------------------------------------------

test('buildExtendedCommand constructs git-merge-main command', () => {
  const cmd = buildExtendedCommand('git-merge-main', {});
  assert.deepStrictEqual(cmd, {
    command: 'git',
    args: ['merge', '--ff-only', 'origin/main'],
    deferred: false,
  });
});

test('buildExtendedCommand constructs git-rebase-main command', () => {
  const cmd = buildExtendedCommand('git-rebase-main', {});
  assert.deepStrictEqual(cmd, {
    command: 'git',
    args: ['rebase', 'origin/main'],
    deferred: false,
  });
});

test('buildExtendedCommand constructs pr-update-branch command', () => {
  const cmd = buildExtendedCommand('pr-update-branch', { pr: '766' });
  assert.deepStrictEqual(cmd, {
    command: 'gh',
    args: ['api', 'repos/{owner}/{repo}/pulls/766/update-branch', '-X', 'PUT'],
    deferred: false,
  });
});

test('buildExtendedCommand constructs immediate squash pr-merge command', () => {
  const cmd = buildExtendedCommand('pr-merge', {
    pr: '766',
    merge_method: 'squash',
    auto: false,
  });
  assert.deepStrictEqual(cmd, {
    command: 'gh',
    args: ['pr', 'merge', '766', '--squash'],
    deferred: false,
  });
});

test('buildExtendedCommand constructs deferred auto pr-merge command', () => {
  const cmd = buildExtendedCommand('pr-merge', {
    pr: '766',
    merge_method: 'squash',
    auto: true,
  });
  assert.deepStrictEqual(cmd, {
    command: 'gh',
    args: ['pr', 'merge', '766', '--squash', '--auto'],
    deferred: true,
  });
});

test('buildExtendedCommand constructs main-sync command', () => {
  const cmd = buildExtendedCommand('main-sync', {});
  assert.deepStrictEqual(cmd, {
    command: 'git',
    args: ['pull', '--ff-only', 'origin', 'main'],
    deferred: false,
  });
});

// ---------------------------------------------------------------------------
// main-sync rebase fallback — UTV2-1247
// ---------------------------------------------------------------------------

test('main-sync succeeds on fast-forward without rebase', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(calls, [['git', 'pull', '--ff-only', 'origin', 'main']]);
  });
});

test('main-sync falls back to rebase on not-possible-to-fast-forward error', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    let callIndex = 0;
    const divergedRunner: CommandRunner = (command, args) => {
      calls.push([command, ...args]);
      // First call (ff-only pull) signals divergence; second call (rebase) succeeds.
      const isDivergence = callIndex === 0;
      callIndex++;
      return {
        status: isDivergence ? 128 : 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(isDivergence ? 'fatal: Not possible to fast-forward, aborting.' : ''),
        error: undefined,
      };
    };
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: divergedRunner },
    );
    assert.strictEqual(result.ok, true, 'should succeed after rebase fallback');
    assert.deepStrictEqual(calls, [
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      ['git', 'rebase', 'origin/main'],
    ]);
  });
});

test('main-sync does not fall back to rebase on non-divergence error', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const networkErrorRunner: CommandRunner = (command, args) => {
      calls.push([command, ...args]);
      return {
        status: 128,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: unable to access remote'),
        error: undefined,
      };
    };
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: networkErrorRunner },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [['git', 'pull', '--ff-only', 'origin', 'main']],
      'should not attempt rebase on non-divergence failure');
  });
});

// ---------------------------------------------------------------------------
// Held-lock rejection — fail closed
// ---------------------------------------------------------------------------

test('git-merge-main fails closed when another unexpired merge lock exists', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-other',
        pr: null,
        cwd: process.cwd(),
        reason: 'held-lock',
        owner: { user: 'ci', host: 'runner', pid: 1, session_id: 'held' },
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-merge-main' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_lock_held');
    assert.deepStrictEqual(calls, [], 'command must not run when lock is held');
  });
});

test('git-rebase-main fails closed when another unexpired merge lock exists', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-other',
        pr: null,
        cwd: process.cwd(),
        reason: 'held-lock',
        owner: { user: 'ci', host: 'runner', pid: 1, session_id: 'held' },
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-rebase-main' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_lock_held');
    assert.deepStrictEqual(calls, [], 'command must not run when lock is held');
  });
});

test('pr-merge fails closed when another unexpired merge lock exists', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-other',
        pr: null,
        cwd: process.cwd(),
        reason: 'held-lock',
        owner: { user: 'ci', host: 'runner', pid: 1, session_id: 'held' },
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'pr-merge', pr: '766', merge_method: 'squash' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_lock_held');
    assert.deepStrictEqual(calls, []);
  });
});

// ---------------------------------------------------------------------------
// Release-on-failure
// ---------------------------------------------------------------------------

test('git-merge-main releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-merge-main' },
      { lockPath, deferredDir, runner: failRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [['git', 'merge', '--ff-only', 'origin/main']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('git-rebase-main releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-rebase-main' },
      { lockPath, deferredDir, runner: failRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [['git', 'rebase', 'origin/main']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('pr-merge releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'pr-merge', pr: '766', merge_method: 'squash' },
      { lockPath, deferredDir, runner: failRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [['gh', 'pr', 'merge', '766', '--squash']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

// ---------------------------------------------------------------------------
// Deferred auto-merge
// ---------------------------------------------------------------------------

test('deferred auto-merge records deferred state and releases the lock', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      {
        ...BASE,
        operation: 'pr-merge',
        pr: '766',
        merge_method: 'squash',
        auto: true,
      },
      {
        lockPath,
        deferredDir,
        runner: okRunner(calls),
        now: new Date('2026-05-18T18:00:00.000Z'),
      },
    );
    const lock = readMergeLock(lockPath);
    const recordPath = path.join(deferredDir, 'UTV2-1061.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as {
      lock_released: boolean;
      command: string[];
      owner: string;
      note: string;
    };

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_wrapper_deferred');
    assert.deepStrictEqual(calls, [['gh', 'pr', 'merge', '766', '--squash', '--auto']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
    assert.strictEqual(record.lock_released, true);
    assert.deepStrictEqual(record.command, ['gh', 'pr', 'merge', '766', '--squash', '--auto']);
    assert.match(record.note, /Reconciler or closeout must verify/);
    // Wrapper must not claim ownership of the deferred final merge
    assert.strictEqual(record.owner, 'merge-wrapper');
    assert.match(record.note, /Reconciler or closeout/);
  });
});

// ---------------------------------------------------------------------------
// Successful operations
// ---------------------------------------------------------------------------

test('git-merge-main completes successfully and releases the lock', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-merge-main' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_wrapper_completed');
    assert.deepStrictEqual(calls, [['git', 'merge', '--ff-only', 'origin/main']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('git-rebase-main completes successfully and releases the lock', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-rebase-main' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_wrapper_completed');
    assert.deepStrictEqual(calls, [['git', 'rebase', 'origin/main']]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

test('dry-run for git-merge-main does not run the command and releases the lock', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-merge-main', dry_run: true },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_wrapper_dry_run');
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

// ---------------------------------------------------------------------------
// Guard sub-command
// ---------------------------------------------------------------------------

test('guard returns ok when the merge lock is held by the expected issue', () => {
  withTempOps(({ lockPath }) => {
    acquireMergeLock(
      {
        issue_id: 'UTV2-1061',
        branch: BASE.branch,
        pr: null,
        cwd: process.cwd(),
        reason: 'guard-test',
        owner: { user: 'ci', host: 'runner', pid: 2, session_id: 'guard-session' },
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    const result = guardMergeLockHeld(
      { issue_id: 'UTV2-1061', branch: BASE.branch, reason: 'pre-merge-ci' },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_lock_held');
  });
});

test('guard fails closed when no lock is held', () => {
  withTempOps(({ lockPath }) => {
    const result = guardMergeLockHeld(
      { issue_id: 'UTV2-1061', branch: BASE.branch },
      { lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_missing');
  });
});

test('guard fails closed when a different issue holds the lock', () => {
  withTempOps(({ lockPath }) => {
    acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-other',
        pr: null,
        cwd: process.cwd(),
        reason: 'guard-mismatch',
        owner: { user: 'ci', host: 'runner', pid: 3, session_id: 'other-session' },
        expires_at: '2099-01-01T00:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    const result = guardMergeLockHeld(
      { issue_id: 'UTV2-1061', branch: BASE.branch },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_lock_owner_mismatch');
  });
});
