import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  isCodexLane,
  parseArgs,
  readManifest,
  requireIssueId,
  validateBranchName,
} from './ops/shared.js';

type ReceiveResult = {
  ok: boolean;
  code: string;
  message: string;
  issue_id?: string;
  branch?: string;
  pr_url?: string;
  manifest_path?: string;
  worktree_path?: string;
  status?: string;
  heartbeat_at?: string;
};

const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function runPnpm(args: string[]): { status: number; stdout: string; stderr: string } {
  const child = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    : spawnSync('pnpm', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
  return {
    status: child.status ?? 1,
    stdout: (child.stdout ?? '').trim(),
    stderr: (child.stderr ?? '').trim(),
  };
}

function manifestPathForIssue(issueId: string): string {
  return `docs/06_status/lanes/${issueId}.json`;
}

function parseWriterPayload(stdout: string): Record<string, unknown> {
  // emitJson uses JSON.stringify(value, null, 2) which puts '{' alone on the first line
  // and '}' alone (unindented) on the last line. pnpm may emit text or single-line JSON
  // (e.g. {"version":"10.29"}) before and after — we find the multi-line JSON block by
  // locating '{' alone on a line and the matching '}' alone on a subsequent line.
  const lines = stdout.split('\n');

  let jsonStartLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '{') {
      jsonStartLine = i;
      break;
    }
  }

  if (jsonStartLine === -1) {
    throw new Error('lane-link-pr did not emit a JSON payload');
  }

  let jsonEndLine = -1;
  for (let i = jsonStartLine + 1; i < lines.length; i++) {
    if (lines[i] === '}') {
      jsonEndLine = i;
      break;
    }
  }

  if (jsonEndLine === -1) {
    throw new Error('lane-link-pr JSON payload is malformed (no closing brace)');
  }

  return JSON.parse(lines.slice(jsonStartLine, jsonEndLine + 1).join('\n')) as Record<string, unknown>;
}

function branchExistsAnywhere(branch: string): { ok: boolean; warning?: string } {
  const local = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (local.ok) {
    return { ok: true };
  }

  // Fallback: git branch --list is more reliable in concurrent test environments
  const list = git(['branch', '--list', branch]);
  if (list.ok && list.stdout.trim().length > 0) {
    return { ok: true };
  }

  const remote = git(['ls-remote', '--exit-code', '--heads', 'origin', branch]);
  if (remote.ok) {
    return { ok: true };
  }

  const fetch = git(['fetch', 'origin', branch]);
  if (fetch.ok) {
    const fetched = git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (fetched.ok) {
      return { ok: true, warning: 'branch resolved only after fetch origin <branch>' };
    }
  }

  return { ok: false };
}

function main(argv = process.argv.slice(2)): number {
  const { flags, bools } = parseArgs(argv);
  let issueId = '';
  let branch = '';
  let prUrl = '';

  try {
    if (flags.has('skip-tests') || bools.has('skip-tests')) {
      throw new Error('Legacy --skip-tests flag is removed; codex-receive no longer runs verification gates');
    }

    issueId = requireIssueId(getFlag(flags, 'issue') ?? '');
    branch = getFlag(flags, 'branch') ?? '';
    prUrl = getFlag(flags, 'pr') ?? '';
    const dryRun = bools.has('dry-run');
    const json = bools.has('json');
    const explain = bools.has('explain');

    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (!prUrl) {
      throw new Error('Missing required --pr');
    }
    validateBranchName(branch);
    if (!PR_URL_PATTERN.test(prUrl)) {
      const result: ReceiveResult = {
        ok: false,
        code: 'pr_url_invalid',
        message: `Invalid PR URL: ${prUrl}`,
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }

    let manifest;
    try {
      manifest = readManifest(issueId);
    } catch (error) {
      const result: ReceiveResult = {
        ok: false,
        code: 'lane_missing',
        message: error instanceof Error ? error.message : String(error),
        issue_id: issueId,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }

    const manifestPath = manifestPathForIssue(issueId);
    if (manifest.branch !== branch) {
      const result: ReceiveResult = {
        ok: false,
        code: 'branch_mismatch',
        message: `Manifest branch ${manifest.branch} does not match requested branch ${branch}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        status: manifest.status,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }
    if (!isCodexLane(manifest)) {
      const result: ReceiveResult = {
        ok: false,
        code: 'lane_type_mismatch',
        message: `Manifest executor must be a Codex executor, found executor=${manifest.executor ?? 'missing'} lane_type=${manifest.lane_type}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        status: manifest.status,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }
    const manifestPrUrl = manifest.pr_url ?? undefined;
    if (manifestPrUrl && manifestPrUrl !== prUrl) {
      const result: ReceiveResult = {
        ok: false,
        code: 'pr_url_mismatch',
        message: `Manifest PR ${manifestPrUrl} does not match requested PR ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        pr_url: prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }
    if (manifest.status === 'in_review') {
      if (!manifestPrUrl) {
        const result: ReceiveResult = {
          ok: false,
          code: 'pr_url_missing',
          message: `${issueId} is in_review but manifest has no PR URL`,
          issue_id: issueId,
          manifest_path: manifestPath,
          branch: manifest.branch,
          pr_url: prUrl,
          status: manifest.status,
          heartbeat_at: manifest.heartbeat_at,
        };
        if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
        return 1;
      }
      const result: ReceiveResult = {
        ok: true,
        code: 'receive_noop',
        message: `${issueId} is already in_review for ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        pr_url: manifestPrUrl,
        worktree_path: manifest.worktree_path,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 0;
    }
    if (manifest.status === 'merged' || manifest.status === 'done') {
      if (!manifestPrUrl) {
        const result: ReceiveResult = {
          ok: false,
          code: 'pr_url_missing',
          message: `${issueId} is already ${manifest.status} but manifest has no PR URL`,
          issue_id: issueId,
          manifest_path: manifestPath,
          branch: manifest.branch,
          pr_url: prUrl,
          status: manifest.status,
          heartbeat_at: manifest.heartbeat_at,
        };
        if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
        return 1;
      }
      const result: ReceiveResult = {
        ok: true,
        code: 'receive_noop',
        message: `${issueId} is already ${manifest.status} for ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        pr_url: manifestPrUrl,
        worktree_path: manifest.worktree_path,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 0;
    }
    if (manifest.status === 'blocked') {
      const result: ReceiveResult = {
        ok: false,
        code: 'status_not_transitionable',
        message: `${issueId} is blocked and cannot transition to in_review`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        status: manifest.status,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }

    const branchCheck = branchExistsAnywhere(branch);
    if (!branchCheck.ok) {
      const result: ReceiveResult = {
        ok: false,
        code: 'branch_not_found',
        message: `Branch ${branch} was not found locally or on origin`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }
    if (explain && branchCheck.warning) {
      process.stderr.write(`${branchCheck.warning}\n`);
    }

    if (dryRun) {
      const result: ReceiveResult = {
        ok: true,
        code: 'receive_dry_run_ready',
        message: 'Receive validation passed; canonical writer skipped due to --dry-run',
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: prUrl,
        worktree_path: manifest.worktree_path,
        status: manifest.status,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 0;
    }

    const writer = runPnpm(['ops:lane-link-pr', issueId, '--branch', branch, '--pr', prUrl, '--json']);
    if (writer.status !== 0) {
      if (writer.stdout) {
        process.stdout.write(`${writer.stdout}\n`);
      }
      if (writer.stderr) {
        process.stderr.write(`${writer.stderr}\n`);
      }
      return writer.status;
    }

    const writerPayload = parseWriterPayload(writer.stdout);
    const manifestAfter = readManifest(issueId);
    if (manifestAfter.status !== 'in_review' || manifestAfter.pr_url !== prUrl) {
      const result: ReceiveResult = {
        ok: false,
        code: 'receive_manifest_drift',
        message: 'Manifest did not reflect the canonical writer output after success',
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifestAfter.branch,
        pr_url: manifestAfter.pr_url ?? undefined,
        status: manifestAfter.status,
        heartbeat_at: manifestAfter.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }

    const result: ReceiveResult = {
      ok: true,
      code: 'receive_recorded',
      message: `Receive recorded for ${issueId}`,
      issue_id: issueId,
      manifest_path: String(writerPayload.manifest_path ?? manifestPath),
      branch: manifestAfter.branch,
      pr_url: manifestAfter.pr_url ?? prUrl,
      worktree_path: manifestAfter.worktree_path,
      status: manifestAfter.status,
      heartbeat_at: manifestAfter.heartbeat_at,
    };

    if (json) {
      emitJson(result);
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    return 0;
  } catch (error) {
    const result: ReceiveResult = {
      ok: false,
      code: 'receive_failed',
      message: error instanceof Error ? error.message : String(error),
      issue_id: issueId || undefined,
      branch: branch || undefined,
      pr_url: prUrl || undefined,
    };
    if (bools.has('json')) {
      emitJson(result);
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    return /Not in a git repository/i.test(result.message) ? 3 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
