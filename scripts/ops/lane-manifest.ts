import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
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
  type LaneExecutor,
} from './shared.js';
import { buildLaneExecutionLocation } from './lane-execution.js';
import { resolveModelProfile, type ModelRoutingBlock } from './model-routing.js';

interface PullRequestMergeInfo {
  input: string;
  url: string;
  merged: boolean;
  mergeSha: string | null;
  state?: string | null;
}

interface RecordMergeInput {
  manifest: LaneManifest;
  pr: PullRequestMergeInfo;
  now: string;
}

interface RecordMergeResult {
  manifest: LaneManifest;
  changed: boolean;
  historyAppended: boolean;
}

export function main(argv = process.argv.slice(2)): number {
  const { positionals, flags, bools } = parseArgs(argv);
  const command = positionals[0];

  try {
    switch (command) {
      case 'create':
        createCommand(flags);
        return 0;
      case 'read':
        readCommand(positionals[1], bools.has('json'));
        return 0;
      case 'update':
        updateCommand(positionals[1], flags, bools.has('json'));
        return 0;
      case 'record-merge':
        recordMergeCommand(positionals[1], flags, bools.has('json'));
        return 0;
      case 'validate':
        validateCommand(positionals[1], bools.has('json'));
        return 0;
      case 'status':
        statusCommand(positionals[1], bools.has('json'));
        return 0;
      default:
        usage();
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (bools.has('json')) {
      emitJson({ ok: false, code: 'manifest_error', message });
    } else {
      console.error(message);
    }
    return 1;
  }
}

export function createCommand(flags: Map<string, string[]>) {
  const issueId = getRequired(flags, 'issue');
  const tier = validateTier(getRequired(flags, 'tier'));
  const branch = getRequired(flags, 'branch');
  validateBranchName(branch);
  const files = getFlags(flags, 'files');
  if (files.length === 0) {
    throw new Error('Missing --files (repeatable, at least one required)');
  }

  const fileScopeLock = normalizeFileScope(files);
  const worktreePath = worktreePathForBranch(branch);
  const executorFlag = getFlag(flags, 'executor');
  const executor = executorFlag as LaneExecutor | undefined;
  const isCodexExecutor = executor === 'codex-cli' || executor === 'codex-cloud';
  const modelProfileFlag = getFlag(flags, 'model-profile');
  let modelRouting: ModelRoutingBlock | undefined;
  if (isCodexExecutor) {
    if (!modelProfileFlag) {
      throw new Error(
        `--model-profile is required when --executor is codex-cli/codex-cloud (manual/repair manifest creation, UTV2-1526). ` +
          `See docs/05_operations/policies/codex-model-routing.json for valid profiles.`,
      );
    }
    const resolution = resolveModelProfile({ profileName: modelProfileFlag, tier });
    if (!resolution.ok) {
      throw new Error(`model-profile resolution failed for "${modelProfileFlag}": ${resolution.code} ${resolution.message}`);
    }
    modelRouting = resolution.model_routing;
  } else if (modelProfileFlag) {
    throw new Error('--model-profile was supplied but --executor is not codex-cli/codex-cloud. model_routing is Codex-only.');
  }

  const manifest = createManifest({
    issue_id: issueId.toUpperCase(),
    tier,
    branch,
    worktree_path: worktreePath,
    file_scope_lock: fileScopeLock,
    expected_proof_paths: getFlags(flags, 'proof-path'),
    preflight_token: getRequired(flags, 'preflight-token'),
    executor,
    model_routing: modelRouting,
  });
  manifest.execution_location = buildLaneExecutionLocation(worktreePath, fileScopeLock);
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
    // UTV2-1668: `superseded` is a terminal that asserts work did NOT ship.
    // Reaching it through a raw status write verifies nothing -- no PR state,
    // no actor, no successor, no lease release -- so the governed command owns
    // it exclusively and this path refuses with the remedy named.
    if (nextStatus === 'superseded') {
      throw new Error(
        'Refusing to set status "superseded" through ops:lane-manifest update: this terminal ' +
        'requires verified PR state, a structured reason, actor and successor, and transactional ' +
        'lease release. Use: npx tsx scripts/ops/lane-supersede.ts ' +
        `${manifest.issue_id} --reason <text> --successor UTV2-### --source-pr <#> ` +
        '--rejected-head <sha> --actor <id>',
      );
    }
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

function recordMergeCommand(
  issueId: string | undefined,
  flags: Map<string, string[]>,
  json: boolean,
): void {
  const prInput = getFlag(flags, 'pr') ?? getFlag(flags, 'pr-url') ?? getFlag(flags, 'pr-number');
  const missing: string[] = [];
  if (!issueId) {
    missing.push('issue id (positional arg)');
  }
  if (!prInput) {
    missing.push('--pr (GitHub PR URL or number)');
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required argument(s): ${missing.join(', ')}. ` +
        'Example: pnpm ops:lane-manifest -- record-merge UTV2-123 --pr 456',
    );
  }

  // Issue id is required before we can look up the manifest, so this check
  // stays after the combined missing-args check above but before manifest lookup.
  if (!manifestExists(issueId!.toUpperCase())) {
    throw new Error(`Manifest not found for ${issueId}`);
  }

  const manifest = readManifest(issueId!.toUpperCase());
  const pr = fetchPullRequestMergeInfo(prInput!);
  const result = applyPrMergeToManifest({
    manifest,
    pr,
    now: new Date().toISOString(),
  });
  writeManifest(result.manifest);

  const payload = {
    ok: true,
    code: result.changed ? 'merge_sha_recorded' : 'merge_sha_already_recorded',
    issue_id: result.manifest.issue_id,
    status: result.manifest.status,
    pr_url: result.manifest.pr_url,
    commit_sha: result.manifest.commit_sha,
    heartbeat_at: result.manifest.heartbeat_at,
    history_appended: result.historyAppended,
  };
  if (json) {
    emitJson(payload);
    return;
  }
  console.log(`${payload.issue_id} ${payload.status} ${payload.commit_sha}`);
}

/**
 * Binds a lane manifest to authoritative GitHub merge state: status, the
 * merge SHA, and the PR URL. Nothing else.
 *
 * UTV2-1613: this function used to also unconditionally append a
 * `truth_check_history` entry — `{ verdict: 'pass', failures: [], runner:
 * 'manual', source: 'github_pr_merge_commit' }` — from nothing but the fact
 * that a PR merged. No truth-check ever ran here; `record-merge` only talks
 * to the GitHub API for PR state. That entry is worse than the sibling
 * fabrication in `lane-close.ts`'s old `--repair-merged` path in one
 * specific way: `runner: 'manual'` IS a canonical runner value, so a
 * runner-union check alone cannot distinguish it from a real manually-
 * recorded pass. The only fix that actually closes the gap is to never write
 * a governance verdict here at all — this function inherently cannot measure
 * one, so it does not claim one. `truth_check_history` is left byte-for-byte
 * as the caller supplied it; `historyAppended` always reports `false`,
 * preserved for interface stability with existing callers.
 */
export function applyPrMergeToManifest(input: RecordMergeInput): RecordMergeResult {
  const mergeSha = normalizeSha(input.pr.mergeSha);
  if (!input.pr.merged || !mergeSha) {
    throw new Error(
      `PR ${input.pr.input} is not merged or has no merge commit SHA (state=${input.pr.state ?? 'unknown'})`,
    );
  }

  const existingSha = normalizeSha(input.manifest.commit_sha);
  if (existingSha && existingSha !== mergeSha) {
    throw new Error(
      `Manifest commit_sha ${existingSha} conflicts with PR merge SHA ${mergeSha}`,
    );
  }

  const next: LaneManifest = {
    ...input.manifest,
    status: input.manifest.status === 'done' ? 'done' : 'merged',
    commit_sha: mergeSha,
    pr_url: input.manifest.pr_url ?? input.pr.url,
    heartbeat_at: input.now,
    truth_check_history: input.manifest.truth_check_history ?? [],
  };

  return {
    manifest: next,
    changed:
      input.manifest.status !== next.status ||
      input.manifest.commit_sha !== next.commit_sha ||
      input.manifest.pr_url !== next.pr_url ||
      input.manifest.heartbeat_at !== next.heartbeat_at,
    historyAppended: false,
  };
}

function normalizeSha(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized : null;
}

function fetchPullRequestMergeInfo(prInput: string): PullRequestMergeInfo {
  const pr = normalizePrInput(prInput);
  const result = spawnSync('gh', ['pr', 'view', pr, '--json', 'url,state,mergedAt,mergeCommit'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`GitHub PR lookup failed for ${prInput}: ${(result.stderr ?? '').trim() || 'unknown error'}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    url?: string;
    state?: string;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string | null } | null;
  };
  const state = parsed.state?.toLowerCase() ?? null;
  return {
    input: prInput,
    url: parsed.url ?? prInput,
    merged: state === 'merged' || Boolean(parsed.mergedAt),
    mergeSha: parsed.mergeCommit?.oid ?? null,
    state,
  };
}

function normalizePrInput(input: string): string {
  const value = input.trim();
  const match = value.match(/\/pull\/(\d+)(?:\b|$)/);
  return match?.[1] ?? value;
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
    cwd: manifest.execution_location?.cwd ?? manifest.worktree_path,
    execution_location: manifest.execution_location,
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
  console.error('  pnpm ops:lane-manifest -- record-merge UTV2-123 --pr <url-or-number> [--json]');
  console.error('  pnpm ops:lane-manifest -- validate UTV2-123 [--json]');
  console.error('  pnpm ops:lane-manifest -- status UTV2-123 [--json]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
