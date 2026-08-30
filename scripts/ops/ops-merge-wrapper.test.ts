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
 *   - merge-train (UTV2-1467): batched-merge protocol (Design B)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildExtendedCommand,
  runExtendedMergeWrapper,
  isNotFastForwardFailure,
  classifyDroppedPaths,
  PROTECTED_SYNC_PATH_PREFIXES,
  buildHeadMoveInvalidation,
  renderHeadMoveNotice,
  guardMergeLockHeld,
  runMergeTrain,
  evaluateStatusCheckRollup,
  isExecutorResultComment,
  buildRepostedExecutorResultBody,
  MERGE_TRAIN_REQUIRED_CONTEXTS,
  BLOCKED_RAW_COMMANDS,
  type CommandRunner,
  type MergeTrainCandidate,
  type WaitForChecksFn,
  type StatusCheckEntry,
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

// UTV2-1592: `pr-merge` now runs a mandatory pre-merge authorization check
// (a `pnpm exec tsx scripts/ops/pre-merge-authorization.ts` subprocess call,
// via the same injectable CommandRunner) immediately before the actual merge
// command. Tests below that exercise the merge command's own success/failure
// path (not the authorization gate itself, which is covered in
// scripts/ops/pre-merge-authorization.test.ts and
// scripts/ops/merge-wrapper.test.ts) wrap their runner with this helper so
// the authorization subprocess call always answers "authorized", and every
// other command is delegated to the wrapped runner unchanged.
function withAuthorizedPreMerge(runner: CommandRunner): CommandRunner {
  return (command, args, options) => {
    if (command === 'pnpm' && args[0] === 'exec' && args[1] === 'tsx' && args[2] === 'scripts/ops/pre-merge-authorization.ts') {
      return {
        status: 0,
        stdout: Buffer.from(
          JSON.stringify({
            prNumber: 766,
            headSha: 'deadbeef',
            requiredChecks: [],
            pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: true },
            authorized: true,
          }),
        ),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }
    return runner(command, args, options);
  };
}

const STASH_PUSH_ARGS = [
  'stash',
  'push',
  '--include-untracked',
  '--message',
  'ops-merge-wrapper:main-sync:autostash',
  '--',
  '.ops/sync',
  'docs/06_status/lanes',
];
const STASH_PUSH_CALL = ['git', ...STASH_PUSH_ARGS];
const STASH_POP_CALL = ['git', 'stash', 'pop'];

// UTV2-1678: the sync path captures the pre-sync head immediately before the
// sync verb runs, then diffs branch-only paths before/after to prove nothing
// was dropped. With okRunner every command returns stdout 'ok', so the captured
// pre-sync head is the literal string 'ok'.
const HEAD_PROBE_CALL = ['git', 'rev-parse', 'HEAD'];
// UTV2-1790: the post-failure cleanup probe, in the order abortInProgressSync
// issues it. A clean probe means there is nothing to abort.
const UNMERGED_PROBE_CALL = ['git', 'diff', '--name-only', '--diff-filter=U'];
const MERGE_HEAD_PROBE_CALL = ['git', 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD'];
const REBASE_HEAD_PROBE_CALL = ['git', 'rev-parse', '--verify', '--quiet', 'REBASE_HEAD'];
const CLEANUP_PROBE_CALLS = [UNMERGED_PROBE_CALL, MERGE_HEAD_PROBE_CALL, REBASE_HEAD_PROBE_CALL];
const DIFF_BEFORE_CALL = ['git', 'diff', '--name-only', 'origin/main...ok'];
const DIFF_AFTER_CALL = ['git', 'diff', '--name-only', 'origin/main..HEAD'];

/**
 * main-sync (and the git-merge-main/git-rebase-main operations that bridge
 * through it) now wraps its git command with an autostash push/pop of
 * lane-state paths (UTV2-1247-adjacent fix). Tests that need to fail a
 * SPECIFIC step (the pull/merge/rebase itself, not the stash bookkeeping)
 * must match on command content rather than call index, since the stash
 * push is always call 0.
 */
function stashAwareRunner(
  calls: string[][],
  mainCommandOutcome: (callIndexOfMainCommand: number) => {
    status: number;
    stdout: string;
    stderr: string;
  },
): CommandRunner {
  let mainCommandCallCount = 0;
  return (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'stash') {
      return { status: 0, stdout: Buffer.from('ok'), stderr: Buffer.from(''), error: undefined };
    }
    const outcome = mainCommandOutcome(mainCommandCallCount);
    mainCommandCallCount++;
    return {
      status: outcome.status,
      stdout: Buffer.from(outcome.stdout),
      stderr: Buffer.from(outcome.stderr),
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
    args: ['merge', '--no-ff', '--no-edit', 'origin/main'],
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
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      STASH_POP_CALL,
    ]);
  });
});

// UTV2-1678 replaces the former "main-sync falls back to rebase" test, which
// asserted the defect: that a diverged main-sync silently succeeded by running
// `git rebase origin/main`. The verb is now the caller's explicit choice.
test('UTV2-1678: main-sync refuses on divergence and never invokes the rebase verb', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    // Every main command fails with the divergence error. If any fallback path
    // survived, a second main command (the rebase) would be attempted and would
    // appear in `calls` -- which is precisely what this asserts cannot happen.
    const divergedRunner = stashAwareRunner(calls, () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: Not possible to fast-forward, aborting.',
    }));
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: divergedRunner },
    );

    assert.strictEqual(result.ok, false, 'a diverged main-sync must not report success');
    assert.strictEqual(result.code, 'merge_wrapper_diverged_requires_explicit_sync');

    // The refusal must be actionable: it names both explicit verbs, and says
    // which one rewrites history.
    assert.ok(result.message.includes('git-merge-main'), 'names the preserving verb');
    assert.ok(result.message.includes('git-rebase-main'), 'names the rewriting verb');
    assert.match(result.message, /REWRITES history/);

    // The load-bearing assertion: the rebase command was never run. Asserting on
    // the result code alone would still pass if the rebase had executed and then
    // been reported as a refusal.
    assert.ok(
      !calls.some((call) => call.includes('rebase')),
      `no rebase may be invoked; observed calls: ${JSON.stringify(calls)}`,
    );
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      STASH_POP_CALL,
    ]);
  });
});

/**
 * UTV2-1678 criterion 3, end to end: a sync that reports success but silently
 * dropped a proof bundle must be converted into a refusal and the tree restored.
 * Asserting only on `classifyDroppedPaths` would leave the wiring untested — the
 * control has to be proven by making it fire.
 */
function droppingSyncRunner(calls: string[][], droppedPaths: string[]): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    const argv = args.join(' ');
    const out = (text: string) => ({
      status: 0,
      stdout: Buffer.from(text),
      stderr: Buffer.from(''),
      error: undefined,
    });
    if (argv === 'rev-parse HEAD') return out('presync0000000000000000000000000000000\n');
    // Pre-sync diff lists the branch-only paths; post-sync diff has lost them.
    if (argv.startsWith('diff --name-only origin/main...presync')) return out(droppedPaths.join('\n'));
    if (argv === 'diff --name-only origin/main..HEAD') return out('');
    return out('ok');
  };
}

test('UTV2-1678: a sync that drops a proof bundle is refused and the tree restored', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-rebase-main' },
      {
        lockPath,
        deferredDir,
        runner: droppingSyncRunner(calls, [
          'docs/06_status/proof/UTV2-1584/evidence.json',
          'docs/06_status/proof/UTV2-1584/verification.md',
        ]),
      },
    );

    assert.strictEqual(result.ok, false, 'a sync that lost a proof bundle must not report success');
    assert.strictEqual(result.code, 'merge_wrapper_sync_dropped_protected_paths');
    assert.match(result.message, /evidence\.json/);
    assert.match(result.message, /verification\.md/);

    // The restore must actually have been attempted against the captured head.
    assert.ok(
      calls.some((c) => c.join(' ').startsWith('git reset --keep presync')),
      `expected a restore to the pre-sync head; observed: ${JSON.stringify(calls)}`,
    );
    assert.match(result.message, /restored/i);
  });
});

test('UTV2-1678: a sync that drops only non-governance paths succeeds with a warning', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-merge-main' },
      { lockPath, deferredDir, runner: droppingSyncRunner(calls, ['scripts/ops/scratch.ts']) },
    );

    assert.strictEqual(result.ok, true, 'a non-governance drop is reported, not refused');
    assert.match(result.stderr ?? '', /warning/i);
    assert.match(result.stderr ?? '', /scripts\/ops\/scratch\.ts/);
    assert.ok(
      !calls.some((c) => c.join(' ').includes('reset --keep')),
      'must not restore for a non-protected drop',
    );
  });
});

test('UTV2-1678: classifyDroppedPaths refuses proof and lane manifest loss, warns on the rest', () => {
  const before = [
    'docs/06_status/proof/UTV2-1584/evidence.json',
    'docs/06_status/proof/UTV2-1584/verification.md',
    'docs/06_status/lanes/UTV2-1584.json',
    'scripts/ops/lane-start.ts',
    'README.md',
  ];
  // The sync kept only the two source files; every governance artifact vanished
  // — this is precisely the UTV2-1584 blast radius.
  const after = ['scripts/ops/lane-start.ts', 'README.md'];

  const c = classifyDroppedPaths(before, after);
  assert.deepStrictEqual(c.protectedPaths, [
    'docs/06_status/lanes/UTV2-1584.json',
    'docs/06_status/proof/UTV2-1584/evidence.json',
    'docs/06_status/proof/UTV2-1584/verification.md',
  ]);
  assert.deepStrictEqual(c.otherPaths, []);
  assert.strictEqual(c.dropped.length, 3);
});

test('UTV2-1678: a non-governance drop is reported but not refusal-worthy', () => {
  const c = classifyDroppedPaths(['scripts/ops/foo.ts', 'docs/README.md'], ['docs/README.md']);
  assert.deepStrictEqual(c.protectedPaths, []);
  assert.deepStrictEqual(c.otherPaths, ['scripts/ops/foo.ts']);
});

test('UTV2-1678: a lossless sync classifies nothing', () => {
  const paths = ['docs/06_status/proof/UTV2-1678/verification.md', 'scripts/ops/x.ts'];
  const c = classifyDroppedPaths(paths, [...paths, 'scripts/ops/added-by-main.ts']);
  assert.deepStrictEqual(c.dropped, []);
  assert.deepStrictEqual(c.protectedPaths, []);
  assert.deepStrictEqual(c.otherPaths, []);
});

test('UTV2-1678: every protected prefix is actually covered by the classifier', () => {
  // Guards against a prefix being added to the constant but not matching, and
  // against the constant being silently emptied.
  assert.ok(PROTECTED_SYNC_PATH_PREFIXES.length > 0);
  for (const prefix of PROTECTED_SYNC_PATH_PREFIXES) {
    const probe = `${prefix}UTV2-9999/probe.json`;
    const c = classifyDroppedPaths([probe], []);
    assert.deepStrictEqual(c.protectedPaths, [probe], `prefix not enforced: ${prefix}`);
  }
});

test('UTV2-1678: a head-SHA move reports every invalidated artifact in re-authorization order', () => {
  const inv = buildHeadMoveInvalidation('aaaaaaa', 'bbbbbbb');
  assert.strictEqual(inv.headMoved, true);
  // All three head-pinned artifacts must be named — omitting any one is how a
  // sync silently invalidates an approval nobody re-requests.
  const joined = inv.invalidatedArtifacts.join(' ');
  assert.match(joined, /pm-verdict/);
  assert.match(joined, /t1-approved/);
  assert.match(joined, /EXECUTOR_RESULT/);

  // Order is load-bearing: verify precedes the executor result, and the
  // pm-verdict is last so it certifies the head that will actually merge.
  const order = inv.reauthorizationOrder.join('\n');
  assert.ok(
    order.indexOf('verify') < order.indexOf('EXECUTOR_RESULT'),
    'verify must precede re-posting the executor result',
  );
  assert.ok(
    order.indexOf('EXECUTOR_RESULT') < order.indexOf('pm-verdict'),
    'pm-verdict must come last',
  );

  const rendered = renderHeadMoveNotice(inv);
  assert.match(rendered, /aaaaaaa -> bbbbbbb/);
});

test('UTV2-1678: a sync that does not move the head invalidates nothing', () => {
  const same = buildHeadMoveInvalidation('aaaaaaa', 'aaaaaaa');
  assert.strictEqual(same.headMoved, false);
  assert.deepStrictEqual(same.invalidatedArtifacts, []);
  assert.strictEqual(renderHeadMoveNotice(same), '', 'must be safe to append unconditionally');

  // An unknown head (probe failed) must not be reported as a move.
  assert.strictEqual(buildHeadMoveInvalidation('', 'bbbbbbb').headMoved, false);
  assert.strictEqual(buildHeadMoveInvalidation('aaaaaaa', '').headMoved, false);
});

test('UTV2-1678: isNotFastForwardFailure only fires on a genuine divergence failure', () => {
  const diverged = {
    ok: false as const,
    code: 'merge_wrapper_command_failed' as const,
    message: 'x',
    stderr: 'fatal: Not possible to fast-forward, aborting.',
  };
  assert.strictEqual(isNotFastForwardFailure(diverged), true);

  // A different git failure must keep its own code rather than being presented
  // as a routine divergence that invites re-running with a rewriting verb.
  assert.strictEqual(
    isNotFastForwardFailure({ ...diverged, stderr: 'fatal: unable to access remote' }),
    false,
  );
  // A non-command failure is never a divergence.
  assert.strictEqual(
    isNotFastForwardFailure({ ...diverged, code: 'merge_wrapper_lock_held' as never }),
    false,
  );
  // Success is never a divergence.
  assert.strictEqual(
    isNotFastForwardFailure({
      ok: true,
      code: 'merge_wrapper_completed',
      issue_id: 'UTV2-1678',
      operation: 'main-sync',
      command: [],
      lock: { ok: true } as never,
    } as never),
    false,
  );
});

test('main-sync does not fall back to rebase on non-divergence error', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    const networkErrorRunner = stashAwareRunner(calls, () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: unable to access remote',
    }));
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: networkErrorRunner },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(
      calls,
      [STASH_PUSH_CALL, ['git', 'pull', '--ff-only', 'origin', 'main'], STASH_POP_CALL],
      'should not attempt rebase on non-divergence failure, but must still restore the autostash',
    );
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
      { lockPath, deferredDir, runner: stashAwareRunner(calls, () => ({ status: 128, stdout: '', stderr: 'conflict' })) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      HEAD_PROBE_CALL,
      ['git', 'merge', '--no-ff', '--no-edit', 'origin/main'],
      ...CLEANUP_PROBE_CALLS,
      STASH_POP_CALL,
    ]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('git-rebase-main releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'git-rebase-main' },
      { lockPath, deferredDir, runner: stashAwareRunner(calls, () => ({ status: 128, stdout: '', stderr: 'conflict' })) },
    );
    const lock = readMergeLock(lockPath);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_command_failed');
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      HEAD_PROBE_CALL,
      ['git', 'rebase', 'origin/main'],
      ...CLEANUP_PROBE_CALLS,
      STASH_POP_CALL,
    ]);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('pr-merge releases the lock after command failure', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];

    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'pr-merge', pr: '766', merge_method: 'squash' },
      { lockPath, deferredDir, runner: withAuthorizedPreMerge(failRunner(calls)) },
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
        runner: withAuthorizedPreMerge(okRunner(calls)),
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
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      HEAD_PROBE_CALL,
      ['git', 'merge', '--no-ff', '--no-edit', 'origin/main'],
      STASH_POP_CALL,
      DIFF_BEFORE_CALL,
      DIFF_AFTER_CALL,
      // UTV2-1678 criterion 5: post-sync head is re-read to detect a SHA move.
      HEAD_PROBE_CALL,
    ]);
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
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      HEAD_PROBE_CALL,
      ['git', 'rebase', 'origin/main'],
      STASH_POP_CALL,
      DIFF_BEFORE_CALL,
      DIFF_AFTER_CALL,
      // UTV2-1678 criterion 5: post-sync head is re-read to detect a SHA move.
      HEAD_PROBE_CALL,
    ]);
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

// ---------------------------------------------------------------------------
// merge-train (UTV2-1467) — Design B batched-merge protocol
// ---------------------------------------------------------------------------

function withTempOpsAsync(
  run: (paths: { lockPath: string }) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-merge-train-'));
  return run({ lockPath: path.join(dir, 'merge-lock.json') }).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const ALL_GREEN_ROLLUP: StatusCheckEntry[] = MERGE_TRAIN_REQUIRED_CONTEXTS.map((name) => ({
  name,
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
}));

function sampleExecutorResultBody(issueId: string, branch: string, pr: string, headSha: string): string {
  return [
    'EXECUTOR_RESULT: READY_FOR_REVIEW',
    'schema: executor-result/v1',
    `Issue: ${issueId}`,
    'Lane: claude',
    `Branch: ${branch}`,
    `PR: ${pr}`,
    `Head SHA: ${headSha}`,
    'Proof Artifact: docs/06_status/proof/UTV2-0000/evidence.json',
  ].join('\n');
}

/**
 * A fake `runner` that answers every `gh`/`git` call merge-train's drain
 * loop makes for a single candidate, so tests never shell out for real.
 * `outcomes` lets a test fail one specific step for one specific PR.
 */
function buildFakeRunner(
  outcomes: {
    updateBranchFailFor?: Set<string>;
    mergeFailFor?: Set<string>;
    throwFor?: { pr: string; step: 'update-branch' };
    authorizationDeniedFor?: Set<string>;
  } = {},
): { runner: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);

    // UTV2-1592 amendment: merge-train's merge step now routes through
    // runAuthorizedPrMerge, which re-invokes the pre-merge-authorization
    // subprocess via this same injected runner before every `gh pr merge`.
    // Answer it with an authorized:true receipt by default so every
    // pre-existing merge-train fixture keeps exercising exactly the
    // update-branch/CI-wait/repost/merge behavior it already covers, unless
    // a test explicitly asks for a denial via `authorizationDeniedFor`.
    if (command === 'pnpm' && args[0] === 'exec' && args[1] === 'tsx' && String(args[2]).includes('pre-merge-authorization')) {
      const prFlagIndex = args.indexOf('--pr');
      const pr = prFlagIndex >= 0 ? (args[prFlagIndex + 1] ?? '') : '';
      const authorized = !(outcomes.authorizationDeniedFor?.has(pr) ?? false);
      const receipt = {
        prNumber: Number(pr) || null,
        headSha: 'fakehead0000',
        requiredChecks: [],
        pmVerdict: { commentUrl: null, parsedHeadSha: null, valid: authorized },
        authorized,
        ...(authorized ? {} : { reason: `simulated pre-merge authorization denial for PR ${pr}` }),
      };
      return {
        status: authorized ? 0 : 1,
        stdout: Buffer.from(JSON.stringify(receipt)),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'api' && String(args[1]).includes('update-branch')) {
      const pr = String(args[1]).match(/pulls\/(\d+)\/update-branch/)?.[1] ?? '';
      if (outcomes.throwFor && outcomes.throwFor.pr === pr && outcomes.throwFor.step === 'update-branch') {
        throw new Error(`simulated unexpected crash updating branch for PR ${pr}`);
      }
      const fail = outcomes.updateBranchFailFor?.has(pr) ?? false;
      return {
        status: fail ? 1 : 0,
        stdout: Buffer.from(fail ? '' : 'ok'),
        stderr: Buffer.from(fail ? 'update-branch conflict' : ''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('statusCheckRollup')) {
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ statusCheckRollup: ALL_GREEN_ROLLUP })),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('headRefOid')) {
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ headRefOid: 'newheadsha0000' })),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('comments')) {
      const pr = args[2] ?? '';
      return {
        status: 0,
        stdout: Buffer.from(
          JSON.stringify({
            comments: [
              { body: sampleExecutorResultBody('UTV2-0000', `claude/utv2-0000-x`, pr, 'oldheadsha') },
            ],
          }),
        ),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'comment') {
      return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), error: undefined };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
      const pr = args[2] ?? '';
      const fail = outcomes.mergeFailFor?.has(pr) ?? false;
      return {
        status: fail ? 1 : 0,
        stdout: Buffer.from(fail ? '' : 'merged'),
        stderr: Buffer.from(fail ? 'merge conflict' : ''),
        error: undefined,
      };
    }

    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view' && args.includes('mergeCommit')) {
      return { status: 0, stdout: Buffer.from('deadbeef00'), stderr: Buffer.from(''), error: undefined };
    }

    throw new Error(`Unexpected command in buildFakeRunner: ${command} ${args.join(' ')}`);
  };

  return { runner, calls };
}

/** Instant CI-wait for fast, deterministic tests — no real network, no real timeout. */
const instantWaitForChecks: WaitForChecksFn = async (input, options) => {
  const run = options.runner('gh', ['pr', 'view', input.pr, '--json', 'statusCheckRollup'], { cwd: input.cwd });
  const parsed = JSON.parse(run.stdout ? run.stdout.toString('utf8') : '{}') as {
    statusCheckRollup?: StatusCheckEntry[];
  };
  return evaluateStatusCheckRollup(parsed.statusCheckRollup ?? [], input.requiredContexts);
};

const CANDIDATES: MergeTrainCandidate[] = [
  { issue_id: 'UTV2-2001', branch: 'claude/utv2-2001-a', pr: '2001' },
  { issue_id: 'UTV2-2002', branch: 'claude/utv2-2002-b', pr: '2002' },
  { issue_id: 'UTV2-2003', branch: 'claude/utv2-2003-c', pr: '2003' },
];

test('merge-train: evaluateStatusCheckRollup evaluates pending/success/failure correctly', () => {
  assert.deepStrictEqual(evaluateStatusCheckRollup([]).status, 'pending');
  assert.deepStrictEqual(evaluateStatusCheckRollup(ALL_GREEN_ROLLUP).status, 'success');
  const oneFailed = ALL_GREEN_ROLLUP.map((entry, index) =>
    index === 1 ? { ...entry, conclusion: 'FAILURE' } : entry,
  );
  assert.deepStrictEqual(evaluateStatusCheckRollup(oneFailed).status, 'failure');
  const onePending = ALL_GREEN_ROLLUP.map((entry, index) => (index === 2 ? { ...entry, conclusion: null } : entry));
  assert.deepStrictEqual(evaluateStatusCheckRollup(onePending).status, 'pending');
});

test('merge-train: isExecutorResultComment and buildRepostedExecutorResultBody', () => {
  const body = sampleExecutorResultBody('UTV2-2001', 'claude/utv2-2001-a', '2001', 'oldsha');
  assert.strictEqual(isExecutorResultComment(body), true);
  assert.strictEqual(isExecutorResultComment('not an executor result'), false);

  const reposted = buildRepostedExecutorResultBody(body, 'newsha123');
  assert.match(reposted, /Head SHA: newsha123/);
  assert.doesNotMatch(reposted, /oldsha/);
  assert.match(reposted, /Issue: UTV2-2001/);
});

test('merge-train: buildRepostedExecutorResultBody handles bold Head SHA labels (P2 regression)', () => {
  // executor-result-validator.yml's own field parser strips a leading
  // `**...**` span before matching, so it accepts BOTH bold placements:
  //   "**Head SHA**: value"   (bold wraps the label only)
  //   "**Head SHA:** value"   (bold wraps the label AND the colon)
  // The rewrite must find-and-replace either form, not silently fail to
  // match and append a second (ignored) plain line while leaving the
  // stale bold line as the first — and therefore validator-visible — one.

  const boldColonInside = [
    'EXECUTOR_RESULT: READY_FOR_REVIEW',
    'schema: executor-result/v1',
    'Issue: UTV2-2001',
    '**Head SHA:** oldsha000',
    'Proof Artifact: docs/06_status/proof/UTV2-2001/verification.md',
  ].join('\n');
  const repostedA = buildRepostedExecutorResultBody(boldColonInside, 'newshaAAA');
  assert.match(repostedA, /^Head SHA: newshaAAA$/m);
  assert.doesNotMatch(repostedA, /oldsha000/);
  // Exactly one Head SHA line must remain — not a stale bold line plus an
  // appended plain one.
  assert.strictEqual((repostedA.match(/head sha/gi) ?? []).length, 1);

  const boldLabelOnly = [
    'EXECUTOR_RESULT: READY_FOR_REVIEW',
    'schema: executor-result/v1',
    'Issue: UTV2-2002',
    '**Head SHA**: oldsha111',
    'Proof Artifact: docs/06_status/proof/UTV2-2002/verification.md',
  ].join('\n');
  const repostedB = buildRepostedExecutorResultBody(boldLabelOnly, 'newshaBBB');
  assert.match(repostedB, /^Head SHA: newshaBBB$/m);
  assert.doesNotMatch(repostedB, /oldsha111/);
  assert.strictEqual((repostedB.match(/head sha/gi) ?? []).length, 1);
});

test('merge-train: happy path drains all candidates and releases the lock', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner, calls } = buildFakeRunner();
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_train_completed');
    if (result.ok) {
      assert.strictEqual(result.entries.length, 3);
      assert.ok(result.entries.every((entry) => entry.status === 'merged'));
      assert.ok(result.entries.every((entry) => entry.merge_sha === 'deadbeef00'));
    }

    // Every candidate got update-branch → statusCheckRollup poll →
    // headRefOid → comments read → comment post → merge → mergeCommit read.
    const updateBranchCalls = calls.filter((call) => call[1] === 'api').length;
    const mergeCalls = calls.filter((call) => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'merge').length;
    assert.strictEqual(updateBranchCalls, 3);
    assert.strictEqual(mergeCalls, 3);

    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('UTV2-1592: merge-train runs pre-merge authorization before every candidate\'s merge, not just the first', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner, calls } = buildFakeRunner();
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.entries.every((entry) => entry.status === 'merged'));
    }

    const isAuthCall = (call: string[]): boolean =>
      call[0] === 'pnpm' && call[1] === 'exec' && call[2] === 'tsx' && String(call[3]).includes('pre-merge-authorization');
    const isMergeCall = (call: string[]): boolean => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'merge';

    const authCalls = calls.filter(isAuthCall);
    assert.strictEqual(authCalls.length, 3, 'expected one authorization call per candidate, not a single reused check');

    // Every authorization call must be for the same PR as, and must
    // immediately precede, that candidate's own merge call -- proving each
    // candidate is independently re-authorized rather than one check being
    // reused across the whole batch.
    const mergeIndices = calls.map((call, index) => (isMergeCall(call) ? index : -1)).filter((i) => i >= 0);
    assert.strictEqual(mergeIndices.length, 3);
    for (const mergeIndex of mergeIndices) {
      const precedingCall = calls[mergeIndex - 1] as string[];
      assert.ok(isAuthCall(precedingCall), `expected an authorization call immediately before merge call at index ${mergeIndex}`);
      const prFlagIndex = precedingCall.indexOf('--pr');
      const authorizedPr = precedingCall[prFlagIndex + 1];
      const mergedPr = calls[mergeIndex]?.[3];
      assert.strictEqual(authorizedPr, mergedPr, 'authorization call must be for the same PR it immediately gates');
    }
  });
});

test('UTV2-1592: merge-train authorization denial for a candidate prevents its merge runner from being called and stops the drain', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner, calls } = buildFakeRunner({ authorizationDeniedFor: new Set(['2001']) });
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.entries?.[0]?.status, 'merge_authorization_denied');
      assert.match(result.entries?.[0]?.detail ?? '', /pre-merge authorization denied/);
      assert.match(result.entries?.[0]?.detail ?? '', /simulated pre-merge authorization denial for PR 2001/);
      assert.strictEqual(result.entries?.[1]?.status, 'skipped_after_failure');
      assert.strictEqual(result.entries?.[2]?.status, 'skipped_after_failure');
    }

    // The merge runner (`gh pr merge`) must never have been invoked for the
    // denied candidate -- denial happens strictly before the merge command
    // itself runs.
    const mergeCallsForDeniedPr = calls.filter(
      (call) => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'merge' && call[3] === '2001',
    );
    assert.strictEqual(mergeCallsForDeniedPr.length, 0);

    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('merge-train: reposts the executor-result comment BEFORE waiting on checks (P1 regression)', async () => {
  // Real-world failure mode this guards against: `pr-update-branch` moves
  // the PR head, which immediately re-triggers Executor Result Validation
  // via a `synchronize` event. If the drain waited on checks BEFORE
  // reposting, that validator run would still see the stale (pre-update)
  // comment and fail with a HEAD SHA mismatch — and `waitForChecks` would
  // report that as a hard failure, stopping the train on the very first
  // candidate whose update-branch actually moved the head. This
  // waitForChecks fake models exactly that validator behavior: it only
  // reports success once a repost (a `gh pr comment` call) has actually
  // happened.
  await withTempOpsAsync(async ({ lockPath }) => {
    let reposted = false;
    const { runner: baseRunner, calls } = buildFakeRunner();
    const trackingRunner: CommandRunner = (command, args, options) => {
      if (command === 'gh' && args[0] === 'pr' && args[1] === 'comment') {
        reposted = true;
      }
      return baseRunner(command, args, options);
    };
    const waitForChecksRequiringPriorRepost: WaitForChecksFn = async () => {
      if (!reposted) {
        return {
          status: 'failure',
          detail: 'simulated Executor Result Validation failure: comment still bound to the pre-update-branch head SHA',
        };
      }
      return { status: 'success', detail: 'all required contexts green (post-repost)' };
    };

    const result = await runMergeTrain(
      { candidates: [CANDIDATES[0] as MergeTrainCandidate], ttl_minutes: 5 },
      { runner: trackingRunner, waitForChecks: waitForChecksRequiringPriorRepost, lockPath },
    );

    assert.strictEqual(reposted, true);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_train_completed');
    if (result.ok) {
      assert.strictEqual(result.entries[0]?.status, 'merged');
    }

    // Confirm ordering directly from the call log too: the comment-post
    // call must appear before the caller ever invoked waitForChecks's own
    // status check — proven here by the fact statusCheckRollup was never
    // polled at all (this test's fake waitForChecks doesn't call the
    // runner), so the only way `reposted` could be true when
    // waitForChecks first runs is if the repost happened first.
    const commentCalls = calls.filter((call) => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'comment');
    assert.strictEqual(commentCalls.length, 1);
  });
});

test('merge-train: a failed PR mid-train stops the drain, leaves earlier merges intact, and releases the lock', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner } = buildFakeRunner({ updateBranchFailFor: new Set(['2002']) });
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_train_partial_failure');
    if (!result.ok) {
      assert.strictEqual(result.entries?.[0]?.status, 'merged');
      assert.strictEqual(result.entries?.[1]?.status, 'update_branch_failed');
      assert.strictEqual(result.entries?.[2]?.status, 'skipped_after_failure');
    }

    // The mutex is still released even though the train did not complete —
    // and the first candidate's merge is not undone (nothing to undo).
    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('merge-train: an unexpected exception from a dependency is caught, releases the lock, and stops the drain', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner } = buildFakeRunner({ throwFor: { pr: '2001', step: 'update-branch' } });
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_train_partial_failure');
    if (!result.ok) {
      assert.strictEqual(result.entries?.[0]?.status, 'unexpected_error');
      assert.match(result.entries?.[0]?.detail ?? '', /simulated unexpected crash/);
      assert.strictEqual(result.entries?.[1]?.status, 'skipped_after_failure');
    }

    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('merge-train: a merge failure (not update-branch) still stops the drain cleanly', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner } = buildFakeRunner({ mergeFailFor: new Set(['2001']) });
    const result = await runMergeTrain(
      { candidates: CANDIDATES, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.entries?.[0]?.status, 'merge_failed');
      assert.match(result.entries?.[0]?.detail ?? '', /merge conflict/);
    }
    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('merge-train: invalid input (empty candidates) fails closed before acquiring any lock', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const result = await runMergeTrain({ candidates: [] }, { lockPath });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_train_invalid_input');
    assert.strictEqual(fs.existsSync(lockPath), false);
  });
});

test('merge-train: invalid input (malformed candidate) fails closed with a clear message', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const result = await runMergeTrain(
      { candidates: [{ issue_id: 'UTV2-2001', branch: '', pr: '' } as MergeTrainCandidate] },
      { lockPath },
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(!result.ok && result.code, 'merge_train_invalid_input');
    assert.match(!result.ok ? result.message : '', /branch is required/);
    assert.match(!result.ok ? result.message : '', /pr is required/);
    assert.strictEqual(fs.existsSync(lockPath), false);
  });
});

test('merge-train: dry-run plans the batch, executes no commands, and still releases the lock', async () => {
  await withTempOpsAsync(async ({ lockPath }) => {
    const { runner, calls } = buildFakeRunner();
    const result = await runMergeTrain(
      { candidates: CANDIDATES, dry_run: true, ttl_minutes: 5 },
      { runner, waitForChecks: instantWaitForChecks, lockPath },
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.code, 'merge_train_dry_run');
    assert.deepStrictEqual(calls, []);
    if (result.ok) {
      assert.ok(result.entries.every((entry) => entry.status === 'planned'));
    }

    const lock = readMergeLock(lockPath);
    assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
  });
});

test('merge-train timing: a 3-PR batch completes in under half the simulated serial baseline (real measured wall-clock)', async (t) => {
  await withTempOpsAsync(async ({ lockPath }) => {
    // Real (non-zero) delays so Date.now() deltas below are genuine
    // measurements of actually-executed async code, not narrative
    // estimates. Scaled down from the decision packet's observed ~9min CI
    // cycles — the ratio being measured (train vs. serial) does not depend
    // on the absolute delay chosen. Sized generously (60ms) relative to
    // typical event-loop/timer jitter (single-digit ms) so this stays
    // deterministic under full-suite parallel load, not just in isolation.
    const CI_CYCLE_MS = 60;
    // Packet's measured cost model is "2N-3N CI cycles" for N PRs under
    // today's serial flow; we use the upper bound (3/PR) for the baseline
    // so the comparison is conservative in merge-train's favor without
    // needing to be tuned to pass by a hair.
    const SERIAL_CYCLES_PER_PR = 3;
    const TRAIN_CYCLES_PER_PR = 1;

    const delayingWaitForChecks = (cycles: number): WaitForChecksFn => async (input, options) => {
      for (let i = 0; i < cycles; i++) {
        await new Promise((resolve) => setTimeout(resolve, CI_CYCLE_MS));
      }
      return instantWaitForChecks(input, options);
    };

    async function measureTrain(): Promise<number> {
      const { runner } = buildFakeRunner();
      const start = Date.now();
      const result = await runMergeTrain(
        { candidates: CANDIDATES, ttl_minutes: 5 },
        { runner, waitForChecks: delayingWaitForChecks(TRAIN_CYCLES_PER_PR), lockPath },
      );
      assert.strictEqual(result.ok, true);
      return Date.now() - start;
    }

    async function measureSerialBaseline(): Promise<number> {
      // Serial baseline: today's manual per-PR flow. Per the decision
      // packet (§0/§3), every merge invalidates every other open PR, so
      // each PR pays multiple CI cycles, plus an idle gap between merges
      // while the next PR's update-branch cycle is re-driven by hand —
      // exactly the gap merge-train's back-to-back draining eliminates.
      let total = 0;
      for (let i = 0; i < CANDIDATES.length; i++) {
        const candidate = CANDIDATES[i] as MergeTrainCandidate;
        const { runner } = buildFakeRunner();
        const start = Date.now();
        const result = await runMergeTrain(
          { candidates: [candidate], ttl_minutes: 5 },
          { runner, waitForChecks: delayingWaitForChecks(SERIAL_CYCLES_PER_PR), lockPath },
        );
        total += Date.now() - start;
        assert.strictEqual(result.ok, true);
        if (i < CANDIDATES.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, CI_CYCLE_MS));
          total += CI_CYCLE_MS;
        }
      }
      return total;
    }

    function median(values: number[]): number {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] as number;
    }

    // Take the median of 3 real trials on each side to smooth out one-off
    // scheduler/GC hiccups — still a real measurement (each trial is a
    // genuine Date.now() delta around actually-executed code), just a more
    // robust one than a single sample.
    const trainTrials = [await measureTrain(), await measureTrain(), await measureTrain()];
    const serialTrials = [
      await measureSerialBaseline(),
      await measureSerialBaseline(),
      await measureSerialBaseline(),
    ];
    const trainDurationMs = median(trainTrials);
    const serialDurationMs = median(serialTrials);

    t.diagnostic(
      `merge-train measured (median of 3 real trials each): trainDurationMs=${trainDurationMs} ` +
        `(trials=${trainTrials.join(',')}) serialDurationMs=${serialDurationMs} (trials=${serialTrials.join(',')}) ` +
        `ratio=${(trainDurationMs / serialDurationMs).toFixed(3)} (acceptance requires < 0.5)`,
    );

    assert.ok(
      trainDurationMs < serialDurationMs * 0.5,
      `expected train (${trainDurationMs}ms) to complete in under half the serial baseline (${serialDurationMs}ms)`,
    );
  });
});

// ---------------------------------------------------------------------------
// UTV2-1790 — git-merge-main against a REAL, genuinely diverged repository
//
// The mocked-runner tests above prove the command *shape* and the mutex
// contract, but they cannot prove the command actually works: a runner that
// returns status 0 for anything would have happily "passed" the broken
// `--ff-only` build for as long as it existed. These tests run the real git
// binary against real divergent history, which is the only thing that
// distinguishes a merge that works from one that cannot.
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

/**
 * Build a repository whose current branch has genuinely diverged from
 * `origin/main`: both refs share a base commit and each has a commit the other
 * does not. `conflicting` decides whether the two sides touch the same line.
 *
 * `origin/main` is created as a real remote-tracking ref so the wrapper's
 * `origin/main` revision resolves exactly as it does in a cloned repo.
 */
function withDivergedRepo(
  opts: { conflicting: boolean },
  run: (repo: { dir: string; baseSha: string; branchSha: string; mainSha: string }) => void,
): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-diverged-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');

    // The wrapper autostashes these two pathspecs; they must exist as real
    // tracked paths or `git stash push -- <pathspec>` fails on no match.
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'shared.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // Side 1: the "remote" main advances.
    fs.writeFileSync(path.join(dir, 'shared.txt'), 'base\nfrom-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main advances');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);

    // Side 2: the lane branch advances from the SAME base, so the two diverge.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    if (opts.conflicting) {
      // Same line as main's change -> a real content conflict.
      fs.writeFileSync(path.join(dir, 'shared.txt'), 'base\nfrom-lane\n');
    } else {
      fs.writeFileSync(path.join(dir, 'lane-only.txt'), 'lane work\n');
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane advances');
    const branchSha = git(dir, 'rev-parse', 'HEAD');

    // UTV2-1790: an UNTRACKED lane-state file, so the wrapper's autostash
    // actually creates a stash entry. Without this the stash push is a no-op and
    // every "the lane-state stash was restored" assertion below would be
    // vacuously true -- it would pass just as happily if the restore never ran.
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'lane: state\n');

    // Precondition: genuinely diverged, so --ff-only could never succeed here.
    const counts = git(dir, 'rev-list', '--left-right', '--count', 'origin/main...HEAD');
    assert.strictEqual(counts.replace(/\s+/u, ' '), '1 1', 'fixture must be genuinely diverged');

    run({ dir, baseSha, branchSha, mainSha });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A CommandRunner that really executes git, but lets a test observe every call
 * (and optionally substitute an outcome for one). Used to prove ORDER: the
 * mutex must still be held at the moment cleanup runs.
 */
function realGitRunner(
  hook: (command: string, args: string[]) => ReturnType<CommandRunner> | undefined,
): CommandRunner {
  return (command, args, options) => {
    const substituted = hook(command, args);
    if (substituted) return substituted;
    return spawnSync(command, args, { cwd: options.cwd, stdio: 'pipe' }) as ReturnType<
      CommandRunner
    >;
  };
}

function unmergedPaths(dir: string): string[] {
  const r = spawnSync('git', ['diff', '--name-only', '--diff-filter=U'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function mergeHeadPresent(dir: string): boolean {
  return (
    spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: dir }).status === 0
  );
}

test('UTV2-1790: git-merge-main merges a genuinely diverged branch (real git)', () => {
  withDivergedRepo({ conflicting: false }, ({ dir, branchSha, mainSha }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      // Point GIT_EDITOR at a command that always fails, so this test proves the
      // merge completes without depending on an editor at all.
      //
      // Honest scope note: this does NOT make `--no-edit` load-bearing here.
      // `git merge --no-ff` only opens the editor when it is run from a
      // terminal, and the wrapper spawns git with piped stdio, so dropping
      // `--no-edit` still passes this test. `--no-edit` is the guarantee for the
      // callers that DO have a tty (a developer running `pnpm ops:merge-wrapper`
      // interactively), where a `--no-ff` merge would otherwise stop in vi. The
      // command-shape assertion in `buildExtendedCommand constructs
      // git-merge-main command` is what pins the flag.
      const priorEditor = process.env['GIT_EDITOR'];
      process.env['GIT_EDITOR'] = 'false';
      let result;
      try {
        result = runExtendedMergeWrapper(
          { ...BASE, operation: 'git-merge-main', cwd: dir },
          { lockPath, deferredDir },
        );
      } finally {
        if (priorEditor === undefined) delete process.env['GIT_EDITOR'];
        else process.env['GIT_EDITOR'] = priorEditor;
      }

      assert.strictEqual(
        result.ok,
        true,
        `expected the history-preserving merge to succeed; got ${result.code}: ${result.message ?? ''} ${result.stderr ?? ''}`,
      );
      assert.strictEqual(result.code, 'merge_wrapper_completed');

      // Criterion: no history rewriting. Both pre-existing heads must still
      // exist unchanged and both must be parents of the new merge commit.
      const head = git(dir, 'rev-parse', 'HEAD');
      assert.notStrictEqual(head, branchSha, 'a merge commit should have been created');
      const parents = git(dir, 'rev-list', '--parents', '-n', '1', 'HEAD').split(/\s+/u).slice(1);
      assert.deepStrictEqual(
        parents.sort(),
        [branchSha, mainSha].sort(),
        'merge commit parents must be the two pre-existing heads, byte-identical',
      );

      // Both original commits remain reachable and their SHAs are untouched.
      assert.strictEqual(git(dir, 'rev-parse', `${branchSha}^{commit}`), branchSha);
      assert.strictEqual(git(dir, 'rev-parse', `${mainSha}^{commit}`), mainSha);

      // Content from both sides survived.
      assert.ok(fs.existsSync(path.join(dir, 'lane-only.txt')), 'lane-side file preserved');
      assert.match(fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8'), /from-main/u);

      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released', 'mutex must be released');
    });
  });
});

test('UTV2-1790: a real conflict fails, aborts the merge, restores the stash, and only then releases the mutex', () => {
  withDivergedRepo({ conflicting: true }, ({ dir, branchSha }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      // Order proof: capture the mutex state at the instant the abort runs.
      let lockStatusDuringAbort: string | null = null;
      const runner = realGitRunner((command, args) => {
        if (command === 'git' && args[0] === 'merge' && args[1] === '--abort') {
          const held = readMergeLock(lockPath);
          lockStatusDuringAbort = held.ok ? held.lock.status : 'unreadable';
        }
        return undefined;
      });

      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir, runner },
      );

      // 1. Failure is reported.
      assert.strictEqual(result.ok, false, 'a genuine content conflict must not report success');
      assert.strictEqual(
        result.code,
        'merge_wrapper_command_failed',
        'cleanup succeeded, so this is an ordinary command failure, not a cleanup failure',
      );

      // Original merge diagnostics are preserved -- not replaced by the abort's.
      const diagnostic = `${result.message ?? ''} ${result.stdout ?? ''} ${result.stderr ?? ''}`;
      assert.match(
        diagnostic,
        /conflict|CONFLICT|Automatic merge failed/u,
        `failure must name the conflict; got: ${diagnostic}`,
      );

      // 2. The original lane HEAD is unchanged.
      assert.strictEqual(
        git(dir, 'rev-parse', 'HEAD'),
        branchSha,
        'the failed merge must leave the lane head exactly where it was',
      );
      assert.strictEqual(git(dir, 'rev-parse', `${branchSha}^{commit}`), branchSha);

      // 3. No in-progress merge remains.
      assert.strictEqual(mergeHeadPresent(dir), false, 'MERGE_HEAD must be gone after cleanup');

      // 4. No unmerged index entries remain.
      assert.deepStrictEqual(
        unmergedPaths(dir),
        [],
        'git diff --name-only --diff-filter=U must return nothing',
      );

      // 5. The lane-state stash was restored.
      assert.strictEqual(
        result.main_sync_stash?.stashed,
        true,
        'fixture precondition: the autostash must actually have stashed something',
      );
      assert.strictEqual(result.main_sync_stash?.popped, true, 'the autostash must be restored');
      assert.ok(
        fs.existsSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml')),
        'the untracked lane-state file must be back on disk',
      );
      assert.strictEqual(
        git(dir, 'stash', 'list'),
        '',
        'no autostash entry may be left behind',
      );

      // 6. The worktree is back to its pre-attempt state: the lane's own content,
      //    with no conflict markers written by the failed merge.
      const shared = fs.readFileSync(path.join(dir, 'shared.txt'), 'utf8');
      assert.strictEqual(shared, 'base\nfrom-lane\n', 'lane content restored verbatim');
      assert.doesNotMatch(shared, /<<<<<<<|>>>>>>>/u, 'no conflict markers may survive');
      assert.strictEqual(
        git(dir, 'status', '--porcelain', '--untracked-files=all'),
        '?? .ops/sync/UTV2-1790.yml',
        'the tree must differ from the pre-attempt state only by the untracked lane-state file it started with',
      );

      // 7. The mutex was still HELD while cleanup ran, and is released after it.
      assert.strictEqual(
        lockStatusDuringAbort,
        'held',
        'the mutex must not be released until cleanup has finished',
      );
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released', 'mutex released after cleanup');
    });
  });
});

test('UTV2-1790: a cleanup failure fails closed — mutex retained, stash held, distinct code', () => {
  // The dangerous case the P1 names: the merge conflicts AND the abort does not
  // work. Reporting an ordinary `merge_wrapper_command_failed` here would tell
  // the caller "the command failed, substrate is fine" while MERGE_HEAD and an
  // unmerged index are still sitting in the worktree and the mutex is open for
  // the next lane to walk into.
  withDivergedRepo({ conflicting: true }, ({ dir, branchSha }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      let abortAttempted = false;
      const runner = realGitRunner((command, args) => {
        if (command === 'git' && args[0] === 'merge' && args[1] === '--abort') {
          abortAttempted = true;
          // Do NOT execute it: the conflicted merge state genuinely survives.
          return {
            status: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('fatal: could not abort merge'),
            error: undefined,
          } as ReturnType<CommandRunner>;
        }
        return undefined;
      });

      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir, runner },
      );

      assert.strictEqual(abortAttempted, true, 'cleanup must at least have tried to abort');

      // Distinct, fail-closed code — NOT the ordinary command failure.
      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.code,
        'merge_wrapper_cleanup_failed',
        'an uncleaned worktree must not be reported as an ordinary completed failure',
      );

      // The substrate really is unsafe — this test is not simulating the danger.
      assert.strictEqual(mergeHeadPresent(dir), true, 'the merge really is still in progress');
      assert.ok(unmergedPaths(dir).length > 0, 'unmerged entries really do remain');

      // The mutex is RETAINED, so no other lane can enter this worktree.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'held',
        'the mutex must NOT be released while the worktree is mid-merge',
      );
      assert.strictEqual(result.release, undefined, 'no release may be reported');

      // The stash is NOT popped into the conflicted index; it is left intact and
      // the caller is told where it is.
      assert.strictEqual(result.main_sync_stash?.popped, false, 'the autostash must be left alone');
      assert.notStrictEqual(git(dir, 'stash', 'list'), '', 'the autostash entry must still exist');

      // The message is actionable and preserves the original merge diagnostics.
      assert.match(result.message, /could not abort merge/u, 'names why cleanup failed');
      assert.match(result.message, /MERGE_HEAD is still present/u, 'names the residue');
      assert.match(result.message, /NOT released/u, 'says the mutex was retained');
      assert.match(
        `${result.stdout ?? ''} ${result.stderr ?? ''}`,
        /conflict|CONFLICT|Automatic merge failed/u,
        'the original merge diagnostics must survive the cleanup path',
      );

      // The lane commit itself is still intact.
      assert.strictEqual(git(dir, 'rev-parse', `${branchSha}^{commit}`), branchSha);

      // Leave the fixture recoverable for the temp-dir teardown.
      spawnSync('git', ['merge', '--abort'], { cwd: dir });
    });
  });
});

test('UTV2-1790: --no-ff still records a merge commit when the branch is merely behind', () => {
  // Guards the reason this is `--no-ff` rather than a bare `git merge`: on a
  // non-diverged branch a bare merge fast-forwards and silently moves the
  // branch with no merge commit, making the verb's effect depend on divergence
  // state. The operation must behave identically in both cases.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-behind-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main advances');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);
    // Branch sits at base: strictly behind, not diverged.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir },
      );
      assert.strictEqual(result.ok, true, `expected success; got ${result.code}: ${result.message ?? ''}`);
      const merges = git(dir, 'rev-list', '--merges', 'HEAD');
      assert.notStrictEqual(merges, '', 'a merge commit must be recorded even when merely behind');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
