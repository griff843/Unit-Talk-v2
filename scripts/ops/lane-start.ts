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
import { evaluateSubstrate, gatherSubstrateFacts } from './substrate-guard.js';
import {
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
  requireVerificationTarget,
  validateBranchName,
  validatePreflightToken,
  validateTier,
  worktreeExists,
  worktreePathForBranch,
  writeManifest,
  ROOT,
  type CanonicalLaneType,
  type LaneExecutor,
} from './shared.js';
import { getEffectiveConfig, loadConcurrencyConfig } from './concurrency-config.js';
import { resolveModelProfile, type ModelRoutingBlock } from './model-routing.js';
// checkConcurrencyLimits() is the real, fail-closed mechanical authority for lane
// admission -- it lives in concurrency-rules.ts (not here) so that lane-maximizer.ts's
// advisory wave planner can import and call the exact same implementation instead of
// carrying a second, textually-divergent copy of the same rules. Re-exported below so
// every existing caller of `./lane-start.js`'s checkConcurrencyLimits/ConcurrencyViolation/
// IncomingLaneScope (e.g. concurrency-simulation.test.ts) keeps working unchanged.
export { checkConcurrencyLimits } from './concurrency-rules.js';
export type { ConcurrencyViolation, IncomingLaneScope } from './concurrency-rules.js';
import { checkConcurrencyLimits } from './concurrency-rules.js';

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

function isDocsOnlyFastPathFile(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return (
    normalized.startsWith('docs/06_status/') ||
    (normalized.startsWith('.claude/commands/') && normalized.endsWith('.md'))
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

export function buildPnpmStateEnv(cwd: string): NodeJS.ProcessEnv {
  const stateRoot = path.join(cwd, '.out', 'pnpm-state');
  const dirs = {
    home: path.join(stateRoot, 'home'),
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
    NPM_CONFIG_STATE_DIR: dirs.state,
    npm_config_cache: dirs.cache,
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
  const docsOnlyFastPath = bools.has('docs-only-fast-path') || flags.has('docs-only-fast-path');

  try {
    const missing: string[] = [];
    if (!tierInput) {
      missing.push('--tier');
    }
    if (!branch) {
      missing.push('--branch');
    }
    if (!laneType && !docsOnlyFastPath) {
      missing.push('--lane-type');
    }
    if (fileArgs.length === 0) {
      missing.push('--files (repeatable, at least one required)');
    }
    if (missing.length > 0) {
      throw new Error(
        `Missing required argument(s): ${missing.join(', ')}. ` +
          `Example: pnpm ops:lane-start ${issueId || 'UTV2-123'} --tier T2 --branch codex/utv2-123-example ` +
          `--lane-type <type> --files path/to/file.ts [--files path/to/other.ts]. ` +
          `Valid --lane-type values: ${CANONICAL_LANE_TYPES.join(', ')} (or legacy: ${Object.keys(LEGACY_EXECUTOR_MAP).join(', ')}).`,
      );
    }

    // Fail closed on an unsafe lane substrate before reserving a lease or
    // creating a worktree (UTV2 SPRINT-OPS-LANE-SUBSTRATE-STABILIZATION-001).
    // Local checks only here (lease dir, merge-lock validity, active-lane
    // worktree integrity); board hard_fail + Linear drift are enforced by the
    // standalone `pnpm ops:substrate-guard` run in dispatch Phase 0. Break-glass
    // via --force-unsafe-substrate (logged in the failure payload).
    const forceUnsafeSubstrate = bools.has('force-unsafe-substrate') || flags.has('force-unsafe-substrate');
    const substrateReport = evaluateSubstrate(gatherSubstrateFacts({ includeMergeRisk: false }));
    if (!substrateReport.ok && !forceUnsafeSubstrate) {
      emitJson({
        ok: false,
        code: 'substrate_unsafe',
        message:
          'Lane substrate is unsafe; refusing to start lane. Run `pnpm ops:substrate-guard` for full detail, resolve the findings, or pass --force-unsafe-substrate to override.',
        findings: substrateReport.findings.filter((f) => f.severity === 'hard_fail'),
      });
      process.exit(1);
    }

    const tier = validateTier(tierInput);
    validateBranchName(branch);
    const normalizedFiles = normalizeFileScope(fileArgs);

    if (docsOnlyFastPath) {
      const nonDocsFiles = normalizedFiles.filter((filePath) => !isDocsOnlyFastPathFile(filePath));
      if (tier !== 'T3') {
        emitJson({
          ok: false,
          code: 'docs_only_fast_path_invalid_tier',
          message: '--docs-only-fast-path is restricted to T3 lanes.',
        });
        process.exit(1);
      }
      if (nonDocsFiles.length > 0) {
        emitJson({
          ok: false,
          code: 'docs_only_fast_path_scope_violation',
          message: `--docs-only-fast-path allows only docs/status paths; rejected: ${nonDocsFiles.join(', ')}`,
          rejected_files: nonDocsFiles,
        });
        process.exit(1);
      }

      const currentHead = currentHeadSha();
      const preflight = validatePreflightToken(issueId, branch, currentHead);

      // Do not trust the preflight token's PL6 overlap result alone: a
      // preflight token remains usable after generation, so another lane can
      // lock one of these same docs/status files in the window between
      // preflight and this lane-start invocation. Recheck overlap against
      // current manifest state immediately before emitting success so a
      // fast-path lane can never silently coexist with a conflicting active
      // lane on the same file.
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

      emitJson({
        ok: true,
        code: 'docs_only_fast_path',
        issue_id: issueId,
        tier,
        branch,
        file_scope: normalizedFiles,
        preflight_token: preflight.tokenRelativePath,
        message:
          'T3 docs-only fast path validated; lane-start intentionally skipped worktree, manifest, lease, sync, and proof scaffolding.',
      });
      return;
    }

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

    // Model-profile resolution/enforcement happens later, ONLY on the path that
    // actually calls createManifest (a genuinely new lane) -- see the comment at that
    // call site. A `pnpm ops:lane:resume` re-invocation of ops:lane-start for an
    // existing, blocked Codex lane must NOT be required to (re)specify --model-profile;
    // it takes the "already exists" branch below, which never calls createManifest and
    // simply preserves whatever model_routing the manifest already has (PM review
    // finding #1). Enforcing this check unconditionally here would have broken every
    // Codex lane resume.
    const isCodexExecutor = executor === 'codex-cli' || executor === 'codex-cloud';
    const modelProfileFlag = flags.get('model-profile')?.at(-1);
    if (!isCodexExecutor && modelProfileFlag) {
      emitJson({
        ok: false,
        code: 'model_profile_not_applicable',
        message: `--model-profile was supplied but executor "${executor}" is not Codex. model_routing is Codex-only.`,
      });
      process.exit(1);
    }

    // Same resume-vs-new-lane reasoning as model-profile above: only required/consumed
    // on the path that calls createManifest for a brand-new verification lane.
    const isVerificationLaneType = canonicalLaneType === 'verification';
    let verificationTargetFlag = flags.get('verification-target')?.at(-1);
    if (!isVerificationLaneType && verificationTargetFlag) {
      emitJson({
        ok: false,
        code: 'verification_target_not_applicable',
        message: `--verification-target was supplied but --lane-type is "${laneType}", not verification. verification_target is verification-lane-only.`,
      });
      process.exit(1);
    }
    // Codex review fix (PR #1213): validate format immediately, before createBranchAndWorktree
    // or reserveLease run below -- a malformed value must never leave orphaned branch/worktree/
    // lease state behind it. (createManifest's own validation is defense-in-depth, not the
    // first line of defense.)
    if (verificationTargetFlag) {
      try {
        // Codex review fix (PR #1215, round 5): reassign to the normalized return value so
        // every downstream consumer (checkConcurrencyLimits, createManifest, the
        // resume-backfill comparison) sees the same canonical form -- a discarded return
        // value previously let a lower-case input pass this check but still fail deep inside
        // createManifest(), after branch/worktree/lease side effects had already run.
        // Codex review fix (PR #1215, round 6): use requireVerificationTarget(), not the
        // general requireIssueId() -- the latter also accepts UNI-### (ISSUE_PATTERN), but
        // verification_target is documented UTV2-### only in the manifest schema and
        // LANE_MANIFEST_SPEC.md §16; accepting UNI-### here would silently disagree with
        // that documented contract.
        verificationTargetFlag = requireVerificationTarget(verificationTargetFlag);
      } catch {
        emitJson({
          ok: false,
          code: 'verification_target_malformed',
          message: `--verification-target must match UTV2-### (got "${verificationTargetFlag}").`,
        });
        process.exit(1);
      }
    }

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

    // Codex review fix (PR #1213): ops:lane:resume re-invokes ops:lane-start for an
    // existing blocked lane without re-supplying --verification-target (mirrors how it
    // doesn't re-supply --model-profile) -- backfill from the existing manifest so
    // resuming a verification lane doesn't spuriously fail the per-target cap's
    // "missing target" check. Also exclude the incoming issue's own active manifest from
    // the conflict-search set below: a lane must never be treated as conflicting with
    // itself on resume (this is a no-op for a genuinely new issue_id, since no manifest
    // with that id exists yet).
    const existingManifestForResume = manifestExists(issueId) ? readManifest(issueId) : null;
    const effectiveVerificationTarget = verificationTargetFlag ?? existingManifestForResume?.verification_target;

    const concurrencyConfig = getEffectiveConfig(loadConcurrencyConfig());
    const concurrencyViolations = checkConcurrencyLimits(
      readAllManifests().filter((m) => m.issue_id !== issueId),
      canonicalLaneType,
      executor,
      concurrencyConfig,
      { fileScopeLock: normalizedFiles, verificationTarget: effectiveVerificationTarget },
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
      if (manifest.status === 'blocked') {
        manifest.status = 'in_progress';
        manifest.blocked_by = [];
      }
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

    // Model-profile resolution: only reached when genuinely creating a new lane (never
    // on a resume re-invocation, which returned above at the "already exists" branch).
    // Resolved before any branch/worktree/lease side effects so a bad profile fails
    // closed without leaving orphaned state behind.
    let modelRouting: ModelRoutingBlock | undefined;
    if (isCodexExecutor) {
      if (!modelProfileFlag) {
        emitJson({
          ok: false,
          code: 'model_profile_required',
          message: `Codex lane ${issueId} requires --model-profile <profile-name> (see docs/05_operations/policies/codex-model-routing.json for valid profiles).`,
        });
        process.exit(1);
      }
      // No --override-authorized-by/--override-reason flags: PM review finding #3 --
      // a caller-supplied override is not proof of PM authorization, so lane-start does
      // not accept one. requires_pm_authorization profiles are mechanically unavailable
      // until a trusted external mechanism exists (see codex-model-routing.json).
      const resolution = resolveModelProfile({ profileName: modelProfileFlag, tier });
      if (!resolution.ok) {
        emitJson({
          ok: false,
          code: `model_routing_${resolution.code.toLowerCase()}`,
          message: resolution.message,
        });
        process.exit(1);
      }
      modelRouting = resolution.model_routing!;
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

    // Codex lanes get an additional declared proof path for the model-routing evidence
    // sidecar codex-exec.ts writes and commits (PM review finding #4) -- declaring it
    // here means the path is already in the lane's own scope; docs/06_status/proof/**
    // is exempt from the file-scope existence check (it's an intent declaration).
    const expectedProofPaths = defaultProofPaths(issueId, tier);
    if (isCodexExecutor) {
      expectedProofPaths.push(`docs/06_status/proof/${issueId}/model-routing.json`);
    }

    const manifest = createManifest({
      issue_id: issueId,
      tier,
      branch,
      worktree_path: worktreePath,
      file_scope_lock: normalizedFiles,
      expected_proof_paths: expectedProofPaths,
      preflight_token: preflight.tokenRelativePath,
      lane_type: canonicalLaneType,
      executor,
      created_by: executor === 'claude' ? 'claude' : 'codex-cli',
      status: 'started',
      now,
      requireExistingPreflightToken: true,
      model_routing: modelRouting,
      ...(verificationTargetFlag ? { verification_target: verificationTargetFlag } : {}),
    });

    // UTV2-1492: declared-proof-path validation for T1 (formerly preflight's
    // PX5) lives here, not in preflight.ts. A manifest exists at this point,
    // so expected_proof_paths can actually be checked — preflight runs
    // before any manifest exists and must never require implementation
    // evidence. This does not require any *content* in the proof dir (that
    // remains proof-gate.yml's and truth-check-lib.ts's job); it only
    // guards against a T1 lane somehow declaring zero expected proof paths.
    if (tier === 'T1' && manifest.expected_proof_paths.length === 0) {
      throw new Error(
        `T1 lane ${issueId} has no expected_proof_paths declared — a T1 lane must declare at least one proof path before it can start`,
      );
    }

    manifest.execution_location = setup.execution_location;
    writeManifest(manifest);
    writeSyncFile(issueId, buildSyncYml(issueId));

    // The empty proof directory (UTV2-1492) is scaffolded directly inside
    // the lane worktree below, alongside the manifest/sync mirror — not in
    // the main checkout, which must stay clean/control-plane-only (PG2).
    // Operators/executors no longer need to hand-create
    // docs/06_status/proof/<issue>/ before preflight — doing so used to be
    // the only way to satisfy preflight's now-removed PX5 check, and it was
    // exactly what tripped PX3/PX4's content validation before any
    // implementation existed. Real proof content is populated during
    // implementation and validated later by proof-gate.yml (CI on PR) and
    // truth-check-lib.ts (ops:lane-close) — this scaffold is empty on
    // purpose.

    // Mirror manifest and sync file into the worktree and commit so the lane
    // branch carries its own metadata without requiring a manual copy from main.
    const worktreeManifestDir = path.join(worktreePath, 'docs', '06_status', 'lanes');
    fs.mkdirSync(worktreeManifestDir, { recursive: true });
    fs.copyFileSync(manifestPath, path.join(worktreeManifestDir, `${issueId}.json`));
    const worktreeSyncDir = path.join(worktreePath, '.ops', 'sync');
    fs.mkdirSync(worktreeSyncDir, { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, '.ops', 'sync', `${issueId}.yml`),
      path.join(worktreeSyncDir, `${issueId}.yml`)
    );
    const worktreeProofDir = path.join(worktreePath, 'docs', '06_status', 'proof', issueId);
    fs.mkdirSync(worktreeProofDir, { recursive: true });
    const worktreeProofGitkeep = path.join(worktreeProofDir, '.gitkeep');
    if (!fs.existsSync(worktreeProofGitkeep)) {
      fs.writeFileSync(worktreeProofGitkeep, '', 'utf8');
    }
    spawnSync(
      'git',
      [
        'add',
        `docs/06_status/lanes/${issueId}.json`,
        `.ops/sync/${issueId}.yml`,
        `docs/06_status/proof/${issueId}/.gitkeep`,
      ],
      { cwd: worktreePath, stdio: 'inherit' }
    );
    spawnSync(
      'git',
      ['commit', '-m', `chore(lanes): ${issueId} lane manifest and sync metadata`],
      { cwd: worktreePath, stdio: 'inherit' }
    );

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
