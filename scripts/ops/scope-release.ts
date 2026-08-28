import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  ACTIVE_LOCK_STATUSES,
  ROOT,
  type LaneManifest,
  type ScopeReleaseHistoryEntry,
  hashFileScopeLock,
  nowIso,
  readAllManifests,
  readManifest,
  validateManifest,
  writeManifest,
} from './shared.js';

/**
 * Audited scope release (UTV2-1762) -- the narrowing-only mechanism that
 * `LANE_MANIFEST_SPEC.md` promised under the name `ops:lane:relock` but never
 * shipped. See ScopeReleaseHistoryEntry in shared.ts for why this exists.
 *
 * Design constraints, all of them fail-closed:
 *
 *  - REMOVAL ONLY. The request surface accepts a list of paths to RELEASE and
 *    nothing else. There is no add, no replace, no pattern, no glob. A path
 *    that is not already an exact entry of `file_scope_lock` is refused
 *    (`path_not_in_lock`) rather than silently added, so "widen" and "replace"
 *    are not merely discouraged shapes -- they are unrepresentable.
 *  - ATOMIC. `evaluateScopeRelease` is pure and collects EVERY refusal before
 *    returning. The caller writes the manifest only on `ok: true`, so a partial
 *    failure writes nothing.
 *  - EVIDENCE-BOUND. Every input that could drift between "what the operator
 *    looked at" and "what is true now" must be restated by the operator and is
 *    re-checked against live state: PR number, exact head SHA, and the hash of
 *    the pre-change lock.
 *  - LANE-LOCAL. The release must run in the target lane's own worktree on the
 *    target lane's own branch; the main control checkout is refused.
 */

export type ScopeReleaseRefusalCode =
  | 'no_release_paths'
  | 'duplicate_release_path'
  | 'not_in_lane_worktree'
  | 'branch_mismatch'
  | 'issue_mismatch'
  | 'manifest_lane_inactive'
  | 'pr_url_mismatch'
  | 'pr_number_mismatch'
  | 'pr_not_open'
  | 'head_sha_mismatch'
  | 'lock_hash_mismatch'
  | 'path_not_in_lock'
  | 'path_in_pr_diff'
  | 'path_in_staged_work'
  | 'path_in_unstaged_work'
  | 'path_in_untracked_work'
  | 'path_in_unpushed_work'
  | 'concurrent_lane_dependency'
  | 'empty_resulting_lock'
  | 'unexpected_field_mutation'
  | 'manifest_invalid_after_release';

export interface ScopeReleaseRefusal {
  code: ScopeReleaseRefusalCode;
  detail: string;
}

export interface ScopeReleaseRequest {
  issue_id: string;
  pr_number: number;
  expected_head_sha: string;
  expected_lock_hash: string;
  release_paths: string[];
  actor: string;
  reason: string;
}

export interface ScopeReleasePrState {
  number: number;
  url: string;
  state: string;
  head_sha: string;
  changed_files: string[];
}

export interface ScopeReleaseWorkingTree {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  unpushed: string[];
}

export interface ScopeReleaseContext {
  manifest: LaneManifest;
  repo_root: string;
  current_branch: string;
  pr: ScopeReleasePrState;
  working_tree: ScopeReleaseWorkingTree;
  other_manifests: LaneManifest[];
  now: string;
}

export interface ScopeReleaseResult {
  ok: boolean;
  code: 'scope_released' | 'scope_release_refused';
  issue_id: string;
  refusals: ScopeReleaseRefusal[];
  released_paths: string[];
  previous_lock_hash: string | null;
  resulting_lock_hash: string | null;
  previous_file_scope_lock: string[];
  resulting_file_scope_lock: string[] | null;
  audit_entry: ScopeReleaseHistoryEntry | null;
  manifest: LaneManifest | null;
  message: string;
}

function normalizePathValue(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function samePath(left: string, right: string): boolean {
  return normalizePathValue(left) === normalizePathValue(right);
}

function normalizeAbsolute(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

function prNumberFromUrl(prUrl: string | null): number | null {
  const match = (prUrl ?? '').match(/\/pull\/(\d+)(?:\b|$)/);
  return match ? Number(match[1]) : null;
}

/**
 * Fields the release is permitted to touch. Requirement 6 (files_changed, issue
 * identity, status, commit_sha, pr_url, proof verdicts, merge state all
 * immutable) is enforced positively rather than by enumerating forbidden
 * fields: everything outside this allowlist must be byte-identical, checked by
 * comparing the two manifests with these keys stripped. A future field added to
 * the manifest is therefore protected by default instead of being forgotten.
 */
const RELEASE_MUTABLE_FIELDS = new Set<keyof LaneManifest>([
  'file_scope_lock',
  'scope_release_history',
]);

function withoutMutableFields(manifest: LaneManifest): string {
  const copy: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
  for (const field of RELEASE_MUTABLE_FIELDS) {
    delete copy[field as string];
  }
  return JSON.stringify(Object.fromEntries(Object.entries(copy).sort(([a], [b]) => (a < b ? -1 : 1))));
}

/**
 * Pure evaluation. Never touches disk, git, or GitHub -- the caller supplies
 * observed state in `context`, which is what makes every refusal below directly
 * testable (and makes the mutation control possible: delete any one refusal and
 * a named test fails).
 */
export function evaluateScopeRelease(
  request: ScopeReleaseRequest,
  context: ScopeReleaseContext,
): ScopeReleaseResult {
  const refusals: ScopeReleaseRefusal[] = [];
  const refuse = (code: ScopeReleaseRefusalCode, detail: string): void => {
    refusals.push({ code, detail });
  };

  const manifest = context.manifest;
  const previousLock = [...(manifest.file_scope_lock ?? [])];
  const previousLockHash = hashFileScopeLock(previousLock);
  const releasePaths = request.release_paths.map(normalizePathValue);

  // ── Request shape ────────────────────────────────────────────────────────
  if (releasePaths.length === 0) {
    refuse('no_release_paths', 'at least one --release-path is required; a release that removes nothing is not a release');
  }
  const seen = new Set<string>();
  for (const releasePath of releasePaths) {
    if (seen.has(releasePath)) {
      refuse('duplicate_release_path', `"${releasePath}" was requested more than once`);
    }
    seen.add(releasePath);
  }

  // ── Execution location (requirement 2) ───────────────────────────────────
  if (normalizeAbsolute(context.repo_root) !== normalizeAbsolute(manifest.worktree_path)) {
    refuse(
      'not_in_lane_worktree',
      `scope release must run in the target lane's own worktree (${manifest.worktree_path}); running in ${context.repo_root}`,
    );
  }
  if (context.current_branch !== manifest.branch) {
    refuse(
      'branch_mismatch',
      `checked-out branch "${context.current_branch}" is not the lane branch "${manifest.branch}"`,
    );
  }

  // ── Identity (requirement 4, first bullet) ───────────────────────────────
  if (manifest.issue_id.toUpperCase() !== request.issue_id.toUpperCase()) {
    refuse('issue_mismatch', `manifest issue_id ${manifest.issue_id} does not match requested ${request.issue_id}`);
  }
  if (!ACTIVE_LOCK_STATUSES.has(manifest.status)) {
    refuse(
      'manifest_lane_inactive',
      `lane status "${manifest.status}" does not hold an active file scope lock; there is nothing to release`,
    );
  }
  const manifestPrNumber = prNumberFromUrl(manifest.pr_url);
  if (manifestPrNumber === null || manifestPrNumber !== request.pr_number) {
    refuse(
      'pr_url_mismatch',
      `manifest pr_url ${manifest.pr_url ?? 'null'} does not resolve to requested PR #${request.pr_number}`,
    );
  }

  // ── Live GitHub state (requirement 4, second bullet) ─────────────────────
  if (context.pr.number !== request.pr_number) {
    refuse('pr_number_mismatch', `GitHub returned PR #${context.pr.number}, expected #${request.pr_number}`);
  }
  if (context.pr.state.toUpperCase() !== 'OPEN') {
    refuse('pr_not_open', `PR #${context.pr.number} is ${context.pr.state}; only an open PR may narrow its lane scope`);
  }
  if (context.pr.head_sha !== request.expected_head_sha) {
    refuse(
      'head_sha_mismatch',
      `PR head is ${context.pr.head_sha}, expected ${request.expected_head_sha}; re-resolve the head and re-run`,
    );
  }

  // ── Pre-change lock hash (requirement 3) ─────────────────────────────────
  if (previousLockHash !== request.expected_lock_hash) {
    refuse(
      'lock_hash_mismatch',
      `file_scope_lock hashes to ${previousLockHash}, expected ${request.expected_lock_hash}; the lock changed since it was inspected`,
    );
  }

  // ── Per-path checks (requirement 4, bullets 3-6) ─────────────────────────
  for (const releasePath of releasePaths) {
    if (!previousLock.some((locked) => samePath(locked, releasePath))) {
      refuse(
        'path_not_in_lock',
        `"${releasePath}" is not an entry of file_scope_lock; this operation removes existing entries only and never adds, replaces, or widens`,
      );
    }
    if (context.pr.changed_files.some((changed) => samePath(changed, releasePath))) {
      refuse(
        'path_in_pr_diff',
        `"${releasePath}" appears in PR #${context.pr.number}'s changed files; a path the lane actually used cannot be released`,
      );
    }
    if (context.working_tree.staged.some((entry) => samePath(entry, releasePath))) {
      refuse('path_in_staged_work', `"${releasePath}" has staged changes in the lane worktree`);
    }
    if (context.working_tree.unstaged.some((entry) => samePath(entry, releasePath))) {
      refuse('path_in_unstaged_work', `"${releasePath}" has unstaged changes in the lane worktree`);
    }
    if (context.working_tree.untracked.some((entry) => samePath(entry, releasePath))) {
      refuse('path_in_untracked_work', `"${releasePath}" exists as untracked work in the lane worktree`);
    }
    if (context.working_tree.unpushed.some((entry) => samePath(entry, releasePath))) {
      refuse('path_in_unpushed_work', `"${releasePath}" is touched by a commit on this branch that is not in the PR head`);
    }
    for (const other of context.other_manifests) {
      if (other.issue_id === manifest.issue_id) continue;
      if (!ACTIVE_LOCK_STATUSES.has(other.status)) continue;
      if ((other.file_scope_lock ?? []).some((locked) => samePath(locked, releasePath))) {
        refuse(
          'concurrent_lane_dependency',
          `active lane ${other.issue_id} already declares "${releasePath}" in its own file_scope_lock; releasing it here would rewrite a contended path under a concurrent lane rather than freeing it`,
        );
      }
    }
  }

  // ── Resulting lock (requirement 4, last bullet + requirement 1) ──────────
  //
  // The resulting lock is derived by FILTERING the previous lock, so "never
  // widens, never replaces, never glob-expands" is a structural property of the
  // derivation, not a check that could be forgotten: no code path can put a
  // string into `nextLock` that was not already in `previousLock`. Requirement 1
  // is therefore carried by three reachable refusals -- `path_not_in_lock` (the
  // only way to name a path that is not already locked), `empty_resulting_lock`,
  // and the `unexpected_field_mutation` post-condition below -- rather than by a
  // fourth "did we widen?" refusal that this derivation makes unreachable. An
  // unreachable refusal cannot be validated by making it fail on the condition it
  // names, so it is deliberately not present.
  const nextLock = previousLock.filter((locked) => !releasePaths.some((released) => samePath(locked, released)));
  if (refusals.length === 0 && nextLock.length === 0) {
    refuse('empty_resulting_lock', 'releasing these paths would leave file_scope_lock empty, which is not a valid lane manifest');
  }

  if (refusals.length > 0) {
    return {
      ok: false,
      code: 'scope_release_refused',
      issue_id: manifest.issue_id,
      refusals,
      released_paths: releasePaths,
      previous_lock_hash: previousLockHash,
      resulting_lock_hash: null,
      previous_file_scope_lock: previousLock,
      resulting_file_scope_lock: null,
      audit_entry: null,
      manifest: null,
      message: `Scope release refused (${refusals.length} refusal(s)); nothing was written.`,
    };
  }

  const resultingLockHash = hashFileScopeLock(nextLock);
  const auditEntry: ScopeReleaseHistoryEntry = {
    released_at: context.now,
    actor: request.actor,
    reason: request.reason,
    pr_number: context.pr.number,
    pr_url: context.pr.url,
    head_sha: context.pr.head_sha,
    previous_lock_hash: previousLockHash,
    resulting_lock_hash: resultingLockHash,
    released_paths: releasePaths,
    verifications: [
      { check: 'lane_worktree', status: 'pass', detail: `ran in ${context.repo_root} on branch ${context.current_branch}` },
      { check: 'manifest_identity', status: 'pass', detail: `issue ${manifest.issue_id}, pr_url ${manifest.pr_url ?? 'null'}` },
      { check: 'pr_head', status: 'pass', detail: `PR #${context.pr.number} ${context.pr.state} at ${context.pr.head_sha}` },
      { check: 'previous_lock_hash', status: 'pass', detail: previousLockHash },
      { check: 'paths_absent_from_pr_diff', status: 'pass', detail: `${context.pr.changed_files.length} changed file(s) scanned` },
      {
        check: 'paths_absent_from_local_work',
        status: 'pass',
        detail: `staged=${context.working_tree.staged.length} unstaged=${context.working_tree.unstaged.length} untracked=${context.working_tree.untracked.length} unpushed=${context.working_tree.unpushed.length}`,
      },
      { check: 'no_concurrent_lane_dependency', status: 'pass', detail: `${context.other_manifests.length} other manifest(s) scanned` },
      { check: 'resulting_lock_valid', status: 'pass', detail: `${nextLock.length} entries remain` },
    ],
  };

  const nextManifest: LaneManifest = {
    ...manifest,
    file_scope_lock: nextLock,
    scope_release_history: [...(manifest.scope_release_history ?? []), auditEntry],
  };

  // Requirement 6, enforced positively: nothing outside RELEASE_MUTABLE_FIELDS
  // may differ. This is a post-condition on the value actually about to be
  // written, not a promise about the code above.
  if (withoutMutableFields(manifest) !== withoutMutableFields(nextManifest)) {
    return {
      ok: false,
      code: 'scope_release_refused',
      issue_id: manifest.issue_id,
      refusals: [
        {
          code: 'unexpected_field_mutation',
          detail: 'the release would have altered a manifest field other than file_scope_lock/scope_release_history',
        },
      ],
      released_paths: releasePaths,
      previous_lock_hash: previousLockHash,
      resulting_lock_hash: null,
      previous_file_scope_lock: previousLock,
      resulting_file_scope_lock: null,
      audit_entry: null,
      manifest: null,
      message: 'Scope release refused (unexpected field mutation); nothing was written.',
    };
  }

  const schemaErrors = validateManifest(nextManifest);
  if (schemaErrors.length > 0) {
    return {
      ok: false,
      code: 'scope_release_refused',
      issue_id: manifest.issue_id,
      refusals: schemaErrors.map((detail) => ({ code: 'manifest_invalid_after_release' as const, detail })),
      released_paths: releasePaths,
      previous_lock_hash: previousLockHash,
      resulting_lock_hash: null,
      previous_file_scope_lock: previousLock,
      resulting_file_scope_lock: null,
      audit_entry: null,
      manifest: null,
      message: 'Scope release refused (resulting manifest fails schema validation); nothing was written.',
    };
  }

  return {
    ok: true,
    code: 'scope_released',
    issue_id: manifest.issue_id,
    refusals: [],
    released_paths: releasePaths,
    previous_lock_hash: previousLockHash,
    resulting_lock_hash: resultingLockHash,
    previous_file_scope_lock: previousLock,
    resulting_file_scope_lock: nextLock,
    audit_entry: auditEntry,
    manifest: nextManifest,
    message: `Released ${releasePaths.length} path(s) from ${manifest.issue_id}'s file_scope_lock; ${nextLock.length} remain.`,
  };
}

// ── IO shell ────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr ?? '').trim() || 'unknown error'}`);
  }
  return result.stdout ?? '';
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function collectWorkingTree(cwd: string, prHeadSha: string): ScopeReleaseWorkingTree {
  const staged = lines(git(['diff', '--cached', '--name-only'], cwd));
  const unstaged = lines(git(['diff', '--name-only'], cwd));
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard'], cwd));
  // "Unpushed" here means: touched by a commit that exists locally on this
  // branch but is NOT reachable from the PR head GitHub reported. That is the
  // set the PR's changed-file list cannot see, and therefore exactly the set
  // that would otherwise let a lane release a path it is actively using.
  let unpushed: string[] = [];
  const revList = spawnSync('git', ['rev-parse', '--verify', '--quiet', prHeadSha], { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (revList.status === 0) {
    unpushed = lines(git(['diff', '--name-only', `${prHeadSha}..HEAD`], cwd));
  } else {
    throw new Error(
      `PR head ${prHeadSha} is not present in the lane worktree; fetch it before releasing scope (unpushed work cannot be evaluated otherwise)`,
    );
  }
  return { staged, unstaged, untracked, unpushed };
}

export function fetchPrState(prNumber: number, cwd: string): ScopeReleasePrState {
  const view = spawnSync('gh', ['pr', 'view', String(prNumber), '--json', 'number,url,state,headRefOid'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (view.status !== 0) {
    throw new Error(`GitHub PR lookup failed for #${prNumber}: ${(view.stderr ?? '').trim() || 'unknown error'}`);
  }
  const parsed = JSON.parse(view.stdout) as { number: number; url: string; state: string; headRefOid: string };

  const files = spawnSync('gh', ['pr', 'diff', String(prNumber), '--name-only'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (files.status !== 0) {
    throw new Error(`GitHub PR diff lookup failed for #${prNumber}: ${(files.stderr ?? '').trim() || 'unknown error'}`);
  }

  return {
    number: parsed.number,
    url: parsed.url,
    state: parsed.state,
    head_sha: parsed.headRefOid,
    changed_files: lines(files.stdout),
  };
}

export interface RunScopeReleaseDeps {
  repoRoot?: string;
  readManifestFor?: (issueId: string) => LaneManifest;
  readOtherManifests?: () => LaneManifest[];
  currentBranch?: () => string;
  fetchPr?: (prNumber: number) => ScopeReleasePrState;
  collectWork?: (prHeadSha: string) => ScopeReleaseWorkingTree;
  persist?: (manifest: LaneManifest) => void;
  now?: () => string;
}

/**
 * Gathers live state, evaluates, and persists ONLY on success. The write is the
 * last statement in the function on purpose: every refusal path returns before
 * it, so "partial failure writes nothing" is a structural property rather than
 * a cleanup step that could be skipped.
 */
export function runScopeRelease(
  request: ScopeReleaseRequest,
  deps: RunScopeReleaseDeps = {},
): ScopeReleaseResult {
  const repoRoot = deps.repoRoot ?? ROOT;
  const manifest = (deps.readManifestFor ?? readManifest)(request.issue_id.toUpperCase());
  const currentBranch = (deps.currentBranch ?? (() => git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).trim()))();
  const pr = (deps.fetchPr ?? ((n: number) => fetchPrState(n, repoRoot)))(request.pr_number);
  const workingTree = (deps.collectWork ?? ((sha: string) => collectWorkingTree(repoRoot, sha)))(pr.head_sha);
  const otherManifests = (deps.readOtherManifests ?? (() => readAllManifests()))().filter(
    (candidate) => candidate.issue_id !== manifest.issue_id,
  );

  const result = evaluateScopeRelease(request, {
    manifest,
    repo_root: repoRoot,
    current_branch: currentBranch,
    pr,
    working_tree: workingTree,
    other_manifests: otherManifests,
    now: (deps.now ?? nowIso)(),
  });

  if (!result.ok || !result.manifest) {
    return result;
  }

  (deps.persist ?? writeManifest)(result.manifest);
  return result;
}
