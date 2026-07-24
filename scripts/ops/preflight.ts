import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import { requireDelegationActive } from './delegation-state.js';
import { readAllLeases } from './lease-registry.js';
import { readMergeLock } from './merge-mutex.js';
import {
  type CheckResult,
  type LaneTier,
  type PreflightBaselineCache,
  type PreflightResult,
  type PreflightToken,
  type PreflightWaiver,
  type CanonicalLaneType,
  type LaneExecutor,
  EVIDENCE_BUNDLE_SCHEMA_PATH,
  LANE_MANIFEST_SCHEMA_PATH,
  PREFLIGHT_BASELINE_CACHE_PATH,
  PREFLIGHT_DIR,
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

const CONTINUATION_ELIGIBLE_STATES = new Set([
  'In Claude',
  'In Codex',
  'In Claude Review',
  'In Codex Review',
  'In Progress',
]);

const TERMINAL_LINEAR_STATES = new Set([
  'Done',
  'Canceled',
  'Cancelled',
  'Failed',
  'Duplicate',
]);

export interface ExistingBranchReadmissionContext {
  mode: 'existing-branch-readmission';
  branch_head_sha: string;
  origin_main_sha: string;
  open_pr_number: number;
  open_pr_url: string;
  ahead_count: number;
  behind_count: number;
  requested_lane_type: CanonicalLaneType;
  executor: LaneExecutor;
  file_scope: string[];
  previous_lane_type: string | null;
  no_worktree: true;
  no_active_lease: true;
  no_active_merge_mutex: true;
}

type ExistingBranchReadmissionToken = PreflightToken & ExistingBranchReadmissionContext;

interface ExistingBranchMetadata {
  issue_id?: string;
  branch?: string;
  lane_type?: string;
}

interface OpenPullRequest {
  number: number;
  html_url: string;
  title: string;
  body: string;
  state: string;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { repo: { full_name: string } | null };
}

const CANONICAL_READMISSION_LANE_TYPES = new Set<CanonicalLaneType>([
  'runtime',
  'modeling',
  'verification',
  'hygiene',
  'migration',
  'governance',
  'delivery-ui',
  'data-canonical',
]);

const READMISSION_EXECUTORS = new Set<LaneExecutor>(['claude', 'codex-cli', 'codex-cloud']);

export function branchContainsExactIssue(branch: string, issueId: string): boolean {
  const escaped = issueId.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[/_-])${escaped}(?:$|[/_-])`).test(branch.toLowerCase());
}

export function isContinuationEligibleLinearState(state: string): boolean {
  return CONTINUATION_ELIGIBLE_STATES.has(state);
}

export function isTerminalLinearState(state: string): boolean {
  return TERMINAL_LINEAR_STATES.has(state);
}

export function parseAheadBehind(value: string): { behind: number; ahead: number } | null {
  const [behindRaw, aheadRaw, ...rest] = value.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw ?? '', 10);
  const ahead = Number.parseInt(aheadRaw ?? '', 10);
  if (rest.length > 0 || !Number.isInteger(behind) || !Number.isInteger(ahead) || behind < 0 || ahead < 0) {
    return null;
  }
  return { behind, ahead };
}

// PE3 (GITHUB_TOKEN) is waivable across all tiers: the token is only needed at
// PR-creation time (ops:lane-link-pr), not during the coding/doc work itself.
// Teams using SSH-based gh auth or PAT-less local environments can waive PE3.
const WAIVABLE_CHECKS: Record<LaneTier, Set<string>> = {
  T1: new Set(['PE3']),
  T2: new Set(['PE3', 'PL4']),
  T3: new Set(['PE3', 'PB2', 'PG3', 'PL4', 'PR7']),
};

// UTV2-1516: throttle concurrent `pnpm type-check && pnpm test` runs during
// full verify so WSL2 hosts with limited RAM don't get pushed into swap by
// several lanes running a full baseline at once.
const FULL_VERIFY_THROTTLE_ENV = 'UNIT_TALK_FULL_VERIFY_CONCURRENCY';
const FULL_VERIFY_THROTTLE_DEFAULT = 1;
export const FULL_VERIFY_THROTTLE_STALE_MS = 6 * 60 * 60 * 1000;
const FULL_VERIFY_THROTTLE_WAIT_MS = 5_000;
export const FULL_VERIFY_THROTTLE_DIR = path.join(PREFLIGHT_DIR, 'full-verify-semaphore');

export function configuredFullVerifyConcurrency(): number {
  const raw = Number.parseInt(process.env[FULL_VERIFY_THROTTLE_ENV] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : FULL_VERIFY_THROTTLE_DEFAULT;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readThrottleOwner(slotPath: string): { pid?: number; acquired_at?: string } | null {
  const ownerPath = path.join(slotPath, 'owner.json');
  if (!fs.existsSync(ownerPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { pid?: number; acquired_at?: string };
  } catch {
    return null;
  }
}

function releaseStaleThrottleSlot(slotPath: string, staleMs: number): void {
  const owner = readThrottleOwner(slotPath);
  const parsed = owner?.acquired_at ? Date.parse(owner.acquired_at) : NaN;
  const acquiredAt = Number.isFinite(parsed)
    ? parsed
    : fs.existsSync(slotPath)
      ? fs.statSync(slotPath).mtimeMs
      : NaN;
  // An epoch-zero (or otherwise falsy-but-valid) timestamp must still count as
  // known age -- only a genuinely unparseable/missing timestamp skips reclaim.
  if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt <= staleMs) {
    return;
  }
  fs.rmSync(slotPath, { recursive: true, force: true });
}

export function acquireFullVerifyThrottle(
  dir: string = FULL_VERIFY_THROTTLE_DIR,
  maxConcurrent: number = configuredFullVerifyConcurrency(),
  staleMs: number = FULL_VERIFY_THROTTLE_STALE_MS,
): { slot: number; slotPath: string; maxConcurrent: number } {
  fs.mkdirSync(dir, { recursive: true });

  for (;;) {
    for (let slot = 0; slot < maxConcurrent; slot += 1) {
      const slotPath = path.join(dir, `slot-${slot}`);
      releaseStaleThrottleSlot(slotPath, staleMs);
      try {
        fs.mkdirSync(slotPath);
        fs.writeFileSync(
          path.join(slotPath, 'owner.json'),
          `${JSON.stringify({
            pid: process.pid,
            acquired_at: new Date().toISOString(),
            cwd: ROOT,
            command: 'pnpm type-check && pnpm test',
          }, null, 2)}\n`,
          'utf8',
        );
        return { slot, slotPath, maxConcurrent };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }
      }
    }
    sleepSync(FULL_VERIFY_THROTTLE_WAIT_MS);
  }
}

export function releaseFullVerifyThrottle(throttle: { slotPath: string }): void {
  fs.rmSync(throttle.slotPath, { recursive: true, force: true });
}

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
  const docsOnlyFastPath = bools.has('docs-only-fast-path') || flags.has('docs-only-fast-path');
  const readmitExistingBranch =
    bools.has('readmit-existing-branch') || flags.has('readmit-existing-branch');
  const waiverReason = getFlag(flags, 'waiver-reason');
  const requestedSkips = [...new Set(getFlags(flags, 'skip'))];
  const requireDocs = getFlags(flags, 'require-doc').map((docPath) =>
    normalizeRepoRelativePath(docPath),
  );
  const candidateFiles = getFlags(flags, 'files');
  const normalizedCandidateFiles = candidateFiles.map((filePath) => normalizeRepoRelativePath(filePath));
  const requestedLaneType = getFlag(flags, 'lane-type');
  const requestedExecutor = getFlag(flags, 'executor');
  const tokenPath = preflightTokenPathForBranch(branch);
  const resultPath = preflightResultPathForBranch(branch);
  const runAt = new Date().toISOString();
  const headSha = currentHeadSha();
  const checks: CheckResult[] = [];
  const waivers: PreflightWaiver[] = [];

  // UTV2-1546: delegation kill switch. This must run before every other check
  // below -- including validatePreflightSchemaDependencies(), which is cheap
  // but is still the first real work this function does -- and long before any
  // Linear call, baseline verify/test run, or token write. A suspended (or
  // missing/malformed) delegation state fails preflight closed here,
  // unconditionally, regardless of tier or any --skip/--waiver-reason
  // combination (delegation is not a WAIVABLE_CHECKS entry and never will be).
  // This is a governance brake against runaway automation, not a security
  // boundary -- see delegation-state.ts's doc comment.
  const delegationCheck = requireDelegationActive('preflight');
  if (!delegationCheck.ok) {
    const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
      { id: 'PK1', status: 'fail', detail: delegationCheck.message },
    ]);
    writeSidecar(resultPath, result);
    removeFileIfExists(tokenPath);
    writeOutput(result, json);
    return 1;
  }

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

  if (readmitExistingBranch) {
    if (docsOnlyFastPath) {
      const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
        {
          id: 'PRA0',
          status: 'fail',
          detail: '--readmit-existing-branch cannot be combined with --docs-only-fast-path',
        },
      ]);
      writeSidecar(resultPath, result);
      removeFileIfExists(tokenPath);
      writeOutput(result, json);
      return 1;
    }
    const missingReadmissionArgs = [
      ...(!requestedLaneType ? ['--lane-type'] : []),
      ...(!requestedExecutor ? ['--executor'] : []),
      ...(normalizedCandidateFiles.length === 0 ? ['--files'] : []),
    ];
    if (missingReadmissionArgs.length > 0) {
      const result = minimalFailureResult(issueId, branch, tier, 'FAIL', [
        {
          id: 'PRA0',
          status: 'fail',
          detail:
            `--readmit-existing-branch requires explicit ${missingReadmissionArgs.join(', ')}; ` +
            'readmission never inherits prior authority metadata',
        },
      ]);
      writeSidecar(resultPath, result);
      removeFileIfExists(tokenPath);
      writeOutput(result, json);
      return 1;
    }
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
  const readmissionContext = readmitExistingBranch
    ? runExistingBranchReadmissionChecks({
        issueId,
        tier,
        branch,
        requestedLaneType: requestedLaneType!,
        requestedExecutor: requestedExecutor!,
        fileScope: normalizedCandidateFiles,
        addCheck,
      })
    : null;
  runRepoChecks(issueId, branch, addCheck, readmitExistingBranch, readmissionContext);
  runDependencyChecks(addCheck);
  validateDocsOnlyFastPath(tier, docsOnlyFastPath, normalizedCandidateFiles, addCheck);
  const linearState = await runLinearChecks(
    issueId,
    tier,
    env,
    normalizedCandidateFiles,
    refresh,
    addCheck,
    readmitExistingBranch,
    branch,
  );
  runRequiredDocChecks(tier, linearState.labels, requireDocs, addCheck);
  runGateEquivalentChecks(issueId, tier, branch, headSha, addCheck);
  if (tier === 'T1') {
    await runT1Checks(env, addCheck);
  }

  const baseline = await runBaselineChecks(
    tier,
    fast,
    docsOnlyFastPath,
    headSha,
    readPreflightBaselineCache(),
    linearState.labels,
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
        createToken(
          issueId,
          tier,
          branch,
          headSha,
          runAt,
          waivers,
          baseline.cacheHit,
          collectCheckedDocs(requireDocs, tier, linearState.labels),
          readmissionContext,
        ),
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

  // A prior passing readmission token must not survive a later terminal,
  // non-startable, or infrastructure result. Lane-start deliberately does not
  // call Linear again, so leaving that token in place would allow stale
  // continuation authority to remain usable until its TTL expires. Preserve
  // normal-mode behavior; this stricter invalidation belongs to the explicit
  // readmission contract.
  if (readmitExistingBranch && !dryRun) {
    removeFileIfExists(tokenPath);
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

// UTV2-1516: guarded so this module is safe to import (e.g. from unit tests
// that exercise the throttle functions below) without re-running a full,
// real preflight check as an import side effect. Matches the same pattern
// scripts/ci/file-scope-guard.ts already uses for the same reason.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 3;
    });
}

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

    const githubToken = process.env.GITHUB_TOKEN?.trim() || readConfiguredEnvValue('GITHUB_TOKEN')?.trim();
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

function runExistingBranchReadmissionChecks(input: {
  issueId: string;
  tier: LaneTier;
  branch: string;
  requestedLaneType: string;
  requestedExecutor: string;
  fileScope: string[];
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void;
}): ExistingBranchReadmissionContext | null {
  const { issueId, branch, requestedLaneType, requestedExecutor, fileScope, addCheck } = input;
  let failed = false;
  const check = (id: string, ok: boolean, pass: string, fail: string): void => {
    addCheck(id, ok ? 'pass' : 'fail', ok ? pass : fail);
    failed ||= !ok;
  };

  const laneTypeValid = CANONICAL_READMISSION_LANE_TYPES.has(requestedLaneType as CanonicalLaneType);
  check(
    'PRA1',
    laneTypeValid,
    `requested lane type is explicit: ${requestedLaneType}`,
    `invalid readmission --lane-type ${requestedLaneType}`,
  );
  const executorValid = READMISSION_EXECUTORS.has(requestedExecutor as LaneExecutor);
  check(
    'PRA2',
    executorValid,
    `requested executor is explicit: ${requestedExecutor}`,
    `invalid readmission --executor ${requestedExecutor}`,
  );
  check(
    'PRA3',
    fileScope.length > 0,
    `requested file scope recorded (${fileScope.length} paths)`,
    'readmission requires a non-empty explicit file scope',
  );
  check(
    'PRA4',
    branchContainsExactIssue(branch, issueId),
    `branch contains exact issue identifier ${issueId}`,
    `branch ${branch} does not contain exact issue identifier ${issueId}`,
  );

  const currentBranch = git(['branch', '--show-current']);
  check(
    'PRA5',
    currentBranch.ok && currentBranch.stdout === 'main',
    'invoking checkout is exactly main',
    `readmission must run from main, got ${currentBranch.stdout || currentBranch.stderr || '(detached)'}`,
  );

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  const dirtyPaths = status.ok ? parsePorcelainPaths(status.stdout) : [];
  const unsafeDirtyPaths = dirtyPaths.filter((entry) => !isLaneRegistryPath(entry));
  check(
    'PRA6',
    status.ok && unsafeDirtyPaths.length === 0,
    dirtyPaths.length === 0
      ? 'main control checkout is clean'
      : `main control checkout has only permitted registry state (${dirtyPaths.length} paths)`,
    status.ok
      ? `main control checkout has non-registry changes: ${unsafeDirtyPaths.join(', ')}`
      : `git status failed: ${status.stderr}`,
  );

  const fetchMain = git(['fetch', 'origin', 'main']);
  const mainSha = git(['rev-parse', 'main']);
  const originMainSha = git(['rev-parse', 'origin/main']);
  check(
    'PRA7',
    fetchMain.ok &&
      mainSha.ok &&
      originMainSha.ok &&
      mainSha.stdout === originMainSha.stdout &&
      currentHeadSha() === mainSha.stdout,
    `local main exactly matches origin/main at ${originMainSha.stdout}`,
    'local main, current HEAD, and origin/main must resolve to the same commit',
  );

  // Fetch the named branch without creating or checking out a local branch.
  git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  const localRef = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok
    ? `refs/heads/${branch}`
    : null;
  const remoteRef = git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).ok
    ? `refs/remotes/origin/${branch}`
    : null;
  const targetRef = localRef ?? remoteRef;
  check(
    'PRA8',
    targetRef !== null,
    `target branch exists at ${targetRef ?? ''}`,
    `target branch ${branch} does not exist locally or on origin`,
  );

  const worktreeList = git(['worktree', 'list', '--porcelain']);
  const branchWorktreePresent =
    worktreeList.ok &&
    worktreeList.stdout
      .split(/\n\n+/)
      .some((block) => block.split(/\r?\n/).includes(`branch refs/heads/${branch}`));
  check(
    'PRA9',
    worktreeList.ok && !branchWorktreePresent && !worktreeExists(worktreePathForBranch(branch)),
    'no worktree exists for the target branch',
    `a worktree already exists for ${branch}`,
  );

  let noActiveLease = false;
  try {
    const conflictingLease = readAllLeases().find(
      (lease) =>
        (lease.issue_id === issueId || lease.branch === branch) &&
        (lease.status === 'active' || lease.status === 'stale_reclaim_required'),
    );
    noActiveLease = !conflictingLease;
    check(
      'PRA10',
      noActiveLease,
      'no active lease exists for the issue or branch',
      `active lease exists for ${conflictingLease?.issue_id ?? issueId}`,
    );
  } catch (error) {
    check(
      'PRA10',
      false,
      '',
      `lease registry could not be validated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const mergeLock = readMergeLock();
  const sameIssueActiveMergeLock =
    mergeLock.ok && mergeLock.lock.issue_id === issueId && mergeLock.lock.status !== 'released';
  check(
    'PRA11',
    mergeLock.code === 'merge_lock_missing' ||
      (mergeLock.ok && !sameIssueActiveMergeLock) ||
      (!mergeLock.ok && mergeLock.code === 'merge_lock_missing'),
    'no active merge mutex is owned by the issue',
    sameIssueActiveMergeLock
      ? `active merge mutex is owned by ${issueId}`
      : `merge mutex state could not be validated: ${mergeLock.message}`,
  );

  let branchHeadSha = '';
  let behindCount = -1;
  let aheadCount = -1;
  if (targetRef) {
    const head = git(['rev-parse', targetRef]);
    branchHeadSha = head.ok ? head.stdout : '';
    const mergeBase = git(['merge-base', 'origin/main', targetRef]);
    check(
      'PRA12',
      head.ok && mergeBase.ok && Boolean(mergeBase.stdout),
      `target branch has merge base ${mergeBase.stdout} with current main`,
      `target branch ${branch} has unrelated or invalid history`,
    );
    const relation = git(['rev-list', '--left-right', '--count', `origin/main...${targetRef}`]);
    const parsedRelation = relation.ok ? parseAheadBehind(relation.stdout) : null;
    if (parsedRelation) {
      behindCount = parsedRelation.behind;
      aheadCount = parsedRelation.ahead;
    }
    check(
      'PRA13',
      parsedRelation !== null,
      `target divergence recorded exactly: ahead=${aheadCount}, behind=${behindCount}`,
      `could not calculate target divergence: ${relation.stderr || relation.stdout}`,
    );
  } else {
    check('PRA12', false, '', 'target branch history is unavailable');
    check('PRA13', false, '', 'target branch divergence is unavailable');
  }

  const repository = readCurrentRepository();
  const pullRequests = repository ? readOpenPullRequests(repository, branch) : [];
  const pullRequest = pullRequests.length === 1 ? pullRequests[0]! : null;
  check(
    'PRA14',
    Boolean(
      pullRequest &&
        pullRequest.state === 'open' &&
        pullRequest.head.ref === branch &&
        pullRequest.head.sha === branchHeadSha,
    ),
    `open PR #${pullRequest?.number ?? 0} exactly matches ${branch}@${branchHeadSha}`,
    pullRequests.length === 0
      ? `no open PR exactly matches branch ${branch}`
      : pullRequests.length > 1
        ? `multiple open PRs match branch ${branch}`
        : `open PR head does not match ${branch}@${branchHeadSha}`,
  );
  check(
    'PRA15',
    Boolean(
      repository &&
        pullRequest?.head.repo?.full_name === repository &&
        pullRequest?.base.repo?.full_name === repository,
    ),
    `PR head, PR base, and branch resolve to ${repository}`,
    'PR and branch do not resolve to the same repository',
  );

  const branchMetadata = targetRef ? readExistingBranchMetadata(targetRef, issueId) : null;
  const controlMetadata = readAllManifests().find((manifest) => manifest.issue_id === issueId) ?? null;
  const metadata = branchMetadata ?? controlMetadata;
  const metadataMatches =
    metadata === null || (metadata.issue_id === issueId && metadata.branch === branch);
  check(
    'PRA16',
    metadataMatches,
    metadata
      ? `existing metadata matches ${issueId} on ${branch}; previous lane type=${metadata.lane_type ?? 'unknown'}`
      : 'no prior branch metadata was found',
    `existing branch metadata belongs to ${metadata?.issue_id ?? 'unknown'} on ${metadata?.branch ?? 'unknown'}`,
  );

  if (
    failed ||
    !laneTypeValid ||
    !executorValid ||
    !targetRef ||
    !pullRequest ||
    !repository ||
    !noActiveLease ||
    !branchHeadSha ||
    behindCount < 0 ||
    aheadCount < 0
  ) {
    return null;
  }

  return {
    mode: 'existing-branch-readmission',
    branch_head_sha: branchHeadSha,
    origin_main_sha: originMainSha.stdout,
    open_pr_number: pullRequest.number,
    open_pr_url: pullRequest.html_url,
    ahead_count: aheadCount,
    behind_count: behindCount,
    requested_lane_type: requestedLaneType as CanonicalLaneType,
    executor: requestedExecutor as LaneExecutor,
    file_scope: [...fileScope].sort(),
    previous_lane_type: metadata?.lane_type ?? null,
    no_worktree: true,
    no_active_lease: true,
    no_active_merge_mutex: true,
  };
}

function readCurrentRepository(): string | null {
  const result = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function readOpenPullRequests(repository: string, branch: string): OpenPullRequest[] {
  const owner = repository.split('/')[0] ?? '';
  const result = spawnSync(
    'gh',
    [
      'api',
      '--method',
      'GET',
      `repos/${repository}/pulls`,
      '-f',
      'state=open',
      '-f',
      `head=${owner}:${branch}`,
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
  );
  if (result.status !== 0) {
    return [];
  }
  try {
    return JSON.parse(result.stdout) as OpenPullRequest[];
  } catch {
    return [];
  }
}

function readExistingBranchMetadata(targetRef: string, issueId: string): ExistingBranchMetadata | null {
  const result = git(['show', `${targetRef}:docs/06_status/lanes/${issueId}.json`]);
  if (!result.ok) {
    return null;
  }
  try {
    return JSON.parse(result.stdout) as ExistingBranchMetadata;
  } catch {
    return { issue_id: '__malformed__', branch: '__malformed__', lane_type: '__malformed__' };
  }
}

function runRepoChecks(
  issueId: string,
  branch: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  readmitExistingBranch = false,
  readmissionContext: ExistingBranchReadmissionContext | null = null,
): void {
  addCheck('PG1', 'pass', 'git repo root resolved');

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (!status.ok) {
    addCheck('PG2', 'infra_error', status.stderr || 'git status failed');
  } else if (status.stdout.trim().length > 0) {
    const dirtyPaths = parsePorcelainPaths(status.stdout);
    const nonRegistryDirtyPaths = dirtyPaths.filter((dirtyPath) => !isLaneRegistryPath(dirtyPath));
    if (nonRegistryDirtyPaths.length > 0) {
      addCheck('PG2', 'fail', `working tree is not clean: ${nonRegistryDirtyPaths.slice(0, 5).join(', ')}${nonRegistryDirtyPaths.length > 5 ? ` +${nonRegistryDirtyPaths.length - 5} more` : ''}`);
    } else {
      addCheck('PG2', 'pass', `working tree has only lane registry changes (${dirtyPaths.length})`);
    }
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

  if (readmitExistingBranch) {
    const currentBranch = git(['branch', '--show-current']);
    if (!currentBranch.ok) {
      addCheck('PG4', 'fail', `failed to determine current branch: ${currentBranch.stderr || 'unknown error'}`);
    } else if (currentBranch.stdout !== 'main') {
      addCheck('PG4', 'fail', `existing-branch readmission must run from main, got ${currentBranch.stdout || '(detached)'}`);
    } else {
      addCheck('PG4', 'pass', 'existing-branch readmission is running from the main control checkout');
    }
  } else if (!branchExists(branch)) {
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

  if (readmitExistingBranch) {
    if (readmissionContext) {
      addCheck(
        'PG5',
        'pass',
        `existing branch divergence recorded: ahead=${readmissionContext.ahead_count}, behind=${readmissionContext.behind_count}`,
      );
    } else {
      addCheck('PG5', 'fail', 'existing branch divergence could not be validated');
    }
  } else if (!branchExists(branch)) {
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

function runGateEquivalentChecks(
  issueId: string,
  tier: LaneTier,
  branch: string,
  headSha: string,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  const verifyQuick = runCommand('pnpm', ['verify:quick']);
  addCheck(
    'PX1',
    verifyQuick.ok ? 'pass' : 'fail',
    verifyQuick.ok ? 'pnpm verify:quick passed' : verifyQuick.detail,
  );

  const commits = git(['log', '--format=%s', 'main..HEAD']);
  const branchDiscipline = runCommand('pnpm', [
    'ops:branch-discipline',
    '--',
    '--branch',
    branch,
    '--title',
    issueId,
    '--commits',
    commits.ok ? commits.stdout : '',
  ]);
  addCheck(
    'PX2',
    branchDiscipline.ok ? 'pass' : 'fail',
    branchDiscipline.ok
      ? 'branch and commit issue references are disciplined'
      : branchDiscipline.detail,
  );

  // PX3 (proof-auditor-gate), PX4 (runtime-verifier-gate), and PX5 (T1 proof
  // dir existence) were removed here (UTV2-1492). Proof/runtime evidence
  // content validation belongs exclusively to later lifecycle phases —
  // proof-gate.yml (CI on pull_request, after a real diff exists) and
  // truth-check-lib.ts's runTruthCheck (invoked by ops:lane-close, gated
  // behind manifest.status ∈ {merged, done}). Preflight runs before a lane
  // or implementation exists, so it must never require implementation
  // evidence — see docs/05_operations/EXECUTION_TRUTH_MODEL.md's lifecycle
  // invariant: "every gate belongs to exactly one lifecycle phase."
  // Declared-proof-path validation for T1 (formerly PX5) now happens in
  // lane-start.ts immediately after manifest creation, where a manifest
  // (and therefore expected_proof_paths) actually exists to validate.
  void tier;
  void headSha;
}

async function runLinearChecks(
  issueId: string,
  tier: LaneTier,
  env: ReturnType<typeof loadEnvironment> | null,
  candidateFiles: string[],
  refresh: boolean,
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
  readmitExistingBranch = false,
  branch = '',
): Promise<{ labels: string[]; stateName: string }> {
  const token = env?.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    addCheck('PE2', 'fail', 'LINEAR_API_TOKEN or LINEAR_API_KEY must be present and non-empty');
    addCheck('PL1', 'infra_error', 'Linear credentials missing');
    addCheck('PL2', 'infra_error', 'Linear issue unavailable');
    addCheck('PL3', 'infra_error', 'Linear issue unavailable');
    addCheck('PL4', 'infra_error', 'Linear issue unavailable');
    addCheck('PL5', 'infra_error', 'Linear issue unavailable');
    addCheck('PL6', 'skip', 'PL6 skipped without issue context');
    return { labels: [], stateName: '' };
  }

  const issue = await fetchLinearIssue(issueId, token, addCheck);
  if (!issue) {
    addCheck('PL2', 'skip', 'PL2 skipped because the issue could not be resolved');
    addCheck('PL3', 'skip', 'PL3 skipped because the issue could not be resolved');
    addCheck('PL4', 'skip', 'PL4 skipped because the issue could not be resolved');
    addCheck('PL5', 'skip', 'PL5 skipped because the issue could not be resolved');
    addCheck('PL6', 'skip', 'PL6 skipped without issue context');
    return { labels: [], stateName: '' };
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
  if (readmitExistingBranch && isTerminalLinearState(stateName)) {
    addCheck('PL3', 'fail', `terminal issue state ${stateName} cannot be readmitted`);
  } else if (readmitExistingBranch && isContinuationEligibleLinearState(stateName)) {
    addCheck('PL3', 'pass', `issue state ${stateName} is explicitly continuation-eligible`);
  } else if (readmitExistingBranch) {
    addCheck('PL3', 'fail', `issue state ${stateName || 'Unknown'} is not continuation-eligible`);
  } else if (startableStates.has(stateName)) {
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
  if (
    readmitExistingBranch &&
    conflictingManifest &&
    conflictingManifest.branch === branch
  ) {
    addCheck(
      'PL5',
      'pass',
      `existing metadata matches readmission issue and branch (status ${conflictingManifest.status})`,
    );
  } else if (conflictingManifest) {
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
      .filter((manifest) => !readmitExistingBranch || manifest.issue_id !== issueId)
      .find((manifest) => normalizedFiles.some((filePath) => (manifest.file_scope_lock ?? []).includes(filePath)));
    if (overlap) {
      addCheck('PL6', 'fail', `candidate file scope overlaps with active manifest ${overlap.issue_id}`);
    } else {
      addCheck('PL6', 'pass', 'candidate file scope does not overlap any active manifest');
    }
  }

  return { labels, stateName };
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
  docsOnlyFastPath: boolean,
  headSha: string,
  cache: PreflightBaselineCache | null,
  linearLabels: string[],
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): Promise<{ cacheHit: boolean; updatedCache: PreflightBaselineCache | null }> {
  let updatedCache: PreflightBaselineCache | null = null;
  let cacheHit = false;

  if (docsOnlyFastPath && tier === 'T3') {
    addCheck('PB1', 'skip', 'PB1 skipped via T3 docs-only fast path; CI/pnpm verify remains required before PR');
    addCheck('PB2', 'skip', 'PB2 skipped via T3 docs-only fast path; CI/pnpm verify remains required before PR');
    return { cacheHit, updatedCache };
  }

  if (fast && fastBaselineAllowed(tier, linearLabels)) {
    if (cache?.head_sha === headSha && cache.type_check_passed_at && cache.tests_passed_at) {
      cacheHit = true;
      addCheck('PB1', 'skip', `PB1 skipped via --fast using trusted cache ${relativeToRoot(PREFLIGHT_BASELINE_CACHE_PATH)}`);
      addCheck('PB2', 'skip', `PB2 skipped via --fast using trusted cache ${relativeToRoot(PREFLIGHT_BASELINE_CACHE_PATH)}`);
      return { cacheHit, updatedCache: cache };
    }
    addCheck('PB1', 'fail', '--fast requested but no trusted type-check cache exists for current HEAD');
    addCheck('PB2', 'fail', '--fast requested but no trusted test cache exists for current HEAD');
    return { cacheHit, updatedCache };
  }

  const throttle = acquireFullVerifyThrottle();
  const throttleDetail = `full-verify throttle slot ${throttle.slot + 1}/${throttle.maxConcurrent}`;
  let testRun: ReturnType<typeof runCommand> = {
    ok: false,
    stdout: '',
    detail: 'pnpm test did not run because preflight baseline failed before test execution',
  };
  try {
    const typeCheck = runCommand('pnpm', ['type-check']);
    addCheck('PB1', typeCheck.ok ? 'pass' : 'fail', typeCheck.ok ? 'pnpm type-check passed' : typeCheck.detail);
    if (typeCheck.ok) {
      updatedCache = {
        ...(cache ?? {}),
        head_sha: headSha,
        type_check_passed_at: new Date().toISOString(),
      };
    }

    testRun = runCommand('pnpm', ['test']);
  } finally {
    releaseFullVerifyThrottle(throttle);
  }
  addCheck(
    'PB2',
    testRun.ok ? 'pass' : 'fail',
    testRun.ok ? `pnpm test passed after ${throttleDetail}` : testRun.detail,
  );
  if (testRun.ok) {
    updatedCache = {
      ...(updatedCache ?? cache ?? {}),
      head_sha: headSha,
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
  readmissionContext: ExistingBranchReadmissionContext | null = null,
): PreflightToken | ExistingBranchReadmissionToken {
  const ttlMinutes = tier === 'T1' ? 15 : 30;
  const token: PreflightToken = {
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
  return readmissionContext ? { ...token, ...readmissionContext } : token;
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
  console.log('');
  console.log('Preflight summary');
  console.log('| Check | Status | Detail |');
  console.log('| --- | --- | --- |');
  for (const check of result.checks) {
    console.log(`| ${check.id} | ${check.status.toUpperCase()} | ${formatTableCell(check.detail)} |`);
  }
  console.log(`VERDICT: ${result.verdict} (${result.checks.length} checks)`);
}

function formatTableCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readConfiguredEnvValue(key: string): string | undefined {
  let value: string | undefined;
  for (const fileName of ['.env.example', '.env', 'local.env']) {
    const filePath = path.join(ROOT, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }
      const entryKey = trimmed.slice(0, separatorIndex).trim();
      if (entryKey === key) {
        value = trimmed.slice(separatorIndex + 1).trim();
      }
    }
  }
  return value;
}

function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      const renameTarget = rawPath.split(' -> ').at(-1) ?? rawPath;
      return renameTarget.replace(/^"|"$/g, '');
    });
}

function isLaneRegistryPath(repoRelativePath: string): boolean {
  return (
    /^\.ops\/sync\/UTV2-\d+\.yml$/.test(repoRelativePath) ||
    /^docs\/06_status\/lanes\/UTV2-\d+\.json$/.test(repoRelativePath)
  );
}

function fastBaselineAllowed(tier: LaneTier, linearLabels: string[]): boolean {
  if (tier === 'T3') {
    return true;
  }
  if (tier !== 'T2') {
    return false;
  }
  const normalizedLabels = linearLabels.map((label) => label.toLowerCase().replace(/^area:/, '').replace(/^kind:/, '').replace(/^lane:/, ''));
  return normalizedLabels.some((label) =>
    ['governance', 'tooling', 'hygiene', 'verification', 'delivery-ui', 'delivery/ui', 'proof'].includes(label),
  );
}

function validateDocsOnlyFastPath(
  tier: LaneTier,
  docsOnlyFastPath: boolean,
  candidateFiles: string[],
  addCheck: (id: string, status: CheckResult['status'], detail: string) => void,
): void {
  if (!docsOnlyFastPath) {
    addCheck('PF1', 'skip', 'T3 docs-only fast path not requested');
    return;
  }

  if (tier !== 'T3') {
    addCheck('PF1', 'fail', '--docs-only-fast-path is restricted to T3 lanes');
    return;
  }

  if (candidateFiles.length === 0) {
    addCheck('PF1', 'fail', '--docs-only-fast-path requires at least one --files path');
    return;
  }

  const nonDocsFiles = candidateFiles.filter((filePath) => !isDocsOnlyFastPathFile(filePath));
  if (nonDocsFiles.length > 0) {
    addCheck(
      'PF1',
      'fail',
      `--docs-only-fast-path allows only docs/status paths; rejected: ${nonDocsFiles.join(', ')}`,
    );
    return;
  }

  addCheck('PF1', 'pass', 'T3 docs-only fast path scope is limited to docs/status paths');
}

function isDocsOnlyFastPathFile(repoRelativePath: string): boolean {
  const normalized = normalizeRepoRelativePath(repoRelativePath);
  return (
    normalized.startsWith('docs/06_status/') ||
    (normalized.startsWith('.claude/commands/') && normalized.endsWith('.md'))
  );
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
