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
 */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  type MergeWrapperInput,
  type MergeWrapperResult,
  type MergeWrapperOperation,
  type CommandRunner,
  buildMergeCommand,
  runMergeWrapper,
} from './merge-wrapper.js';
import {
  requireMergeLockHeld,
  type MergeLockResult,
} from './merge-mutex.js';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
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
  // runs the correct operation.
  const cmd = buildExtendedCommand(input.operation, input);
  const originalRunner = options.runner;

  const interceptingRunner: CommandRunner = (_command, _args, runOptions) => {
    const runner =
      originalRunner ??
      ((c: string, a: string[], o: { cwd: string }) =>
        spawnSync(c, a, { cwd: o.cwd, stdio: 'pipe' }) as ReturnType<CommandRunner>);
    return runner(cmd.command, cmd.args, runOptions);
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

function runCli(): void {
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
      message: `Unknown operation: ${input.operation}\nValid operations: ${[...VALID_OPS].join(', ')}\nBlocked raw commands (must use this wrapper): ${BLOCKED_RAW_COMMANDS.join(', ')}`,
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

  emitJson(result);
  process.exitCode = result.ok ? 0 : 1;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  runCli();
}
