import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadEnvironment } from '@unit-talk/config';
import {
  type LaneManifest,
  ROOT,
  currentHeadSha,
  emitJson,
  getFlag,
  getFlags,
  normalizeFileScope,
  parseArgs,
  preflightTokenPathForBranch,
  readManifest,
  relativeToRoot,
  requireIssueId,
  validateBranchName,
  validatePreflightToken,
  validateTier,
} from './ops/shared.js';

type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description?: string | null;
  priority?: number | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  project?: { name: string } | null;
  state?: { name: string } | null;
};

type DispatchResult = {
  ok: boolean;
  code: string;
  message: string;
  issue_id?: string;
  tier?: string;
  branch?: string;
  manifest_path?: string;
  worktree_path?: string;
  packet_path?: string;
  preflight_token?: string;
  file_scope_lock?: string[];
  packet?: string;
  details?: Record<string, unknown>;
};

type ChildResult = {
  status: number;
  stdout: string;
  stderr: string;
};

const CLAUDE_DIR = path.join(ROOT, '.claude');
const CODEX_QUEUE_DIR = path.join(CLAUDE_DIR, 'codex-queue');
const EXECUTION_TRUTH_MODEL_PATH = path.join(ROOT, 'docs', '05_operations', 'EXECUTION_TRUTH_MODEL.md');

export function parseForbiddenCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runPnpm(args: string[]): ChildResult {
  if (process.platform === 'win32') {
    const child = spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], {
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

  const child = spawnSync('pnpm', args, {
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

async function fetchIssue(identifier: string, apiKey: string): Promise<LinearIssue> {
  const query = `
    query FetchIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        url
        description
        priority
        project { name }
        labels(first: 20) { nodes { name } }
        state { name }
      }
    }
  `;

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { id: identifier } }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: { issue: LinearIssue | null };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }

  const issue = payload.data?.issue;
  if (!issue) {
    throw new Error(`Issue not found: ${identifier}`);
  }
  return issue;
}

function parseJsonObject(input: string): Record<string, unknown> {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Expected JSON output but received invalid payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateSuppliedTokenPath(issueId: string, branch: string, tokenPathFlag: string): string {
  const expectedRelative = relativeToRoot(preflightTokenPathForBranch(branch));
  const normalizedInput = tokenPathFlag.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (normalizedInput !== expectedRelative) {
    throw new Error(`--preflight-token must match the canonical token path ${expectedRelative}`);
  }

  validatePreflightToken(issueId, branch, currentHeadSha());
  return expectedRelative;
}

function runPreflight(
  issueId: string,
  tier: string,
  branch: string,
  files: string[],
  dryRun: boolean,
  explain: boolean,
): ChildResult {
  const args = ['ops:preflight', '--', issueId, '--tier', tier, '--branch', branch, '--json'];
  for (const filePath of files) {
    args.push('--files', filePath);
  }
  if (dryRun) {
    args.push('--dry-run');
  }
  if (explain) {
    args.push('--explain');
  }
  return runPnpm(args);
}

function runLaneStart(
  issueId: string,
  tier: string,
  branch: string,
  files: string[],
): ChildResult {
  const args = ['ops:lane-start', '--', issueId, '--tier', tier, '--branch', branch, '--lane-type', 'codex-cli'];
  for (const filePath of files) {
    args.push('--files', filePath);
  }
  return runPnpm(args);
}

function buildVerificationLines(manifest: LaneManifest): string[] {
  const lines: string[] = ['* `pnpm type-check`', '* `pnpm test`'];
  if (manifest.tier === 'T1') {
    lines.push('* `pnpm test:db`');
    lines.push('* Tier-specific runtime proof required before close');
    lines.push('* Proof bundle must validate against the merge SHA');
  } else if (manifest.tier === 'T2') {
    lines.push('* Issue-specific verification required before close');
    lines.push('* Diff summary + verification log must land at expected proof paths');
  } else {
    lines.push('* Green CI is the required proof surface for T3');
  }

  if (manifest.expected_proof_paths.length > 0) {
    lines.push('* Expected proof paths:');
    for (const proofPath of manifest.expected_proof_paths) {
      lines.push(`  - \`${proofPath}\``);
    }
  }
  return lines;
}

export function buildDispatchPacket(input: {
  issue: LinearIssue;
  manifest: LaneManifest;
  manifestPath: string;
  forbiddenFiles: string[];
}): string {
  const { issue, manifest, manifestPath, forbiddenFiles } = input;
  const labels = issue.labels?.nodes.map((label) => label.name).join(', ') ?? '';
  const priority = issue.priority != null ? `P${issue.priority}` : 'unset';
  const project = issue.project?.name ?? 'n/a';
  const description = issue.description?.trim() ?? '(no description in Linear)';
  const forbiddenSection =
    forbiddenFiles.length > 0
      ? forbiddenFiles.map((entry) => `* ${entry}`).join('\n')
      : '* none declared (all restrictions are enforced via the allowed files list above)';
  const verificationSection = buildVerificationLines(manifest).join('\n');

  return `# Codex Task Packet — ${manifest.issue_id}

Generated: ${new Date().toISOString()}
Issue URL: ${issue.url}
Priority: ${priority}  Project: ${project}  Labels: ${labels}

Lane manifest: ${manifestPath}
Branch:        ${manifest.branch}
Worktree:      ${manifest.worktree_path}
Tier:          ${manifest.tier}
Preflight:     ${manifest.preflight_token}

---

Work only this Linear issue.

## Task

* Linear issue: **${issue.identifier} — ${issue.title}**

### Why it matters
${description}

### Allowed files
${manifest.file_scope_lock.map((entry) => `* ${entry}`).join('\n')}

### Forbidden files (advisory only)
${forbiddenSection}

### Verification
${verificationSection}

### Closeout reminder
* Canonical proof is expected at:
${manifest.expected_proof_paths.length > 0 ? manifest.expected_proof_paths.map((entry) => `  - \`${entry}\``).join('\n') : '  - *(none declared for this tier)*'}

---

When done, report back with:
\`\`\`
pnpm codex:receive -- --issue ${manifest.issue_id} --branch <your-branch> --pr <pr-url>
\`\`\`
`;
}

function ensurePacketManifestTruth(
  manifest: LaneManifest,
  issueId: string,
  branch: string,
  files: string[],
  expectedWorktreePath: string,
): void {
  const normalizedFiles = normalizeFileScope(files);
  if (manifest.issue_id !== issueId) {
    throw new Error('packet_manifest_drift: manifest issue_id does not match requested issue');
  }
  if (manifest.branch !== branch) {
    throw new Error('packet_manifest_drift: manifest branch does not match requested branch');
  }
  if (manifest.worktree_path !== expectedWorktreePath) {
    throw new Error('packet_manifest_drift: manifest worktree_path does not match lane-start output');
  }
  if (JSON.stringify(manifest.file_scope_lock) !== JSON.stringify(normalizedFiles)) {
    throw new Error('packet_manifest_drift: manifest file_scope_lock does not match requested files');
  }
}

function packetPathForIssue(issueId: string, packetOut: string | undefined): string {
  if (!packetOut) {
    return path.join(CODEX_QUEUE_DIR, `${issueId}.md`);
  }
  return path.isAbsolute(packetOut) ? packetOut : path.join(ROOT, packetOut);
}

function readTierVerificationHint(tier: string): string {
  const truthModel = fs.readFileSync(EXECUTION_TRUTH_MODEL_PATH, 'utf8');
  const tierLine = truthModel
    .split(/\r?\n/)
    .find((line) => line.includes(`**${tier}**`) && line.includes('`type-check`'));
  return tierLine?.trim() ?? '';
}

function writePacket(packetPath: string, packet: string): void {
  fs.mkdirSync(path.dirname(packetPath), { recursive: true });
  fs.writeFileSync(packetPath, packet, 'utf8');
}

async function main(): Promise<number> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const dryRun = bools.has('dry-run');
  const json = bools.has('json');
  const explain = bools.has('explain');
  let issueId = '';
  let tier = '';
  let branch = '';

  try {
    if (flags.has('allowed')) {
      throw new Error('Legacy --allowed flag is removed; use repeatable --files flags instead');
    }
    issueId = requireIssueId(getFlag(flags, 'issue') ?? '');
    tier = validateTier(getFlag(flags, 'tier') ?? '');
    branch = getFlag(flags, 'branch') ?? '';
    const files = getFlags(flags, 'files');
    const forbiddenFiles = parseForbiddenCsv(getFlag(flags, 'forbidden'));
    const packetOut = getFlag(flags, 'packet-out');
    const preflightTokenFlag = getFlag(flags, 'preflight-token');
    const env = loadEnvironment();
    const linearToken = env.LINEAR_API_TOKEN?.trim();

    if (!linearToken) {
      throw Object.assign(new Error('LINEAR_API_TOKEN is required to fetch issue details.'), {
        dispatch_code: 3,
        dispatch_result: { ok: false, code: 'missing_linear_token', message: 'LINEAR_API_TOKEN is required to fetch issue details.' } satisfies DispatchResult,
      });
    }
    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (files.length === 0) {
      throw new Error('Missing required --files (repeatable, at least one required)');
    }
    validateBranchName(branch);

    const issue = await fetchIssue(issueId, linearToken);
    if (explain) {
      process.stderr.write(`Fetched ${issue.identifier}: ${issue.title}\n`);
      process.stderr.write(`State: ${issue.state?.name ?? 'unknown'}\n`);
    }

    let preflightRelativePath = relativeToRoot(preflightTokenPathForBranch(branch));
    if (preflightTokenFlag) {
      preflightRelativePath = validateSuppliedTokenPath(issueId, branch, preflightTokenFlag);
    } else {
      const preflight = runPreflight(issueId, tier, branch, files, dryRun, explain);
      if (preflight.status !== 0) {
        if (preflight.stdout) {
          process.stdout.write(`${preflight.stdout}\n`);
        }
        if (preflight.stderr) {
          process.stderr.write(`${preflight.stderr}\n`);
        }
        return preflight.status;
      }
      if (!dryRun) {
        validatePreflightToken(issueId, branch, currentHeadSha());
      }
    }

    if (dryRun) {
      const result: DispatchResult = {
        ok: true,
        code: 'dispatch_dry_run_ready',
        message: 'Dispatch validation passed; lane-start and packet write skipped due to --dry-run',
        issue_id: issueId,
        tier,
        branch,
        preflight_token: preflightRelativePath,
        details: {
          would_run_lane_start: ['pnpm', 'ops:lane-start', '--', issueId, '--tier', tier, '--branch', branch, '--lane-type', 'codex-cli', ...files.flatMap((entry) => ['--files', entry])],
          would_write_packet: relativeToRoot(packetPathForIssue(issueId, packetOut)),
          tier_verification_hint: readTierVerificationHint(tier),
        },
      };
      if (json) {
        emitJson(result);
      } else {
        process.stderr.write(`${result.message}\n`);
        process.stderr.write(`Issue: ${issue.identifier} — ${issue.title}\n`);
        process.stderr.write(`Branch: ${branch}\n`);
        process.stderr.write(`Preflight: ${preflightRelativePath}\n`);
      }
      return 0;
    }

    const laneStart = runLaneStart(issueId, tier, branch, files);
    if (laneStart.status !== 0) {
      if (laneStart.stdout) {
        process.stdout.write(`${laneStart.stdout}\n`);
      }
      if (laneStart.stderr) {
        process.stderr.write(`${laneStart.stderr}\n`);
      }
      return laneStart.status;
    }

    const laneStartJson = parseJsonObject(laneStart.stdout);
    const manifestPath = String(laneStartJson.manifest_path ?? '');
    if (!manifestPath) {
      throw new Error('lane_start_failed: missing manifest_path in lane-start output');
    }
    const manifestAbsolutePath = path.join(ROOT, manifestPath);
    if (!fs.existsSync(manifestAbsolutePath)) {
      throw new Error('lane_start_failed: manifest file missing after lane-start success');
    }

    const manifest = readManifest(issueId);
    ensurePacketManifestTruth(
      manifest,
      issueId,
      branch,
      files,
      String(laneStartJson.worktree_path ?? ''),
    );
    const packet = buildDispatchPacket({
      issue,
      manifest,
      manifestPath,
      forbiddenFiles,
    });
    const packetPath = packetPathForIssue(issueId, packetOut);

    try {
      writePacket(packetPath, packet);
    } catch (error) {
      if (!json) {
        process.stdout.write(`${packet}\n`);
      }
      const result: DispatchResult = {
        ok: false,
        code: 'packet_write_failed',
        message: `lane created, packet not written; copy from stdout or re-run dispatch once the disk issue is resolved (${error instanceof Error ? error.message : String(error)})`,
        issue_id: issueId,
        tier,
        branch,
        manifest_path: manifestPath,
        worktree_path: manifest.worktree_path,
        preflight_token: manifest.preflight_token,
        file_scope_lock: manifest.file_scope_lock,
        packet: json ? packet : undefined,
      };
      if (json) {
        emitJson(result);
      } else {
        process.stderr.write(`${result.message}\n`);
      }
      return 1;
    }

    const result: DispatchResult = {
      ok: true,
      code: 'dispatch_ready',
      message: `Codex task packet ready: ${issueId}`,
      issue_id: issueId,
      tier: manifest.tier,
      branch: manifest.branch,
      manifest_path: manifestPath,
      worktree_path: manifest.worktree_path,
      packet_path: relativeToRoot(packetPath),
      preflight_token: manifest.preflight_token,
      file_scope_lock: manifest.file_scope_lock,
      packet: json ? packet : undefined,
    };

    if (json) {
      emitJson(result);
    } else {
      process.stdout.write(`${packet}\n`);
      process.stderr.write(`${result.message}\n`);
      process.stderr.write(`Packet: ${relativeToRoot(packetPath)}\n`);
      process.stderr.write(`Manifest: ${manifestPath}\n`);
    }
    return 0;
  } catch (error) {
    const dispatched = error as { dispatch_code?: number; dispatch_result?: DispatchResult };
    const result: DispatchResult =
      dispatched.dispatch_result ??
      {
        ok: false,
        code: 'dispatch_failed',
        message: error instanceof Error ? error.message : String(error),
        issue_id: issueId || undefined,
        tier: tier || undefined,
        branch: branch || undefined,
      };
    if (json) {
      emitJson(result);
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    return dispatched.dispatch_code ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
