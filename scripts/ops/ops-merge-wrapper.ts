/**
 * ops-merge-wrapper — mandatory merge mutex CLI (UTV2-1061)
 *
 * This is the canonical entrypoint for all merge and branch-refresh
 * operations. It extends merge-wrapper.ts to cover every raw command
 * that can bypass the mutex:
 *
 *   BLOCKED raw commands (must use this wrapper instead):
 *     gh pr merge <pr>            → ops-merge-wrapper pr-merge   --issue <id> --branch <b> --pr <pr>
 *     gh pr update-branch <pr>    → ops-merge-wrapper pr-update-branch --issue <id> --branch <b> --pr <pr>
 *     git pull origin main        → ops-merge-wrapper main-sync  --issue <id> --branch <b>
 *     git merge origin/main       → ops-merge-wrapper git-merge-main --issue <id> --branch <b>
 *     git rebase origin/main      → ops-merge-wrapper git-rebase-main --issue <id> --branch <b>
 *
 * The wrapper acquires the merge mutex before every operation and fails
 * closed when another unexpired lock exists. The lock is always released
 * on completion (including failure). Deferred auto-merge state is recorded
 * and ownership is transferred to the reconciler/closeout actor.
 *
 * Usage:
 *   pnpm ops:merge-wrapper <operation> --issue UTV2-### --branch <branch> [--pr <pr>] [--method squash|merge|rebase] [--auto] [--dry-run]
 *   pnpm ops:merge-wrapper guard       --issue UTV2-### --branch <branch>       # assert lock is held by this issue
 *
 * merge-train (UTV2-1467, Design B — batched-merge protocol):
 *   pnpm ops:merge-wrapper merge-train --candidates-file <path.json> [--method squash]
 *     [--ttl-minutes 60] [--timeout-minutes 15] [--poll-seconds 15] [--dry-run]
 *
 *   <path.json> is a JSON array of `{ "issue_id": "UTV2-###", "branch": "...", "pr": "123" }`,
 *   already ordered by the caller (this wrapper has no lane-type awareness).
 *   Drains the batch serially and immediately under a single mutex hold —
 *   see docs/05_operations/UTV2-1461-merge-queue-decision-packet.md §3 and
 *   docs/05_operations/WORKFLOW_SPEC.md's "Merge mechanics" section.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  type MergeWrapperInput,
  type MergeWrapperResult,
  type MergeWrapperOperation,
  type MergeMethod,
  type CommandRunner,
  buildMergeCommand,
  bufferToText,
  runAuthorizedPrMerge,
  runMergeWrapper,
} from './merge-wrapper.js';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  releaseMergeLock,
  requireMergeLockHeld,
  type MergeLockResult,
} from './merge-mutex.js';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  requireIssueId,
} from './shared.js';

export type ExtendedMergeWrapperOperation =
  | MergeWrapperOperation
  | 'git-merge-main'
  | 'git-rebase-main';

export type { MergeWrapperInput, MergeWrapperResult, CommandRunner };
export { buildMergeCommand, runAuthorizedPrMerge, runMergeWrapper };

/** All raw shell forms that must NOT be called directly */
export const BLOCKED_RAW_COMMANDS: readonly string[] = [
  'gh pr merge',
  'gh pr update-branch',
  'git pull origin main',
  'git merge origin/main',
  'git rebase origin/main',
];

/**
 * Build the shell command vector for the extended operation set.
 *
 * `git-merge-main` and `git-rebase-main` are the mutex-guarded
 * equivalents of the otherwise-forbidden raw commands.
 */
export function buildExtendedCommand(
  operation: ExtendedMergeWrapperOperation,
  input: Pick<MergeWrapperInput, 'pr' | 'merge_method' | 'auto'>,
): { command: 'git' | 'gh'; args: string[]; deferred: boolean } {
  switch (operation) {
    case 'git-merge-main':
      // UTV2-1790: this was `--ff-only`, which cannot merge a diverged branch
      // by definition -- so the one verb `main-sync` recommends *for* a
      // diverged branch ("preserves history and SHAs") failed on exactly the
      // condition it exists for. Both sanctioned exits dead-ended and the only
      // operable verb left was `git-rebase-main`, which rewrites history and
      // moves the head SHA, invalidating pm-verdict, t1-approved evidence and
      // executor-result. UTV2-1678 removed the *silent* rebase substitution;
      // leaving this unusable reintroduced the same risk by omission.
      //
      // `--no-ff` always records a merge commit: existing commit SHAs on both
      // sides are preserved byte-for-byte and nothing is replayed. It is also
      // deliberately not a bare `git merge` -- on a branch that happens to be
      // merely behind, a bare merge would fast-forward and silently move the
      // branch with no merge commit, making the operation's effect depend on
      // divergence state. `--no-ff` behaves identically in both cases.
      //
      // `--no-edit` keeps it noninteractive: without it `git merge --no-ff`
      // opens $GIT_EDITOR for the merge commit message, and this runs under
      // spawnSync with piped stdio, where an editor cannot be driven and the
      // call would hang or fail depending on the configured editor.
      return {
        command: 'git',
        args: ['merge', '--no-ff', '--no-edit', 'origin/main'],
        deferred: false,
      };
    case 'git-rebase-main':
      return {
        command: 'git',
        args: ['rebase', 'origin/main'],
        deferred: false,
      };
    default:
      return buildMergeCommand({ ...input, operation } as MergeWrapperInput);
  }
}

/**
 * UTV2-1678 — paths whose loss during a sync is never acceptable.
 *
 * A lane's proof bundle and manifest frequently exist ONLY on that lane's
 * branch: they are created at ops:lane-start and do not reach `main` until the
 * lane merges. `main` therefore holds no copy to recover from, which is exactly
 * how UTV2-1584's evidence.json / model-routing.json / verification.md were lost
 * permanently. Dropping one of these is refused; anything else is reported.
 */
export const PROTECTED_SYNC_PATH_PREFIXES: readonly string[] = [
  'docs/06_status/proof/',
  'docs/06_status/lanes/',
];

export interface DroppedPathClassification {
  /** Paths present before the sync and absent after it. */
  dropped: string[];
  /** The subset under a protected prefix — refusal-worthy. */
  protectedPaths: string[];
  /** The remainder — warn only. */
  otherPaths: string[];
}

/**
 * Compare the branch-only file set before and after a sync.
 *
 * `before` and `after` are the outputs of `git diff --name-only origin/main...<pre-sync-head>`
 * and `git diff --name-only origin/main..HEAD`. Anything in `before` and not in
 * `after` was dropped by the sync.
 *
 * Pure by construction so the classification can be tested without a git
 * fixture; the caller owns actually running the two diffs.
 */
export function classifyDroppedPaths(
  before: readonly string[],
  after: readonly string[],
): DroppedPathClassification {
  const afterSet = new Set(after.map((p) => p.trim()).filter(Boolean));
  const dropped = [
    ...new Set(
      before
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => !afterSet.has(p)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const protectedPaths = dropped.filter((p) =>
    PROTECTED_SYNC_PATH_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
  const otherPaths = dropped.filter((p) => !protectedPaths.includes(p));
  return { dropped, protectedPaths, otherPaths };
}

/**
 * UTV2-1678 criterion 5 — the governance artifacts a head-SHA move invalidates.
 *
 * Every one of these is head-pinned, so the invalidation is a deterministic
 * consequence of the SHA changing; it does not require reading GitHub to know
 * it happened. Fetching the specific comment URLs would add precision, not
 * correctness, and is deliberately not a prerequisite — silence here is what
 * turned a routine sync into an invisible governance regression.
 *
 * The order is the required re-authorization order, not a list: verify must
 * complete before a fresh EXECUTOR_RESULT is posted, and the pm-verdict must
 * come last, or it certifies a head that is already stale.
 */
export const HEAD_MOVE_REAUTHORIZATION_ORDER: readonly string[] = [
  'Re-run `pnpm verify` on the new head and let CI settle.',
  'Re-post the EXECUTOR_RESULT comment pinned to the NEW head SHA (the previous one is bound to a dead SHA).',
  'Re-apply the `t1-approved` label if this is a T1 lane — its evidence was bound to the old head.',
  'Request a fresh pm-verdict/v1 APPROVED comment LAST, so it certifies the head that will actually merge.',
];

export interface HeadMoveInvalidation {
  headMoved: boolean;
  previousHead: string;
  currentHead: string;
  invalidatedArtifacts: string[];
  reauthorizationOrder: readonly string[];
}

/**
 * Report which head-pinned governance artifacts a sync just invalidated.
 * `headMoved: false` (a true fast-forward, or no movement) invalidates nothing.
 */
export function buildHeadMoveInvalidation(
  previousHead: string,
  currentHead: string,
): HeadMoveInvalidation {
  const headMoved = Boolean(previousHead) && Boolean(currentHead) && previousHead !== currentHead;
  return {
    headMoved,
    previousHead,
    currentHead,
    invalidatedArtifacts: headMoved
      ? [
          'pm-verdict/v1 APPROVED comment (its `Head SHA:` field no longer matches)',
          't1-approved label (its evidence is bound to the previous head)',
          'EXECUTOR_RESULT comment (pinned to the previous head SHA)',
        ]
      : [],
    reauthorizationOrder: headMoved ? HEAD_MOVE_REAUTHORIZATION_ORDER : [],
  };
}

/**
 * True when a merge-wrapper failure is specifically git refusing a
 * non-fast-forwardable pull, as opposed to any other command failure.
 *
 * UTV2-1678: exported so the divergence-refusal path can be asserted directly.
 * A failure that is NOT this must keep its original code — conflating "diverged"
 * with "everything else" would let an unrelated git error present itself as a
 * routine divergence and invite the caller to re-run with a rewriting verb.
 */
export function isNotFastForwardFailure(result: MergeWrapperResult): boolean {
  if (result.ok) return false;
  if (result.code !== 'merge_wrapper_command_failed') return false;
  const stderr = result.stderr ?? '';
  return (
    stderr.includes('not possible to fast-forward') ||
    stderr.includes('Cannot fast-forward') ||
    stderr.includes('fatal: Not possible to fast-forward')
  );
}

interface SyncResidue {
  mergeHead: boolean;
  rebaseHead: boolean;
  cherryPickHead: boolean;
  revertHead: boolean;
  unmerged: string[];
  undetermined: string[];
}

/**
 * UTV2-1790 (review round 2): a probe that cannot DETERMINE the state must never
 * be read as "clean".
 *
 * `git rev-parse --verify --quiet MERGE_HEAD` exits non-zero both when the ref is
 * absent and when the command could not run at all (a broken repository, a
 * permissions failure, git missing). Collapsing those two into `false`
 * reintroduces the very fail-open the cleanup path exists to close: an
 * undeterminable tree takes the "nothing to abort" early return, the autostash is
 * popped into a possibly-unmerged index and the mutex is released.
 * `undetermined` is therefore tracked separately and always forces fail-closed.
 *
 * Round 5 hoisted this out of `abortInProgressSync` so the release decisions on
 * the stash-push and stash-pop failure paths can ask the same question, rather
 * than asserting an answer they never measured (review round 6, P1).
 */
function probeSyncResidue(runner: CommandRunner, cwd: string): SyncResidue {
  const undetermined: string[] = [];
  const ref = (name: string): boolean => {
    const r = runner('git', ['rev-parse', '--verify', '--quiet', name], { cwd });
    // Absent ref: status 1 and no output. Anything else non-zero -- notably
    // git's fatal exit 128 -- means the question was not answered.
    if (r.error || (r.status !== 0 && r.status !== 1)) {
      undetermined.push(`${name} (git rev-parse exited ${r.status ?? 'with an error'})`);
      return false;
    }
    return r.status === 0;
  };
  const sequencerDir = (name: string): boolean => {
    const r = runner('git', ['rev-parse', '--git-path', name], { cwd });
    if (r.error || r.status !== 0) {
      undetermined.push(`${name} (git rev-parse --git-path exited ${r.status ?? 'with an error'})`);
      return false;
    }
    const rel = bufferToText(r.stdout).trim();
    if (!rel) {
      undetermined.push(`${name} (git rev-parse --git-path returned no path)`);
      return false;
    }
    return fs.existsSync(path.isAbsolute(rel) ? rel : path.join(cwd, rel));
  };
  const mergeHead = ref('MERGE_HEAD');
  // UTV2-1790 (review round 7, P3): a rebase stopped at a `break`/`edit` step has
  // NO REBASE_HEAD, no MERGE_HEAD and no unmerged paths -- it is a detached HEAD
  // with a `.git/rebase-merge` directory. A conflict resolved with `git add` but
  // not committed leaves CHERRY_PICK_HEAD or REVERT_HEAD and nothing else. All
  // three read as "clean" under a MERGE_HEAD/REBASE_HEAD/unmerged sweep, so the
  // release decisions would hand the repo-wide mutex to the next lane over a
  // worktree that is mid-sequencer. This wrapper's own commands cannot produce
  // those states (it runs git non-interactively), so they are reachable only from
  // PRE-EXISTING stranded state -- which is exactly the population the stash-push
  // failure path exists to catch.
  const rebaseHead =
    ref('REBASE_HEAD') || sequencerDir('rebase-merge') || sequencerDir('rebase-apply');
  const cherryPickHead = ref('CHERRY_PICK_HEAD');
  const revertHead = ref('REVERT_HEAD');
  const unmergedRun = runner('git', ['diff', '--name-only', '--diff-filter=U'], { cwd });
  let unmerged: string[] = [];
  if (unmergedRun.error || unmergedRun.status !== 0) {
    undetermined.push(`unmerged paths (git diff exited ${unmergedRun.status ?? 'with an error'})`);
  } else {
    unmerged = bufferToText(unmergedRun.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return { mergeHead, rebaseHead, cherryPickHead, revertHead, unmerged, undetermined };
}

/**
 * UTV2-1790 (review round 6): report whether the worktree is safe to hand to the
 * next lane, as a MEASUREMENT rather than an assumption.
 *
 * Round 5 retained the merge mutex on any `git stash pop` failure and justified it
 * with the words "the pop left the worktree with unmerged entries" -- text that
 * nothing on that path had probed for. The most likely production failure is the
 * opposite: `git stash pop` exits 1 with "already exists, no checkout" when
 * origin/main starts TRACKING a lane-state path that was autostashed while
 * untracked, and that leaves a byte-clean tree. Retaining the repo-wide merge
 * mutex there halts every lane until a human releases it by hand.
 */
export function worktreeResidue(
  runner: CommandRunner,
  cwd: string,
): { clean: boolean; detail: string } {
  const r = probeSyncResidue(runner, cwd);
  const parts: string[] = [];
  if (r.mergeHead) parts.push('MERGE_HEAD is present');
  if (r.rebaseHead) parts.push('a rebase is in progress (REBASE_HEAD or a rebase-merge/rebase-apply directory)');
  if (r.cherryPickHead) parts.push('CHERRY_PICK_HEAD is present');
  if (r.revertHead) parts.push('REVERT_HEAD is present');
  if (r.unmerged.length > 0) parts.push(`unmerged paths: ${r.unmerged.join(', ')}`);
  if (r.undetermined.length > 0) {
    parts.push(`state could not be determined: ${r.undetermined.join('; ')}`);
  }
  return {
    clean: parts.length === 0,
    detail:
      parts.length === 0
        ? 'no MERGE_HEAD, no rebase/cherry-pick/revert in progress and no unmerged paths'
        : parts.join('; '),
  };
}

/**
 * UTV2-1790: return the worktree to its pre-attempt state after a failed
 * `git-merge-main` / `git-rebase-main`.
 *
 * A conflicted `git merge` exits non-zero and leaves `MERGE_HEAD` plus unmerged
 * index entries in place. If the wrapper then pops its lane-state autostash and
 * releases the merge mutex -- which is what it did before this function existed
 * -- the pop fails with "needs merge" and the next lane acquires a mutex that is
 * supposed to serialize merges while this worktree is still inside the previous
 * lane's. Every subsequent wrapper run also fails until a human aborts by hand.
 *
 * Fail-closed by construction: `cleaned` is true only when the abort command
 * itself succeeded AND a fresh probe shows no `MERGE_HEAD`, no `REBASE_HEAD` and
 * no unmerged paths. A dirty tree we could not clean is never reported as clean.
 */
export function abortInProgressSync(
  operation: 'git-merge-main' | 'git-rebase-main',
  runner: CommandRunner,
  cwd: string,
): { cleaned: boolean; aborted: boolean; message?: string } {
  const before = probeSyncResidue(runner, cwd);
  if (before.undetermined.length > 0) {
    // Fail closed: we do not know whether anything is in progress, so we may not
    // claim the tree is clean, and we must not guess by firing a blind --abort.
    return {
      cleaned: false,
      aborted: false,
      message:
        `Could not determine the worktree state after the failed ${operation}, so it ` +
        `cannot be reported clean: ${before.undetermined.join('; ')}.`,
    };
  }
  // UTV2-1790 (review round 8, P2): this early return must use the SAME definition
  // of "clean" as `worktreeResidue` and as the post-abort `residue` below. Round 7
  // added `cherryPickHead`/`revertHead` to both of those and not to this one, so a
  // failed merge over a resolved-but-uncommitted cherry-pick took the
  // nothing-to-abort exit, the autostash was popped and the mutex released over a
  // mid-cherry-pick worktree -- the exact fail-open round 7 said it had closed.
  if (
    !before.mergeHead &&
    !before.rebaseHead &&
    !before.cherryPickHead &&
    !before.revertHead &&
    before.unmerged.length === 0
  ) {
    // The command failed without starting anything -- e.g. `git merge` refused
    // up front. There is nothing to abort and nothing left behind.
    return { cleaned: true, aborted: false };
  }

  const verb = operation === 'git-rebase-main' ? 'rebase' : 'merge';
  const abort = runner('git', [verb, '--abort'], { cwd });
  const abortOk = !abort.error && abort.status === 0;
  const after = probeSyncResidue(runner, cwd);
  const residue =
    after.mergeHead ||
    after.rebaseHead ||
    after.cherryPickHead ||
    after.revertHead ||
    after.unmerged.length > 0 ||
    after.undetermined.length > 0;

  if (abortOk && !residue) {
    return { cleaned: true, aborted: true };
  }

  const detail: string[] = [];
  if (!abortOk) {
    detail.push(
      `git ${verb} --abort exited ${abort.status ?? 'with an error'}: ` +
        `${abort.error?.message ?? (bufferToText(abort.stderr) || bufferToText(abort.stdout) || '(no output)')}`,
    );
  }
  if (after.mergeHead) detail.push('MERGE_HEAD is still present');
  if (after.rebaseHead) detail.push('a rebase is still in progress');
  if (after.cherryPickHead) detail.push('CHERRY_PICK_HEAD is still present');
  if (after.revertHead) detail.push('REVERT_HEAD is still present');
  if (after.unmerged.length > 0) {
    detail.push(`unmerged paths remain: ${after.unmerged.join(', ')}`);
  }
  if (after.undetermined.length > 0) {
    detail.push(`state could not be determined: ${after.undetermined.join('; ')}`);
  }
  return {
    cleaned: false,
    aborted: false,
    message: `Could not clean up the failed ${operation}: ${detail.join('; ')}.`,
  };
}

/**
 * Run an extended merge wrapper operation through the merge mutex.
 *
 * For the base operations (pr-merge, pr-update-branch, main-sync),
 * delegates directly to `runMergeWrapper`. For git-merge-main and
 * git-rebase-main, acquires the mutex, runs the git command, and
 * always releases on completion or failure.
 *
 * UTV2-1678: `main-sync` never substitutes a different git verb. On a diverged
 * branch it refuses with `merge_wrapper_diverged_requires_explicit_sync` and
 * performs no mutation; the caller names `git-merge-main` or `git-rebase-main`.
 */
export function runExtendedMergeWrapper(
  input: Omit<MergeWrapperInput, 'operation'> & {
    operation: ExtendedMergeWrapperOperation;
  },
  options: Parameters<typeof runMergeWrapper>[1] = {},
): MergeWrapperResult {
  // UTV2-1790 (review round 7, P1): the probe belongs to EVERY delegation, not
  // just the bridged sync verbs.
  //
  // Round 6 injected `residueProbe` only inside the `git-merge-main` /
  // `git-rebase-main` bridge. But `runMergeWrapper` runs the whole autostash
  // push -> pull -> pop sequence for a plain `main-sync` too, and the CLI routes
  // `main-sync` straight to the delegation below. So on the lane's own headline
  // verb `measureResidue` always took the no-probe default, reported "could not
  // be measured", and retained the mutex forever -- the exact lock leak round 6
  // exists to close, still live, and with an operator message that reports an
  // internal wiring gap in the slot reserved for a state measurement.
  //
  // Bound here once, so a delegation added later cannot silently miss it.
  const optionsWithProbe: Parameters<typeof runMergeWrapper>[1] = {
    ...options,
    residueProbe:
      options.residueProbe ??
      (({ cwd: probeCwd }) =>
        worktreeResidue(
          options.runner ??
            ((c: string, a: string[], o: { cwd: string }) =>
              spawnSync(c, a, { cwd: o.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>),
          probeCwd,
        )),
  };

  if (input.operation === 'main-sync') {
    const ffResult = runMergeWrapper(input as MergeWrapperInput, optionsWithProbe);
    if (ffResult.ok) return ffResult;
    // UTV2-1678: this branch used to re-invoke itself as `git-rebase-main`.
    //
    // That made `main-sync` change VERB on failure: the caller asked to sync and
    // silently got a history rewrite, with no prompt, no distinct exit code, and
    // no field in the result recording the substitution. Because pm-verdict,
    // `t1-approved` evidence and executor-result are all head-pinned, moving the
    // head SHA invalidates every one of them -- so the operation most likely to
    // be run on an APPROVED branch was the one that destroyed its approval. On
    // UTV2-1584 it also collapsed 87 commits and deleted a proof bundle that
    // existed on no other ref.
    //
    // `git-merge-main` and `git-rebase-main` both remain directly callable.
    // Nothing is lost; the choice simply becomes the caller's, and is recorded.
    if (!isNotFastForwardFailure(ffResult)) return ffResult;
    return {
      ok: false,
      code: 'merge_wrapper_diverged_requires_explicit_sync',
      issue_id: input.issue_id,
      operation: 'main-sync',
      command: ffResult.command,
      lock: ffResult.lock,
      release: ffResult.release,
      stdout: ffResult.stdout,
      stderr: ffResult.stderr,
      main_sync_stash: ffResult.main_sync_stash,
      message:
        `Branch "${input.branch}" has diverged from origin/main, so a fast-forward sync is not possible. ` +
        'main-sync will not choose a history-rewriting verb on your behalf (UTV2-1678). ' +
        'Re-run naming the verb explicitly:\n' +
        `  pnpm ops:merge-wrapper git-merge-main  --issue ${input.issue_id} --branch ${input.branch}   # preserves history and SHAs\n` +
        `  pnpm ops:merge-wrapper git-rebase-main --issue ${input.issue_id} --branch ${input.branch}   # REWRITES history; moves the head SHA and invalidates pm-verdict, t1-approved evidence and executor-result\n` +
        'Prefer git-merge-main on any branch carrying governance artifacts or a proof bundle. No git mutation was performed.',
    };
  }

  if (input.operation !== 'git-merge-main' && input.operation !== 'git-rebase-main') {
    return runMergeWrapper(input as MergeWrapperInput, optionsWithProbe);
  }

  // For git-merge-main / git-rebase-main we build and run the command
  // through the same mutex path as runMergeWrapper.
  const bridgedInput: MergeWrapperInput = {
    ...input,
    // Reuse main-sync slot — same mutex semantics, different git verb.
    operation: 'main-sync',
  };

  // We need to override the actual command built by runMergeWrapper.
  // Inject a custom runner that intercepts the git pull and instead
  // runs the correct operation. `runMergeWrapper` may invoke the runner
  // more than once for a 'main-sync'-bridged operation (autostash push,
  // the main command, autostash pop) — only the call matching the literal
  // main-sync pull command should be substituted; stash push/pop calls
  // must pass through to the real runner untouched, or every stash
  // invocation would incorrectly re-run the merge/rebase command instead.
  const cmd = buildExtendedCommand(input.operation, input);
  const mainSyncPullCommand = buildMergeCommand({ ...bridgedInput, operation: 'main-sync' });
  const originalRunner = options.runner;
  const realRunner =
    originalRunner ??
    ((c: string, a: string[], o: { cwd: string }) =>
      spawnSync(c, a, { cwd: o.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>);

  // UTV2-1678: captured lazily, at the moment the sync command is actually
  // about to run. Probing eagerly would charge a git call to paths that never
  // sync at all — a held lock, a release failure, or a dry run — and would make
  // those paths observably different for no benefit.
  let preSyncHead = '';

  const interceptingRunner: CommandRunner = (command, args, runOptions) => {
    const isMainSyncPullCall =
      command === mainSyncPullCommand.command &&
      args.length === mainSyncPullCommand.args.length &&
      args.every((arg, i) => arg === mainSyncPullCommand.args[i]);
    if (!isMainSyncPullCall) {
      return realRunner(command, args, runOptions);
    }
    const headProbe = realRunner('git', ['rev-parse', 'HEAD'], runOptions);
    if (headProbe.status === 0) {
      preSyncHead = String(headProbe.stdout ?? '').trim().split('\n')[0] ?? '';
    }
    return realRunner(cmd.command, cmd.args, runOptions);
  };

  // UTV2-1678 criteria 3-4: prove the sync destroyed nothing before reporting
  // success. Applied to every sync verb, not just rebase — a merge with a bad
  // conflict resolution can drop a file just as permanently.
  // UTV2-1790: cleanup runs inside runMergeWrapper before the autostash pop and
  // the release. It is bound to the REAL runner for clarity rather than for
  // behaviour -- no call abortInProgressSync makes matches the main-sync pull
  // vector, so passing the intercepting runner would be equivalent. Review round
  // 5 confirmed that by mutation; the binding is documentation of intent, not a
  // load-bearing control, and is described as such rather than claimed as one.
  const syncOperation = input.operation;
  const result = runMergeWrapper(bridgedInput, {
    ...optionsWithProbe,
    runner: interceptingRunner,
    onCommandFailure: ({ cwd: failureCwd }) =>
      abortInProgressSync(syncOperation, realRunner, failureCwd),
    // UTV2-1790 (review round 3): report the command the intercepting runner
    // actually executes, not the `main-sync` pull it is bridged through. Without
    // this, a fail-closed result names `git pull --ff-only origin main` as the
    // command that left MERGE_HEAD behind -- an invocation that cannot leave a
    // merge in progress at all.
    reportedCommand: [cmd.command, ...cmd.args],
    // UTV2-1790 (review round 6): the stash-push and stash-pop failure paths DECIDE
    // whether to release the mutex from a measurement of the worktree, not from an
    // assumption about why a git command exited non-zero. That probe arrives via
    // `optionsWithProbe` above, which binds `options.runner ?? spawnSync` -- the
    // same value as `realRunner` here, and not the intercepting runner, which
    // substitutes the sync command. Like the `onCommandFailure` binding, that is
    // documentation of intent rather than a load-bearing control: no probe vector
    // matches the intercepted `main-sync` pull, so the two runners are
    // behaviourally identical at this site and a mutant swapping them survives.
    //
    // Round 7 removed a duplicate `residueProbe` override at this site: it was
    // byte-for-byte equivalent to the default, so deleting it changed no
    // behaviour and its mutant survived. An override that cannot fail is not a
    // control, and leaving it would have implied the two runners differed here.
  });
  // Only a sync that actually ran can have dropped anything or moved the head.
  //
  // UTV2-1790 (review round 6, P2): this used to bail on `!result.ok`, which
  // silently skipped BOTH the dropped-path refusal and the head-move
  // re-authorization notice on the one failure path where the merge had already
  // been committed -- `merge_wrapper_stash_pop_conflict`. The head really had
  // moved, and nothing said so. `ok` is the wrong question; whether HEAD moved is
  // the right one, and it is asked below.
  if (!preSyncHead) return result;

  const cwd = input.cwd ?? process.cwd();
  const gitLines = (args: string[]): string[] => {
    const run = realRunner('git', args, { cwd });
    if (run.status !== 0) return [];
    return String(run.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  };

  // The pre-sync SHA still resolves after the sync, so both sides of the
  // comparison can be computed here rather than snapshotted up front.
  const before = gitLines(['diff', '--name-only', `origin/main...${preSyncHead}`]);
  const after = gitLines(['diff', '--name-only', 'origin/main..HEAD']);
  const classification = classifyDroppedPaths(before, after);

  // Criterion 5 applies whether or not anything was dropped: a clean rebase
  // still moves the head SHA, and that alone invalidates every approval.
  const postSyncHead = gitLines(['rev-parse', 'HEAD'])[0] ?? '';
  const headMoveNotice = renderHeadMoveNotice(
    buildHeadMoveInvalidation(preSyncHead, postSyncHead),
  );

  // An already-failed result keeps its code: the operator must act on the failure
  // itself, and reclassifying it would hide that. But the head DID move, so the
  // re-authorization notice and any dropped-path warning are appended to stderr
  // rather than dropped on the floor.
  if (!result.ok) {
    let warning = '';
    let restoredHead = false;
    if (classification.dropped.length > 0) {
      warning =
        `\n\nWARNING: this sync also dropped paths relative to the pre-sync head: ` +
        `${classification.dropped.join(', ')}`;
      if (classification.protectedPaths.length > 0) {
        // UTV2-1790 (review round 7, P3): the `ok` path below RESTORES the tree;
        // this path only described how to. That asymmetry is closed here -- a
        // dropped proof bundle or lane manifest usually exists on no other ref, so
        // the recovery is the same regardless of why the sync also failed.
        //
        // It is conditional on the worktree being clean, which the `ok` path can
        // take for granted and this one cannot: `git reset --keep` refuses over an
        // unmerged index, and firing it at a tree that is mid-merge would turn a
        // recoverable failure into a confusing one. When it is not safe, the
        // instruction is still printed, exactly as before.
        const residue = worktreeResidue(realRunner, cwd);
        const restore = residue.clean
          ? realRunner('git', ['reset', '--keep', preSyncHead], { cwd })
          : undefined;
        const restored = restore !== undefined && !restore.error && restore.status === 0;
        restoredHead = restored;
        warning +=
          `\nPROTECTED artifacts are among them: ${classification.protectedPaths.join(', ')}. ` +
          (restored
            ? `Working tree restored to the pre-sync head ${preSyncHead} (git reset --keep). ` +
              `No artifact was lost, and the head is back where it started, so no ` +
              `governance artifact was invalidated. The reported failure above still ` +
              `stands and still needs handling.`
            : `NOT restored automatically (${
                residue.clean
                  ? 'git reset --keep failed'
                  : `the worktree is not clean: ${residue.detail}`
              }). Recover with: git reset --keep ${preSyncHead}`);
      }
    }
    // If the restore succeeded the head is back where it started, so the
    // re-authorization notice would be false. `restoredHead` records that.
    const extra = `${restoredHead ? '' : headMoveNotice}${warning}`;
    return extra ? { ...result, stderr: `${result.stderr ?? ''}${extra}` } : result;
  }

  if (classification.dropped.length === 0) {
    return headMoveNotice
      ? { ...result, stderr: `${result.stderr ?? ''}${headMoveNotice}` }
      : result;
  }

  if (classification.protectedPaths.length > 0) {
    // Restore the pre-sync tree. `--keep` preserves uncommitted work rather
    // than discarding it, which matters because the autostash pop has already
    // run by this point.
    const restore = realRunner('git', ['reset', '--keep', preSyncHead], { cwd });
    const restored = restore.status === 0;
    return {
      ok: false,
      code: 'merge_wrapper_sync_dropped_protected_paths',
      issue_id: input.issue_id,
      operation: input.operation as MergeWrapperOperation,
      command: [cmd.command, ...cmd.args],
      lock: result.lock,
      release: result.release,
      stdout: result.stdout,
      stderr: result.stderr,
      main_sync_stash: result.main_sync_stash,
      message:
        `The ${input.operation} sync of "${input.branch}" dropped governance artifacts that exist on no other ref:\n` +
        classification.protectedPaths.map((p) => `  - ${p}`).join('\n') +
        '\n' +
        (restored
          ? `Working tree restored to the pre-sync head ${preSyncHead} (git reset --keep). No artifact was lost.`
          : `RESTORE FAILED — the working tree may still be missing these paths. Recover manually with: git reset --keep ${preSyncHead}`) +
        '\nA lane\'s proof bundle and manifest usually exist only on that lane\'s branch, so a dropped copy is unrecoverable (UTV2-1584).',
    };
  }

  // Criterion 4: anything else dropped is reported, not refused.
  return {
    ...result,
    stderr:
      `${result.stderr ?? ''}\n[ops-merge-wrapper] warning: the ${input.operation} sync dropped ` +
      `${classification.otherPaths.length} tracked path(s) not under a protected prefix:\n` +
      classification.otherPaths.map((p) => `  - ${p}`).join('\n') +
      `\nPre-sync head was ${preSyncHead}; review before continuing.` +
      headMoveNotice,
  };
}

/**
 * UTV2-1678 criterion 5: render the invalidation report for a head-SHA move.
 * Returns '' when nothing moved, so it is safe to append unconditionally.
 */
export function renderHeadMoveNotice(invalidation: HeadMoveInvalidation): string {
  if (!invalidation.headMoved) return '';
  return (
    `\n[ops-merge-wrapper] the sync moved the head SHA ${invalidation.previousHead} -> ${invalidation.currentHead}, ` +
    'which invalidates every head-pinned governance artifact on this branch:\n' +
    invalidation.invalidatedArtifacts.map((a) => `  - ${a}`).join('\n') +
    '\nRequired re-authorization order:\n' +
    invalidation.reauthorizationOrder.map((step, i) => `  ${i + 1}. ${step}`).join('\n')
  );
}

/**
 * Assert the merge lock is currently held by the specified issue and branch.
 * Returns a MergeLockResult — ok=false means the lock is NOT held.
 * Used by CI guards, pre-merge hooks, and closeout checks.
 */
export function guardMergeLockHeld(
  input: { issue_id: string; branch: string; reason?: string },
  options: { lockPath?: string; now?: Date } = {},
): MergeLockResult {
  return requireMergeLockHeld(input, options);
}

// ---------------------------------------------------------------------------
// merge-train (UTV2-1467) — Design B batched-merge protocol
// ---------------------------------------------------------------------------
//
// Drains a batch of already-green, already-gate-approved PRs serially and
// immediately: the merge mutex is acquired ONCE for the whole batch (not
// once per PR, as runMergeWrapper/runExtendedMergeWrapper do above), each
// PR is update-branched against main, its CI is waited out, its
// EXECUTOR_RESULT comment is re-posted against the new head SHA, and it is
// merged — before moving to the next PR with no idle gap. This is exactly
// Design B from docs/05_operations/UTV2-1461-merge-queue-decision-packet.md
// §3, PM-approved for UTV2-1467 on 2026-07-09.
//
// Native GitHub merge queue (Design A) is confirmed unavailable on this
// user-owned repo (a live ruleset probe returned HTTP 422 — merge queue is
// org-scoped only). This file does not touch branch protection, rulesets,
// or required-workflow triggers (ci.yml / merge-gate.yml /
// executor-result-validator.yml / p0-protocol.yml are untouched by design):
// every required context is still re-validated by GitHub itself on each
// per-PR `synchronize` event exactly as it is today. merge-train only
// changes the *cadence* at which those cycles happen between merges.
//
// Ordering: candidates are drained in the order given by the caller. This
// file has no lane-type awareness (see the decision packet's own
// observation that the orchestrator, not the wrapper, holds lane-type
// metadata) — callers wanting "workflow/infra lanes first, then by age"
// must pre-sort the candidates array before invoking merge-train.

export interface MergeTrainCandidate {
  issue_id: string;
  branch: string;
  pr: string;
}

export type MergeTrainEntryStatus =
  | 'merged'
  | 'planned'
  | 'update_branch_failed'
  | 'ci_failed'
  | 'ci_timeout'
  | 'merge_authorization_denied'
  | 'merge_failed'
  | 'skipped_after_failure'
  | 'unexpected_error';

export interface MergeTrainEntryResult {
  issue_id: string;
  branch: string;
  pr: string;
  status: MergeTrainEntryStatus;
  detail: string;
  merge_sha: string | null;
  duration_ms: number;
}

export interface MergeTrainInput {
  candidates: MergeTrainCandidate[];
  cwd?: string;
  merge_method?: MergeMethod;
  ttl_minutes?: number;
  dry_run?: boolean;
  timeout_minutes?: number;
  poll_seconds?: number;
}

export type MergeTrainResult =
  | {
      ok: true;
      code: 'merge_train_completed' | 'merge_train_dry_run';
      entries: MergeTrainEntryResult[];
      lock: MergeLockResult;
      release: MergeLockResult;
      started_at: string;
      completed_at: string;
      duration_ms: number;
    }
  | {
      ok: false;
      code:
        | 'merge_train_invalid_input'
        | 'merge_train_lock_held'
        | 'merge_train_lock_failed'
        | 'merge_train_partial_failure';
      entries?: MergeTrainEntryResult[];
      lock?: MergeLockResult;
      release?: MergeLockResult;
      message: string;
      started_at?: string;
      completed_at?: string;
      duration_ms?: number;
    };

export type CheckWaitStatus = 'success' | 'failure' | 'timeout';

export interface StatusCheckEntry {
  name?: string | null;
  conclusion?: string | null;
  status?: string | null;
}

/** The four required contexts on `main` today (branch protection). */
export const MERGE_TRAIN_REQUIRED_CONTEXTS: readonly string[] = [
  'verify',
  'Executor Result Validation',
  'Merge Gate',
  'P0 Protocol',
];

// The decision packet observed ~9min CI cycles; default timeout leaves
// headroom above that without hanging forever on a wedged check.
const MERGE_TRAIN_DEFAULT_TIMEOUT_MINUTES = 15;
const MERGE_TRAIN_DEFAULT_POLL_SECONDS = 15;

/**
 * Pure evaluator for a PR's statusCheckRollup (same field pr-block-diagnostic.ts
 * and execution-state.ts already read via `gh pr view --json statusCheckRollup`)
 * against the required-context list. Side-effect-free and exported so
 * merge-train's decision logic is testable without faking real GitHub
 * responses through the network layer.
 */
export function evaluateStatusCheckRollup(
  rollup: StatusCheckEntry[],
  requiredContexts: readonly string[] = MERGE_TRAIN_REQUIRED_CONTEXTS,
): { status: 'success' | 'failure' | 'pending'; detail: string } {
  const byName = new Map<string, StatusCheckEntry>();
  for (const entry of rollup) {
    if (entry.name) byName.set(entry.name, entry);
  }

  const missing = requiredContexts.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    return { status: 'pending', detail: `waiting on contexts to appear: ${missing.join(', ')}` };
  }

  const passingConclusions = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  const failed = requiredContexts.filter((name) => {
    const entry = byName.get(name);
    return Boolean(entry?.conclusion) && !passingConclusions.has((entry?.conclusion ?? '').toUpperCase());
  });
  if (failed.length > 0) {
    return { status: 'failure', detail: `required context(s) failed: ${failed.join(', ')}` };
  }

  const pending = requiredContexts.filter((name) => !byName.get(name)?.conclusion);
  if (pending.length > 0) {
    return { status: 'pending', detail: `waiting on: ${pending.join(', ')}` };
  }

  return { status: 'success', detail: 'all required contexts green' };
}

export type WaitForChecksFn = (
  input: { pr: string; cwd: string; requiredContexts?: readonly string[] },
  options: { runner: CommandRunner; timeoutMs: number; pollIntervalMs: number },
) => Promise<{ status: CheckWaitStatus; detail: string }>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Default CI-wait: polls `gh pr view --json statusCheckRollup` until all
 * MERGE_TRAIN_REQUIRED_CONTEXTS settle green, one fails, or the timeout
 * elapses. Real GitHub round-trips only happen through the injected
 * `runner` — tests supply a synchronous fake runner and a tiny
 * pollIntervalMs so no test ever waits on a real network call or a real
 * multi-minute CI cycle.
 */
export const defaultWaitForChecks: WaitForChecksFn = async (input, options) => {
  const deadline = Date.now() + options.timeoutMs;
  const requiredContexts = input.requiredContexts ?? MERGE_TRAIN_REQUIRED_CONTEXTS;

  for (;;) {
    const run = options.runner('gh', ['pr', 'view', input.pr, '--json', 'statusCheckRollup'], {
      cwd: input.cwd,
    });
    if (run.error || run.status !== 0) {
      return {
        status: 'failure',
        detail: `gh pr view --json statusCheckRollup failed: ${bufferToText(run.stderr) || bufferToText(run.stdout) || `exit ${run.status}`}`,
      };
    }

    let rollup: StatusCheckEntry[] = [];
    try {
      const parsed = JSON.parse(bufferToText(run.stdout)) as { statusCheckRollup?: StatusCheckEntry[] };
      rollup = Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : [];
    } catch (error) {
      return {
        status: 'failure',
        detail: `could not parse statusCheckRollup: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const evaluation = evaluateStatusCheckRollup(rollup, requiredContexts);
    if (evaluation.status === 'success' || evaluation.status === 'failure') {
      return { status: evaluation.status, detail: evaluation.detail };
    }

    if (Date.now() >= deadline) {
      return { status: 'timeout', detail: `timed out waiting for required contexts: ${evaluation.detail}` };
    }

    await sleep(options.pollIntervalMs);
  }
};

interface ExecutorResultComment {
  body: string;
}

/**
 * Mirrors executor-result-validator.yml's `parseResult()`: a comment is a
 * valid executor-result marker only if (after trimming and stripping
 * markdown bold / `---` fences) it contains both the literal
 * `EXECUTOR_RESULT: READY_FOR_REVIEW` line and the `schema: executor-result/v1`
 * line. Exported so this parsing logic is unit-testable against the exact
 * strings the workflow itself matches on.
 */
export function isExecutorResultComment(body: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\*\*(.+?)\*\*\s*/, '$1 ').replace(/^---$/, ''));
  return (
    lines.some((line) => line === 'EXECUTOR_RESULT: READY_FOR_REVIEW') &&
    lines.some((line) => line === 'schema: executor-result/v1')
  );
}

/**
 * Builds the re-posted executor-result comment body for a PR whose head
 * moved (update-branch). Head SHA is the only field that changes — this is
 * the "mechanical" re-post the decision packet describes (§3 step 3);
 * Issue/Lane/Branch/PR/Proof Artifact are carried over verbatim so the
 * validator's other field checks still pass unchanged.
 */
export function buildRepostedExecutorResultBody(originalBody: string, newHeadSha: string): string {
  const lines = originalBody.split(/\r?\n/);
  // Matches "Head SHA: x", "**Head SHA**: x" (bold wraps only the label), and
  // "**Head SHA:** x" (bold wraps the label AND the colon — the format the
  // validator's own normalization (`replace(/^\*\*(.+?)\*\*\s*/, '$1 ')`)
  // explicitly accepts). The trailing `\*{0,2}` handles the closing `**`
  // landing after the colon instead of before it.
  const headShaLineIndex = lines.findIndex((line) =>
    /^\s*\*{0,2}head sha\*{0,2}:\*{0,2}\s*/i.test(line),
  );
  const newLine = `Head SHA: ${newHeadSha}`;
  if (headShaLineIndex === -1) {
    return [...lines, newLine].join('\n');
  }
  const next = [...lines];
  next[headShaLineIndex] = newLine;
  return next.join('\n');
}

export type RepostExecutorResultFn = (
  input: { pr: string; cwd: string; newHeadSha: string },
  options: { runner: CommandRunner },
) => { ok: boolean; detail: string };

/**
 * Default executor-result re-post: reads the PR's comments, finds the most
 * recent valid EXECUTOR_RESULT comment (same "most recent wins" rule the
 * validator itself uses), rewrites its Head SHA line, and posts it as a
 * NEW comment (the validator always reads the latest one — there is no
 * need to edit the original in place).
 */
export const defaultRepostExecutorResult: RepostExecutorResultFn = (input, options) => {
  const commentsRun = options.runner('gh', ['pr', 'view', input.pr, '--json', 'comments'], {
    cwd: input.cwd,
  });
  if (commentsRun.error || commentsRun.status !== 0) {
    return {
      ok: false,
      detail: `gh pr view --json comments failed: ${bufferToText(commentsRun.stderr) || `exit ${commentsRun.status}`}`,
    };
  }

  let comments: ExecutorResultComment[] = [];
  try {
    const parsed = JSON.parse(bufferToText(commentsRun.stdout)) as { comments?: ExecutorResultComment[] };
    comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch (error) {
    return {
      ok: false,
      detail: `could not parse PR comments: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const matches = comments.filter((comment) => isExecutorResultComment(comment.body ?? ''));
  const latest = matches.at(-1);
  if (!latest) {
    return { ok: false, detail: 'no existing EXECUTOR_RESULT comment found to re-post' };
  }

  const newBody = buildRepostedExecutorResultBody(latest.body, input.newHeadSha);
  const postRun = options.runner('gh', ['pr', 'comment', input.pr, '--body', newBody], { cwd: input.cwd });
  if (postRun.error || postRun.status !== 0) {
    return {
      ok: false,
      detail: `gh pr comment failed: ${bufferToText(postRun.stderr) || `exit ${postRun.status}`}`,
    };
  }

  return { ok: true, detail: `re-posted executor-result comment with Head SHA ${input.newHeadSha}` };
};

function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): ReturnType<CommandRunner> {
  return spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'pipe',
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  });
}

interface MergeTrainEntryDeps {
  runner: CommandRunner;
  waitForChecks: WaitForChecksFn;
  repostExecutorResult: RepostExecutorResultFn;
  clock: () => number;
}

async function runMergeTrainEntry(
  candidate: MergeTrainCandidate,
  input: { cwd?: string; merge_method?: MergeMethod },
  timing: { timeoutMs: number; pollIntervalMs: number },
  deps: MergeTrainEntryDeps,
): Promise<MergeTrainEntryResult> {
  const cwd = path.resolve(input.cwd ?? ROOT);
  const start = deps.clock();
  const base = { issue_id: candidate.issue_id, branch: candidate.branch, pr: candidate.pr };

  const updateBranchCommand = buildMergeCommand({
    operation: 'pr-update-branch',
    issue_id: candidate.issue_id,
    branch: candidate.branch,
    pr: candidate.pr,
  });
  const updateRun = deps.runner(updateBranchCommand.command, updateBranchCommand.args, { cwd });
  if (updateRun.error || updateRun.status !== 0) {
    return {
      ...base,
      status: 'update_branch_failed',
      detail: `pr-update-branch failed: ${bufferToText(updateRun.stderr) || bufferToText(updateRun.stdout) || `exit ${updateRun.status}`}`,
      merge_sha: null,
      duration_ms: deps.clock() - start,
    };
  }

  // Re-post the executor-result comment against the new head SHA BEFORE
  // waiting on checks — not after. `pr-update-branch` produces a real
  // `synchronize` event, which re-runs Executor Result Validation
  // immediately; if the stale (pre-update) comment is still the most
  // recent one at that point, the validator fails it outright (HEAD SHA
  // mismatch) and `waitForChecks` below would then see Executor Result
  // Validation as a hard failure for every candidate whose update-branch
  // actually moved the head, never reaching a state that could turn
  // green. Reposting first — mechanical per the decision packet, since
  // the diff hasn't changed, only the base merge commit moved — gives the
  // validator a fresh, correctly-SHA-bound comment to re-evaluate during
  // the same wait below.
  let repostDetail = 'skipped: could not resolve new head SHA';
  const headShaRun = deps.runner('gh', ['pr', 'view', candidate.pr, '--json', 'headRefOid'], { cwd });
  if (!headShaRun.error && headShaRun.status === 0) {
    try {
      const parsed = JSON.parse(bufferToText(headShaRun.stdout)) as { headRefOid?: string };
      if (parsed.headRefOid) {
        repostDetail = deps.repostExecutorResult(
          { pr: candidate.pr, cwd, newHeadSha: parsed.headRefOid },
          { runner: deps.runner },
        ).detail;
      }
    } catch (error) {
      repostDetail = `could not parse headRefOid: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // If the repost itself failed (e.g. no prior EXECUTOR_RESULT comment
  // found to rewrite), we still proceed to wait: GitHub's own
  // required-context enforcement is the authority, and a stale/missing
  // executor-result comment will simply fail Executor Result Validation
  // on its own, surfacing below as a ci_failed entry rather than being
  // silently papered over here.
  const wait = await deps.waitForChecks(
    { pr: candidate.pr, cwd },
    { runner: deps.runner, timeoutMs: timing.timeoutMs, pollIntervalMs: timing.pollIntervalMs },
  );
  if (wait.status === 'timeout') {
    return {
      ...base,
      status: 'ci_timeout',
      detail: `${wait.detail} (${repostDetail})`,
      merge_sha: null,
      duration_ms: deps.clock() - start,
    };
  }
  if (wait.status === 'failure') {
    return {
      ...base,
      status: 'ci_failed',
      detail: `${wait.detail} (${repostDetail})`,
      merge_sha: null,
      duration_ms: deps.clock() - start,
    };
  }

  // UTV2-1592 amendment: merge-train's per-candidate merge step must never
  // bypass the pre-merge authorization gate. Routed through the same
  // runAuthorizedPrMerge primitive runMergeWrapper's direct `pr-merge`
  // operation uses (merge-wrapper.ts) -- this is the ONLY place in this
  // file allowed to actually invoke a `gh pr merge` command.
  const authorizedMerge = runAuthorizedPrMerge(
    { pr: candidate.pr, merge_method: input.merge_method ?? 'squash' },
    deps.runner,
    cwd,
  );
  if (!authorizedMerge.authorized) {
    return {
      ...base,
      status: 'merge_authorization_denied',
      detail: `pre-merge authorization denied (${repostDetail}): ${authorizedMerge.reason ?? 'no reason given'}`,
      merge_sha: null,
      duration_ms: deps.clock() - start,
    };
  }
  const mergeRun = authorizedMerge.run as ReturnType<CommandRunner>;
  if (mergeRun.error || mergeRun.status !== 0) {
    return {
      ...base,
      status: 'merge_failed',
      detail: `pr-merge failed (${repostDetail}): ${bufferToText(mergeRun.stderr) || bufferToText(mergeRun.stdout) || `exit ${mergeRun.status}`}`,
      merge_sha: null,
      duration_ms: deps.clock() - start,
    };
  }

  const shaRun = deps.runner(
    'gh',
    ['pr', 'view', candidate.pr, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'],
    { cwd },
  );
  const mergeSha = !shaRun.error && shaRun.status === 0 ? bufferToText(shaRun.stdout) || null : null;

  return {
    ...base,
    status: 'merged',
    detail: `merged (${repostDetail})`,
    merge_sha: mergeSha,
    duration_ms: deps.clock() - start,
  };
}

function validateMergeTrainInput(input: MergeTrainInput): string[] {
  const errors: string[] = [];
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    errors.push('candidates must be a non-empty array');
    return errors;
  }
  input.candidates.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      errors.push(`candidates[${index}] must be an object`);
      return;
    }
    try {
      requireIssueId(candidate.issue_id ?? '');
    } catch {
      errors.push(`candidates[${index}].issue_id is invalid: "${candidate.issue_id}"`);
    }
    if (!candidate.branch) errors.push(`candidates[${index}].branch is required`);
    if (!candidate.pr) errors.push(`candidates[${index}].pr is required`);
  });
  if (input.merge_method && !['merge', 'squash', 'rebase'].includes(input.merge_method)) {
    errors.push(`Invalid merge method: ${input.merge_method}`);
  }
  return errors;
}

export interface MergeTrainDeps {
  runner?: CommandRunner;
  waitForChecks?: WaitForChecksFn;
  repostExecutorResult?: RepostExecutorResultFn;
  lockPath?: string;
  now?: Date;
  clock?: () => number;
}

/**
 * Runs the merge-train protocol: acquire the merge mutex ONCE for the
 * whole batch, drain candidates serially and immediately (update-branch →
 * wait for CI → re-post executor-result → merge, per candidate, with no
 * idle gap), and release the mutex exactly once at the end — regardless
 * of whether the drain succeeded, failed partway, or an entry threw
 * unexpectedly. A candidate failure stops the drain; already-merged
 * candidates stay merged (there is nothing to undo) and untouched
 * candidates are left exactly as they were (individually mergeable),
 * matching the decision packet's "degrades gracefully" claim.
 */
export async function runMergeTrain(
  input: MergeTrainInput,
  deps: MergeTrainDeps = {},
): Promise<MergeTrainResult> {
  const errors = validateMergeTrainInput(input);
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'merge_train_invalid_input',
      message: errors.join('; '),
    };
  }

  const runner = deps.runner ?? defaultCommandRunner;
  const waitForChecks = deps.waitForChecks ?? defaultWaitForChecks;
  const repostExecutorResult = deps.repostExecutorResult ?? defaultRepostExecutorResult;
  const clock = deps.clock ?? Date.now;
  const now = deps.now ?? new Date();
  const cwd = path.resolve(input.cwd ?? ROOT);
  const primary = input.candidates[0] as MergeTrainCandidate;
  const issueIds = input.candidates.map((candidate) => candidate.issue_id);
  const startedAt = now.toISOString();
  const startClock = clock();

  const lock = acquireMergeLock(
    {
      issue_id: primary.issue_id,
      branch: primary.branch,
      pr: primary.pr,
      cwd,
      reason: `merge-train:${issueIds.join(',')}`,
      owner: defaultMergeLockOwner(),
      ttl_ms: (input.ttl_minutes ?? 60) * 60 * 1000,
    },
    { lockPath: deps.lockPath, now },
  );

  if (!lock.ok) {
    return {
      ok: false,
      code: lock.code === 'merge_lock_held' ? 'merge_train_lock_held' : 'merge_train_lock_failed',
      message: lock.message,
      lock,
    };
  }

  if (input.dry_run) {
    const release = releaseMergeLock(
      { issue_id: primary.issue_id, branch: primary.branch },
      { lockPath: deps.lockPath, now },
    );
    return {
      ok: true,
      code: 'merge_train_dry_run',
      entries: input.candidates.map((candidate) => ({
        issue_id: candidate.issue_id,
        branch: candidate.branch,
        pr: candidate.pr,
        status: 'planned',
        detail: 'dry-run: no commands executed',
        merge_sha: null,
        duration_ms: 0,
      })),
      lock,
      release,
      started_at: startedAt,
      completed_at: new Date(now.getTime() + 1).toISOString(),
      duration_ms: 0,
    };
  }

  const timing = {
    timeoutMs: (input.timeout_minutes ?? MERGE_TRAIN_DEFAULT_TIMEOUT_MINUTES) * 60 * 1000,
    pollIntervalMs: (input.poll_seconds ?? MERGE_TRAIN_DEFAULT_POLL_SECONDS) * 1000,
  };

  const entries: MergeTrainEntryResult[] = [];
  let failed = false;

  for (const candidate of input.candidates) {
    if (failed) {
      entries.push({
        issue_id: candidate.issue_id,
        branch: candidate.branch,
        pr: candidate.pr,
        status: 'skipped_after_failure',
        detail: 'train stopped after an earlier candidate failed',
        merge_sha: null,
        duration_ms: 0,
      });
      continue;
    }

    // Never let a misbehaving injected dependency (or an unexpected bug)
    // throw out of the drain loop — that would skip the unconditional
    // mutex release below. Any thrown error becomes a structured failure
    // entry instead, exactly like a normal command failure.
    let entry: MergeTrainEntryResult;
    try {
      entry = await runMergeTrainEntry(
        candidate,
        { cwd: input.cwd, merge_method: input.merge_method },
        timing,
        { runner, waitForChecks, repostExecutorResult, clock },
      );
    } catch (error) {
      entry = {
        issue_id: candidate.issue_id,
        branch: candidate.branch,
        pr: candidate.pr,
        status: 'unexpected_error',
        detail: error instanceof Error ? error.message : String(error),
        merge_sha: null,
        duration_ms: 0,
      };
    }

    entries.push(entry);
    if (entry.status !== 'merged') {
      failed = true;
    }
  }

  const release = releaseMergeLock(
    { issue_id: primary.issue_id, branch: primary.branch },
    { lockPath: deps.lockPath, now: new Date(now.getTime() + 1) },
  );

  const completedAt = new Date().toISOString();
  const durationMs = clock() - startClock;

  if (failed) {
    const failure = entries.find((entry) => entry.status !== 'merged' && entry.status !== 'skipped_after_failure');
    return {
      ok: false,
      code: 'merge_train_partial_failure',
      entries,
      lock,
      release,
      message: `merge-train stopped after a candidate failed: ${failure?.issue_id ?? 'unknown'} (${failure?.status ?? 'unknown'}): ${failure?.detail ?? 'unknown failure'}`,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
    };
  }

  return {
    ok: true,
    code: 'merge_train_completed',
    entries,
    lock,
    release,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
  };
}

function cliInput(argv: string[]): {
  operation: ExtendedMergeWrapperOperation | 'guard';
  issue_id: string;
  branch: string;
  pr: string | null;
  cwd: string;
  auto: boolean;
  dry_run: boolean;
  merge_method: 'merge' | 'squash' | 'rebase';
  ttl_minutes?: number;
  reason?: string;
} {
  const { positionals, flags, bools } = parseArgs(argv);
  return {
    operation: (positionals[0] ?? '') as ExtendedMergeWrapperOperation | 'guard',
    issue_id: getFlag(flags, 'issue') ?? '',
    branch: getFlag(flags, 'branch') ?? '',
    pr: getFlag(flags, 'pr') ?? null,
    cwd: getFlag(flags, 'cwd') ?? ROOT,
    auto: bools.has('auto'),
    dry_run: bools.has('dry-run'),
    merge_method: (getFlag(flags, 'method') ?? 'squash') as 'merge' | 'squash' | 'rebase',
    ttl_minutes: getFlag(flags, 'ttl-minutes')
      ? Number.parseInt(getFlag(flags, 'ttl-minutes') ?? '', 10)
      : undefined,
    reason: getFlag(flags, 'reason'),
  };
}

/**
 * Parses `--candidates-file <path.json>` plus the merge-train-specific
 * flags. A separate parser from `cliInput()` above because merge-train's
 * input shape (a batch) doesn't fit the single issue/branch/pr shape the
 * other operations share.
 */
function mergeTrainCliInput(argv: string[]): {
  candidatesFile: string | undefined;
  cwd: string;
  merge_method: MergeMethod;
  ttl_minutes?: number;
  timeout_minutes?: number;
  poll_seconds?: number;
  dry_run: boolean;
} {
  const { flags, bools } = parseArgs(argv);
  return {
    candidatesFile: getFlag(flags, 'candidates-file'),
    cwd: getFlag(flags, 'cwd') ?? ROOT,
    merge_method: (getFlag(flags, 'method') ?? 'squash') as MergeMethod,
    ttl_minutes: getFlag(flags, 'ttl-minutes')
      ? Number.parseInt(getFlag(flags, 'ttl-minutes') ?? '', 10)
      : undefined,
    timeout_minutes: getFlag(flags, 'timeout-minutes')
      ? Number.parseInt(getFlag(flags, 'timeout-minutes') ?? '', 10)
      : undefined,
    poll_seconds: getFlag(flags, 'poll-seconds')
      ? Number.parseInt(getFlag(flags, 'poll-seconds') ?? '', 10)
      : undefined,
    dry_run: bools.has('dry-run'),
  };
}

async function runMergeTrainCli(argv: string[]): Promise<MergeTrainResult> {
  const parsed = mergeTrainCliInput(argv);
  if (!parsed.candidatesFile) {
    return {
      ok: false,
      code: 'merge_train_invalid_input',
      message:
        'Missing required --candidates-file <path.json>. File must contain a JSON array of ' +
        '{ "issue_id": "UTV2-###", "branch": "...", "pr": "123" }, pre-ordered by the caller.',
    };
  }

  let candidates: MergeTrainCandidate[];
  try {
    const resolved = path.resolve(ROOT, parsed.candidatesFile);
    candidates = JSON.parse(fs.readFileSync(resolved, 'utf8')) as MergeTrainCandidate[];
  } catch (error) {
    return {
      ok: false,
      code: 'merge_train_invalid_input',
      message: `Could not read/parse --candidates-file "${parsed.candidatesFile}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return runMergeTrain({
    candidates,
    cwd: parsed.cwd,
    merge_method: parsed.merge_method,
    ttl_minutes: parsed.ttl_minutes,
    timeout_minutes: parsed.timeout_minutes,
    poll_seconds: parsed.poll_seconds,
    dry_run: parsed.dry_run,
  });
}

async function runCli(): Promise<void> {
  const { positionals: topLevelPositionals } = parseArgs(process.argv.slice(2));
  if (topLevelPositionals[0] === 'merge-train') {
    const result = await runMergeTrainCli(process.argv.slice(2));
    emitJson(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const input = cliInput(process.argv.slice(2));

  if (input.operation === 'guard') {
    const result = guardMergeLockHeld({
      issue_id: input.issue_id,
      branch: input.branch,
      reason: input.reason,
    });
    emitJson(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const VALID_OPS = new Set<string>([
    'pr-merge',
    'pr-update-branch',
    'main-sync',
    'git-merge-main',
    'git-rebase-main',
  ]);

  if (!VALID_OPS.has(input.operation)) {
    emitJson({
      ok: false,
      code: 'merge_wrapper_invalid_input',
      message: `Unknown operation: ${input.operation}\nValid operations: ${[...VALID_OPS].join(', ')}, merge-train (batch — see --candidates-file)\nBlocked raw commands (must use this wrapper): ${BLOCKED_RAW_COMMANDS.join(', ')}`,
    });
    process.exitCode = 1;
    return;
  }

  const missing: string[] = [];
  if (!input.issue_id) missing.push('--issue');
  if (!input.branch) missing.push('--branch');
  if ((input.operation === 'pr-merge' || input.operation === 'pr-update-branch') && !input.pr) {
    missing.push('--pr');
  }
  if (missing.length > 0) {
    const examplePr =
      input.operation === 'pr-merge' || input.operation === 'pr-update-branch' ? ' --pr 456' : '';
    emitJson({
      ok: false,
      code: 'merge_wrapper_invalid_input',
      message:
        `Missing required argument(s): ${missing.join(', ')}. ` +
        `Example: pnpm ops:merge-wrapper ${input.operation} --issue UTV2-123 --branch codex/utv2-123-example${examplePr}`,
    });
    process.exitCode = 1;
    return;
  }

  const result = runExtendedMergeWrapper({
    operation: input.operation as ExtendedMergeWrapperOperation,
    issue_id: input.issue_id,
    branch: input.branch,
    pr: input.pr,
    cwd: input.cwd,
    auto: input.auto,
    dry_run: input.dry_run,
    merge_method: input.merge_method,
    ttl_minutes: input.ttl_minutes,
  });

  // Post-merge hooks: capture SHA, conditionally run supabase:types
  let postMergeExtras: Record<string, unknown> = {};
  if (result.ok && input.operation === 'pr-merge' && result.code !== 'merge_wrapper_deferred' && input.pr) {
    postMergeExtras = runPostMergeHooks(input.pr, input.cwd);
  }

  emitJson({ ...result, ...postMergeExtras });
  process.exitCode = result.ok ? 0 : 1;
}

function runPostMergeHooks(pr: string, cwd: string): Record<string, unknown> {
  const hooks: string[] = [];
  let mergeSha: string | null = null;

  // Capture merge SHA via gh pr view
  try {
    const shaRun = spawnSync('gh', ['pr', 'view', pr, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'], {
      cwd,
      encoding: 'utf8',
    });
    if (shaRun.status === 0 && shaRun.stdout) {
      mergeSha = shaRun.stdout.trim() || null;
      if (mergeSha) hooks.push(`merge_sha_captured: ${mergeSha.slice(0, 8)}`);
    }
  } catch {
    hooks.push('merge_sha_capture: failed (gh unavailable)');
  }

  // Check if PR diff touched supabase/migrations/ → regenerate types
  try {
    const diffRun = spawnSync('gh', ['pr', 'diff', '--name-only', pr], { cwd, encoding: 'utf8' });
    if (diffRun.status === 0 && diffRun.stdout?.includes('supabase/migrations/')) {
      const typesRun = spawnSync('pnpm', ['supabase:types'], { cwd, encoding: 'utf8' });
      hooks.push(typesRun.status === 0
        ? 'supabase:types: regenerated'
        : `supabase:types: FAILED — ${String(typesRun.stderr ?? '').slice(0, 120)}`);
    }
  } catch {
    hooks.push('supabase:types: skipped (diff check failed)');
  }

  return { merge_sha: mergeSha, post_merge_hooks: hooks };
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  void runCli().catch((error) => {
    emitJson({
      ok: false,
      code: 'merge_wrapper_cli_failed',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    process.exitCode = 1;
  });
}
