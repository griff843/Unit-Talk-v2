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
export { buildMergeCommand, runMergeWrapper };

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
      return {
        command: 'git',
        args: ['merge', '--ff-only', 'origin/main'],
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
 * Run an extended merge wrapper operation through the merge mutex.
 *
 * For the base operations (pr-merge, pr-update-branch, main-sync),
 * delegates directly to `runMergeWrapper`. For git-merge-main and
 * git-rebase-main, acquires the mutex, runs the git command, and
 * always releases on completion or failure.
 */
export function runExtendedMergeWrapper(
  input: Omit<MergeWrapperInput, 'operation'> & {
    operation: ExtendedMergeWrapperOperation;
  },
  options: Parameters<typeof runMergeWrapper>[1] = {},
): MergeWrapperResult {
  if (input.operation === 'main-sync') {
    const ffResult = runMergeWrapper(input as MergeWrapperInput, options);
    if (ffResult.ok) return ffResult;
    // When the branch has diverged, ff-only fails. Detect that specific condition
    // and automatically fall back to rebase so callers don't need to retry manually.
    const isNotFastForward =
      ffResult.code === 'merge_wrapper_command_failed' &&
      (ffResult.stderr?.includes('not possible to fast-forward') ||
        ffResult.stderr?.includes('Cannot fast-forward') ||
        ffResult.stderr?.includes('fatal: Not possible to fast-forward'));
    if (!isNotFastForward) return ffResult;
    return runExtendedMergeWrapper({ ...input, operation: 'git-rebase-main' }, options);
  }

  if (input.operation !== 'git-merge-main' && input.operation !== 'git-rebase-main') {
    return runMergeWrapper(input as MergeWrapperInput, options);
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

  const interceptingRunner: CommandRunner = (command, args, runOptions) => {
    const isMainSyncPullCall =
      command === mainSyncPullCommand.command &&
      args.length === mainSyncPullCommand.args.length &&
      args.every((arg, i) => arg === mainSyncPullCommand.args[i]);
    if (!isMainSyncPullCall) {
      return realRunner(command, args, runOptions);
    }
    return realRunner(cmd.command, cmd.args, runOptions);
  };

  return runMergeWrapper(bridgedInput, { ...options, runner: interceptingRunner });
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
  options: { cwd: string },
): ReturnType<CommandRunner> {
  return spawnSync(command, args, { cwd: options.cwd, stdio: 'pipe' });
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

  const mergeCommand = buildMergeCommand({
    operation: 'pr-merge',
    issue_id: candidate.issue_id,
    branch: candidate.branch,
    pr: candidate.pr,
    merge_method: input.merge_method ?? 'squash',
  });
  const mergeRun = deps.runner(mergeCommand.command, mergeCommand.args, { cwd });
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
