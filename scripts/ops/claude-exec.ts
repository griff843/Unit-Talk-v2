/**
 * Canonical Claude execution entry point for Unit Talk V2 lane dispatch.
 *
 * This is the sanctioned way for the control checkout to launch Claude Code
 * against an already-started lane. It mirrors ops:codex-exec at the lane
 * boundary: manifest preconditions, worktree cwd guard, heartbeat refresh, and
 * transcript capture all happen here instead of in ad hoc shell calls.
 *
 * Usage:
 *   pnpm ops:claude-exec --issue UTV2-### [--dry-run]
 *
 * Exit codes:
 *   0 = Claude completed
 *   1 = Claude failed or CLI unavailable
 *   2 = Precondition failed
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  ensureDir,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  relativeToRoot,
  writeManifest,
  type LaneManifest,
} from './shared.js';
import { generateExecutionPacket, type ExecutionPacket } from './execution-packet.js';
import { defaultLeaseOwner, heartbeatLease } from './lease-registry.js';

export interface ClaudeExecResult {
  ok: boolean;
  code: 'SUCCESS' | 'CLAUDE_UNAVAILABLE' | 'PRECONDITION_FAILED' | 'EXECUTION_FAILED' | 'DRY_RUN';
  issue_id: string;
  branch?: string;
  message: string;
  claude_exit_code?: number;
  transcript_path?: string;
  dry_run?: boolean;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  },
) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>;

export function checkClaudeHealth(
  runner: CommandRunner = runCommand,
): { healthy: boolean; version: string | null; error: string | null } {
  const result = runner('claude', ['--version'], { timeout: 10_000 });
  if (result.error || result.status !== 0) {
    return {
      healthy: false,
      version: null,
      error: result.error?.message ?? `exit ${result.status}`,
    };
  }

  return {
    healthy: true,
    version: (result.stdout ?? '').trim().split('\n')[0] || null,
    error: null,
  };
}

export function buildClaudePrompt(packet: ExecutionPacket): string {
  return [
    '# Unit Talk V2 - Claude Lane Execution Packet',
    '',
    `Issue: ${packet.issue_id}`,
    `Tier: ${packet.tier}`,
    `Lane type: ${packet.lane_type}`,
    `Branch: ${packet.branch}`,
    `CWD: ${packet.cwd}`,
    '',
    'You are executing inside a dedicated lane worktree. Do not switch branches in the main checkout.',
    '',
    '## Required cwd guard',
    packet.cwd_guard_command,
    '',
    '## Allowed file scope',
    packet.allowed_file_scope.map((filePath) => `- ${filePath}`).join('\n') || '- [none declared]',
    '',
    '## Required verification',
    packet.required_verification.map((step) => `- ${step}`).join('\n'),
    '',
    '## Closeout instructions',
    packet.closeout_instructions.map((step) => `- ${step}`).join('\n'),
    '',
    '## Repo brief',
    packet.repo_brief,
  ].join('\n');
}

export function resolveLaneCwd(manifest: LaneManifest): string {
  const cwd = manifest.execution_location?.cwd ?? manifest.worktree_path ?? ROOT;
  return path.isAbsolute(cwd) ? cwd : path.join(ROOT, cwd);
}

export function transcriptPathForIssue(issueId: string, generatedAt = new Date()): string {
  const stamp = generatedAt.toISOString().replaceAll(':', '').replaceAll('.', '');
  return path.join(ROOT, '.out', 'ops', 'claude-exec', `${issueId}-${stamp}.log`);
}

function touchManifestHeartbeat(manifest: LaneManifest, heartbeatAt = new Date().toISOString()): LaneManifest {
  const next = { ...manifest, heartbeat_at: heartbeatAt };
  writeManifest(next);
  return next;
}

function refreshLeaseHeartbeat(manifest: LaneManifest, cwd: string): void {
  const result = heartbeatLease({
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    executor: 'claude',
    cwd,
    owner: defaultLeaseOwner(),
  });
  if (!result.ok) {
    throw new Error(`lease heartbeat failed: ${result.message}`);
  }
}

function buildClaudeArgs(prompt: string, options: { permissionMode?: string | null; model?: string | null }): string[] {
  const args = ['--print', prompt];
  if (options.permissionMode) {
    args.push('--permission-mode', options.permissionMode);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  return args;
}

function writeTranscript(
  transcriptPath: string,
  input: {
    issueId: string;
    branch: string;
    cwd: string;
    args: string[];
    result: Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'>;
  },
): void {
  ensureDir(path.dirname(transcriptPath));
  const lines = [
    `issue_id=${input.issueId}`,
    `branch=${input.branch}`,
    `cwd=${input.cwd}`,
    `command=claude ${input.args.map((arg) => (arg === input.args[1] ? '[prompt]' : arg)).join(' ')}`,
    `exit_code=${input.result.status ?? 1}`,
    `error=${input.result.error?.message ?? ''}`,
    '',
    '--- stdout ---',
    input.result.stdout ?? '',
    '',
    '--- stderr ---',
    input.result.stderr ?? '',
  ];
  fs.writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf8');
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
): Pick<SpawnSyncReturns<string>, 'status' | 'stdout' | 'stderr' | 'error'> {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: options.timeout,
    env: options.env,
  });
}

function printDryRun(result: ClaudeExecResult, prompt: string): void {
  emitJson(result);
  process.stdout.write('\n--- PROMPT PREVIEW ---\n');
  process.stdout.write(`${prompt.slice(0, 700)}\n...(truncated)\n`);
}

function main(argv = process.argv.slice(2), runner: CommandRunner = runCommand): number {
  const { flags, bools } = parseArgs(argv);
  const issueId = getFlag(flags, 'issue') ?? '';
  const dryRun = bools.has('dry-run');
  const permissionMode = getFlag(flags, 'permission-mode') ?? 'default';
  const model = getFlag(flags, 'model') ?? null;

  if (!issueId) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: '',
      message: '--issue UTV2-### is required',
    } satisfies ClaudeExecResult);
    return 2;
  }

  if (!manifestExists(issueId)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      message: `No manifest found for ${issueId}. Run pnpm ops:lane-start first.`,
    } satisfies ClaudeExecResult);
    return 2;
  }

  let manifest = readManifest(issueId);
  if (manifest.executor !== 'claude') {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Lane executor is '${manifest.executor ?? 'unset'}', not claude. Use ops:codex-exec for Codex lanes.`,
    } satisfies ClaudeExecResult);
    return 2;
  }

  const health = checkClaudeHealth(runner);
  if (!health.healthy) {
    emitJson({
      ok: false,
      code: 'CLAUDE_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Claude CLI unavailable: ${health.error}`,
    } satisfies ClaudeExecResult);
    return 1;
  }

  const cwd = resolveLaneCwd(manifest);
  if (!fs.existsSync(cwd)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Worktree CWD does not exist: ${cwd}. Run pnpm ops:lane-start to set up the worktree.`,
    } satisfies ClaudeExecResult);
    return 2;
  }

  const packet = generateExecutionPacket(manifest);
  const prompt = buildClaudePrompt(packet);
  const transcriptPath = transcriptPathForIssue(issueId);

  if (dryRun) {
    printDryRun(
      {
        ok: true,
        code: 'DRY_RUN',
        issue_id: issueId,
        branch: manifest.branch,
        message: `Dry run - would execute Claude in ${cwd}`,
        transcript_path: relativeToRoot(transcriptPath),
        dry_run: true,
      },
      prompt,
    );
    return 0;
  }

  try {
    manifest = touchManifestHeartbeat(manifest);
    refreshLeaseHeartbeat(manifest, cwd);
  } catch (error) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: error instanceof Error ? error.message : String(error),
    } satisfies ClaudeExecResult);
    return 2;
  }

  const claudeArgs = buildClaudeArgs(prompt, { permissionMode, model });
  const result = runner('claude', claudeArgs, {
    cwd,
    timeout: 60 * 60 * 1000,
    env: process.env,
  });
  writeTranscript(transcriptPath, {
    issueId,
    branch: manifest.branch,
    cwd,
    args: claudeArgs,
    result,
  });
  touchManifestHeartbeat(manifest);

  if (result.error || result.status !== 0) {
    emitJson({
      ok: false,
      code: 'EXECUTION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Claude exited with status ${result.status ?? 1}: ${result.error?.message ?? 'non-zero exit'}`,
      claude_exit_code: result.status ?? 1,
      transcript_path: relativeToRoot(transcriptPath),
    } satisfies ClaudeExecResult);
    return 1;
  }

  emitJson({
    ok: true,
    code: 'SUCCESS',
    issue_id: issueId,
    branch: manifest.branch,
    message: `Claude execution completed for ${issueId}`,
    claude_exit_code: 0,
    transcript_path: relativeToRoot(transcriptPath),
  } satisfies ClaudeExecResult);
  return 0;
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`claude-exec fatal: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
