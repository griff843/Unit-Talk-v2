import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMergeCommand,
  runAuthorizedPrMerge,
  runMergeWrapper,
  runPreMergeAuthorizationCheck,
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

const PRE_MERGE_AUTH_COMMAND = ['pnpm', 'exec', 'tsx', 'scripts/ops/pre-merge-authorization.ts'];

function isPreMergeAuthorizationCall(command: string, args: string[]): boolean {
  return [command, ...args].slice(0, PRE_MERGE_AUTH_COMMAND.length).every(
    (value, index) => value === PRE_MERGE_AUTH_COMMAND[index],
  );
}

/**
 * A CommandRunner for `pr-merge` tests that intercepts the pre-merge
 * authorization subprocess call (UTV2-1592) and answers it with a fixed
 * `authorized` receipt, while delegating every other command (the actual
 * `gh pr merge`, etc.) to a plain ok/fail runner. This lets existing
 * pr-merge tests (written before the authorization gate existed) keep
 * asserting on the merge command itself without a real network call.
 */
function prMergeRunner(options: { authorized: boolean; reason?: string; calls: string[][] }): CommandRunner {
  return (command, args) => {
    options.calls.push([command, ...args]);
    if (isPreMergeAuthorizationCall(command, args)) {
      const receipt = {
        prNumber: 761,
        headSha: 'deadbeef',
        requiredChecks: [],
        pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: options.authorized },
        authorized: options.authorized,
        ...(options.reason ? { reason: options.reason } : {}),
      };
      return {
        status: options.authorized ? 0 : 1,
        stdout: Buffer.from(JSON.stringify(receipt)),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }
    return {
      status: 0,
      stdout: Buffer.from('ok'),
      stderr: Buffer.from(''),
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

// UTV2-1790: `main-sync` now measures the worktree BEFORE it stashes or pulls and
// refuses over a tree that is mid-merge/rebase/cherry-pick/revert, because a
// `--ff-only` pull there can advance a detached HEAD out from under the operation
// in progress and still report success. These fixtures are about the stash/pull/pop
// command SEQUENCE, and their runners answer every vector with a blanket response
// that the pre-flight would correctly read as unanswerable -- so they state their
// clean-worktree premise explicitly instead. The pre-flight itself is proven
// against real git in scripts/ops/ops-merge-wrapper.test.ts.
const CLEAN_WORKTREE_PROBE = (): { clean: boolean; detail: string } => ({
  clean: true,
  detail: 'test fixture posits a clean worktree',
});

test('main-sync: nothing to stash runs the pull with no pop', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const { runner, calls } = mainSyncRunner({ stashed: false, pullOk: true });
    const result = runMergeWrapper(MAIN_SYNC_INPUT, {
      lockPath,
      deferredDir,
      runner,
      residueProbe: CLEAN_WORKTREE_PROBE,
    });

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
    const result = runMergeWrapper(MAIN_SYNC_INPUT, {
      lockPath,
      deferredDir,
      runner,
      residueProbe: CLEAN_WORKTREE_PROBE,
    });

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
    const result = runMergeWrapper(MAIN_SYNC_INPUT, {
      lockPath,
      deferredDir,
      runner,
      residueProbe: CLEAN_WORKTREE_PROBE,
    });

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
    const result = runMergeWrapper(MAIN_SYNC_INPUT, {
      lockPath,
      deferredDir,
      runner,
      residueProbe: CLEAN_WORKTREE_PROBE,
    });

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
        runner: prMergeRunner({ authorized: true, calls }),
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
      ['pnpm', 'exec', 'tsx', 'scripts/ops/pre-merge-authorization.ts', '--owner', 'griff843', '--repo', 'Unit-Talk-v2', '--pr', '761'],
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

test('UTV2-1592: pr-merge invokes the merge runner when pre-merge authorization succeeds', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runMergeWrapper(
      {
        ...BASE_INPUT,
        operation: 'pr-merge',
        merge_method: 'squash',
      },
      { lockPath, deferredDir, runner: prMergeRunner({ authorized: true, calls }) },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_wrapper_completed');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1], ['gh', 'pr', 'merge', '761', '--squash']);
  });
});

test('UTV2-1592: pr-merge refuses to invoke the merge runner when pre-merge authorization fails', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runMergeWrapper(
      {
        ...BASE_INPUT,
        operation: 'pr-merge',
        merge_method: 'squash',
      },
      {
        lockPath,
        deferredDir,
        runner: prMergeRunner({
          authorized: false,
          reason: 'required checks missing or failing on head deadbeef: Executor Result Validation',
          calls,
        }),
      },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_wrapper_authorization_failed');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].slice(0, 3), ['pnpm', 'exec', 'tsx']);
    assert.match(!result.ok ? result.message : '', /Executor Result Validation/);
    // The mutex must still be released even though the merge never ran.
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('UTV2-1592: pre-merge authorization gate does not apply to pr-update-branch or main-sync', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    // A runner that would fail the authorization JSON contract if the gate
    // were (incorrectly) applied to a non-pr-merge operation -- proves the
    // gate is scoped to pr-merge only.
    const result = runMergeWrapper(
      { ...BASE_INPUT, operation: 'pr-update-branch' },
      { lockPath, deferredDir, runner: okRunner(calls) },
    );

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(calls, [
      ['gh', 'api', 'repos/{owner}/{repo}/pulls/761/update-branch', '-X', 'PUT'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// UTV2-1592 PM amendment: runPreMergeAuthorizationCheck / runAuthorizedPrMerge
// fail-closed hardening (nonzero exit, timeout/signal, malformed/missing
// output) and the shared authorization-and-merge primitive itself.
// ---------------------------------------------------------------------------

test('UTV2-1592 amendment: an authorized:true receipt is refused when the subprocess exits non-zero', () => {
  const runner: CommandRunner = () => ({
    status: 1,
    stdout: Buffer.from(
      JSON.stringify({
        authorized: true,
        prNumber: 761,
        headSha: 'deadbeef',
        requiredChecks: [],
        pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: true },
      }),
    ),
    stderr: Buffer.from(''),
    error: undefined,
  });

  const result = runPreMergeAuthorizationCheck('761', runner, process.cwd());

  assert.strictEqual(result.authorized, false);
  assert.match(result.reason ?? '', /non-zero status/);
});

test('UTV2-1592 amendment: a subprocess timeout/signal (run.error set) fails closed', () => {
  const runner: CommandRunner = () => ({
    status: null,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    error: Object.assign(new Error('spawnSync pnpm ETIMEDOUT'), { code: 'ETIMEDOUT' }),
  });

  const result = runPreMergeAuthorizationCheck('761', runner, process.cwd());

  assert.strictEqual(result.authorized, false);
  assert.match(result.reason ?? '', /failed to execute/);
});

test('UTV2-1592 amendment: malformed JSON output fails closed', () => {
  const runner: CommandRunner = () => ({
    status: 0,
    stdout: Buffer.from('not valid json{{{'),
    stderr: Buffer.from(''),
    error: undefined,
  });

  const result = runPreMergeAuthorizationCheck('761', runner, process.cwd());

  assert.strictEqual(result.authorized, false);
  assert.match(result.reason ?? '', /no valid receipt/);
});

test('UTV2-1592 amendment: missing output (a silently killed subprocess) fails closed', () => {
  const runner: CommandRunner = () => ({
    status: null,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    error: undefined,
  });

  const result = runPreMergeAuthorizationCheck('761', runner, process.cwd());

  assert.strictEqual(result.authorized, false);
  assert.match(result.reason ?? '', /no valid receipt/);
});

test('UTV2-1592 amendment: runPreMergeAuthorizationCheck passes a bounded (non-zero) timeout to the runner', () => {
  let capturedOptions: { cwd: string; timeoutMs?: number } | undefined;
  const runner: CommandRunner = (_command, _args, options) => {
    capturedOptions = options;
    return {
      status: 0,
      stdout: Buffer.from(JSON.stringify({ authorized: true })),
      stderr: Buffer.from(''),
      error: undefined,
    };
  };

  runPreMergeAuthorizationCheck('761', runner, process.cwd());

  assert.ok(
    typeof capturedOptions?.timeoutMs === 'number' && capturedOptions.timeoutMs > 0,
    'expected a bounded (>0) timeoutMs to be passed to the runner',
  );
});

test('UTV2-1592 amendment: runAuthorizedPrMerge never invokes the merge command when authorization is denied', () => {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    return {
      status: 1,
      stdout: Buffer.from(JSON.stringify({ authorized: false, reason: 'denied' })),
      stderr: Buffer.from(''),
      error: undefined,
    };
  };

  const result = runAuthorizedPrMerge({ pr: '761', merge_method: 'squash' }, runner, process.cwd());

  assert.strictEqual(result.authorized, false);
  assert.strictEqual(result.run, undefined);
  assert.strictEqual(calls.length, 1, 'the merge command must never run after a denial');
  assert.deepStrictEqual(calls[0]?.slice(0, 3), ['pnpm', 'exec', 'tsx']);
});

test('UTV2-1592 amendment: runAuthorizedPrMerge invokes the merge command only after authorization succeeds', () => {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'pnpm') {
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ authorized: true })),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }
    return { status: 0, stdout: Buffer.from('merged'), stderr: Buffer.from(''), error: undefined };
  };

  const result = runAuthorizedPrMerge({ pr: '761', merge_method: 'squash' }, runner, process.cwd());

  assert.strictEqual(result.authorized, true);
  assert.ok(result.run);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1], ['gh', 'pr', 'merge', '761', '--squash']);
});

test('UTV2-1592: buildMergeCommand({ operation: "pr-merge" }) is never executed anywhere outside runAuthorizedPrMerge', () => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const mergeWrapperSource = fs.readFileSync(path.join(dirname, 'merge-wrapper.ts'), 'utf8');
  const opsMergeWrapperSource = fs.readFileSync(path.join(dirname, 'ops-merge-wrapper.ts'), 'utf8');

  // merge-train's drain (ops-merge-wrapper.ts) must not construct its own
  // 'pr-merge' command directly -- it must go through the shared primitive.
  assert.doesNotMatch(opsMergeWrapperSource, /buildMergeCommand\(\{\s*\n?\s*operation:\s*'pr-merge'/);
  assert.match(opsMergeWrapperSource, /runAuthorizedPrMerge\(/);

  // runAuthorizedPrMerge must be called exactly once in merge-wrapper.ts
  // beyond its own declaration (inside runMergeWrapper's pr-merge branch).
  // If a second direct pr-merge execution path is ever added here, this
  // count changes and the test fails -- the mechanical proxy for "every
  // buildMergeCommand()-for-pr-merge execution path is authorization-gated".
  const occurrences = mergeWrapperSource.match(/runAuthorizedPrMerge\(/g) ?? [];
  assert.strictEqual(
    occurrences.length,
    2,
    `expected exactly 2 occurrences of "runAuthorizedPrMerge(" (1 declaration + 1 call site), found ${occurrences.length}`,
  );
});
