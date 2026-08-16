import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  type LaneManifest,
  type PreflightToken,
  ROOT,
  TERMINAL_STATUSES,
  activeManifestOverlap,
  currentHeadSha,
  emitJson,
  getFlag,
  git,
  issueIdFromBranchName,
  issueToManifestPath,
  parseArgs,
  preflightTokenPathForBranch,
  readManifest,
  relativeToRoot,
  requireIssueId,
  resolveActiveLaneManifests,
  validateManifest,
  validateBranchName,
  validatePreflightTokenPathValue,
  writeJsonFile,
  writeManifest,
} from './shared.js';

const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
export const PR_BASE_MISMATCH_BLOCKER = 'pr-base-mismatch';

type LaneLinkResult = {
  ok: boolean;
  code: string;
  message?: string;
  issue_id?: string;
  manifest_path?: string;
  branch?: string;
  pr_url?: string;
  status?: string;
  heartbeat_at?: string;
  preflight_recovered?: boolean;
};

type PullRequestBinding = {
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  state: string;
};

type RecoveryDeps = {
  cwd?: string;
  currentBranch?: () => string;
  currentHead?: () => string;
  isClean?: () => boolean;
  dependenciesReady?: () => boolean;
  readPullRequest?: (prUrl: string) => PullRequestBinding;
  activeManifests?: () => LaneManifest[];
  now?: () => Date;
  randomUUID?: () => string;
  writeToken?: (tokenPath: string, token: PreflightToken) => void;
};

function isMissingPreflightTokenError(entry: string): boolean {
  return entry.includes('preflight_token file does not exist:');
}

function writeBoundManifest(
  manifest: LaneManifest,
  allowMissingPreflightToken: boolean,
): void {
  if (!allowMissingPreflightToken) {
    writeManifest(manifest);
    return;
  }

  const manifestPath = issueToManifestPath(manifest.issue_id);
  const errors = validateManifest(manifest, manifestPath).filter(
    (entry) => !isMissingPreflightTokenError(entry),
  );
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  writeJsonFile(manifestPath, manifest);
}

function readPullRequestBinding(prUrl: string): PullRequestBinding {
  const result = spawnSync(
    'gh',
    [
      'pr',
      'view',
      prUrl,
      '--json',
      'url,headRefName,headRefOid,baseRefName,state',
    ],
    { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to validate PR binding: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  return JSON.parse(result.stdout) as PullRequestBinding;
}

/**
 * Reconstruct a missing active-lane token only after independently proving the
 * lane still owns its branch, worktree, PR head, dependencies, and scope lock.
 * This is recovery of ephemeral state, not a waiver of preflight validation.
 */
export function recoverMissingPreflightToken(
  manifest: LaneManifest,
  branch: string,
  prUrl: string,
  deps: RecoveryDeps = {},
): void {
  const cwd = path.resolve(deps.cwd ?? process.cwd());
  const expectedCwd = path.resolve(
    manifest.execution_location?.cwd ?? manifest.worktree_path,
  );
  if (cwd !== expectedCwd) {
    throw new Error(
      `Lane recovery cwd ${cwd} does not match owned worktree ${expectedCwd}`,
    );
  }
  if (manifest.branch !== branch) {
    throw new Error('Lane recovery requires the manifest-owned branch');
  }
  if (!['started', 'in_progress', 'reopened'].includes(manifest.status)) {
    throw new Error(
      `Lane recovery is not allowed from status ${manifest.status}`,
    );
  }
  if (manifest.blocked_by.length > 0) {
    throw new Error(
      `Lane recovery is blocked by unresolved dependencies: ${manifest.blocked_by.join(', ')}`,
    );
  }

  const expectedTokenPath = preflightTokenPathForBranch(branch);
  const expectedTokenRelative = relativeToRoot(expectedTokenPath);
  const declaredToken = validatePreflightTokenPathValue(
    manifest.preflight_token,
  );
  if (declaredToken !== expectedTokenRelative) {
    throw new Error(
      `Lane recovery token path ${declaredToken} does not match canonical path ${expectedTokenRelative}`,
    );
  }
  if (fs.existsSync(expectedTokenPath)) {
    throw new Error(
      `Lane recovery requires a missing token: ${expectedTokenRelative}`,
    );
  }

  const currentBranch =
    deps.currentBranch ??
    (() => {
      const result = git(['branch', '--show-current'], cwd);
      if (!result.ok || !result.stdout)
        throw new Error('Unable to determine current branch');
      return result.stdout;
    });
  if (currentBranch() !== branch) {
    throw new Error(`Current branch does not match lane branch ${branch}`);
  }

  const headSha = (deps.currentHead ?? (() => currentHeadSha(cwd)))();
  const clean =
    deps.isClean ??
    (() => {
      const result = git(
        ['status', '--porcelain=v1', '--untracked-files=no'],
        cwd,
      );
      if (!result.ok)
        throw new Error(`Unable to inspect working tree: ${result.stderr}`);
      return result.stdout.length === 0;
    });
  if (!clean()) throw new Error('Lane recovery requires a clean working tree');

  const dependenciesReady =
    deps.dependenciesReady ??
    (() =>
      fs.existsSync(path.join(cwd, 'pnpm-lock.yaml')) &&
      fs.existsSync(path.join(cwd, 'node_modules')));
  if (!dependenciesReady()) {
    throw new Error(
      'Lane recovery requires pnpm-lock.yaml and node_modules in the owned worktree',
    );
  }

  const pullRequest = (deps.readPullRequest ?? readPullRequestBinding)(prUrl);
  if (
    pullRequest.url !== prUrl ||
    pullRequest.state !== 'OPEN' ||
    pullRequest.baseRefName !== manifest.base_branch ||
    pullRequest.headRefName !== branch ||
    pullRequest.headRefOid !== headSha
  ) {
    throw new Error(
      'PR binding does not match the open lane branch, base, and current HEAD',
    );
  }

  const activeManifests = (
    deps.activeManifests ??
    (() => resolveActiveLaneManifests().lanes.map((lane) => lane.manifest))
  )();
  const overlap = activeManifestOverlap(
    manifest.issue_id,
    manifest.file_scope_lock,
    activeManifests,
  );
  if (overlap) {
    throw new Error(
      `Lane recovery scope overlaps active ${overlap.issue_id}: ${overlap.overlapping_files.join(', ')}`,
    );
  }

  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(
    now.getTime() + (manifest.tier === 'T1' ? 15 : 30) * 60_000,
  );
  const token: PreflightToken = {
    schema_version: 1,
    branch,
    head_sha: headSha,
    tier: manifest.tier,
    issue_id: manifest.issue_id,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    checks: { git: 'pass', env: 'pass', deps: 'pass' },
    status: 'pass',
    waivers: [],
    baseline_cache_hit: false,
    preflight_run_id: (deps.randomUUID ?? crypto.randomUUID)(),
    required_docs_checked: [
      'docs/05_operations/EXECUTION_TRUTH_MODEL.md',
      'docs/05_operations/LANE_MANIFEST_SPEC.md',
      'docs/05_operations/TRUTH_CHECK_SPEC.md',
    ],
  };
  (deps.writeToken ?? writeJsonFile)(expectedTokenPath, token);
}

export function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const branch = getFlag(flags, 'branch') ?? '';
  const baseBranch = getFlag(flags, 'base') ?? '';
  const prUrl = getFlag(flags, 'pr') ?? '';
  const issueIdRaw =
    positionals[0] ??
    getFlag(flags, 'issue') ??
    issueIdFromBranchName(branch) ??
    '';
  const githubEvent = bools.has('github-event');

  try {
    const issueId = requireIssueId(issueIdRaw);
    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (!prUrl) {
      throw new Error('Missing required --pr');
    }
    validateBranchName(branch);
    if (!PR_URL_PATTERN.test(prUrl)) {
      emitJson({
        ok: false,
        code: 'pr_url_invalid',
        message: `Invalid PR URL: ${prUrl}`,
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      } satisfies LaneLinkResult);
      return 1;
    }
    if (
      githubEvent &&
      (process.env['GITHUB_ACTIONS'] !== 'true' ||
        !['pull_request', 'pull_request_target'].includes(
          process.env['GITHUB_EVENT_NAME'] ?? '',
        ))
    ) {
      emitJson({
        ok: false,
        code: 'github_event_context_required',
        message:
          '--github-event is restricted to a GitHub Actions pull_request or pull_request_target run',
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      } satisfies LaneLinkResult);
      return 1;
    }

    let preflightRecovered = false;
    let manifest = readManifest(issueId);
    if (githubEvent && !baseBranch) {
      emitJson({
        ok: false,
        code: 'base_branch_required',
        message: '--github-event requires the pull request base via --base',
        issue_id: issueId,
        branch,
        pr_url: prUrl,
      } satisfies LaneLinkResult);
      return 1;
    }
    if (githubEvent && manifest.base_branch !== baseBranch) {
      // A terminal lane keeps its historical binding untouched. Clearing
      // `pr_url` on a `done`/`merged`/`failed`/`superseded`/`cancelled` lane
      // would destroy the record of what shipped and leave an unbound terminal
      // manifest that closeout and reconcile read as a ghost -- the exact
      // failure this issue exists to prevent. Only a live bound lane is
      // invalidated; a terminal one falls through to the ordinary
      // `base_branch_mismatch` refusal and is not mutated at all.
      const invalidatesExistingBinding =
        manifest.branch === branch &&
        manifest.pr_url === prUrl &&
        !TERMINAL_STATUSES.has(manifest.status);
      if (invalidatesExistingBinding) {
        manifest.pr_url = null;
        manifest.status = 'blocked';
        manifest.blocked_by = [
          ...new Set([...manifest.blocked_by, PR_BASE_MISMATCH_BLOCKER]),
        ];
        manifest.heartbeat_at = new Date().toISOString();
        writeBoundManifest(manifest, true);
        emitJson({
          ok: true,
          code: 'pr_binding_invalidated',
          message: `Invalidated ${issueId} PR binding because pull request base ${baseBranch} no longer matches manifest base ${manifest.base_branch}`,
          issue_id: issueId,
          branch,
          status: manifest.status,
          heartbeat_at: manifest.heartbeat_at,
        } satisfies LaneLinkResult);
        return 0;
      }
      emitJson({
        ok: false,
        code: 'base_branch_mismatch',
        message: `Manifest base ${manifest.base_branch} does not match pull request base ${baseBranch}`,
        issue_id: issueId,
        branch,
        pr_url: prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 1;
    }
    const manifestErrors = validateManifest(
      manifest,
      issueToManifestPath(issueId),
    );
    const missingTokenErrors = manifestErrors.filter(
      isMissingPreflightTokenError,
    );
    if (missingTokenErrors.length > 0) {
      const nonMissingTokenErrors = manifestErrors.filter(
        (entry) => !isMissingPreflightTokenError(entry),
      );
      if (nonMissingTokenErrors.length > 0) {
        throw new Error(
          `Manifest validation failed: ${nonMissingTokenErrors.join('; ')}`,
        );
      }
      if (!githubEvent) {
        recoverMissingPreflightToken(manifest, branch, prUrl);
        manifest = readManifest(issueId);
        preflightRecovered = true;
      }
    } else if (manifestErrors.length > 0) {
      throw new Error(
        `Manifest validation failed: ${manifestErrors.join('; ')}`,
      );
    }
    const manifestPath = relativeToRoot(`docs/06_status/lanes/${issueId}.json`);

    if (manifest.branch !== branch) {
      emitJson({
        ok: false,
        code: 'branch_mismatch',
        message: `Manifest branch ${manifest.branch} does not match requested branch ${branch}`,
        issue_id: issueId,
        branch,
        manifest_path: manifestPath,
      } satisfies LaneLinkResult);
      return 1;
    }
    const manifestPrUrl = manifest.pr_url ?? undefined;
    if (manifestPrUrl && manifestPrUrl !== prUrl) {
      emitJson({
        ok: false,
        code: 'pr_url_mismatch',
        message: `Manifest PR ${manifestPrUrl} does not match requested PR ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: prUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 1;
    }
    if (manifest.status === 'in_review') {
      if (!manifestPrUrl) {
        emitJson({
          ok: false,
          code: 'pr_url_missing',
          message: `${issueId} is in_review but manifest has no PR URL`,
          issue_id: issueId,
          manifest_path: manifestPath,
          branch,
          pr_url: prUrl,
          status: manifest.status,
          heartbeat_at: manifest.heartbeat_at,
        } satisfies LaneLinkResult);
        return 1;
      }
      emitJson({
        ok: true,
        code: 'lane_link_pr_noop',
        message: `${issueId} is already in_review for ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: manifestPrUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 0;
    }
    if (manifest.status === 'merged' || manifest.status === 'done') {
      if (!manifestPrUrl) {
        emitJson({
          ok: false,
          code: 'pr_url_missing',
          message: `${issueId} is already ${manifest.status} but manifest has no PR URL`,
          issue_id: issueId,
          manifest_path: manifestPath,
          branch,
          pr_url: prUrl,
          status: manifest.status,
          heartbeat_at: manifest.heartbeat_at,
        } satisfies LaneLinkResult);
        return 1;
      }
      emitJson({
        ok: true,
        code: 'lane_link_pr_noop',
        message: `${issueId} is already ${manifest.status} for ${prUrl}`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        pr_url: manifestPrUrl,
        status: manifest.status,
        heartbeat_at: manifest.heartbeat_at,
      } satisfies LaneLinkResult);
      return 0;
    }
    if (!['started', 'in_progress', 'reopened'].includes(manifest.status)) {
      emitJson({
        ok: false,
        code: 'status_not_transitionable',
        message: `${issueId} with status ${manifest.status} cannot transition to in_review`,
        issue_id: issueId,
        manifest_path: manifestPath,
        branch,
        status: manifest.status,
      } satisfies LaneLinkResult);
      return 1;
    }

    manifest.status = 'in_review';
    manifest.pr_url = prUrl;
    manifest.heartbeat_at = new Date().toISOString();
    writeBoundManifest(manifest, githubEvent);

    emitJson({
      ok: true,
      code: 'lane_linked',
      issue_id: issueId,
      manifest_path: manifestPath,
      branch: manifest.branch,
      pr_url: manifest.pr_url,
      status: manifest.status,
      heartbeat_at: manifest.heartbeat_at,
      preflight_recovered: preflightRecovered,
    } satisfies LaneLinkResult);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|no such file/i.test(message)) {
      emitJson({
        ok: false,
        code: 'manifest_missing',
        message,
        issue_id: issueIdRaw ? issueIdRaw.toUpperCase() : undefined,
      } satisfies LaneLinkResult);
      return 1;
    }
    emitJson({
      ok: false,
      code: 'lane_link_pr_failed',
      message,
      issue_id: issueIdRaw ? issueIdRaw.toUpperCase() : undefined,
      branch: branch || undefined,
      pr_url: prUrl || undefined,
    } satisfies LaneLinkResult);
    return /Not in a git repository/i.test(message) ? 3 : 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
