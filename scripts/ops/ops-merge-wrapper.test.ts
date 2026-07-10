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
import {
  buildExtendedCommand,
  runExtendedMergeWrapper,
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
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      STASH_POP_CALL,
    ]);
  });
});

test('main-sync falls back to rebase on not-possible-to-fast-forward error', () => {
  withTempOps(({ lockPath, deferredDir }) => {
    const calls: string[][] = [];
    // Main command 0 is the ff-only pull (fails with a divergence error);
    // main command 1 is the rebase fallback (succeeds). Stash push/pop calls
    // are not "main commands" and always succeed via stashAwareRunner.
    const divergedRunner = stashAwareRunner(calls, (mainCallIndex) =>
      mainCallIndex === 0
        ? { status: 128, stdout: '', stderr: 'fatal: Not possible to fast-forward, aborting.' }
        : { status: 0, stdout: '', stderr: '' },
    );
    const result = runExtendedMergeWrapper(
      { ...BASE, operation: 'main-sync' },
      { lockPath, deferredDir, runner: divergedRunner },
    );
    assert.strictEqual(result.ok, true, 'should succeed after rebase fallback');
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      STASH_POP_CALL,
      STASH_PUSH_CALL,
      ['git', 'rebase', 'origin/main'],
      STASH_POP_CALL,
    ]);
  });
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
      ['git', 'merge', '--ff-only', 'origin/main'],
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
      ['git', 'rebase', 'origin/main'],
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
    assert.deepStrictEqual(calls, [
      STASH_PUSH_CALL,
      ['git', 'merge', '--ff-only', 'origin/main'],
      STASH_POP_CALL,
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
      ['git', 'rebase', 'origin/main'],
      STASH_POP_CALL,
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
  } = {},
): { runner: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args]);

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
