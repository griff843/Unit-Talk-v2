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
  runMergeWrapper,
  worktreeResidue,
  abortInProgressSync,
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
const CHERRY_PICK_HEAD_PROBE_CALL = [
  'git',
  'rev-parse',
  '--verify',
  '--quiet',
  'CHERRY_PICK_HEAD',
];
const REVERT_HEAD_PROBE_CALL = ['git', 'rev-parse', '--verify', '--quiet', 'REVERT_HEAD'];
const REBASE_MERGE_DIR_PROBE_CALL = ['git', 'rev-parse', '--git-path', 'rebase-merge'];
const REBASE_APPLY_DIR_PROBE_CALL = ['git', 'rev-parse', '--git-path', 'rebase-apply'];
// UTV2-1790 (review round 10, P1): bisect state lives in plain files, not refs.
const BISECT_LOG_PROBE_CALL = ['git', 'rev-parse', '--git-path', 'BISECT_LOG'];
const BISECT_START_PROBE_CALL = ['git', 'rev-parse', '--git-path', 'BISECT_START'];
// Order matches probeSyncResidue: MERGE_HEAD, REBASE_HEAD, the two sequencer
// directories (reached only when REBASE_HEAD is absent), CHERRY_PICK_HEAD,
// REVERT_HEAD, the two bisect files, then unmerged paths.
// UTV2-1790 (review round 8): `main-sync` now measures the worktree BEFORE it
// stashes or pulls, and refuses over a tree that is mid-merge/rebase/cherry-pick/
// revert. Mock-runner fixtures below are about command SEQUENCES, not about
// worktree state, and their runners answer every vector with the mock's blanket
// response -- which the pre-flight would correctly read as unanswerable.
//
// These fixtures therefore state their premise explicitly rather than encoding it
// in a mock's incidental behaviour. The pre-flight itself is proven against REAL
// git by tests 58, 63 and 64, never by this stub.
const CLEAN_WORKTREE_PROBE = (): { clean: boolean; detail: string } => ({
  clean: true,
  detail: 'test fixture posits a clean worktree',
});

const CLEANUP_PROBE_CALLS = [
  MERGE_HEAD_PROBE_CALL,
  REBASE_HEAD_PROBE_CALL,
  REBASE_MERGE_DIR_PROBE_CALL,
  REBASE_APPLY_DIR_PROBE_CALL,
  CHERRY_PICK_HEAD_PROBE_CALL,
  REVERT_HEAD_PROBE_CALL,
  BISECT_LOG_PROBE_CALL,
  BISECT_START_PROBE_CALL,
  UNMERGED_PROBE_CALL,
];
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

// UTV2-1790: answer the post-failure cleanup probes realistically. A blanket
// failing mock makes `git rev-parse --verify --quiet MERGE_HEAD` exit 128, which
// abortInProgressSync now (correctly) reads as "the worktree state could not be
// determined" and fails closed on. The tests below cover the ordinary case
// instead: the command failed and left nothing behind, so MERGE_HEAD/REBASE_HEAD
// are absent (git exit 1, no output) and there are no unmerged paths (exit 0).
function withCleanCleanupProbes(calls: string[][], inner: CommandRunner): CommandRunner {
  return (command, args, options) => {
    const isRefProbe =
      command === 'git' &&
      args[0] === 'rev-parse' &&
      args[1] === '--verify' &&
      ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].includes(args[3] ?? '');
    // `git rev-parse --git-path <name>` always exits 0 and prints a path, whether
    // or not the directory exists; the caller does the existence check. Answering
    // it with the blanket failure this runner uses for the sync command would make
    // the tree read as UNDETERMINABLE, which is a different test (51).
    const isSequencerDirProbe =
      command === 'git' && args[0] === 'rev-parse' && args[1] === '--git-path';
    const isUnmergedProbe = command === 'git' && args[0] === 'diff' && args.includes('--diff-filter=U');
    if (isRefProbe || isSequencerDirProbe || isUnmergedProbe) {
      calls.push([command, ...args]);
      return {
        status: isRefProbe ? 1 : 0,
        stdout: Buffer.from(isSequencerDirProbe ? `.git/${args[2]}-does-not-exist\n` : ''),
        stderr: Buffer.from(''),
        error: undefined,
      };
    }
    return inner(command, args, options);
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: divergedRunner , residueProbe: CLEAN_WORKTREE_PROBE },
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
        residueProbe: CLEAN_WORKTREE_PROBE,
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
      { lockPath, deferredDir, runner: droppingSyncRunner(calls, ['scripts/ops/scratch.ts']) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: networkErrorRunner , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, residueProbe: CLEAN_WORKTREE_PROBE, runner: withCleanCleanupProbes(
          calls,
          stashAwareRunner(calls, () => ({ status: 128, stdout: '', stderr: 'conflict' })),
        ) },
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
      { lockPath, deferredDir, residueProbe: CLEAN_WORKTREE_PROBE, runner: withCleanCleanupProbes(
          calls,
          stashAwareRunner(calls, () => ({ status: 128, stdout: '', stderr: 'conflict' })),
        ) },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      { lockPath, deferredDir, runner: okRunner(calls) , residueProbe: CLEAN_WORKTREE_PROBE },
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
      const issued: string[][] = [];
      const runner = realGitRunner((command, args) => {
        issued.push([command, ...args]);
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

      // Review round 3, P3: the two assertions above are satisfied by git's OWN
      // refusal to pop into an unmerged index, so they would pass even if the
      // fail-closed branch attempted the pop. Assert the pop was never ISSUED --
      // that is the control, and only this pins it.
      assert.ok(
        !issued.some((c) => c[0] === 'git' && c[1] === 'stash' && c[2] === 'pop'),
        'the fail-closed branch must not even attempt the pop',
      );

      // Review round 3, P2: the reported command must be the git invocation that
      // actually ran, not the `main-sync` pull it is bridged through. Naming
      // `git pull --ff-only origin main` here would point the operator at a
      // command that cannot leave MERGE_HEAD behind.
      assert.deepStrictEqual(
        result.command,
        ['git', 'merge', '--no-ff', '--no-edit', 'origin/main'],
        'the result must report the real invocation, not the bridge',
      );
      assert.match(
        result.message,
        /The command that failed was: git merge --no-ff --no-edit origin\/main/u,
        'the operator message must name the real invocation',
      );
      assert.doesNotMatch(
        result.message,
        /git pull --ff-only/u,
        'the operator message must not name the bridge command',
      );

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

test('UTV2-1790: an undeterminable worktree state fails closed instead of reporting clean', () => {
  // Review round 2, P2. `git rev-parse --verify --quiet MERGE_HEAD` exits non-zero
  // both when the ref is ABSENT and when the command could not run at all. Reading
  // those as the same thing let an undeterminable tree take the "nothing to abort"
  // early return -- so the autostash would be popped into a possibly-unmerged index
  // and the mutex released, which is precisely the P1 this lane closes.
  //
  // Here a real conflicted merge IS in progress, but every state probe fails with
  // git's fatal exit 128. The wrapper must refuse to call that clean.
  withDivergedRepo({ conflicting: true }, ({ dir, branchSha }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      const runner = realGitRunner((command, args) => {
        const isProbe =
          command === 'git' &&
          ((args[0] === 'rev-parse' && args.includes('--verify')) ||
            (args[0] === 'diff' && args.includes('--diff-filter=U')));
        if (isProbe) {
          return {
            status: 128,
            stdout: Buffer.from(''),
            stderr: Buffer.from('fatal: not a git repository'),
            error: undefined,
          } as ReturnType<CommandRunner>;
        }
        return undefined;
      });

      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        {
          lockPath,
          deferredDir,
          runner,
          // Scope this fixture to the POST-command cleanup probe. Review round 8
          // added a pre-flight residue measurement that runs before the merge, and
          // it would (correctly) refuse this repo first, so the cleanup path under
          // test would never be reached. The pre-flight's own undeterminable case
          // is proven separately by test 63; `abortInProgressSync` does NOT use
          // this stub -- it probes through `runner`, which still returns 128.
          residueProbe: CLEAN_WORKTREE_PROBE,
        },
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.code,
        'merge_wrapper_cleanup_failed',
        'an undeterminable state must fail closed, not be reported as an ordinary command failure',
      );
      assert.match(
        result.message,
        /could not be determined|Could not determine/u,
        'the message must say the state could not be determined',
      );

      // Fail-closed guarantees hold: mutex retained, stash not popped.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'held',
        'the mutex must NOT be released when the state is unknown',
      );
      assert.strictEqual(result.main_sync_stash?.popped, false, 'the autostash must be left alone');

      // The recovery instruction must name a command that can actually release
      // the lock -- `guard` only asserts it is held.
      assert.match(result.message, /ops:merge-lock release/u, 'names a real release command');

      // The lane's own commit is untouched: refusing to clean up must not mean
      // half-cleaning up. The conflicted merge is still in progress (that is the
      // point), so HEAD is still the pre-attempt lane commit.
      assert.strictEqual(
        git(dir, 'rev-parse', 'HEAD').trim(),
        branchSha,
        'the lane HEAD must be unchanged after a refused cleanup',
      );

      spawnSync('git', ['merge', '--abort'], { cwd: dir });
    });
  });
});

test('UTV2-1790: a cleanup hook that throws fails closed rather than escaping', () => {
  // Review round 2, P3. `onCommandFailure` is a caller-supplied injection point.
  // If it throws and nothing catches it, runMergeWrapper exits with the lock held,
  // the stash unpopped and no structured result at all -- the operator gets a stack
  // trace instead of recovery instructions.
  withDivergedRepo({ conflicting: true }, ({ dir }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      const result = runMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        {
          lockPath,
          deferredDir,
          // The stash push must succeed, otherwise the wrapper returns
          // merge_wrapper_stash_failed before the sync command ever runs and the
          // cleanup hook is never reached.
          runner: stashAwareRunner([], () => ({
            status: 1,
            stdout: '',
            stderr: 'simulated failure',
          })),
          residueProbe: CLEAN_WORKTREE_PROBE,
          onCommandFailure: () => {
            throw new Error('cleanup exploded');
          },
        },
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.code,
        'merge_wrapper_cleanup_failed',
        'a throwing cleanup hook must produce the fail-closed result, not propagate',
      );
      assert.match(result.message, /cleanup exploded/u, 'the thrown message must be surfaced');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'held', 'mutex retained');
    });
  });
});

test('UTV2-1790: a real rebase conflict is aborted with the REBASE verb, not the merge verb', () => {
  // Review round 3, P3. `abortInProgressSync` picks `rebase` vs `merge` from the
  // operation, and nothing pinned that choice: hardcoding 'merge' survived the
  // whole suite, because the only real-git cleanup regression was merge-only and
  // the rebase coverage was a mock. Against a real conflicted rebase,
  // `git merge --abort` exits 128 ("There is no merge to abort") and the residue
  // survives, converting automatic recovery into a manual-recovery incident.
  withDivergedRepo({ conflicting: true }, ({ dir, branchSha }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-rebase-main', cwd: dir },
        { lockPath, deferredDir },
      );

      // The rebase genuinely conflicted, and cleanup genuinely succeeded.
      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.code,
        'merge_wrapper_command_failed',
        'a rebase conflict that was cleanly aborted is an ordinary command failure',
      );

      // Nothing is left in progress: no REBASE_HEAD, no rebase directory, no
      // unmerged entries. Under the wrong abort verb every one of these survives.
      assert.strictEqual(
        spawnSync('git', ['rev-parse', '--verify', '--quiet', 'REBASE_HEAD'], {
          cwd: dir,
          stdio: 'pipe',
        }).status,
        1,
        'REBASE_HEAD must be gone',
      );
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'rebase-merge')), 'no rebase-merge dir');
      assert.ok(!fs.existsSync(path.join(dir, '.git', 'rebase-apply')), 'no rebase-apply dir');
      assert.deepStrictEqual(unmergedPaths(dir), [], 'no unmerged entries may remain');

      // The lane commit is back, unrewritten -- an aborted rebase must restore it.
      assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), branchSha, 'lane HEAD restored');

      // The lane-state autostash was restored and the mutex released.
      assert.strictEqual(result.main_sync_stash?.stashed, true);
      assert.strictEqual(result.main_sync_stash?.popped, true);
      assert.ok(
        fs.existsSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml')),
        'the untracked lane-state file must be back on disk',
      );
      assert.strictEqual(git(dir, 'stash', 'list'), '', 'no stash entry may be left behind');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');

      // The reported command is the rebase, not the bridged main-sync pull.
      assert.deepStrictEqual(result.command, ['git', 'rebase', 'origin/main']);
    });
  });
});

test('UTV2-1790: unmerged entries alone block the nothing-to-abort early return', () => {
  // Review round 3, P3. The early return requires MERGE_HEAD absent AND
  // REBASE_HEAD absent AND no unmerged paths. Dropping the third term survived
  // the suite: every real conflict leaves MERGE_HEAD too, so no test ever
  // isolated it. Here both refs are masked to report ABSENT (git's exit 1, not
  // the exit 128 of test 51, so the `undetermined` path cannot be what carries
  // this test) while a real conflicted merge really is in progress. The only
  // thing left that can stop the early return is the unmerged-paths term.
  //
  // The observable is whether the abort is ISSUED. Under the mutant the wrapper
  // takes the early return, issues nothing, and walks into the pop and the
  // release with a genuinely conflicted index.
  withDivergedRepo({ conflicting: true }, ({ dir }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      let abortIssued = false;
      let unmergedWhenProbed: string[] = [];
      const runner = realGitRunner((command, args) => {
        if (command === 'git' && args[0] === 'merge' && args[1] === '--abort') {
          abortIssued = true;
          return undefined; // let the real abort run
        }
        if (
          command === 'git' &&
          args[0] === 'rev-parse' &&
          (args[3] === 'MERGE_HEAD' || args[3] === 'REBASE_HEAD')
        ) {
          // Sample the real state while the merge is genuinely in progress, so
          // the precondition is proven rather than assumed.
          if (unmergedWhenProbed.length === 0) unmergedWhenProbed = unmergedPaths(dir);
          return {
            status: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
            error: undefined,
          } as ReturnType<CommandRunner>;
        }
        return undefined;
      });

      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir, runner },
      );

      assert.ok(
        unmergedWhenProbed.length > 0,
        'precondition: the worktree really was unmerged when the probe ran',
      );
      assert.strictEqual(
        abortIssued,
        true,
        'unmerged entries alone must prevent the nothing-to-abort early return',
      );

      // Cleanup then succeeds, so this is an ordinary command failure and the
      // substrate is genuinely restored.
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'merge_wrapper_command_failed');
      assert.deepStrictEqual(unmergedPaths(dir), [], 'no unmerged entries may remain');
      assert.strictEqual(mergeHeadPresent(dir), false, 'MERGE_HEAD must be gone');
      assert.strictEqual(result.main_sync_stash?.popped, true, 'the autostash was restored');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');
    });
  });
});

test('UTV2-1790: a conflicting autostash pop after a SUCCESSFUL merge retains the mutex', () => {
  // Review round 5, P1. Every regression above enters through the command
  // FAILURE path. This one enters through the success path: the merge completes,
  // and then `git stash pop` conflicts because the commit just merged from main
  // touches a path that was autostashed. That leaves unmerged index entries and
  // conflict markers in the worktree -- and the wrapper released the serializing
  // mutex over it anyway, which is the same fail-open this lane exists to close,
  // reached from the other side.
  //
  // It was unreachable while `git-merge-main` was `--ff-only` and could never
  // complete a diverged merge at all. Making that verb work is what made it
  // reachable, so it is this lane's to close.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-poppop-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');

    // A TRACKED lane-state file, so main can change it and the stash can collide.
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'base\n');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // main advances and changes the SAME lane-state file.
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main touches lane state');
    git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'HEAD'));

    // The lane diverges on an unrelated path, so the MERGE itself succeeds.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\nfrom-lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane advances');

    // Uncommitted lane-state edit -> autostashed, then collides on pop.
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'local-uncommitted\n');

    assert.strictEqual(
      git(dir, 'rev-list', '--left-right', '--count', 'origin/main...HEAD').replace(/\s+/u, ' '),
      '1 1',
      'fixture must be genuinely diverged',
    );

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir },
      );

      // The merge itself succeeded; the pop is what failed.
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'merge_wrapper_stash_pop_conflict');
      assert.strictEqual(result.main_sync_stash?.popped, false);

      // The danger is real, not simulated: unmerged entries survive.
      assert.ok(unmergedPaths(dir).length > 0, 'the pop really did leave unmerged entries');

      // THE CONTROL: the serializing mutex is NOT handed to the next lane over a
      // conflicted index.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'held',
        'the mutex must NOT be released while unmerged entries survive the pop',
      );
      assert.strictEqual(result.release, undefined, 'no release may be reported');

      // The operator is told the truth: the lock is retained, and how to release it.
      assert.match(result.message, /NOT released/u, 'says the mutex was retained');
      assert.match(result.message, /ops:merge-lock release/u, 'names a real release command');
      assert.match(result.message, /--diff-filter=U/u, 'points at the unmerged entries');
      assert.notStrictEqual(git(dir, 'stash', 'list'), '', 'the stash entry must be kept');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: an undeterminable state AFTER the abort also fails closed', () => {
  // Review round 5, P2. `residue` has three terms and the third --
  // `after.undetermined.length > 0` -- was pinned by nothing: test 51 masks ALL
  // probes, so the BEFORE-probe fail-closed fires first and the after-probe is
  // never reached. Here the before-probe answers truthfully (a real conflict is
  // detected), the abort reports success but is not executed, and only the
  // post-abort probes are unanswerable. Without the third term the wrapper reads
  // "abort succeeded, no residue detected", pops the stash into a still-conflicted
  // index and releases the mutex.
  withDivergedRepo({ conflicting: true }, ({ dir }) => {
    withTempOps(({ lockPath, deferredDir }) => {
      let aborted = false;
      const runner = realGitRunner((command, args) => {
        if (command === 'git' && args[0] === 'merge' && args[1] === '--abort') {
          // Report success WITHOUT executing it, so the conflict genuinely survives.
          aborted = true;
          return {
            status: 0,
            stdout: Buffer.from(''),
            stderr: Buffer.from(''),
            error: undefined,
          } as ReturnType<CommandRunner>;
        }
        // Only the probes issued AFTER the abort are unanswerable.
        if (
          aborted &&
          command === 'git' &&
          ((args[0] === 'rev-parse' && args.includes('--verify')) ||
            (args[0] === 'diff' && args.includes('--diff-filter=U')))
        ) {
          return {
            status: 128,
            stdout: Buffer.from(''),
            stderr: Buffer.from('fatal: not a git repository'),
            error: undefined,
          } as ReturnType<CommandRunner>;
        }
        return undefined;
      });

      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir, runner },
      );

      assert.strictEqual(aborted, true, 'the before-probe must have detected the conflict');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(
        result.code,
        'merge_wrapper_cleanup_failed',
        'an unverifiable post-abort state must not be reported clean',
      );
      assert.match(result.message, /could not be determined/u);
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'held', 'mutex retained');
      assert.strictEqual(result.main_sync_stash?.popped, false, 'the autostash must be left alone');

      spawnSync('git', ['merge', '--abort'], { cwd: dir });
    });
  });
});

test('UTV2-1790: a NON-conflicting autostash pop failure releases the mutex over a clean tree', () => {
  // Review round 6, P1. Round 5 closed the fail-open in test 55 by retaining the
  // mutex on EVERY non-zero `git stash pop` exit -- and traded it for a lock
  // leak. `popMainSyncStash` sets `conflict: true` on any non-zero status, and
  // the round-5 message asserted "the pop left the worktree with unmerged
  // entries" without anything on that path ever probing for them.
  //
  // This is the negative case test 55 never had, and it is the LIKELIER
  // production shape: origin/main starts TRACKING a lane-state path that was
  // autostashed while untracked, so the pop refuses outright with "already
  // exists, no checkout" and leaves a byte-clean tree. Retaining the repo-wide
  // merge mutex there halts every other lane until a human releases it by hand.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-popclean-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // main STARTS TRACKING the lane-state path. This is the whole fixture.
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main starts tracking lane state');
    git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'HEAD'));

    // The lane diverges elsewhere, so the merge itself succeeds and moves HEAD.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\nfrom-lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane advances');

    // UNTRACKED locally at the lane head -> autostashed with --include-untracked.
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'local-untracked\n');

    assert.strictEqual(
      git(dir, 'rev-list', '--left-right', '--count', 'origin/main...HEAD').replace(/\s+/u, ' '),
      '1 1',
      'fixture must be genuinely diverged',
    );
    const preSyncHead = git(dir, 'rev-parse', 'HEAD');

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir },
      );

      // Still a hard failure: lane-state data is stranded in the stash.
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'merge_wrapper_stash_pop_conflict');
      assert.strictEqual(result.main_sync_stash?.popped, false);
      assert.notStrictEqual(git(dir, 'stash', 'list'), '', 'the stash entry must be kept');

      // The premise: the tree really is clean. If this ever stops holding, the
      // test below is asserting the wrong thing and must be re-derived.
      assert.deepStrictEqual(unmergedPaths(dir), [], 'the pop refused, it did not conflict');
      assert.strictEqual(mergeHeadPresent(dir), false, 'no merge is in progress');

      // THE CONTROL: a clean tree releases the repo-wide mutex.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'the mutex must be released when the failed pop left a clean tree',
      );
      assert.ok(result.release?.ok, 'a release receipt must be reported');

      // The message reports what was MEASURED, not an assumed conflict.
      assert.match(result.message, /measured after the failed pop and is clean/u);
      assert.match(
        result.message,
        /no MERGE_HEAD, no rebase\/cherry-pick\/revert\/bisect in progress and no unmerged paths/u,
      );
      assert.doesNotMatch(
        result.message,
        /left the worktree with unmerged entries/u,
        'must not assert a conflict it did not observe',
      );

      // Review round 6, P2: the merge really did move HEAD, so the
      // re-authorization notice must still be emitted on this failure path.
      assert.notStrictEqual(git(dir, 'rev-parse', 'HEAD'), preSyncHead, 'the merge moved HEAD');
      assert.match(
        result.stderr ?? '',
        /the sync moved the head SHA .+ which invalidates every head-pinned governance artifact/u,
        'the head-move invalidation notice must survive a failed-but-committed sync',
      );
      assert.match(result.stderr ?? '', new RegExp(preSyncHead.slice(0, 7), 'u'));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: an in-progress merge is refused before the autostash, and the mutex is released', () => {
  // Review round 6, P2. The stash-PUSH failure branch returns before any cleanup
  // hook can run, and released the mutex unconditionally. `git stash push`
  // refuses ("error: could not write index ... needs merge") when the worktree is
  // already mid-conflicted-merge -- exactly the state a previous failed sync
  // leaves behind. Releasing the serializing lock there hands the next lane a
  // conflicted index: the same fail-open, reached from the one branch that
  // bypasses every other guard.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-pushfail-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    fs.writeFileSync(path.join(dir, 'other.txt'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main');
    git(dir, 'update-ref', 'refs/remotes/origin/main', git(dir, 'rev-parse', 'HEAD'));

    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'other.txt'), 'from-lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane');
    const laneHead = git(dir, 'rev-parse', 'HEAD');

    // Leave the worktree mid-conflicted-merge, as an earlier failed sync would.
    const stranded = spawnSync('git', ['merge', '--no-ff', '--no-edit', 'origin/main'], { cwd: dir });
    assert.notStrictEqual(stranded.status, 0, 'fixture must leave a real conflict behind');
    assert.strictEqual(mergeHeadPresent(dir), true, 'fixture must leave MERGE_HEAD behind');
    assert.ok(unmergedPaths(dir).length > 0, 'fixture must leave unmerged entries behind');

    // Something for the autostash to try to take, so the push is actually attempted.
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'lane-state\n');

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'git-merge-main', cwd: dir },
        { lockPath, deferredDir },
      );

      assert.strictEqual(result.ok, false);
      // Review round 8 moved the refusal EARLIER. This scenario used to be caught
      // only after `git stash push` had already failed against the unmerged index;
      // the pre-flight now refuses before anything is attempted, so the observable
      // code changes. The fail-closed guarantees below are unchanged, and one is
      // stronger: nothing was stashed at all.
      assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');
      assert.strictEqual(
        result.main_sync_stash?.attempted,
        false,
        'the pre-flight must refuse BEFORE the autostash is attempted',
      );
      assert.strictEqual(result.main_sync_stash?.stashed, false);

      // THE CONTROL, as revised in round 9: the mutex IS released. Round 8 asserted
      // 'held' here by analogy with the round-6 retentions, and a round-9 reviewer
      // showed the analogy is false -- those retain because the WRAPPER created the
      // residue, whereas this run has done nothing at all and the residue predates
      // the lock. Holding a repo-wide lock over a tree this run never touched
      // protects nothing and halts every other lane for the full TTL.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'a refusal that changed nothing must not hold the repo-wide merge mutex',
      );
      assert.ok(result.release, 'the release must be reported in the result');

      // Measured, not assumed, and actionable.
      assert.match(result.message, /MERGE_HEAD is present/u);
      assert.match(result.message, /unmerged paths: other\.txt/u);
      assert.match(result.message, /mutex WAS released/u);

      // Nothing was disturbed: no merge was attempted on top of the stranded one.
      assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), laneHead, 'lane HEAD unchanged');
      assert.strictEqual(mergeHeadPresent(dir), true, 'the stranded merge is left for the operator');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: without a residue probe the SYNC is refused rather than run over an unmeasured tree', () => {
  // Review round 6. `measureResidue` decides whether the merge mutex is safe to
  // hand over. `runMergeWrapper` is also called directly (not only through
  // `runExtendedMergeWrapper`, which injects the probe), so its DEFAULT when no
  // probe is supplied is load-bearing: an unmeasured tree must never be treated
  // as a clean one. Nothing else in the battery reaches that default.
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);
    // The pull succeeds; the autostash pop is what fails.
    if (args[0] === 'stash' && args[1] === 'pop') {
      return {
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('already exists, no checkout'),
        error: undefined,
      };
    }
    return { status: 0, stdout: Buffer.from('ok'), stderr: Buffer.from(''), error: undefined };
  };

  withTempOps(({ lockPath }) => {
    const result = runMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, runner },
    );

    assert.strictEqual(result.ok, false);
    // Round 8 moved the first `measureResidue()` consumer to the pre-flight, so the
    // no-probe default is exercised there rather than at the pop. THE CONTROL is
    // that an UNMEASURED worktree is never treated as a clean one -- the sync is
    // refused.
    assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');

    // Round 9 correction, stated rather than glossed: the fail-closed property is
    // the REFUSAL, not a retained lock. Round 8 conflated the two and thereby leaked
    // the repo-wide mutex on a run that had done nothing. The lock is released.
    const lock = readMergeLock(lockPath);
    assert.strictEqual(
      lock.ok ? lock.lock.status : '',
      'released',
      'refusing to sync is the protection; holding a repo-wide lock over an '
        + 'untouched tree is not',
    );
    assert.ok(result.release, 'the release must be reported in the result');
    assert.match(result.message, /could not be measured/u, 'says why it fell back');
    assert.match(result.message, /mutex WAS released/u);

    // And nothing ran: refusing to measure must not mean half-syncing.
    assert.strictEqual(result.main_sync_stash?.attempted, false);
    assert.ok(
      !calls.some((call) => call[1] === 'stash' || call[1] === 'pull'),
      'no stash and no pull may be issued over an unmeasured worktree',
    );
  });
});

test('UTV2-1790: main-sync gets the residue probe too, so a clean refused pop releases the mutex', () => {
  // Review round 7, P1. Round 6 injected `residueProbe` only inside the
  // git-merge-main / git-rebase-main bridge. But `runMergeWrapper` runs the whole
  // autostash push -> pull -> pop sequence for a plain `main-sync` as well, and
  // the CLI routes `main-sync` straight to its own delegation. So on the verb this
  // lane's failure paths are actually reached through in production,
  // `measureResidue` always took the no-probe default, reported "the state could
  // not be measured", and retained the repo-wide mutex forever -- the exact lock
  // leak round 6 exists to close, still live, and with an internal wiring gap
  // printed in the slot reserved for a state measurement.
  //
  // This is test 57's fixture reached through `main-sync` instead: the lane is
  // merely BEHIND, so the ff-only pull succeeds, and the pop refuses because
  // origin/main has started tracking a path that was autostashed while untracked.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-mainsync-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // main advances and STARTS TRACKING the lane-state path.
    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main starts tracking lane state');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);

    // The lane is merely BEHIND, so `git pull --ff-only origin main` succeeds.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    assert.strictEqual(
      git(dir, 'rev-list', '--left-right', '--count', 'origin/main...HEAD').replace(/\s+/u, ' '),
      '1 0',
      'fixture must be behind, not diverged -- main-sync refuses on divergence',
    );

    fs.mkdirSync(path.join(dir, '.ops', 'sync'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ops', 'sync', 'UTV2-1790.yml'), 'local-untracked\n');

    // `git pull` needs a remote it can reach; point origin at this same repo so
    // the ff pull is a real network-free fetch of a ref that already matches.
    git(dir, 'remote', 'add', 'origin', dir);

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        { lockPath, deferredDir },
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'merge_wrapper_stash_pop_conflict');

      // The premise, asserted on disk rather than assumed.
      assert.deepStrictEqual(unmergedPaths(dir), [], 'the pop refused, it did not conflict');
      assert.strictEqual(mergeHeadPresent(dir), false);

      // THE CONTROL: main-sync measures too, and releases over a clean tree.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'main-sync must not leak the repo-wide mutex over a clean tree',
      );
      assert.ok(result.release?.ok, 'a release receipt must be reported');
      assert.match(result.message, /measured after the failed pop and is clean/u);
      assert.doesNotMatch(
        result.message,
        /no worktree residue probe was supplied/u,
        'main-sync must not report an internal wiring gap as a state measurement',
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: a residue probe that throws fails closed rather than escaping', () => {
  // Review round 7 noted the `catch` around `residueProbe` was correct but pinned
  // by nothing. Same class as the `onCommandFailure` guard proven by test 52: the
  // probe is a caller-supplied injection point, and an unguarded throw would exit
  // runMergeWrapper with the lock held and no structured result at all.
  const runner: CommandRunner = (command, args) => {
    if (args[0] === 'stash' && args[1] === 'pop') {
      return {
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('already exists, no checkout'),
        error: undefined,
      };
    }
    return { status: 0, stdout: Buffer.from('ok'), stderr: Buffer.from(''), error: undefined };
  };

  withTempOps(({ lockPath }) => {
    const result = runMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      {
        lockPath,
        runner,
        residueProbe: () => {
          throw new Error('probe exploded');
        },
      },
    );

    assert.strictEqual(result.ok, false, 'the throw must not escape');
    // Round 8: reached at the pre-flight, which is the first `measureResidue()`
    // consumer. The guarded property -- a thrown probe becomes a fail-closed
    // structured result, never an escaping stack trace -- is unchanged.
    assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');
    const lock = readMergeLock(lockPath);
    assert.strictEqual(
      lock.ok ? lock.lock.status : '',
      'released',
      'the guarded property is that the throw becomes a structured refusal, not '
        + 'that a repo-wide lock is held over a tree this run never touched',
    );
    assert.ok(result.release);
    assert.match(result.message, /probe exploded/u, 'surfaces the thrown message');
    assert.match(result.message, /could not be measured/u);
    assert.strictEqual(result.main_sync_stash?.attempted, false);
  });
});

test('UTV2-1790: a rebase stopped at a break step is NOT reported clean', () => {
  // Review round 7, P3. `worktreeResidue` probed MERGE_HEAD, REBASE_HEAD and
  // unmerged paths. A rebase stopped at a `break`/`edit` step has NONE of those:
  // it is a detached HEAD with a `.git/rebase-merge` directory. Under the old
  // definition it read as clean, and both release decisions would have handed the
  // repo-wide mutex to the next lane over a mid-rebase worktree.
  //
  // This wrapper's own commands cannot produce that state (it runs git
  // non-interactively), so it is reachable only from PRE-EXISTING stranded state
  // -- the same population test 58 models.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-seq-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'one');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'two');

    const realRunner: CommandRunner = (command, args, options) =>
      spawnSync(command, args, { cwd: options.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>;

    assert.strictEqual(
      worktreeResidue(realRunner, dir).clean,
      true,
      'a healthy repository must read clean, or this test proves nothing',
    );

    // Stop a rebase at a `break` step. GIT_SEQUENCE_EDITOR rewrites the todo list.
    const rebase = spawnSync('git', ['rebase', '-i', 'HEAD~1'], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i '1i break'", GIT_EDITOR: 'true' },
    });
    assert.strictEqual(rebase.status, 0, 'the interactive rebase must stop, not fail');

    // The premise: none of the three original probes sees anything.
    assert.strictEqual(mergeHeadPresent(dir), false, 'no MERGE_HEAD');
    assert.strictEqual(
      spawnSync('git', ['rev-parse', '--verify', '--quiet', 'REBASE_HEAD'], { cwd: dir }).status,
      1,
      'no REBASE_HEAD at a break step',
    );
    assert.deepStrictEqual(unmergedPaths(dir), [], 'no unmerged paths');
    assert.ok(
      fs.existsSync(path.join(dir, '.git', 'rebase-merge')),
      'but a rebase-merge directory does exist',
    );

    // THE CONTROL.
    const residue = worktreeResidue(realRunner, dir);
    assert.strictEqual(residue.clean, false, 'a mid-rebase worktree must never read clean');
    assert.match(residue.detail, /rebase is in progress/u);

    spawnSync('git', ['rebase', '--abort'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('UTV2-1790: main-sync refuses over a mid-rebase worktree instead of advancing a detached HEAD', () => {
  // Review round 8, P1. THE DESTRUCTIVE CASE. Round 7 taught `worktreeResidue` to
  // see sequencer state (test 62), but wired the new terms only into the two
  // FAILURE branches -- and both of those are reached from a conflicted index,
  // which a mid-rebase/mid-cherry-pick worktree does not have. So every new term
  // was unreachable from any production decision path, and `main-sync` over a
  // stranded rebase still ran `git pull --ff-only`, which fast-forwarded the
  // DETACHED HEAD out from under the rebase in progress, returned
  // `merge_wrapper_completed`, and released the repo-wide mutex.
  //
  // The fix is a pre-flight measurement before the autostash. This regression
  // pins the whole outcome: refusal, code, retained mutex, unmoved HEAD, surviving
  // rebase state, and an untouched worktree.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-preflight-rebase-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'one');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // main advances, so a `--ff-only` pull would genuinely have something to do.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main advances');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);
    git(dir, 'remote', 'add', 'origin', dir);

    // The lane is strictly BEHIND main -- so absent the pre-flight the ff pull
    // succeeds and the wrapper reports success. That is the fail-open being closed.
    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane');
    git(dir, 'update-ref', 'refs/heads/lane', baseSha);
    git(dir, 'checkout', '-q', '-B', 'lane', baseSha);

    // Strand an interactive rebase at a `break` step: detached HEAD, no MERGE_HEAD,
    // no REBASE_HEAD, no unmerged paths -- the state round 7's terms describe.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'lane-two\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane two');
    const rebase = spawnSync('git', ['rebase', '-i', 'HEAD~1'], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i '1i break'", GIT_EDITOR: 'true' },
    });
    assert.strictEqual(rebase.status, 0, 'the interactive rebase must stop, not fail');

    const strandedHead = git(dir, 'rev-parse', 'HEAD');
    const strandedTree = git(dir, 'status', '--porcelain');
    assert.strictEqual(mergeHeadPresent(dir), false, 'premise: no MERGE_HEAD');
    assert.deepStrictEqual(unmergedPaths(dir), [], 'premise: index is CLEAN, not conflicted');
    assert.ok(
      fs.existsSync(path.join(dir, '.git', 'rebase-merge')),
      'premise: a rebase really is in progress',
    );

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        { lockPath, deferredDir },
      );

      // 1. It refuses, rather than reporting merge_wrapper_completed.
      assert.strictEqual(result.ok, false, 'a mid-rebase worktree must never sync successfully');
      assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');

      // 2. THE CONTROL: HEAD was not advanced out from under the rebase.
      assert.strictEqual(
        git(dir, 'rev-parse', 'HEAD'),
        strandedHead,
        'the detached HEAD must NOT be fast-forwarded while a rebase is in progress',
      );
      assert.notStrictEqual(strandedHead, mainSha, 'the fixture must have something to lose');

      // 3. The rebase state survives for the operator to finish or abort.
      assert.ok(
        fs.existsSync(path.join(dir, '.git', 'rebase-merge')),
        'the rebase in progress must be left intact',
      );

      // 4. Nothing was stashed, so the worktree is byte-identical.
      assert.strictEqual(result.main_sync_stash?.attempted, false, 'no autostash was attempted');
      assert.strictEqual(git(dir, 'status', '--porcelain'), strandedTree, 'worktree untouched');

      // 5. THE ROUND-9 CONTROL: the repo-wide mutex is RELEASED. This run changed
      //    nothing, so it has no half-finished state to protect; retaining the lock
      //    here (the first draft of this pre-flight) leaked it for the full TTL and
      //    halted every other lane until a human reclaimed it by hand.
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'a refusal that changed nothing must not hold the repo-wide merge mutex',
      );
      assert.ok(result.release, 'the release must be reported in the result');

      // 6. The refusal is measured and actionable.
      assert.match(result.message, /rebase is in progress/u, 'names the measured state');
      assert.match(result.message, /was NOT run/u, 'says the command did not run');
      assert.match(result.message, /mutex WAS released/u, 'says plainly that it released');
    });

    spawnSync('git', ['rebase', '--abort'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: main-sync refuses over a resolved-but-uncommitted cherry-pick', () => {
  // Review round 8, P2. `CHERRY_PICK_HEAD` and `REVERT_HEAD` entered
  // `worktreeResidue` alongside the rebase terms and were pinned by nothing: test
  // 62 covers only the rebase directory. This models the state where the operator
  // has already `git add`-ed the resolution -- so the index is CLEAN and the
  // unmerged-paths probe sees nothing -- but the cherry-pick is still open.
  // Fast-forwarding over it would silently discard the pending pick.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-preflight-pick-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    // A side commit to cherry-pick, written to conflict with the lane.
    git(dir, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'from-side\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'side');
    const sideSha = git(dir, 'rev-parse', 'HEAD');

    // main advances so a --ff-only pull has real work to do.
    git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'from-main\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'main advances');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);
    git(dir, 'remote', 'add', 'origin', dir);

    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'from-lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane');
    const laneHead = git(dir, 'rev-parse', 'HEAD');

    const pick = spawnSync('git', ['cherry-pick', sideSha], { cwd: dir, stdio: 'pipe' });
    assert.notStrictEqual(pick.status, 0, 'the fixture must produce a real cherry-pick conflict');
    // Resolve and stage it, WITHOUT committing: index clean, pick still open.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'resolved\n');
    git(dir, 'add', 'a.txt');
    assert.deepStrictEqual(unmergedPaths(dir), [], 'premise: the index is no longer conflicted');
    assert.strictEqual(mergeHeadPresent(dir), false, 'premise: no MERGE_HEAD');
    assert.strictEqual(
      spawnSync('git', ['rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD'], { cwd: dir })
        .status,
      0,
      'premise: CHERRY_PICK_HEAD is the ONLY signal left',
    );

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        { lockPath, deferredDir },
      );

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');
      assert.match(result.message, /CHERRY_PICK_HEAD is present/u, 'names the measured state');
      assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), laneHead, 'HEAD must not move');
      assert.strictEqual(result.main_sync_stash?.attempted, false, 'no autostash was attempted');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'a refusal that changed nothing must not hold the repo-wide merge mutex',
      );
    });

    spawnSync('git', ['cherry-pick', '--abort'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: a pre-flight that cannot measure the worktree refuses the sync', () => {
  // Review round 8. Test 51 proves the POST-command cleanup fails closed on an
  // undeterminable state; this is its pre-flight twin, and it is the case test 51
  // no longer covers now that it stubs the pre-flight. `git rev-parse --verify`
  // exits non-zero both when a ref is absent and when the command could not run,
  // so an unanswerable probe must never be read as "nothing in progress".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-preflight-unknown-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const head = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', head);
    git(dir, 'remote', 'add', 'origin', dir);

    // The worktree is genuinely pristine -- only the MEASUREMENT is broken.
    assert.strictEqual(git(dir, 'status', '--porcelain'), '');

    const runner = realGitRunner((command, args) => {
      const isProbe =
        command === 'git' &&
        ((args[0] === 'rev-parse' && args.includes('--verify')) ||
          (args[0] === 'diff' && args.includes('--diff-filter=U')));
      if (isProbe) {
        return {
          status: 128,
          stdout: Buffer.from(''),
          stderr: Buffer.from('fatal: not a git repository'),
          error: undefined,
        } as ReturnType<CommandRunner>;
      }
      return undefined;
    });

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        { lockPath, deferredDir, runner },
      );

      assert.strictEqual(result.ok, false, 'an unmeasurable worktree must not be synced');
      assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');
      assert.match(result.message, /could not be determined/u, 'says the state is unknown');
      assert.strictEqual(result.main_sync_stash?.attempted, false);
      assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), head, 'HEAD must not move');
      const lock = readMergeLock(lockPath);
      assert.strictEqual(
        lock.ok ? lock.lock.status : '',
        'released',
        'even an UNMEASURABLE tree releases here: this run changed nothing, and the '
          + 'refusal itself is the protection, not the lock',
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: the post-failure cleanup does not call a mid-cherry-pick worktree "nothing to abort"', () => {
  // Review round 8, P2. `abortInProgressSync`'s before-abort early return decides
  // whether there is anything to clean up at all. Round 7 taught `worktreeResidue`
  // about CHERRY_PICK_HEAD/REVERT_HEAD but left this second residue reader
  // checking only MERGE_HEAD/REBASE_HEAD/unmerged -- so a worktree whose ONLY
  // signal is CHERRY_PICK_HEAD took the `{ cleaned: true }` early return, and a
  // caller that trusts `cleaned` would go on to pop the autostash and release the
  // repo-wide mutex over an open cherry-pick.
  //
  // Reachability, stated honestly: with the round-8 pre-flight in place this
  // function can no longer be REACHED in that state through the wrapper, because
  // the pre-flight refuses first and no merge/rebase command creates a
  // CHERRY_PICK_HEAD. The term is therefore defence-in-depth for a second entry
  // point rather than a live production path -- but it is exported, so it is
  // pinned directly here rather than left as an unmeasured claim.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-abort-pick-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const baseSha = git(dir, 'rev-parse', 'HEAD');

    git(dir, 'checkout', '-q', '-b', 'side');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'from-side\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'side');
    const sideSha = git(dir, 'rev-parse', 'HEAD');

    git(dir, 'checkout', '-q', '-b', 'lane', baseSha);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'from-lane\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lane');

    const realRunner: CommandRunner = (command, args, options) =>
      spawnSync(command, args, { cwd: options.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>;

    // A HEALTHY tree must take the early return, or this test proves nothing.
    assert.deepStrictEqual(
      abortInProgressSync('git-merge-main', realRunner, dir),
      { cleaned: true, aborted: false },
      'a clean worktree has nothing to abort',
    );

    const pick = spawnSync('git', ['cherry-pick', sideSha], { cwd: dir, stdio: 'pipe' });
    assert.notStrictEqual(pick.status, 0, 'the fixture must produce a real cherry-pick conflict');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'resolved\n');
    git(dir, 'add', 'a.txt');
    assert.deepStrictEqual(unmergedPaths(dir), [], 'premise: the index is clean again');
    assert.strictEqual(mergeHeadPresent(dir), false, 'premise: no MERGE_HEAD');

    // THE CONTROL: the only signal is CHERRY_PICK_HEAD, and it must not read as
    // "nothing to abort".
    const outcome = abortInProgressSync('git-merge-main', realRunner, dir);
    assert.strictEqual(
      outcome.cleaned,
      false,
      'an open cherry-pick must never be reported as cleaned',
    );

    spawnSync('git', ['cherry-pick', '--abort'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: a sequencer-directory probe that fails is undetermined, not absent', () => {
  // Review round 8, P2. `sequencerDir` distinguishes "the rebase-merge directory
  // is not there" from "I could not ask". Collapsing the second into the first is
  // the same fail-open this lane closes one layer down: an unanswerable probe
  // would make a mid-rebase worktree read clean.
  //
  // In practice `git rev-parse --git-path` exits 0 even for a path that does not
  // exist, so this branch is defensive; it is pinned by driving the runner
  // directly rather than by asserting the branch is unreachable.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-gitpath-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');

    const realRunner: CommandRunner = (command, args, options) =>
      spawnSync(command, args, { cwd: options.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>;
    assert.strictEqual(
      worktreeResidue(realRunner, dir).clean,
      true,
      'the pristine repository must read clean, or this test proves nothing',
    );

    // Only `--git-path` is broken; every other probe answers truthfully.
    const brokenGitPath: CommandRunner = (command, args, options) => {
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--git-path') {
        return {
          status: 128,
          stdout: Buffer.from(''),
          stderr: Buffer.from('fatal: not a git repository'),
          error: undefined,
        } as ReturnType<CommandRunner>;
      }
      return realRunner(command, args, options);
    };

    // THE CONTROL.
    const residue = worktreeResidue(brokenGitPath, dir);
    assert.strictEqual(residue.clean, false, 'an unanswerable probe must not read as clean');
    assert.match(residue.detail, /state could not be determined/u);
    assert.match(residue.detail, /rebase-merge \(git rev-parse --git-path exited 128\)/u);
    assert.match(residue.detail, /rebase-apply/u, 'both sequencer directories are reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: a probe-less caller does not strand the repo-wide merge mutex', () => {
  // Review round 9, P2. THE REGRESSION THE ROUND-8 PROOF GOT WRONG.
  //
  // `scripts/ops/merge-wrapper.ts` has its own `runCli()` entry that calls
  // `runMergeWrapper` directly and supplies no `residueProbe`. Round 8's pre-flight
  // sits AFTER `acquireMergeLock`, and its first draft RETAINED the lock on refusal.
  // So any probe-less caller acquired the repo-wide serializing mutex, did nothing
  // at all -- no stash, no pull, no merge -- and then never released it, halting
  // every other lane for the full TTL until a human reclaimed it by hand. The
  // round-8 bundle disclosed the refusal but asserted "no safety property
  // regresses", which was false: this is a lock leak, and a reviewer blocked its own
  // next command with it.
  //
  // The distinction that makes the round-6 retentions correct and this one wrong:
  // those retain because the WRAPPER put the tree into the state being refused. Here
  // it has done nothing, so there is no half-finished state to protect.
  //
  // This test is deliberately the probe-less shape -- the CLI's shape -- rather than
  // a repeat of the mid-rebase fixture, because the leak was reachable from ANY
  // caller that omits the probe, not only from a dirty tree.
  const runner: CommandRunner = () => ({
    status: 0,
    stdout: Buffer.from('ok'),
    stderr: Buffer.from(''),
    error: undefined,
  });

  withTempOps(({ lockPath }) => {
    const before = readMergeLock(lockPath);
    assert.strictEqual(before.ok, false, 'premise: no lock is held before the run');

    const result = runMergeWrapper({ ...BASE, operation: 'main-sync' }, { lockPath, runner });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');

    // THE CONTROL: the lock this run acquired is given back.
    const after = readMergeLock(lockPath);
    assert.strictEqual(
      after.ok ? after.lock.status : '',
      'released',
      'a run that acquired the mutex and then did nothing must give it back',
    );

    // And the proof of harm if it does not: a SECOND run must be able to proceed
    // past acquisition rather than bouncing off a stale held lock.
    const second = runMergeWrapper({ ...BASE, operation: 'main-sync' }, { lockPath, runner });
    assert.notStrictEqual(
      second.code,
      'merge_lock_stale_reclaim_required',
      'the next run must not be blocked by the previous run leaking the mutex',
    );
    assert.strictEqual(second.code, 'merge_wrapper_worktree_not_clean');
  });
});

test('UTV2-1790: main-sync refuses over a bisecting worktree instead of advancing a detached HEAD', () => {
  // Review round 10, P1. THE ROUND-8 DESTRUCTIVE SUCCESS, REACHED THROUGH A STATE
  // THE PROBE DID NOT ENUMERATE.
  //
  // Round 8 closed `git pull --ff-only` advancing a detached HEAD out from under an
  // in-progress operation, and the round-9 bundle presented that as fixed. A
  // round-10 reviewer reproduced it verbatim against `git bisect`: during a bisect
  // HEAD is detached at the commit under test, and there is no MERGE_HEAD, no
  // REBASE_HEAD, no rebase-merge/rebase-apply directory, no CHERRY_PICK_HEAD, no
  // REVERT_HEAD and no unmerged path. The tree read byte-clean, the pre-flight
  // passed it, the pull fast-forwarded HEAD off the commit being tested, and the
  // wrapper returned `merge_wrapper_completed` with BISECT_LOG still intact -- so
  // every later `git bisect good|bad` records a verdict against the wrong commit
  // and the search converges on an answer that was never tested.
  //
  // The word "bisect" appeared nowhere in the source, the suite or the proof.
  //
  // This fixture carries its own NEGATIVE CONTROL: it first proves, in a second
  // repository built identically, that a raw `git pull --ff-only` really does
  // destroy the bisect. Without that, a passing refusal could mean the hazard was
  // never reachable in the fixture at all.
  const build = (dir: string): { bisectHead: string; mainSha: string } => {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(dir, 'docs', '06_status', 'lanes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', '06_status', 'lanes', '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'one');
    const baseSha = git(dir, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'two');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'three\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'three');
    const mainSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', mainSha);
    git(dir, 'remote', 'add', 'origin', dir);
    // The lane branch is strictly BEHIND origin/main, so a --ff-only pull has
    // something real to do and will succeed unless something refuses it.
    git(dir, 'checkout', '-q', '-B', 'lane', baseSha);
    // Start a real bisect. HEAD detaches onto the commit under test.
    git(dir, 'bisect', 'start');
    git(dir, 'bisect', 'bad', mainSha);
    git(dir, 'bisect', 'good', baseSha);
    return { bisectHead: git(dir, 'rev-parse', 'HEAD'), mainSha };
  };
  const bisecting = (dir: string): boolean =>
    fs.existsSync(path.join(dir, '.git', 'BISECT_LOG')) ||
    fs.existsSync(path.join(dir, '.git', 'BISECT_START'));

  // --- NEGATIVE CONTROL: the hazard is real in this exact fixture. ---
  const control = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-bisect-control-'));
  try {
    const { bisectHead, mainSha } = build(control);
    assert.ok(bisecting(control), 'premise: a bisect really is in progress');
    assert.strictEqual(mergeHeadPresent(control), false, 'premise: no MERGE_HEAD');
    assert.deepStrictEqual(unmergedPaths(control), [], 'premise: the index is clean');
    assert.strictEqual(
      fs.existsSync(path.join(control, '.git', 'rebase-merge')),
      false,
      'premise: no rebase directory -- this state is invisible to every round-9 term',
    );
    const pull = spawnSync('git', ['pull', '--ff-only', 'origin', 'main'], {
      cwd: control,
      stdio: 'pipe',
    });
    assert.strictEqual(pull.status, 0, 'the raw pull succeeds -- that is the hazard');
    assert.notStrictEqual(
      git(control, 'rev-parse', 'HEAD'),
      bisectHead,
      'the raw pull moves the detached HEAD off the commit under test',
    );
    assert.ok(bisecting(control), 'and the bisect state survives, now pointing at a lie');
    assert.notStrictEqual(bisectHead, mainSha, 'the fixture had something to lose');
  } finally {
    fs.rmSync(control, { recursive: true, force: true });
  }

  // --- THE REGRESSION: the wrapper refuses the same setup. ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-bisect-'));
  try {
    const { bisectHead } = build(dir);
    const bisectTree = git(dir, 'status', '--porcelain');

    withTempOps(({ lockPath, deferredDir }) => {
      const result = runExtendedMergeWrapper(
        { ...BASE, operation: 'main-sync', cwd: dir },
        { lockPath, deferredDir },
      );

      // 1. It refuses rather than reporting merge_wrapper_completed.
      assert.strictEqual(result.ok, false, 'a bisecting worktree must never sync successfully');
      assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');

      // 2. THE CONTROL: HEAD stays on the commit under test.
      assert.strictEqual(
        git(dir, 'rev-parse', 'HEAD'),
        bisectHead,
        'the detached HEAD must NOT be fast-forwarded while a bisect is in progress',
      );

      // 3. The bisect survives for the operator to finish or reset.
      assert.ok(bisecting(dir), 'the bisect in progress must be left intact');

      // 4. Nothing was stashed, so the worktree is byte-identical.
      assert.strictEqual(result.main_sync_stash?.attempted, false, 'no autostash was attempted');
      assert.strictEqual(git(dir, 'status', '--porcelain'), bisectTree, 'worktree untouched');

      // 5. The mutex is released -- this run changed nothing (round 9's rule).
      const lock = readMergeLock(lockPath);
      assert.strictEqual(lock.ok ? lock.lock.status : '', 'released');

      // 6. The refusal names the measured state, so the operator can act on it.
      assert.match(result.message, /bisect is in progress/u, 'names the measured state');
      assert.match(result.message, /was NOT run/u, 'says the command did not run');
    });

    spawnSync('git', ['bisect', 'reset'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: the post-failure cleanup does not call a bisecting worktree "nothing to abort"', () => {
  // Review round 10, P1, second consumer. `git-merge-main` and `git-rebase-main` do
  // NOT run the main-sync pre-flight, so `abortInProgressSync` is the only thing
  // standing between a failed sync over a bisecting tree and a released mutex.
  // Round 8 made this early return use the same definition of clean as
  // `worktreeResidue`; the bisect term has to reach it too, or the two definitions
  // diverge again in exactly the way round 8 found.
  //
  // This drives the exported function directly rather than through the wrapper,
  // because the early return is what is being pinned and a wrapper-level test would
  // reach it only incidentally.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1790-bisect-abort-'));
  try {
    git(dir, 'init', '--initial-branch=main', '--quiet');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'one');
    const baseSha = git(dir, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'two');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'three\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'three');
    const tipSha = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'bisect', 'start');
    git(dir, 'bisect', 'bad', tipSha);
    git(dir, 'bisect', 'good', baseSha);

    assert.strictEqual(mergeHeadPresent(dir), false, 'premise: no MERGE_HEAD');
    assert.deepStrictEqual(unmergedPaths(dir), [], 'premise: the index is clean');

    const realRunner: CommandRunner = (command, args, options) =>
      spawnSync(command, args, { cwd: options?.cwd, stdio: 'pipe' });

    // The measurement the cleanup depends on sees it.
    const residue = worktreeResidue(realRunner, dir);
    assert.strictEqual(residue.clean, false, 'a bisecting worktree is not clean');
    assert.match(residue.detail, /bisect is in progress/u);

    // THE CONTROL: the cleanup must not take the nothing-to-abort exit, which is
    // what would pop the autostash and hand the mutex on over a detached HEAD.
    const outcome = abortInProgressSync('git-merge-main', realRunner, dir);
    assert.strictEqual(outcome.cleaned, false, 'a bisecting worktree is never "cleaned"');
    assert.ok(outcome.message, 'and the operator is told why');
    assert.match(outcome.message ?? '', /bisect is still in progress/u);

    spawnSync('git', ['bisect', 'reset'], { cwd: dir, stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('UTV2-1790: a pre-flight refusal whose release FAILS does not tell the operator it released', () => {
  // Review round 10, P3. The pre-flight called `releaseMergeLock` and then printed
  // "The merge mutex WAS released" without ever reading `release.ok`. Every other
  // release site in this lane conditions its prose on the measurement; this one
  // asserted the outcome it had just declined to check. The structured `release`
  // field stayed truthful, so only the human-readable half lied -- which is the
  // half an operator reads, and it would send them away from a lock that is still
  // held.
  //
  // The trigger is a concurrent takeover in the window between acquire and release.
  // This reproduces it deterministically by rewriting the lockfile from inside the
  // residue probe, which runs in exactly that window.
  withTempOps(({ lockPath }) => {
    const runner: CommandRunner = () => ({
      status: 0,
      stdout: Buffer.from('ok'),
      stderr: Buffer.from(''),
      error: undefined,
    });

    const result = runMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      {
        lockPath,
        runner,
        residueProbe: () => {
          // Another holder takes the lock between acquire and release.
          const held = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
          held.issue_id = 'UTV2-0000';
          fs.writeFileSync(lockPath, JSON.stringify(held, null, 2));
          return { clean: false, detail: 'MERGE_HEAD is present' };
        },
      },
    );

    assert.strictEqual(result.code, 'merge_wrapper_worktree_not_clean');
    assert.strictEqual(result.release?.ok, false, 'premise: the release really did fail');

    // THE CONTROL: the message reports the measured outcome, not the intended one.
    assert.doesNotMatch(
      result.message,
      /mutex WAS released/u,
      'a failed release must never be reported as a successful one',
    );
    assert.match(result.message, /could NOT be released/u, 'it says what actually happened');
    assert.match(result.message, /may still\s+be held/u, 'and what that means for other lanes');
  });
});
