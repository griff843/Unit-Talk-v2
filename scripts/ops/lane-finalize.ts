import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  linearQuery,
  type LinearQueryOptions,
  type LinearQueryResult,
} from './linear-client.js';
import {
  ROOT,
  emitJson,
  getFlag,
  parseArgs,
  readConfiguredEnvValue,
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

export interface LaneFinalizeStep {
  id:
    | 'record_merge'
    | 'apply_tier_label'
    | 'apply_linear_tier_label'
    | 'generate_proof'
    | 'generate_t2_proof_bundle'
    | 'close_lane'
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

export type LinearTierQuery = <T>(
  query: string,
  variables: Record<string, unknown>,
  options: LinearQueryOptions,
) => Promise<LinearQueryResult<T>>;

interface LinearLabelNode {
  id: string;
  name: string;
}

export interface ApplyLinearTierLabelResult {
  ok: true;
  code: 'linear_tier_label_applied' | 'linear_tier_label_already_applied';
  issue_id: string;
  tier: 'T1' | 'T2' | 'T3';
  changed: boolean;
  labels: string[];
}

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
      steps.push({
        id: 'apply_linear_tier_label',
        command: 'pnpm',
        args: [
          'exec',
          'tsx',
          'scripts/ops/lane-finalize.ts',
          '--issue',
          issueId,
          '--apply-linear-tier-label',
          input.manifest.tier,
          '--json',
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
          '--verification-log',
          standardProofPath(issueId, 'runtime-verification.md'),
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
    input.manifest.status === 'blocked' &&
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
  fileName: 'diff-summary.md' | 'runtime-verification.md',
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
    const alwaysRun = step.id === 'reconcile_current';
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

function normalizeTier(value: string): 'T1' | 'T2' | 'T3' {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^TIER:/, '');
  if (normalized !== 'T1' && normalized !== 'T2' && normalized !== 'T3') {
    throw new Error(`Unsupported tier label: ${value}`);
  }
  return normalized;
}

function tierFromLabel(label: string): 'T1' | 'T2' | 'T3' | null {
  const normalized = label
    .trim()
    .toUpperCase()
    .replace(/^TIER:/, '');
  return normalized === 'T1' || normalized === 'T2' || normalized === 'T3'
    ? normalized
    : null;
}

function verifiedTier(labels: LinearLabelNode[]): 'T1' | 'T2' | 'T3' | null {
  const tiers = [
    ...new Set(
      labels
        .map((label) => tierFromLabel(label.name))
        .filter((tier): tier is 'T1' | 'T2' | 'T3' => tier !== null),
    ),
  ];
  return tiers.length === 1 ? tiers[0] : null;
}

export async function applyLinearTierLabel(input: {
  issueId: string;
  tier: string;
  token: string;
  query?: LinearTierQuery;
}): Promise<ApplyLinearTierLabelResult> {
  const issueId = requireIssueId(input.issueId);
  const tier = normalizeTier(input.tier);
  const query = input.query ?? linearQuery;
  const current = await query<{
    issue: {
      id: string;
      identifier: string;
      labels: { nodes: LinearLabelNode[] };
      team: { labels: { nodes: LinearLabelNode[] } } | null;
    } | null;
    issueLabels: { nodes: LinearLabelNode[] };
  }>(
    `
      query LaneFinalizeTierLabels($issueId: String!) {
        issue(id: $issueId) {
          id
          identifier
          labels(first: 100) { nodes { id name } }
          team { labels(first: 250) { nodes { id name } } }
        }
        issueLabels(first: 250) { nodes { id name } }
      }
    `,
    { issueId },
    { token: input.token, userAgent: 'unit-talk-lane-finalize' },
  );
  if (!current.ok || !current.data?.issue) {
    throw new Error(
      `Unable to read Linear tier labels for ${issueId}: ${current.error ?? 'issue not found'}`,
    );
  }

  const currentLabels = current.data.issue.labels.nodes;

  const availableLabels = [
    ...current.data.issueLabels.nodes,
    ...(current.data.issue.team?.labels.nodes ?? []),
  ].filter(
    (label, index, labels) =>
      labels.findIndex((candidate) => candidate.id === label.id) === index,
  );
  const targetCandidates = availableLabels.filter(
    (label) => tierFromLabel(label.name) === tier,
  );
  const target =
    targetCandidates.find(
      (label) => label.name.toUpperCase() === `TIER:${tier}`,
    ) ?? targetCandidates[0];
  if (!target) {
    throw new Error(
      `Linear workspace does not contain a label for tier:${tier}.`,
    );
  }
  const currentTierLabels = currentLabels.filter(
    (label) => tierFromLabel(label.name) !== null,
  );
  if (
    currentTierLabels.length === 1 &&
    currentTierLabels[0]?.id === target.id &&
    verifiedTier(currentLabels) === tier
  ) {
    return {
      ok: true,
      code: 'linear_tier_label_already_applied',
      issue_id: issueId,
      tier,
      changed: false,
      labels: currentLabels.map((label) => label.name),
    };
  }

  let changed = false;
  if (!currentLabels.some((label) => label.id === target.id)) {
    const added = await query<{
      issueAddLabel: { success: boolean };
    }>(
      `
        mutation LaneFinalizeAddTierLabel($issueId: String!, $labelId: String!) {
          issueAddLabel(id: $issueId, labelId: $labelId) { success }
        }
      `,
      { issueId: current.data.issue.id, labelId: target.id },
      { token: input.token, userAgent: 'unit-talk-lane-finalize' },
    );
    if (!added.ok || added.data?.issueAddLabel.success !== true) {
      throw new Error(
        `Unable to add Linear tier:${tier} to ${issueId}: ${added.error ?? 'mutation did not succeed'}`,
      );
    }
    changed = true;
  }

  for (const label of currentTierLabels) {
    if (label.id === target.id) continue;
    const removed = await query<{
      issueRemoveLabel: { success: boolean };
    }>(
      `
        mutation LaneFinalizeRemoveConflictingTierLabel($issueId: String!, $labelId: String!) {
          issueRemoveLabel(id: $issueId, labelId: $labelId) { success }
        }
      `,
      { issueId: current.data.issue.id, labelId: label.id },
      { token: input.token, userAgent: 'unit-talk-lane-finalize' },
    );
    if (!removed.ok || removed.data?.issueRemoveLabel.success !== true) {
      throw new Error(
        `Unable to remove conflicting Linear tier label ${label.name} from ${issueId}: ${removed.error ?? 'mutation did not succeed'}`,
      );
    }
    changed = true;
  }

  const verified = await query<{
    issue: {
      labels: { nodes: LinearLabelNode[] };
    } | null;
  }>(
    `
      query LaneFinalizeVerifyTierLabel($issueId: String!) {
        issue(id: $issueId) {
          labels(first: 100) { nodes { id name } }
        }
      }
    `,
    { issueId },
    { token: input.token, userAgent: 'unit-talk-lane-finalize' },
  );
  const verifiedLabels = verified.data?.issue?.labels.nodes;
  const verifiedTierLabels = verifiedLabels?.filter(
    (label) => tierFromLabel(label.name) !== null,
  );
  if (
    !verified.ok ||
    !verifiedLabels ||
    verifiedTierLabels?.length !== 1 ||
    verifiedTierLabels[0]?.id !== target.id ||
    verifiedTier(verifiedLabels) !== tier
  ) {
    throw new Error(
      `Linear tier label verification failed for ${issueId}; observed ${
        verifiedLabels?.map((label) => label.name).join(', ') ||
        'no labels'
      }.`,
    );
  }

  return {
    ok: true,
    code: 'linear_tier_label_applied',
    issue_id: issueId,
    tier,
    changed,
    labels: verifiedLabels.map((label) => label.name),
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

  const mergeLockPath = options.mergeLockPath ?? MERGE_LOCK_PATH;
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
  const linearTier = getFlag(flags, 'apply-linear-tier-label');
  if (linearTier) {
    const token =
      readConfiguredEnvValue('LINEAR_API_TOKEN') ||
      readConfiguredEnvValue('LINEAR_API_KEY');
    if (!token) {
      throw new Error(
        'LINEAR_API_TOKEN or LINEAR_API_KEY is required to apply the Linear tier label.',
      );
    }
    const result = await applyLinearTierLabel({
      issueId: rawIssueId,
      tier: linearTier,
      token,
    });
    if (json) emitJson(result);
    else
      process.stdout.write(
        `${result.code}: ${result.issue_id} tier:${result.tier}\n`,
      );
    return 0;
  }
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
