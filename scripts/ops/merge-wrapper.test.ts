import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMergeCommand,
  runMergeWrapper,
  MAIN_SYNC_STASH_MESSAGE,
  MAIN_SYNC_STASH_PATHS,
  type CommandRunner,
} from './merge-wrapper.js';
import { acquireMergeLock, readMergeLock } from './merge-mutex.js';

function withTempOps(
  run: (paths: { lockPath: string; deferredDir: string }) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-merge-wrapper-'));
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
      status: 1,
      stdout: Buffer.from(''),
      stderr: Buffer.from('failed'),
      error: undefined,
    };
  };
}

const BASE_INPUT = {
  issue_id: 'UTV2-1061',
  branch: 'codex/utv2-1061-merge-wrapper',
  pr: '761',
  cwd: process.cwd(),
};

test('buildMergeCommand constructs PR update-branch command', () => {
  const command = buildMergeCommand({
    ...BASE_INPUT,
    operation: 'pr-update-branch',
  });

  assert.deepStrictEqual(command, {
    command: 'gh',
    args: ['api', 'repos/{owner}/{repo}/pulls/761/update-branch', '-X', 'PUT'],
    deferred: false,
  });
});

test('buildMergeCommand constructs immediate squash PR merge command', () => {
  const command = buildMergeCommand({
    ...BASE_INPUT,
    operation: 'pr-merge',
    merge_method: 'squash',
  });

  assert.deepStrictEqual(command, {
    command: 'gh',
    args: ['pr', 'merge', '761', '--squash'],
    deferred: false,
  });
});

test('buildMergeCommand constructs post-merge main sync command', () => {
  const command = buildMergeCommand({
    ...BASE_INPUT,
    operation: 'main-sync',
  });

  assert.deepStrictEqual(command, {
    command: 'git',
    args: ['pull', '--ff-only', 'origin', 'main'],
    deferred: false,
  });
});

test('wrapper fails closed when another unexpired merge lock exists', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const held = acquireMergeLock(
      {
        issue_id: 'UTV2-1055',
        branch: 'codex/utv2-1055-merge-mutex',
        pr: '759',
        cwd: process.cwd(),
        reason: 'unit-test-held-lock',
        owner: {
          user: 'codex-test',
          host: 'unit-test',
          pid: 1001,
          session_id: 'held-lock',
        },
        expires_at: '2099-05-18T19:00:00.000Z',
      },
      { lockPath, now: new Date('2026-05-18T18:00:00.000Z') },
    );
    const second = runMergeWrapper(
      {
        ...BASE_INPUT,
        operation: 'pr-update-branch',
      },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );

    assert.strictEqual(held.ok, true);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'merge_wrapper_lock_held');
    assert.deepStrictEqual(calls, []);
  });
});

test('wrapper releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runMergeWrapper(
      {
        ...BASE_INPUT,
        operation: 'pr-update-branch',
      },
      { lockPath, deferredDir, runner: failRunner(calls) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [
      ['gh', 'api', 'repos/{owner}/{repo}/pulls/761/update-branch', '-X', 'PUT'],
    ]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

function mainSyncRunner(options: {
  stashed: boolean;
  pullOk: boolean;
  popConflict?: boolean;
}): { runner: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);

    if (command === 'git' && args[0] === 'stash' && args[1] === 'push') {
      return {
        status: 0,
        stdout: Buffer.from(
          options.stashed
            ? 'Saved working directory and index state On main: ops-merge-wrapper:main-sync:autostash'
            : 'No local changes to save',
        ),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    if (command === 'git' && args[0] === 'pull') {
      return {
        status: options.pullOk ? 0 : 1,
        stdout: Buffer.from(options.pullOk ? 'Updating abc123..def456\nFast-forward' : ''),
        stderr: Buffer.from(options.pullOk ? '' : 'fatal: Not possible to fast-forward, aborting.'),
        error: undefined,
      };
    }

    if (command === 'git' && args[0] === 'stash' && args[1] === 'pop') {
      if (options.popConflict) {
        return {
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from('CONFLICT (modify/delete): docs/06_status/lanes/UTV2-2001.json deleted in HEAD'),
          error: undefined,
        };
      }
      return {
        status: 0,
        stdout: Buffer.from('Dropped refs/stash@{0} (deadbeef)'),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    throw new Error(`Unexpected command in mainSyncRunner: ${command} ${args.join(' ')}`);
  };

  return { runner, calls };
}

const MAIN_SYNC_INPUT = {
  issue_id: 'UTV2-2001',
  branch: 'main',
  operation: 'main-sync' as const,
};

test('main-sync: nothing to stash runs the pull with no pop', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const { runner, calls } = mainSyncRunner({ stashed: false, pullOk: true });
    const result = runMergeWrapper(MAIN_SYNC_INPUT, { lockPath, deferredDir, runner });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_wrapper_completed');
    assert.deepStrictEqual(calls, [
      [
        'git',
        'stash',
        'push',
        '--include-untracked',
        '--message',
        MAIN_SYNC_STASH_MESSAGE,
        '--',
        ...MAIN_SYNC_STASH_PATHS,
      ],
      ['git', 'pull', '--ff-only', 'origin', 'main'],
    ]);
    assert.deepStrictEqual(
      result.ok ? result.main_sync_stash : undefined,
      { attempted: true, stashed: false, popped: false },
    );
  });
});

test('main-sync: untracked lane files are stashed, pulled, then popped in order', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const { runner, calls } = mainSyncRunner({ stashed: true, pullOk: true });
    const result = runMergeWrapper(MAIN_SYNC_INPUT, { lockPath, deferredDir, runner });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_wrapper_completed');
    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(calls[0].slice(0, 3), ['git', 'stash', 'push']);
    assert.deepStrictEqual(calls[1], ['git', 'pull', '--ff-only', 'origin', 'main']);
    assert.deepStrictEqual(calls[2], ['git', 'stash', 'pop']);
    assert.deepStrictEqual(
      result.ok ? result.main_sync_stash : undefined,
      { attempted: true, stashed: true, popped: true },
    );
  });
});

test('main-sync: stash is still popped for cleanup when the pull fails', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const { runner, calls } = mainSyncRunner({ stashed: true, pullOk: false });
    const result = runMergeWrapper(MAIN_SYNC_INPUT, { lockPath, deferredDir, runner });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls[1], ['git', 'pull', '--ff-only', 'origin', 'main']);
    assert.deepStrictEqual(calls[2], ['git', 'stash', 'pop']);
    assert.deepStrictEqual(
      !result.ok ? result.main_sync_stash : undefined,
      { attempted: true, stashed: true, popped: true },
    );
  });
});

test('main-sync: a stash pop conflict surfaces a clear error and keeps the stash', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const { runner, calls } = mainSyncRunner({ stashed: true, pullOk: true, popConflict: true });
    const result = runMergeWrapper(MAIN_SYNC_INPUT, { lockPath, deferredDir, runner });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_wrapper_stash_pop_conflict');
    assert.deepStrictEqual(calls[2], ['git', 'stash', 'pop']);
    assert.match(!result.ok ? result.message : '', /git stash list/);
    assert.match(!result.ok ? result.message : '', /git stash pop/);
    assert.match(!result.ok ? result.message : '', new RegExp(MAIN_SYNC_STASH_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepStrictEqual(
      !result.ok ? result.main_sync_stash : undefined,
      { attempted: true, stashed: true, popped: false },
    );
  });
});

test('wrapper records deferred auto-merge after releasing the lock', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runMergeWrapper(
      {
        ...BASE_INPUT,
        operation: 'pr-merge',
        auto: true,
        merge_method: 'squash',
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
      note: string;
    };

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'merge_wrapper_deferred');
    assert.deepStrictEqual(calls, [
      ['gh', 'pr', 'merge', '761', '--squash', '--auto'],
    ]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
    assert.strictEqual(record.lock_released, true);
    assert.deepStrictEqual(record.command, [
      'gh',
      'pr',
      'merge',
      '761',
      '--squash',
      '--auto',
    ]);
    assert.match(record.note, /Reconciler or closeout must verify/);
  });
});
