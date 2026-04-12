import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import {
  ROOT,
  emitJson,
  getFlag,
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
  linear_comment?: 'posted' | 'skipped' | 'failed';
  warning?: string;
};

type LinearIssueResolution = {
  issueInternalId: string;
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
  return JSON.parse(stdout) as Record<string, unknown>;
}

function branchExistsAnywhere(branch: string): { ok: boolean; warning?: string } {
  const local = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (local.ok) {
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

function buildLinearComment(input: {
  issueId: string;
  manifestPath: string;
  branch: string;
  prUrl: string;
  tier: string;
  worktreePath: string;
  fileScopeLock: string[];
  expectedProofPaths: string[];
}): string {
  return [
    `**Codex returned work — ${input.issueId}**`,
    '',
    `PR:       ${input.prUrl}`,
    `Branch:   \`${input.branch}\``,
    `Tier:     ${input.tier}`,
    `Worktree: ${input.worktreePath}`,
    '',
    `Lane manifest: ${input.manifestPath}`,
    '',
    'Status: in_review (transitioned by ops:lane-link-pr)',
    '',
    '### Locked file scope',
    ...input.fileScopeLock.map((entry) => `- \`${entry}\``),
    '',
    '### Expected proof paths for close',
    ...(input.expectedProofPaths.length > 0
      ? input.expectedProofPaths.map((entry) => `- \`${entry}\``)
      : ['- *(none declared for this tier)*']),
    '',
    '---',
    '',
    `Next step: this lane closes via \`ops:lane-close ${input.issueId}\`, which runs \`ops:truth-check\``,
    'against the merge SHA and the proof paths above. Verification is CI + truth-check;',
    'codex-receive does not gate merge.',
  ].join('\n');
}

async function resolveLinearIssue(issueId: string, token: string): Promise<LinearIssueResolution> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query ResolveIssue($id: String!) {
          issue(id: $id) {
            id
          }
        }
      `,
      variables: { id: issueId },
    }),
  });
  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as {
    data?: { issue: { id: string } | null };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!payload.data?.issue?.id) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }
  return {
    issueInternalId: payload.data.issue.id,
  };
}

async function postLinearComment(issueId: string, token: string, body: string): Promise<void> {
  const resolved = await resolveLinearIssue(issueId, token);
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation CreateComment($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
          }
        }
      `,
      variables: {
        issueId: resolved.issueInternalId,
        body,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }
}

async function main(argv = process.argv.slice(2)): Promise<number> {
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
    const noLinear = bools.has('no-linear');

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

    const env = loadEnvironment();
    const linearToken = env.LINEAR_API_TOKEN?.trim();
    if (!noLinear && !linearToken) {
      const result: ReceiveResult = {
        ok: false,
        code: 'missing_linear_token',
        message: 'LINEAR_API_TOKEN is required unless --no-linear is supplied',
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 3;
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
    if (manifest.lane_type !== 'codex-cli') {
      const result: ReceiveResult = {
        ok: false,
        code: 'lane_type_mismatch',
        message: `Manifest lane_type must be codex-cli, found ${manifest.lane_type}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        status: manifest.status,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 1;
    }
    if (manifest.status === 'in_review') {
      const result: ReceiveResult = {
        ok: false,
        code: 'already_in_review',
        message: `${issueId} is already in_review`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        pr_url: manifest.pr_url ?? prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 2;
    }
    if (manifest.status === 'merged' || manifest.status === 'done') {
      const result: ReceiveResult = {
        ok: false,
        code: 'status_not_applicable',
        message: `${issueId} is already ${manifest.status}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch: manifest.branch,
        pr_url: manifest.pr_url ?? prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      };
      if (json) emitJson(result); else process.stderr.write(`${result.message}\n`);
      return 2;
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
        message: 'Receive validation passed; canonical writer and Linear comment skipped due to --dry-run',
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

    const writer = runPnpm(['ops:lane-link-pr', '--', issueId, '--branch', branch, '--pr', prUrl, '--json']);
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

    let linearComment: ReceiveResult['linear_comment'] = 'skipped';
    let warning: string | undefined;
    if (!noLinear && linearToken) {
      try {
        await postLinearComment(
          issueId,
          linearToken,
          buildLinearComment({
            issueId,
            manifestPath,
            branch: manifestAfter.branch,
            prUrl,
            tier: manifestAfter.tier,
            worktreePath: manifestAfter.worktree_path,
            fileScopeLock: manifestAfter.file_scope_lock,
            expectedProofPaths: manifestAfter.expected_proof_paths,
          }),
        );
        linearComment = 'posted';
      } catch (error) {
        linearComment = 'failed';
        warning = error instanceof Error ? error.message : String(error);
        if (!json) {
          process.stderr.write(`Linear comment failed (non-fatal): ${warning}\n`);
        }
      }
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
      linear_comment: linearComment,
      warning,
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
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
