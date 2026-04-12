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
  readManifest,
  relativeToRoot,
  requireIssueId,
  validateBranchName,
  validatePreflightToken,
  validateTier,
  worktreeExists,
  worktreePathForBranch,
  writeManifest,
} from './shared.js';

function main(): void {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const tierInput = flags.get('tier')?.at(-1);
  const branch = flags.get('branch')?.at(-1);
  const laneType = flags.get('lane-type')?.at(-1) ?? 'codex-cli';
  const fileArgs = flags.get('files') ?? [];

  try {
    if (!tierInput) {
      throw new Error('Missing required --tier');
    }
    if (!branch) {
      throw new Error('Missing required --branch');
    }
    if (fileArgs.length === 0) {
      throw new Error('Missing required --files (repeatable, at least one required)');
    }

    const tier = validateTier(tierInput);
    validateBranchName(branch);
    if (!['claude', 'codex-cli', 'codex-cloud'].includes(laneType)) {
      throw new Error(`Invalid --lane-type: ${laneType}`);
    }
    const normalizedFiles = normalizeFileScope(fileArgs);
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

      manifest.heartbeat_at = new Date().toISOString();
      writeManifest(manifest);
      emitJson({
        ok: true,
        code: 'lane_resumed',
        issue_id: issueId,
        branch,
        worktree_path: worktreePath,
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
      lane_type: laneType as 'claude' | 'codex-cli' | 'codex-cloud',
      created_by: laneType === 'claude' ? 'claude' : 'codex-cli',
      status: 'started',
      now,
    });
    writeManifest(manifest);

    emitJson({
      ok: true,
      code: 'lane_started',
      issue_id: issueId,
      tier,
      branch,
      worktree_path: worktreePath,
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

main();
