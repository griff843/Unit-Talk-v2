import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  type LaneManifest,
  assertStatusTransition,
  ROOT,
  relativeToRoot,
} from './shared.js';

export type LaneInstallState = 'not_required' | 'required' | 'verified';
export type LaneExecutionMode = 'worktree' | 'main-control';

export interface LaneExecutionLocation {
  mode: LaneExecutionMode;
  cwd: string;
  package_install: LaneInstallState;
  setup_command: string | null;
  main_checkout_control_only: boolean;
}

export interface LaneSetupResult {
  execution_location: LaneExecutionLocation;
  ran_install: boolean;
}

export interface LaneBlockResumeResult {
  manifest: LaneManifest;
  changed: boolean;
}

const PACKAGE_TOUCHING_PREFIXES = [
  'apps/api/',
  'apps/worker/',
  'apps/ingestor/',
  'packages/',
];

const PACKAGE_TOUCHING_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
]);

export function normalizeExecutionCwd(input: string): string {
  return path.resolve(input).replaceAll('\\', '/');
}

export function buildLaneExecutionLocation(
  cwd: string,
  fileScope: string[],
  options: { installVerified?: boolean; mode?: LaneExecutionMode } = {},
): LaneExecutionLocation {
  const installRequired = laneRequiresIsolatedInstall(fileScope);
  const normalizedCwd = normalizeExecutionCwd(cwd);
  return {
    mode: options.mode ?? 'worktree',
    cwd: normalizedCwd,
    package_install: installRequired
      ? options.installVerified
        ? 'verified'
        : 'required'
      : 'not_required',
    setup_command: installRequired ? 'pnpm install --frozen-lockfile' : null,
    main_checkout_control_only: true,
  };
}

export function laneRequiresIsolatedInstall(fileScope: string[]): boolean {
  return fileScope.some((filePath) => isPackageTouchingPath(filePath));
}

export function packageTouchingLaneRequiresSingleton(
  fileScope: string[],
  installVerified: boolean,
): boolean {
  return laneRequiresIsolatedInstall(fileScope) && !installVerified;
}

export function blockLaneManifest(input: {
  manifest: LaneManifest;
  blockedBy: string[];
  now: string;
}): LaneBlockResumeResult {
  if (input.blockedBy.length === 0) {
    throw new Error('At least one blocker is required');
  }
  assertStatusTransition(input.manifest.status, 'blocked');
  const blockedBy = [
    ...new Set(input.blockedBy.map((entry) => entry.trim()).filter(Boolean)),
  ];
  if (blockedBy.length === 0) {
    throw new Error('At least one non-empty blocker is required');
  }

  const next: LaneManifest = {
    ...input.manifest,
    status: 'blocked',
    blocked_by: blockedBy,
    heartbeat_at: input.now,
  };

  return {
    manifest: next,
    changed:
      input.manifest.status !== next.status ||
      input.manifest.heartbeat_at !== next.heartbeat_at ||
      JSON.stringify(input.manifest.blocked_by) !==
        JSON.stringify(next.blocked_by),
  };
}

export function resumeLaneManifest(input: {
  manifest: LaneManifest;
  now: string;
}): LaneBlockResumeResult {
  if (input.manifest.status !== 'blocked') {
    throw new Error(
      `Only blocked lanes can be resumed (current status: ${input.manifest.status})`,
    );
  }
  assertStatusTransition(input.manifest.status, 'in_progress');

  const next: LaneManifest = {
    ...input.manifest,
    status: 'in_progress',
    blocked_by: [],
    heartbeat_at: input.now,
  };

  return {
    manifest: next,
    changed:
      input.manifest.status !== next.status ||
      input.manifest.heartbeat_at !== next.heartbeat_at ||
      input.manifest.blocked_by.length > 0,
  };
}

export function validateExecutionCwd(
  expectedCwd: string,
  actualCwd = process.cwd(),
): string[] {
  const expected = normalizeExecutionCwd(expectedCwd);
  const actual = normalizeExecutionCwd(actualCwd);
  return expected === actual
    ? []
    : [`wrong cwd: expected ${expected}, actual ${actual}`];
}

export function validateLeaseCwdCoherence(input: {
  lease_cwd: string;
  worktree_path?: string;
  execution_location?: Pick<LaneExecutionLocation, 'cwd'>;
}): string[] {
  const errors: string[] = [];
  const leaseCwd = normalizeExecutionCwd(input.lease_cwd);
  if (
    input.worktree_path &&
    normalizeExecutionCwd(input.worktree_path) !== leaseCwd
  ) {
    errors.push('worktree_path must match lease cwd');
  }
  if (
    input.execution_location?.cwd &&
    normalizeExecutionCwd(input.execution_location.cwd) !== leaseCwd
  ) {
    errors.push('execution_location.cwd must match lease cwd');
  }
  return errors;
}

export function validateLaneCwd(input: {
  cwd: string;
  fileScope: string[];
  requireInstallVerified?: boolean;
}): string[] {
  const errors: string[] = [];
  const cwd = normalizeExecutionCwd(input.cwd);
  if (!fs.existsSync(cwd)) {
    return [`cwd does not exist: ${cwd}`];
  }
  if (!fs.statSync(cwd).isDirectory()) {
    return [`cwd is not a directory: ${cwd}`];
  }

  if (!laneRequiresIsolatedInstall(input.fileScope)) {
    return errors;
  }

  const nodeModulesPath = path.join(cwd, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    errors.push(
      `isolated install missing: ${relativeOrAbsolute(nodeModulesPath)}`,
    );
    return errors;
  }

  const nodeModulesStat = fs.lstatSync(nodeModulesPath);
  if (nodeModulesStat.isSymbolicLink()) {
    errors.push(
      `node_modules must not be a symlink or junction: ${relativeOrAbsolute(nodeModulesPath)}`,
    );
  }

  const laneNodeModulesRealPath = fs.realpathSync(nodeModulesPath);
  const mainNodeModulesPath = path.join(ROOT, 'node_modules');
  if (
    fs.existsSync(mainNodeModulesPath) &&
    fs.realpathSync(mainNodeModulesPath) === laneNodeModulesRealPath &&
    normalizeExecutionCwd(cwd) !== normalizeExecutionCwd(ROOT)
  ) {
    errors.push(
      'node_modules must not resolve to the main checkout node_modules',
    );
  }

  if (input.requireInstallVerified && errors.length === 0) {
    const pnpmDir = path.join(nodeModulesPath, '.pnpm');
    if (!fs.existsSync(pnpmDir)) {
      errors.push(
        `isolated pnpm install is not verified: ${relativeOrAbsolute(pnpmDir)} missing`,
      );
    }
  }

  return errors;
}

export function prepareLaneExecutionDirectory(input: {
  cwd: string;
  fileScope: string[];
  runner?: typeof spawnSync;
}): LaneSetupResult {
  const runner = input.runner ?? spawnSync;
  const executionLocation = buildLaneExecutionLocation(
    input.cwd,
    input.fileScope,
  );
  const initialErrors = validateLaneCwd({
    cwd: executionLocation.cwd,
    fileScope: input.fileScope,
    requireInstallVerified: false,
  }).filter((error) => !error.startsWith('isolated install missing:'));
  if (initialErrors.length > 0) {
    throw new Error(initialErrors.join('; '));
  }

  // On Linux, worktrees have no node_modules without an explicit install — there is no
  // junction fallback. Run install for any detached worktree (cwd != ROOT) that lacks node_modules,
  // even for non-package-touching scopes.
  const isDetachedWorktree =
    normalizeExecutionCwd(executionLocation.cwd) !==
    normalizeExecutionCwd(ROOT);
  const worktreeNeedsInstall =
    isDetachedWorktree &&
    !fs.existsSync(path.join(executionLocation.cwd, 'node_modules'));

  if (
    !worktreeNeedsInstall &&
    executionLocation.package_install !== 'required'
  ) {
    return {
      execution_location: executionLocation,
      ran_install: false,
    };
  }

  const result = runner('pnpm', ['install', '--frozen-lockfile'], {
    cwd: executionLocation.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `pnpm install --frozen-lockfile failed in ${executionLocation.cwd}: ${
        result.stderr || result.stdout || 'unknown error'
      }`,
    );
  }

  // Strict post-install validation (pnpm dir check) only for package-touching scopes.
  if (executionLocation.package_install === 'required') {
    const installErrors = validateLaneCwd({
      cwd: executionLocation.cwd,
      fileScope: input.fileScope,
      requireInstallVerified: true,
    });
    if (installErrors.length > 0) {
      throw new Error(installErrors.join('; '));
    }
  }

  return {
    execution_location: {
      ...executionLocation,
      package_install: 'verified',
    },
    ran_install: true,
  };
}

function isPackageTouchingPath(input: string): boolean {
  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '');
  return (
    PACKAGE_TOUCHING_FILES.has(normalized) ||
    PACKAGE_TOUCHING_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function relativeOrAbsolute(targetPath: string): string {
  return targetPath.startsWith(ROOT) ? relativeToRoot(targetPath) : targetPath;
}
