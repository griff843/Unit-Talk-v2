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
 *       model routing, policy-version mismatch, missing manual-override authority)
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
  emitJson,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  type LaneManifest,
} from './shared.js';
import { generateExecutionPacket, type ExecutionPacket } from './execution-packet.js';
import {
  buildCodexModelArgs,
  resolveLegacyModelRouting,
  validatePersistedModelRouting,
  type ModelRoutingBlock,
} from './model-routing.js';

interface CodexExecResult {
  ok: boolean;
  code:
    | 'SUCCESS'
    | 'CODEX_UNAVAILABLE'
    | 'PRECONDITION_FAILED'
    | 'MODEL_ROUTING_INVALID'
    | 'EXECUTION_FAILED'
    | 'EVIDENCE_PERSISTENCE_FAILED'
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

  const push = spawnSync('git', ['push'], { cwd, stdio: 'pipe', encoding: 'utf8' });
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

function buildCodexPrompt(packet: ExecutionPacket): string {
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
    ``,
    `## Repo brief (critical — read before touching any code)`,
    packet.repo_brief,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const issueId = getFlag(args.flags, 'issue');
  const dryRun = args.bools.has('dry-run');

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

  // Build packet and prompt
  const packet = generateExecutionPacket(manifest);
  const prompt = buildCodexPrompt(packet);

  if (dryRun) {
    emitJson({
      ok: true,
      code: 'DRY_RUN',
      issue_id: issueId,
      branch: manifest.branch,
      message: `Dry run — would execute Codex in ${packet.cwd}`,
      dry_run: true,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
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

  // Execute Codex — pass prompt as CLI argument (codex exec <PROMPT>), with the
  // resolved model and reasoning effort passed explicitly. Never fall back to the
  // Codex CLI's own default model.
  // Use danger-full-access so Codex can commit/push inside the isolated worktree.
  // workspace-write (the default) blocks git index writes (.git/worktrees/.../index.lock).
  const codexArgs = ['exec', ...buildCodexModelArgs(modelRouting), '-s', 'danger-full-access', prompt];
  const child = spawnSync('codex', codexArgs, {
    cwd: resolvedCwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: buildCodexChildEnv(resolvedCwd),
    timeout: 30 * 60 * 1000,
  });

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

  if (child.error || child.status !== 0) {
    emitJson({
      ok: false,
      code: 'EXECUTION_FAILED',
      issue_id: issueId,
      branch: manifest.branch,
      message:
        `Codex exited with status ${child.status ?? 1}: ${child.error?.message ?? 'non-zero exit'}. ` +
        `Model routing evidence: ${evidencePath} (persistence: ${persistence.ok ? persistence.detail : `FAILED at ${persistence.step}: ${persistence.detail}`})`,
      codex_exit_code: child.status ?? 1,
      model_profile: modelRouting.profile,
      model: modelRouting.model,
      reasoning_effort: modelRouting.reasoning_effort,
      policy_version: modelRouting.policy_version,
      legacy_compatibility_used: routing.legacy_compatibility_used,
      codex_cli_version: health.version,
    } satisfies CodexExecResult);
    process.exit(1);
  }

  if (!persistence.ok) {
    // Codex itself succeeded, but the evidence sidecar failed to commit/push -- the
    // invariant "a successful execution cannot leave dangling evidence" means this run
    // must NOT report SUCCESS/READY_FOR_REVIEW. Fail closed instead.
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
    } satisfies CodexExecResult);
    process.exit(1);
  }

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
  } satisfies CodexExecResult);
}

const argv1 = process.argv[1] ?? '';
if (argv1 && import.meta.url === pathToFileURL(path.resolve(argv1)).href) {
  main().catch(err => {
    process.stderr.write(`codex-exec fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
