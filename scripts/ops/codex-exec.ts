/**
 * Canonical Codex execution entry point for Unit Talk V2 lane dispatch.
 *
 * This is the ONLY sanctioned way to run Codex on a lane. All dispatch
 * paths must go through here — never call `codex exec` directly.
 *
 * Usage:
 *   npx tsx scripts/ops/codex-exec.ts --issue UTV2-### [--dry-run]
 *
 * Exit codes:
 *   0 = Codex completed and PR opened
 *   1 = Codex failed or CLI unavailable
 *   2 = Precondition failed (no manifest, wrong CWD, health check failed)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  type LaneManifest,
} from './shared.js';
import { generateExecutionPacket, type ExecutionPacket } from './execution-packet.js';

interface CodexExecResult {
  ok: boolean;
  code: 'SUCCESS' | 'CODEX_UNAVAILABLE' | 'PRECONDITION_FAILED' | 'EXECUTION_FAILED' | 'DRY_RUN';
  issue_id: string;
  branch?: string;
  message: string;
  codex_exit_code?: number;
  dry_run?: boolean;
}

function checkCodexHealth(): { healthy: boolean; version: string | null; error: string | null } {
  const r = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: 10_000,
  });
  if (r.error || r.status !== 0) {
    return { healthy: false, version: null, error: r.error?.message ?? `exit ${r.status}` };
  }
  return { healthy: true, version: r.stdout.trim().split('\n')[0] ?? null, error: null };
}

function buildCodexPrompt(packet: ExecutionPacket): string {
  return [
    `# Unit Talk V2 — Lane Execution Packet`,
    ``,
    `Issue: ${packet.issue_id}`,
    `Tier: ${packet.tier}`,
    `Branch: ${packet.branch}`,
    `CWD: ${packet.cwd}`,
    ``,
    `## Allowed file scope`,
    packet.allowed_file_scope.map(f => `- ${f}`).join('\n'),
    ``,
    `## Required verification`,
    packet.required_verification.map(v => `- ${v}`).join('\n'),
    ``,
    `## Closeout instructions`,
    packet.closeout_instructions.map(c => `- ${c}`).join('\n'),
    ``,
    `## Repo brief (critical — read before touching any code)`,
    packet.repo_brief,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const issueId = getFlag(args.flags, 'issue');
  const dryRun = args.bools.has('dry-run');

  if (!issueId) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: '',
      message: '--issue UTV2-### is required',
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Load manifest
  if (!manifestExists(issueId)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      message: `No manifest found for ${issueId}. Run pnpm ops:lane-start first.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  const manifest: LaneManifest = readManifest(issueId);

  // Check executor is Codex
  if (!manifest.executor || !(['codex-cli', 'codex-cloud'] as string[]).includes(manifest.executor)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Lane executor is '${manifest.executor ?? 'unset'}', not codex-cli or codex-cloud. Use Claude for this lane.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Health check
  const health = checkCodexHealth();
  if (!health.healthy) {
    emitJson({
      ok: false,
      code: 'CODEX_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Codex CLI unavailable: ${health.error}`,
    } satisfies CodexExecResult);
    process.exit(1);
  }

  // Build packet and prompt
  const packet = generateExecutionPacket(manifest);
  const prompt = buildCodexPrompt(packet);

  if (dryRun) {
    emitJson({
      ok: true,
      code: 'DRY_RUN',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Dry run — would execute Codex in ${packet.cwd}`,
      dry_run: true,
    } satisfies CodexExecResult);
    process.stdout.write('\n--- PROMPT PREVIEW ---\n');
    process.stdout.write(prompt.slice(0, 500) + '\n...(truncated)\n');
    process.exit(0);
  }

  // Resolve worktree CWD
  const cwd = manifest.execution_location?.cwd ?? manifest.worktree_path ?? ROOT;
  const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.join(ROOT, cwd);

  if (!fs.existsSync(resolvedCwd)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Worktree CWD does not exist: ${resolvedCwd}. Run pnpm ops:lane-start to set up the worktree.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Write prompt to temp file
  const promptFile = path.join(resolvedCwd, '.codex-prompt.md');
  fs.writeFileSync(promptFile, prompt, 'utf8');

  // Execute Codex
  const child = spawnSync('codex', ['run', '--prompt-file', promptFile], {
    cwd: resolvedCwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: 30 * 60 * 1000, // 30 minute max
  });

  // Clean up prompt file
  try { fs.unlinkSync(promptFile); } catch { /* ignore */ }

  if (child.error || child.status !== 0) {
    emitJson({
      ok: false,
      code: 'EXECUTION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Codex exited with status ${child.status ?? 1}: ${child.error?.message ?? 'non-zero exit'}`,
      codex_exit_code: child.status ?? 1,
    } satisfies CodexExecResult);
    process.exit(1);
  }

  emitJson({
    ok: true,
    code: 'SUCCESS',
    issue_id: issueId,
    branch: manifest.branch,
    message: `Codex execution completed for ${issueId}`,
    codex_exit_code: 0,
  } satisfies CodexExecResult);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  main().catch(err => {
    process.stderr.write(`codex-exec fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
