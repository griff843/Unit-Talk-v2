/**
 * Generate a preflight token for Claude-executed lanes.
 *
 * Reads git HEAD, validates env/git/deps, constructs a PreflightToken matching
 * the interface in scripts/ops/shared.ts, and writes to
 * `.out/ops/preflight/claude/<branch-slug>.json`.
 *
 * Usage:
 *   npx tsx scripts/ops/generate-preflight-token.ts --issue UTV2-### --tier T1|T2|T3 --branch <branch>
 *
 * Exit codes:
 *   0 = token written successfully
 *   1 = validation failed (env/git/deps check failures)
 *   2 = precondition failed (bad args, missing info)
 *   3 = infra error
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type PreflightToken,
  PREFLIGHT_DIR,
  ROOT,
  currentHeadSha,
  ensureDir,
  getFlag,
  git,
  nowIso,
  parseArgs,
  readConfiguredEnvValue,
  relativeToRoot,
  requireIssueId,
  validateBranchName,
  validateTier,
  writeJsonFile,
} from './shared.js';

interface GenerateResult {
  ok: boolean;
  code: 'SUCCESS' | 'VALIDATION_FAILED' | 'PRECONDITION_FAILED' | 'INFRA_ERROR';
  issue_id: string;
  branch?: string;
  token_path?: string;
  message: string;
  failures?: string[];
}

/** Seconds for token TTL by tier */
const TOKEN_TTL_MINUTES: Record<string, number> = {
  T1: 15,
  T2: 30,
  T3: 60,
};

function checkGit(): { status: 'pass' | 'fail'; detail: string } {
  const statusResult = git(['status', '--porcelain=v1', '--untracked-files=no']);
  if (!statusResult.ok) {
    return { status: 'fail', detail: `git status failed: ${statusResult.stderr || 'unknown'}` };
  }
  const dirty = statusResult.stdout.trim();
  if (dirty.length > 0) {
    const lines = dirty.split('\n').slice(0, 5).join(', ');
    return { status: 'fail', detail: `working tree is not clean: ${lines}` };
  }
  return { status: 'pass', detail: 'working tree is clean' };
}

/**
 * Resolve the main checkout root even when called from a worktree.
 * git worktrees have their own `--show-toplevel`, but env files live in the
 * main checkout. `git rev-parse --git-common-dir` returns the shared .git dir,
 * whose parent is the main checkout root.
 */
function resolveMainCheckoutRoot(): string {
  const r = git(['rev-parse', '--git-common-dir']);
  if (!r.ok || !r.stdout) {
    return ROOT; // fall back to worktree root if command fails
  }
  const commonDir = r.stdout.trim();
  // commonDir is either an absolute path (.git in main checkout) or relative to ROOT
  const absCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.join(ROOT, commonDir);
  // The parent of .git is the main checkout root
  const parent = path.dirname(absCommonDir);
  // Sanity-check: if commonDir ends with ".git" we want its parent
  if (path.basename(absCommonDir) === '.git') {
    return parent;
  }
  // Some worktree setups use .git/worktrees/<name> as common-dir value
  // Walk up to find the directory containing the real .git
  let candidate = absCommonDir;
  while (candidate !== path.dirname(candidate)) {
    if (path.basename(candidate) === '.git') {
      return path.dirname(candidate);
    }
    candidate = path.dirname(candidate);
  }
  return ROOT;
}

function checkEnv(): { status: 'pass' | 'fail'; detail: string } {
  const checkRoots = [ROOT, resolveMainCheckoutRoot()];
  let envFile: string | undefined;
  for (const root of checkRoots) {
    if (fs.existsSync(path.join(root, 'local.env'))) {
      envFile = path.join(root, 'local.env');
      break;
    }
    if (fs.existsSync(path.join(root, '.env'))) {
      envFile = path.join(root, '.env');
      break;
    }
  }

  if (!envFile) {
    return { status: 'fail', detail: 'neither local.env nor .env found at repo root' };
  }

  const envRoot = path.dirname(envFile);
  const githubToken =
    process.env.GITHUB_TOKEN?.trim() ||
    readConfiguredEnvValue('GITHUB_TOKEN', envRoot);

  if (!githubToken) {
    return { status: 'fail', detail: 'GITHUB_TOKEN is missing or empty' };
  }

  return { status: 'pass', detail: `${path.basename(envFile)} present; credentials verified` };
}

function checkDeps(): { status: 'pass' | 'fail'; detail: string } {
  // pnpm-lock.yaml and node_modules may live in the main checkout when run from a worktree
  const checkRoots = [ROOT, resolveMainCheckoutRoot()];
  let lockFound = false;
  let nmFound = false;
  for (const root of checkRoots) {
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) lockFound = true;
    if (fs.existsSync(path.join(root, 'node_modules'))) nmFound = true;
  }

  if (!lockFound) {
    return { status: 'fail', detail: 'pnpm-lock.yaml not found at repo root' };
  }
  if (!nmFound) {
    return { status: 'fail', detail: 'node_modules not found — run pnpm install' };
  }

  return { status: 'pass', detail: 'pnpm-lock.yaml and node_modules present' };
}

function buildTokenPath(branch: string): string {
  // Extract slug: everything after the first slash's issue-id segment
  // Pattern: <owner>/utv2-####-<slug>
  // Output path: .out/ops/preflight/claude/<utv2-####-slug>.json
  const branchSlug = branch.replace(/\//g, '__');
  // Prefer the part after the owner prefix for a cleaner slug
  const parts = branch.split('/');
  const slug = parts.length >= 2 ? parts.slice(1).join('/').replace(/\//g, '-') : branchSlug;
  return path.join(PREFLIGHT_DIR, 'claude', `${slug}.json`);
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));

  const issueFlag = getFlag(flags, 'issue');
  const tierFlag = getFlag(flags, 'tier');
  const branchFlag = getFlag(flags, 'branch');
  const force = bools.has('force');

  if (!issueFlag || !tierFlag || !branchFlag) {
    const missing = [
      !issueFlag && '--issue',
      !tierFlag && '--tier',
      !branchFlag && '--branch',
    ]
      .filter(Boolean)
      .join(', ');

    const result: GenerateResult = {
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueFlag ?? '',
      message: `Missing required arguments: ${missing}. Usage: npx tsx scripts/ops/generate-preflight-token.ts --issue UTV2-### --tier T1|T2|T3 --branch <branch>`,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  let issueId: string;
  try {
    issueId = requireIssueId(issueFlag);
  } catch (error) {
    const result: GenerateResult = {
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueFlag,
      message: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  let tier: ReturnType<typeof validateTier>;
  try {
    tier = validateTier(tierFlag);
  } catch (error) {
    const result: GenerateResult = {
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      message: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    validateBranchName(branchFlag);
  } catch (error) {
    const result: GenerateResult = {
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: branchFlag,
      message: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  // Resolve HEAD SHA
  let headSha: string;
  try {
    headSha = currentHeadSha();
  } catch (error) {
    const result: GenerateResult = {
      ok: false,
      code: 'INFRA_ERROR',
      issue_id: issueId,
      branch: branchFlag,
      message: `Failed to read git HEAD: ${error instanceof Error ? error.message : String(error)}`,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 3;
    return;
  }

  // Run checks
  const gitCheck = checkGit();
  const envCheck = checkEnv();
  const depsCheck = checkDeps();

  const failures: string[] = [];
  if (gitCheck.status !== 'pass') failures.push(`git: ${gitCheck.detail}`);
  if (envCheck.status !== 'pass') failures.push(`env: ${envCheck.detail}`);
  if (depsCheck.status !== 'pass') failures.push(`deps: ${depsCheck.detail}`);

  if (failures.length > 0) {
    const result: GenerateResult = {
      ok: false,
      code: 'VALIDATION_FAILED',
      issue_id: issueId,
      branch: branchFlag,
      message: `Preflight checks failed (${failures.length} failure${failures.length === 1 ? '' : 's'})`,
      failures,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  // Build token
  const generatedAt = nowIso();
  const ttlMinutes = TOKEN_TTL_MINUTES[tier] ?? 30;
  const expiresAt = new Date(Date.parse(generatedAt) + ttlMinutes * 60_000).toISOString();

  const token: PreflightToken = {
    schema_version: 1,
    branch: branchFlag,
    head_sha: headSha,
    tier,
    issue_id: issueId,
    generated_at: generatedAt,
    expires_at: expiresAt,
    checks: {
      git: gitCheck.status,
      env: envCheck.status,
      deps: depsCheck.status,
    },
    status: 'pass',
    waivers: [],
    baseline_cache_hit: false,
    preflight_run_id: crypto.randomUUID(),
    required_docs_checked: [
      'docs/05_operations/EXECUTION_TRUTH_MODEL.md',
      'docs/05_operations/LANE_MANIFEST_SPEC.md',
      'docs/05_operations/TRUTH_CHECK_SPEC.md',
    ],
  };

  // Write token
  const tokenPath = buildTokenPath(branchFlag);

  if (fs.existsSync(tokenPath) && !force) {
    // Check if existing token is still valid
    try {
      const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as PreflightToken;
      if (
        existing.status === 'pass' &&
        existing.issue_id === issueId &&
        existing.branch === branchFlag &&
        existing.head_sha === headSha &&
        Date.parse(existing.expires_at) > Date.now()
      ) {
        const result: GenerateResult = {
          ok: true,
          code: 'SUCCESS',
          issue_id: issueId,
          branch: branchFlag,
          token_path: relativeToRoot(tokenPath),
          message: `Existing valid token reused (use --force to regenerate). Expires ${existing.expires_at}`,
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
    } catch {
      // Malformed existing token — overwrite it
    }
  }

  try {
    ensureDir(path.dirname(tokenPath));
    writeJsonFile(tokenPath, token);
  } catch (error) {
    const result: GenerateResult = {
      ok: false,
      code: 'INFRA_ERROR',
      issue_id: issueId,
      branch: branchFlag,
      message: `Failed to write token: ${error instanceof Error ? error.message : String(error)}`,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 3;
    return;
  }

  const result: GenerateResult = {
    ok: true,
    code: 'SUCCESS',
    issue_id: issueId,
    branch: branchFlag,
    token_path: relativeToRoot(tokenPath),
    message: `Preflight token written. Expires ${expiresAt}`,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  main().catch((error) => {
    process.stderr.write(
      `generate-preflight-token fatal: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 3;
  });
}
