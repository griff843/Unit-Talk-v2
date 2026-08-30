import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildOrchestrationReconcilerReport,
  classifyLinearLookupError,
  readConfiguredEnvValue,
  renderHuman,
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

test('fails when an active manifest branch is missing even without an active lease', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane()],
    branches: [],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-ACTIVE-MANIFEST-BRANCH');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /branch is missing/);
  assert.equal(report.exit_code, 1);
});

test('fails when an active lease has no matching active manifest', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [lease()],
    manifests: [],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LEASE-MANIFEST');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /no active lane manifest/);
});

test('fails when active lease and manifest branches disagree', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [lease({ branch: 'codex/utv2-1059-lease-branch' })],
    manifests: [lane({ branch: 'codex/utv2-1059-manifest-branch' })],
    branches: [
      branch('codex/utv2-1059-lease-branch'),
      branch('codex/utv2-1059-manifest-branch'),
    ],
    pullRequests: [],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LEASE-MANIFEST');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /does not match manifest branch/);
});

test('matches manifests and leases with normalized issue IDs', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear()],
    leases: [lease({ issue_id: 'utv2-1059' })],
    manifests: [lane({ issue_id: 'utv2-1059' })],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  assert.equal(check(report.checks, 'ORCH-LINEAR-ACTIVE-RECORD').verdict, 'pass');
  assert.equal(check(report.checks, 'ORCH-LEASE-MANIFEST').verdict, 'pass');
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

test('accepts open PRs recorded in related_prs for multi-PR lane manifests', () => {
  const manifest = lane({
    pr_url: 'https://github.com/unit-talk/v2/pull/887',
  }) as LaneManifest & { related_prs: Array<{ number: number; url: string }> };
  manifest.related_prs = [
    { number: 885, url: 'https://github.com/unit-talk/v2/pull/885' },
    { number: 886, url: 'https://github.com/unit-talk/v2/pull/886' },
    { number: 887, url: 'https://github.com/unit-talk/v2/pull/887' },
  ];

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [manifest],
    branches: [branch('codex/utv2-1059-secondary-pr')],
    pullRequests: [
      pr({
        number: 886,
        branch: 'codex/utv2-1059-secondary-pr',
        url: 'https://github.com/unit-talk/v2/pull/886',
      }),
    ],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(entry.verdict, 'pass');
  assert.equal(entry.pr_url, 'https://github.com/unit-talk/v2/pull/886');
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

test('fails when merged PR still has an active manifest and recommends record-merge repair', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [
      lane({
        status: 'in_review',
        pr_url: 'https://github.com/unit-talk/v2/pull/1059',
        commit_sha: null,
      }),
    ],
    branches: [branch()],
    pullRequests: [
      pr({
        state: 'merged',
        merged_at: '2026-05-18T10:00:00.000Z',
        merge_sha: 'abc123',
      }),
    ],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-MERGED-PR-ACTIVE-MANIFEST');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /manifest remains in_review/);
  const laneState = report.state_machine.lanes.find((item) => item.issue_id === 'UTV2-1059');
  assert.equal(laneState?.state, 'merged_pr_active_manifest');
  const action = report.repair_plan.actions.find((item) => item.id === 'record_merge_on_manifest');
  assert.equal(action?.safe_to_apply, true);
  assert.equal(action?.requires_pm, false);
  assert.equal(
    action?.command,
    'pnpm ops:lane-manifest -- record-merge UTV2-1059 --pr 1059 --json',
  );
  assert.equal(report.exit_code, 1);
});

test('fails when Linear Done has no merge SHA evidence', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: null })],
    branches: [],
    pullRequests: [],
    mode: 'all',
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-DONE-MERGE-SHA');
  assert.equal(entry.verdict, 'fail');
  assert.match(entry.detail, /no merge SHA/);
});

test('handles legacy manifests without truth_check_history while checking merge SHA evidence', () => {
  const legacyManifest = lane({ status: 'done', commit_sha: null }) as LaneManifest & {
    truth_check_history?: LaneManifest['truth_check_history'];
  };
  delete legacyManifest.truth_check_history;

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [legacyManifest],
    branches: [],
    pullRequests: [],
    mode: 'all',
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

test('classifies expired orphan lease as safe reclaim with audit command', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [lease({ expires_at: '2026-05-18T11:59:59.000Z' })],
    manifests: [],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  const laneState = report.state_machine.lanes.find((entry) => entry.issue_id === 'UTV2-1059');
  assert.equal(laneState?.state, 'stale_lease_safe_reclaim');
  assert.equal(laneState?.fail_closed, true);
  const action = report.repair_plan.actions.find((entry) => entry.id === 'reclaim_stale_lease');
  assert.equal(action?.safe_to_apply, true);
  assert.equal(action?.requires_pm, false);
  assert.match(action?.command ?? '', /pnpm ops:lease reclaim/);
});

test('keeps active owner stale lease in manual repair lane', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'In Codex', state_type: 'started' })],
    leases: [lease({ expires_at: '2026-05-18T11:59:59.000Z' })],
    manifests: [],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  const laneState = report.state_machine.lanes.find((entry) => entry.issue_id === 'UTV2-1059');
  assert.equal(laneState?.state, 'lease_without_manifest');
  const action = report.repair_plan.actions.find((entry) => entry.issue_id === 'UTV2-1059');
  assert.equal(action?.id, 'escalate_manual_repair');
  assert.equal(action?.safe_to_apply, false);
  assert.equal(action?.requires_pm, true);
});

test('marks branch for closed lane as cleanup candidate', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: 'abc123' })],
    branches: [branch()],
    pullRequests: [],
    mode: 'all',
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-CLOSED-LANE-BRANCH-CLEANUP');
  assert.equal(entry.requirement, 'advisory');
  assert.equal(entry.verdict, 'cleanup_candidate');
  assert.equal(report.exit_code, 0);
  assert.equal(
    report.cleanup_plan.actions.some((action) => action.id === 'delete_local_branch' && action.issue_id === 'UTV2-1059'),
    true,
  );
});

test('cleanup plan refuses active current lanes', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'In Codex' })],
    leases: [lease()],
    manifests: [lane()],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  assert.equal(
    report.cleanup_plan.actions.some((action) => action.id === 'refuse_active_lane' && action.safe_to_apply === false),
    true,
  );
});

test('open PR without manifest fails closed with deterministic manifest repair action', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [branch()],
    pullRequests: [pr()],
    now: NOW,
  });

  assert.equal(check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL').verdict, 'fail');
  const laneState = report.state_machine.lanes.find((entry) => entry.issue_id === 'UTV2-1059');
  assert.equal(laneState?.state, 'open_pr_without_manifest');
  const action = report.repair_plan.actions.find((entry) => entry.id === 'repair_missing_manifest');
  assert.equal(action?.safe_to_apply, false);
  assert.match(action?.command ?? '', /pnpm ops:manifest-repair --issue UTV2-1059 --from-pr 1059 --dry-run/);
});

test('cleanup plan treats released leases as no-op safe state', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [lease({ status: 'released' })],
    manifests: [],
    branches: [],
    pullRequests: [],
    mode: 'all',
    now: NOW,
  });

  const action = report.cleanup_plan.actions.find((entry) => entry.id === 'release_done_lease');
  assert.equal(action?.safe_to_apply, true);
  assert.equal(action?.command, null);
});

test('defaults to current actionable issues instead of historical all debt', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: null })],
    branches: [branch()],
    pullRequests: [],
    now: NOW,
  });

  assert.equal(report.mode, 'current');
  assert.deepEqual(report.filters.selected_issue_ids, []);
  assert.equal(report.checks.length, 0);
  assert.equal(report.verdict, 'PASS');
});

test('all mode still reports historical debt, but as non-blocking closeout debt (UTV2-1758)', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: null })],
    branches: [branch()],
    pullRequests: [],
    mode: 'all',
    now: NOW,
  });

  assert.equal(report.mode, 'all');
  assert.deepEqual(report.filters.selected_issue_ids, ['UTV2-1059']);
  // The findings are still reported in full — only their dispatch authority
  // changed. A terminal lane holding no lease, lock, or active Linear record
  // carries no dispatch, capacity, or production risk.
  const doneMergeSha = check(report.checks, 'ORCH-DONE-MERGE-SHA');
  assert.equal(doneMergeSha.verdict, 'fail');
  assert.equal(doneMergeSha.classification, 'closeout_debt');
  assert.equal(check(report.checks, 'ORCH-CLOSED-LANE-BRANCH-CLEANUP').verdict, 'cleanup_candidate');
  assert.equal(report.buckets.dispatch_blocking_failures.length, 0);
  assert.equal(report.exit_code, 0);
});

test('issue mode filters reconciliation to one issue', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [
      linear({ issue_id: 'UTV2-1059' }),
      linear({ issue_id: 'UTV2-1060' }),
    ],
    leases: [lease({ issue_id: 'UTV2-1059' })],
    manifests: [lane({ issue_id: 'UTV2-1059' })],
    branches: [branch()],
    pullRequests: [],
    issueId: 'utv2-1060',
    now: NOW,
  });

  assert.equal(report.mode, 'issue');
  assert.equal(report.filters.issue_id, 'UTV2-1060');
  assert.deepEqual(report.filters.selected_issue_ids, ['UTV2-1060']);
  const entry = check(report.checks, 'ORCH-LINEAR-ACTIVE-RECORD');
  assert.equal(entry.issue_id, 'UTV2-1060');
  assert.equal(entry.verdict, 'fail');
  assert.equal(report.checks.some((item) => item.issue_id === 'UTV2-1059'), false);
});

test('since filter includes recent historical records without forcing all history', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [
      linear({ issue_id: 'UTV2-1059', state_name: 'Done', state_type: 'completed', updated_at: '2026-05-17T11:00:00.000Z' }),
      linear({ issue_id: 'UTV2-1060', state_name: 'Done', state_type: 'completed', updated_at: '2026-05-18T11:00:00.000Z' }),
    ],
    leases: [],
    manifests: [
      lane({
        issue_id: 'UTV2-1059',
        status: 'done',
        commit_sha: null,
        started_at: '2026-05-17T10:00:00.000Z',
        heartbeat_at: '2026-05-17T11:30:00.000Z',
      }),
      lane({
        issue_id: 'UTV2-1060',
        status: 'done',
        commit_sha: null,
        branch: 'codex/utv2-1060-recent-history',
        heartbeat_at: '2026-05-18T11:30:00.000Z',
      }),
    ],
    branches: [branch(), branch('codex/utv2-1060-recent-history')],
    pullRequests: [],
    mode: 'all',
    since: '2026-05-18T00:00:00.000Z',
    now: NOW,
  });

  assert.equal(report.filters.since, '2026-05-18T00:00:00.000Z');
  assert.deepEqual(report.filters.selected_issue_ids, ['UTV2-1060']);
  assert.equal(report.checks.every((entry) => entry.issue_id === 'UTV2-1060'), true);
  assert.equal(check(report.checks, 'ORCH-DONE-MERGE-SHA').verdict, 'fail');
});

test('human output separates the four reconciliation buckets', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ state_name: 'Done', state_type: 'completed' })],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: null })],
    branches: [branch()],
    pullRequests: [],
    mode: 'all',
    now: NOW,
  });
  const output = renderHuman(report);

  assert.match(output, /mode=all/);
  assert.match(output, /dispatch_blocking_failures \(these stop dispatch\):/);
  assert.match(output, /infra_errors \(unknown state/);
  assert.match(output, /closeout_debt \(reported, does not stop dispatch\):/);
  assert.match(output, /warnings \(reported, does not stop dispatch\):/);
  assert.match(output, /buckets dispatch_blocking_failures=0 closeout_debt=1 warnings=1 infra_errors=0/);
  assert.match(output, /ORCH-DONE-MERGE-SHA/);
  assert.match(output, /ORCH-CLOSED-LANE-BRANCH-CLEANUP/);
  assert.match(output, /reconciliation states:/);
  assert.match(output, /repair plan:/);
});

test('historical Linear decay is advisory and does not become infra failure', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane({ status: 'done', commit_sha: 'abc123' })],
    branches: [],
    pullRequests: [],
    mode: 'all',
    now: NOW,
    historicalDecayErrors: ['Linear issue query failed for UTV2-1059: Entity not found: Issue'],
  });

  const decay = check(report.checks, 'ORCH-HISTORICAL-DECAY');
  assert.equal(decay.requirement, 'advisory');
  assert.equal(decay.verdict, 'historical_decay');
  assert.equal(report.summary.historical_decay, 1);
  assert.equal(report.verdict, 'WARN');
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
            runner: 'ops:lane-close',
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

test('reads Linear token from repo env files when process env is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-reconcile-env-'));
  try {
    fs.writeFileSync(path.join(root, 'local.env'), 'LINEAR_API_TOKEN=\n', 'utf8');
    fs.writeFileSync(path.join(root, '.env'), 'LINEAR_API_TOKEN=lin_from_env\n', 'utf8');

    assert.equal(readConfiguredEnvValue('LINEAR_API_TOKEN', root, {}), 'lin_from_env');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('process env wins over repo env files for reconciler token lookup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-reconcile-env-'));
  try {
    fs.writeFileSync(path.join(root, 'local.env'), 'LINEAR_API_TOKEN=lin_from_file\n', 'utf8');

    assert.equal(
      readConfiguredEnvValue('LINEAR_API_TOKEN', root, { LINEAR_API_TOKEN: 'lin_from_process' }),
      'lin_from_process',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// UTV2-1758 regression fixtures.
//
// Every fixture below is paired with a mutation that must flip its
// classification. A control that only ever runs green proves nothing, so each
// case asserts both the intended verdict and the verdict under the condition
// the control names.
// ---------------------------------------------------------------------------

function bucketIds(
  report: ReturnType<typeof buildOrchestrationReconcilerReport>,
  bucket: 'dispatch_blocking_failures' | 'closeout_debt' | 'warnings' | 'infra_errors',
): string[] {
  return report.buckets[bucket].map((entry) => entry.id);
}

test('classifyLinearLookupError separates deletion from transient, auth, and unknown failures', () => {
  assert.equal(classifyLinearLookupError('Entity not found: Issue'), 'deleted');
  assert.equal(classifyLinearLookupError('The operation was aborted due to timeout'), 'transient');
  assert.equal(classifyLinearLookupError('fetch failed: ETIMEDOUT'), 'transient');
  assert.equal(classifyLinearLookupError('429 Too Many Requests'), 'transient');
  assert.equal(classifyLinearLookupError('503 Service Unavailable'), 'transient');
  assert.equal(classifyLinearLookupError('401 Unauthorized'), 'auth');
  assert.equal(classifyLinearLookupError('Authentication required'), 'auth');
  assert.equal(classifyLinearLookupError('something else entirely'), 'unknown');

  // ENOTFOUND is a DNS failure whose text contains "not found". It must never
  // be read as a deleted entity.
  assert.equal(classifyLinearLookupError('getaddrinfo ENOTFOUND api.linear.app'), 'transient');
});

test('fixture 1: deleted Linear entity holding an active manifest is a PM-required orphan', () => {
  const orphan = lane({
    issue_id: 'UTV2-1512',
    branch: 'codex/utv2-1512-reconciler-write-path',
    status: 'in_progress',
  });
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [orphan],
    branches: [branch('codex/utv2-1512-reconciler-write-path')],
    pullRequests: [],
    linearFailures: [
      { issue_id: 'UTV2-1512', kind: 'deleted', message: 'Entity not found: Issue' },
    ],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LINEAR-DELETED-ORPHAN');
  assert.equal(entry.verdict, 'fail');
  assert.equal(entry.classification, 'dispatch_blocking');
  assert.equal(entry.issue_id, 'UTV2-1512');
  assert.match(entry.detail, /PM disposition required/);
  assert.ok(bucketIds(report, 'dispatch_blocking_failures').includes('ORCH-LINEAR-DELETED-ORPHAN'));
  assert.equal(report.exit_code, 1);

  // Mutation: the same deleted entity, now referenced only by a terminal
  // manifest, must drop to historical debt — and must not fabricate a pass.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [lane({ ...orphan, status: 'done', closed_at: '2026-05-17T10:00:00.000Z' })],
    branches: [],
    pullRequests: [],
    linearFailures: [
      { issue_id: 'UTV2-1512', kind: 'deleted', message: 'Entity not found: Issue' },
    ],
    mode: 'all',
    now: NOW,
  });
  assert.equal(
    mutated.checks.find((entry_) => entry_.id === 'ORCH-LINEAR-DELETED-ORPHAN'),
    undefined,
  );
  const decayed = check(mutated.checks, 'ORCH-HISTORICAL-DECAY');
  assert.equal(decayed.verdict, 'historical_decay');
  assert.equal(decayed.classification, 'warning');
  assert.match(decayed.detail, /terminal manifest \(status=done\)/);
  assert.equal(mutated.buckets.dispatch_blocking_failures.length, 0);
  assert.equal(mutated.exit_code, 0);
  // No check anywhere may report this deleted entity as passing.
  assert.equal(
    mutated.checks.some((entry_) => entry_.issue_id === 'UTV2-1512' && entry_.verdict === 'pass'),
    false,
  );
});

test('fixture 2: UTV2-1736 manifest present at the exact PR head does not fail ORCH-OPEN-PR-MANIFEST-URL', () => {
  const prUrl = 'https://github.com/unit-talk/v2/pull/1451';
  const headManifest = lane({
    issue_id: 'UTV2-1736',
    branch: 'codex/utv2-1736-offer-history-partitions',
    status: 'in_review',
    pr_url: prUrl,
  });
  const openPr = pr({
    number: 1451,
    branch: 'codex/utv2-1736-offer-history-partitions',
    url: prUrl,
    head_sha: 'd0bc88ce0000000000000000000000000000abcd',
    head_manifest: headManifest,
  });

  // The working-tree copy is deliberately stale (started, no pr_url) — exactly
  // the shape that produced the original false positive.
  const staleRootCopy = lane({
    issue_id: 'UTV2-1736',
    branch: 'codex/utv2-1736-offer-history-partitions',
    status: 'started',
    pr_url: null,
  });

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [staleRootCopy],
    branches: [branch('codex/utv2-1736-offer-history-partitions')],
    pullRequests: [openPr],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(entry.verdict, 'pass');
  assert.match(entry.detail, /resolved from PR head/);
  assert.equal(bucketIds(report, 'dispatch_blocking_failures').includes('ORCH-OPEN-PR-MANIFEST-URL'), false);

  // Mutation: remove the head manifest and the stale working-tree copy is all
  // that remains — the check must fail again.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [staleRootCopy],
    branches: [branch('codex/utv2-1736-offer-history-partitions')],
    pullRequests: [pr({ ...openPr, head_manifest: undefined })],
    now: NOW,
  });
  const mutatedEntry = check(mutated.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(mutatedEntry.verdict, 'fail');
  assert.equal(mutatedEntry.classification, 'dispatch_blocking');
  assert.match(mutatedEntry.detail, /resolved from working tree \/ main/);
});

test('fixture 3: UTV2-1652 on-branch manifest passes, and a wrong PR URL at the head still fails', () => {
  const prUrl = 'https://github.com/unit-talk/v2/pull/1652';
  const openPr = pr({
    number: 1652,
    branch: 'codex/utv2-1652-worktree-retirement',
    url: prUrl,
    head_sha: 'aaaaaaaa0000000000000000000000000000bbbb',
    head_manifest: lane({
      issue_id: 'UTV2-1652',
      branch: 'codex/utv2-1652-worktree-retirement',
      status: 'in_review',
      pr_url: prUrl,
    }),
  });

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1652-worktree-retirement')],
    pullRequests: [openPr],
    now: NOW,
  });
  assert.equal(check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL').verdict, 'pass');
  assert.equal(report.exit_code, 0);

  // Mutation: the head manifest exists but records a different PR. Presence of
  // a head manifest must not be enough on its own.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1652-worktree-retirement')],
    pullRequests: [
      pr({
        ...openPr,
        head_manifest: lane({
          issue_id: 'UTV2-1652',
          branch: 'codex/utv2-1652-worktree-retirement',
          status: 'in_review',
          pr_url: 'https://github.com/unit-talk/v2/pull/9999',
        }),
      }),
    ],
    now: NOW,
  });
  const mutatedEntry = check(mutated.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(mutatedEntry.verdict, 'fail');
  assert.equal(mutatedEntry.classification, 'dispatch_blocking');
  assert.equal(mutated.exit_code, 1);
});

test('fixture 4: a genuinely missing manifest still blocks — suppression is head-resolution driven, not open-PR driven', () => {
  const openPr = pr({
    number: 1460,
    branch: 'codex/utv2-1460-missing-manifest',
    url: 'https://github.com/unit-talk/v2/pull/1460',
    head_sha: 'cccccccc0000000000000000000000000000dddd',
    head_manifest: null, // resolved at the head, and genuinely absent there
  });

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1460-missing-manifest')],
    pullRequests: [openPr],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-OPEN-PR-MANIFEST-URL');
  assert.equal(entry.verdict, 'fail');
  assert.equal(entry.classification, 'dispatch_blocking');
  assert.match(entry.detail, /missing at the PR head and on main/);
  assert.equal(report.exit_code, 1);

  // Mutation: supply the manifest at the head and the same open PR passes.
  // This is what proves the fail above came from the manifest, not the PR.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1460-missing-manifest')],
    pullRequests: [
      pr({
        ...openPr,
        head_manifest: lane({
          issue_id: 'UTV2-1460',
          branch: 'codex/utv2-1460-missing-manifest',
          status: 'in_review',
          pr_url: 'https://github.com/unit-talk/v2/pull/1460',
        }),
      }),
    ],
    now: NOW,
  });
  assert.equal(check(mutated.checks, 'ORCH-OPEN-PR-MANIFEST-URL').verdict, 'pass');
  assert.equal(mutated.exit_code, 0);
});

test('fixture 5: a transient Linear timeout stays a blocking infra error and is never demoted to historical debt', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [],
    pullRequests: [],
    linearFailures: [
      {
        issue_id: 'UTV2-1432',
        kind: classifyLinearLookupError('The operation was aborted due to timeout'),
        message: 'The operation was aborted due to timeout',
      },
    ],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-INFRA');
  assert.equal(entry.verdict, 'infra_error');
  assert.equal(entry.classification, 'infra_error');
  assert.equal(entry.issue_id, 'UTV2-1432');
  assert.match(entry.detail, /transient/);
  assert.equal(bucketIds(report, 'warnings').includes('ORCH-HISTORICAL-DECAY'), false);
  assert.equal(report.verdict, 'INFRA');
  assert.equal(report.exit_code, 3);

  // Mutation: the same issue, now genuinely deleted with no lane state, is
  // historical debt — and stops blocking.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [],
    pullRequests: [],
    linearFailures: [
      {
        issue_id: 'UTV2-1432',
        kind: classifyLinearLookupError('Entity not found: Issue'),
        message: 'Entity not found: Issue',
      },
    ],
    now: NOW,
  });
  assert.equal(check(mutated.checks, 'ORCH-HISTORICAL-DECAY').classification, 'warning');
  assert.equal(mutated.buckets.infra_errors.length, 0);
  assert.equal(mutated.exit_code, 0);

  // An auth failure is likewise blocking, never deletion.
  const authFailure = buildOrchestrationReconcilerReport({
    linearIssues: [],
    leases: [],
    manifests: [],
    branches: [],
    pullRequests: [],
    linearFailures: [
      {
        issue_id: 'UTV2-1432',
        kind: classifyLinearLookupError('401 Unauthorized'),
        message: '401 Unauthorized',
      },
    ],
    now: NOW,
  });
  assert.match(check(authFailure.checks, 'ORCH-INFRA').detail, /auth/);
  assert.equal(authFailure.exit_code, 3);
});

test('fixture 6: merged terminal lane with Linear closeout debt is reported without halting dispatch', () => {
  const merged = pr({
    number: 1409,
    branch: 'claude/utv2-1691-proof-repair',
    url: 'https://github.com/unit-talk/v2/pull/1409',
    state: 'merged',
    merged_at: '2026-05-17T10:00:00.000Z',
    merge_sha: 'eeeeeeee0000000000000000000000000000ffff',
  });
  const terminalManifest = lane({
    issue_id: 'UTV2-1691',
    branch: 'claude/utv2-1691-proof-repair',
    status: 'done',
    closed_at: '2026-05-17T10:05:00.000Z',
  });

  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ issue_id: 'UTV2-1691', state_name: 'In Review', state_type: 'started' })],
    leases: [],
    manifests: [terminalManifest],
    branches: [],
    pullRequests: [merged],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-MERGED-PR-LINEAR-DONE');
  assert.equal(entry.verdict, 'fail');
  assert.equal(entry.classification, 'closeout_debt');
  assert.match(entry.detail, /holds no lease, lock, or active Linear record/);
  assert.ok(bucketIds(report, 'closeout_debt').includes('ORCH-MERGED-PR-LINEAR-DONE'));
  assert.equal(report.buckets.dispatch_blocking_failures.length, 0);
  assert.equal(report.verdict, 'WARN');
  assert.equal(report.exit_code, 0);

  // Mutation: the same debt while the lane still holds an active lease is a
  // genuine dispatch hazard and must block.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues: [linear({ issue_id: 'UTV2-1691', state_name: 'In Review', state_type: 'started' })],
    leases: [
      lease({
        issue_id: 'UTV2-1691',
        branch: 'claude/utv2-1691-proof-repair',
        status: 'active',
      }),
    ],
    manifests: [terminalManifest],
    branches: [branch('claude/utv2-1691-proof-repair')],
    pullRequests: [merged],
    now: NOW,
  });
  const mutatedEntry = check(mutated.checks, 'ORCH-MERGED-PR-LINEAR-DONE');
  assert.equal(mutatedEntry.classification, 'dispatch_blocking');
  assert.ok(bucketIds(mutated, 'dispatch_blocking_failures').includes('ORCH-MERGED-PR-LINEAR-DONE'));
  assert.equal(mutated.exit_code, 1);
});

test('every emitted check lands in exactly one of the four buckets', () => {
  const report = buildOrchestrationReconcilerReport({
    linearIssues: [linear()],
    leases: [lease()],
    manifests: [lane()],
    branches: [],
    pullRequests: [pr({ head_sha: 'feedface', head_manifest: null })],
    linearFailures: [
      { issue_id: 'UTV2-1432', kind: 'transient', message: 'timeout' },
      { issue_id: 'UTV2-1512', kind: 'deleted', message: 'Entity not found: Issue' },
    ],
    now: NOW,
  });

  const bucketed = report.buckets.dispatch_blocking_failures.length
    + report.buckets.closeout_debt.length
    + report.buckets.warnings.length
    + report.buckets.infra_errors.length;
  const informational = report.checks.filter((entry) => entry.classification === 'informational').length;
  assert.equal(bucketed + informational, report.checks.length);
  assert.ok(report.checks.length > 0);
});

test('an active manifest at the open PR head satisfies ORCH-LINEAR-ACTIVE-RECORD (UTV2-1758)', () => {
  const prUrl = 'https://github.com/unit-talk/v2/pull/1452';
  const openPr = pr({
    number: 1452,
    branch: 'codex/utv2-1744-outbox-triage',
    url: prUrl,
    head_sha: '11111111000000000000000000000000000022222',
    head_manifest: lane({
      issue_id: 'UTV2-1744',
      branch: 'codex/utv2-1744-outbox-triage',
      status: 'in_review',
      pr_url: prUrl,
    }),
  });
  const linearIssues = [
    linear({ issue_id: 'UTV2-1744', state_name: 'In Codex', state_type: 'started' }),
  ];

  const report = buildOrchestrationReconcilerReport({
    linearIssues,
    leases: [],
    manifests: [], // nothing on main yet — the lane is still in flight
    branches: [branch('codex/utv2-1744-outbox-triage')],
    pullRequests: [openPr],
    now: NOW,
  });

  const entry = check(report.checks, 'ORCH-LINEAR-ACTIVE-RECORD');
  assert.equal(entry.verdict, 'pass');
  assert.ok(entry.evidence.some((item) => item.detail.includes('resolved from open PR head')));
  assert.equal(report.buckets.dispatch_blocking_failures.length, 0);

  // Mutation: with no manifest at the head either, the lane genuinely has no
  // record and the check must fail again.
  const mutated = buildOrchestrationReconcilerReport({
    linearIssues,
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1744-outbox-triage')],
    pullRequests: [pr({ ...openPr, head_manifest: null })],
    now: NOW,
  });
  const mutatedEntry = check(mutated.checks, 'ORCH-LINEAR-ACTIVE-RECORD');
  assert.equal(mutatedEntry.verdict, 'fail');
  assert.equal(mutatedEntry.classification, 'dispatch_blocking');

  // Mutation: a head manifest that is terminal must not count as active.
  const terminalHead = buildOrchestrationReconcilerReport({
    linearIssues,
    leases: [],
    manifests: [],
    branches: [branch('codex/utv2-1744-outbox-triage')],
    pullRequests: [
      pr({
        ...openPr,
        head_manifest: lane({
          issue_id: 'UTV2-1744',
          branch: 'codex/utv2-1744-outbox-triage',
          status: 'done',
        }),
      }),
    ],
    now: NOW,
  });
  assert.equal(check(terminalHead.checks, 'ORCH-LINEAR-ACTIVE-RECORD').verdict, 'fail');
});
