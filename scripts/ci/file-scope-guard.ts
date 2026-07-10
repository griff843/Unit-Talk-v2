#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ACTIVE_STATUSES = new Set(['started', 'in_progress', 'in_review', 'blocked', 'reopened']);
const ISSUE_BRANCH_PATTERN = /(?:^|[/_-])(UTV2-\d+)(?:$|[/_-])/i;

type GuardVerdict = 'PASS' | 'FAIL';

interface ScopeOverride {
  approved_by?: string;
  reason?: string;
  evidence?: string;
}

interface LaneManifest {
  issue_id?: string;
  branch?: string;
  status?: string;
  file_scope_lock?: string[];
  expected_proof_paths?: string[];
  // Documented override path (acceptance criteria: "support a documented
  // override path only with PM evidence"). When present and well-formed, the
  // trusted resolver in `resolveTrustedManifests` uses the manifest's current
  // (head) content for THIS lane's own scope evaluation instead of the
  // otherwise-immutable base/first-commit baseline. A malformed or missing
  // override is never honored — scope widening fails closed by default.
  scope_override?: ScopeOverride;
}

function isWellFormedScopeOverride(candidate: ScopeOverride | undefined): candidate is Required<ScopeOverride> {
  return Boolean(
    candidate &&
      typeof candidate.approved_by === 'string' &&
      candidate.approved_by.trim().length > 0 &&
      typeof candidate.reason === 'string' &&
      candidate.reason.trim().length > 0 &&
      typeof candidate.evidence === 'string' &&
      candidate.evidence.trim().length > 0,
  );
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { base, head, branch, changedFilesFile, manifestDir, outputJson, manifestSource };
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
  const basePaths = new Set(source.listPathsAtRef(base));
  const headPaths = new Set(source.listPathsAtRef(head));
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

    // Documented override path: if the PR's own (head) tip declares a
    // well-formed scope_override on this manifest, trust the head content
    // instead of the base/first-commit baseline. A missing or malformed
    // override never grants an exception — the baseline wins by default.
    const headRaw = source.readFileAtRef(head, filePath);
    if (headRaw) {
      try {
        const headManifest = JSON.parse(headRaw) as LaneManifest;
        if (isWellFormedScopeOverride(headManifest.scope_override)) {
          manifests.push(headManifest);
          continue;
        }
      } catch {
        // Malformed head content just means no override is honored; fall through
        // to the trusted baseline computed above.
      }
    }

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

function activeManifests(manifests: LaneManifest[]): LaneManifest[] {
  return manifests.filter((manifest) => ACTIVE_STATUSES.has(String(manifest.status ?? '')));
}

function findOwnManifest(manifests: LaneManifest[], branch: string): LaneManifest | null {
  return manifests.find((manifest) => manifest.branch === branch) ?? null;
}

function branchLooksLikeLane(branch: string): boolean {
  return ISSUE_BRANCH_PATTERN.test(branch);
}

function ownLaneControlPlanePatterns(manifest: LaneManifest): string[] {
  if (!manifest.issue_id) return [];

  return [
    `.ops/sync/${manifest.issue_id}.yml`,
    `docs/06_status/lanes/${manifest.issue_id}.json`,
    `docs/06_status/proof/${manifest.issue_id}/.gitkeep`,
  ];
}

function fileIsAllowedByOwnManifest(file: string, manifest: LaneManifest): boolean {
  const allowedPatterns = [
    ...(manifest.file_scope_lock ?? []),
    ...(manifest.expected_proof_paths ?? []),
    ...ownLaneControlPlanePatterns(manifest),
  ];
  return allowedPatterns.some((pattern) => matchesLockPattern(file, pattern));
}

export function evaluateFileScopeGuard(input: {
  changedFiles: string[];
  prBranch: string;
  manifests: LaneManifest[];
}): GuardResult {
  const errors: string[] = [];
  const active = activeManifests(input.manifests);
  const ownManifest = findOwnManifest(active, input.prBranch);
  const ownManifestIssue = ownManifest?.issue_id ?? null;

  if (!ownManifest && branchLooksLikeLane(input.prBranch)) {
    errors.push(`No active lane manifest found for branch "${input.prBranch}".`);
  }

  const outsideScope: ScopeViolation[] = [];
  if (ownManifest) {
    for (const file of input.changedFiles) {
      if (!fileIsAllowedByOwnManifest(file, ownManifest)) {
        outsideScope.push({
          file,
          branch: input.prBranch,
          issue_id: ownManifest.issue_id ?? 'unknown',
        });
      }
    }
  }

  const conflicts: GuardConflict[] = [];
  for (const manifest of active) {
    if (manifest.branch === input.prBranch) continue;

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
  const result = evaluateFileScopeGuard({
    changedFiles,
    prBranch: args.branch,
    manifests,
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
