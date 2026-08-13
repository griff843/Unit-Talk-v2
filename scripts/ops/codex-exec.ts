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
import { generateExecutionPacket, type ExecutionPacket } from './execution-packet.js';
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
  invalidatePhasesFrom,
  readCheckpoint,
  resolveExecutionTimeout,
  EXECUTION_PHASES,
  type ExecutionCheckpoint,
  type ResumePlan,
  type TimeoutPolicyDecision,
} from './execution-checkpoint.js';

interface CodexExecResult {
  ok: boolean;
  code:
    | 'SUCCESS'
    | 'CODEX_UNAVAILABLE'
    | 'PRECONDITION_FAILED'
    | 'MODEL_ROUTING_INVALID'
    | 'DELEGATION_SUSPENDED'
    | 'EXECUTION_FAILED'
    | 'EXECUTION_TIMED_OUT'
    | 'EXECUTION_SILENT'
    | 'EXECUTION_CANCELLED'
    | 'EVIDENCE_PERSISTENCE_FAILED'
    | 'REWORK_NO_SOURCE_CHANGE'
    | 'INCOMPLETE_PHASE_PROGRESSION'
    | 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE'
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
}

/**
 * The resume/timeout facts a caller needs to decide whether to re-dispatch:
 * which attempt this was, what phase it resumed at, what the bounded timeout
 * was and where it came from, and whether the executor went silent.
 */
export interface ExecutionSummary {
  attempt: number;
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
  code: 'SUCCESS' | 'REWORK_NO_SOURCE_CHANGE' | 'INCOMPLETE_PHASE_PROGRESSION' | 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE';
  exit_code: 0 | 1;
  message: string;
}

/**
 * A rework that carries feedback must change source, never just its proof.
 *
 * Phases at or beyond which an attempt has actually entered implementation.
 * Terminating in `orient` or `plan` means the run decided what to do and then
 * stopped -- that is not a completed execution regardless of what exit code
 * Codex returned.
 */
const IMPLEMENTATION_BOUNDARY_INDEX = EXECUTION_PHASES.indexOf('implement');

/**
 * Takes the issue id and reads the checkpoint itself, rather than accepting a
 * phase. Independent review found the first version accepted `phase` and `main`
 * passed it a PRE-spawn snapshot -- always 'orient' on a fresh lane -- so every
 * first attempt would have failed regardless of what Codex did. A test could
 * not guard that: the call site is wrong, not the rule. Removing the parameter
 * makes the stale value unrepresentable instead of merely tested against.
 */
/**
 * Whether this dispatch should perform the DURABLE rework invalidation.
 *
 * Extracted so the decision is testable at a seam. Inlining it in `main()` made
 * the guard unreachable from any regression: a test could only re-implement the
 * condition, which proves nothing when the production condition is removed.
 */
export function shouldInvalidateForRework(rework: boolean, dryRun: boolean): boolean {
  return rework && !dryRun;
}

export function evaluateExecutionTruth(input: {
  carriedFindings: number;
  sourceFilesChanged: number;
  issueId?: string;
  checkpointDir?: string;
}): ExecutionTruthVerdict {
  // UTV2-1698 is a false-success guard, so it is deliberately conservative:
  // every lane must change real source. A lane whose declared deliverable is
  // documentation therefore fails closed here until UTV2-1710 supplies a
  // lifecycle-owned deliverable authority. Failing an honest proof-only lane is
  // recoverable; admitting one more false-success path is not.
  if (input.carriedFindings > 0 && input.sourceFilesChanged === 0) {
    return {
      ok: false,
      code: 'REWORK_NO_SOURCE_CHANGE',
      exit_code: 1,
      message:
        `rework carried ${input.carriedFindings} finding(s) but changed zero source files; ` +
        'proof-only output cannot satisfy outstanding implementation feedback',
    };
  }
  // Second rule. The first only fires on a rework, because it keys on carried
  // findings. A FRESH lane carries none, so a run that stopped at `plan` having
  // written nothing passed it and reported success -- observed live on
  // UTV2-1701: attempt 1, resumed false, skipped_phases [], phase plan, outcome
  // completed, zero source files changed. Terminating before the implementation
  // boundary is never a completed execution.
  // Gate on COMPLETED phases, not on `checkpoint.phase`. That field is the
  // NEXT phase to work on (`recordPhaseComplete` sets it via `nextPhaseAfter`),
  // so a run that finished `plan` and stopped carries phase 'implement' and
  // would pass a naive check while having implemented nothing.
  const checkpoint = input.issueId ? readCheckpoint(input.issueId, input.checkpointDir) : null;
  if (checkpoint) {
    const completed = new Set(checkpoint.completed_phases.map((entry) => entry.phase));
    const boundary = EXECUTION_PHASES[IMPLEMENTATION_BOUNDARY_INDEX];
    if (!completed.has(boundary)) {
      const reached = [...completed].join(', ') || 'none';
      return {
        ok: false,
        code: 'INCOMPLETE_PHASE_PROGRESSION',
        exit_code: 1,
        message:
          `execution never completed the "${boundary}" phase (completed: ${reached}); ` +
          'deciding what to do is not doing it',
      };
    }
    // `completed_phases` is written by the executor itself, via
    // `ops:exec-checkpoint phase-complete`. Taken alone it is a self-attestation:
    // independent review demonstrated a fresh lane calling
    // `phase-complete --phase implement` with zero source changes and receiving
    // SUCCESS. The rework rule cannot catch that, because a fresh lane carries no
    // findings. Claiming the implementation phase therefore has to be
    // corroborated by a real diff -- the one signal the executor cannot
    // fabricate by asserting it.
    if (input.sourceFilesChanged === 0) {
      return {
        ok: false,
        code: 'IMPLEMENTATION_CLAIMED_WITHOUT_CHANGE',
        exit_code: 1,
        message:
          `execution reported the "${boundary}" phase complete but changed zero source files; ` +
          'a self-reported phase is not evidence of implementation',
      };
    }
  }
  return { ok: true, code: 'SUCCESS', exit_code: 0, message: 'execution changed source as required' };
}

/** Source excludes docs and operational metadata; those cannot satisfy rework feedback. */
export function changedFilesSince(cwd: string, baseSha: string | null): string[] {
  if (!baseSha) return [];
  const diff = spawnSync('git', ['diff', '--name-only', baseSha, 'HEAD'], { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (diff.status !== 0) return [];
  return diff.stdout.split('\n').map((file) => file.trim()).filter((file) => file.length > 0);
}

const NON_SOURCE_PREFIXES = ['docs/', '.ops/'];

/** Source excludes docs and operational metadata; those cannot satisfy a source-implementation claim. */
export function countSourceFilesChanged(cwd: string, baseSha: string | null): number {
  return changedFilesSince(cwd, baseSha).filter(
    (file) => !NON_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)),
  ).length;
}

function buildExecutionSummary(
  checkpoint: ExecutionCheckpoint,
  resume: ResumePlan,
  policy: TimeoutPolicyDecision,
  checkpointPathValue: string,
): ExecutionSummary {
  return {
    attempt: checkpoint.attempt,
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

function buildCodexChildEnv(cwd: string): NodeJS.ProcessEnv {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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

  // UTV2-1594: resume before building the prompt. A prior attempt that timed
  // out left a checkpoint behind; the resume brief turns that into "these
  // phases are already settled, start at X" instead of a fresh investigation.
  // The timeout for this attempt is derived from tier + reasoning effort + the
  // phase we are actually resuming at -- never one fixed constant for every
  // lane and every phase.
  // Rejection/rework is distinct from interruption. Preserve useful orient and
  // plan evidence, but require implementation and later phases to run again.
  //
  //
  // Two constraints meet here. Invalidation must happen BEFORE resume state is
  // read, or a real rework would plan from settled phases and skip the very work
  // it was rejected for. And it is a DURABLE write, so it must not happen on a
  // dry run: `--rework --dry-run` previously rewrote the next real dispatch's
  // resume plan, so previewing a rework silently changed it. Guarding on
  // `!dryRun` satisfies both -- the write keeps its position, and a preview
  // performs no write at all. The dry-run output states that a real rework would
  // invalidate, so the preview does not misrepresent itself.
  if (shouldInvalidateForRework(rework, dryRun)) {
    invalidatePhasesFrom(issueId, 'implement');
  }
  const existingCheckpoint = readCheckpoint(issueId);
  const resumeBrief = buildResumeBrief(existingCheckpoint);
  const resumePlan = buildResumePlan(existingCheckpoint);
  const timeoutPolicy = resolveExecutionTimeout({
    tier: manifest.tier,
    reasoningEffort: modelRouting.reasoning_effort,
    phase: resumePlan.resume_from_phase,
  });

  // Build packet and prompt
  const packet = generateExecutionPacket(manifest);
  const prompt = buildCodexPrompt(packet, resumeBrief);

  if (dryRun) {
    emitJson({
      ok: true,
      code: 'DRY_RUN',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `Dry run — would execute Codex in ${packet.cwd}` +
        (rework
          ? '. A real --rework run would first invalidate implementation and later phases; ' +
            'this preview reflects the checkpoint as it stands now and wrote nothing.'
          : ''),
      dry_run: true,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
      execution: {
        attempt: (existingCheckpoint?.attempt ?? 0) + 1,
        resumed: resumePlan.resumed,
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

  // Resolve worktree CWD
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
  const attemptStart = beginAttempt({
    issueId,
    branch: manifest.branch,
    worktree: resolvedCwd,
    headSha: currentHeadSha(resolvedCwd),
    timeoutPolicy,
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
    env: buildCodexChildEnv(resolvedCwd),
    timeout: timeoutPolicy.timeout_ms,
  });

  // A spawnSync killed by its own `timeout` reports ETIMEDOUT (or the kill
  // signal). Distinguish that from a plain non-zero exit so a resumable
  // timeout is never filed as an unrecoverable failure -- and so a run that
  // stopped reporting progress entirely is called what it is.
  const timedOut =
    (child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || child.signal === 'SIGTERM';
  // Read the checkpoint AFTER the spawn. `executionSummary.phase` is a
  // pre-spawn snapshot taken at beginAttempt, where phase is the phase the
  // attempt RESUMES FROM -- always 'orient' on a fresh lane. Gating execution
  // truth on that value would fail every first attempt regardless of what
  // Codex actually did (found by independent review of UTV2-1698).
  const postSpawnCheckpoint = readCheckpoint(issueId);
  const liveness = classifyCheckpointLiveness(postSpawnCheckpoint);
  const exitCode = child.status ?? 1;
  const sourceFilesChanged = countSourceFilesChanged(resolvedCwd, attemptStart.checkpoint.head_sha);
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
    const closed = failVisiblyAndRelease({ issueId, outcome, reason });

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

  // `issueId` only -- never a phase. `evaluateExecutionTruth` reads the
  // checkpoint itself so no caller can supply a stale pre-spawn snapshot, which
  // is the defect this call site shipped once already.
  const truth = evaluateExecutionTruth({
    carriedFindings: executionSummary.carried_findings,
    sourceFilesChanged,
    issueId,
  });
  if (!truth.ok) {
    const closed = failVisiblyAndRelease({ issueId, outcome: 'failed', reason: truth.message });
    emitJson({
      ok: false,
      code: truth.code,
      issue_id: issueId,
      branch: manifest.branch,
      message: truth.message,
      codex_exit_code: truth.exit_code,
      source_files_changed: sourceFilesChanged,
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
    process.exit(truth.exit_code);
  }

  const completed = finishAttempt({
    issueId,
    outcome: 'completed',
    reason: 'codex exited 0 and evidence persisted',
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
    source_files_changed: sourceFilesChanged,
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
