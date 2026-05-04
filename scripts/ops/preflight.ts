import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  type CheckResult,
  type LaneTier,
  type PreflightBaselineCache,
  type PreflightResult,
  type PreflightToken,
  type PreflightWaiver,
  EVIDENCE_BUNDLE_SCHEMA_PATH,
  LANE_MANIFEST_SCHEMA_PATH,
  PREFLIGHT_BASELINE_CACHE_PATH,
  ROOT,
  TRUTH_CHECK_RESULT_SCHEMA_PATH,
  branchExists,
  currentHeadSha,
  getFlag,
  getFlags,
  git,
  normalizeRepoRelativePath,
  parseArgs,
  preflightResultPathForBranch,
  preflightTokenPathForBranch,
  readAllManifests,
  readPreflightBaselineCache,
  relativeToRoot,
  removeFileIfExists,
  requireIssueId,
  validateBranchName,
  validatePreflightSchemaDependencies,
  validateTier,
  worktreeExists,
  worktreePathForBranch,
  writeJsonFile,
  writePreflightBaselineCache,
} from './shared.js';

type PreflightVerdict = PreflightResult['verdict'];
type LinearIssueRecord = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  state?: { name: string } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
};

// PE3 (GITHUB_TOKEN) is waivable across all tiers: the token is only needed at
// PR-creation time (ops:lane-link-pr), not during the coding/doc work itself.
// Teams using SSH-based gh auth or PAT-less local environments can waive PE3.
const WAIVABLE_CHECKS: Record<LaneTier, Set<string>> = {
  T1: new Set(['PE3']),
  T2: new Set(['PE3', 'PL4']),
  T3: new Set(['PE3', 'PB2', 'PG3', 'PL4', 'PR7']),
};

async function main(): Promise<number> {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const tierFlag = getFlag(flags, 'tier');
  const branch = getFlag(flags, 'branch');
  const json = bools.has('json');

  if (!tierFlag || !branch) {
    const result = minimalFailureResult(issueId, branch ?? '', tierFlag ?? 'T3', 'FAIL', [
      {
        id: 'ARGS',
        status: 'fail',
        detail: !tierFlag ? 'Missing required --tier' : 'Missing required --branch',
      },
    ]);
    writeOutput(result, json);
    return 1;
  }

  const tier = validateTier(tierFlag);
  validateBranchName(branch);
  const explain = bools.has('explain');
  const dryRun = bools.has('dry-run');
  const refresh = bools.has('refresh');
  const fast = bools.has('fast');
  const waiverReason = getFlag(flags, 'waiver-reason');
  const requestedSkips = [...new Set(getFlags(flags, 'skip'))];
  const requireDocs = getFlags(flags, 'require-doc').map((docPath) =>
    normalizeRepoRelativePath(docPath),
  );
  const candidateFiles = getFlags(flags, 'files');
  const tokenPath = preflightTokenPathForBranch(branch);
  const resultPath = preflightResultPathForBranch(branch);
  const runAt = new Date().toISOString();
  const headSha = currentHeadSha();
  const checks: CheckResult[] = [];
  const waivers: PreflightWaiver[] = [];

  const addCheck = (
    id: string,
    status: CheckResult['status'],
    detail: string,
  ): void => {
    checks.push({ id, status, detail });
    if (explain) {
      process.stderr.write(`[${status.toUpperCase()}] ${id} ${detail}\n`);
    }
  };

  try {
    validatePreflightSchemaDependencies();
  } catch (error) {
    const result = minimalFailureResult(issueId, branch, tier, 'INFRA', [
      {
        id: 'PS0',
        status: 'infra_error',
        detail: error instanceof Error ? error.message : String(error),
      },
    ]);
    writeSidecar(resultPath, result);
    writeOutput(result, json);
    return 3;
  }

  if (requestedSkips.length > 0 && !waiverReason) {
    const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
      {
        id: 'PS1',
        status: 'fail',
        detail: '--skip requires --waiver-reason "<text>"',
      },
    ]);
    writeSidecar(resultPath, result);
    removeFileIfExists(tokenPath);
    writeOutput(result, json);
    return 1;
  }

  const invalidSkips = requestedSkips.filter((checkId) => !WAIVABLE_CHECKS[tier].has(checkId));
  if (invalidSkips.length > 0) {
    const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
      {
        id: 'PS2',
        status: 'fail',
        detail: `Non-waivable checks requested for ${tier}: ${invalidSkips.join(', ')}`,
      },
    ]);
    writeSidecar(resultPath, result);
    removeFileIfExists(tokenPath);
    writeOutput(result, json);
    return 1;
  }

  if (fs.existsSync(tokenPath) && !refresh && !dryRun) {
    try {
      const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as PreflightToken;
      if (
        existing.status === 'pass' &&
        existing.issue_id === issueId &&
        existing.branch === branch &&
        existing.head_sha === headSha &&
        Date.parse(existing.expires_at) > Date.now()
      ) {
        const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
          {
            id: 'PS3',
            status: 'fail',
            detail: 'Non-expired token already exists; rerun with --refresh to overwrite',
          },
        ]);
        writeSidecar(resultPath, result);
        removeFileIfExists(tokenPath);
        writeOutput(result, json);
        return 1;
      }
    } catch {
      // ignore malformed token and continue with fresh evaluation
    }
  }

  const envFilePath = fs.existsSync(path.join(ROOT, 'local.env'))
    ? path.join(ROOT, 'local.env')
    : path.join(ROOT, '.env');
  const env = runEnvCheck(envFilePath, tier, addCheck);
  runRepoChecks(issueId, branch, addCheck);
  runDependencyChecks(addCheck);
  const linearState = await runLinearChecks(issueId, tier, env, candidateFiles, refresh, addCheck);
  runRequiredDocChecks(tier, linearState.labels, requireDocs, addCheck);
  if (tier === 'T1') {
    await runT1Checks(env, addCheck);
  }

  const baseline = await runBaselineChecks(
    tier,
    fast,
    headSha,
    readPreflightBaselineCache(),
    addCheck,
  );

  applyWaivers(tier, requestedSkips, waiverReason, runAt, checks, waivers);

  const result: PreflightResult = {
    schema_version: 1,
    issue_id: issueId,
    tier,
    branch,
    head_sha: headSha,
    verdict: resolveVerdict(checks),
    run_at: runAt,
    checks,
    waivers,
    token_path: relativeToRoot(tokenPath),
  };

  writeSidecar(resultPath, result);

  if (result.verdict === 'PASS') {
    if (!dryRun) {
      writeJsonFile(
        tokenPath,
        createToken(issueId, tier, branch, headSha, runAt, waivers, baseline.cacheHit, collectCheckedDocs(requireDocs, tier, linearState.labels)),
      );
      if (baseline.updatedCache) {
        writePreflightBaselineCache(baseline.updatedCache);
      }
    }
    writeOutput(result, json);
    return 0;
  }

  if (result.verdict === 'FAIL') {
    if (!dryRun) {
      removeFileIfExists(tokenPath);
    }
    writeOutput(result, json);
    return 1;
  }

  writeOutput(result, json);
  return result.verdict === 'NOT_APPLICABLE' ? 2 : 3;
}

function minimalFailureResult(
  issueId: string,
  branch: string,
  tier: string,
  verdict: PreflightVerdict,
  checks: CheckResult[],
): PreflightResult {
  return {
    schema_version: 1,
    issue_id: issueId,
    tier: (tier === 'T1' || tier === 'T2' || tier === 'T3' ? tier : 'T3') as LaneTier,
    branch,
    head_sha: '',
    verdict,
    run_at: new Date().toISOString(),
    checks,
    waivers: [],
    token_path: branch ? relativeToRoot(preflightTokenPathForBranch(branch)) : '',
  };
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 3;
  });

function runEnvCheck(
  envFilePath: string,
  tier: LaneTier,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): ReturnType<typeof loadEnvironment> | null {
  if (!fs.existsSync(envFilePath)) {
    addCheck('PE1', 'infra_error', 'Neither local.env nor .env exists at repo root');
    return null;
  }

  try {
    const env = loadEnvironment();
    addCheck('PE1', 'pass', `${path.basename(envFilePath)} is present and parseable`);
    addCheck(
      'PE5',
      credentialQuotesLookSuspicious(
        `${readOptionalFile(path.join(ROOT, '.env.example'))}\n${readOptionalFile(path.join(ROOT, '.env'))}\n${readOptionalFile(path.join(ROOT, 'local.env'))}`,
      )
        ? 'fail'
        : 'pass',
      credentialQuotesLookSuspicious(
        `${readOptionalFile(path.join(ROOT, '.env.example'))}\n${readOptionalFile(path.join(ROOT, '.env'))}\n${readOptionalFile(path.join(ROOT, 'local.env'))}`,
      )
        ? 'credential-shaped env value appears wrapped in literal quotes'
        : 'no suspicious quoted credential values detected',
    );

    const githubToken = process.env.GITHUB_TOKEN?.trim();
    if (!githubToken) {
      addCheck('PE3', 'fail', 'GITHUB_TOKEN must be present and non-empty');
    } else {
      addCheck('PE3', 'pass', 'GitHub credential present');
    }

    if (env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim()) {
      addCheck('PE2', 'pass', 'Linear credential present');
    }

    if (tier === 'T3') {
      addCheck('PE4', 'skip', 'PE4 skipped for T3');
    } else if (env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      addCheck('PE4', 'pass', 'Supabase service role credential present');
    } else {
      addCheck('PE4', 'fail', 'SUPABASE_SERVICE_ROLE_KEY must be present for T1/T2');
    }

    return env;
  } catch (error) {
    addCheck('PE1', 'infra_error', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function runRepoChecks(
  issueId: string,
  branch: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  addCheck('PG1', 'pass', 'git repo root resolved');

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (!status.ok) {
    addCheck('PG2', 'infra_error', status.stderr || 'git status failed');
  } else if (status.stdout.trim().length > 0) {
    addCheck('PG2', 'fail', 'working tree is not clean');
  } else {
    addCheck('PG2', 'pass', 'working tree is clean');
  }

  const fetchMain = git(['fetch', 'origin', 'main']);
  if (!fetchMain.ok) {
    addCheck('PG3', 'fail', `failed to fetch origin/main: ${fetchMain.stderr || 'unknown error'}`);
  } else {
    const compare = git(['rev-list', '--left-right', '--count', 'main...origin/main']);
    if (!compare.ok || !compare.stdout) {
      addCheck('PG3', 'fail', `failed to compare main with origin/main: ${compare.stderr || 'unknown error'}`);
    } else {
      const [ahead, behind] = compare.stdout.split(/\s+/).map((value) => Number.parseInt(value, 10));
      if ((behind || 0) > 0) {
        addCheck('PG3', 'fail', `local main is ${behind} commits behind origin/main`);
      } else {
        addCheck('PG3', 'pass', `local main is up to date with origin/main${(ahead || 0) > 0 ? ` and ahead by ${ahead}` : ''}`);
      }
    }
  }

  if (!branchExists(branch)) {
    addCheck('PG4', 'pass', `branch ${branch} does not yet exist locally`);
  } else {
    const currentBranch = git(['branch', '--show-current']);
    if (!currentBranch.ok) {
      addCheck('PG4', 'fail', `failed to determine current branch: ${currentBranch.stderr || 'unknown error'}`);
    } else if (currentBranch.stdout !== branch) {
      addCheck('PG4', 'fail', `current branch ${currentBranch.stdout || '(detached)'} does not match requested branch ${branch}`);
    } else {
      addCheck('PG4', 'pass', `current branch matches requested branch ${branch}`);
    }
  }

  if (!branchExists(branch)) {
    addCheck('PG5', 'pass', `branch ${branch} does not exist locally yet`);
  } else {
    const relation = git(['rev-list', '--left-right', '--count', `main...${branch}`]);
    if (!relation.ok || !relation.stdout) {
      addCheck('PG5', 'fail', `failed to compare ${branch} with main: ${relation.stderr || 'unknown error'}`);
    } else {
      const [aheadOnMain] = relation.stdout.split(/\s+/).map((value) => Number.parseInt(value, 10));
      if ((aheadOnMain || 0) > 0) {
        addCheck('PG5', 'fail', `branch ${branch} diverges from main by ${aheadOnMain} commits on main side`);
      } else {
        addCheck('PG5', 'pass', `branch ${branch} is ancestor-clean relative to main`);
      }
    }
  }

  const activeMarkers = [
    '.git/rebase-apply',
    '.git/rebase-merge',
    '.git/MERGE_HEAD',
    '.git/BISECT_LOG',
    '.git/CHERRY_PICK_HEAD',
  ].filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  if (activeMarkers.length > 0) {
    addCheck('PG6', 'fail', `git operation in progress: ${activeMarkers.join(', ')}`);
  } else {
    addCheck('PG6', 'pass', 'no active rebase, merge, bisect, or cherry-pick');
  }

  const worktreePath = worktreePathForBranch(branch);
  if (!worktreeExists(worktreePath)) {
    addCheck('PG7', 'pass', `no worktree exists at ${relativeToRoot(worktreePath)}`);
  } else {
    const matchingManifest = readAllManifests().find(
      (manifest) =>
        manifest.issue_id === issueId &&
        manifest.branch === branch &&
        manifest.worktree_path === worktreePath &&
        ['started', 'in_progress', 'blocked', 'reopened'].includes(manifest.status),
    );
    if (matchingManifest) {
      addCheck('PG7', 'pass', 'existing worktree is a sanctioned resume');
    } else {
      addCheck('PG7', 'fail', `unsanctioned worktree already exists at ${relativeToRoot(worktreePath)}`);
    }
  }

  const hooksPath = git(['config', '--get', 'core.hooksPath']);
  const configuredHooksPath = hooksPath.stdout.trim();
  const hookRoot = configuredHooksPath
    ? path.isAbsolute(configuredHooksPath)
      ? configuredHooksPath
      : path.join(ROOT, configuredHooksPath)
    : path.join(ROOT, '.git', 'hooks');
  const preCommitPath = path.join(hookRoot, 'pre-commit');
  if (/noop|null/i.test(configuredHooksPath)) {
    addCheck('PG8', 'fail', `core.hooksPath points to suspicious location ${configuredHooksPath}`);
  } else if (fs.existsSync(preCommitPath)) {
    try {
      fs.accessSync(preCommitPath, fs.constants.X_OK);
      addCheck('PG8', 'pass', 'git hooks are active and pre-commit is executable');
    } catch {
      addCheck('PG8', 'fail', 'pre-commit hook exists but is not executable');
    }
  } else {
    addCheck('PG8', 'pass', 'no pre-commit hook present and hooks path is not bypassed');
  }

  const userName = git(['config', '--get', 'user.name']);
  const userEmail = git(['config', '--get', 'user.email']);
  if (!userName.ok || !userName.stdout || !userEmail.ok || !userEmail.stdout) {
    addCheck('PG9', 'fail', 'git config user.name and user.email must both be set');
  } else {
    addCheck('PG9', 'pass', 'git config user.name and user.email are set');
  }
}

function runDependencyChecks(
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    engines?: { node?: string; pnpm?: string };
  };
  const nodeVersion = runCommand('node', ['--version']);
  if (!nodeVersion.ok) {
    addCheck('PD1', 'fail', nodeVersion.detail);
  } else if (!matchesEngine(nodeVersion.stdout.replace(/^v/, ''), packageJson.engines?.node ?? '')) {
    addCheck('PD1', 'fail', `node ${nodeVersion.stdout} does not satisfy ${packageJson.engines?.node ?? '(unspecified)'}`);
  } else {
    addCheck('PD1', 'pass', `node ${nodeVersion.stdout} satisfies ${packageJson.engines?.node}`);
  }

  const pnpmVersion = runCommand('pnpm', ['--version']);
  if (!pnpmVersion.ok) {
    addCheck('PD2', 'fail', pnpmVersion.detail);
  } else if (!matchesEngine(pnpmVersion.stdout, packageJson.engines?.pnpm ?? '')) {
    addCheck('PD2', 'fail', `pnpm ${pnpmVersion.stdout} does not satisfy ${packageJson.engines?.pnpm ?? '(unspecified)'}`);
  } else {
    addCheck('PD2', 'pass', `pnpm ${pnpmVersion.stdout} satisfies ${packageJson.engines?.pnpm}`);
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    addCheck('PD3', 'fail', 'node_modules is missing');
  } else {
    const pnpmList = runCommand('pnpm', ['list', '--depth', '0']);
    addCheck('PD3', pnpmList.ok ? 'pass' : 'fail', pnpmList.ok ? 'node_modules present and pnpm dependency resolution succeeded' : pnpmList.detail);
  }

  const tsConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8')) as {
    references?: Array<{ path?: string }>;
  };
  const missingRefs = (tsConfig.references ?? [])
    .map((reference) => reference.path)
    .filter((entry): entry is string => Boolean(entry))
    .filter((referencePath) => !fs.existsSync(path.join(ROOT, referencePath)));
  if (missingRefs.length > 0) {
    addCheck('PD4', 'fail', `missing referenced TypeScript projects: ${missingRefs.join(', ')}`);
  } else {
    addCheck('PD4', 'pass', 'TypeScript project references resolve on disk');
  }

  const lockfilePath = path.join(ROOT, 'pnpm-lock.yaml');
  const lockfileText = fs.existsSync(lockfilePath) ? fs.readFileSync(lockfilePath, 'utf8') : '';
  if (lockfileText.includes('<<<<<<<') || lockfileText.includes('=======') || lockfileText.includes('>>>>>>>')) {
    addCheck('PD5', 'fail', 'lockfile conflict markers found in pnpm-lock.yaml');
  } else {
    addCheck('PD5', 'pass', 'no lockfile conflict markers found');
  }
}

async function runLinearChecks(
  issueId: string,
  tier: LaneTier,
  env: ReturnType<typeof loadEnvironment> | null,
  candidateFiles: string[],
  refresh: boolean,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): Promise<{ labels: string[] }> {
  const token = env?.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    addCheck('PE2', 'fail', 'LINEAR_API_TOKEN or LINEAR_API_KEY must be present and non-empty');
    addCheck('PL1', 'infra_error', 'Linear credentials missing');
    addCheck('PL2', 'infra_error', 'Linear issue unavailable');
    addCheck('PL3', 'infra_error', 'Linear issue unavailable');
    addCheck('PL4', 'infra_error', 'Linear issue unavailable');
    addCheck('PL5', 'infra_error', 'Linear issue unavailable');
    addCheck('PL6', 'skip', 'PL6 skipped without issue context');
    return { labels: [] };
  }

  const issue = await fetchLinearIssue(issueId, token, addCheck);
  if (!issue) {
    addCheck('PL2', 'skip', 'PL2 skipped because the issue could not be resolved');
    addCheck('PL3', 'skip', 'PL3 skipped because the issue could not be resolved');
    addCheck('PL4', 'skip', 'PL4 skipped because the issue could not be resolved');
    addCheck('PL5', 'skip', 'PL5 skipped because the issue could not be resolved');
    addCheck('PL6', 'skip', 'PL6 skipped without issue context');
    return { labels: [] };
  }

  const labels = (issue.labels?.nodes ?? []).map((label) => label.name.toLowerCase());
  // Normalize labels: strip optional "tier:" prefix so both "t1" and "tier:t1" match
  const normalizeTierLabel = (l: string) => l.replace(/^tier:/, '');
  const tierLabels = [
    ...new Set(
      labels
        .map(normalizeTierLabel)
        .filter((label) => label === 't1' || label === 't2' || label === 't3'),
    ),
  ];
  if (tierLabels.length !== 1 || tierLabels[0] !== tier.toLowerCase()) {
    addCheck('PL2', 'fail', `issue tier labels ${tierLabels.join(', ') || '(none)'} do not match --tier ${tier}`);
  } else {
    addCheck('PL2', 'pass', `issue tier label matches ${tier}`);
  }

  const stateName = issue.state?.name ?? '';
  // Accept workflow-specific state names alongside generic "Ready" / "In Progress"
  const startableStates = new Set([
    'Ready',
    'In Progress',
    'Ready for Claude',
    'Ready for Codex',
    'In Claude Review',
    'In Codex Review',
    'Needs Standard',
  ]);
  if (startableStates.has(stateName)) {
    addCheck('PL3', 'pass', `issue state ${stateName} is startable`);
  } else if (stateName === 'Backlog' && refresh) {
    addCheck('PL3', 'waived', 'issue state Backlog tolerated via --refresh');
  } else {
    addCheck('PL3', 'fail', `issue state ${stateName || 'Unknown'} is not startable`);
  }

  if ((issue.description ?? '').trim().length > 0) {
    addCheck('PL4', 'pass', 'issue description is non-empty');
  } else {
    addCheck('PL4', 'fail', 'issue description is empty');
  }

  const conflictingManifest = readAllManifests().find(
    (manifest) => manifest.issue_id === issueId && manifest.status !== 'done',
  );
  if (conflictingManifest) {
    addCheck('PL5', 'fail', `active manifest already exists with status ${conflictingManifest.status}`);
  } else {
    addCheck('PL5', 'pass', 'no active manifest owns this issue');
  }

  if (candidateFiles.length === 0) {
    addCheck('PL6', 'skip', 'PL6 skipped without candidate --files input');
  } else {
    const normalizedFiles = candidateFiles.map((filePath) => normalizeRepoRelativePath(filePath));
    const overlap = readAllManifests()
      .filter((manifest) => ['started', 'in_progress', 'in_review', 'blocked', 'reopened'].includes(manifest.status))
      .find((manifest) => normalizedFiles.some((filePath) => (manifest.file_scope_lock ?? []).includes(filePath)));
    if (overlap) {
      addCheck('PL6', 'fail', `candidate file scope overlaps with active manifest ${overlap.issue_id}`);
    } else {
      addCheck('PL6', 'pass', 'candidate file scope does not overlap any active manifest');
    }
  }

  return { labels };
}

function runRequiredDocChecks(
  tier: LaneTier,
  linearLabels: string[],
  requireDocs: string[],
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  checkDoc('PR1', 'docs/05_operations/EXECUTION_TRUTH_MODEL.md', addCheck);
  checkDoc('PR2', 'docs/05_operations/LANE_MANIFEST_SPEC.md', addCheck);
  checkDoc('PR3', 'docs/05_operations/TRUTH_CHECK_SPEC.md', addCheck);
  checkDoc('PR4', relativeToRoot(LANE_MANIFEST_SCHEMA_PATH), addCheck);
  checkDoc('PR5', relativeToRoot(TRUTH_CHECK_RESULT_SCHEMA_PATH), addCheck);

  if (tier === 'T1' || tier === 'T2') {
    checkDoc('PR6', relativeToRoot(EVIDENCE_BUNDLE_SCHEMA_PATH), addCheck);
  } else {
    addCheck('PR6', 'skip', 'PR6 skipped for T3');
  }

  const hasPhase2Label = linearLabels.some((label) => /phase ?2/i.test(label));
  if (tier === 'T1' || hasPhase2Label) {
    checkDoc('PR7', 'docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md', addCheck);
  } else {
    addCheck('PR7', 'skip', 'PR7 skipped because no active phase contract label was detected');
  }

  if (requireDocs.length === 0) {
    addCheck('PR8', 'skip', 'PR8 skipped with no --require-doc paths');
  } else {
    const missing = requireDocs.filter((docPath) => !fs.existsSync(path.join(ROOT, docPath)));
    if (missing.length > 0) {
      addCheck('PR8', 'fail', `required docs missing: ${missing.join(', ')}`);
    } else {
      addCheck('PR8', 'pass', `required docs present: ${requireDocs.join(', ')}`);
    }
  }
}

async function runT1Checks(
  env: ReturnType<typeof loadEnvironment> | null,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): Promise<void> {
  if (!env?.SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.SUPABASE_URL?.trim()) {
    addCheck('PT1', 'fail', 'SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL are required for T1 health ping');
  } else {
    const ping = await runSupabaseHealthPing(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    addCheck('PT1', ping.ok ? 'pass' : 'infra_error', ping.detail);
  }

  const generatorPath = path.join(ROOT, 'scripts', 'evidence-bundle', 'new-bundle.mjs');
  addCheck('PT2', fs.existsSync(generatorPath) ? 'pass' : 'fail', fs.existsSync(generatorPath)
    ? 'evidence bundle generator is present'
    : 'scripts/evidence-bundle/new-bundle.mjs is missing');

  const phaseContractPath = path.join(ROOT, 'docs', '02_architecture', 'PHASE2_SCHEMA_CONTRACT.md');
  addCheck('PT3', fs.existsSync(phaseContractPath) ? 'pass' : 'fail', fs.existsSync(phaseContractPath)
    ? 'active phase contract is present and readable'
    : 'active phase contract is missing');
}

async function runBaselineChecks(
  tier: LaneTier,
  fast: boolean,
  headSha: string,
  cache: PreflightBaselineCache | null,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): Promise<{ cacheHit: boolean; updatedCache: PreflightBaselineCache | null }> {
  let updatedCache: PreflightBaselineCache | null = null;
  let cacheHit = false;

  const typeCheck = runCommand('pnpm', ['type-check']);
  addCheck('PB1', typeCheck.ok ? 'pass' : 'fail', typeCheck.ok ? 'pnpm type-check passed' : typeCheck.detail);
  if (typeCheck.ok) {
    updatedCache = {
      head_sha: headSha,
      ...(cache ?? {}),
      type_check_passed_at: new Date().toISOString(),
    };
  }

  if (tier === 'T3' && fast) {
    if (cache?.head_sha === headSha && cache.tests_passed_at) {
      cacheHit = true;
      addCheck('PB2', 'skip', `PB2 skipped via --fast using cache ${relativeToRoot(PREFLIGHT_BASELINE_CACHE_PATH)}`);
      return { cacheHit, updatedCache };
    }
    addCheck('PB2', 'fail', '--fast requested but no trusted baseline cache exists for current HEAD');
    return { cacheHit, updatedCache };
  }

  const testRun = runCommand('pnpm', ['test']);
  addCheck('PB2', testRun.ok ? 'pass' : 'fail', testRun.ok ? 'pnpm test passed' : testRun.detail);
  if (testRun.ok) {
    updatedCache = {
      head_sha: headSha,
      ...(updatedCache ?? cache ?? {}),
      tests_passed_at: new Date().toISOString(),
    };
  }

  return { cacheHit, updatedCache };
}

function applyWaivers(
  tier: LaneTier,
  requestedSkips: string[],
  waiverReason: string | undefined,
  runAt: string,
  checks: CheckResult[],
  waivers: PreflightWaiver[],
): void {
  if (!waiverReason) {
    return;
  }

  for (const checkId of requestedSkips) {
    if (!WAIVABLE_CHECKS[tier].has(checkId)) {
      continue;
    }
    const check = checks.find((entry) => entry.id === checkId);
    if (!check || check.status !== 'fail') {
      continue;
    }
    check.status = 'waived';
    check.detail = `${check.detail} (waived: ${waiverReason})`;
    waivers.push({
      check_id: checkId,
      reason: waiverReason,
      waived_at: runAt,
    });
  }
}

function resolveVerdict(checks: CheckResult[]): PreflightVerdict {
  if (checks.some((check) => check.status === 'infra_error')) {
    return 'INFRA';
  }
  if (
    checks.some(
      (check) =>
        (check.id === 'PL2' || check.id === 'PL3') &&
        check.status === 'fail',
    )
  ) {
    return 'NOT_APPLICABLE';
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 'FAIL';
  }
  return 'PASS';
}

function createToken(
  issueId: string,
  tier: LaneTier,
  branch: string,
  headSha: string,
  generatedAt: string,
  waivers: PreflightWaiver[],
  baselineCacheHit: boolean,
  requiredDocsChecked: string[],
): PreflightToken {
  const ttlMinutes = tier === 'T1' ? 15 : 30;
  return {
    schema_version: 1,
    branch,
    head_sha: headSha,
    tier,
    issue_id: issueId,
    generated_at: generatedAt,
    expires_at: new Date(Date.parse(generatedAt) + ttlMinutes * 60_000).toISOString(),
    checks: {
      git: 'pass',
      env: 'pass',
      deps: 'pass',
    },
    status: 'pass',
    waivers,
    baseline_cache_hit: baselineCacheHit,
    preflight_run_id: crypto.randomUUID(),
    required_docs_checked: requiredDocsChecked,
  };
}

function collectCheckedDocs(
  requireDocs: string[],
  tier: LaneTier,
  linearLabels: string[],
): string[] {
  const docs = [
    'docs/05_operations/EXECUTION_TRUTH_MODEL.md',
    'docs/05_operations/LANE_MANIFEST_SPEC.md',
    'docs/05_operations/TRUTH_CHECK_SPEC.md',
    relativeToRoot(LANE_MANIFEST_SCHEMA_PATH),
    relativeToRoot(TRUTH_CHECK_RESULT_SCHEMA_PATH),
  ];
  if (tier === 'T1' || tier === 'T2') {
    docs.push(relativeToRoot(EVIDENCE_BUNDLE_SCHEMA_PATH));
  }
  if (tier === 'T1' || linearLabels.some((label) => /phase ?2/i.test(label))) {
    docs.push('docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md');
  }
  docs.push(...requireDocs);
  return [...new Set(docs)];
}

function checkDoc(
  checkId: string,
  repoRelativePath: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  addCheck(
    checkId,
    fs.existsSync(path.join(ROOT, repoRelativePath)) ? 'pass' : 'fail',
    fs.existsSync(path.join(ROOT, repoRelativePath))
      ? `${repoRelativePath} exists`
      : `${repoRelativePath} is missing`,
  );
}

function writeSidecar(resultPath: string, result: PreflightResult): void {
  writeJsonFile(resultPath, result);
}

function writeOutput(result: PreflightResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  for (const check of result.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.id} - ${check.detail}`);
  }
  console.log(`VERDICT: ${result.verdict} (${result.checks.length} checks)`);
}

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function credentialQuotesLookSuspicious(raw: string): boolean {
  return raw
    .split(/\r?\n/)
    .some((line) => /(?:TOKEN|KEY|SECRET)=['"][^'"]+['"]$/.test(line.trim()));
}

function matchesEngine(version: string, range: string): boolean {
  if (!range.startsWith('>=')) {
    return version.length > 0;
  }
  return compareVersions(version, range.slice(2)) >= 0;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((entry) => Number.parseInt(entry, 10) || 0);
  const rightParts = right.split('.').map((entry) => Number.parseInt(entry, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

async function fetchLinearIssue(
  issueId: string,
  token: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): Promise<LinearIssueRecord | null> {
  try {
    const payload = await fetchJson<{
      data?: { issue: LinearIssueRecord | null };
      errors?: Array<{ message?: string }>;
    }>('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query PreflightIssue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              state { name }
              labels(first: 20) { nodes { name } }
            }
          }
        `,
        variables: { id: issueId },
      }),
    });
    if (payload.errors?.length) {
      const message = payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; ');
      if (/entity not found|not found/i.test(message)) {
        addCheck('PL1', 'fail', `Linear issue not found: ${issueId}`);
        return null;
      }
      throw new Error(message);
    }
    if (!payload.data?.issue) {
      addCheck('PL1', 'fail', `Linear issue not found: ${issueId}`);
      return null;
    }
    addCheck('PL1', 'pass', `Linear issue ${issueId} exists`);
    return payload.data.issue;
  } catch (error) {
    addCheck('PL1', 'infra_error', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function runSupabaseHealthPing(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetchJson<unknown>(`${supabaseUrl}/rest/v1/picks?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    return {
      ok: Array.isArray(response),
      detail: 'Supabase service role credential validated via read health ping',
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Request failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function runCommand(command: string, args: string[]): {
  ok: boolean;
  stdout: string;
  detail: string;
} {
  const child = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    : spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
  if (child.error) {
    return {
      ok: false,
      stdout: '',
      detail: child.error.message,
    };
  }
  return {
    ok: child.status === 0,
    stdout: (child.stdout ?? '').trim(),
    detail: child.status === 0
      ? `${command} ${args.join(' ')} passed`
      : `${command} ${args.join(' ')} failed: ${(child.stderr ?? '').trim() || (child.stdout ?? '').trim() || 'unknown error'}`,
  };
}
