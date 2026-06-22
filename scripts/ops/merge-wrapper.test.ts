import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMergeCommand,
  runMergeWrapper,
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
