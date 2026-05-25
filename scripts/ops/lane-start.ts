import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareLaneExecutionDirectory,
  validateExecutionCwd,
} from './lane-execution.js';
import {
  defaultLeaseOwner,
  reserveLease,
} from './lease-registry.js';
import {
  ACTIVE_LOCK_STATUSES,
  activeManifestOverlap,
  branchExists,
  createBranchAndWorktree,
  createManifest,
  currentHeadSha,
  defaultProofPaths,
  emitJson,
  issueToManifestPath,
  manifestExists,
  normalizeFileScope,
  parseArgs,
  readAllManifests,
  readManifest,
  relativeToRoot,
  requireIssueId,
  validateBranchName,
  validatePreflightToken,
  validateTier,
  worktreeExists,
  worktreePathForBranch,
  writeManifest,
  ROOT,
  type CanonicalLaneType,
  type LaneExecutor,
  type LaneManifest,
} from './shared.js';
import { loadConcurrencyConfig, type ConcurrencyConfig } from './concurrency-config.js';

export interface ConcurrencyViolation {
  code: string;
  message: string;
}

export function checkConcurrencyLimits(
  activeManifests: LaneManifest[],
  incomingLaneType: CanonicalLaneType,
  incomingExecutor: LaneExecutor,
  config: ConcurrencyConfig,
): ConcurrencyViolation[] {
  const active = activeManifests.filter((m) => ACTIVE_LOCK_STATUSES.has(m.status));
  const violations: ConcurrencyViolation[] = [];

  // Total cap
  if (active.length >= config.total) {
    violations.push({
      code: 'total_cap_exceeded',
      message: `Total active lanes (${active.length}) is at the hard cap of ${config.total}. Close a lane before starting a new one.`,
    });
  }

  // Executor caps
  const claudeActive = active.filter((m) => m.executor === 'claude').length;
  const codexActive = active.filter(
    (m) => m.executor === 'codex-cli' || m.executor === 'codex-cloud',
  ).length;

  if (incomingExecutor === 'claude' && claudeActive >= config.executors.claude) {
    violations.push({
      code: 'claude_cap_exceeded',
      message: `Claude active lanes (${claudeActive}) is at the cap of ${config.executors.claude}. Close a Claude lane before starting another.`,
    });
  }

  if (
    (incomingExecutor === 'codex-cli' || incomingExecutor === 'codex-cloud') &&
    codexActive >= config.executors.codex
  ) {
    violations.push({
      code: 'codex_cap_exceeded',
      message: `Codex active lanes (${codexActive}) is at the cap of ${config.executors.codex}. Close a Codex lane before starting another.`,
    });
  }

  // Singleton type enforcement
  if ((config.singleton_types as string[]).includes(incomingLaneType)) {
    const existing = active.filter((m) => {
      const lt = String(m.lane_type ?? '');
      return lt === incomingLaneType;
    });
    if (existing.length > 0) {
      violations.push({
        code: 'singleton_type_conflict',
        message: `Lane type "${incomingLaneType}" is singleton. Active lane ${existing[0]!.issue_id} already holds this type. Close it before starting another ${incomingLaneType} lane.`,
      });
    }
  }

  // Forbidden combinations
  for (const [typeA, typeB] of config.forbidden_combinations) {
    const incomingIsA = incomingLaneType === typeA;
    const incomingIsB = incomingLaneType === typeB;
    if (!incomingIsA && !incomingIsB) continue;

    const conflictType = incomingIsA ? typeB : typeA;
    const conflicting = active.filter((m) => String(m.lane_type ?? '') === conflictType);
    if (conflicting.length > 0) {
      violations.push({
        code: 'forbidden_combination',
        message: `Forbidden combination: "${incomingLaneType}" cannot run concurrently with "${conflictType}" (active lane: ${conflicting[0]!.issue_id}). See docs/governance/LANE_CONCURRENCY_POLICY.md §3.`,
      });
    }
  }

  return violations;
}

const CANONICAL_LANE_TYPES: CanonicalLaneType[] = [
  'runtime',
  'modeling',
  'verification',
  'hygiene',
  'migration',
  'governance',
  'delivery-ui',
  'data-canonical',
];

const LEGACY_EXECUTOR_MAP: Record<string, LaneExecutor> = {
  claude: 'claude',
  'codex-cli': 'codex-cli',
  'codex-cloud': 'codex-cloud',
  codex: 'codex-cli',
};

// Paths that require serialized (singleton) execution — parallel dispatch is invalid
// unless --singleton-approved is explicitly passed.
const SINGLETON_ONLY_PREFIXES = [
  'supabase/migrations/',
  'packages/contracts/src/',
  'packages/domain/src/',
  'apps/worker/',
  '.github/workflows/',
];

const SINGLETON_ONLY_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'packages/db/src/lifecycle.ts',
  'packages/db/src/repositories.ts',
  'packages/db/src/runtime-repositories.ts',
  'apps/api/src/distribution-service.ts',
  'apps/api/src/auth.ts',
  'packages/db/src/database.types.ts',
]);

function isSingletonPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return (
    SINGLETON_ONLY_FILES.has(normalized) ||
    SINGLETON_ONLY_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function writeSyncFile(issueId: string, content: string): void {
  const syncDir = path.join(ROOT, '.ops', 'sync');
  fs.mkdirSync(syncDir, { recursive: true });
  fs.writeFileSync(path.join(syncDir, `${issueId}.yml`), content, 'utf8');
}

function buildSyncYml(issueId: string): string {
  return [
    'version: 1',
    'approval:',
    '  allow_multiple_issues: false',
    '  skip_sync_required: false',
    'entities:',
    '  issues:',
    `    - ${issueId}`,
    '  findings: []',
    '  controls: []',
    '  proofs: []',
    '',
  ].join('\n');
}

function buildPnpmStateEnv(cwd: string): NodeJS.ProcessEnv {
  const stateRoot = path.join(cwd, '.out', 'pnpm-state');
  const dirs = {
    home: path.join(stateRoot, 'home'),
    store: path.join(stateRoot, 'store'),
    cache: path.join(stateRoot, 'cache'),
    state: path.join(stateRoot, 'state'),
    corepack: path.join(stateRoot, 'corepack'),
  };

  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return {
    ...process.env,
    PNPM_HOME: dirs.home,
    COREPACK_HOME: dirs.corepack,
    NPM_CONFIG_CACHE: dirs.cache,
    NPM_CONFIG_STORE_DIR: dirs.store,
    NPM_CONFIG_STATE_DIR: dirs.state,
    npm_config_cache: dirs.cache,
    npm_config_store_dir: dirs.store,
    npm_config_state_dir: dirs.state,
  };
}

function prepareLaneWithIsolatedPnpm(worktreePath: string, fileScope: string[]) {
  return prepareLaneExecutionDirectory({
    cwd: worktreePath,
    fileScope,
    runner: (command, args, options) => spawnSync(command, args, {
      ...options,
      env: buildPnpmStateEnv(worktreePath),
    }),
  });
}

/**
 * Link env files from the main worktree into a newly-created lane worktree.
 * Non-fatal: if link-worktree-env.ts is missing or errors, we warn and continue
 * so that lane creation itself is not blocked.
 */
function linkWorktreeEnv(worktreePath: string): void {
  const scriptPath = path.join(ROOT, 'scripts', 'link-worktree-env.ts');
  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`[lane-start] warn: link-worktree-env.ts not found at ${scriptPath}; skipping env link\n`);
    return;
  }
  const result = spawnSync(
    'npx',
    ['tsx', scriptPath, worktreePath],
    { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.error) {
    process.stderr.write(`[lane-start] warn: link-worktree-env failed: ${result.error.message}\n`);
    return;
  }
  if (result.status !== 0) {
    process.stderr.write(`[lane-start] warn: link-worktree-env exited ${result.status ?? 1}:\n${result.stderr ?? ''}\n`);
    return;
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

function main(): void {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const tierInput = flags.get('tier')?.at(-1);
  const branch = flags.get('branch')?.at(-1);
  const laneType = flags.get('lane-type')?.at(-1);
  const fileArgs = flags.get('files') ?? [];

  try {
    if (!tierInput) {
      throw new Error('Missing required --tier');
    }
    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (!laneType) {
      throw new Error('Missing required --lane-type');
    }
    if (fileArgs.length === 0) {
      throw new Error('Missing required --files (repeatable, at least one required)');
    }

    const tier = validateTier(tierInput);
    validateBranchName(branch);

    let canonicalLaneType: CanonicalLaneType;
    let executor: LaneExecutor;

    if (CANONICAL_LANE_TYPES.includes(laneType as CanonicalLaneType)) {
      canonicalLaneType = laneType as CanonicalLaneType;
      const executorArg = flags.get('executor')?.at(-1);
      executor = (executorArg as LaneExecutor | undefined) ?? 'claude';
    } else if (laneType in LEGACY_EXECUTOR_MAP) {
      canonicalLaneType = 'runtime';
      executor = LEGACY_EXECUTOR_MAP[laneType]!;
    } else {
      throw new Error(
        `Invalid --lane-type: ${laneType}. Use a canonical type (${CANONICAL_LANE_TYPES.join(', ')}) with optional --executor (claude|codex-cli|codex-cloud).`,
      );
    }
    const normalizedFiles = normalizeFileScope(fileArgs);
    const singletonPaths = normalizedFiles.filter(isSingletonPath);
    const singletonApproved = flags.has('singleton-approved') || bools.has('singleton-approved');
    if (singletonPaths.length > 0 && !singletonApproved) {
      emitJson({
        ok: false,
        code: 'singleton_path_conflict',
        message: `File scope includes singleton-only paths that require serialized execution: ${singletonPaths.join(', ')}. Pass --singleton-approved to confirm PM/orchestrator approval for this singleton lane.`,
        singleton_paths: singletonPaths,
      });
      process.exit(1);
    }

    const concurrencyConfig = loadConcurrencyConfig();
    const concurrencyViolations = checkConcurrencyLimits(
      readAllManifests(),
      canonicalLaneType,
      executor,
      concurrencyConfig,
    );
    if (concurrencyViolations.length > 0) {
      emitJson({
        ok: false,
        code: 'concurrency_limit_exceeded',
        message: concurrencyViolations[0]!.message,
        violations: concurrencyViolations,
        config_path: 'docs/governance/CONCURRENCY_CONFIG.json',
      });
      process.exit(1);
    }

    const overlap = activeManifestOverlap(issueId, normalizedFiles);
    if (overlap) {
      emitJson({
        ok: false,
        code: 'file_scope_conflict',
        message: `Requested file scope overlaps with active lane ${overlap.issue_id}`,
        conflicting_issue_id: overlap.issue_id,
        overlapping_files: overlap.overlapping_files,
      });
      process.exit(1);
    }

    const currentHead = currentHeadSha();
    const preflight = validatePreflightToken(issueId, branch, currentHead);
    const worktreePath = worktreePathForBranch(branch);
    const branchAlreadyExists = branchExists(branch);
    const worktreeAlreadyExists = worktreeExists(worktreePath);
    const manifestPath = issueToManifestPath(issueId);

    if (branchAlreadyExists && worktreeAlreadyExists) {
      if (!manifestExists(issueId)) {
        throw new Error('Branch and worktree already exist but no manifest exists for this issue');
      }

      const manifest = readManifest(issueId);
      const resumableStatuses = new Set(['started', 'in_progress', 'blocked', 'reopened']);
      if (
        manifest.branch !== branch ||
        manifest.worktree_path !== worktreePath ||
        !resumableStatuses.has(manifest.status)
      ) {
        throw new Error(
          'Existing branch/worktree may resume only when manifest matches issue, branch, worktree, and resumable status',
        );
      }
      const cwdErrors = validateExecutionCwd(worktreePath, manifest.execution_location?.cwd ?? worktreePath);
      if (cwdErrors.length > 0) {
        throw new Error(`Existing manifest execution cwd is incoherent: ${cwdErrors.join('; ')}`);
      }

      const setup = prepareLaneWithIsolatedPnpm(worktreePath, normalizedFiles);
      const lease = reserveLease({
        issue_id: issueId,
        branch,
        executor,
        cwd: worktreePath,
        worktree_path: worktreePath,
        execution_location: { cwd: setup.execution_location.cwd },
        file_scope_lock: normalizedFiles,
        owner: defaultLeaseOwner(),
      });
      if (!lease.ok) {
        throw new Error(`Lane lease check failed: ${lease.code} ${lease.message}`);
      }
      manifest.heartbeat_at = new Date().toISOString();
      manifest.execution_location = setup.execution_location;
      writeManifest(manifest);
      emitJson({
        ok: true,
        code: 'lane_resumed',
        issue_id: issueId,
        branch,
        worktree_path: worktreePath,
        cwd: setup.execution_location.cwd,
        execution_location: setup.execution_location,
        lease_code: lease.code,
        lease_path: lease.lease_path,
        manifest_path: relativeToRoot(manifestPath),
        status: manifest.status,
      });
      return;
    }

    if (branchAlreadyExists && !worktreeAlreadyExists) {
      throw new Error('Branch exists but worktree does not exist; Phase 1 fails closed');
    }
    if (!branchAlreadyExists && worktreeAlreadyExists) {
      throw new Error('Worktree exists but branch does not exist; Phase 1 fails closed');
    }

    if (!branchAlreadyExists && !worktreeAlreadyExists) {
      createBranchAndWorktree(branch, worktreePath);
      linkWorktreeEnv(worktreePath);
    }
    const setup = prepareLaneWithIsolatedPnpm(worktreePath, normalizedFiles);
    const lease = reserveLease({
      issue_id: issueId,
      branch,
      executor,
      cwd: worktreePath,
      worktree_path: worktreePath,
      execution_location: { cwd: setup.execution_location.cwd },
      file_scope_lock: normalizedFiles,
      owner: defaultLeaseOwner(),
    });
    if (!lease.ok) {
      throw new Error(`Lane lease check failed: ${lease.code} ${lease.message}`);
    }

    const now = new Date().toISOString();
    const existingManifest = manifestExists(issueId) ? readManifest(issueId) : null;
    if (existingManifest && existingManifest.status !== 'done') {
      throw new Error(`Manifest already exists for ${issueId} with non-done status ${existingManifest.status}`);
    }

    const manifest = createManifest({
      issue_id: issueId,
      tier,
      branch,
      worktree_path: worktreePath,
      file_scope_lock: normalizedFiles,
      expected_proof_paths: defaultProofPaths(issueId, tier),
      preflight_token: preflight.tokenRelativePath,
      lane_type: canonicalLaneType,
      executor,
      created_by: executor === 'claude' ? 'claude' : 'codex-cli',
      status: 'started',
      now,
      requireExistingPreflightToken: true,
    });
    manifest.execution_location = setup.execution_location;
    writeManifest(manifest);
    writeSyncFile(issueId, buildSyncYml(issueId));

    emitJson({
      ok: true,
      code: 'lane_started',
      issue_id: issueId,
      tier,
      branch,
      worktree_path: worktreePath,
      cwd: setup.execution_location.cwd,
      execution_location: setup.execution_location,
      lease_code: lease.code,
      lease_path: lease.lease_path,
      manifest_path: relativeToRoot(manifestPath),
      file_scope_lock: normalizedFiles,
      expected_proof_paths: manifest.expected_proof_paths,
      preflight_token: preflight.tokenRelativePath,
      status: 'started',
    });
  } catch (error) {
    emitJson({
      ok: false,
      code: 'lane_start_failed',
      message: error instanceof Error ? error.message : String(error),
      issue_id: issueId || null,
      tier: tierInput ?? null,
      branch: branch ?? null,
    });
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
