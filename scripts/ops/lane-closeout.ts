/**
 * ops:lane-closeout — single entry point for the post-merge lane closeout sequence.
 *
 * Today this sequence is four separate manual CLI invocations run by hand in a
 * specific order:
 *   1. `pnpm ops:lane-manifest -- record-merge <ISSUE> --pr <pr>`
 *   2. `pnpm ops:truth-check <ISSUE>`
 *   3. `pnpm ops:lane-close <ISSUE>`
 *   4. tier-label application (today bundled inside `ops:lane-finalize`)
 *
 * Getting the order wrong causes failures like "manifest status started is not
 * eligible for truth-check". This orchestrator runs the four steps in the
 * correct order, fails closed on the first failure, and supports --dry-run.
 *
 * DESIGN NOTE — dependency injection:
 * Every side-effecting operation (manifest read/write, GitHub calls, truth-check,
 * lane-close primitives) is threaded through a `LaneCloseoutDeps` object with
 * defaults bound to the real implementations. Tests construct `runLaneCloseout`
 * with a partial `deps` override instead of mocking ESM modules, which is brittle
 * with `tsx --test`. This mirrors the pattern already used by `lane-finalize.ts`
 * (`runner` option on `runLaneFinalizePlan`).
 *
 * DESIGN NOTE — why this does not simply call lane-finalize.ts:
 * `lane-finalize.ts` bundles tier-label application together with record-merge,
 * proof generation, lane-close, and reconcile into ONE plan executed via
 * `child_process.spawnSync` of sibling `pnpm ops:*` CLIs. Reusing its plan
 * builder here would either (a) shell out to sibling CLIs, which this
 * orchestrator is required to avoid, or (b) skip tier-label application
 * entirely once the manifest is already `done` (its `already_closed` branch
 * only re-runs `reconcile_current`). Since `lane-close.ts` does NOT apply the
 * tier label itself (confirmed by reading its `main()` — no `gh pr edit` call),
 * tier-label application remains a genuinely distinct 4th step here. Because
 * the underlying "apply tier label" logic in `lane-finalize.ts` is not exported
 * as a standalone function (it is inlined as one step of its `spawnSync` plan),
 * this file re-implements the equivalent minimal `gh pr edit --add-label`
 * call directly rather than duplicating/depending on lane-finalize's plan
 * shape. This is a deliberate, documented duplication of ~10 lines.
 *
 * DESIGN NOTE — Linear "Done" transition:
 * `lane-close.ts`'s `main()` also calls a private (non-exported)
 * `transitionLinearIssueToDone` helper after marking the manifest `done`. That
 * helper is not exported, and this orchestrator is required to call exported
 * library functions rather than duplicate private CLI-only logic or shell out
 * to `pnpm ops:lane-close`. This orchestrator therefore performs the same
 * manifest mutation `lane-close.ts` performs (status -> done, closed_at,
 * heartbeat_at, lock release) using its exported primitives, but does not
 * itself transition the Linear issue to Done. Per CLAUDE.md's truth
 * hierarchy, the lane manifest — not Linear — is the sole authority for
 * active lane state, and Linear sync is already handled by
 * `ops:orchestration-reconcile` / `ops:reconcile` elsewhere. Operators should
 * confirm Linear reflects Done after running this command, exactly as the
 * existing pre-closure checklist already asks them to confirm the tier label
 * in Linear.
 *
 * FAIL CLOSED: any step failure stops the sequence immediately and this
 * process exits non-zero. There is no silent fallback to "pass" or "done".
 */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  type LaneManifest,
  emitJson,
  getFlag,
  manifestExists,
  parseArgs,
  readManifest,
  requireIssueId,
  writeManifest,
} from './shared.js';
import { applyPrMergeToManifest } from './lane-manifest.js';
import { runTruthCheck } from './truth-check-lib.js';
import {
  ensureCloseoutMergeLock,
  releaseCloseoutLocks,
  requireCloseCommitSha,
  mapFailuresToCode,
  remediationForCode,
} from './lane-close.js';

const REPO_SLUG = 'griff843/Unit-Talk-v2';

export type LaneCloseoutStepId = 'record-merge' | 'truth-check' | 'lane-close' | 'lane-finalize';

export interface LaneCloseoutStepResult {
  id: LaneCloseoutStepId;
  status: 'pass' | 'skipped' | 'fail' | 'planned';
  detail: string;
}

export interface LaneCloseoutResult {
  ok: boolean;
  issue_id: string;
  dry_run: boolean;
  steps: LaneCloseoutStepResult[];
  message: string;
}

interface PullRequestMergeInfo {
  input: string;
  url: string;
  merged: boolean;
  mergeSha: string | null;
  state?: string | null;
}

interface TierLabelResult {
  ok: boolean;
  message: string;
}

/**
 * Dependency-injection surface for `runLaneCloseout`. Defaults are bound to
 * the real exported functions / CLI-equivalent gh calls below; tests override
 * a subset to simulate success/failure without touching disk or the network.
 */
export interface LaneCloseoutDeps {
  manifestExists: typeof manifestExists;
  readManifest: typeof readManifest;
  writeManifest: typeof writeManifest;
  fetchPrMergeInfo: (prInput: string) => PullRequestMergeInfo;
  applyPrMergeToManifest: typeof applyPrMergeToManifest;
  runTruthCheck: typeof runTruthCheck;
  ensureCloseoutMergeLock: typeof ensureCloseoutMergeLock;
  requireCloseCommitSha: typeof requireCloseCommitSha;
  releaseCloseoutLocks: typeof releaseCloseoutLocks;
  applyTierLabel: (manifest: LaneManifest, pr: string) => TierLabelResult;
  now: () => Date;
}

// Mirrors the private `fetchPullRequestMergeInfo` helper in lane-manifest.ts,
// which is not exported. Duplicated here (not shelled out to the sibling
// `ops:lane-manifest` CLI) so this step can be composed with the other steps
// as a single in-process call chain.
function defaultFetchPrMergeInfo(prInput: string): PullRequestMergeInfo {
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

function normalizePrUrl(pr: string): string {
  return pr.startsWith('http') ? pr : `https://github.com/${REPO_SLUG}/pull/${pr}`;
}

// Mirrors the `apply_tier_label` step inlined in lane-finalize.ts's
// buildLaneFinalizePlan (`gh pr edit <pr> --add-label tier:<tier>`), which is
// not exposed as a standalone exported function.
function defaultApplyTierLabel(manifest: LaneManifest, pr: string): TierLabelResult {
  const result = spawnSync('gh', ['pr', 'edit', normalizePrUrl(pr), '--add-label', `tier:${manifest.tier}`], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    return {
      ok: false,
      message: `gh pr edit --add-label tier:${manifest.tier} failed: ${(result.stderr ?? '').trim() || 'unknown error'}`,
    };
  }
  return { ok: true, message: `tier:${manifest.tier} label applied to ${normalizePrUrl(pr)}` };
}

export function defaultLaneCloseoutDeps(): LaneCloseoutDeps {
  return {
    manifestExists,
    readManifest,
    writeManifest,
    fetchPrMergeInfo: defaultFetchPrMergeInfo,
    applyPrMergeToManifest,
    runTruthCheck,
    ensureCloseoutMergeLock,
    requireCloseCommitSha,
    releaseCloseoutLocks,
    applyTierLabel: defaultApplyTierLabel,
    now: () => new Date(),
  };
}

function isMergeAlreadyRecorded(manifest: LaneManifest): boolean {
  // ASSUMPTION: "already recorded" means the manifest has already transitioned
  // out of pre-merge status AND carries a commit_sha — the same combination
  // applyPrMergeToManifest itself produces on a successful record-merge call.
  return (manifest.status === 'merged' || manifest.status === 'done') && Boolean(manifest.commit_sha?.trim());
}

export interface RunLaneCloseoutOptions {
  issueId: string;
  pr?: string;
  dryRun?: boolean;
}

export async function runLaneCloseout(
  options: RunLaneCloseoutOptions,
  deps: LaneCloseoutDeps = defaultLaneCloseoutDeps(),
): Promise<LaneCloseoutResult> {
  const issueId = requireIssueId(options.issueId);
  const dryRun = options.dryRun ?? false;
  const steps: LaneCloseoutStepResult[] = [];

  const fail = (id: LaneCloseoutStepId, detail: string): LaneCloseoutResult => {
    steps.push({ id, status: 'fail', detail });
    return {
      ok: false,
      issue_id: issueId,
      dry_run: dryRun,
      steps,
      message: `lane-closeout FAILED at step "${id}": ${detail}`,
    };
  };

  if (!deps.manifestExists(issueId)) {
    return fail('record-merge', `manifest not found for ${issueId}`);
  }

  // --- Step 1: record-merge (idempotent skip) -----------------------------
  let manifest = deps.readManifest(issueId);
  if (isMergeAlreadyRecorded(manifest)) {
    steps.push({
      id: 'record-merge',
      status: 'skipped',
      detail: `SKIPPED — already recorded (status=${manifest.status}, commit_sha=${manifest.commit_sha})`,
    });
  } else if (dryRun) {
    steps.push({
      id: 'record-merge',
      status: 'planned',
      detail: options.pr
        ? `would record merge for PR ${options.pr} (manifest status=${manifest.status})`
        : 'would record merge, but no --pr was provided',
    });
  } else {
    if (!options.pr) {
      return fail('record-merge', 'missing required --pr (GitHub PR URL or number)');
    }
    try {
      const pr = deps.fetchPrMergeInfo(options.pr);
      const result = deps.applyPrMergeToManifest({ manifest, pr, now: deps.now().toISOString() });
      deps.writeManifest(result.manifest);
      manifest = result.manifest;
      steps.push({
        id: 'record-merge',
        status: 'pass',
        detail: `commit_sha=${manifest.commit_sha} status=${manifest.status}`,
      });
    } catch (error) {
      return fail('record-merge', error instanceof Error ? error.message : String(error));
    }
  }

  // --- Step 2: truth-check --------------------------------------------------
  if (dryRun) {
    steps.push({ id: 'truth-check', status: 'planned', detail: `would run truth-check for ${issueId}` });
  } else {
    const result = await deps.runTruthCheck({ issueId, json: true, runner: 'manual' });
    if (result.exit_code !== 0) {
      return fail(
        'truth-check',
        `verdict=${result.verdict} exit_code=${result.exit_code} failures=${result.failures.join(', ') || 'none'}`,
      );
    }
    steps.push({ id: 'truth-check', status: 'pass', detail: `verdict=${result.verdict}` });
  }

  // --- Step 3: lane-close ----------------------------------------------------
  if (dryRun) {
    steps.push({
      id: 'lane-close',
      status: 'planned',
      detail: 'would acquire merge lock, verify commit_sha, re-run truth-check, mark manifest done, release locks',
    });
  } else {
    manifest = deps.readManifest(issueId);
    const lock = deps.ensureCloseoutMergeLock(manifest, { acquireLock: true });
    if (!lock.ok) {
      return fail('lane-close', `merge lock unavailable: ${lock.code} ${lock.message}`);
    }

    try {
      deps.requireCloseCommitSha(manifest);
    } catch (error) {
      return fail('lane-close', error instanceof Error ? error.message : String(error));
    }

    const result = await deps.runTruthCheck({ issueId, json: true, runner: 'ops:lane-close' });
    if (result.exit_code !== 0) {
      const code = mapFailuresToCode(result.failures, result.verdict);
      return fail('lane-close', `${code}: ${remediationForCode(code)}`);
    }

    const closedAt = deps.now().toISOString();
    manifest = { ...manifest, status: 'done', closed_at: closedAt, heartbeat_at: closedAt };
    deps.writeManifest(manifest);

    const locks = deps.releaseCloseoutLocks(issueId, manifest.branch);
    steps.push({
      id: 'lane-close',
      status: 'pass',
      detail: locks.warnings.length > 0 ? `closed with warnings: ${locks.warnings.join('; ')}` : 'closed',
    });
  }

  // --- Step 4: lane-finalize (tier label) ------------------------------------
  const prForTierLabel = options.pr ?? extractPrNumber(manifest.pr_url);
  if (dryRun) {
    steps.push({
      id: 'lane-finalize',
      status: 'planned',
      detail: prForTierLabel
        ? `would apply tier:${manifest.tier} label to PR ${prForTierLabel}`
        : 'would apply tier label, but no PR could be resolved',
    });
  } else {
    if (!prForTierLabel) {
      return fail('lane-finalize', 'no --pr provided and manifest.pr_url does not contain a PR number');
    }
    const tierResult = deps.applyTierLabel(manifest, prForTierLabel);
    if (!tierResult.ok) {
      return fail('lane-finalize', tierResult.message);
    }
    steps.push({ id: 'lane-finalize', status: 'pass', detail: tierResult.message });
  }

  return {
    ok: true,
    issue_id: issueId,
    dry_run: dryRun,
    steps,
    message: dryRun
      ? `lane-closeout dry-run complete for ${issueId}`
      : `lane-closeout complete for ${issueId}`,
  };
}

function extractPrNumber(prUrl: string | null): string | null {
  if (!prUrl) return null;
  const match = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match?.[1] ?? null;
}

const STEP_ORDER: LaneCloseoutStepId[] = ['record-merge', 'truth-check', 'lane-close', 'lane-finalize'];

function printReport(result: LaneCloseoutResult): void {
  for (const step of result.steps) {
    const index = STEP_ORDER.indexOf(step.id) + 1;
    const label =
      step.status === 'pass'
        ? 'PASS'
        : step.status === 'skipped'
          ? `SKIPPED — ${step.detail}`
          : step.status === 'planned'
            ? `PLANNED — ${step.detail}`
            : `FAIL — ${step.detail}`;
    const detailSuffix = step.status === 'pass' ? ` — ${step.detail}` : '';
    console.log(`[${index}/${STEP_ORDER.length}] ${step.id}: ${label}${detailSuffix}`);
  }
  console.log(result.message);
}

async function main(): Promise<void> {
  const { flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = getFlag(flags, 'issue');
  if (!issueId) {
    console.error('Usage: pnpm ops:lane-closeout --issue UTV2-123 [--pr <url-or-number>] [--dry-run]');
    process.exit(1);
    return;
  }

  try {
    const result = await runLaneCloseout({
      issueId,
      pr: getFlag(flags, 'pr'),
      dryRun: bools.has('dry-run'),
    });

    if (bools.has('json')) {
      emitJson(result);
    } else {
      printReport(result);
    }

    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (bools.has('json')) {
      emitJson({ ok: false, issue_id: issueId, message });
    } else {
      console.error(`lane-closeout FAILED: ${message}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
