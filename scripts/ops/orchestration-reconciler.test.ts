import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrchestrationReconcilerReport,
  type BranchSnapshot,
  type LinearIssueSnapshot,
  type PullRequestSnapshot,
} from './orchestration-reconciler.js';
import type { DispatchLease } from './lease-registry.js';
import type { LaneManifest } from './shared.js';

const NOW = new Date('2026-05-18T12:00:00.000Z');

function lane(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1059',
    lane_type: 'codex-cli',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-1059-orchestration-reconciler',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/orchestration-reconciler.ts'],
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: '2026-05-18T10:00:00.000Z',
    heartbeat_at: '2026-05-18T11:30:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function lease(overrides: Partial<DispatchLease> = {}): DispatchLease {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1059',
    branch: 'codex/utv2-1059-orchestration-reconciler',
    executor: 'codex-cli',
    cwd: 'C:/Dev/Unit-Talk-v2-main',
    file_scope_lock: ['scripts/ops/orchestration-reconciler.ts'],
    heartbeat_at: '2026-05-18T11:30:00.000Z',
    expires_at: '2026-05-18T15:30:00.000Z',
    owner: {
      user: 'codex-test',
      host: 'unit-test',
      pid: 1059,
      session_id: 'session',
    },
    status: 'active',
    ...overrides,
  };
}

function linear(overrides: Partial<LinearIssueSnapshot> = {}): LinearIssueSnapshot {
  return {
    issue_id: 'UTV2-1059',
    state_name: 'In Codex',
    state_type: 'started',
    updated_at: '2026-05-18T11:00:00.000Z',
    ...overrides,
  };
}

function branch(name = 'codex/utv2-1059-orchestration-reconciler'): BranchSnapshot {
  return { name, source: 'local' };
}

function pr(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    number: 1059,
    branch: 'codex/utv2-1059-orchestration-reconciler',
    url: 'https://github.com/unit-talk/v2/pull/1059',
    state: 'open',
    checks: [],
    ...overrides,
  };
}

function check(reportChecks: ReturnType<typeof buildOrchestrationReconcilerReport>['checks'], id: string) {
  const found = reportChecks.find((entry) => entry.id === id);
  assert.ok(found, `expected check ${id}`);
  return found;
}

test('fails when Linear In Codex has no active lease or lane record', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear()],
    leases: [],
    manifests: [],
    branches: [],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LINEAR-ACTIVE-RECORD');
  assert.equal(entry.verdict, 'fail');
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.exit_code, 1);
});

test('fails when an active lease branch is missing', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [lease()],
    manifests: [],
    branches: [],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LEASE-BRANCH');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /branch is missing/);
});

test('fails when an open PR is not recorded in the manifest PR URL', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane({ pr_url: null })],
    branches: [branch()],
    pullRequests: [pr()],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(entry.verdict, 'fail');
  assert.equal(entry.pr_url, 'https://github.com/unit-talk/v2/pull/1059');
});

test('warns inside transition window and fails after it when merged PR is not Linear Done', () => {
  const fresh = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'In Codex' })],
    leases: [],
    manifests: [lane({ status: 'merged' })],
    branches: [],
    pullRequests: [pr({ state: 'merged', merged_at: '2026-05-18T11:30:00.000Z' })],
    now: NOW,
    transitionWindowMinutes: 60,
  });
  const stale = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'In Claude' })],
    leases: [],
    manifests: [lane({ status: 'merged' })],
    branches: [],
    pullRequests: [pr({ state: 'merged', merged_at: '2026-05-18T10:00:00.000Z' })],
    now: NOW,
    transitionWindowMinutes: 60,
  });

  assert.equal(check(fresh.checks, 'ORCH-MERGED-PR-LINEAR-DONE').verdict, 'warn');
  assert.equal(check(stale.checks, 'ORCH-MERGED-PR-LINEAR-DONE').verdict, 'fail');
  assert.equal(stale.exit_code, 1);
});

test('fails when Linear Done has no merge SHA evidence', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: null })],
    branches: [],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-DONE-MERGE-SHA');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /no merge SHA/);
});

test('marks active expired lease as stale reclaim required', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [lease({ expires_at: '2026-05-18T11:59:59.000Z' })],
    manifests: [],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LEASE-EXPIRY');
  assert.equal(entry.verdict, 'stale_reclaim_required');
  assert.equal(report.exit_code, 1);
});

test('marks branch for closed lane as cleanup candidate', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: 'abc123' })],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-CLOSED-LANE-BRANCH-CLEANUP');
  assert.equal(entry.requirement, 'advisory');
  assert.equal(entry.verdict, 'cleanup_candidate');
  assert.equal(report.exit_code, 0);
});

test('distinguishes required and advisory GitHub checks', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [],
    pullRequests: [
      pr({
        checks: [
          { name: 'pnpm verify', status: 'completed', conclusion: 'failure' },
          { name: 'preview', status: 'completed', conclusion: 'failure' },
        ],
      }),
    ],
    requiredCheckNames: ['pnpm verify'],
    now: NOW,
  });

  const githubChecks = report.checks.filter((entry) => entry.id === 'ORCH-GITHUB-CHECK');
  assert.equal(githubChecks[0]?.requirement, 'required');
  assert.equal(githubChecks[0]?.verdict, 'fail');
  assert.equal(githubChecks[1]?.requirement, 'advisory');
  assert.equal(githubChecks[1]?.verdict, 'warn');
});

test('passes when Linear, lease, manifest, branch, PR, and checks agree', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [lease({ status: 'released' })],
    manifests: [
      lane({
        status: 'done',
        pr_url: 'https://github.com/unit-talk/v2/pull/1059',
        truth_check_history: [
          {
            checked_at: '2026-05-18T11:45:00.000Z',
            verdict: 'pass',
            merge_sha: 'abc123',
            failures: [],
            runner: 'ops:lane:close',
          },
        ],
      }),
    ],
    branches: [],
    pullRequests: [
      pr({
        state: 'merged',
        merged_at: '2026-05-18T11:00:00.000Z',
        merge_sha: 'abc123',
        checks: [{ name: 'pnpm verify', status: 'completed', conclusion: 'success' }],
      }),
    ],
    requiredCheckNames: ['pnpm verify'],
    now: NOW,
  });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.exit_code, 0);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.stale_reclaim_required, 0);
});
