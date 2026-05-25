import assert from 'node:assert/strict';
import test from 'node:test';
import type { LaneManifest } from './shared.js';
import {
  MAX_CLAUDE_LANES,
  MAX_CODEX_LANES,
  buildExecutionStateReport,
} from './execution-state.js';

function createManifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-974',
    lane_type: 'runtime',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    branch: 'codex/utv2-974-add-execution-state-observability',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/execution-state.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-974/diff-summary.md'],
    status: 'started',
    started_at: '2026-05-15T12:00:00.000Z',
    heartbeat_at: '2026-05-15T12:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

test('active lane summary includes active manifests with expected fields', () => {
  const report = buildExecutionStateReport([
    createManifest({
      issue_id: 'UTV2-974',
      branch: 'codex/utv2-974-add-execution-state-observability',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/999',
      heartbeat_at: '2026-05-15T14:00:00.000Z',
    }),
  ], {
    generatedAt: '2026-05-15T15:00:00.000Z',
  });

  assert.equal(report.active_lanes.length, 1);
  assert.deepStrictEqual(report.active_lanes[0], {
    issue_id: 'UTV2-974',
    branch: 'codex/utv2-974-add-execution-state-observability',
    executor: 'codex-cli',
    tier: 'T2',
    status: 'started',
    heartbeat_at: '2026-05-15T14:00:00.000Z',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/999',
    blockers: [],
    source_url: 'https://linear.app/unit-talk-v2/issue/UTV2-974/',
  });
});

test('blocked lane detection surfaces manifests with non-empty blocked_by', () => {
  const report = buildExecutionStateReport([
    createManifest({
      issue_id: 'UTV2-975',
      blocked_by: ['UTV2-973'],
      status: 'in_progress',
    }),
  ]);

  assert.equal(report.blocked_lanes.length, 1);
  assert.equal(report.blocked_lanes[0]?.issue_id, 'UTV2-975');
  assert.deepStrictEqual(report.blocked_lanes[0]?.blockers, ['UTV2-973']);
});

test('dispatch slot counting uses active manifest executor routing', () => {
  const report = buildExecutionStateReport([
    createManifest({
      issue_id: 'UTV2-976',
      branch: 'codex/utv2-976-one',
      executor: 'codex-cli',
    }),
    createManifest({
      issue_id: 'UTV2-977',
      branch: 'codex/utv2-977-two',
      executor: 'codex-cloud',
    }),
    createManifest({
      issue_id: 'UTV2-978',
      branch: 'claude/utv2-978-one',
      executor: 'claude',
      created_by: 'claude',
    }),
  ]);

  assert.equal(report.dispatch_slots.codex.used, 2);
  assert.equal(report.dispatch_slots.codex.max, MAX_CODEX_LANES);
  assert.equal(report.dispatch_slots.codex.available, Math.max(0, MAX_CODEX_LANES - 2));
  assert.equal(report.dispatch_slots.claude.used, 1);
  assert.equal(report.dispatch_slots.claude.max, MAX_CLAUDE_LANES);
  assert.equal(report.dispatch_slots.claude.available, Math.max(0, MAX_CLAUDE_LANES - 1));
});

test('proof readiness shows T1 missing pnpm test:db as not ready and T2 empty proof as ready', () => {
  const t1 = createManifest({
    issue_id: 'UTV2-979',
    tier: 'T1',
    expected_proof_paths: ['docs/06_status/proof/UTV2-979/evidence.json'],
  });
  const t2 = createManifest({
    issue_id: 'UTV2-980',
    tier: 'T2',
    expected_proof_paths: [],
  });

  const report = buildExecutionStateReport([t1, t2], {
    artifactExists: (artifact, manifest) =>
      manifest.issue_id === 'UTV2-979'
      && artifact === 'docs/06_status/proof/UTV2-979/evidence.json',
  });

  const t1Readiness = report.proof_readiness.find((entry) => entry.issue_id === 'UTV2-979');
  const t2Readiness = report.proof_readiness.find((entry) => entry.issue_id === 'UTV2-980');

  assert.deepStrictEqual(t1Readiness?.required_artifacts, [
    'docs/06_status/proof/UTV2-979/evidence.json',
    'pnpm test:db',
  ]);
  assert.deepStrictEqual(t1Readiness?.present_artifacts, [
    'docs/06_status/proof/UTV2-979/evidence.json',
  ]);
  assert.equal(t1Readiness?.ready, false);
  assert.deepStrictEqual(t2Readiness?.required_artifacts, []);
  assert.deepStrictEqual(t2Readiness?.present_artifacts, []);
  assert.equal(t2Readiness?.ready, true);
});

test('stale heartbeat lanes remain visible in active_lanes', () => {
  const report = buildExecutionStateReport([
    createManifest({
      issue_id: 'UTV2-981',
      status: 'in_progress',
      heartbeat_at: '2026-05-10T00:00:00.000Z',
    }),
  ], {
    nowMs: Date.parse('2026-05-15T12:00:00.000Z'),
  });

  assert.equal(report.active_lanes.length, 1);
  assert.equal(report.active_lanes[0]?.issue_id, 'UTV2-981');
  assert.deepStrictEqual(report.merge_risk_summary.top_conditions, ['STALE_LANE_HEARTBEAT']);
  assert.deepStrictEqual(report.dispatch_dashboard.stale_heartbeats, [
    {
      issue_id: 'UTV2-981',
      heartbeat_at: '2026-05-10T00:00:00.000Z',
      age_hours: 132,
    },
  ]);
});

test('dispatch dashboard summarizes lane types, singleton blockers, and recommended actions', () => {
  const report = buildExecutionStateReport([
    createManifest({
      issue_id: 'UTV2-982',
      lane_type: 'runtime',
      executor: 'codex-cli',
      branch: 'codex/utv2-982-runtime',
    }),
    createManifest({
      issue_id: 'UTV2-983',
      lane_type: 'governance',
      executor: 'claude',
      created_by: 'claude',
      branch: 'claude/utv2-983-governance',
    }),
  ], {
    mergeRiskBuilder: () => ({
      generated_at: '2026-05-15T15:00:00.000Z',
      total_active_lanes: 2,
      conditions: [],
      summary: {
        hard_fail: 0,
        block: 0,
        warning: 0,
      },
    }),
  });

  assert.deepStrictEqual(report.dispatch_dashboard.active_by_executor, {
    claude: 1,
    codex: 1,
    unknown: 0,
  });
  assert.deepStrictEqual(report.dispatch_dashboard.active_by_lane_type, {
    governance: 1,
    runtime: 1,
  });
  assert.deepStrictEqual(report.dispatch_dashboard.singleton_blockers, [
    {
      lane_type: 'runtime',
      active_issue_ids: ['UTV2-982'],
    },
  ]);
  assert.ok(
    report.dispatch_dashboard.recommended_actions.some((action) => action.includes('codex slots available')),
  );
});
