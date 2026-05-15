import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import YAML from 'yaml';

export const LANE_TYPES = [
  'runtime',
  'modeling',
  'verification',
  'hygiene',
  'migration',
  'governance',
  'delivery-ui',
  'data-canonical',
] as const;

export const LANE_EXECUTOR_TYPES = ['claude', 'codex-cli', 'codex-cloud'] as const;

export type LaneType = (typeof LANE_TYPES)[number];
export type LaneExecutor = (typeof LANE_EXECUTOR_TYPES)[number];

export interface LaneManifestContract {
  schema_version: 1;
  lane_id: string;
  lane_type: LaneType;
  executor?: LaneExecutor;
  allowed_path_globs: string[];
  forbidden_path_globs: string[];
  required_proof_artifacts: string[];
  ci_requirements: string[];
  merge_policy: string;
  concurrency_notes: string;
  requires_migration_lock?: boolean;
}

export interface LaneViolation {
  code:
    | 'forbidden_path'
    | 'outside_allowed_paths'
    | 'migration_lane_required'
    | 'migration_lock_required'
    | 'manifest_invalid';
  file?: string;
  message: string;
}

export interface LaneCheckResult {
  ok: boolean;
  lane: LaneType;
  changedFiles: string[];
  violations: LaneViolation[];
}

const MIGRATION_SENSITIVE_GLOBS = [
  'supabase/migrations/**',
  'database/migrations/**',
  'packages/**/database.types.ts',
  'packages/**/generated/**',
  'packages/**/schema.generated.*',
  'packages/**/generated-schema.*',
];

export function normalizeRepoPath(input: string): string {
  return input.trim().replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
}

export function isLaneType(input: string): input is LaneType {
  return (LANE_TYPES as readonly string[]).includes(input);
}

export function loadLaneManifest(lane: string, repoRoot = process.cwd()): LaneManifestContract {
  if (!isLaneType(lane)) {
    throw new Error(`Invalid lane type: ${lane}. Expected one of: ${LANE_TYPES.join(', ')}`);
  }

  const manifestPath = path.join(repoRoot, '.lane', 'lanes', `${lane}.yml`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing lane manifest: ${path.relative(repoRoot, manifestPath)}`);
  }

  const parsed = YAML.parse(fs.readFileSync(manifestPath, 'utf8')) as LaneManifestContract;
  const errors = validateLaneManifest(parsed, manifestPath);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return parsed;
}

export function validateLaneManifest(
  manifest: Partial<LaneManifestContract>,
  sourcePath = '<manifest>',
): string[] {
  const errors: string[] = [];
  if (manifest.schema_version !== 1) {
    errors.push(`${sourcePath}: schema_version must be 1`);
  }
  if (!manifest.lane_id) {
    errors.push(`${sourcePath}: lane_id is required`);
  }
  if (!manifest.lane_type || !isLaneType(manifest.lane_type)) {
    errors.push(`${sourcePath}: lane_type is invalid`);
  }
  for (const key of [
    'allowed_path_globs',
    'forbidden_path_globs',
    'required_proof_artifacts',
    'ci_requirements',
  ] as const) {
    if (!Array.isArray(manifest[key])) {
      errors.push(`${sourcePath}: ${key} must be an array`);
    }
  }
  if (!manifest.merge_policy) {
    errors.push(`${sourcePath}: merge_policy is required`);
  }
  if (!manifest.concurrency_notes) {
    errors.push(`${sourcePath}: concurrency_notes is required`);
  }
  return errors;
}

export function getChangedFiles(input: {
  repoRoot?: string;
  baseRef?: string;
  headRef?: string;
}): string[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const baseRef = input.baseRef ?? 'origin/main';
  const headRef = input.headRef ?? 'HEAD';
  const attempts = [
    ['diff', '--name-only', `${baseRef}...${headRef}`],
    ['diff', '--name-only', baseRef, headRef],
  ];

  for (const args of attempts) {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    if (result.status === 0) {
      return result.stdout
        .split(/\r?\n/)
        .map(normalizeRepoPath)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    }
  }

  throw new Error(`Unable to read git diff for ${baseRef}..${headRef}`);
}

export function validateLaneAuthority(input: {
  manifest: LaneManifestContract;
  changedFiles: string[];
  repoRoot?: string;
  migrationLockPath?: string;
}): LaneCheckResult {
  const repoRoot = input.repoRoot ?? process.cwd();
  const changedFiles = input.changedFiles.map(normalizeRepoPath).filter(Boolean);
  const violations: LaneViolation[] = [];
  const migrationFiles = changedFiles.filter((file) => matchesAny(file, MIGRATION_SENSITIVE_GLOBS));

  for (const file of changedFiles) {
    if (matchesAny(file, input.manifest.forbidden_path_globs)) {
      violations.push({
        code: 'forbidden_path',
        file,
        message: `${file} is forbidden for lane ${input.manifest.lane_type}`,
      });
      continue;
    }

    if (!matchesAny(file, input.manifest.allowed_path_globs)) {
      violations.push({
        code: 'outside_allowed_paths',
        file,
        message: `${file} is outside allowed paths for lane ${input.manifest.lane_type}`,
      });
    }
  }

  if (migrationFiles.length > 0 && input.manifest.lane_type !== 'migration') {
    for (const file of migrationFiles) {
      violations.push({
        code: 'migration_lane_required',
        file,
        message: `${file} requires lane_type=migration`,
      });
    }
  }

  if (migrationFiles.length > 0 && input.manifest.lane_type === 'migration') {
    const lockPath = input.migrationLockPath ?? path.join(repoRoot, '.lane', 'migration-lock.yml');
    if (!fs.existsSync(lockPath)) {
      violations.push({
        code: 'migration_lock_required',
        message: `Migration changes require active lock: ${path.relative(repoRoot, lockPath).replaceAll('\\', '/')}`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    lane: input.manifest.lane_type,
    changedFiles,
    violations,
  };
}

export function matchesAny(file: string, patterns: string[]): boolean {
  return micromatch.isMatch(file, patterns, { dot: true });
}

