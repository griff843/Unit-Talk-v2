import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDispatchPlan, rankDispatchCandidates } from './daily-digest.js';
import type { LaneManifest } from './shared.js';

function activeLane(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-99001',
    lane_type: 'runtime',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '/tmp/utv2-99001',
    branch: 'codex/utv2-99001-runtime',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/runtime.ts'],
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: '2026-05-25T00:00:00.000Z',
    heartbeat_at: '2026-05-25T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'test',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

test('rankDispatchCandidates orders by readiness, capacity, and conflict risk deterministically', () => {
  const ranked = rankDispatchCandidates(
    [
      {
        identifier: 'UTV2-99010',
        title: 'Runtime lane with active singleton conflict',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99010',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:runtime'],
      },
      {
        identifier: 'UTV2-99011',
        title: 'Safe Codex ops lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99011',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:hygiene', 'work:safe'],
      },
      {
        identifier: 'UTV2-99012',
        title: 'Missing AC lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99012',
        has_acceptance_criteria: false,
        labels: ['tier:T2', 'lane:hygiene'],
      },
    ],
    {
      active_lanes: [activeLane()],
      max_claude: 2,
      max_codex: 2,
      singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
    },
  );

  assert.deepStrictEqual(ranked.map((candidate) => candidate.identifier), [
    'UTV2-99011',
    'UTV2-99012',
    'UTV2-99010',
  ]);
  assert.deepStrictEqual(ranked.map((candidate) => candidate.rank), [1, 2, 3]);
  assert.strictEqual(ranked[0]?.conflict_risk, 'none');
  assert.strictEqual(ranked[2]?.conflict_risk, 'singleton_active');
});

test('rankDispatchCandidates penalizes a full executor without reordering score ties nondeterministically', () => {
  const ranked = rankDispatchCandidates(
    [
      {
        identifier: 'UTV2-99020',
        title: 'First full-capacity candidate',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99020',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:hygiene'],
      },
      {
        identifier: 'UTV2-99021',
        title: 'Second full-capacity candidate',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99021',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:hygiene'],
      },
    ],
    {
      active_lanes: [activeLane({ issue_id: 'UTV2-99020A' })],
      max_claude: 2,
      max_codex: 1,
      singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
    },
  );

  assert.deepStrictEqual(ranked.map((candidate) => candidate.identifier), [
    'UTV2-99020',
    'UTV2-99021',
  ]);
  assert.deepStrictEqual(ranked.map((candidate) => candidate.conflict_risk), [
    'capacity_full',
    'capacity_full',
  ]);
  assert.deepStrictEqual(ranked.map((candidate) => candidate.rank), [1, 2]);
});

test('buildDispatchPlan fills current Claude and Codex openings with safe ranked candidates', () => {
  const ranked = rankDispatchCandidates(
    [
      {
        identifier: 'UTV2-99030',
        title: 'Safe Codex ops lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99030',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:hygiene', 'work:safe'],
      },
      {
        identifier: 'UTV2-99031',
        title: 'Safe Claude governance lane',
        tier: 'T3',
        recommended_executor: 'claude',
        url: 'https://linear.app/unit-talk/issue/UTV2-99031',
        has_acceptance_criteria: true,
        labels: ['tier:T3', 'lane:governance', 'work:safe'],
      },
      {
        identifier: 'UTV2-99032',
        title: 'Second Safe Codex ops lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99032',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:verification', 'work:safe'],
      },
    ],
    {
      active_lanes: [activeLane({ issue_id: 'UTV2-99030A' })],
      max_claude: 2,
      max_codex: 3,
      singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
      forbidden_combinations: [],
    },
  );

  const plan = buildDispatchPlan(ranked, {
    active_lanes: [activeLane({ issue_id: 'UTV2-99030A' })],
    max_claude: 2,
    max_codex: 3,
    singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
    forbidden_combinations: [],
  });

  assert.deepStrictEqual(plan.fill_now.map((entry) => entry.identifier).sort(), [
    'UTV2-99030',
    'UTV2-99031',
    'UTV2-99032',
  ]);
  assert.deepStrictEqual(plan.lane_saturation_forecast.executors, {
    claude: { max: 2, active: 0, available_slots: 1 },
    codex: { max: 3, active: 1, available_slots: 0 },
  });
});

test('buildDispatchPlan blocks missing AC, singleton, forbidden, and capacity conflicts with reason codes', () => {
  const active = [
    activeLane({
      issue_id: 'UTV2-99040A',
      lane_type: 'runtime',
    }),
  ];
  const ranked = rankDispatchCandidates(
    [
      {
        identifier: 'UTV2-99040',
        title: 'Runtime follow-up lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99040',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:runtime'],
      },
      {
        identifier: 'UTV2-99041',
        title: 'Modeling lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99041',
        has_acceptance_criteria: true,
        labels: ['tier:T2', 'lane:modeling'],
      },
      {
        identifier: 'UTV2-99042',
        title: 'Missing AC lane',
        tier: 'T2',
        recommended_executor: 'codex',
        url: 'https://linear.app/unit-talk/issue/UTV2-99042',
        has_acceptance_criteria: false,
        labels: ['tier:T2', 'lane:hygiene'],
      },
    ],
    {
      active_lanes: active,
      max_claude: 1,
      max_codex: 1,
      singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
      forbidden_combinations: [['runtime', 'modeling']],
    },
  );

  const plan = buildDispatchPlan(ranked, {
    active_lanes: active,
    max_claude: 1,
    max_codex: 1,
    singleton_lane_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
    forbidden_combinations: [['runtime', 'modeling']],
  });

  assert.deepStrictEqual(plan.fill_now, []);
  assert.deepStrictEqual(
    plan.blocked.map((entry) => [entry.identifier, entry.reason_codes]),
    [
      ['UTV2-99042', ['MISSING_ACCEPTANCE_CRITERIA', 'CAPACITY_FULL']],
      ['UTV2-99041', ['CAPACITY_FULL', 'FORBIDDEN_COMBINATION']],
      ['UTV2-99040', ['CAPACITY_FULL', 'SINGLETON_ACTIVE']],
    ],
  );
  assert.deepStrictEqual(plan.lane_saturation_forecast.active_singletons, ['runtime']);
});
