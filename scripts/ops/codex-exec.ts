/**
 * Canonical Codex execution entry point for Unit Talk V2 lane dispatch.
 *
 * This is the ONLY sanctioned way to run Codex on a lane. All dispatch
 * paths must go through here — never call `codex exec` directly.
 *
 * Usage:
 *   npx tsx scripts/ops/codex-exec.ts --issue UTV2-### [--dry-run]
 *
 * Exit codes:
 *   0 = Codex completed and PR opened
 *   1 = Codex failed or CLI unavailable
 *   2 = Precondition failed (no manifest, wrong CWD, health check failed, invalid/disabled
 *       model routing, policy-version mismatch, missing manual-override authority,
 *       delegation suspended -- UTV2-1546, see delegation-state.ts)
 *
 * Model routing (UTV2-1526): the manifest's `model_routing` block (or, for manifests that
 * predate that field, a documented legacy default) is validated against
 * docs/05_operations/policies/codex-model-routing.json and passed to `codex exec`
 * explicitly via --model / -c model_reasoning_effort=... — never the CLI's own default.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  currentHeadSha,
  emitJson,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  type LaneManifest,
} from './shared.js';
import {
  generateDispatchExecutionPacketResult,
  generateExecutionPacket,
  renderTaskContract,
  type ExecutionPacket,
  type ExecutionPacketResult,
} from './execution-packet.js';
import { requireDelegationActive } from './delegation-state.js';
import {
  buildCodexModelArgs,
  resolveLegacyModelRouting,
  validatePersistedModelRouting,
  type ModelRoutingBlock,
} from './model-routing.js';
import {
  beginAttempt,
  buildResumeBrief,
  buildResumePlan,
  checkpointPath,
  classifyCheckpointLiveness,
  failVisiblyAndRelease,
  finishAttempt,
  readCheckpointState,
  resolveExecutionTimeout,
  type ExecutionCheckpoint,
  type ExecutionStateIdentity,
  type ResumePlan,
  type TimeoutPolicyDecision,
} from './execution-checkpoint.js';

interface CodexExecResult {
  ok: boolean;
  code:
    | 'SUCCESS'
    | 'CODEX_UNAVAILABLE'
    | 'PRECONDITION_FAILED'
    | 'EXECUTION_PACKET_INVALID'
    | 'MODEL_ROUTING_INVALID'
    | 'DELEGATION_SUSPENDED'
    | 'EXECUTION_FAILED'
    | 'EXECUTION_TIMED_OUT'
    | 'EXECUTION_SILENT'
    | 'EXECUTION_CANCELLED'
    | 'EVIDENCE_PERSISTENCE_FAILED'
    | 'EXECUTION_STATE_UNAVAILABLE'
    | 'EXECUTION_CORROBORATION_UNAVAILABLE'
    | 'EXECUTION_BASELINE_NOT_ANCESTOR'
    | 'INCOMPLETE_PHASE_PROGRESSION'
    | 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE'
    | 'REWORK_NO_SOURCE_CHANGE'
    | 'DRY_RUN';
  issue_id: string;
  branch?: string;
  message: string;
  codex_exit_code?: number;
  dry_run?: boolean;
  model_routing_error_code?: string;
  model_profile?: string;
  model?: string;
  reasoning_effort?: string;
  policy_version?: string;
  legacy_compatibility_used?: boolean;
  codex_cli_version?: string | null;
  execution?: ExecutionSummary;
  source_files_changed?: number;
  checkpoint_provenance?: string;
}

type PacketResultLoader = (manifest: LaneManifest) => ExecutionPacketResult;

export function resolveCodexExecutionPacket(
  manifest: LaneManifest,
  onReady: (packet: ExecutionPacket) => void,
  emit: (value: unknown) => void = emitJson,
  loader: PacketResultLoader = generateDispatchExecutionPacketResult,
): number {
  const result = loader(manifest);
  if (!result.ok) {
    emit(result);
    return 2;
  }
  onReady(result.packet);
  return 0;
}

/**
 * The resume/timeout facts a caller needs to decide whether to re-dispatch:
 * which attempt this was, what phase it resumed at, what the bounded timeout
 * was and where it came from, and whether the executor went silent.
 */
export interface ExecutionSummary {
  epoch_id: string;
  epoch_mode: 'fresh' | 'rework';
  implementation_baseline_sha: string;
  attempt: number;
  attempt_start_sha: string;
  resumed: boolean;
  phase: string;
  resumed_from_phase: string;
  skipped_phases: string[];
  carried_findings: number;
  timeout_ms: number;
  timeout_policy_id: string;
  timeout_clamped: TimeoutPolicyDecision['clamped'];
  checkpoint_path: string;
  outcome?: string;
  heartbeat_state?: string;
  released_resources?: string[];
}

export interface ExecutionTruthVerdict {
  ok: boolean;
  code:
    | 'SUCCESS'
    | 'EXECUTION_STATE_UNAVAILABLE'
    | 'EXECUTION_CORROBORATION_UNAVAILABLE'
    | 'EXECUTION_BASELINE_NOT_ANCESTOR'
    | 'INCOMPLETE_PHASE_PROGRESSION'
    | 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE'
    | 'REWORK_NO_SOURCE_CHANGE';
  exit_code: 0 | 1;
  message: string;
  source_files_changed: number;
  changed_files: string[];
  checkpoint_provenance: 'primary' | 'sidecar' | 'none';
}

const REQUIRED_SUCCESS_PHASES = ['implement', 'verify', 'closeout'] as const;
const NON_SOURCE_PREFIXES = ['docs/', '.ops/'];

function changedFilesSince(
  cwd: string,
  baselineSha: string,
):
  | { ok: true; files: string[] }
  | {
      ok: false;
      code: 'EXECUTION_CORROBORATION_UNAVAILABLE' | 'EXECUTION_BASELINE_NOT_ANCESTOR';
      error: string;
    } {
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', baselineSha, 'HEAD'], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (ancestry.status === 1) {
    return {
      ok: false,
      code: 'EXECUTION_BASELINE_NOT_ANCESTOR',
      error: `epoch baseline ${baselineSha} is not an ancestor of HEAD`,
    };
  }
  if (ancestry.status !== 0) {
    return {
      ok: false,
      code: 'EXECUTION_CORROBORATION_UNAVAILABLE',
      error: ancestry.stderr || ancestry.stdout || `git merge-base exited ${ancestry.status}`,
    };
  }

  const diff = spawnSync('git', ['diff', '--name-only', baselineSha, 'HEAD'], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (diff.status !== 0) {
    return {
      ok: false,
      code: 'EXECUTION_CORROBORATION_UNAVAILABLE',
      error: diff.stderr || diff.stdout || `git diff exited ${diff.status}`,
    };
  }
  return {
    ok: true,
    files: diff.stdout
      .split('\n')
      .map((file) => file.trim())
      .filter((file) => file.length > 0),
  };
}

/**
 * Read execution truth from persisted epoch state. The caller cannot provide a
 * phase or a baseline: both come from the validated checkpoint, which makes an
 * attempt-local SHA or stale phase impossible to substitute at this boundary.
 */
export function evaluateExecutionTruth(input: {
  issueId: string;
  cwd: string;
  checkpointDir?: string;
  stateIdentity: ExecutionStateIdentity;
}): ExecutionTruthVerdict {
  const state = readCheckpointState(input.issueId, input.checkpointDir, input.stateIdentity);
  if (!state.ok || !state.checkpoint) {
    return {
      ok: false,
      code: 'EXECUTION_STATE_UNAVAILABLE',
      exit_code: 1,
      message: `mandatory post-spawn execution state is unavailable: ${state.reason}`,
      source_files_changed: 0,
      changed_files: [],
      checkpoint_provenance: 'none',
    };
  }

  const checkpoint = state.checkpoint;
  const completed = new Set(checkpoint.completed_phases.map((entry) => entry.phase));
  const missing = REQUIRED_SUCCESS_PHASES.filter((phase) => !completed.has(phase));
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'INCOMPLETE_PHASE_PROGRESSION',
      exit_code: 1,
      message: `current epoch ${checkpoint.epoch.epoch_id} is missing required phase(s): ${missing.join(', ')}`,
      source_files_changed: 0,
      changed_files: [],
      checkpoint_provenance: state.provenance.source,
    };
  }

  const diff = changedFilesSince(input.cwd, checkpoint.epoch.implementation_baseline_sha);
  if ('error' in diff) {
    return {
      ok: false,
      code: diff.code,
      exit_code: 1,
      message: `unable to corroborate the current epoch against Git: ${diff.error}`,
      source_files_changed: 0,
      changed_files: [],
      checkpoint_provenance: state.provenance.source,
    };
  }
  const sourceFiles = diff.files.filter(
    (file) => !NON_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  if (sourceFiles.length === 0) {
    const rework = checkpoint.epoch.mode === 'rework';
    return {
      ok: false,
      code: rework ? 'REWORK_NO_SOURCE_CHANGE' : 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE',
      exit_code: 1,
      message: rework
        ? `rework epoch ${checkpoint.epoch.epoch_id} changed zero source files from rejected head ${checkpoint.epoch.implementation_baseline_sha}`
        : `fresh epoch ${checkpoint.epoch.epoch_id} claimed implementation but changed zero source files from ${checkpoint.epoch.implementation_baseline_sha}`,
      source_files_changed: 0,
      changed_files: diff.files,
      checkpoint_provenance: state.provenance.source,
    };
  }

  return {
    ok: true,
    code: 'SUCCESS',
    exit_code: 0,
    message: `current epoch has valid phase state and ${sourceFiles.length} corroborating source file change(s)`,
    source_files_changed: sourceFiles.length,
    changed_files: diff.files,
    checkpoint_provenance: state.provenance.source,
  };
}

function findingsIdentity(checkpoint: ExecutionCheckpoint): string {
  const payload = checkpoint.findings.map((finding) => ({
    id: finding.id,
    phase: finding.phase,
    summary: finding.summary,
  }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildExecutionSummary(
  checkpoint: ExecutionCheckpoint,
  resume: ResumePlan,
  policy: TimeoutPolicyDecision,
  checkpointPathValue: string,
): ExecutionSummary {
  return {
    epoch_id: checkpoint.epoch.epoch_id,
    epoch_mode: checkpoint.epoch.mode,
    implementation_baseline_sha: checkpoint.epoch.implementation_baseline_sha,
    attempt: checkpoint.attempt,
    attempt_start_sha: checkpoint.attempts.at(-1)!.attempt_start_sha,
    resumed: resume.resumed,
    phase: checkpoint.phase,
    resumed_from_phase: resume.resume_from_phase,
    skipped_phases: resume.skipped_phases,
    carried_findings: resume.carried_findings.length,
    timeout_ms: policy.timeout_ms,
    timeout_policy_id: policy.policy_id,
    timeout_clamped: policy.clamped,
    checkpoint_path: checkpointPathValue,
  };
}

export interface ModelRoutingExecResolution {
  ok: boolean;
  code: string;
  message: string;
  model_routing?: ModelRoutingBlock;
  legacy_compatibility_used: boolean;
}

/**
 * Resolve the model routing to actually execute with: use the manifest's persisted
 * decision when present (validated against current policy), or fall back to the
 * documented legacy default when the manifest predates the model-routing policy. The
 * legacy result is never written back into the manifest -- callers must treat it as
 * execution-scoped only.
 */
export function resolveExecModelRouting(
  manifest: Pick<LaneManifest, 'model_routing' | 'tier' | 'schema_version'>,
): ModelRoutingExecResolution {
  if (manifest.model_routing) {
    const result = validatePersistedModelRouting(manifest.model_routing, manifest.tier);
    return {
      ok: result.ok,
      code: result.code,
      message: result.message,
      model_routing: result.model_routing,
      legacy_compatibility_used: false,
    };
  }
  // The version boundary is load-bearing here (PM review finding #2): only a
  // schema_version-1 manifest may fall back to the legacy default. A schema_version-2
  // Codex manifest with model_routing missing means it was deleted (or never resolved)
  // after this policy shipped -- that fails closed, it never silently downgrades.
  if (manifest.schema_version !== 1) {
    return {
      ok: false,
      code: 'MODEL_ROUTING_REQUIRED_FOR_SCHEMA_VERSION',
      message:
        `manifest schema_version ${manifest.schema_version} requires a model_routing block; ` +
        `only schema_version 1 manifests may use the legacy-default resolution path`,
      legacy_compatibility_used: false,
    };
  }
  const legacy = resolveLegacyModelRouting(manifest.tier);
  return {
    ok: legacy.ok,
    code: legacy.code,
    message: legacy.message,
    model_routing: legacy.model_routing,
    legacy_compatibility_used: legacy.ok,
  };
}

export interface ModelRoutingEvidence {
  issue_id: string;
  manifest_schema_version: number;
  model_profile: string;
  model: string;
  reasoning_effort: string;
  policy_version: string;
  codex_cli_version: string | null;
  legacy_compatibility_used: boolean;
  override_used: boolean;
  override_authorized_by: string | null;
  codex_exit_code: number | null;
  generated_at: string;
}

export function buildModelRoutingEvidence(input: {
  issueId: string;
  manifestSchemaVersion: number;
  modelRouting: ModelRoutingBlock;
  legacyCompatibilityUsed: boolean;
  codexCliVersion: string | null;
  codexExitCode: number | null;
  now?: string;
}): ModelRoutingEvidence {
  return {
    issue_id: input.issueId,
    manifest_schema_version: input.manifestSchemaVersion,
    model_profile: input.modelRouting.profile,
    model: input.modelRouting.model,
    reasoning_effort: input.modelRouting.reasoning_effort,
    policy_version: input.modelRouting.policy_version,
    codex_cli_version: input.codexCliVersion,
    legacy_compatibility_used: input.legacyCompatibilityUsed,
    override_used: Boolean(input.modelRouting.override),
    override_authorized_by: input.modelRouting.override?.authorized_by ?? null,
    codex_exit_code: input.codexExitCode,
    generated_at: input.now ?? new Date().toISOString(),
  };
}

function writeModelRoutingEvidence(cwd: string, issueId: string, evidence: ModelRoutingEvidence): string {
  const dir = path.join(cwd, 'docs', '06_status', 'proof', issueId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'model-routing.json');
  fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return filePath;
}

export interface EvidencePersistenceResult {
  ok: boolean;
  step: 'add' | 'commit' | 'push' | 'none';
  detail: string;
}

function currentBranch(cwd: string): string | null {
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (branch.status !== 0) return null;
  return branch.stdout.trim() || null;
}

/**
 * Commit and push the model-routing evidence sidecar inside the lane worktree, on the
 * lane's own branch. Required because Codex's own commit/push (its last action before
 * codex-exec.ts's spawnSync call returns) necessarily happens BEFORE this evidence file
 * exists -- writing it after Codex exits and stopping there would leave it permanently
 * untracked, never reaching the PR (PM review finding #4). This does not broaden the
 * runner's commit authority: codex-exec.ts already runs with git access to this same
 * worktree/branch as the trusted orchestrator entry point: it only adds one narrow,
 * auditable commit to the branch it already owns.
 */
export function commitAndPushEvidence(cwd: string, relativeEvidencePath: string, message: string): EvidencePersistenceResult {
  const add = spawnSync('git', ['add', relativeEvidencePath], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (add.status !== 0) {
    return { ok: false, step: 'add', detail: add.stderr || add.stdout || 'git add failed' };
  }

  const commit = spawnSync('git', ['commit', '-m', message], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (commit.status !== 0) {
    const combined = `${commit.stdout ?? ''}${commit.stderr ?? ''}`;
    if (/nothing to commit/i.test(combined)) {
      return { ok: true, step: 'none', detail: 'evidence unchanged, nothing to commit' };
    }
    return { ok: false, step: 'commit', detail: combined || 'git commit failed' };
  }

  // Lanes are created locally by `git worktree add -b`, so their first push has no
  // configured upstream. Explicitly publish the current branch and establish that
  // tracking relationship; a bare `git push` fails at exactly the point this runner
  // is meant to make the evidence durable.
  const branch = currentBranch(cwd);
  if (!branch) {
    return { ok: false, step: 'push', detail: 'unable to determine current branch for evidence push' };
  }
  const push = spawnSync('git', ['push', '--set-upstream', 'origin', `HEAD:refs/heads/${branch}`], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (push.status !== 0) {
    return { ok: false, step: 'push', detail: push.stderr || push.stdout || 'git push failed' };
  }

  return { ok: true, step: 'push', detail: 'committed and pushed' };
}

export function buildCodexChildEnv(cwd: string, stateIdentity: ExecutionStateIdentity): NodeJS.ProcessEnv {
  const stateRoot = path.join(cwd, '.out', 'codex-pnpm-state');
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
    UNIT_TALK_EXECUTION_EPOCH_ID: stateIdentity.epoch_id,
    UNIT_TALK_EXECUTION_ATTEMPT: String(stateIdentity.attempt),
    UNIT_TALK_EXECUTION_MINIMUM_REVISION: String(stateIdentity.minimum_revision),
  };
}

function checkCodexHealth(): { healthy: boolean; version: string | null; error: string | null } {
  const r = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: 10_000,
  });
  if (r.error || r.status !== 0) {
    return { healthy: false, version: null, error: r.error?.message ?? `exit ${r.status}` };
  }
  return { healthy: true, version: r.stdout.trim().split('\n')[0] ?? null, error: null };
}

function checkExecSubcommand(): { available: boolean; error: string | null } {
  // Guard against future CLI drift: fail fast if `exec` subcommand is missing
  const r = spawnSync('codex', ['exec', '--help'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    timeout: 10_000,
  });
  if (r.error || r.status === null) {
    return { available: false, error: r.error?.message ?? 'spawn failed' };
  }
  // codex exec --help may exit non-zero on some versions; treat it as available
  // as long as it doesn't report ENOENT or "unknown command"
  const combined = (r.stdout ?? '') + (r.stderr ?? '');
  if (/unknown command|invalid command|not a valid/i.test(combined)) {
    return { available: false, error: `'codex exec' subcommand not recognised by this CLI version. Update codex-cli.` };
  }
  return { available: true, error: null };
}

export function buildCodexPrompt(packet: ExecutionPacket, resumeBrief?: string): string {
  return [
    `# Unit Talk V2 — Lane Execution Packet`,
    ``,
    `Issue: ${packet.issue_id}`,
    `Tier: ${packet.tier}`,
    `Branch: ${packet.branch}`,
    `CWD: ${packet.cwd}`,
    ``,
    renderTaskContract(packet.task_contract),
    ``,
    `## Allowed file scope`,
    packet.allowed_file_scope.map(f => `- ${f}`).join('\n'),
    ``,
    `## Required verification`,
    packet.required_verification.map(v => `- ${v}`).join('\n'),
    ``,
    `## Closeout instructions`,
    packet.closeout_instructions.map(c => `- ${c}`).join('\n'),
    // The resume brief goes ahead of the (long) repo brief so a resumed run
    // reads "here is what is already settled" before it reads anything that
    // would tempt it to start the investigation over.
    ...(resumeBrief ? [``, resumeBrief] : []),
    ``,
    `## Repo brief (critical — read before touching any code)`,
    packet.repo_brief,
  ].join('\n');
}

/**
 * Exported, and argv is injectable, so regression tests can EXECUTE the dry-run
 * control flow instead of asserting on source text.
 */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const issueId = getFlag(args.flags, 'issue');
  const dryRun = args.bools.has('dry-run');
  const rework = args.bools.has('rework');

  if (!issueId) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: '',
      message: '--issue UTV2-### is required',
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Load manifest
  if (!manifestExists(issueId)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      message: `No manifest found for ${issueId}. Run pnpm ops:lane-start first.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  const manifest: LaneManifest = readManifest(issueId);

  // Check executor is Codex
  if (!manifest.executor || !(['codex-cli', 'codex-cloud'] as string[]).includes(manifest.executor)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Lane executor is '${manifest.executor ?? 'unset'}', not codex-cli or codex-cloud. Use Claude for this lane.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Health check
  const health = checkCodexHealth();
  if (!health.healthy) {
    emitJson({
      ok: false,
      code: 'CODEX_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Codex CLI unavailable: ${health.error}`,
    } satisfies CodexExecResult);
    process.exit(1);
  }

  // Guard against future CLI drift — confirm `exec` subcommand exists
  const execCheck = checkExecSubcommand();
  if (!execCheck.available) {
    emitJson({
      ok: false,
      code: 'CODEX_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Codex 'exec' subcommand unavailable: ${execCheck.error}`,
    } satisfies CodexExecResult);
    process.exit(1);
  }

  // Resolve model routing — manifest's persisted decision, or a documented, warned
  // legacy default when the manifest predates this policy. Never falls back silently:
  // both paths always resolve to an explicit model + reasoning effort before any codex
  // invocation is constructed.
  const routing = resolveExecModelRouting(manifest);
  if (!routing.ok) {
    emitJson({
      ok: false,
      code: 'MODEL_ROUTING_INVALID',
      issue_id: issueId,
      branch: manifest.branch,
      message: routing.message,
      model_routing_error_code: routing.code,
    } satisfies CodexExecResult);
    process.exit(2);
  }
  const modelRouting = routing.model_routing!;
  if (routing.legacy_compatibility_used) {
    process.stderr.write(
      `[codex-exec] WARN: manifest ${issueId} has no model_routing (created before the model-routing policy shipped) — ` +
        `using legacy default profile "${modelRouting.profile}" (${modelRouting.model}, effort=${modelRouting.reasoning_effort}). ` +
        `This resolution is not written back to the manifest; it is recorded only in this run's evidence.\n`,
    );
  }

  // Resolve worktree CWD before planning the epoch so both a fresh baseline and
  // a rework baseline bind the exact head that will be spawned.
  const cwd = manifest.execution_location?.cwd ?? manifest.worktree_path ?? ROOT;
  const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.join(ROOT, cwd);
  if (!fs.existsSync(resolvedCwd)) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Worktree CWD does not exist: ${resolvedCwd}. Run pnpm ops:lane-start to set up the worktree.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  const existingState = readCheckpointState(issueId);
  const existingCheckpoint = existingState.checkpoint;
  if (rework && !existingCheckpoint) {
    emitJson({
      ok: false,
      code: 'EXECUTION_STATE_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message: `cannot start a rework epoch without validated rejected-epoch state: ${existingState.reason}`,
      checkpoint_provenance: 'none',
    } satisfies CodexExecResult);
    process.exit(1);
  }

  const resumePlan = rework
    ? {
        ...buildResumePlan(null),
        carried_findings: existingCheckpoint!.findings,
        pending_actions: existingCheckpoint!.pending_actions,
      }
    : buildResumePlan(existingCheckpoint);
  const timeoutPolicy = resolveExecutionTimeout({
    tier: manifest.tier,
    reasoningEffort: modelRouting.reasoning_effort,
    phase: resumePlan.resume_from_phase,
  });

  const resumeBrief = rework
    ? [
        '## Execution checkpoint — REWORK EPOCH',
        '',
        'A new rework epoch will bind the current reviewed head as its immutable baseline.',
        'No phase validity from the rejected epoch is inherited. Its findings remain as rework inputs.',
      ].join('\n')
    : buildResumeBrief(existingCheckpoint);
  // A preview must not mutate. Resolving the packet persists the sync record in
  // both roots and, for a pre-contract lane, makes a live Linear call — all
  // before the dry-run branch below, while the emitted message says "without
  // mutating state during this preview". Under --dry-run the packet is read
  // without capture or persistence, so the claim matches the behaviour.
  let packet!: ExecutionPacket;
  if (dryRun) {
    try {
      packet = generateExecutionPacket(manifest);
    } catch (error) {
      emitJson({
        ok: false,
        code: 'PRECONDITION_FAILED',
        issue_id: issueId,
        branch: manifest.branch,
        message:
          `dry run cannot preview ${issueId}: ${error instanceof Error ? error.message : String(error)}. ` +
          'Run without --dry-run to capture the contract.',
      } satisfies CodexExecResult);
      process.exit(2);
    }
  } else {
    const packetExit = resolveCodexExecutionPacket(manifest, ready => {
      packet = ready;
    });
    if (packetExit !== 0) process.exit(packetExit);
  }
  const prompt = buildCodexPrompt(packet, resumeBrief);
  const plannedHead = currentHeadSha(resolvedCwd);
  if (!plannedHead) {
    emitJson({
      ok: false,
      code: 'PRECONDITION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Unable to resolve current Git head in ${resolvedCwd}`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  if (dryRun) {
    emitJson({
      ok: true,
      code: 'DRY_RUN',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `Dry run — would execute Codex in ${packet.cwd}` +
        (rework ? ' and create a new rework epoch without mutating state during this preview' : ''),
      dry_run: true,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        epoch_id: rework || !existingCheckpoint ? '(new epoch on execution)' : existingCheckpoint.epoch.epoch_id,
        epoch_mode: rework ? 'rework' : (existingCheckpoint?.epoch.mode ?? 'fresh'),
        implementation_baseline_sha:
          rework || !existingCheckpoint ? plannedHead : existingCheckpoint.epoch.implementation_baseline_sha,
        attempt: rework || !existingCheckpoint ? 1 : existingCheckpoint.attempt + 1,
        attempt_start_sha: plannedHead,
        resumed: !rework && resumePlan.resumed,
        phase: resumePlan.resume_from_phase,
        resumed_from_phase: resumePlan.resume_from_phase,
        skipped_phases: resumePlan.skipped_phases,
        carried_findings: resumePlan.carried_findings.length,
        timeout_ms: timeoutPolicy.timeout_ms,
        timeout_policy_id: timeoutPolicy.policy_id,
        timeout_clamped: timeoutPolicy.clamped,
        checkpoint_path: checkpointPath(issueId),
      },
    } satisfies CodexExecResult);
    process.stdout.write('\n--- CODEX INVOCATION (would run) ---\n');
    process.stdout.write(
      `codex exec ${buildCodexModelArgs(modelRouting).join(' ')} -s danger-full-access <prompt>\n`,
    );
    process.stdout.write('\n--- PROMPT PREVIEW ---\n');
    process.stdout.write(prompt.slice(0, 500) + '\n...(truncated)\n');
    process.exit(0);
  }

  // UTV2-1546: delegation kill switch, checked immediately before the actual
  // spawnSync('codex', ...) call below -- as late as possible, so every
  // precondition/health/model-routing check above still runs and reports its
  // own specific failure first, but strictly before any new Codex process is
  // spawned. This is the only place in this file where a NEW executor
  // process starts: manifest reads, health checks, and the dry-run preview
  // above are not spawns and are intentionally left ungated (dry-run in
  // particular remains available as a read-only preview even while
  // delegation is suspended). Deliberately placed after the dry-run early
  // return, not before it. Exit code 2 matches this file's existing
  // PRECONDITION_FAILED convention.
  const delegationCheck = requireDelegationActive('codex-exec');
  if (!delegationCheck.ok) {
    emitJson({
      ok: false,
      code: 'DELEGATION_SUSPENDED',
      issue_id: issueId,
      branch: manifest.branch,
      message: delegationCheck.message,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // UTV2-1594: operator cancellation. `pnpm ops:exec-checkpoint cancel --issue
  // <ID> --reason <why>` sets this flag; it is honoured here, immediately
  // before the spawn, so a cancelled lane cannot be resumed by a stale
  // dispatch that was already in flight.
  if (existingCheckpoint?.cancel_requested) {
    emitJson({
      ok: false,
      code: 'EXECUTION_CANCELLED',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `Execution for ${issueId} was cancelled by an operator: ${existingCheckpoint.cancel_reason ?? 'no reason recorded'}. ` +
        `Clear it with \`pnpm ops:exec-checkpoint status --issue ${issueId}\` and a fresh dispatch decision.`,
    } satisfies CodexExecResult);
    process.exit(2);
  }

  // Execute Codex — pass prompt as CLI argument (codex exec <PROMPT>), with the
  // resolved model and reasoning effort passed explicitly. Never fall back to the
  // Codex CLI's own default model.
  // Use danger-full-access so Codex can commit/push inside the isolated worktree.
  // workspace-write (the default) blocks git index writes (.git/worktrees/.../index.lock).
  // Open the durable attempt immediately before the spawn, so a process that
  // dies mid-run still leaves an open attempt behind for the next dispatch to
  // find, classify and resume from.
  const commonAttempt = {
    issueId,
    branch: manifest.branch,
    worktree: resolvedCwd,
    timeoutPolicy,
  };
  const attemptStart = rework
    ? beginAttempt({
        ...commonAttempt,
        kind: 'rework',
        rejectedHeadSha: plannedHead,
        objectiveIdentity: `${issueId}:${manifest.branch}`,
        findingsIdentity: findingsIdentity(existingCheckpoint!),
        authority: 'codex-exec',
      })
    : existingCheckpoint
      ? beginAttempt({ ...commonAttempt, kind: 'resume', attemptStartSha: plannedHead })
      : beginAttempt({
          ...commonAttempt,
          kind: 'fresh',
          currentHeadSha: plannedHead,
          objectiveIdentity: `${issueId}:${manifest.branch}`,
          authority: 'codex-exec',
        });
  const executionSummary = buildExecutionSummary(
    attemptStart.checkpoint,
    attemptStart.resume,
    timeoutPolicy,
    attemptStart.path,
  );
  process.stderr.write(
    `[codex-exec] attempt ${executionSummary.attempt} for ${issueId}: phase=${executionSummary.phase} ` +
      `timeout=${Math.round(timeoutPolicy.timeout_ms / 60_000)}m (policy ${timeoutPolicy.policy_id}, tier ${manifest.tier}, ` +
      `effort ${modelRouting.reasoning_effort}, clamped=${timeoutPolicy.clamped})` +
      (attemptStart.resume.resumed
        ? `, resuming past ${attemptStart.resume.skipped_phases.length} completed phase(s) with ` +
          `${attemptStart.resume.carried_findings.length} carried finding(s)\n`
        : '\n'),
  );

  const codexArgs = ['exec', ...buildCodexModelArgs(modelRouting), '-s', 'danger-full-access', prompt];
  const child = spawnSync('codex', codexArgs, {
    cwd: resolvedCwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: buildCodexChildEnv(resolvedCwd, attemptStart.identity),
    timeout: timeoutPolicy.timeout_ms,
  });

  // A spawnSync killed by its own `timeout` reports ETIMEDOUT (or the kill
  // signal). Distinguish that from a plain non-zero exit so a resumable
  // timeout is never filed as an unrecoverable failure -- and so a run that
  // stopped reporting progress entirely is called what it is.
  const timedOut =
    (child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || child.signal === 'SIGTERM';
  const postSpawnState = readCheckpointState(issueId, undefined, attemptStart.identity);
  const liveness = classifyCheckpointLiveness(postSpawnState.checkpoint);
  const exitCode = child.status ?? 1;
  const evidence = buildModelRoutingEvidence({
    issueId,
    manifestSchemaVersion: manifest.schema_version,
    modelRouting,
    legacyCompatibilityUsed: routing.legacy_compatibility_used,
    codexCliVersion: health.version,
    codexExitCode: child.error ? null : exitCode,
  });
  const evidencePath = writeModelRoutingEvidence(resolvedCwd, issueId, evidence);
  const evidenceRelativePath = path.relative(resolvedCwd, evidencePath).split(path.sep).join('/');
  // Commit and push the evidence sidecar BEFORE reporting either outcome -- a successful
  // Codex run must never leave an untracked/uncommitted evidence file behind (PM review
  // finding #4). Attempted on both the success and failure path so failure evidence is
  // preserved through the same canonical location too.
  const persistence = commitAndPushEvidence(
    resolvedCwd,
    evidenceRelativePath,
    `chore(proof): ${issueId} model-routing evidence`,
  );

  if (!postSpawnState.ok || !postSpawnState.checkpoint) {
    emitJson({
      ok: false,
      code: 'EXECUTION_STATE_UNAVAILABLE',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `Codex returned, but mandatory post-spawn execution state is unavailable: ${postSpawnState.reason}. ` +
        'Execution cannot fall through to success.',
      codex_exit_code: child.status ?? 1,
      checkpoint_provenance: 'none',
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        ...executionSummary,
        outcome: 'failed',
        heartbeat_state: 'no_attempt',
        released_resources: [],
      },
    } satisfies CodexExecResult);
    process.exit(1);
  }

  if (child.error || child.status !== 0) {
    // Silence is never success. A run that produced no heartbeat inside the
    // silence window is reported as EXECUTION_SILENT, and either way the
    // attempt is closed on the checkpoint and any verify slot whose owner is
    // provably dead is handed back before this process exits.
    const outcome = liveness.silent ? 'silent_no_heartbeat' : timedOut ? 'timed_out' : 'failed';
    const reason = liveness.silent
      ? `executor produced no heartbeat: ${liveness.reason}`
      : timedOut
        ? `attempt exceeded its bounded timeout of ${Math.round(timeoutPolicy.timeout_ms / 60_000)}m (${timeoutPolicy.policy_id})`
        : `codex exited with status ${child.status ?? 1}: ${child.error?.message ?? 'non-zero exit'}`;
    const closed = failVisiblyAndRelease({ issueId, outcome, reason, identity: attemptStart.identity });

    emitJson({
      ok: false,
      code: liveness.silent ? 'EXECUTION_SILENT' : timedOut ? 'EXECUTION_TIMED_OUT' : 'EXECUTION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `${reason}. Progress is checkpointed at ${attemptStart.path}; the next dispatch resumes from ` +
        `phase '${closed.checkpoint?.phase ?? attemptStart.checkpoint.phase}' instead of repeating completed analysis. ` +
        `Model routing evidence: ${evidencePath} (persistence: ${persistence.ok ? persistence.detail : `FAILED at ${persistence.step}: ${persistence.detail}`})`,
      codex_exit_code: child.status ?? 1,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        ...executionSummary,
        phase: closed.checkpoint?.phase ?? executionSummary.phase,
        outcome,
        heartbeat_state: liveness.state,
        released_resources: closed.released.map((record) => `verify-slot-${record.slot}:${record.state}`),
      },
    } satisfies CodexExecResult);
    process.exit(1);
  }

  if (!persistence.ok) {
    // Codex itself succeeded, but the evidence sidecar failed to commit/push -- the
    // invariant "a successful execution cannot leave dangling evidence" means this run
    // must NOT report SUCCESS/READY_FOR_REVIEW. Fail closed instead.
    const closed = failVisiblyAndRelease({
      issueId,
      outcome: 'failed',
      reason: `model-routing evidence failed to persist at ${persistence.step}: ${persistence.detail}`,
      identity: attemptStart.identity,
    });
    emitJson({
      ok: false,
      code: 'EVIDENCE_PERSISTENCE_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Codex completed successfully, but model-routing evidence failed to persist at ${persistence.step}: ${persistence.detail}. Evidence file: ${evidencePath}`,
      codex_exit_code: 0,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        ...executionSummary,
        outcome: 'failed',
        heartbeat_state: liveness.state,
        released_resources: closed.released.map((record) => `verify-slot-${record.slot}:${record.state}`),
      },
    } satisfies CodexExecResult);
    process.exit(1);
  }

  const truth = evaluateExecutionTruth({ issueId, cwd: resolvedCwd, stateIdentity: attemptStart.identity });
  if (!truth.ok) {
    const closed = failVisiblyAndRelease({
      issueId,
      outcome: 'failed',
      reason: truth.message,
      identity: attemptStart.identity,
    });
    emitJson({
      ok: false,
      code: truth.code,
      issue_id: issueId,
      branch: manifest.branch,
      message: truth.message,
      codex_exit_code: truth.exit_code,
      source_files_changed: truth.source_files_changed,
      checkpoint_provenance: truth.checkpoint_provenance,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        ...executionSummary,
        phase: closed.checkpoint?.phase ?? executionSummary.phase,
        outcome: 'failed',
        heartbeat_state: liveness.state,
        released_resources: closed.released.map((record) => `verify-slot-${record.slot}:${record.state}`),
      },
    } satisfies CodexExecResult);
    process.exit(1);
  }

  const completed = finishAttempt({
    issueId,
    outcome: 'completed',
    reason: 'codex exited 0 and evidence persisted',
    identity: attemptStart.identity,
  });

  emitJson({
    ok: true,
    code: 'SUCCESS',
    issue_id: issueId,
    branch: manifest.branch,
    message: `Codex execution completed for ${issueId}. Model routing evidence: ${evidencePath} (${persistence.detail})`,
    codex_exit_code: 0,
    model_profile: modelRouting.profile,
    model: modelRouting.model,
    reasoning_effort: modelRouting.reasoning_effort,
    policy_version: modelRouting.policy_version,
    legacy_compatibility_used: routing.legacy_compatibility_used,
    codex_cli_version: health.version,
    source_files_changed: truth.source_files_changed,
    checkpoint_provenance: truth.checkpoint_provenance,
    execution: {
      ...executionSummary,
      phase: completed?.phase ?? executionSummary.phase,
      outcome: 'completed',
      heartbeat_state: liveness.state,
    },
  } satisfies CodexExecResult);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  main().catch(err => {
    process.stderr.write(`codex-exec fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
