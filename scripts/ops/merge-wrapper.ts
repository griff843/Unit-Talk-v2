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
  options: { cwd: string },
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
    }
  | {
      ok: false;
      code:
        | 'merge_wrapper_lock_held'
        | 'merge_wrapper_lock_failed'
        | 'merge_wrapper_command_failed'
        | 'merge_wrapper_release_failed'
        | 'merge_wrapper_invalid_input';
      issue_id?: string;
      operation?: MergeWrapperOperation;
      command?: string[];
      lock?: MergeLockResult;
      release?: MergeLockResult;
      stdout?: string;
      stderr?: string;
      message: string;
    };

export const DEFERRED_MERGE_DIR = path.join(ROOT, '.ops', 'deferred-merges');

export function buildMergeCommand(input: MergeWrapperInput): MergeCommand {
  switch (input.operation) {
    case 'pr-update-branch':
      return {
        command: 'gh',
        args: ['pr', 'update-branch', requirePr(input.pr)],
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
  const run = runner(command.command, command.args, { cwd });
  const stdout = bufferToText(run.stdout);
  const stderr = bufferToText(run.stderr);
  const release = releaseMergeLock(
    { issue_id: issueId, branch: input.branch },
    { lockPath: options.lockPath, now: new Date(now.getTime() + 1) },
  );

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
  options: { cwd: string },
): Pick<SpawnSyncReturns<Buffer>, 'status' | 'stdout' | 'stderr' | 'error'> {
  return spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'pipe',
  });
}

function bufferToText(value: Buffer | string | null | undefined): string {
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
