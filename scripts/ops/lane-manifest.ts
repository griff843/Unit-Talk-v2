import {
  type LaneManifest,
  assertStatusTransition,
  createManifest,
  emitJson,
  getFlag,
  getFlags,
  issueToManifestPath,
  manifestExists,
  normalizeFileScope,
  normalizeRepoRelativePaths,
  parseArgs,
  readManifest,
  relativeToRoot,
  validateBranchName,
  validateManifest,
  validateTier,
  worktreePathForBranch,
  writeManifest,
} from './shared.js';

function main(): void {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const command = positionals[0];

  try {
    switch (command) {
      case 'create':
        createCommand(flags);
        return;
      case 'read':
        readCommand(positionals[1], bools.has('json'));
        return;
      case 'update':
        updateCommand(positionals[1], flags, bools.has('json'));
        return;
      case 'validate':
        validateCommand(positionals[1], bools.has('json'));
        return;
      case 'status':
        statusCommand(positionals[1], bools.has('json'));
        return;
      default:
        usage();
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (bools.has('json')) {
      emitJson({ ok: false, code: 'manifest_error', message });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

function createCommand(flags: Map<string, string[]>) {
  const issueId = getRequired(flags, 'issue');
  const tier = validateTier(getRequired(flags, 'tier'));
  const branch = getRequired(flags, 'branch');
  validateBranchName(branch);
  const files = getFlags(flags, 'files');
  if (files.length === 0) {
    throw new Error('Missing --files (repeatable, at least one required)');
  }

  const manifest = createManifest({
    issue_id: issueId.toUpperCase(),
    tier,
    branch,
    worktree_path: worktreePathForBranch(branch),
    file_scope_lock: normalizeFileScope(files),
    expected_proof_paths: getFlags(flags, 'proof-path'),
    preflight_token: getRequired(flags, 'preflight-token'),
  });
  writeManifest(manifest);
  emitJson({
    ok: true,
    code: 'manifest_created',
    issue_id: manifest.issue_id,
    manifest_path: relativeToRoot(issueToManifestPath(manifest.issue_id)),
  });
}

function readCommand(issueId: string | undefined, json: boolean): void {
  if (!issueId) {
    throw new Error('Missing issue id');
  }
  const manifest = readManifest(issueId.toUpperCase());
  if (json) {
    emitJson(manifest);
    return;
  }
  console.log(JSON.stringify(manifest, null, 2));
}

function updateCommand(
  issueId: string | undefined,
  flags: Map<string, string[]>,
  json: boolean,
): void {
  if (!issueId) {
    throw new Error('Missing issue id');
  }
  if (!manifestExists(issueId.toUpperCase())) {
    throw new Error(`Manifest not found for ${issueId}`);
  }

  const manifest = readManifest(issueId.toUpperCase());
  const next: LaneManifest = {
    ...manifest,
    heartbeat_at: new Date().toISOString(),
  };

  const nextStatus = getFlag(flags, 'status');
  if (nextStatus) {
    assertStatusTransition(manifest.status, nextStatus as LaneManifest['status']);
    next.status = nextStatus as LaneManifest['status'];
  }

  const prUrl = getFlag(flags, 'pr-url');
  if (prUrl) {
    next.pr_url = prUrl;
  }
  const commitSha = getFlag(flags, 'commit-sha');
  if (commitSha) {
    next.commit_sha = commitSha;
  }
  const filesChanged = getFlags(flags, 'files-changed');
  if (filesChanged.length > 0) {
    next.files_changed = normalizeRepoRelativePaths(filesChanged);
  }
  const blockedBy = getFlags(flags, 'blocked-by');
  if (blockedBy.length > 0) {
    next.blocked_by = blockedBy;
  }
  if (next.status === 'done' && !next.closed_at) {
    next.closed_at = new Date().toISOString();
  }

  writeManifest(next);

  if (json) {
    emitJson({
      ok: true,
      code: 'manifest_updated',
      issue_id: next.issue_id,
      status: next.status,
    });
    return;
  }
  console.log(`${next.issue_id} ${next.status}`);
}

function validateCommand(issueId: string | undefined, json: boolean): void {
  if (!issueId) {
    throw new Error('Missing issue id');
  }
  const manifestPath = issueToManifestPath(issueId.toUpperCase());
  const manifest = readManifest(issueId.toUpperCase());
  const errors = validateManifest(manifest, manifestPath);
  if (json) {
    emitJson({
      ok: errors.length === 0,
      code: errors.length === 0 ? 'manifest_valid' : 'manifest_invalid',
      errors,
    });
    return;
  }
  if (errors.length === 0) {
    console.log('manifest valid');
    return;
  }
  for (const error of errors) {
    console.log(error);
  }
  process.exit(1);
}

function statusCommand(issueId: string | undefined, json: boolean): void {
  if (!issueId) {
    throw new Error('Missing issue id');
  }
  const manifest = readManifest(issueId.toUpperCase());
  const payload = {
    issue_id: manifest.issue_id,
    status: manifest.status,
    branch: manifest.branch,
    worktree_path: manifest.worktree_path,
    heartbeat_at: manifest.heartbeat_at,
    pr_url: manifest.pr_url,
    commit_sha: manifest.commit_sha,
  };
  if (json) {
    emitJson(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function getRequired(flags: Map<string, string[]>, key: string): string {
  const value = getFlag(flags, key);
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return value;
}

function usage(): void {
  console.error('Usage:');
  console.error('  pnpm ops:lane-manifest -- create --issue UTV2-123 --tier T2 --branch codex/utv2-123-foo --files path --preflight-token .out/ops/preflight/...json');
  console.error('  pnpm ops:lane-manifest -- read UTV2-123 [--json]');
  console.error('  pnpm ops:lane-manifest -- update UTV2-123 [--status merged] [--pr-url ...] [--commit-sha ...] [--files-changed path]');
  console.error('  pnpm ops:lane-manifest -- validate UTV2-123 [--json]');
  console.error('  pnpm ops:lane-manifest -- status UTV2-123 [--json]');
}

main();
