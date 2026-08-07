#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// UTV2-1571: this guard has two DISTINCT roles that UTV2-1563 originally
// conflated into one status set, and that conflation is exactly what let a
// merged-but-not-yet-`done` manifest (UTV2-1550: merged via PR #1239, stuck
// at status "merged" because its own merge commit's required-check identity
// changed as a side effect of the very PR being evaluated, so G4 can never
// pass) perpetually block every OTHER lane from touching any path in its
// `file_scope_lock` (e.g. package.json), with no way to release that lock
// short of falsifying the historical `files_changed` record (rejected, PR
// #1288).
//
// Role 1 -- SELF-SCOPE RESOLUTION: "is this PR's own diff allowed to touch
// these files?" A manifest reset to "merged" between a PR merging and
// ops:lane-close finishing full closure (or a deliberate reset from "done"
// back to "merged" to allow a genuine re-run of the close) must still resolve
// as the trusted scope for ITS OWN branch -- excluding "merged" here breaks
// exactly the case UTV2-1563 fixed (the manifest, and any scope-override,
// become invisible the moment status moves past "in_review" but before a
// full "done" close).
//
// Role 2 -- CONFLICT-BLOCKING: "does another lane's declared scope block a
// DIFFERENT lane's diff?" Once a lane is merged, its code is already shipped
// -- the only way it can still legitimately need to keep blocking others is
// if something is actively resuming/continuing it, and that resumption is
// represented by the SAME manifest transitioning back to a genuinely active
// status (most commonly "reopened"; see TRANSITIONS in scripts/ops/shared.ts,
// where `merged` can only advance to `done`, `reopened`, or stay `merged`).
// So "merged" alone, with no live continuation, must never count as active
// for this role. This exactly mirrors `ACTIVE_LOCK_STATUSES` in
// scripts/ops/shared.ts -- the canonical set every other ops/*.ts consumer
// (ops:lane-start's activeManifestOverlap, execution-state.ts's
// isActiveLane, merge-risk.ts's activeLanesOnly, lane-maximizer.ts) already
// uses for this exact purpose. This file cannot import that module directly
// (the CI workflow extracts and runs this file standalone from origin/main,
// with no sibling scripts/ops/ tree available at that path -- see
// .github/workflows/file-scope-lock-check.yml's "Resolve trusted guard
// script" step), so the set is intentionally duplicated here rather than
// imported.
//
// `files_changed` (the immutable, GitHub-diff-derived historical record) is
// NEVER read by either role below -- only `file_scope_lock` (current/at-
// lane-start-declared edit-scope) ever participates in scope or conflict
// evaluation. That separation was already true before this change; this fix
// only corrects WHICH manifests' file_scope_lock counts toward blocking
// others, not what field is consulted.
const SELF_SCOPE_STATUSES = new Set(['started', 'in_progress', 'in_review', 'blocked', 'reopened', 'merged']);
const LOCK_CONFLICT_STATUSES = new Set(['started', 'in_progress', 'in_review', 'blocked', 'reopened']);
const ISSUE_BRANCH_PATTERN = /(?:^|[/_-])(UTV2-\d+)(?:$|[/_-])/i;

type GuardVerdict = 'PASS' | 'FAIL';

interface LaneManifest {
  issue_id?: string;
  branch?: string;
  status?: string;
  file_scope_lock?: string[];
  expected_proof_paths?: string[];
  // The immutable, GitHub-diff-derived historical record (LANE_MANIFEST_SPEC.md
  // §4.2). Modeled here only so tests can assert this guard NEVER reads it --
  // neither role (self-scope resolution nor conflict-blocking) ever consults
  // files_changed, only file_scope_lock. See the SELF_SCOPE_STATUSES /
  // LOCK_CONFLICT_STATUSES doc comment (UTV2-1571).
  files_changed?: string[];
  // A manifest-embedded `scope_override` field existed here before UTV2-1521.
  // It was removed: the manifest is part of the PR's own diff, so a
  // well-formed-looking override object proved nothing about actual
  // authorization -- any PR could grant itself scope widening by typing
  // non-empty strings into its own file. Scope widening now requires an
  // externally-authored PR comment; see ExternalScopeOverride below and
  // docs/05_operations/schemas/scope-override-v1.md.
}

// ── External scope override (UTV2-1521) ─────────────────────────────────────
//
// Replaces the manifest-embedded scope_override field. An override is only
// trustworthy if it comes from a source the PR branch's own diff cannot
// write to -- a PR comment authored by a real, authorized GitHub account is
// exactly that: GitHub, not the PR's commits, attests to who posted it.
//
// The CI workflow (not this script) fetches PR comments, authenticates the
// author against the same CODEOWNERS/non-bot check merge-gate.yml already
// uses, and writes only the validated matches to an `--override-file`. This
// script never talks to the GitHub API itself and never decides who counts
// as authorized -- it only matches an already-authenticated override record
// against the current evaluation context (issue, PR, head SHA).

export interface ExternalScopeOverride {
  issue_id: string;
  pr_number: number;
  head_sha: string;
  paths: string[];
  authorized_by: string;
  reason: string;
}

function isWellFormedExternalOverride(candidate: unknown): candidate is ExternalScopeOverride {
  if (!candidate || typeof candidate !== 'object') return false;
  const value = candidate as Record<string, unknown>;
  return (
    typeof value.issue_id === 'string' &&
    value.issue_id.trim().length > 0 &&
    typeof value.pr_number === 'number' &&
    Number.isInteger(value.pr_number) &&
    typeof value.head_sha === 'string' &&
    value.head_sha.trim().length > 0 &&
    Array.isArray(value.paths) &&
    value.paths.length > 0 &&
    value.paths.every((p) => typeof p === 'string' && p.trim().length > 0) &&
    typeof value.authorized_by === 'string' &&
    value.authorized_by.trim().length > 0 &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0
  );
}

/**
 * Finds the (at most one) externally-authorized override that applies to the
 * given manifest in the current evaluation context. Every field must match
 * exactly -- issue_id, PR number, and head SHA -- so an override never
 * silently carries forward to a different lane, a different PR, or a later
 * push (a force-push or new commit needs a fresh override comment).
 *
 * When more than one comment matches the same (issue, PR, head SHA) triple,
 * the LAST one (chronologically, as returned by the paginated comment list)
 * wins. Comments are only ever written here after passing the authorized-
 * reviewer check, so a later comment for the same SHA represents that same
 * reviewer correcting or superseding an earlier one -- honoring the first
 * match instead would silently pin an outdated/incomplete path list even
 * after the reviewer posted a corrected comment (observed live on UTV2-1524).
 */
export function resolveApplicableOverride(
  overrides: ExternalScopeOverride[],
  context: { issueId: string | null; prNumber: number | null; headSha: string | null },
): ExternalScopeOverride | null {
  if (!context.issueId || context.prNumber === null || !context.headSha) return null;

  let match: ExternalScopeOverride | null = null;
  for (const override of overrides) {
    if (
      isWellFormedExternalOverride(override) &&
      override.issue_id === context.issueId &&
      override.pr_number === context.prNumber &&
      override.head_sha === context.headSha
    ) {
      match = override;
    }
  }
  return match;
}

function loadExternalOverrides(overrideFile: string | null): ExternalScopeOverride[] {
  if (!overrideFile) return [];
  if (!fs.existsSync(overrideFile)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(isWellFormedExternalOverride);
  } catch {
    // Malformed override file grants nothing -- fail closed.
    return [];
  }
}

interface GuardConflict {
  file: string;
  locked_by: string;
  lane_branch: string;
  lock_pattern: string;
}

interface ScopeViolation {
  file: string;
  branch: string;
  issue_id: string;
}

interface GuardResult {
  verdict: GuardVerdict;
  changed_files: string[];
  pr_branch: string;
  own_manifest_issue: string | null;
  conflicts: GuardConflict[];
  outside_scope: ScopeViolation[];
  errors: string[];
}

type ManifestSourceMode = 'worktree' | 'git';

interface ParsedArgs {
  base: string;
  head: string;
  branch: string;
  changedFilesFile: string | null;
  manifestDir: string;
  outputJson: string | null;
  manifestSource: ManifestSourceMode;
  overrideFile: string | null;
  prNumber: number | null;
  headSha: string | null;
}

function repoRoot(): string {
  // Resolved from the current working directory (always the repo root when invoked
  // via `pnpm exec tsx ...` or CI), not from this file's on-disk location. This lets
  // a *trusted* copy of this script be extracted to an arbitrary path (e.g. the
  // base-branch version checked out to .out/) and still resolve the real repo paths.
  return process.cwd();
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

export function matchesLockPattern(filePath: string, rawPattern: string): boolean {
  const file = normalizePath(filePath);
  const pattern = normalizePath(rawPattern);

  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }

  return file === pattern || file.startsWith(`${pattern}/`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  let head = 'HEAD';
  let branch = process.env.FILE_SCOPE_PR_BRANCH ?? process.env.GITHUB_HEAD_REF ?? '';
  let changedFilesFile: string | null = null;
  let manifestDir = 'docs/06_status/lanes';
  let outputJson: string | null = null;
  let manifestSource: ManifestSourceMode = 'worktree';
  let overrideFile: string | null = null;
  let prNumber: number | null = process.env.FILE_SCOPE_PR_NUMBER
    ? Number.parseInt(process.env.FILE_SCOPE_PR_NUMBER, 10)
    : null;
  let headSha: string | null = process.env.FILE_SCOPE_HEAD_SHA ?? null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--base' && next) {
      base = next;
      index += 1;
      continue;
    }
    if (arg === '--head' && next) {
      head = next;
      index += 1;
      continue;
    }
    if (arg === '--branch' && next) {
      branch = next;
      index += 1;
      continue;
    }
    if (arg === '--changed-files-file' && next) {
      changedFilesFile = next;
      index += 1;
      continue;
    }
    if (arg === '--manifest-dir' && next) {
      manifestDir = next;
      index += 1;
      continue;
    }
    if (arg === '--output-json' && next) {
      outputJson = next;
      index += 1;
      continue;
    }
    if (arg === '--manifest-source' && next) {
      if (next !== 'worktree' && next !== 'git') {
        throw new Error(`Invalid --manifest-source "${next}" (expected "worktree" or "git")`);
      }
      manifestSource = next;
      index += 1;
      continue;
    }
    if (arg === '--override-file' && next) {
      overrideFile = next;
      index += 1;
      continue;
    }
    if (arg === '--pr-number' && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid --pr-number "${next}" (expected an integer)`);
      }
      prNumber = parsed;
      index += 1;
      continue;
    }
    if (arg === '--head-sha' && next) {
      headSha = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    base,
    head,
    branch,
    changedFilesFile,
    manifestDir,
    outputJson,
    manifestSource,
    overrideFile,
    prNumber,
    headSha,
  };
}

function readChangedFiles(root: string, args: ParsedArgs): string[] {
  if (args.changedFilesFile) {
    const content = fs.readFileSync(path.resolve(root, args.changedFilesFile), 'utf8');
    return content.split(/\r?\n/).map(normalizePath).filter(Boolean);
  }

  const raw = execSync(`git diff --name-only ${args.base}..${args.head}`, {
    cwd: root,
    encoding: 'utf8',
  });
  return raw.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function readManifests(root: string, manifestDir: string): LaneManifest[] {
  const absoluteDir = path.resolve(root, manifestDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const manifests: LaneManifest[] = [];
  for (const entry of fs.readdirSync(absoluteDir)) {
    if (!entry.endsWith('.json')) continue;
    const manifestPath = path.join(absoluteDir, entry);

    try {
      manifests.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifest);
    } catch {
      // Malformed manifests are ignored here; schema validation owns that failure mode.
    }
  }

  return manifests;
}

// ── Trusted (git-backed) manifest resolution ────────────────────────────────
//
// A PR's own checked-out working tree cannot be trusted to evaluate that same
// PR: a diff can simultaneously (a) touch an out-of-scope file, (b) edit this
// guard script to weaken or no-op the check, and/or (c) widen its own lane
// manifest's file_scope_lock to retroactively "declare" the out-of-scope file
// as in-scope. All three routes let a PR make itself pass evaluation of its
// own violation.
//
// `resolveTrustedManifests` closes route (c): for a manifest that already
// existed on the base branch, its base-branch content is authoritative and
// any modification made within the PR is ignored for evaluation purposes. For
// a manifest newly introduced by this branch (the normal case for a fresh
// lane's own manifest, which cannot yet exist on the base branch), the
// content is locked to the *first* commit on this branch that added it — the
// lane-start declaration — so a later commit in the same PR cannot widen it.
//
// Route (b) — trusting a PR-modified copy of this very script — is closed by
// the CI workflow, which extracts and executes the base-branch copy of this
// file rather than the PR's own copy (see .github/workflows/file-scope-lock-check.yml).

export interface GitManifestSource {
  listPathsAtRef(ref: string): string[];
  readFileAtRef(ref: string, filePath: string): string | null;
  firstAddingCommit(base: string, head: string, filePath: string): string | null;
}

export function resolveTrustedManifests(
  source: GitManifestSource,
  base: string,
  head: string,
): LaneManifest[] {
  // Parked manifests are deliberately removed from active-lane concurrency
  // accounting. Keep the trusted scope reader aligned: a parked lane cannot
  // reserve files or create a cross-lane conflict (DEBT-031).
  const isActiveManifestPath = (filePath: string): boolean =>
    !normalizePath(filePath).includes('/parked/');
  const basePaths = new Set(source.listPathsAtRef(base).filter(isActiveManifestPath));
  const headPaths = new Set(source.listPathsAtRef(head).filter(isActiveManifestPath));
  const allPaths = new Set<string>([...basePaths, ...headPaths]);

  const manifests: LaneManifest[] = [];
  for (const filePath of allPaths) {
    let raw: string | null;
    if (basePaths.has(filePath)) {
      raw = source.readFileAtRef(base, filePath);
    } else {
      const firstSha = source.firstAddingCommit(base, head, filePath);
      raw = source.readFileAtRef(firstSha ?? head, filePath);
    }
    if (!raw) continue;

    let trusted: LaneManifest;
    try {
      trusted = JSON.parse(raw) as LaneManifest;
    } catch {
      // Malformed manifests are ignored here; schema validation owns that failure mode.
      continue;
    }

    // No head-tip override path here (removed in UTV2-1521): the base/
    // first-commit baseline is always authoritative for manifest content.
    // Scope widening beyond the baseline is authorized exclusively through an
    // externally-validated scope-override/v1 PR comment, applied later in
    // fileIsAllowedByOwnManifest -- never by trusting anything the PR's own
    // diff wrote into the manifest file itself.
    manifests.push(trusted);
  }

  return manifests;
}

function createGitManifestSource(root: string, manifestDir: string): GitManifestSource {
  const normalizedDir = manifestDir.replace(/\/+$/, '');
  const exec = (command: string): string | null => {
    try {
      return execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };

  return {
    listPathsAtRef(ref: string): string[] {
      const out = exec(`git ls-tree -r --name-only ${ref} -- ${normalizedDir}`);
      if (!out) return [];
      return out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.json'));
    },
    readFileAtRef(ref: string, filePath: string): string | null {
      return exec(`git show ${ref}:${filePath}`);
    },
    firstAddingCommit(base: string, head: string, filePath: string): string | null {
      const out = exec(`git log --reverse --format=%H --diff-filter=A ${base}..${head} -- ${filePath}`);
      if (!out) return null;
      const first = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0];
      return first ?? null;
    },
  };
}

function loadManifests(root: string, args: ParsedArgs): LaneManifest[] {
  if (args.manifestSource === 'git') {
    return resolveTrustedManifests(createGitManifestSource(root, args.manifestDir), args.base, args.head);
  }
  return readManifests(root, args.manifestDir);
}

function selfScopeManifests(manifests: LaneManifest[]): LaneManifest[] {
  return manifests.filter((manifest) => SELF_SCOPE_STATUSES.has(String(manifest.status ?? '')));
}

function lockConflictManifests(manifests: LaneManifest[]): LaneManifest[] {
  return manifests.filter((manifest) => LOCK_CONFLICT_STATUSES.has(String(manifest.status ?? '')));
}

function findOwnManifest(
  manifests: LaneManifest[],
  branch: string,
  continuation: { overrides: ExternalScopeOverride[]; prNumber: number | null; headSha: string | null },
): LaneManifest | null {
  const exact = manifests.find((manifest) => manifest.branch === branch) ?? null;
  if (exact) return exact;

  // A continuation PR for an already-merged-but-unclosed lane is often opened
  // from a new branch name; the trusted manifest on origin/main still names
  // the original branch. Exact branch equality alone makes that manifest
  // invisible as "this PR's own lane" and silently disables any otherwise-
  // valid scope-override for it (UTV2-1524).
  //
  // An issue ID merely embedded in the branch name is NOT proof of
  // continuation authority by itself -- any branch could contain that token
  // (e.g. `codex/utv2-1524-unrelated`) and would otherwise inherit an
  // unrelated lane's file_scope_lock *and* be silently excluded from
  // conflict detection (Codex P1 finding on UTV2-1524). Only accept the
  // fallback when an externally authorized scope-override/v1 comment
  // explicitly vouches for this exact issue, PR number, and head SHA -- the
  // same GitHub-attested trust anchor already used to widen path scope.
  const issueMatch = branch.match(ISSUE_BRANCH_PATTERN);
  if (!issueMatch) return null;
  const issueId = issueMatch[1].toUpperCase();

  const authorizedContinuation = resolveApplicableOverride(continuation.overrides, {
    issueId,
    prNumber: continuation.prNumber,
    headSha: continuation.headSha,
  });
  if (!authorizedContinuation) return null;

  return manifests.find((manifest) => (manifest.issue_id ?? '').toUpperCase() === issueId) ?? null;
}

function branchLooksLikeLane(branch: string): boolean {
  return ISSUE_BRANCH_PATTERN.test(branch);
}

function ownLaneControlPlanePatterns(manifest: LaneManifest): string[] {
  if (!manifest.issue_id) return [];

  // These are the lane's own canonical bookkeeping paths -- always derivable
  // from the issue ID alone, never a path any OTHER lane could legitimately
  // write to. They must work unconditionally on a normal fresh multi-commit
  // lane, independent of the trusted-at-first-commit snapshot timing of
  // file_scope_lock/expected_proof_paths (UTV2-1518, reopened): a lane
  // that runs `ops:proof-generate` (or otherwise writes its own proof
  // artifacts) in a commit AFTER the manifest's first-committed content
  // must not fail the guard for that alone. The full proof-directory glob
  // is exempted here -- not just the `.gitkeep` placeholder -- since any
  // file under a lane's own `docs/06_status/proof/<issue-id>/` is, by
  // construction, that lane's own proof bookkeeping, not scope bleed.
  // This does NOT touch file_scope_lock/expected_proof_paths/override
  // resolution -- arbitrary scope widening beyond these three canonical
  // paths still requires an externally authorized scope-override/v1
  // comment, same as before.
  return [
    `.ops/sync/${manifest.issue_id}.yml`,
    `docs/06_status/lanes/${manifest.issue_id}.json`,
    `docs/06_status/proof/${manifest.issue_id}/**`,
  ];
}

function fileIsAllowedByOwnManifest(
  file: string,
  manifest: LaneManifest,
  applicableOverride: ExternalScopeOverride | null,
): boolean {
  const allowedPatterns = [
    ...(manifest.file_scope_lock ?? []),
    ...(manifest.expected_proof_paths ?? []),
    ...ownLaneControlPlanePatterns(manifest),
    ...(applicableOverride?.paths ?? []),
  ];
  return allowedPatterns.some((pattern) => matchesLockPattern(file, pattern));
}

export function evaluateFileScopeGuard(input: {
  changedFiles: string[];
  prBranch: string;
  manifests: LaneManifest[];
  externalOverrides?: ExternalScopeOverride[];
  prNumber?: number | null;
  headSha?: string | null;
}): GuardResult {
  const errors: string[] = [];
  // Own-manifest resolution (role 1) intentionally uses the WIDER status set
  // (includes "merged") -- a lane must always be able to resolve itself,
  // even mid-close. Conflict-blocking (role 2, below) intentionally uses the
  // NARROWER set (excludes "merged") -- a merged-but-not-yet-done lane no
  // longer holds active edit-lock capacity over anyone else. See the
  // SELF_SCOPE_STATUSES / LOCK_CONFLICT_STATUSES doc comment above.
  const selfScope = selfScopeManifests(input.manifests);
  const lockConflictCandidates = lockConflictManifests(input.manifests);
  const ownManifest = findOwnManifest(selfScope, input.prBranch, {
    overrides: input.externalOverrides ?? [],
    prNumber: input.prNumber ?? null,
    headSha: input.headSha ?? null,
  });
  const ownManifestIssue = ownManifest?.issue_id ?? null;

  if (!ownManifest && branchLooksLikeLane(input.prBranch)) {
    errors.push(`No active lane manifest found for branch "${input.prBranch}".`);
  }

  // An override only ever applies to the PR's OWN manifest, in the current
  // issue/PR/head-SHA context -- never to another lane's scope, and never
  // carried forward from a stale context. See resolveApplicableOverride.
  const applicableOverride = ownManifest
    ? resolveApplicableOverride(input.externalOverrides ?? [], {
        issueId: ownManifest.issue_id ?? null,
        prNumber: input.prNumber ?? null,
        headSha: input.headSha ?? null,
      })
    : null;

  const outsideScope: ScopeViolation[] = [];
  if (ownManifest) {
    for (const file of input.changedFiles) {
      if (!fileIsAllowedByOwnManifest(file, ownManifest, applicableOverride)) {
        outsideScope.push({
          file,
          branch: input.prBranch,
          issue_id: ownManifest.issue_id ?? 'unknown',
        });
      }
    }
  }

  const conflicts: GuardConflict[] = [];
  for (const manifest of lockConflictCandidates) {
    // Skip the PR's own lane, however it was resolved (exact branch match or
    // the UTV2-1524 issue-ID fallback) -- otherwise a continuation PR's own
    // manifest is spuriously flagged as a conflicting foreign lane.
    if (manifest.branch === input.prBranch || manifest === ownManifest) continue;

    for (const file of input.changedFiles) {
      for (const lockPattern of manifest.file_scope_lock ?? []) {
        if (matchesLockPattern(file, lockPattern)) {
          conflicts.push({
            file,
            locked_by: manifest.issue_id ?? 'unknown',
            lane_branch: manifest.branch ?? 'unknown',
            lock_pattern: lockPattern,
          });
        }
      }
    }
  }

  return {
    verdict: conflicts.length === 0 && outsideScope.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL',
    changed_files: input.changedFiles,
    pr_branch: input.prBranch,
    own_manifest_issue: ownManifestIssue,
    conflicts,
    outside_scope: outsideScope,
    errors,
  };
}

function formatFailure(result: GuardResult): string {
  const lines: string[] = ['FILE SCOPE LOCK CHECK FAILED', ''];

  if (result.errors.length > 0) {
    lines.push('Errors:', ...result.errors.map((error) => `- ${error}`), '');
  }

  if (result.outside_scope.length > 0) {
    lines.push('Files outside this lane scope:');
    for (const violation of result.outside_scope) {
      lines.push(`- ${violation.file} is not declared by ${violation.issue_id} (${violation.branch})`);
    }
    lines.push('');
  }

  if (result.conflicts.length > 0) {
    lines.push('Files locked by other active lanes:');
    for (const conflict of result.conflicts) {
      lines.push(
        `- ${conflict.file} locked by ${conflict.locked_by} (${conflict.lane_branch}, ${conflict.lock_pattern})`,
      );
    }
    lines.push('');
  }

  lines.push('Resolve by narrowing the diff or coordinating the lane file-scope lock.');
  return lines.join('\n');
}

function main(): void {
  const root = repoRoot();
  const args = parseArgs(process.argv);
  const changedFiles = readChangedFiles(root, args);
  const manifests = loadManifests(root, args);
  const externalOverrides = loadExternalOverrides(
    args.overrideFile ? path.resolve(root, args.overrideFile) : null,
  );
  const result = evaluateFileScopeGuard({
    changedFiles,
    prBranch: args.branch,
    manifests,
    externalOverrides,
    prNumber: args.prNumber,
    headSha: args.headSha,
  });

  if (args.outputJson) {
    fs.writeFileSync(path.resolve(root, args.outputJson), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }

  if (result.verdict === 'PASS') {
    console.log('No file scope lock conflicts or scope violations detected.');
    return;
  }

  console.error(formatFailure(result));
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
