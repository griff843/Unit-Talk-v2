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
  transition_window_minutes: number;
  summary: Record<OrchestrationVerdict, number>;
  checks: OrchestrationCheck[];
  scheduling: {
    status: 'proposed';
    detail: string;
  };
}

export interface OrchestrationReconcilerInput {
  linearIssues: LinearIssueSnapshot[];
  leases: DispatchLease[];
  manifests: LaneManifest[];
  branches: BranchSnapshot[];
  pullRequests: PullRequestSnapshot[];
  requiredCheckNames?: string[];
  generatedAt?: string;
  now?: Date;
  transitionWindowMinutes?: number;
  infraErrors?: string[];
}

const DEFAULT_TRANSITION_WINDOW_MINUTES = 60;
const ACTIVE_LINEAR_STATE_NAMES = new Set(['in codex', 'in claude']);
const DONE_LINEAR_STATE_NAMES = new Set(['done']);
const DONE_LINEAR_STATE_TYPES = new Set(['completed']);
const FAIL_CLASS_VERDICTS = new Set<OrchestrationVerdict>(['fail', 'stale_reclaim_required']);
const CLOSED_MANIFEST_STATUSES = new Set(['merged', 'done']);

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
  const historySha = manifest?.truth_check_history
    .map((entry) => entry.merge_sha)
    .find((sha): sha is string => typeof sha === 'string' && sha.trim() !== '');
  return manifest?.commit_sha ?? historySha ?? mergedPrForIssue(normalizedIssueId, manifests, prs)?.merge_sha ?? null;
}

function addCheck(checks: OrchestrationCheck[], check: OrchestrationCheck): void {
  checks.push(check);
}

export function buildOrchestrationReconcilerReport(
  input: OrchestrationReconcilerInput,
): OrchestrationReconcilerReport {
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
    stale_reclaim_required: 0,
    cleanup_candidate: 0,
  };
  for (const check of checks) {
    summary[check.verdict] += 1;
  }

  const hasFail = checks.some((check) => FAIL_CLASS_VERDICTS.has(check.verdict));
  const hasInfra = checks.some((check) => check.verdict === 'infra_error');
  const hasWarn = checks.some((check) => check.verdict === 'warn' || check.verdict === 'cleanup_candidate');
  const verdict = hasFail ? 'FAIL' : hasInfra ? 'INFRA' : hasWarn ? 'WARN' : 'PASS';

  return {
    schema_version: 1,
    generated_at: input.generatedAt ?? now.toISOString(),
    verdict,
    exit_code: hasFail ? 1 : hasInfra ? 3 : 0,
    transition_window_minutes: transitionWindowMinutes,
    summary,
    checks,
    scheduling: {
      status: 'proposed',
      detail: 'Safe wiring: run pnpm ops:orchestration-reconcile --json from a scheduled CI job after Linear/GitHub credentials are present.',
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

function gitBranches(): BranchSnapshot[] {
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

async function fetchLinearIssues(issueIds: string[], infraErrors: string[]): Promise<LinearIssueSnapshot[]> {
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
      infraErrors.push(`Linear issue query failed for ${issueId}: ${result.error ?? 'not found'}`);
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

function renderHuman(report: OrchestrationReconcilerReport): string {
  const lines = [
    `[ops:orchestration-reconcile] generated_at=${report.generated_at} verdict=${report.verdict}`,
    `  transition_window_minutes=${report.transition_window_minutes}`,
    `  summary pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail} stale_reclaim_required=${report.summary.stale_reclaim_required} cleanup_candidate=${report.summary.cleanup_candidate} infra_error=${report.summary.infra_error}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `  [${check.verdict.toUpperCase()}] ${check.id} ${check.requirement} ${check.issue_id ?? '-'} ${check.branch ?? '-'} :: ${check.detail}`,
    );
    for (const item of check.evidence) {
      lines.push(`    - ${item.surface} ${item.source}: ${item.detail}`);
    }
  }
  lines.push(`  scheduling: ${report.scheduling.detail}`);
  return `${lines.join('\n')}\n`;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const json = parsed.bools.has('json');
  const human = parsed.bools.has('human') || !json || parsed.bools.has('both');
  const transitionWindow = Number.parseInt(parsed.flags.get('transition-window-minutes')?.at(-1) ?? '', 10);
  const infraErrors: string[] = [];

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
  const linearIssues = await fetchLinearIssues(issueIds, infraErrors);

  const report = buildOrchestrationReconcilerReport({
    linearIssues,
    leases,
    manifests,
    branches,
    pullRequests,
    requiredCheckNames: (parsed.flags.get('required-check') ?? []).flatMap((entry) =>
      entry.split(',').map((value) => value.trim()).filter(Boolean),
    ),
    transitionWindowMinutes: Number.isFinite(transitionWindow) ? transitionWindow : undefined,
    infraErrors,
  });

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
