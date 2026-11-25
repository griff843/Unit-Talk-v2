import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  readManifest,
  requireIssueId,
  type LaneManifest,
} from './shared.js';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  isProcessAlive,
  MERGE_LOCK_PATH,
  releaseMergeLock,
  type MergeLockOwner,
} from './merge-mutex.js';
import { PR_BASE_MISMATCH_BLOCKER } from './lane-link-pr.js';
import { CONTROL_CHECKOUT_ROOT } from './lease-registry.js';

export interface LaneFinalizeStep {
  id:
    | 'record_merge'
    | 'apply_tier_label'
    | 'generate_proof'
    | 'generate_t2_proof_bundle'
    | 'close_lane'
    | 'release_terminal_artifacts'
    | 'reconcile_current';
  command: string;
  args: string[];
  required: boolean;
}

export interface LaneFinalizePlan {
  issue_id: string;
  branch: string;
  base_branch: string;
  pr: string;
  reopen_generation: string;
  dry_run: boolean;
  already_closed: boolean;
  steps: LaneFinalizeStep[];
}

export interface LaneFinalizeResult {
  ok: boolean;
  code:
    | 'lane_finalize_dry_run'
    | 'lane_finalized'
    | 'lane_already_finalized'
    | 'lane_finalize_failed';
  issue_id: string;
  branch: string;
  pr: string;
  dry_run: boolean;
  resumed: boolean;
  completed_step_ids: LaneFinalizeStep['id'][];
  steps: Array<
    LaneFinalizeStep & {
      status: 'planned' | 'passed' | 'skipped' | 'failed';
      stdout?: string;
      stderr?: string;
    }
  >;
  message: string;
}

export interface LaneFinalizeProgress {
  schema_version: 1;
  issue_id: string;
  branch: string;
  pr_url: string;
  reopen_generation: string;
  status: 'in_progress' | 'incomplete' | 'complete';
  completed_step_ids: LaneFinalizeStep['id'][];
  last_failure: string | null;
  updated_at: string;
}

export type LaneFinalizeRunner = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; stdio: 'pipe' },
) => {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
};

export function buildLaneFinalizePlan(input: {
  manifest: LaneManifest;
  pr: string;
  branch?: string | null;
  dryRun?: boolean;
  mergeSha?: string | null;
}): LaneFinalizePlan {
  const alreadyClosed = input.manifest.status === 'done';
  const mergeAlreadyRecorded =
    (input.manifest.status === 'merged' || alreadyClosed) &&
    Boolean(input.manifest.commit_sha);
  const issueId = input.manifest.issue_id;
  const steps: LaneFinalizeStep[] = [];

  if (!alreadyClosed) {
    if (!mergeAlreadyRecorded) {
      steps.push({
        id: 'record_merge',
        command: 'pnpm',
        args: [
          'ops:lane-manifest',
          'record-merge',
          issueId,
          '--pr',
          input.pr,
          '--json',
        ],
        required: true,
      });
    }
    if (input.manifest.tier) {
      steps.push({
        id: 'apply_tier_label',
        command: 'gh',
        args: [
          'pr',
          'edit',
          normalizePrUrl(input.pr),
          '--add-label',
          `tier:${input.manifest.tier}`,
        ],
        required: true,
      });
    }
    // Explicit --merge-sha ensures the proof reflects the actual merge commit,
    // not just the branch HEAD SHA that was current at proof-generate time.
    // Falls back gracefully: if not provided, proof-generate reads manifest.commit_sha
    // (written by the preceding record_merge step).
    const mergeShaArgs = input.mergeSha ? ['--merge-sha', input.mergeSha] : [];
    steps.push({
      id: 'generate_proof',
      command: 'pnpm',
      args: [
        'ops:proof-generate',
        issueId,
        '--json',
        '--current',
        '--branch',
        input.branch ?? input.manifest.branch,
        '--pr-url',
        normalizePrUrl(input.pr),
        ...mergeShaArgs,
      ],
      required: true,
    });
    if (shouldGenerateT2ProofBundle(input.manifest)) {
      steps.push({
        id: 'generate_t2_proof_bundle',
        command: 'pnpm',
        args: [
          'exec',
          'tsx',
          'scripts/ops/t2-proof-bundle.ts',
          issueId,
          '--json',
          '--force',
          '--diff-summary',
          standardProofPath(issueId, 'diff-summary.md'),
          // `ops:proof-generate` writes STANDARD_PROOF_FILES — `diff-summary.md`
          // and `verification.md` (proof-generate.ts:197). It never writes
          // `runtime-verification.md`, which only runtime lanes carry, so naming
          // that file here made every static-proof lane's finalize halt on
          // ENOENT. t2-proof-bundle now tolerates an absent file either way.
          '--verification-log',
          standardProofPath(issueId, 'verification.md'),
        ],
        required: true,
      });
    }
    // Reconcile while this parent still owns the merge mutex. lane-close is
    // deliberately last because a successful close releases that mutex as
    // part of its terminal cleanup. Callers that need a post-close refresh may
    // safely run orchestration-reconcile again; this step is always repeatable.
    steps.push({
      id: 'reconcile_current',
      command: 'pnpm',
      args: ['ops:orchestration-reconcile', '--current', '--json'],
      required: true,
    });
    steps.push({
      id: 'close_lane',
      command: 'pnpm',
      args: ['ops:lane-close', issueId, '--acquire-lock'],
      required: true,
    });
  } else {
    // A hosted post-merge close can persist the terminal manifest, but it
    // cannot reach the developer machine's control-checkout lease. Local
    // finalize must therefore replay the idempotent terminal cleanup even when
    // GitHub already reports this lane as done. Cleanup precedes reconciliation
    // so the reconciler observes the converged four-population state.
    steps.push({
      id: 'release_terminal_artifacts',
      command: 'pnpm',
      // `--terminal-cleanup-only` because this step runs INSIDE the finalize
      // mutex and from the control checkout: a plain re-close would release the
      // mutex this plan still holds, leaving `reconcile_current` unserialized,
      // and would delete the tracked `.ops/sync/<issue>.yml` record.
      args: ['ops:lane-close', issueId, '--terminal-cleanup-only'],
      required: true,
    });
    steps.push({
      id: 'reconcile_current',
      command: 'pnpm',
      args: ['ops:orchestration-reconcile', '--current', '--json'],
      required: true,
    });
  }

  return {
    issue_id: issueId,
    branch: input.manifest.branch,
    base_branch: input.manifest.base_branch,
    pr: input.pr,
    reopen_generation: laneReopenGeneration(input.manifest),
    dry_run: input.dryRun ?? false,
    already_closed: alreadyClosed,
    steps,
  };
}

function laneReopenGeneration(manifest: LaneManifest): string {
  const latest = manifest.reopen_history.at(-1);
  return `${manifest.reopen_history.length}:${latest?.timestamp ?? 'initial'}`;
}

export function resolveLaneFinalizeInput(input: {
  issueId?: string | null;
  pr?: string | null;
  manifest: LaneManifest;
}): { issueId: string; pr: string } {
  const issueId = requireIssueId(input.issueId ?? input.manifest.issue_id);
  if (issueId !== input.manifest.issue_id) {
    throw new Error(
      `Issue ${issueId} does not match manifest issue ${input.manifest.issue_id}.`,
    );
  }
  if (
    input.manifest.blocked_by.includes(PR_BASE_MISMATCH_BLOCKER)
  ) {
    throw new Error(
      `Lane ${issueId} PR binding was invalidated after a base-branch mismatch; refusing finalization.`,
    );
  }
  const explicitPr = extractPrNumber(input.pr ?? null);
  const manifestPr = extractPrNumber(input.manifest.pr_url);
  if (input.pr && !explicitPr) {
    throw new Error(`Invalid pull request identity: ${input.pr}.`);
  }
  if (explicitPr && manifestPr && explicitPr !== manifestPr) {
    throw new Error(
      `Explicit PR ${explicitPr} does not match manifest PR ${manifestPr}; refusing to rebind finalized lifecycle truth.`,
    );
  }
  const pr = explicitPr ?? manifestPr;
  if (!pr) {
    throw new Error(
      'Missing required --pr and manifest.pr_url does not contain a PR number.',
    );
  }

  return { issueId, pr };
}

function extractPrNumber(prUrl: string | null): string | null {
  if (!prUrl) return null;
  if (/^\d+$/.test(prUrl.trim())) return prUrl.trim();
  const match = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match?.[1] ?? null;
}

function normalizePrUrl(pr: string): string {
  return pr.startsWith('http')
    ? pr
    : `https://github.com/griff843/Unit-Talk-v2/pull/${pr}`;
}

export function validateLaneFinalizePullRequest(
  plan: LaneFinalizePlan,
  runner: LaneFinalizeRunner = spawnSync,
): void {
  const result = runner(
    'gh',
    ['pr', 'view', normalizePrUrl(plan.pr), '--json', 'baseRefName,state'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to verify pull request ${plan.pr} before finalization: ${String(
        result.stderr ?? result.stdout ?? 'gh pr view failed',
      ).trim()}`,
    );
  }

  let pullRequest: { baseRefName?: unknown; state?: unknown };
  try {
    pullRequest = JSON.parse(String(result.stdout ?? '')) as {
      baseRefName?: unknown;
      state?: unknown;
    };
  } catch {
    throw new Error(
      `Unable to parse pull request ${plan.pr} base/state before finalization.`,
    );
  }
  if (pullRequest.baseRefName !== plan.base_branch) {
    throw new Error(
      `Pull request ${plan.pr} targets base ${String(
        pullRequest.baseRefName ?? 'unknown',
      )}; expected ${plan.base_branch}. Refusing finalization.`,
    );
  }
  if (!plan.dry_run && pullRequest.state !== 'MERGED') {
    throw new Error(
      `Pull request ${plan.pr} is ${String(
        pullRequest.state ?? 'unknown',
      )}; finalization requires MERGED state.`,
    );
  }
}

function standardProofPath(
  issueId: string,
  fileName: 'diff-summary.md' | 'verification.md' | 'runtime-verification.md',
): string {
  return `docs/06_status/proof/${issueId}/${fileName}`;
}

function shouldGenerateT2ProofBundle(manifest: LaneManifest): boolean {
  if (manifest.tier !== 'T2') {
    return false;
  }
  return [
    'governance',
    'hygiene',
    'verification',
    'delivery-ui',
    'codex-cli',
  ].includes(manifest.lane_type);
}

export function runLaneFinalizePlan(
  plan: LaneFinalizePlan,
  options: {
    runner?: LaneFinalizeRunner;
    completedStepIds?: Iterable<LaneFinalizeStep['id']>;
    onStepCompleted?: (step: LaneFinalizeStep) => void;
  } = {},
): LaneFinalizeResult {
  const runner = options.runner ?? spawnSync;
  const steps: LaneFinalizeResult['steps'] = [];
  const previouslyCompleted = new Set(options.completedStepIds ?? []);
  const completedStepIds = new Set(previouslyCompleted);

  if (plan.dry_run) {
    return {
      ok: true,
      code: 'lane_finalize_dry_run',
      issue_id: plan.issue_id,
      branch: plan.branch,
      pr: plan.pr,
      dry_run: true,
      resumed: false,
      completed_step_ids: [],
      steps: plan.steps.map((step) => ({ ...step, status: 'planned' })),
      message: 'Lane finalize dry-run only; no closeout commands executed.',
    };
  }

  for (const step of plan.steps) {
    const alwaysRun =
      step.id === 'reconcile_current' ||
      step.id === 'release_terminal_artifacts';
    if (previouslyCompleted.has(step.id) && !alwaysRun) {
      steps.push({
        ...step,
        status: 'skipped',
        stdout: 'Previously completed; skipped from durable finalize progress.',
        stderr: '',
      });
      continue;
    }
    const result = runner(step.command, step.args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const status = result.status ?? 1;
    const output = {
      stdout: String(result.stdout ?? '').trim(),
      stderr: String(result.stderr ?? '').trim(),
    };
    if (status !== 0) {
      if (!step.required) {
        steps.push({ ...step, status: 'skipped', ...output });
        continue;
      }
      steps.push({ ...step, status: 'failed', ...output });
      return {
        ok: false,
        code: 'lane_finalize_failed',
        issue_id: plan.issue_id,
        branch: plan.branch,
        pr: plan.pr,
        dry_run: false,
        resumed: previouslyCompleted.size > 0,
        completed_step_ids: [...completedStepIds],
        steps,
        message: `Lane finalize is incomplete: failed at ${step.id} after completing ${
          completedStepIds.size > 0
            ? [...completedStepIds].join(', ')
            : 'no steps'
        }. Re-run the same command to resume.`,
      };
    }
    steps.push({ ...step, status: 'passed', ...output });
    completedStepIds.add(step.id);
    try {
      options.onStepCompleted?.(step);
    } catch (error) {
      return {
        ok: false,
        code: 'lane_finalize_failed',
        issue_id: plan.issue_id,
        branch: plan.branch,
        pr: plan.pr,
        dry_run: false,
        resumed: previouslyCompleted.size > 0,
        completed_step_ids: [...completedStepIds],
        steps,
        message: `Lane finalize completed ${step.id}, but could not persist resume progress: ${
          error instanceof Error ? error.message : String(error)
        }. Re-run is safe because completed commands are idempotent.`,
      };
    }
  }

  return {
    ok: true,
    code: plan.already_closed ? 'lane_already_finalized' : 'lane_finalized',
    issue_id: plan.issue_id,
    branch: plan.branch,
    pr: plan.pr,
    dry_run: false,
    resumed: previouslyCompleted.size > 0,
    completed_step_ids: [...completedStepIds],
    steps,
    message: plan.already_closed
      ? 'Lane was already closed; reconciliation completed.'
      : 'Lane finalize completed.',
  };
}

function progressPath(issueId: string, root = ROOT): string {
  return path.join(root, '.out', 'ops', 'lane-finalize', `${issueId}.json`);
}

function newLaneFinalizeProgress(
  plan: LaneFinalizePlan,
): LaneFinalizeProgress {
  return {
    schema_version: 1,
    issue_id: plan.issue_id,
    branch: plan.branch,
    pr_url: normalizePrUrl(plan.pr),
    reopen_generation: plan.reopen_generation,
    status: 'in_progress',
    completed_step_ids: [],
    last_failure: null,
    updated_at: new Date().toISOString(),
  };
}

function finalizeJournalLockPath(issueId: string, root = ROOT): string {
  return path.join(root, '.out', 'ops', 'lane-finalize', `${issueId}.lock`);
}

function acquireMergeMutexGuard(
  lockPath: string,
  owner: MergeLockOwner,
): () => void {
  const guardPath = `${lockPath}.acquire.lock`;
  fs.mkdirSync(path.dirname(guardPath), { recursive: true });
  let fd: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(guardPath, 'wx');
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ pid: owner.pid, host: owner.host, session_id: owner.session_id })}\n`,
        'utf8',
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let staleLocalOwner = false;
      try {
        const existing = JSON.parse(fs.readFileSync(guardPath, 'utf8')) as {
          pid?: number;
          host?: string;
        };
        staleLocalOwner =
          existing.host === owner.host &&
          typeof existing.pid === 'number' &&
          !isProcessAlive(existing.pid);
      } catch {
        staleLocalOwner = false;
      }
      if (attempt === 0 && staleLocalOwner) {
        fs.rmSync(guardPath, { force: true });
        continue;
      }
      throw new Error(
        'Lane finalize merge mutex acquisition is already in progress; refusing a concurrent cross-lane acquisition.',
      );
    }
  }
  if (fd === undefined) {
    throw new Error('Unable to acquire the lane finalize merge mutex guard.');
  }
  return () => {
    fs.closeSync(fd);
    fs.rmSync(guardPath, { force: true });
  };
}

/**
 * Serializes the complete durable finalize transaction. The repository merge
 * mutex protects cross-lane merge/closeout state, while the issue-local
 * exclusive journal lock remains held through lane-close's terminal mutex
 * release so two retries cannot read the same progress snapshot concurrently.
 */
export function withLaneFinalizeMergeLock<T>(
  plan: LaneFinalizePlan,
  action: () => T,
  options: {
    root?: string;
    mergeLockPath?: string;
    owner?: MergeLockOwner;
    acquire?: typeof acquireMergeLock;
  } = {},
): T {
  const root = options.root ?? ROOT;
  const journalLock = finalizeJournalLockPath(plan.issue_id, root);
  const owner = options.owner ?? defaultMergeLockOwner();
  fs.mkdirSync(path.dirname(journalLock), { recursive: true });
  let journalFd: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      journalFd = fs.openSync(journalLock, 'wx');
      fs.writeFileSync(
        journalFd,
        `${JSON.stringify({ pid: owner.pid, host: owner.host, session_id: owner.session_id })}\n`,
        'utf8',
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      let staleLocalOwner = false;
      try {
        const existing = JSON.parse(fs.readFileSync(journalLock, 'utf8')) as {
          pid?: number;
          host?: string;
        };
        staleLocalOwner =
          existing.host === owner.host &&
          typeof existing.pid === 'number' &&
          !isProcessAlive(existing.pid);
      } catch {
        staleLocalOwner = false;
      }
      if (attempt === 0 && staleLocalOwner) {
        fs.rmSync(journalLock, { force: true });
        continue;
      }
      throw new Error(
        `Lane finalize is already in progress for ${plan.issue_id}; refusing a concurrent journal mutation.`,
      );
    }
  }
  if (journalFd === undefined) {
    throw new Error(`Unable to acquire lane finalize journal for ${plan.issue_id}.`);
  }

  const mergeLockPath = options.mergeLockPath ?? path.join(
    CONTROL_CHECKOUT_ROOT,
    '.ops',
    path.basename(MERGE_LOCK_PATH),
  );
  let releaseAcquisitionGuard: (() => void) | undefined;
  let lock: ReturnType<typeof acquireMergeLock>;
  try {
    releaseAcquisitionGuard = acquireMergeMutexGuard(mergeLockPath, owner);
    lock = (options.acquire ?? acquireMergeLock)(
      {
        issue_id: plan.issue_id,
        branch: plan.branch,
        pr: normalizePrUrl(plan.pr),
        cwd: root,
        reason: 'ops:lane-finalize',
        owner,
      },
      { lockPath: mergeLockPath },
    );
  } catch (error) {
    fs.closeSync(journalFd);
    fs.rmSync(journalLock, { force: true });
    throw error;
  } finally {
    releaseAcquisitionGuard?.();
  }
  if (!lock.ok) {
    fs.closeSync(journalFd);
    fs.rmSync(journalLock, { force: true });
    throw new Error(
      `Lane finalize merge mutex unavailable: ${lock.code} ${lock.message}`,
    );
  }

  try {
    return action();
  } finally {
    // lane-close normally releases this lock as its terminal action. Releasing
    // again is idempotent; owner mismatch is left untouched if another lane
    // legitimately acquired the mutex after terminal cleanup.
    releaseMergeLock(
      { issue_id: plan.issue_id, branch: plan.branch },
      { lockPath: mergeLockPath },
    );
    fs.closeSync(journalFd);
    fs.rmSync(journalLock, { force: true });
  }
}

export function readLaneFinalizeProgress(
  plan: LaneFinalizePlan,
  root = ROOT,
): LaneFinalizeProgress {
  const file = progressPath(plan.issue_id, root);
  if (!fs.existsSync(file)) {
    return newLaneFinalizeProgress(plan);
  }
  const parsed = JSON.parse(
    fs.readFileSync(file, 'utf8'),
  ) as LaneFinalizeProgress;
  if (
    parsed.schema_version !== 1 ||
    parsed.issue_id !== plan.issue_id ||
    parsed.branch !== plan.branch ||
    parsed.pr_url !== normalizePrUrl(plan.pr)
  ) {
    throw new Error(
      `Finalize progress identity mismatch at ${file}; refusing to reuse stale completed steps.`,
    );
  }
  const recordedGeneration = parsed.reopen_generation ?? '0:initial';
  if (recordedGeneration !== plan.reopen_generation) {
    return newLaneFinalizeProgress(plan);
  }
  parsed.reopen_generation = recordedGeneration;
  return parsed;
}

export function writeLaneFinalizeProgress(
  progress: LaneFinalizeProgress,
  root = ROOT,
): void {
  const file = progressPath(progress.issue_id, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

export function parseLaneFinalizeCliArgs(argv: string[]): {
  issueId: string;
  flags: Map<string, string[]>;
  bools: Set<string>;
} {
  const { positionals, flags, bools } = parseArgs(
    argv.filter((argument) => argument !== '--'),
  );
  return {
    issueId: getFlag(flags, 'issue') ?? positionals[0] ?? '',
    flags,
    bools,
  };
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const { issueId: rawIssueId, flags, bools } = parseLaneFinalizeCliArgs(argv);
  const json = bools.has('json');
  const manifest = readManifest(requireIssueId(rawIssueId));
  const { pr } = resolveLaneFinalizeInput({
    issueId: rawIssueId,
    pr:
      getFlag(flags, 'pr') ??
      getFlag(flags, 'pr-url') ??
      getFlag(flags, 'pr-number'),
    manifest,
  });

  const plan = buildLaneFinalizePlan({
    manifest,
    pr,
    branch: getFlag(flags, 'branch') ?? null,
    dryRun: bools.has('dry-run') || bools.has('explain'),
    mergeSha: getFlag(flags, 'merge-sha') ?? null,
  });
  const execute = (): LaneFinalizeResult => {
    validateLaneFinalizePullRequest(plan);
    const progress = readLaneFinalizeProgress(plan);
    const result = runLaneFinalizePlan(plan, {
      completedStepIds: progress.completed_step_ids,
      onStepCompleted: (step) => {
        if (!progress.completed_step_ids.includes(step.id)) {
          progress.completed_step_ids.push(step.id);
        }
        progress.status = 'in_progress';
        progress.last_failure = null;
        progress.updated_at = new Date().toISOString();
        writeLaneFinalizeProgress(progress);
      },
    });
    if (!plan.dry_run) {
      progress.status = result.ok ? 'complete' : 'incomplete';
      progress.last_failure = result.ok ? null : result.message;
      progress.updated_at = new Date().toISOString();
      writeLaneFinalizeProgress(progress);
    }
    return result;
  };
  const result = plan.dry_run
    ? execute()
    : withLaneFinalizeMergeLock(plan, execute);
  if (json) {
    emitJson(result);
  } else {
    process.stdout.write(`${result.message}\n`);
    for (const step of result.steps) {
      process.stdout.write(
        `${step.status}: ${step.command} ${step.args.join(' ')}\n`,
      );
    }
  }
  return result.ok ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      emitJson({
        ok: false,
        code: 'lane_finalize_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
}
