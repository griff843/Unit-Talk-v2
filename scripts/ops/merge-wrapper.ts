import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  releaseMergeLock,
  type MergeLockResult,
} from './merge-mutex.js';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  parseArgs,
  relativeToRoot,
  requireIssueId,
} from './shared.js';

export type MergeWrapperOperation =
  | 'pr-merge'
  | 'pr-update-branch'
  | 'main-sync';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergeWrapperInput {
  operation: MergeWrapperOperation;
  issue_id: string;
  branch: string;
  pr?: string | null;
  cwd?: string;
  auto?: boolean;
  merge_method?: MergeMethod;
  ttl_minutes?: number;
  dry_run?: boolean;
}

export interface MergeCommand {
  command: 'gh' | 'git';
  args: string[];
  deferred: boolean;
}

export interface DeferredMergeRecord {
  schema_version: 1;
  issue_id: string;
  branch: string;
  pr: string;
  operation: 'pr-merge';
  merge_method: MergeMethod;
  requested_at: string;
  lock_released: boolean;
  command: string[];
  owner: 'merge-wrapper';
  note: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
) => Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr' | 'error'>;

export type MergeWrapperResult =
  | {
      ok: true;
      code:
        | 'merge_wrapper_completed'
        | 'merge_wrapper_deferred'
        | 'merge_wrapper_dry_run';
      issue_id: string;
      operation: MergeWrapperOperation;
      command: string[];
      lock: MergeLockResult;
      release?: MergeLockResult;
      deferred_record_path?: string;
      stdout?: string;
      stderr?: string;
      main_sync_stash?: MainSyncStashState;
    }
  | {
      ok: false;
      code:
        | 'merge_wrapper_lock_held'
        | 'merge_wrapper_lock_failed'
        | 'merge_wrapper_command_failed'
        | 'merge_wrapper_release_failed'
        | 'merge_wrapper_invalid_input'
        | 'merge_wrapper_stash_failed'
        | 'merge_wrapper_stash_pop_conflict'
        | 'merge_wrapper_authorization_failed'
        // UTV2-1678: `main-sync` used to silently re-invoke itself as
        // `git-rebase-main` when ff-only failed. A caller asking to *sync* got a
        // *history rewrite* -- which moves the head SHA and thereby invalidates
        // every head-pinned governance artifact (pm-verdict, t1-approved
        // evidence, executor-result), and on UTV2-1584 additionally deleted a
        // proof bundle that existed on no other ref. The verb is now the
        // caller's explicit choice and this code is how main-sync says so.
        | 'merge_wrapper_diverged_requires_explicit_sync'
        // UTV2-1678: a sync completed but dropped a governance artifact from the
        // working tree. Reported after the tree has been restored.
        | 'merge_wrapper_sync_dropped_protected_paths'
        // UTV2-1790: the sync command failed AND the post-failure cleanup could
        // not return the worktree to its pre-attempt state -- an in-progress
        // merge/rebase or unmerged index entries are still present. This is the
        // fail-closed code: the mutex is deliberately NOT released and the
        // lane-state autostash is deliberately NOT popped, because both would
        // hand a half-merged worktree to the next caller. It is distinct from
        // `merge_wrapper_command_failed`, which means the command failed and the
        // substrate is clean.
        | 'merge_wrapper_cleanup_failed';
      issue_id?: string;
      operation?: MergeWrapperOperation;
      command?: string[];
      lock?: MergeLockResult;
      release?: MergeLockResult;
      stdout?: string;
      stderr?: string;
      message: string;
      main_sync_stash?: MainSyncStashState;
    };

export const DEFERRED_MERGE_DIR = path.join(ROOT, '.ops', 'deferred-merges');

// `main-sync` runs `git pull --ff-only origin main` directly in the main
// checkout. Lane-start and the shared manifest writers also write untracked
// lane-state files into that SAME checkout (see scripts/ops/lane-start.ts
// writeSyncFile -> .ops/sync/<ISSUE>.yml, and scripts/ops/shared.ts
// writeManifest -> docs/06_status/lanes/<ISSUE>.json). When origin/main picks
// up a committed version of one of those paths (e.g. another lane's manifest
// merged to main), `git pull --ff-only` refuses because it would clobber the
// local untracked file. We scope an autostash to exactly those two path
// prefixes before the pull, and restore it afterward regardless of pull
// outcome, so main-sync never has to choose between failing the pull and
// silently discarding lane-state data.
export const MAIN_SYNC_STASH_PATHS = ['.ops/sync', 'docs/06_status/lanes'];
export const MAIN_SYNC_STASH_MESSAGE = 'ops-merge-wrapper:main-sync:autostash';

// UTV2-1592: mandatory pre-merge authorization gate. `pr-merge` must never
// invoke the actual `gh pr merge` command without first re-evaluating
// required checks and the pm-verdict/v1 approval against the PR's CURRENT
// live head SHA -- a prior lane's incident showed that stale/branch-snapshot
// state can go missing between "the decision was made" and "the merge
// command actually runs".
//
// scripts/ops/pre-merge-authorization.ts does the real (async, live-GitHub)
// evaluation. runMergeWrapper's own public contract is synchronous --
// scripts/ops/ops-merge-wrapper.ts consumes its result synchronously and is
// outside this lane's file scope -- so the gate is invoked here through the
// SAME synchronous CommandRunner abstraction already used for `gh`/`git`
// calls, as a `pnpm exec tsx` subprocess, rather than as an in-process async
// call. This keeps runMergeWrapper's signature unchanged while still doing a
// real, non-reimplemented evaluation for every real invocation.
export const PRE_MERGE_AUTHORIZATION_OWNER = 'griff843';
export const PRE_MERGE_AUTHORIZATION_REPO = 'Unit-Talk-v2';
const PRE_MERGE_AUTHORIZATION_SCRIPT = path.join('scripts', 'ops', 'pre-merge-authorization.ts');

// Bounded timeout for the authorization subprocess (UTV2-1592 amendment).
// The subprocess only does a handful of live GitHub REST round-trips
// (required checks, paginated commit statuses/check-runs, paginated PR
// comments, head SHA) -- 30s is generous headroom above that without
// letting a wedged/hanging subprocess block a merge indefinitely. spawnSync's
// own `timeout` option sends SIGTERM and sets `.error` (ETIMEDOUT) when
// exceeded, which runPreMergeAuthorizationCheck below already treats as a
// fail-closed "could not execute" result.
const PRE_MERGE_AUTHORIZATION_TIMEOUT_MS = 30_000;

export interface PreMergeAuthorizationCheckResult {
  authorized: boolean;
  reason?: string;
}

export interface MainSyncStashState {
  attempted: boolean;
  stashed: boolean;
  popped: boolean;
}

interface StashPushOutcome {
  ok: boolean;
  stashed: boolean;
  stdout: string;
  stderr: string;
  message?: string;
}

interface StashPopOutcome {
  ok: boolean;
  conflict: boolean;
  stdout: string;
  stderr: string;
  message?: string;
}

function stashMainSyncPaths(runner: CommandRunner, cwd: string): StashPushOutcome {
  const run = runner(
    'git',
    [
      'stash',
      'push',
      '--include-untracked',
      '--message',
      MAIN_SYNC_STASH_MESSAGE,
      '--',
      ...MAIN_SYNC_STASH_PATHS,
    ],
    { cwd },
  );
  const stdout = bufferToText(run.stdout);
  const stderr = bufferToText(run.stderr);

  if (run.error || run.status !== 0) {
    return {
      ok: false,
      stashed: false,
      stdout,
      stderr,
      message:
        run.error?.message ??
        `git stash push for main-sync exited with status ${run.status}: ${stderr || stdout}`,
    };
  }

  // `git stash push` prints "No local changes to save" (and creates no stash
  // entry) when the given pathspec has nothing untracked/dirty to stash.
  // Treat that as a no-op rather than as "something was stashed".
  const noop = /no local changes to save/i.test(stdout) || /no local changes to save/i.test(stderr);
  return { ok: true, stashed: !noop, stdout, stderr };
}

function popMainSyncStash(runner: CommandRunner, cwd: string): StashPopOutcome {
  const run = runner('git', ['stash', 'pop'], { cwd });
  const stdout = bufferToText(run.stdout);
  const stderr = bufferToText(run.stderr);

  if (run.error || run.status !== 0) {
    return {
      ok: false,
      conflict: true,
      stdout,
      stderr,
      message:
        `git stash pop failed after main-sync pull, so the autostashed lane-state ` +
        `files (${MAIN_SYNC_STASH_PATHS.join(', ')}) are still stashed and were NOT restored. ` +
        `This usually means the pulled commit now tracks a path that was stashed. ` +
        `Resolve manually: run 'git stash list' to find the ` +
        `"${MAIN_SYNC_STASH_MESSAGE}" entry, inspect the conflict, and run 'git stash pop' ` +
        `(or 'git checkout --theirs'/'git stash drop' as appropriate) by hand. ` +
        `Do not discard the stash without confirming no lane-state data is lost. ` +
        `Underlying error: ${run.error?.message ?? (stderr || stdout || `exit ${run.status}`)}`,
    };
  }

  return { ok: true, conflict: false, stdout, stderr };
}

/**
 * Runs the pre-merge authorization gate for a `pr-merge` operation via the
 * same synchronous CommandRunner used for `gh`/`git` calls (see the
 * PRE_MERGE_AUTHORIZATION_* constants above for why). Fails closed: any
 * transport failure or unparseable/malformed receipt is treated as NOT
 * authorized, never as "skip the check".
 */
export function runPreMergeAuthorizationCheck(
  pr: string,
  runner: CommandRunner,
  cwd: string,
): PreMergeAuthorizationCheckResult {
  const run = runner(
    'pnpm',
    [
      'exec',
      'tsx',
      PRE_MERGE_AUTHORIZATION_SCRIPT,
      '--owner',
      PRE_MERGE_AUTHORIZATION_OWNER,
      '--repo',
      PRE_MERGE_AUTHORIZATION_REPO,
      '--pr',
      pr,
    ],
    { cwd, timeoutMs: PRE_MERGE_AUTHORIZATION_TIMEOUT_MS },
  );

  // Fail closed on any transport-level failure: a thrown error, a signal
  // (including the bounded timeout above firing), or a subprocess spawn
  // failure all surface as `run.error`.
  if (run.error) {
    return {
      authorized: false,
      reason: `pre-merge authorization check failed to execute: ${run.error.message}`,
    };
  }

  const stdout = bufferToText(run.stdout);
  const stderr = bufferToText(run.stderr);

  let receipt: { authorized?: unknown; reason?: unknown } | null = null;
  if (stdout) {
    try {
      receipt = JSON.parse(stdout) as { authorized?: unknown; reason?: unknown };
    } catch {
      receipt = null;
    }
  }

  if (!receipt || typeof receipt.authorized !== 'boolean') {
    return {
      authorized: false,
      reason:
        `pre-merge authorization check produced no valid receipt (exit ${run.status ?? 'unknown'}): ` +
        (stderr || stdout || 'no output'),
    };
  }

  // Fail closed even on an affirmative receipt: pre-merge-authorization.ts's
  // own CLI entry point sets `process.exitCode = receipt.authorized ? 0 : 1`,
  // so those two facts (exit code, receipt.authorized) must always agree. A
  // non-zero exit alongside `authorized: true` can only mean the process
  // crashed, was killed, or was tampered with after printing the receipt --
  // never treat that as "skip the exit-code check because the payload looks
  // fine".
  if (run.status !== 0) {
    return {
      authorized: false,
      reason:
        `pre-merge authorization subprocess exited with non-zero status ${run.status ?? 'unknown'} ` +
        `(receipt reported authorized:${String(receipt.authorized)}); refusing to trust a receipt from a ` +
        `subprocess that did not exit successfully: ${stderr || stdout || 'no output'}`,
    };
  }

  return {
    authorized: receipt.authorized,
    reason: typeof receipt.reason === 'string' ? receipt.reason : undefined,
  };
}

export interface RunAuthorizedPrMergeInput {
  pr: string;
  merge_method?: MergeMethod;
  auto?: boolean;
}

export interface RunAuthorizedPrMergeResult {
  authorized: boolean;
  reason?: string;
  command: MergeCommand;
  run?: Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr' | 'error'>;
}

/**
 * The SOLE path allowed to execute a `pr-merge` command anywhere in this
 * codebase (UTV2-1592 amendment). `runMergeWrapper`'s direct `pr-merge`
 * operation below and merge-train's per-candidate merge step
 * (ops-merge-wrapper.ts's runMergeTrainEntry) both call this function
 * instead of building and running a `gh pr merge` command themselves --
 * that unification is what makes it structurally impossible for either
 * caller to bypass re-authorization. It re-evaluates required checks and
 * the PM verdict against the PR's live head SHA (via
 * runPreMergeAuthorizationCheck) immediately before running the merge
 * command, and never invokes the merge command when authorization is
 * denied.
 */
export function runAuthorizedPrMerge(
  input: RunAuthorizedPrMergeInput,
  runner: CommandRunner,
  cwd: string,
): RunAuthorizedPrMergeResult {
  const pr = requirePr(input.pr);
  const command = buildMergeCommand({
    operation: 'pr-merge',
    issue_id: '',
    branch: '',
    pr,
    merge_method: input.merge_method,
    auto: input.auto,
  });

  const authorization = runPreMergeAuthorizationCheck(pr, runner, cwd);
  if (!authorization.authorized) {
    return {
      authorized: false,
      reason:
        authorization.reason ??
        'pre-merge authorization check rejected this merge; see the authorization receipt for details.',
      command,
    };
  }

  const run = runner(command.command, command.args, { cwd });
  return { authorized: true, command, run };
}

export function buildMergeCommand(input: MergeWrapperInput): MergeCommand {
  switch (input.operation) {
    case 'pr-update-branch':
      return {
        command: 'gh',
        args: ['api', `repos/{owner}/{repo}/pulls/${requirePr(input.pr)}/update-branch`, '-X', 'PUT'],
        deferred: false,
      };
    case 'pr-merge': {
      const method = input.merge_method ?? 'squash';
      return {
        command: 'gh',
        args: [
          'pr',
          'merge',
          requirePr(input.pr),
          `--${method}`,
          ...(input.auto ? ['--auto'] : []),
        ],
        deferred: Boolean(input.auto),
      };
    }
    case 'main-sync':
      return {
        command: 'git',
        args: ['pull', '--ff-only', 'origin', 'main'],
        deferred: false,
      };
    default:
      throw new Error(`Unsupported merge wrapper operation: ${input.operation}`);
  }
}

export function runMergeWrapper(
  input: MergeWrapperInput,
  options: {
    runner?: CommandRunner;
    lockPath?: string;
    deferredDir?: string;
    now?: Date;
    /**
     * UTV2-1790: invoked when the operation's command exits non-zero, BEFORE the
     * lane-state autostash is popped and BEFORE the mutex is released. A failed
     * `git merge` leaves `MERGE_HEAD` and unmerged index entries behind; popping
     * a stash into that tree fails with "needs merge" and releasing the mutex
     * lets another lane acquire the supposedly-serializing lock while this
     * worktree is still inside the previous lane's merge.
     *
     * The hook returns `cleaned: false` when it could not restore the
     * pre-attempt state. That is treated as fail-closed: the pop is skipped, the
     * lock is retained, and `merge_wrapper_cleanup_failed` is returned.
     */
    onCommandFailure?: (ctx: {
      run: ReturnType<CommandRunner>;
      runner: CommandRunner;
      cwd: string;
    }) => { cleaned: boolean; aborted: boolean; message?: string };
  } = {},
): MergeWrapperResult {
  let issueId: string;
  try {
    issueId = requireIssueId(input.issue_id);
    validateInput(input);
  } catch (error) {
    return {
      ok: false,
      code: 'merge_wrapper_invalid_input',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const cwd = path.resolve(input.cwd ?? ROOT);
  const now = options.now ?? new Date();
  const command = buildMergeCommand(input);
  const commandVector = [command.command, ...command.args];
  const lock = acquireMergeLock(
    {
      issue_id: issueId,
      branch: input.branch,
      pr: input.pr ?? null,
      cwd,
      reason: `merge-wrapper:${input.operation}`,
      owner: defaultMergeLockOwner(),
      ttl_ms: (input.ttl_minutes ?? 60) * 60 * 1000,
    },
    { lockPath: options.lockPath, now },
  );

  if (!lock.ok) {
    return {
      ok: false,
      code:
        lock.code === 'merge_lock_held'
          ? 'merge_wrapper_lock_held'
          : 'merge_wrapper_lock_failed',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      message: lock.message,
    };
  }

  if (input.dry_run) {
    const release = releaseMergeLock(
      { issue_id: issueId, branch: input.branch },
      { lockPath: options.lockPath, now },
    );
    return {
      ok: true,
      code: 'merge_wrapper_dry_run',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      release,
    };
  }

  const runner = options.runner ?? defaultRunner;

  // main-sync runs its pull directly in the main checkout, which is the same
  // checkout lane-start/shared writers drop untracked lane-state files into.
  // Autostash exactly those two path prefixes around the pull so a pull that
  // would otherwise be blocked by "untracked files would be overwritten" can
  // proceed, then restore them unconditionally afterward.
  let mainSyncStash: MainSyncStashState | undefined;
  if (input.operation === 'main-sync') {
    const stashPush = stashMainSyncPaths(runner, cwd);
    if (!stashPush.ok) {
      const release = releaseMergeLock(
        { issue_id: issueId, branch: input.branch },
        { lockPath: options.lockPath, now: new Date(now.getTime() + 1) },
      );
      return {
        ok: false,
        code: 'merge_wrapper_stash_failed',
        issue_id: issueId,
        operation: input.operation,
        command: commandVector,
        lock,
        release,
        stdout: stashPush.stdout,
        stderr: stashPush.stderr,
        message:
          stashPush.message ??
          'Failed to stash lane-state paths (.ops/sync, docs/06_status/lanes) before main-sync pull.',
        main_sync_stash: { attempted: true, stashed: false, popped: false },
      };
    }
    mainSyncStash = { attempted: true, stashed: stashPush.stashed, popped: false };
  }

  // UTV2-1592: pr-merge must never invoke the actual merge command without
  // first re-authorizing against the PR's live head SHA. This runs AFTER the
  // lock is held (so the window between authorization and the merge command
  // itself is minimized) but BEFORE the merge command itself is invoked.
  // Routed through the single runAuthorizedPrMerge primitive -- shared with
  // merge-train's per-candidate merge step in ops-merge-wrapper.ts -- so this
  // is the only place in the codebase a `pr-merge` gh command can execute.
  let run: ReturnType<CommandRunner>;
  if (input.operation === 'pr-merge') {
    const authorizedMerge = runAuthorizedPrMerge(
      { pr: requirePr(input.pr), merge_method: input.merge_method, auto: input.auto },
      runner,
      cwd,
    );
    if (!authorizedMerge.authorized || !authorizedMerge.run) {
      const release = releaseMergeLock(
        { issue_id: issueId, branch: input.branch },
        { lockPath: options.lockPath, now: new Date(now.getTime() + 1) },
      );
      return {
        ok: false,
        code: 'merge_wrapper_authorization_failed',
        issue_id: issueId,
        operation: input.operation,
        command: commandVector,
        lock,
        release,
        message:
          authorizedMerge.reason ??
          'pre-merge authorization check rejected this merge; see the authorization receipt for details.',
      };
    }
    run = authorizedMerge.run;
  } else {
    run = runner(command.command, command.args, { cwd });
  }
  const stdout = bufferToText(run.stdout);
  const stderr = bufferToText(run.stderr);

  // UTV2-1790: cleanup runs FIRST -- before the autostash pop and before the
  // release -- so neither of those two steps can ever observe a worktree that is
  // still mid-merge. Ordering is the whole point; see `onCommandFailure`.
  const commandFailed = Boolean(run.error) || run.status !== 0;
  // UTV2-1790 (review round 2): the hook is a caller-supplied injection point, so
  // it can throw. Letting that propagate would exit runMergeWrapper with the lock
  // held, the stash unpopped and NO structured result -- the CLI would never reach
  // emitJson, so the operator would be left with a leaked mutex and a stack trace
  // instead of recovery instructions. A throwing cleanup is treated as a cleanup
  // failure, which is the fail-closed branch and does produce those instructions.
  let cleanup: { cleaned: boolean; aborted: boolean; message?: string } | undefined;
  if (commandFailed && options.onCommandFailure) {
    try {
      cleanup = options.onCommandFailure({ run, runner, cwd });
    } catch (error) {
      cleanup = {
        cleaned: false,
        aborted: false,
        message:
          `The post-failure cleanup hook itself threw, so the worktree state is ` +
          `unknown and cannot be reported clean: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (cleanup && !cleanup.cleaned) {
    // Fail closed. The stash is NOT popped (popping into an unmerged index can
    // only make the tree harder to recover) and the lock is NOT released, so no
    // other lane can enter this worktree. The original command diagnostics are
    // preserved verbatim in stdout/stderr -- the caller still needs to see what
    // the merge actually said, not just what the cleanup said.
    return {
      ok: false,
      code: 'merge_wrapper_cleanup_failed',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      stdout,
      stderr,
      main_sync_stash: mainSyncStash,
      message:
        `${input.operation} failed AND the worktree could not be returned to its ` +
        `pre-attempt state, so the merge mutex was deliberately NOT released and the ` +
        `lane-state autostash was deliberately NOT restored.\n` +
        // UTV2-1790 (review round 2): name the command that actually ran. Sync
        // verbs are bridged through the `main-sync` slot, so `input.operation`
        // and `command` above describe the bridge, not the git invocation that
        // left the residue -- which is the one thing the operator needs.
        `The command that failed was: ${commandVector.join(' ')}\n` +
        `${cleanup.message ?? 'cleanup reported failure without detail.'}\n` +
        `Resolve by hand in ${cwd}: finish or abort the in-progress operation ` +
        `(git merge --abort / git rebase --abort), confirm ` +
        `'git diff --name-only --diff-filter=U' is empty, restore the autostash ` +
        `("${MAIN_SYNC_STASH_MESSAGE}" in 'git stash list')` +
        `${mainSyncStash?.stashed ? '' : ' if one exists'}, then release the lock with ` +
        `'pnpm ops:merge-lock release --issue ${issueId} --branch ${input.branch}'. ` +
        `('pnpm ops:merge-wrapper guard' only ASSERTS the lock is held; it does not ` +
        `release it.)`,
    };
  }

  // Restore the autostash regardless of whether the pull succeeded, so a
  // failed pull never leaves lane-state files stuck in the stash.
  let stashPopFailure: string | undefined;
  if (mainSyncStash?.stashed) {
    const stashPop = popMainSyncStash(runner, cwd);
    if (stashPop.ok) {
      mainSyncStash.popped = true;
    } else {
      stashPopFailure = stashPop.message;
    }
  }

  const release = releaseMergeLock(
    { issue_id: issueId, branch: input.branch },
    { lockPath: options.lockPath, now: new Date(now.getTime() + 1) },
  );

  // A stash-pop conflict means lane-state data is sitting in the stash and
  // may now collide with what was just pulled. Surface it as a hard failure
  // instead of letting the pull's own success/failure mask it, and never
  // drop the stash entry ourselves.
  if (stashPopFailure) {
    return {
      ok: false,
      code: 'merge_wrapper_stash_pop_conflict',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      release,
      stdout,
      stderr,
      message: stashPopFailure,
      main_sync_stash: mainSyncStash,
    };
  }

  if (!release.ok) {
    return {
      ok: false,
      code: 'merge_wrapper_release_failed',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      release,
      stdout,
      stderr,
      message: release.message,
      main_sync_stash: mainSyncStash,
    };
  }

  if (run.error || run.status !== 0) {
    return {
      ok: false,
      code: 'merge_wrapper_command_failed',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      release,
      stdout,
      stderr,
      message: run.error?.message ?? `Command exited with status ${run.status}`,
      main_sync_stash: mainSyncStash,
    };
  }

  if (command.deferred) {
    const recordPath = writeDeferredMergeRecord(
      {
        issue_id: issueId,
        branch: input.branch,
        pr: requirePr(input.pr),
        merge_method: input.merge_method ?? 'squash',
        requested_at: now.toISOString(),
        command: commandVector,
      },
      options.deferredDir,
    );
    return {
      ok: true,
      code: 'merge_wrapper_deferred',
      issue_id: issueId,
      operation: input.operation,
      command: commandVector,
      lock,
      release,
      deferred_record_path: relativeToRoot(recordPath),
      stdout,
      stderr,
      main_sync_stash: mainSyncStash,
    };
  }

  return {
    ok: true,
    code: 'merge_wrapper_completed',
    issue_id: issueId,
    operation: input.operation,
    command: commandVector,
    lock,
    release,
    stdout,
    stderr,
    main_sync_stash: mainSyncStash,
  };
}

export function writeDeferredMergeRecord(
  input: {
    issue_id: string;
    branch: string;
    pr: string;
    merge_method: MergeMethod;
    requested_at: string;
    command: string[];
  },
  deferredDir = DEFERRED_MERGE_DIR,
): string {
  const record: DeferredMergeRecord = {
    schema_version: 1,
    issue_id: input.issue_id,
    branch: input.branch,
    pr: input.pr,
    operation: 'pr-merge',
    merge_method: input.merge_method,
    requested_at: input.requested_at,
    lock_released: true,
    command: input.command,
    owner: 'merge-wrapper',
    note:
      'Auto-merge was requested and the merge mutex was released. Reconciler or closeout must verify final merge truth.',
  };
  ensureDir(deferredDir);
  const recordPath = path.join(deferredDir, `${input.issue_id}.json`);
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return recordPath;
}

function validateInput(input: MergeWrapperInput): void {
  if (!input.operation) throw new Error('Missing required operation');
  if (!input.branch) throw new Error('Missing required branch');
  if ((input.operation === 'pr-merge' || input.operation === 'pr-update-branch') && !input.pr) {
    throw new Error(`Operation ${input.operation} requires --pr`);
  }
  if (input.merge_method && !['merge', 'squash', 'rebase'].includes(input.merge_method)) {
    throw new Error(`Invalid merge method: ${input.merge_method}`);
  }
}

function requirePr(pr: string | null | undefined): string {
  const value = pr?.trim();
  if (!value) {
    throw new Error('Missing required --pr');
  }
  return value;
}

function defaultRunner(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr' | 'error'> {
  return spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'pipe',
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
}

export function bufferToText(value: Buffer | string | null | undefined): string {
  if (!value) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8').trim() : value.trim();
}

function cliInput(argv: string[]): MergeWrapperInput {
  const { positionals, flags, bools } = parseArgs(argv);
  return {
    operation: (positionals[0] ?? '') as MergeWrapperOperation,
    issue_id: getFlag(flags, 'issue') ?? '',
    branch: getFlag(flags, 'branch') ?? '',
    pr: getFlag(flags, 'pr') ?? null,
    cwd: getFlag(flags, 'cwd') ?? ROOT,
    auto: bools.has('auto'),
    dry_run: bools.has('dry-run'),
    merge_method: (getFlag(flags, 'method') ?? 'squash') as MergeMethod,
    ttl_minutes: getFlag(flags, 'ttl-minutes')
      ? Number.parseInt(getFlag(flags, 'ttl-minutes') ?? '', 10)
      : undefined,
  };
}

function runCli(): void {
  const result = runMergeWrapper(cliInput(process.argv.slice(2)));
  emitJson(result);
  process.exitCode = result.ok ? 0 : 1;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
