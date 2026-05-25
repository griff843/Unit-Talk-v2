import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_LOCK_STATUSES,
  ROOT,
  emitJson,
  parseArgs,
  readAllManifests,
  type LaneManifest,
} from './shared.js';
import { readAllLeases, type DispatchLease } from './lease-registry.js';
import { linearQuery } from './linear-client.js';

export type OrchestrationSurface =
  | 'linear'
  | 'lease_registry'
  | 'lane_manifest'
  | 'git_branch'
  | 'github_pr'
  | 'github_checks'
  | 'scheduler';

export type OrchestrationVerdict =
  | 'pass'
  | 'warn'
  | 'fail'
  | 'infra_error'
  | 'historical_decay'
  | 'stale_reclaim_required'
  | 'cleanup_candidate';

export type CheckRequirement = 'required' | 'advisory';

export interface LinearIssueSnapshot {
  issue_id: string;
  state_name: string;
  state_type?: string;
  updated_at?: string;
}

export interface GitHubCheckSnapshot {
  name: string;
  status: 'completed' | 'in_progress' | 'queued' | 'pending' | 'unknown';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped' | 'neutral' | null;
}

export interface PullRequestSnapshot {
  number: number;
  branch: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  merged_at?: string | null;
  merge_sha?: string | null;
  checks?: GitHubCheckSnapshot[];
}

export interface BranchSnapshot {
  name: string;
  source: 'local' | 'remote';
}

export interface OrchestrationEvidence {
  surface: OrchestrationSurface;
  source: string;
  detail: string;
}

export interface OrchestrationCheck {
  id: string;
  requirement: CheckRequirement;
  verdict: OrchestrationVerdict;
  issue_id?: string;
  branch?: string;
  pr_url?: string;
  detail: string;
  evidence: OrchestrationEvidence[];
}

export interface OrchestrationReconcilerReport {
  schema_version: 1;
  generated_at: string;
  verdict: 'PASS' | 'WARN' | 'FAIL' | 'INFRA';
  exit_code: 0 | 1 | 3;
  mode: OrchestrationReconcileMode;
  filters: OrchestrationReconcileFilters;
  transition_window_minutes: number;
  summary: Record<OrchestrationVerdict, number>;
  checks: OrchestrationCheck[];
  state_machine: OrchestrationStateMachineReport;
  repair_plan: OrchestrationRepairPlan;
  cleanup_plan: OrchestrationCleanupPlan;
  scheduling: {
    status: 'proposed';
    detail: string;
  };
}

export type LaneReconciliationState =
  | 'clean_active'
  | 'clean_closed'
  | 'lease_without_manifest'
  | 'manifest_without_branch'
  | 'open_pr_without_manifest'
  | 'active_pr_closed_manifest'
  | 'merged_branch_active_lease'
  | 'stale_lease_safe_reclaim'
  | 'stale_lease_manual_escalation'
  | 'closed_branch_cleanup'
  | 'historical_decay'
  | 'unknown';

export interface LaneReconciliationSnapshot {
  issue_id: string;
  state: LaneReconciliationState;
  lifecycle: 'active' | 'closing' | 'closed' | 'orphaned' | 'decayed' | 'unknown';
  fail_closed: boolean;
  detail: string;
}

export interface OrchestrationStateMachineReport {
  lane_lifecycle: string[];
  reconcile_lifecycle: string[];
  stale_criteria: string[];
  cleanup_criteria: string[];
  repair_semantics: string[];
  lanes: LaneReconciliationSnapshot[];
}

export interface OrchestrationRepairAction {
  id:
    | 'reclaim_stale_lease'
    | 'repair_missing_manifest'
    | 'escalate_manual_repair'
    | 'record_pr_on_manifest'
    | 'record_merge_on_manifest'
    | 'cleanup_closed_branch'
    | 'acknowledge_historical_decay';
  issue_id: string;
  state: LaneReconciliationState;
  command: string | null;
  reason: string;
  safe_to_apply: boolean;
  requires_pm: boolean;
  audit_trail: string[];
}

export interface OrchestrationRepairPlan {
  dry_run: boolean;
  applied: boolean;
  actions: OrchestrationRepairAction[];
}

export interface OrchestrationCleanupAction {
  id: 'release_done_lease' | 'remove_closed_worktree' | 'delete_local_branch' | 'refuse_active_lane';
  issue_id: string;
  branch?: string;
  worktree_path?: string;
  command: string | null;
  reason: string;
  safe_to_apply: boolean;
}

export interface OrchestrationCleanupPlan {
  dry_run: boolean;
  applied: boolean;
  actions: OrchestrationCleanupAction[];
}

export type OrchestrationReconcileMode = 'current' | 'all' | 'issue';

export interface OrchestrationReconcileFilters {
  mode: OrchestrationReconcileMode;
  issue_id: string | null;
  since: string | null;
  selected_issue_ids: string[];
  current_issue_ids: string[];
}

export interface OrchestrationReconcilerInput {
  linearIssues: LinearIssueSnapshot[];
  leases: DispatchLease[];
  manifests: LaneManifest[];
  branches: BranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  mode?: OrchestrationReconcileMode;
  issueId?: string;
  since?: string | Date;
  requiredCheckNames?: string[];
  generatedAt?: string;
  now?: Date;
  transitionWindowMinutes?: number;
  infraErrors?: string[];
  historicalDecayErrors?: string[];
}

const DEFAULT_TRANSITION_WINDOW_MINUTES = 60;
const ACTIVE_LINEAR_STATE_NAMES = new Set(['in codex', 'in claude']);
const DONE_LINEAR_STATE_NAMES = new Set(['done']);
const DONE_LINEAR_STATE_TYPES = new Set(['completed']);
const FAIL_CLASS_VERDICTS = new Set<OrchestrationVerdict>(['fail', 'stale_reclaim_required']);
const CLOSED_MANIFEST_STATUSES = new Set(['merged', 'done']);

interface FilteredInput extends OrchestrationReconcilerInput {
  mode: OrchestrationReconcileMode;
  normalizedIssueId: string | null;
  sinceIso: string | null;
  selectedIssueIds: string[];
  currentIssueIds: string[];
}

export function readConfiguredEnvValue(
  key: string,
  root = ROOT,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromProcess = env[key]?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  for (const fileName of ['local.env', '.env', '.env.example']) {
    const value = readEnvFileValue(path.join(root, fileName), key);
    if (value) {
      return value;
    }
  }

  return '';
}

function readEnvFileValue(filePath: string, key: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (line.slice(0, separator).trim() !== key) {
      continue;
    }
    return line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function normalizedStateName(issue: LinearIssueSnapshot): string {
  return issue.state_name.trim().toLowerCase();
}

function isLinearActive(issue: LinearIssueSnapshot): boolean {
  return ACTIVE_LINEAR_STATE_NAMES.has(normalizedStateName(issue));
}

function isLinearDone(issue: LinearIssueSnapshot): boolean {
  return DONE_LINEAR_STATE_NAMES.has(normalizedStateName(issue))
    || DONE_LINEAR_STATE_TYPES.has(String(issue.state_type ?? '').toLowerCase());
}

function isManifestActive(manifest: LaneManifest): boolean {
  return ACTIVE_LOCK_STATUSES.has(manifest.status);
}

function isLeaseActive(lease: DispatchLease): boolean {
  return lease.status === 'active' || lease.status === 'stale_reclaim_required';
}

function mapByIssueId<T extends { issue_id: string }>(entries: T[]): Map<string, T> {
  return new Map(entries.map((entry) => [normalizeIssueId(entry.issue_id), entry]));
}

function evidence(
  surface: OrchestrationSurface,
  source: string,
  detail: string,
): OrchestrationEvidence {
  return { surface, source, detail };
}

function issueIdFromBranch(branch: string): string | null {
  const match = branch.match(/(?:^|\/)(utv2|uni)-(\d+)(?:-|$)/i);
  if (!match) {
    return null;
  }
  return `${match[1]?.toUpperCase()}-${match[2]}`;
}

function uniqueIssueIds(input: OrchestrationReconcilerInput): string[] {
  const issueIds = new Set<string>();
  for (const issue of input.linearIssues) issueIds.add(normalizeIssueId(issue.issue_id));
  for (const lease of input.leases) issueIds.add(normalizeIssueId(lease.issue_id));
  for (const manifest of input.manifests) issueIds.add(normalizeIssueId(manifest.issue_id));
  for (const pr of input.pullRequests) {
    const issueId = issueIdFromBranch(pr.branch);
    if (issueId) issueIds.add(issueId);
  }
  return [...issueIds].sort((left, right) => left.localeCompare(right));
}

function timestampInScope(value: string | null | undefined, sinceMs: number | null): boolean {
  if (sinceMs == null) {
    return false;
  }
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) && parsed >= sinceMs;
}

function manifestInSinceScope(manifest: LaneManifest, sinceMs: number | null): boolean {
  if (sinceMs == null) {
    return false;
  }
  if (
    timestampInScope(manifest.started_at, sinceMs)
    || timestampInScope(manifest.heartbeat_at, sinceMs)
    || timestampInScope(manifest.closed_at, sinceMs)
  ) {
    return true;
  }
  return (manifest.truth_check_history ?? []).some((entry) => timestampInScope(entry.checked_at, sinceMs))
    || (manifest.reopen_history ?? []).some((entry) => timestampInScope(entry.timestamp, sinceMs));
}

function collectSinceIssueIds(input: OrchestrationReconcilerInput, sinceMs: number | null): Set<string> {
  const issueIds = new Set<string>();
  if (sinceMs == null) {
    return issueIds;
  }
  for (const issue of input.linearIssues) {
    if (timestampInScope(issue.updated_at, sinceMs)) {
      issueIds.add(normalizeIssueId(issue.issue_id));
    }
  }
  for (const lease of input.leases) {
    if (timestampInScope(lease.heartbeat_at, sinceMs) || timestampInScope(lease.expires_at, sinceMs)) {
      issueIds.add(normalizeIssueId(lease.issue_id));
    }
  }
  for (const manifest of input.manifests) {
    if (manifestInSinceScope(manifest, sinceMs)) {
      issueIds.add(normalizeIssueId(manifest.issue_id));
    }
  }
  for (const pr of input.pullRequests) {
    const issueId = issueIdFromBranch(pr.branch);
    if (issueId && (pr.state === 'open' || timestampInScope(pr.merged_at, sinceMs))) {
      issueIds.add(issueId);
    }
  }
  return issueIds;
}

function collectCurrentIssueIds(input: OrchestrationReconcilerInput): Set<string> {
  const issueIds = new Set<string>();
  const linearByIssue = mapByIssueId(input.linearIssues);
  for (const issue of input.linearIssues.filter(isLinearActive)) {
    issueIds.add(normalizeIssueId(issue.issue_id));
  }
  for (const lease of input.leases.filter(isLeaseActive)) {
    issueIds.add(normalizeIssueId(lease.issue_id));
  }
  for (const manifest of input.manifests.filter(isManifestActive)) {
    issueIds.add(normalizeIssueId(manifest.issue_id));
  }
  for (const pr of input.pullRequests.filter((entry) => entry.state === 'open')) {
    const issueId = issueIdFromBranch(pr.branch);
    if (issueId) issueIds.add(issueId);
  }
  for (const pr of input.pullRequests.filter((entry) => entry.state === 'merged')) {
    const issueId = issueIdFromBranch(pr.branch);
    if (!issueId) continue;
    const linearIssue = linearByIssue.get(issueId);
    if (linearIssue && !isLinearDone(linearIssue)) {
      issueIds.add(issueId);
    }
  }
  return issueIds;
}

function parseSinceBoundary(since: string | Date | undefined): { sinceIso: string | null; sinceMs: number | null } {
  if (since == null || since === '') {
    return { sinceIso: null, sinceMs: null };
  }
  const parsed = since instanceof Date ? since.getTime() : Date.parse(since);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --since boundary: ${String(since)}`);
  }
  return { sinceIso: new Date(parsed).toISOString(), sinceMs: parsed };
}

function filterInput(input: OrchestrationReconcilerInput): FilteredInput {
  const mode = input.issueId ? 'issue' : input.mode ?? 'current';
  const normalizedIssueId = input.issueId ? normalizeIssueId(input.issueId) : null;
  const { sinceIso, sinceMs } = parseSinceBoundary(input.since);
  const currentIssueIds = collectCurrentIssueIds(input);
  const sinceIssueIds = collectSinceIssueIds(input, sinceMs);
  const selectedIssueIds = new Set<string>();

  if (mode === 'issue') {
    selectedIssueIds.add(normalizedIssueId ?? '');
  } else if (mode === 'all') {
    for (const issueId of sinceMs == null ? uniqueIssueIds(input) : sinceIssueIds) {
      selectedIssueIds.add(issueId);
    }
  } else {
    for (const issueId of currentIssueIds) {
      selectedIssueIds.add(issueId);
    }
    for (const issueId of sinceIssueIds) {
      selectedIssueIds.add(issueId);
    }
  }
  selectedIssueIds.delete('');

  const includeIssue = (issueId: string | null | undefined): boolean => {
    if (!issueId) return mode === 'all' && sinceMs == null;
    return selectedIssueIds.has(normalizeIssueId(issueId));
  };

  const selectedBranches = new Set<string>();
  for (const lease of input.leases) {
    if (includeIssue(lease.issue_id)) selectedBranches.add(lease.branch);
  }
  for (const manifest of input.manifests) {
    if (includeIssue(manifest.issue_id)) selectedBranches.add(manifest.branch);
  }
  for (const pr of input.pullRequests) {
    if (includeIssue(issueIdFromBranch(pr.branch))) selectedBranches.add(pr.branch);
  }

  return {
    ...input,
    mode,
    normalizedIssueId,
    sinceIso,
    selectedIssueIds: [...selectedIssueIds].sort((left, right) => left.localeCompare(right)),
    currentIssueIds: [...currentIssueIds].sort((left, right) => left.localeCompare(right)),
    linearIssues: input.linearIssues.filter((issue) => includeIssue(issue.issue_id)),
    leases: input.leases.filter((lease) => includeIssue(lease.issue_id)),
    manifests: input.manifests.filter((manifest) => includeIssue(manifest.issue_id)),
    branches: input.branches.filter((branch) => selectedBranches.has(branch.name) || includeIssue(issueIdFromBranch(branch.name))),
    pullRequests: input.pullRequests.filter((pr) => includeIssue(issueIdFromBranch(pr.branch))),
  };
}

function branchExists(branches: BranchSnapshot[], branch: string): boolean {
  return branches.some((entry) => entry.name === branch);
}

function branchEvidence(branches: BranchSnapshot[], branch: string): OrchestrationEvidence {
  const sources = branches
    .filter((entry) => entry.name === branch)
    .map((entry) => entry.source)
    .sort()
    .join(', ');
  return evidence(
    'git_branch',
    sources ? `git:${sources}` : 'git',
    sources ? `branch ${branch} exists on ${sources}` : `branch ${branch} not found locally or remotely`,
  );
}

function mergedPrForIssue(
  issueId: string,
  manifests: LaneManifest[],
  prs: PullRequestSnapshot[],
): PullRequestSnapshot | undefined {
  const normalizedIssueId = normalizeIssueId(issueId);
  const manifest = manifests.find((entry) => normalizeIssueId(entry.issue_id) === normalizedIssueId);
  return prs.find((pr) => {
    if (pr.state !== 'merged') return false;
    return issueIdFromBranch(pr.branch) === normalizedIssueId || manifest?.branch === pr.branch;
  });
}

function mergeShaForIssue(
  issueId: string,
  manifests: LaneManifest[],
  prs: PullRequestSnapshot[],
): string | null {
  const normalizedIssueId = normalizeIssueId(issueId);
  const manifest = manifests.find((entry) => normalizeIssueId(entry.issue_id) === normalizedIssueId);
  const history = Array.isArray(manifest?.truth_check_history) ? manifest.truth_check_history : [];
  const historySha = history
    .map((entry) => entry.merge_sha)
    .find((sha): sha is string => typeof sha === 'string' && sha.trim() !== '');
  return manifest?.commit_sha ?? historySha ?? mergedPrForIssue(normalizedIssueId, manifests, prs)?.merge_sha ?? null;
}

function addCheck(checks: OrchestrationCheck[], check: OrchestrationCheck): void {
  checks.push(check);
}

function buildCleanupPlan(input: FilteredInput): OrchestrationCleanupPlan {
  const actions: OrchestrationCleanupAction[] = [];
  const activeIssues = new Set([
    ...input.leases.filter(isLeaseActive).map((entry) => normalizeIssueId(entry.issue_id)),
    ...input.manifests.filter(isManifestActive).map((entry) => normalizeIssueId(entry.issue_id)),
    ...input.linearIssues.filter(isLinearActive).map((entry) => normalizeIssueId(entry.issue_id)),
  ]);

  for (const manifest of input.manifests) {
    const issueId = normalizeIssueId(manifest.issue_id);
    if (activeIssues.has(issueId)) {
      actions.push({
        id: 'refuse_active_lane',
        issue_id: issueId,
        branch: manifest.branch,
        worktree_path: manifest.worktree_path,
        command: null,
        reason: 'Active lane state is present; cleanup requires manual force outside reconcile.',
        safe_to_apply: false,
      });
      continue;
    }
    if (!CLOSED_MANIFEST_STATUSES.has(manifest.status)) {
      continue;
    }
    if (fs.existsSync(manifest.worktree_path)) {
      actions.push({
        id: 'remove_closed_worktree',
        issue_id: issueId,
        branch: manifest.branch,
        worktree_path: manifest.worktree_path,
        command: `git worktree remove "${manifest.worktree_path}"`,
        reason: `Closed lane manifest is ${manifest.status} and worktree still exists.`,
        safe_to_apply: true,
      });
    }
    if (branchExists(input.branches.filter((entry) => entry.source === 'local'), manifest.branch)) {
      actions.push({
        id: 'delete_local_branch',
        issue_id: issueId,
        branch: manifest.branch,
        command: `git branch -d ${manifest.branch}`,
        reason: `Closed lane manifest is ${manifest.status} and local branch still exists.`,
        safe_to_apply: true,
      });
    }
  }

  for (const lease of input.leases) {
    const issueId = normalizeIssueId(lease.issue_id);
    if (activeIssues.has(issueId)) {
      actions.push({
        id: 'refuse_active_lane',
        issue_id: issueId,
        branch: lease.branch,
        command: null,
        reason: `Lease is ${lease.status}; active/current leases are not cleanup candidates.`,
        safe_to_apply: false,
      });
      continue;
    }
    if (lease.status === 'released') {
      actions.push({
        id: 'release_done_lease',
        issue_id: issueId,
        branch: lease.branch,
        command: null,
        reason: 'Released lease is already safe; no mutation required.',
        safe_to_apply: true,
      });
    }
  }

  return {
    dry_run: true,
    applied: false,
    actions,
  };
}

function openPrForIssue(issueId: string, prs: PullRequestSnapshot[]): PullRequestSnapshot | undefined {
  const normalizedIssueId = normalizeIssueId(issueId);
  return prs.find((pr) => pr.state === 'open' && issueIdFromBranch(pr.branch) === normalizedIssueId);
}

function anyPrForIssue(issueId: string, prs: PullRequestSnapshot[]): PullRequestSnapshot | undefined {
  const normalizedIssueId = normalizeIssueId(issueId);
  return prs.find((pr) => issueIdFromBranch(pr.branch) === normalizedIssueId);
}

function isLeaseExpired(lease: DispatchLease, now: Date): boolean {
  return Date.parse(lease.expires_at) <= now.getTime();
}

function classifyLane(
  issueId: string,
  input: FilteredInput,
  now: Date,
): LaneReconciliationSnapshot {
  const manifest = input.manifests.find((entry) => normalizeIssueId(entry.issue_id) === issueId);
  const lease = input.leases.find((entry) => normalizeIssueId(entry.issue_id) === issueId);
  const linear = input.linearIssues.find((entry) => normalizeIssueId(entry.issue_id) === issueId);
  const pr = anyPrForIssue(issueId, input.pullRequests);
  const openPr = openPrForIssue(issueId, input.pullRequests);
  const activeLease = lease && isLeaseActive(lease) ? lease : undefined;
  const activeManifest = manifest && isManifestActive(manifest) ? manifest : undefined;
  const closedManifest = manifest && CLOSED_MANIFEST_STATUSES.has(manifest.status) ? manifest : undefined;
  const branch = manifest?.branch ?? lease?.branch ?? pr?.branch;
  const branchPresent = branch ? branchExists(input.branches, branch) : false;
  const expired = activeLease ? isLeaseExpired(activeLease, now) : false;
  const linearActive = linear ? isLinearActive(linear) : false;

  if (activeLease && !activeManifest) {
    if (expired && !linearActive && !openPr) {
      return {
        issue_id: issueId,
        state: 'stale_lease_safe_reclaim',
        lifecycle: 'orphaned',
        fail_closed: true,
        detail: `Expired active lease has no active manifest and no active Linear/PR owner; reclaim is safe with audit history.`,
      };
    }
    return {
      issue_id: issueId,
      state: 'lease_without_manifest',
      lifecycle: 'orphaned',
      fail_closed: true,
      detail: expired
        ? 'Expired active lease has no active manifest but still needs manual ownership verification.'
        : 'Active lease has no active manifest; lane ownership is not reconstructable without repair.',
    };
  }

  if (activeLease && pr?.state === 'merged') {
    return {
      issue_id: issueId,
      state: 'merged_branch_active_lease',
      lifecycle: 'closing',
      fail_closed: true,
      detail: 'PR is merged but lease remains active; closeout/release must run before cleanup.',
    };
  }

  if (activeManifest && !branchPresent) {
    return {
      issue_id: issueId,
      state: 'manifest_without_branch',
      lifecycle: 'orphaned',
      fail_closed: true,
      detail: 'Active manifest branch is missing from local and remote refs.',
    };
  }

  if (openPr && !manifest) {
    return {
      issue_id: issueId,
      state: 'open_pr_without_manifest',
      lifecycle: 'orphaned',
      fail_closed: true,
      detail: 'Open PR exists but lane manifest is missing; workflows must repair manifest before tier/proof gates can trust it.',
    };
  }

  if (openPr && closedManifest) {
    return {
      issue_id: issueId,
      state: 'active_pr_closed_manifest',
      lifecycle: 'orphaned',
      fail_closed: true,
      detail: `Open PR exists while manifest is ${closedManifest.status}; reopen or close the PR before merge authorization.`,
    };
  }

  if (closedManifest && branchPresent) {
    return {
      issue_id: issueId,
      state: 'closed_branch_cleanup',
      lifecycle: 'closed',
      fail_closed: false,
      detail: `Manifest is ${closedManifest.status} and branch still exists; eligible for deterministic cleanup after merge/proof links are preserved.`,
    };
  }

  if (activeLease || activeManifest || linearActive || openPr) {
    return {
      issue_id: issueId,
      state: 'clean_active',
      lifecycle: 'active',
      fail_closed: false,
      detail: 'Active lane surfaces have a coherent owner record.',
    };
  }

  if (closedManifest || (linear && isLinearDone(linear))) {
    return {
      issue_id: issueId,
      state: 'clean_closed',
      lifecycle: 'closed',
      fail_closed: false,
      detail: 'Closed lane has no active orchestration owner.',
    };
  }

  return {
    issue_id: issueId,
    state: 'unknown',
    lifecycle: 'unknown',
    fail_closed: true,
    detail: 'Insufficient orchestration evidence to classify lane deterministically.',
  };
}

function buildStateMachineReport(input: FilteredInput, now: Date): OrchestrationStateMachineReport {
  return {
    lane_lifecycle: [
      'started -> in_progress -> in_review -> merged -> done',
      'started|in_progress|in_review|merged|done -> reopened when truth-check detects failed closeout',
      'active leases are execution locks, not completion proof',
    ],
    reconcile_lifecycle: [
      'observe all surfaces',
      'classify lane state',
      'emit required failures for unsafe/orphaned state',
      'emit dry-run repair/cleanup plan',
      'apply only explicit idempotent commands under merge mutex/PM authority',
    ],
    stale_criteria: [
      'lease.status is active or stale_reclaim_required',
      'lease.expires_at <= reconciliation clock',
      'safe reclaim additionally requires no active manifest, no open PR, and Linear not active',
    ],
    cleanup_criteria: [
      'manifest status is merged or done',
      'merge SHA or merged PR evidence is preserved before branch cleanup',
      'no active lease, active manifest, active Linear state, or open PR remains',
      'worktree/branch cleanup is dry-run until explicitly applied',
    ],
    repair_semantics: [
      'missing manifests fail closed and route to manifest repair/reconstruction',
      'lease reclaim appends reclaim_history instead of deleting the lease',
      'historical Linear decay is advisory unless the issue is current or active',
      'all repair commands must be safe to rerun or must no-op when already repaired',
    ],
    lanes: input.selectedIssueIds.map((issueId) => classifyLane(issueId, input, now)),
  };
}

function buildRepairPlan(
  input: FilteredInput,
  stateMachine: OrchestrationStateMachineReport,
): OrchestrationRepairPlan {
  const actions: OrchestrationRepairAction[] = [];
  const manifestByIssue = mapByIssueId(input.manifests);
  const leaseByIssue = mapByIssueId(input.leases);
  const prByIssue = new Map(
    input.pullRequests
      .map((pr) => {
        const issueId = issueIdFromBranch(pr.branch);
        return issueId ? [issueId, pr] as const : null;
      })
      .filter((entry): entry is readonly [string, PullRequestSnapshot] => entry !== null),
  );

  for (const lane of stateMachine.lanes) {
    const manifest = manifestByIssue.get(lane.issue_id);
    const lease = leaseByIssue.get(lane.issue_id);
    const pr = prByIssue.get(lane.issue_id);
    const auditTrail = [
      `state=${lane.state}`,
      manifest ? `manifest=${manifest.status}:${manifest.branch}` : 'manifest=missing',
      lease ? `lease=${lease.status}:${lease.branch}` : 'lease=missing',
      pr ? `pr=${pr.state}:${pr.url}` : 'pr=missing',
    ];

    if (lane.state === 'stale_lease_safe_reclaim' && lease) {
      actions.push({
        id: 'reclaim_stale_lease',
        issue_id: lane.issue_id,
        state: lane.state,
        command: `pnpm ops:lease reclaim --issue ${lane.issue_id} --actor ops:reconcile --reason "safe stale lease reclaim: expired lease without active manifest/open PR/active Linear" --branch-status ${branchExists(input.branches, lease.branch) ? 'present' : 'missing'} --pr-status none`,
        reason: lane.detail,
        safe_to_apply: true,
        requires_pm: false,
        audit_trail: auditTrail,
      });
    } else if (lane.state === 'lease_without_manifest' || lane.state === 'manifest_without_branch' || lane.state === 'merged_branch_active_lease') {
      actions.push({
        id: 'escalate_manual_repair',
        issue_id: lane.issue_id,
        state: lane.state,
        command: null,
        reason: lane.detail,
        safe_to_apply: false,
        requires_pm: true,
        audit_trail: auditTrail,
      });
    } else if (lane.state === 'open_pr_without_manifest' && pr) {
      actions.push({
        id: 'repair_missing_manifest',
        issue_id: lane.issue_id,
        state: lane.state,
        command: `pnpm ops:manifest-repair --issue ${lane.issue_id} --from-pr ${pr.number} --dry-run`,
        reason: lane.detail,
        safe_to_apply: false,
        requires_pm: false,
        audit_trail: auditTrail,
      });
    } else if (lane.state === 'active_pr_closed_manifest') {
      actions.push({
        id: 'escalate_manual_repair',
        issue_id: lane.issue_id,
        state: lane.state,
        command: null,
        reason: lane.detail,
        safe_to_apply: false,
        requires_pm: true,
        audit_trail: auditTrail,
      });
    } else if (lane.state === 'closed_branch_cleanup' && manifest) {
      actions.push({
        id: 'cleanup_closed_branch',
        issue_id: lane.issue_id,
        state: lane.state,
        command: `pnpm ops:lane-clean --issue ${lane.issue_id} --dry-run`,
        reason: lane.detail,
        safe_to_apply: true,
        requires_pm: false,
        audit_trail: auditTrail,
      });
    } else if (lane.state === 'historical_decay') {
      actions.push({
        id: 'acknowledge_historical_decay',
        issue_id: lane.issue_id,
        state: lane.state,
        command: null,
        reason: lane.detail,
        safe_to_apply: true,
        requires_pm: false,
        audit_trail: auditTrail,
      });
    }
  }

  return {
    dry_run: true,
    applied: false,
    actions,
  };
}

export function buildOrchestrationReconcilerReport(
  rawInput: OrchestrationReconcilerInput,
): OrchestrationReconcilerReport {
  const input = filterInput(rawInput);
  const now = input.now ?? new Date();
  const transitionWindowMinutes = input.transitionWindowMinutes ?? DEFAULT_TRANSITION_WINDOW_MINUTES;
  const transitionWindowMs = transitionWindowMinutes * 60 * 1000;
  const manifestsByIssue = mapByIssueId(input.manifests);
  const activeLeasesByIssue = mapByIssueId(input.leases.filter(isLeaseActive));
  const activeManifestsByIssue = mapByIssueId(input.manifests.filter(isManifestActive));
  const linearByIssue = mapByIssueId(input.linearIssues);
  const requiredCheckNames = new Set(input.requiredCheckNames ?? []);
  const checks: OrchestrationCheck[] = [];

  for (const message of input.infraErrors ?? []) {
    addCheck(checks, {
      id: 'ORCH-INFRA',
      requirement: 'required',
      verdict: 'infra_error',
      detail: message,
      evidence: [evidence('scheduler', 'orchestration-reconciler', message)],
    });
  }

  for (const message of input.historicalDecayErrors ?? []) {
    const match = message.match(/\b((?:UTV2|UNI)-\d+)\b/i);
    addCheck(checks, {
      id: 'ORCH-HISTORICAL-DECAY',
      requirement: 'advisory',
      verdict: 'historical_decay',
      issue_id: match ? normalizeIssueId(match[1] ?? '') : undefined,
      detail: message,
      evidence: [evidence('linear', 'historical lookup', message)],
    });
  }

  for (const issue of input.linearIssues.filter(isLinearActive)) {
    const issueId = normalizeIssueId(issue.issue_id);
    const lease = activeLeasesByIssue.get(issueId);
    const manifest = activeManifestsByIssue.get(issueId);
    addCheck(checks, {
      id: 'ORCH-LINEAR-ACTIVE-RECORD',
      requirement: 'required',
      verdict: lease || manifest ? 'pass' : 'fail',
      issue_id: issueId,
      branch: manifest?.branch ?? lease?.branch,
      detail: lease || manifest
        ? `Linear ${issue.state_name} has active orchestration record`
        : `Linear ${issue.state_name} has no active lease or lane manifest`,
      evidence: [
        evidence('linear', `Linear:${issueId}`, `state=${issue.state_name}`),
        evidence('lease_registry', `.ops/leases/${issueId}.json`, lease ? `status=${lease.status}` : 'missing active lease'),
        evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, manifest ? `status=${manifest.status}` : 'missing active manifest'),
      ],
    });
  }

  for (const lease of input.leases.filter(isLeaseActive)) {
    const issueId = normalizeIssueId(lease.issue_id);
    const manifest = activeManifestsByIssue.get(issueId);
    const expired = Date.parse(lease.expires_at) <= now.getTime();
    addCheck(checks, {
      id: 'ORCH-LEASE-BRANCH',
      requirement: 'required',
      verdict: branchExists(input.branches, lease.branch) ? 'pass' : 'fail',
      issue_id: issueId,
      branch: lease.branch,
      detail: branchExists(input.branches, lease.branch)
        ? 'Active lease branch exists'
        : 'Active lease branch is missing from local and remote Git refs',
      evidence: [
        evidence('lease_registry', `.ops/leases/${issueId}.json`, `status=${lease.status}; expires_at=${lease.expires_at}`),
        branchEvidence(input.branches, lease.branch),
      ],
    });
    addCheck(checks, {
      id: 'ORCH-LEASE-EXPIRY',
      requirement: 'required',
      verdict: expired ? 'stale_reclaim_required' : 'pass',
      issue_id: issueId,
      branch: lease.branch,
      detail: expired
        ? `Active lease expired at ${lease.expires_at}; explicit reclaim required`
        : `Active lease expires at ${lease.expires_at}`,
      evidence: [
        evidence('lease_registry', `.ops/leases/${issueId}.json`, `status=${lease.status}; heartbeat_at=${lease.heartbeat_at}`),
      ],
    });
    addCheck(checks, {
      id: 'ORCH-LEASE-MANIFEST',
      requirement: 'required',
      verdict: manifest && manifest.branch === lease.branch ? 'pass' : 'fail',
      issue_id: issueId,
      branch: lease.branch,
      detail: manifest
        ? manifest.branch === lease.branch
          ? 'Active lease matches active lane manifest branch'
          : `Active lease branch ${lease.branch} does not match manifest branch ${manifest.branch}`
        : 'Active lease has no active lane manifest',
      evidence: [
        evidence('lease_registry', `.ops/leases/${issueId}.json`, `branch=${lease.branch}; status=${lease.status}`),
        evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, manifest ? `branch=${manifest.branch}; status=${manifest.status}` : 'missing active manifest'),
      ],
    });
  }

  for (const manifest of input.manifests.filter(isManifestActive)) {
    const issueId = normalizeIssueId(manifest.issue_id);
    addCheck(checks, {
      id: 'ORCH-ACTIVE-MANIFEST-BRANCH',
      requirement: 'required',
      verdict: branchExists(input.branches, manifest.branch) ? 'pass' : 'fail',
      issue_id: issueId,
      branch: manifest.branch,
      detail: branchExists(input.branches, manifest.branch)
        ? 'Active lane manifest branch exists'
        : 'Active lane manifest branch is missing from local and remote Git refs',
      evidence: [
        evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, `status=${manifest.status}`),
        branchEvidence(input.branches, manifest.branch),
      ],
    });
  }

  for (const pr of input.pullRequests.filter((entry) => entry.state === 'open')) {
    const issueId = issueIdFromBranch(pr.branch);
    const manifest = issueId ? manifestsByIssue.get(issueId) : undefined;
    if (!issueId) {
      continue;
    }
    if (!manifest) {
      addCheck(checks, {
        id: 'ORCH-OPEN-PR-MANIFEST-URL',
        requirement: 'required',
        verdict: 'fail',
        issue_id: issueId,
        branch: pr.branch,
        pr_url: pr.url,
        detail: 'Open PR exists but the matching lane manifest is missing',
        evidence: [
          evidence('github_pr', pr.url, `state=open; branch=${pr.branch}`),
          evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, 'missing manifest'),
        ],
      });
      continue;
    }
    addCheck(checks, {
      id: 'ORCH-OPEN-PR-MANIFEST-URL',
      requirement: 'required',
      verdict: manifest.pr_url === pr.url ? 'pass' : 'fail',
      issue_id: issueId,
      branch: pr.branch,
      pr_url: pr.url,
      detail: manifest.pr_url === pr.url
        ? 'Open PR URL is recorded in lane manifest'
        : 'Open PR exists but lane manifest is missing the matching PR URL',
      evidence: [
        evidence('github_pr', pr.url, `state=open; branch=${pr.branch}`),
        evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, `pr_url=${manifest.pr_url ?? 'null'}`),
      ],
    });
  }

  for (const pr of input.pullRequests.filter((entry) => entry.state === 'merged')) {
    const issueId = issueIdFromBranch(pr.branch);
    if (!issueId) {
      continue;
    }
    const linearIssue = linearByIssue.get(issueId);
    if (!linearIssue || isLinearDone(linearIssue)) {
      continue;
    }
    const mergedAtMs = Date.parse(pr.merged_at ?? '');
    const ageMs = Number.isNaN(mergedAtMs) ? Number.POSITIVE_INFINITY : now.getTime() - mergedAtMs;
    const ageMinutes = Math.max(0, Math.floor(ageMs / (60 * 1000)));
    addCheck(checks, {
      id: 'ORCH-MERGED-PR-LINEAR-DONE',
      requirement: 'required',
      verdict: ageMs > transitionWindowMs ? 'fail' : 'warn',
      issue_id: issueId,
      branch: pr.branch,
      pr_url: pr.url,
      detail: `Merged PR is ${ageMinutes}m old but Linear state is ${linearIssue.state_name}`,
      evidence: [
        evidence('github_pr', pr.url, `state=merged; merged_at=${pr.merged_at ?? 'unknown'}`),
        evidence('linear', `Linear:${issueId}`, `state=${linearIssue.state_name}`),
      ],
    });
  }

  for (const issue of input.linearIssues.filter(isLinearDone)) {
    const issueId = normalizeIssueId(issue.issue_id);
    const mergeSha = mergeShaForIssue(issueId, input.manifests, input.pullRequests);
    addCheck(checks, {
      id: 'ORCH-DONE-MERGE-SHA',
      requirement: 'required',
      verdict: mergeSha ? 'pass' : 'fail',
      issue_id: issueId,
      branch: manifestsByIssue.get(issueId)?.branch,
      detail: mergeSha
        ? `Linear Done has merge SHA ${mergeSha}`
        : 'Linear Done issue has no merge SHA in manifest truth history or merged PR data',
      evidence: [
        evidence('linear', `Linear:${issueId}`, `state=${issue.state_name}`),
        evidence('lane_manifest', `docs/06_status/lanes/${issueId}.json`, `merge_sha=${mergeSha ?? 'missing'}`),
      ],
    });
  }

  for (const manifest of input.manifests.filter((entry) => CLOSED_MANIFEST_STATUSES.has(entry.status))) {
    if (!branchExists(input.branches, manifest.branch)) {
      continue;
    }
    addCheck(checks, {
      id: 'ORCH-CLOSED-LANE-BRANCH-CLEANUP',
      requirement: 'advisory',
      verdict: 'cleanup_candidate',
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      detail: `Lane is ${manifest.status} but branch still exists`,
      evidence: [
        evidence('lane_manifest', `docs/06_status/lanes/${manifest.issue_id}.json`, `status=${manifest.status}`),
        branchEvidence(input.branches, manifest.branch),
      ],
    });
  }

  for (const pr of input.pullRequests) {
    for (const check of pr.checks ?? []) {
      const required = requiredCheckNames.has(check.name);
      const completed = check.status === 'completed';
      const successful = completed
        && (check.conclusion === 'success' || check.conclusion === 'skipped' || check.conclusion === 'neutral');
      const verdict: OrchestrationVerdict = successful ? 'pass' : required ? 'fail' : 'warn';
      addCheck(checks, {
        id: 'ORCH-GITHUB-CHECK',
        requirement: required ? 'required' : 'advisory',
        verdict,
        branch: pr.branch,
        pr_url: pr.url,
        detail: `${required ? 'Required' : 'Advisory'} GitHub check "${check.name}" is ${check.status}/${check.conclusion ?? 'none'}`,
        evidence: [
          evidence('github_checks', pr.url, `check=${check.name}; status=${check.status}; conclusion=${check.conclusion ?? 'none'}`),
        ],
      });
    }
  }

  if (checks.length === 0) {
    for (const issueId of uniqueIssueIds(input)) {
      addCheck(checks, {
        id: 'ORCH-CLEAN-PATH',
        requirement: 'required',
        verdict: 'pass',
        issue_id: issueId,
        branch: manifestsByIssue.get(issueId)?.branch ?? activeLeasesByIssue.get(issueId)?.branch,
        detail: 'No orchestration drift detected for issue',
        evidence: [
          evidence('scheduler', 'orchestration-reconciler', 'all surfaces agree or have no applicable drift rule'),
        ],
      });
    }
  }

  const summary: Record<OrchestrationVerdict, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    infra_error: 0,
    historical_decay: 0,
    stale_reclaim_required: 0,
    cleanup_candidate: 0,
  };
  for (const check of checks) {
    summary[check.verdict] += 1;
  }

  const hasFail = checks.some((check) => FAIL_CLASS_VERDICTS.has(check.verdict));
  const hasInfra = checks.some((check) => check.verdict === 'infra_error');
  const hasWarn = checks.some((check) =>
    check.verdict === 'warn'
    || check.verdict === 'cleanup_candidate'
    || check.verdict === 'historical_decay'
  );
  const verdict = hasFail ? 'FAIL' : hasInfra ? 'INFRA' : hasWarn ? 'WARN' : 'PASS';
  const stateMachine = buildStateMachineReport(input, now);

  return {
    schema_version: 1,
    generated_at: input.generatedAt ?? now.toISOString(),
    verdict,
    exit_code: hasFail ? 1 : hasInfra ? 3 : 0,
    mode: input.mode,
    filters: {
      mode: input.mode,
      issue_id: input.normalizedIssueId,
      since: input.sinceIso,
      selected_issue_ids: input.selectedIssueIds,
      current_issue_ids: input.currentIssueIds,
    },
    transition_window_minutes: transitionWindowMinutes,
    summary,
    checks,
    state_machine: stateMachine,
    repair_plan: buildRepairPlan(input, stateMachine),
    cleanup_plan: buildCleanupPlan(input),
    scheduling: {
      status: 'proposed',
      detail: 'Safe wiring: run pnpm ops:orchestration-reconcile --current --cleanup-plan --json from a scheduled CI job after Linear/GitHub credentials are present.',
    },
  };
}

function runCommand(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr ?? '').trim() || `Command failed: ${command} ${args.join(' ')}`);
  }
  return (result.stdout ?? '').trim();
}

export function gitBranches(): BranchSnapshot[] {
  const branches: BranchSnapshot[] = [];
  const local = runCommand('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  for (const line of local.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    branches.push({ name: line, source: 'local' });
  }
  const remote = runCommand('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
  for (const line of remote.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    if (line === 'origin/HEAD') continue;
    branches.push({ name: line.replace(/^origin\//, ''), source: 'remote' });
  }
  return branches;
}

interface GhPrRecord {
  number: number;
  headRefName: string;
  url: string;
  state: string;
  mergedAt?: string | null;
  mergeCommit?: { oid?: string | null } | null;
}

interface GhStatusCheckRollupItem {
  name?: string;
  status?: string;
  conclusion?: string | null;
}

function parseGhPr(record: GhPrRecord, state: PullRequestSnapshot['state']): PullRequestSnapshot {
  return {
    number: record.number,
    branch: record.headRefName,
    url: record.url,
    state,
    merged_at: record.mergedAt ?? null,
    merge_sha: record.mergeCommit?.oid ?? null,
    checks: [],
  };
}

function githubPullRequests(infraErrors: string[]): PullRequestSnapshot[] {
  try {
    const fields = 'number,headRefName,url,state,mergedAt,mergeCommit';
    const open = JSON.parse(runCommand('gh', ['pr', 'list', '--state', 'open', '--json', fields])) as GhPrRecord[];
    const merged = JSON.parse(runCommand('gh', ['pr', 'list', '--state', 'merged', '--limit', '100', '--json', fields])) as GhPrRecord[];
    const prs = [
      ...open.map((record) => parseGhPr(record, 'open')),
      ...merged.map((record) => parseGhPr(record, 'merged')),
    ];
    for (const pr of prs) {
      try {
        const rollup = JSON.parse(
          runCommand('gh', ['pr', 'view', String(pr.number), '--json', 'statusCheckRollup']),
        ) as { statusCheckRollup?: GhStatusCheckRollupItem[] };
        pr.checks = (rollup.statusCheckRollup ?? [])
          .filter((check) => typeof check.name === 'string')
          .map((check) => ({
            name: check.name ?? 'unknown',
            status: normalizeCheckStatus(check.status?.toLowerCase()),
            conclusion: normalizeCheckConclusion(check.conclusion),
          }));
      } catch (error) {
        infraErrors.push(`GitHub checks unavailable for PR #${pr.number}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return prs;
  } catch (error) {
    infraErrors.push(`GitHub PR query failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function normalizeCheckStatus(input: string | undefined): GitHubCheckSnapshot['status'] {
  const value = String(input ?? '').toLowerCase();
  if (value === 'completed' || value === 'in_progress' || value === 'queued' || value === 'pending') {
    return value;
  }
  return 'unknown';
}

function normalizeCheckConclusion(input: string | null | undefined): GitHubCheckSnapshot['conclusion'] {
  switch (String(input ?? '').toUpperCase()) {
    case 'SUCCESS': return 'success';
    case 'FAILURE': return 'failure';
    case 'CANCELLED': return 'cancelled';
    case 'TIMED_OUT': return 'timed_out';
    case 'SKIPPED': return 'skipped';
    case 'NEUTRAL': return 'neutral';
    default: return null;
  }
}

interface LinearIssueQueryData {
  issue: {
    identifier: string;
    updatedAt?: string;
    state?: {
      name?: string;
      type?: string;
    } | null;
  } | null;
}

async function fetchLinearIssues(
  issueIds: string[],
  infraErrors: string[],
  historicalDecayErrors: string[],
  currentIssueIds: Set<string>,
): Promise<LinearIssueSnapshot[]> {
  const token = readConfiguredEnvValue('LINEAR_API_TOKEN') || readConfiguredEnvValue('LINEAR_API_KEY');
  if (!token) {
    infraErrors.push('Linear query skipped: LINEAR_API_TOKEN or LINEAR_API_KEY is required');
    return [];
  }

  const issues: LinearIssueSnapshot[] = [];
  for (const issueId of issueIds) {
    const result = await linearQuery<LinearIssueQueryData>(
      `query OrchestrationIssue($id: String!) {
        issue(id: $id) {
          identifier
          updatedAt
          state { name type }
        }
      }`,
      { id: issueId },
      { token, userAgent: 'unit-talk-orchestration-reconciler' },
    );
    if (!result.ok || !result.data?.issue) {
      const message = `Linear issue query failed for ${issueId}: ${result.error ?? 'not found'}`;
      if (!currentIssueIds.has(issueId) && isHistoricalLinearDecay(result.error ?? 'not found')) {
        historicalDecayErrors.push(message);
      } else {
        infraErrors.push(message);
      }
      continue;
    }
    issues.push({
      issue_id: result.data.issue.identifier,
      state_name: result.data.issue.state?.name ?? 'Unknown',
      state_type: result.data.issue.state?.type,
      updated_at: result.data.issue.updatedAt,
    });
  }
  return issues;
}

function isHistoricalLinearDecay(error: string): boolean {
  return /entity not found|not found/i.test(error);
}

export function renderHuman(report: OrchestrationReconcilerReport): string {
  const lines = [
    `[ops:orchestration-reconcile] generated_at=${report.generated_at} verdict=${report.verdict} mode=${report.mode}`,
    `  filters issue_id=${report.filters.issue_id ?? '-'} since=${report.filters.since ?? '-'} selected_issue_ids=${report.filters.selected_issue_ids.join(',') || '-'}`,
    `  transition_window_minutes=${report.transition_window_minutes}`,
    `  summary pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail} stale_reclaim_required=${report.summary.stale_reclaim_required} cleanup_candidate=${report.summary.cleanup_candidate} historical_decay=${report.summary.historical_decay} infra_error=${report.summary.infra_error}`,
  ];

  const currentRequiredFailures = report.checks.filter((check) =>
    check.requirement === 'required'
    && (check.verdict === 'fail' || check.verdict === 'stale_reclaim_required' || check.verdict === 'infra_error')
  );
  const currentRequiredChecks = report.checks.filter((check) =>
    check.requirement === 'required'
    && check.verdict !== 'fail'
    && check.verdict !== 'stale_reclaim_required'
    && check.verdict !== 'infra_error'
  );
  const historicalDebt = report.checks.filter((check) => check.requirement === 'advisory');
  const sections: Array<[string, OrchestrationCheck[]]> = [
    ['current required failures', currentRequiredFailures],
    ['current required checks', currentRequiredChecks],
    ['historical debt / cleanup candidates', historicalDebt],
  ];
  for (const [label, checks] of sections) {
    lines.push(`  ${label}:`);
    if (checks.length === 0) {
      lines.push('    none');
      continue;
    }
    for (const check of checks) {
      lines.push(
        `    [${check.verdict.toUpperCase()}] ${check.id} ${check.requirement} ${check.issue_id ?? '-'} ${check.branch ?? '-'} :: ${check.detail}`,
      );
      for (const item of check.evidence) {
        lines.push(`      - ${item.surface} ${item.source}: ${item.detail}`);
      }
    }
  }
  lines.push('  reconciliation states:');
  if (report.state_machine.lanes.length === 0) {
    lines.push('    none');
  } else {
    for (const lane of report.state_machine.lanes) {
      lines.push(
        `    [${lane.fail_closed ? 'FAIL-CLOSED' : 'OPEN'}] ${lane.issue_id} ${lane.state} ${lane.lifecycle} :: ${lane.detail}`,
      );
    }
  }
  lines.push('  repair plan:');
  if (report.repair_plan.actions.length === 0) {
    lines.push('    none');
  } else {
    for (const action of report.repair_plan.actions) {
      lines.push(
        `    [${action.safe_to_apply ? 'SAFE' : 'MANUAL'}] ${action.id} ${action.issue_id} :: ${action.reason}`,
      );
      if (action.command) {
        lines.push(`      command: ${action.command}`);
      }
    }
  }
  lines.push(`  scheduling: ${report.scheduling.detail}`);
  return `${lines.join('\n')}\n`;
}

function parseMode(parsed: ReturnType<typeof parseArgs>): OrchestrationReconcileMode {
  const boolModes = [
    parsed.bools.has('current') ? 'current' : null,
    parsed.bools.has('all') ? 'all' : null,
    parsed.flags.has('issue') ? 'issue' : null,
  ].filter((entry): entry is OrchestrationReconcileMode => entry != null);
  if (boolModes.length > 1) {
    throw new Error('Use only one reconcile mode: --current, --all, or --issue UTV2-####');
  }
  return boolModes[0] ?? 'current';
}

function parseIssueFilter(parsed: ReturnType<typeof parseArgs>): string | undefined {
  const issueId = parsed.flags.get('issue')?.at(-1);
  if (!issueId) {
    return undefined;
  }
  const normalized = normalizeIssueId(issueId);
  if (!/^(UTV2|UNI)-\d+$/.test(normalized)) {
    throw new Error(`Invalid --issue value: ${issueId}`);
  }
  return normalized;
}

function parseSinceFilter(parsed: ReturnType<typeof parseArgs>): string | undefined {
  return parsed.flags.get('since')?.at(-1);
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const json = parsed.bools.has('json');
  const human = parsed.bools.has('human') || !json || parsed.bools.has('both');
  const cleanupPlan = parsed.bools.has('cleanup-plan');
  const applyCleanup = parsed.bools.has('apply-cleanup');
  const mode = parseMode(parsed);
  const issueId = parseIssueFilter(parsed);
  const since = parseSinceFilter(parsed);
  const transitionWindow = Number.parseInt(parsed.flags.get('transition-window-minutes')?.at(-1) ?? '', 10);
  const infraErrors: string[] = [];
  const historicalDecayErrors: string[] = [];

  const manifests = readAllManifests();
  const leases = readAllLeases();
  const branches = safeCollect(gitBranches, 'Git branch query failed', infraErrors);
  const pullRequests = githubPullRequests(infraErrors);
  const issueIds = uniqueIssueIds({
    linearIssues: [],
    leases,
    manifests,
    branches,
    pullRequests,
  });
  const currentIssueIds = collectCurrentIssueIds({
    linearIssues: [],
    leases,
    manifests,
    branches,
    pullRequests,
  });
  const linearIssueIds = new Set(issueIds);
  if (issueId) {
    linearIssueIds.add(issueId);
    currentIssueIds.add(issueId);
  }
  const linearIssues = await fetchLinearIssues(
    [...linearIssueIds].sort((left, right) => left.localeCompare(right)),
    infraErrors,
    historicalDecayErrors,
    currentIssueIds,
  );

  const report = buildOrchestrationReconcilerReport({
    linearIssues,
    leases,
    manifests,
    branches,
    pullRequests,
    mode,
    issueId,
    since,
    requiredCheckNames: (parsed.flags.get('required-check') ?? []).flatMap((entry) =>
      entry.split(',').map((value) => value.trim()).filter(Boolean),
    ),
    transitionWindowMinutes: Number.isFinite(transitionWindow) ? transitionWindow : undefined,
    infraErrors,
    historicalDecayErrors,
  });
  if (applyCleanup) {
    throw new Error('Cleanup apply is not automated yet; run the dry-run cleanup_plan commands explicitly under the merge mutex.');
  }
  if (!cleanupPlan && !json) {
    report.cleanup_plan.actions = [];
  }

  if (human) {
    process.stdout.write(renderHuman(report));
  }
  if (json) {
    emitJson(report);
  }
  process.exitCode = report.exit_code;
}

function safeCollect<T>(collector: () => T, label: string, infraErrors: string[]): T {
  try {
    return collector();
  } catch (error) {
    infraErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return [] as T;
  }
}

const isDirectRun = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  void main().catch((error: unknown) => {
    console.error('[orchestration-reconciler] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
