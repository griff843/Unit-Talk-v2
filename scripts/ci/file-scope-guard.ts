#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIVE_STATUSES = new Set(['started', 'in_progress', 'in_review', 'blocked', 'reopened']);
const ISSUE_BRANCH_PATTERN = /(?:^|[/_-])(UTV2-\d+)(?:$|[/_-])/i;

type GuardVerdict = 'PASS' | 'FAIL';

interface LaneManifest {
  issue_id?: string;
  branch?: string;
  status?: string;
  file_scope_lock?: string[];
  expected_proof_paths?: string[];
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

interface ParsedArgs {
  base: string;
  head: string;
  branch: string;
  changedFilesFile: string | null;
  manifestDir: string;
  outputJson: string | null;
}

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '../..');
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { base, head, branch, changedFilesFile, manifestDir, outputJson };
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
  const manifests = readManifests(root, args.manifestDir);
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
