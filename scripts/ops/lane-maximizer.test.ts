import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CandidateLane,
  type LaneManifest,
  type LinearCandidateFetchDeps,
  type MaximizationReport,
  LINEAR_CANDIDATE_COMPLEXITY_BUDGET,
  LINEAR_CANDIDATE_MAX_NODES,
  LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE,
  LINEAR_CANDIDATE_NESTED_CONNECTIONS,
  LINEAR_CANDIDATE_PAGE_SIZE,
  LINEAR_CANDIDATE_QUERY,
  evaluateCandidates,
  fetchLinearCandidates,
  isPrerequisiteInverseRelation,
  isPrerequisiteOutgoingRelation,
  LINEAR_UNREADABLE_RELATIONS_SENTINEL,
  LINEAR_CANDIDATE_QUERY,
  linearCandidateMaxPages,
  parseQueueCandidates,
  hasTrackerSource,
  resolveCandidateSource,
  runMaximizerCli,
} from './lane-maximizer.js';
import { buildPnpmStateEnv } from './lane-start.js';
import { checkConcurrencyLimits, type ConcurrencyManifestLike } from './concurrency-rules.js';
import {
  CONFIG_FILE_PATH,
  clearConcurrencyConfigCache,
  type ConcurrencyConfig,
  type EffectiveConcurrencyConfig,
} from './concurrency-config.js';
import type { CanonicalLaneType, LaneManifest as SharedLaneManifest } from './shared.js';
import { resolveActiveLaneManifests } from './shared.js';
import { buildExecutionStateReport } from './execution-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANE_DIR = path.join(ROOT, 'docs', '06_status', 'lanes');

function makeManifest(
  issueId: string,
  overrides: Partial<LaneManifest> = {},
): LaneManifest {
  return {
    schema_version: 1,
    issue_id: issueId,
    lane_type: 'runtime',
    executor: 'codex-cli',
    tier: 'T2',
    branch: `codex/${issueId.toLowerCase()}-lane`,
    base_branch: 'main',
    status: 'started',
    file_scope_lock: ['scripts/ops/example.ts'],
    blocked_by: [],
    commit_sha: null,
    pr_url: null,
    ...overrides,
  };
}

function makeCandidate(
  issueId: string,
  overrides: Partial<CandidateLane> = {},
): CandidateLane {
  return {
    issue_id: issueId,
    tier: 'T2',
    executor: 'codex-cli',
    file_scope: ['scripts/ops/example.ts'],
    blocked_by: [],
    ...overrides,
  };
}

function writeManifest(manifest: LaneManifest): string {
  const filePath = path.join(LANE_DIR, `${manifest.issue_id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return filePath;
}

function withTempManifests(manifests: LaneManifest[], run: () => void): void {
  const created = manifests.map(writeManifest);
  try {
    run();
  } finally {
    for (const filePath of created) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function withTempFile(contents: string, run: (filePath: string) => void): void {
  const filePath = path.join(
    fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'lane-maximizer-')),
    'queue.md',
  );
  fs.writeFileSync(filePath, contents, 'utf8');
  try {
    run(filePath);
  } finally {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  }
}

function findDecisionIssueIds(
  report: ReturnType<typeof evaluateCandidates>,
  bucket: keyof Pick<ReturnType<typeof evaluateCandidates>, 'recommended' | 'blocked' | 'risky' | 'deferred'>,
): string[] {
  return report[bucket].map((entry) => entry.issue_id);
}

test('clean candidate with no overlaps is recommended', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96801', { file_scope: ['scripts/ops/clean-a.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96801']);
  assert.deepStrictEqual(report.recommended[0]?.reason_codes, []);
  assert.equal(
    report.dispatch_plan.fill_now[0]?.dispatch_command,
    'pnpm ops:lane-start UTV2-96801 --tier T2 --branch codex/utv2-96801-utv2-96801 --executor codex-cli --model-profile codex-terra-medium --lane-type hygiene --files scripts/ops/clean-a.ts',
  );
});

test('dispatch command includes lane-start required tier branch and file flags', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96801B', {
        title: 'Queue Intake Wave Builder',
        branch: 'codex/utv2-96801b-wave-builder',
        file_scope: ['scripts/ops/lane-maximizer.ts', 'scripts/ops/lane-maximizer.test.ts'],
        // Deliberately NOT equal to the candidate's own issue_id, to prove the
        // supplied value is carried through verbatim rather than defaulted.
        verification_target: 'UTV2-9999',
      }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.equal(
    report.dispatch_plan.fill_now[0]?.dispatch_command,
    'pnpm ops:lane-start UTV2-96801B --tier T2 --branch codex/utv2-96801b-wave-builder --executor codex-cli --model-profile codex-terra-medium --lane-type verification --verification-target UTV2-9999 --files scripts/ops/lane-maximizer.ts --files scripts/ops/lane-maximizer.test.ts',
  );
});

test('candidate without file scope is blocked before lane-start command is emitted', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96801M', { file_scope: [] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MISSING_FILE_SCOPE']);
  assert.deepStrictEqual(report.dispatch_plan.fill_now, []);
});

test('candidate with explicit missing acceptance criteria is blocked', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96801A', { has_acceptance_criteria: false, file_scope: ['scripts/ops/ac.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MISSING_ACCEPTANCE_CRITERIA']);
});

test('candidates are ranked before filling wave slots', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96801T3', { tier: 'T3', file_scope: ['scripts/ops/t3.ts'] }),
      makeCandidate('UTV2-96801T2', { tier: 'T2', file_scope: ['scripts/ops/t2.ts'] }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.dispatch_plan.fill_now.map((entry) => entry.issue_id), [
    'UTV2-96801T2',
    'UTV2-96801T3',
  ]);
  assert.equal(report.recommended[0]?.rank, 1);
});

test('queue intake parses ready issues into dispatchable candidates', () => {
  const queue = [
    '# Queue',
    '',
    '### UTV2-96818 — T2 Queue Intake Smoke',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **ID** | UTV2-96818 |',
    '| **Tier** | T2 |',
    '| **Lane** | `lane:codex` |',
    '| **Status** | **READY** |',
    '| **Blocked by** | — |',
    '| **Branch** | `codex/utv2-96818-queue-intake-smoke` |',
    '',
    'Acceptance criteria:',
    '- emits lane-start command',
    '',
    'Verification target: UTV2-96818',
    '',
    'Allowed file scope',
    '- scripts/ops/lane-maximizer.ts',
    '- scripts/ops/lane-maximizer.test.ts',
  ].join('\n');

  withTempFile(queue, (filePath) => {
    const candidates = parseQueueCandidates(filePath);
    const report = evaluateCandidates(candidates, [], { maxClaude: 1, maxCodex: 2 });

    assert.deepStrictEqual(candidates.map((candidate) => candidate.issue_id), ['UTV2-96818']);
    assert.deepStrictEqual(candidates[0]?.file_scope, [
      'scripts/ops/lane-maximizer.ts',
      'scripts/ops/lane-maximizer.test.ts',
    ]);
    assert.equal(candidates[0]?.verification_target, 'UTV2-96818');
    assert.equal(
      report.dispatch_plan.fill_now[0]?.dispatch_command,
      'pnpm ops:lane-start UTV2-96818 --tier T2 --branch codex/utv2-96818-queue-intake-smoke --executor codex-cli --model-profile codex-terra-medium --lane-type verification --verification-target UTV2-96818 --files scripts/ops/lane-maximizer.ts --files scripts/ops/lane-maximizer.test.ts',
    );
  });
});

test('queue intake parses file scope with a blank line after the heading (Linear markdown normalization)', () => {
  const queue = [
    '# Queue',
    '',
    '### UTV2-96819 — T2 Blank Line Heading Smoke',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **ID** | UTV2-96819 |',
    '| **Tier** | T2 |',
    '| **Lane** | `lane:codex` |',
    '| **Status** | **READY** |',
    '| **Blocked by** | — |',
    '| **Branch** | `codex/utv2-96819-blank-line-heading-smoke` |',
    '',
    'Acceptance criteria:',
    '- emits lane-start command',
    '',
    '## File Scope',
    '',
    '- scripts/ops/lane-maximizer.ts',
    '- scripts/ops/lane-maximizer.test.ts',
  ].join('\n');

  withTempFile(queue, (filePath) => {
    const candidates = parseQueueCandidates(filePath);

    assert.deepStrictEqual(candidates.map((candidate) => candidate.issue_id), ['UTV2-96819']);
    assert.deepStrictEqual(candidates[0]?.file_scope, [
      'scripts/ops/lane-maximizer.ts',
      'scripts/ops/lane-maximizer.test.ts',
    ]);
  });
});

test('scope-suggest CLI entrypoint runs when invoked through tsx', () => {
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      path.join(ROOT, 'scripts', 'ops', 'scope-suggest.ts'),
      '--description',
      'Fix dead CLI entrypoint for lane dispatch ops tooling',
      '--json',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), '');

  const parsed = JSON.parse(result.stdout) as {
    source: string;
    keyword_paths: string[];
    suggested_files: string[];
  };
  assert.equal(parsed.source, 'cli');
  assert.deepStrictEqual(parsed.keyword_paths, ['scripts/ops/']);
  assert.deepStrictEqual(parsed.suggested_files, ['scripts/ops/']);
});

test('candidate whose blocked_by is not done is blocked with BLOCKED_DEP', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96802', { blocked_by: ['UTV2-96899'], file_scope: ['scripts/ops/dep.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'blocked'), ['UTV2-96802']);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['BLOCKED_DEP']);
});

test('candidate whose blocked_by is done is not blocked on BLOCKED_DEP', () => {
  withTempManifests([makeManifest('UTV2-96803D', { status: 'done' })], () => {
    const report = evaluateCandidates(
      [makeCandidate('UTV2-96803', { blocked_by: ['UTV2-96803D'], file_scope: ['scripts/ops/dep-done.ts'] })],
      [],
      { maxClaude: 1, maxCodex: 2 },
    );

    assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96803']);
    assert.strictEqual(report.blocked.length, 0);
  });
});

test('generic Linear related links are not treated as blocking dependencies', () => {
  // UTV2-1820: direction lives in the connection, not the type string. The
  // same "blocks" edge appears on BOTH ends, so the outgoing copy must not be
  // read as a prerequisite.
  assert.equal(isPrerequisiteInverseRelation('related'), false);
  assert.equal(isPrerequisiteInverseRelation('blocked_by'), true);
  assert.equal(isPrerequisiteInverseRelation('blocks'), true);
  assert.equal(isPrerequisiteOutgoingRelation('related'), false);
  assert.equal(isPrerequisiteOutgoingRelation('blocks'), false);
  assert.equal(isPrerequisiteOutgoingRelation('blocked_by'), true);
});

test('file scope overlap with active lane is blocked with OVERLAP', () => {
  const activeLanes = [makeManifest('UTV2-96804A', { file_scope_lock: ['scripts/ops/shared-lock'] })];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96804', { file_scope: ['scripts/ops/shared-lock/task.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['OVERLAP']);
});

test('disjoint scopes do not overlap', () => {
  const activeLanes = [makeManifest('UTV2-96805A', { file_scope_lock: ['scripts/ops/active-a.ts'] })];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96805', { file_scope: ['scripts/ops/active-b.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96805']);
});

test('T1 candidate is deferred with T1_REQUIRES_PM', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96806', { tier: 'T1', file_scope: ['scripts/ops/t1.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.deferred[0]?.reason_codes, ['T1_REQUIRES_PM']);
});

test('migration path is blocked with MIGRATION_PATH', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96807', { file_scope: ['supabase/migrations/20260516_add_lane.sql'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MIGRATION_PATH']);
});

test('tier C path is risky with TIER_C_PATH', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96808', { file_scope: ['apps/api/src/recommend-only.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.risky[0]?.reason_codes, ['TIER_C_PATH']);
});

test('package-touching lane may be recommended while an unrelated lane is active', () => {
  const activeLanes = [makeManifest('UTV2-96808A', { file_scope_lock: ['scripts/ops/active.ts'] })];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96808P', {
        lane_type: 'hygiene',
        file_scope: ['packages/config/src/env.ts'],
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked, []);
  assert.deepStrictEqual(report.risky[0]?.reason_codes, ['TIER_C_PATH']);
});

test('package-touching lane may run in parallel after isolated install is proven green', () => {
  const activeLanes = [makeManifest('UTV2-96808B', { file_scope_lock: ['scripts/ops/active.ts'] })];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96808V', {
        file_scope: ['packages/config/src/env.ts'],
        isolated_install_verified: true,
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.risky[0]?.reason_codes, ['TIER_C_PATH']);
});

test('lane-start pnpm env isolates state without overriding the shared pnpm store', () => {
  withTempFile('', (filePath) => {
    const laneCwd = path.dirname(filePath);
    const env = buildPnpmStateEnv(laneCwd);

    assert.equal(env.NPM_CONFIG_STORE_DIR, process.env.NPM_CONFIG_STORE_DIR);
    assert.equal(env.npm_config_store_dir, process.env.npm_config_store_dir);
    assert.match(env.PNPM_HOME ?? '', /\.out\/pnpm-state\/home$/);
    assert.match(env.NPM_CONFIG_CACHE ?? '', /\.out\/pnpm-state\/cache$/);
    assert.match(env.NPM_CONFIG_STATE_DIR ?? '', /\.out\/pnpm-state\/state$/);
    assert.ok(fs.existsSync(env.PNPM_HOME ?? ''));
    assert.ok(fs.existsSync(env.COREPACK_HOME ?? ''));
    assert.ok(fs.existsSync(env.NPM_CONFIG_CACHE ?? ''));
    assert.ok(fs.existsSync(env.NPM_CONFIG_STATE_DIR ?? ''));
  });
});

test('claude dispatch limit hit blocks with DISPATCH_LIMIT_CLAUDE', () => {
  const activeLanes = [makeManifest('UTV2-96809A', { executor: 'claude', file_scope_lock: ['scripts/ops/other.ts'] })];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96809', { executor: 'claude', file_scope: ['scripts/ops/claude.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DISPATCH_LIMIT_CLAUDE']);
});

test('codex dispatch limit hit blocks with DISPATCH_LIMIT_CODEX', () => {
  const activeLanes = [
    makeManifest('UTV2-96810A', { executor: 'codex-cli', file_scope_lock: ['scripts/ops/other-a.ts'] }),
    makeManifest('UTV2-96810B', { executor: 'codex-cli', file_scope_lock: ['scripts/ops/other-b.ts'] }),
  ];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96810', { executor: 'codex-cli', file_scope: ['scripts/ops/codex.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DISPATCH_LIMIT_CODEX']);
});

test('codex limit with one active codex does not block on limit', () => {
  const activeLanes = [makeManifest('UTV2-96811A', { executor: 'codex-cli', file_scope_lock: ['scripts/ops/other.ts'] })];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96811', { executor: 'codex-cli', file_scope: ['scripts/ops/free.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96811']);
});

test('dispatch_limits reports the correct active counts', () => {
  const activeLanes = [
    makeManifest('UTV2-96812A', { executor: 'claude' }),
    makeManifest('UTV2-96812B', { executor: 'codex-cli' }),
    makeManifest('UTV2-96812C', { executor: 'codex-cli' }),
  ];
  const report = evaluateCandidates([], activeLanes, { maxClaude: 1, maxCodex: 3 });

  assert.deepStrictEqual(report.dispatch_limits, {
    max_claude: 1,
    max_codex: 3,
    active_claude: 1,
    active_codex: 2,
    claude_available: false,
    codex_available: true,
  });
});

test('dispatch_plan fills available executor slots sequentially and forecasts remaining capacity', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96816C1', { executor: 'codex-cli', file_scope: ['scripts/ops/c1.ts'] }),
      makeCandidate('UTV2-96816C2', { executor: 'codex-cli', file_scope: ['scripts/ops/c2.ts'] }),
      makeCandidate('UTV2-96816C3', { executor: 'codex-cli', file_scope: ['scripts/ops/c3.ts'] }),
      makeCandidate('UTV2-96816CL', { executor: 'claude', file_scope: ['scripts/ops/claude-safe.ts'] }),
    ],
    [makeManifest('UTV2-96816A', { executor: 'codex-cli', file_scope_lock: ['scripts/ops/active.ts'] })],
    { maxClaude: 2, maxCodex: 3 },
    { doneIssueIds: new Set(), singletonLaneTypes: ['runtime'], forbiddenCombinations: [] },
  );

  assert.deepStrictEqual(report.dispatch_plan.fill_now.map((entry) => entry.issue_id), [
    'UTV2-96816C1',
    'UTV2-96816C2',
    'UTV2-96816CL',
  ]);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DISPATCH_LIMIT_CODEX']);
  assert.deepStrictEqual(report.dispatch_plan.lane_saturation_forecast.executors, {
    claude: { max: 2, active: 0, available_slots: 1 },
    codex: { max: 3, active: 1, available_slots: 0 },
  });
});

test('dispatch_plan explains singleton and forbidden-combination constraints', () => {
  const activeLanes = [
    makeManifest('UTV2-96817A', {
      lane_type: 'runtime',
      file_scope_lock: ['scripts/ops/runtime-active.ts'],
    }),
  ];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96817S', {
        lane_type: 'runtime',
        file_scope: ['scripts/ops/runtime-next.ts'],
      }),
      makeCandidate('UTV2-96817F', {
        lane_type: 'modeling',
        file_scope: ['scripts/ops/modeling-next.ts'],
      }),
      makeCandidate('UTV2-96817H', {
        lane_type: 'hygiene',
        file_scope: ['scripts/ops/hygiene-next.ts'],
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 4 },
    {
      doneIssueIds: new Set(),
      singletonLaneTypes: ['runtime', 'modeling'],
      forbiddenCombinations: [['runtime', 'modeling']],
    },
  );

  assert.deepStrictEqual(report.blocked.map((entry) => entry.reason_codes), [
    ['SINGLETON_ACTIVE'],
    ['FORBIDDEN_COMBINATION'],
  ]);
  assert.deepStrictEqual(report.dispatch_plan.fill_now.map((entry) => entry.issue_id), ['UTV2-96817H']);
  assert.deepStrictEqual(report.dispatch_plan.lane_saturation_forecast.active_singletons, ['runtime']);
});

test('multiple candidates with mixed outcomes appear in the correct buckets', () => {
  const activeLanes = [makeManifest('UTV2-96813A', { file_scope_lock: ['scripts/ops/locked'] })];
  withTempManifests([makeManifest('UTV2-96813D', { status: 'done' })], () => {
    const report = evaluateCandidates(
      [
        makeCandidate('UTV2-96813R', { file_scope: ['scripts/ops/recommended.ts'] }),
        makeCandidate('UTV2-96813B', { blocked_by: ['UTV2-96813X'], file_scope: ['scripts/ops/blocked.ts'] }),
        makeCandidate('UTV2-96813K', { file_scope: ['apps/worker/src/risky.ts'] }),
        makeCandidate('UTV2-96813F', { tier: 'T1', file_scope: ['scripts/ops/deferred.ts'] }),
        makeCandidate('UTV2-96813N', { blocked_by: ['UTV2-96813D'], file_scope: ['scripts/ops/also-recommended.ts'] }),
        makeCandidate('UTV2-96813O', { file_scope: ['scripts/ops/locked/file.ts'] }),
      ],
      activeLanes,
      { maxClaude: 2, maxCodex: 3 },
    );

    assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended').sort(), ['UTV2-96813N', 'UTV2-96813R']);
    assert.deepStrictEqual(findDecisionIssueIds(report, 'blocked').sort(), ['UTV2-96813B', 'UTV2-96813K', 'UTV2-96813O']);
    assert.deepStrictEqual(findDecisionIssueIds(report, 'risky'), []);
    assert.deepStrictEqual(findDecisionIssueIds(report, 'deferred'), ['UTV2-96813F']);
  });
});

test('priority checks BLOCKED_DEP before dispatch limit', () => {
  const activeLanes = [makeManifest('UTV2-96814A', { executor: 'claude' })];
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96814', { executor: 'claude', blocked_by: ['UTV2-96814X'], file_scope: ['scripts/ops/priority.ts'] })],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['BLOCKED_DEP']);
});

test('priority checks MIGRATION_PATH before TIER_C_PATH', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96815', { file_scope: ['packages/database/schema.generated.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MIGRATION_PATH']);
});

// UTV2-1533 lane-maximizer P2 fix: verification_target is never guessed from
// candidate.issue_id. These tests prove the explicit-target contract end to end.

test('UTV2-1533 P2: explicit verification_target appears unchanged in the dispatch command', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96820', {
        lane_type: 'verification',
        verification_target: 'UTV2-4242',
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96820']);
  assert.match(report.dispatch_plan.fill_now[0]?.dispatch_command ?? '', /--verification-target UTV2-4242\b/);
});

test('UTV2-1533 P2: missing verification_target blocks the candidate', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-96821', { lane_type: 'verification', file_scope: ['scripts/ops/verify-runner.ts'] })],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MISSING_VERIFICATION_TARGET']);
  assert.deepStrictEqual(report.dispatch_plan.fill_now, []);
});

test('UTV2-1533 P2: malformed verification_target blocks the candidate', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96822', {
        lane_type: 'verification',
        verification_target: 'not-an-issue-id',
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MALFORMED_VERIFICATION_TARGET']);
  assert.deepStrictEqual(report.dispatch_plan.fill_now, []);
});

test('UTV2-1533 P2: candidate is blocked when its target is already claimed by an active verification lane', () => {
  const activeLanes = [
    makeManifest('UTV2-96823A', { lane_type: 'verification', verification_target: 'UTV2-500' }),
  ];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96823', {
        lane_type: 'verification',
        verification_target: 'UTV2-500',
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['VERIFICATION_TARGET_ACTIVE']);
});

test('UTV2-1533 P2: candidate with a different target than an active verification lane is allowed', () => {
  const activeLanes = [
    makeManifest('UTV2-96824A', { lane_type: 'verification', verification_target: 'UTV2-500' }),
  ];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96824', {
        lane_type: 'verification',
        verification_target: 'UTV2-600',
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-96824']);
});

test('UTV2-1533 P2: an active verification lane with no trustworthy target fails closed for any incoming verification candidate', () => {
  const activeLanes = [
    // Legacy active verification lane predating the verification_target field --
    // undetermined, not merely absent-and-fine.
    makeManifest('UTV2-96825A', { lane_type: 'verification' }),
  ];
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96825', {
        lane_type: 'verification',
        verification_target: 'UTV2-900',
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    activeLanes,
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['VERIFICATION_TARGET_UNDETERMINED_CONFLICT']);
});

test('UTV2-1533 P2: two planned candidates for the same target are not both recommended', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96826A', {
        lane_type: 'verification',
        verification_target: 'UTV2-700',
        file_scope: ['scripts/ops/verify-runner-a.ts'],
      }),
      makeCandidate('UTV2-96826B', {
        lane_type: 'verification',
        verification_target: 'UTV2-700',
        file_scope: ['scripts/ops/verify-runner-b.ts'],
      }),
    ],
    [],
    { maxClaude: 2, maxCodex: 4 },
  );

  assert.equal(findDecisionIssueIds(report, 'recommended').length, 1);
  const blockedEntry = report.blocked.find((entry) => entry.reason_codes.includes('VERIFICATION_TARGET_ALREADY_PLANNED'));
  assert.ok(blockedEntry, 'expected exactly one candidate blocked as VERIFICATION_TARGET_ALREADY_PLANNED');
  assert.equal(report.dispatch_plan.fill_now.filter((entry) => entry.lane_type === 'verification').length, 1);
});

test('UTV2-1533 P2: candidate issue_id is never silently substituted as the verification target', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-96827', {
        lane_type: 'verification',
        // No verification_target supplied -- must not fall back to issue_id.
        file_scope: ['scripts/ops/verify-runner.ts'],
      }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), []);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MISSING_VERIFICATION_TARGET']);
  assert.ok(
    !report.dispatch_plan.fill_now.some((entry) => entry.dispatch_command.includes('--verification-target UTV2-96827')),
    'issue_id must never appear as a silently substituted --verification-target value',
  );
});

// ── Planning-accuracy follow-up: evaluateCandidates() forecasts the FULL
// active-plus-already-planned-this-wave state against the same type caps
// ops:lane-start's checkConcurrencyLimits() enforces (hygiene/governance maxima,
// delivery-ui per-app, verification per-target, trial governor, total cap), not just
// executor caps/singleton/forbidden-combination as before. PROD_POLICY below mirrors
// the real shipped docs/governance/CONCURRENCY_CONFIG.json numbers exactly (same
// fixture shape as concurrency-simulation.test.ts's own PROD_POLICY), passed via
// evaluateCandidates()'s `concurrencyConfig` option so these tests are deterministic
// and independent of whatever the live config file currently contains.

const PROD_POLICY: ConcurrencyConfig = {
  version: 3,
  total: 10,
  executors: { claude: 4, codex: 6 },
  merge_serialized_max: 1,
  singleton_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
  forbidden_combinations: [
    ['migration', 'runtime'],
    ['migration', 'migration'],
    ['migration', 'data-canonical'],
    ['runtime', 'runtime'],
    ['modeling', 'modeling'],
  ],
  type_caps: {
    hygiene: 4,
    governance: 3,
    'delivery-ui': { max_per_app: 1 },
    verification: { max_per_target: 1 },
  },
};

const PROD_LIMITS = { maxClaude: 4, maxCodex: 6 };

test('1. lane 11 is not recommended (over total cap)', () => {
  const active = [
    makeManifest('UTV2-Q01', { executor: 'claude', lane_type: 'runtime', file_scope_lock: ['apps/worker/src/a.ts'] }),
    makeManifest('UTV2-Q02', { executor: 'claude', lane_type: 'modeling', file_scope_lock: ['packages/domain/src/score.ts'] }),
    makeManifest('UTV2-Q03', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/a.md'] }),
    makeManifest('UTV2-Q04', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/b.md'] }),
    makeManifest('UTV2-Q05', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q05.ts'] }),
    makeManifest('UTV2-Q06', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q06.ts'] }),
    makeManifest('UTV2-Q07', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q07.ts'] }),
    makeManifest('UTV2-Q08', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q08.ts'] }),
    makeManifest('UTV2-Q09', { executor: 'codex-cli', lane_type: 'delivery-ui', file_scope_lock: ['apps/command-center/page.tsx'] }),
    {
      ...makeManifest('UTV2-Q10', { executor: 'codex-cli', lane_type: 'verification', file_scope_lock: ['apps/api/src/x.test.ts'] }),
      verification_target: 'UTV2-9001',
    },
  ];
  assert.equal(active.length, 10, 'fixture must have exactly 10 active lanes to be at the PROD_POLICY total cap');

  const report = evaluateCandidates(
    [makeCandidate('UTV2-Q11', { executor: 'codex-cli', lane_type: 'hygiene', file_scope: ['scripts/ops/q11.ts'] })],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), []);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['TOTAL_CAP_EXCEEDED']);
});

test('2. fifth Claude lane is not recommended', () => {
  const active = [
    makeManifest('UTV2-Q20', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/c.md'] }),
    makeManifest('UTV2-Q21', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/d.md'] }),
    makeManifest('UTV2-Q22', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/e.md'] }),
    makeManifest('UTV2-Q23', { executor: 'claude', lane_type: 'runtime', file_scope_lock: ['apps/worker/src/b.ts'] }),
  ];

  const report = evaluateCandidates(
    [makeCandidate('UTV2-Q24', { executor: 'claude', lane_type: 'hygiene', file_scope: ['scripts/ops/q24.ts'] })],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DISPATCH_LIMIT_CLAUDE']);
});

test('3. seventh Codex lane is not recommended', () => {
  const active = [
    makeManifest('UTV2-Q30', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q30.ts'] }),
    makeManifest('UTV2-Q31', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q31.ts'] }),
    makeManifest('UTV2-Q32', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q32.ts'] }),
    makeManifest('UTV2-Q33', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q33.ts'] }),
    makeManifest('UTV2-Q34', { executor: 'codex-cli', lane_type: 'delivery-ui', file_scope_lock: ['apps/command-center/page.tsx'] }),
    {
      ...makeManifest('UTV2-Q35', { executor: 'codex-cli', lane_type: 'verification', file_scope_lock: ['apps/api/src/y.test.ts'] }),
      verification_target: 'UTV2-9001',
    },
  ];

  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-Q36', {
        executor: 'codex-cli',
        lane_type: 'verification',
        verification_target: 'UTV2-9002',
        file_scope: ['scripts/ops/q36.test.ts'],
      }),
    ],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DISPATCH_LIMIT_CODEX']);
});

test('4. fifth Hygiene lane is not recommended (isolated: no other cap fires)', () => {
  const active = [
    makeManifest('UTV2-Q40', { executor: 'claude', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q40.ts'] }),
    makeManifest('UTV2-Q41', { executor: 'claude', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q41.ts'] }),
    makeManifest('UTV2-Q42', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q42.ts'] }),
    makeManifest('UTV2-Q43', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/q43.ts'] }),
  ];

  const report = evaluateCandidates(
    [makeCandidate('UTV2-Q44', { executor: 'claude', lane_type: 'hygiene', file_scope: ['scripts/ops/q44.ts'] })],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(
    report.blocked[0]?.reason_codes,
    ['HYGIENE_TYPE_CAP_EXCEEDED'],
    `Expected exactly HYGIENE_TYPE_CAP_EXCEEDED (isolated), got: ${JSON.stringify(report.blocked)}`,
  );
});

test('5. fourth Governance lane is not recommended (isolated: no other cap fires)', () => {
  const active = [
    makeManifest('UTV2-Q50', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/f.md'] }),
    makeManifest('UTV2-Q51', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/g.md'] }),
    makeManifest('UTV2-Q52', { executor: 'codex-cli', lane_type: 'governance', file_scope_lock: ['docs/gov/h.md'] }),
  ];

  const report = evaluateCandidates(
    [makeCandidate('UTV2-Q53', { executor: 'claude', lane_type: 'governance', file_scope: ['docs/gov/i.md'] })],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(
    report.blocked[0]?.reason_codes,
    ['GOVERNANCE_TYPE_CAP_EXCEEDED'],
    `Expected exactly GOVERNANCE_TYPE_CAP_EXCEEDED (isolated), got: ${JSON.stringify(report.blocked)}`,
  );
});

test('6. same-app Delivery/UI conflict with an active lane is blocked', () => {
  const active = [
    makeManifest('UTV2-Q60', { executor: 'claude', lane_type: 'delivery-ui', file_scope_lock: ['apps/command-center/src/app/page.tsx'] }),
  ];

  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-Q61', {
        executor: 'codex-cli',
        lane_type: 'delivery-ui',
        file_scope: ['apps/command-center/src/app/other.tsx'],
      }),
    ],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DELIVERY_UI_APP_ACTIVE']);
});

test('7. same-app Delivery/UI conflict with an earlier planned candidate (same wave) is blocked', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-Q70A', { executor: 'claude', lane_type: 'delivery-ui', file_scope: ['apps/command-center/src/app/a.tsx'] }),
      makeCandidate('UTV2-Q70B', { executor: 'codex-cli', lane_type: 'delivery-ui', file_scope: ['apps/command-center/src/app/b.tsx'] }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-Q70A']);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DELIVERY_UI_APP_ALREADY_PLANNED']);
  assert.equal(
    report.dispatch_plan.fill_now.filter((entry) => entry.lane_type === 'delivery-ui').length,
    1,
    'only the first same-app Delivery/UI candidate may be planned into fill_now',
  );
});

test('8. different Delivery/UI apps may both be planned', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-Q80A', { executor: 'claude', lane_type: 'delivery-ui', file_scope: ['apps/command-center/src/app/a.tsx'] }),
      makeCandidate('UTV2-Q80B', { executor: 'codex-cli', lane_type: 'delivery-ui', file_scope: ['apps/discord-bot/src/formatter.ts'] }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended').sort(), ['UTV2-Q80A', 'UTV2-Q80B']);
  assert.deepStrictEqual(report.blocked, []);
});

test('9. missing Delivery/UI app identity (undetermined from file_scope) fails closed', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-Q90', {
        executor: 'claude',
        lane_type: 'delivery-ui',
        // Spans two canonical app roots -- deriveDeliveryUiApp() returns null.
        file_scope: ['apps/command-center/src/app/page.tsx', 'apps/discord-bot/src/formatter.ts'],
      }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), []);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['DELIVERY_UI_APP_UNDETERMINED']);
});

test('10. same Verification target as an active lane is blocked', () => {
  const active = [
    {
      ...makeManifest('UTV2-QA0', { executor: 'claude', lane_type: 'verification', file_scope_lock: ['apps/api/src/z.test.ts'] }),
      verification_target: 'UTV2-9010',
    },
  ];

  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QA1', {
        executor: 'codex-cli',
        lane_type: 'verification',
        verification_target: 'UTV2-9010',
        file_scope: ['scripts/ops/qa1.test.ts'],
      }),
    ],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['VERIFICATION_TARGET_ACTIVE']);
});

test('11. same Verification target as an earlier planned candidate (same wave) is blocked', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QB0', {
        executor: 'claude',
        lane_type: 'verification',
        verification_target: 'UTV2-9020',
        file_scope: ['scripts/ops/qb0.test.ts'],
      }),
      makeCandidate('UTV2-QB1', {
        executor: 'codex-cli',
        lane_type: 'verification',
        verification_target: 'UTV2-9020',
        file_scope: ['scripts/ops/qb1.test.ts'],
      }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-QB0']);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['VERIFICATION_TARGET_ALREADY_PLANNED']);
});

test('12. different Verification targets may both be planned', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QC0', {
        executor: 'claude',
        lane_type: 'verification',
        verification_target: 'UTV2-9030',
        file_scope: ['scripts/ops/qc0.test.ts'],
      }),
      makeCandidate('UTV2-QC1', {
        executor: 'codex-cli',
        lane_type: 'verification',
        verification_target: 'UTV2-9031',
        file_scope: ['scripts/ops/qc1.test.ts'],
      }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended').sort(), ['UTV2-QC0', 'UTV2-QC1']);
  assert.deepStrictEqual(report.blocked, []);
});

test('13. missing Verification target is blocked', () => {
  const report = evaluateCandidates(
    [makeCandidate('UTV2-QD0', { executor: 'claude', lane_type: 'verification', file_scope: ['scripts/ops/qd0.test.ts'] })],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MISSING_VERIFICATION_TARGET']);
});

test('14. malformed Verification target is blocked', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QE0', {
        executor: 'claude',
        lane_type: 'verification',
        verification_target: 'not-a-real-target',
        file_scope: ['scripts/ops/qe0.test.ts'],
      }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['MALFORMED_VERIFICATION_TARGET']);
});

test('15. an active undetermined Verification target fails closed', () => {
  const active = [
    // Legacy active verification lane with no verification_target recorded at all.
    makeManifest('UTV2-QF0', { executor: 'claude', lane_type: 'verification', file_scope_lock: ['apps/api/src/legacy.test.ts'] }),
  ];

  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QF1', {
        executor: 'codex-cli',
        lane_type: 'verification',
        verification_target: 'UTV2-9040',
        file_scope: ['scripts/ops/qf1.test.ts'],
      }),
    ],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['VERIFICATION_TARGET_UNDETERMINED_CONFLICT']);
});

test('16. existing singleton behavior remains intact under PROD_POLICY (regression)', () => {
  const active = [
    makeManifest('UTV2-QG0', { executor: 'claude', lane_type: 'runtime', file_scope_lock: ['apps/worker/src/c.ts'] }),
  ];

  const report = evaluateCandidates(
    [makeCandidate('UTV2-QG1', { executor: 'codex-cli', lane_type: 'runtime', file_scope: ['apps/worker/src/d.ts'] })],
    active,
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['SINGLETON_ACTIVE']);
});

test('17. forbidden combinations remain intact across active plus planned lanes (regression + wave extension)', () => {
  // First candidate is lane_type:"migration" with a file scope that does NOT match
  // isMigrationPath()'s path pattern (so it clears the earlier MIGRATION_PATH gate) --
  // this proves the forbidden-combination check below is triggered purely by the
  // planned lane_type, sourced from this same wave, not by any active manifest.
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QH0', { executor: 'claude', lane_type: 'migration', file_scope: ['docs/migration-notes.md'] }),
      makeCandidate('UTV2-QH1', { executor: 'codex-cli', lane_type: 'runtime', file_scope: ['apps/worker/src/e.ts'] }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-QH0']);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['FORBIDDEN_COMBINATION']);
});

test('18. trial mode does not bypass type caps (adversarial: wide trial headroom, hygiene cap still fires)', () => {
  const active = [
    makeManifest('UTV2-QI0', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/qi0.ts'] }),
    makeManifest('UTV2-QI1', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/qi1.ts'] }),
    makeManifest('UTV2-QI2', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/qi2.ts'] }),
    makeManifest('UTV2-QI3', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/qi3.ts'] }),
  ];
  const trialWideOpen: EffectiveConcurrencyConfig = {
    ...PROD_POLICY,
    total: 14,
    executors: { claude: 5, codex: 9 },
    trial_active: true,
    trial_expires_at: null,
    base_total: 10,
    base_executors: { claude: 4, codex: 6 },
    trial_safe_types_only: ['governance', 'hygiene', 'delivery-ui', 'verification'],
  };

  const report = evaluateCandidates(
    [makeCandidate('UTV2-QI4', { executor: 'codex-cli', lane_type: 'hygiene', file_scope: ['scripts/ops/qi4.ts'] })],
    active,
    { maxClaude: 5, maxCodex: 9 },
    { concurrencyConfig: trialWideOpen },
  );

  assert.deepStrictEqual(
    findDecisionIssueIds(report, 'recommended'),
    [],
    'trial headroom (14 total / 9 codex) must not let a 5th hygiene lane through the hygiene type cap',
  );
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['HYGIENE_TYPE_CAP_EXCEEDED']);
});

test('19. dispatch commands use the exact validated Delivery/UI file scope (no silent substitution)', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-QJ0', {
        executor: 'claude',
        lane_type: 'delivery-ui',
        file_scope: ['apps/command-center/src/app/exact-path.tsx'],
      }),
    ],
    [],
    PROD_LIMITS,
    { concurrencyConfig: PROD_POLICY },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'recommended'), ['UTV2-QJ0']);
  assert.match(
    report.dispatch_plan.fill_now[0]?.dispatch_command ?? '',
    /--files apps\/command-center\/src\/app\/exact-path\.tsx\b/,
    'dispatch_command must carry the candidate\'s own declared file_scope verbatim -- the app identity is derived downstream by ops:lane-start from these exact files, never overridden here',
  );
  assert.deepStrictEqual(report.dispatch_plan.fill_now[0]?.file_scope, ['apps/command-center/src/app/exact-path.tsx']);
});

test('20. the recommended wave, replayed candidate-by-candidate through the canonical concurrency evaluator, produces zero violations', () => {
  const active = [
    makeManifest('UTV2-QK0', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/wave-active.md'] }),
  ];
  const candidates = [
    makeCandidate('UTV2-QK1', { executor: 'claude', lane_type: 'hygiene', file_scope: ['scripts/ops/wave-a.ts'] }),
    makeCandidate('UTV2-QK2', { executor: 'codex-cli', lane_type: 'hygiene', file_scope: ['scripts/ops/wave-b.ts'] }),
    makeCandidate('UTV2-QK3', { executor: 'codex-cli', lane_type: 'delivery-ui', file_scope: ['apps/command-center/src/app/wave.tsx'] }),
    makeCandidate('UTV2-QK4', {
      executor: 'codex-cli',
      lane_type: 'verification',
      verification_target: 'UTV2-9050',
      file_scope: ['scripts/ops/wave-c.test.ts'],
    }),
    makeCandidate('UTV2-QK5', { executor: 'claude', lane_type: 'governance', file_scope: ['docs/gov/wave-planned.md'] }),
  ];

  const report = evaluateCandidates(candidates, active, PROD_LIMITS, { concurrencyConfig: PROD_POLICY });

  assert.deepStrictEqual(
    findDecisionIssueIds(report, 'recommended').sort(),
    ['UTV2-QK1', 'UTV2-QK2', 'UTV2-QK3', 'UTV2-QK4', 'UTV2-QK5'],
    'every candidate in this fixture is expected to clear every cap and be recommended',
  );
  assert.equal(report.dispatch_plan.fill_now.length, 5);

  // Replay: feed the planner's own recommended wave, in the order it planned them,
  // through checkConcurrencyLimits() one lane at a time -- exactly what would happen if
  // an operator ran each fill_now.dispatch_command against ops:lane-start in sequence.
  // A growing "replay board" starts as the real active manifests and gains one
  // synthetic active entry per accepted lane, mirroring how ops:lane-start would leave
  // the board after each real lane-start call.
  const replayBoard: ConcurrencyManifestLike[] = active.map((manifest) => ({
    issue_id: manifest.issue_id,
    lane_type: manifest.lane_type,
    executor: manifest.executor,
    status: manifest.status,
    file_scope_lock: manifest.file_scope_lock,
    verification_target: manifest.verification_target,
  }));

  for (const entry of report.dispatch_plan.fill_now) {
    const candidate = candidates.find((c) => c.issue_id === entry.issue_id);
    assert.ok(candidate, `expected a source candidate for planned entry ${entry.issue_id}`);
    const violations = checkConcurrencyLimits(
      replayBoard,
      entry.lane_type as CanonicalLaneType,
      entry.executor,
      PROD_POLICY,
      {
        fileScopeLock: entry.file_scope,
        verificationTarget: entry.lane_type === 'verification' ? candidate!.verification_target : undefined,
      },
    );
    assert.deepStrictEqual(
      violations,
      [],
      `expected zero violations replaying planned lane ${entry.issue_id} (${entry.lane_type}), got: ${JSON.stringify(violations)}`,
    );
    replayBoard.push({
      issue_id: entry.issue_id,
      lane_type: entry.lane_type,
      executor: entry.executor,
      status: 'in_progress',
      file_scope_lock: entry.file_scope,
      verification_target: entry.lane_type === 'verification' ? candidate!.verification_target : undefined,
    });
  }
});

// Codex review fix (PR #1220): when the real CONCURRENCY_CONFIG.json sets a hard
// `total` cap below the sum of the executor caps, the synthesized default policy
// must respect the smaller configured total, not silently widen it to
// maxClaude + maxCodex -- otherwise this planner could recommend a lane in the gap
// that ops:lane-start's checkConcurrencyLimits() (which enforces cfg.total directly)
// would then reject.

function withTempConcurrencyConfig(overrides: Partial<ConcurrencyConfig>, run: () => void): void {
  const original = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
  const parsed = JSON.parse(original) as ConcurrencyConfig;
  const patched: ConcurrencyConfig = { ...parsed, ...overrides };
  fs.writeFileSync(CONFIG_FILE_PATH, `${JSON.stringify(patched, null, 2)}\n`, 'utf8');
  clearConcurrencyConfigCache();
  try {
    run();
  } finally {
    fs.writeFileSync(CONFIG_FILE_PATH, original, 'utf8');
    clearConcurrencyConfigCache();
  }
}

test('21. synthesized policy clamps total to the configured total, not maxClaude + maxCodex, when config total is smaller', () => {
  withTempConcurrencyConfig(
    {
      total: 5, // deliberately below executors.claude(4) + executors.codex(4) = 8
      executors: { claude: 4, codex: 4 },
    },
    () => {
      // 5 active lanes -- exactly at the configured (smaller) total cap of 5, but
      // well under the executor-sum-derived 8 this bug would have used instead.
      const active = [
        makeManifest('UTV2-QL0', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/ql0.md'] }),
        makeManifest('UTV2-QL1', { executor: 'claude', lane_type: 'governance', file_scope_lock: ['docs/gov/ql1.md'] }),
        makeManifest('UTV2-QL2', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/ql2.ts'] }),
        makeManifest('UTV2-QL3', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/ql3.ts'] }),
        makeManifest('UTV2-QL4', { executor: 'codex-cli', lane_type: 'hygiene', file_scope_lock: ['scripts/ops/ql4.ts'] }),
      ];

      const report = evaluateCandidates(
        [makeCandidate('UTV2-QL5', { executor: 'claude', lane_type: 'governance', file_scope: ['docs/gov/ql5.md'] })],
        active,
        { maxClaude: 4, maxCodex: 4 },
        // Deliberately NOT passing concurrencyConfig -- this exercises the default
        // synthesis path (the one with the bug), reading the real (temporarily
        // patched) CONCURRENCY_CONFIG.json via the module's own cfg loader.
      );

      assert.deepStrictEqual(
        findDecisionIssueIds(report, 'recommended'),
        [],
        'a 6th lane must not be recommended once the configured total cap of 5 is reached, even though executors.claude+executors.codex=8 is not',
      );
      assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['TOTAL_CAP_EXCEEDED']);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1699 — discovery repair regressions.
//
// Every test below names the exact control it proves and the mutation that must
// break it. See docs/06_status/proof/UTV2-1699/verification.md for the executed
// mutation matrix.
// ─────────────────────────────────────────────────────────────────────────────

function candidateIssueNode(
  identifier: string,
  overrides: Partial<{ title: string; labels: string[]; fileScope: string }> = {},
): Record<string, unknown> {
  const fileScope = overrides.fileScope ?? `scripts/ops/${identifier.toLowerCase()}-fixture.ts`;
  return {
    identifier,
    title: overrides.title ?? `${identifier} discovery fixture`,
    url: `https://linear.app/unit-talk-v2/issue/${identifier}`,
    description: [
      'Acceptance criteria',
      '',
      '- the fixture is discovered',
      '',
      'File scope',
      '',
      `- \`${fileScope}\``,
      '',
    ].join('\n'),
    branchName: null,
    labels: { nodes: (overrides.labels ?? ['T2', 'lane:hygiene']).map((name) => ({ name })) },
    state: { name: 'Ready', type: 'unstarted' },
    relations: { nodes: [] },
    // UTV2-1820: the real query now asks for `inverseRelations`, so a faithful
    // fixture returns it. An ABSENT set is not "no prerequisites" -- it is an
    // unreadable one, and is deliberately blocked; that path has its own test.
    inverseRelations: { nodes: [] },
  };
}

/**
 * Fake Linear transport. `pages` is the candidate-issue population split into
 * pages exactly as Linear would return them; `failOnPage` injects a transport
 * failure on that 1-based candidate page.
 */
interface FakeLinearDeps extends LinearCandidateFetchDeps {
  /** Every `cursor` variable the implementation actually sent, in order. */
  cursorsSent: Array<string | null>;
  /** Every candidate-query document the implementation actually sent. */
  candidateQueries: string[];
  /** Every `first` variable the implementation actually sent, in order. */
  limitsSent: Array<unknown>;
}

/**
 * UTV2-1699 (PM defect 2 repair). This fake is CURSOR-DRIVEN, not
 * counter-driven. The earlier version served page N on the Nth call regardless
 * of the `cursor` variable it received, so deleting `after: $cursor` from the
 * query -- or deleting `cursor = connection.pageInfo.endCursor` from the walk --
 * still produced all three pages and left the pagination test green. That made
 * the AC2 proof vacuous: it proved the fake counts, not that the implementation
 * paginates.
 *
 * Here page 1 is served ONLY for cursor `null`, and page N (N>1) ONLY for the
 * exact `endCursor` page N-1 handed back. A request bearing any other cursor is
 * a hard error, so a walk that fails to send or fails to advance the cursor
 * cannot reach page 2 at all.
 */
function fakeLinearDeps(
  pages: Array<Array<Record<string, unknown>>>,
  options: { failOnPage?: number; failTeamResolve?: boolean } = {},
): FakeLinearDeps {
  const cursorsSent: Array<string | null> = [];
  const candidateQueries: string[] = [];
  // UTV2-1819: the `first:` actually put on the wire, so a page size over
  // Linear's complexity budget is caught here instead of in production.
  const limitsSent: Array<unknown> = [];
  // cursor value -> zero-based index of the page it unlocks.
  const pageForCursor = new Map<string, number>([['', 0]]);
  for (let index = 1; index < pages.length; index += 1) {
    pageForCursor.set(`cursor-${index}`, index);
  }

  const query = async (
    graphql: string,
    variables: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
    if (graphql.includes('ResolveTeam')) {
      if (options.failTeamResolve) {
        return { ok: false, error: 'Linear HTTP 401 Unauthorized' };
      }
      return { ok: true, data: { teams: { nodes: [{ id: 'team-fixture', key: 'UTV2' }] } } };
    }

    candidateQueries.push(graphql);
    limitsSent.push(variables.limit);
    const rawCursor = variables.cursor;
    const cursor = typeof rawCursor === 'string' ? rawCursor : null;
    cursorsSent.push(cursor);

    const pageIndex = pageForCursor.get(cursor ?? '');
    if (pageIndex === undefined) {
      return {
        ok: false,
        error: `Linear fixture received an unknown cursor ${JSON.stringify(rawCursor)}; ` +
          'the walk did not advance `after: $cursor` from the previous page\'s endCursor',
      };
    }

    if (options.failOnPage === pageIndex + 1) {
      return { ok: false, error: 'Linear HTTP 503 Service Unavailable' };
    }

    return {
      ok: true,
      data: {
        team: {
          issues: {
            pageInfo: {
              hasNextPage: pageIndex + 1 < pages.length,
              endCursor: `cursor-${pageIndex + 1}`,
            },
            nodes: pages[pageIndex] ?? [],
          },
        },
      },
    };
  };

  return {
    token: 'fixture-token',
    query: query as LinearCandidateFetchDeps['query'],
    cursorsSent,
    candidateQueries,
    limitsSent,
  };
}

/** An authoritatively-known, genuinely empty active board. */
const EMPTY_ACTIVE_BOARD = {
  listOpenPullRequests: () => [],
  readLocalManifests: () => [],
};

function allResults(report: MaximizationReport) {
  return [...report.recommended, ...report.blocked, ...report.risky, ...report.deferred];
}

// AC1 / Defect 0. Mutation: restore `else -> parseCandidatesArg(argv)`.
test('UTV2-1699 AC1: a bare invocation queries the canonical Linear candidate source', async () => {
  // Asserted FIRST and separately: under the pre-repair fallthrough,
  // parseCandidatesArg() does a blocking read of fd 0, so a test that only
  // observed the resulting empty board would hang rather than fail. The source
  // selection is the control, so it is checked directly.
  //
  // UTV2-1837: the tracker-credential argument is passed EXPLICITLY here. It
  // defaults to probing the environment, so leaving it implicit would make this
  // assertion depend on whether the machine running the tests happens to have a
  // credential configured -- passing locally and flipping to 'queue' in CI.
  assert.equal(
    resolveCandidateSource([], true),
    'linear',
    'a bare argv must select the canonical Linear candidate source, never an argv/stdin parse',
  );
  assert.equal(resolveCandidateSource(['--from-queue'], true), 'queue');
  assert.equal(resolveCandidateSource(['--candidates', '[]'], true), 'explicit');
  assert.equal(resolveCandidateSource(['--from-linear'], true), 'linear');

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9001')]]),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  assert.equal(
    outcome.candidate_source,
    'linear',
    'a bare argv must resolve to the canonical Linear candidate source, not an argv/stdin parse',
  );
  const report = outcome.report;
  assert.ok(report, 'a successful bare invocation must produce a report');
  assert.deepStrictEqual(
    allResults(report).map((entry) => entry.issue_id),
    ['UTV2-9001'],
    'with eligible candidates present, a bare invocation must NOT return an empty board',
  );
  assert.notDeepStrictEqual(
    { recommended: report.recommended, blocked: report.blocked, risky: report.risky, deferred: report.deferred },
    { recommended: [], blocked: [], risky: [], deferred: [] },
  );
});

// AC2 / Defect 3. Mutation: restore the single-page `first: 10` query.
test('UTV2-1699 AC2: candidate discovery paginates past the first page', async () => {
  const linear = fakeLinearDeps([
    [candidateIssueNode('UTV2-9101')],
    [candidateIssueNode('UTV2-9102')],
    [candidateIssueNode('UTV2-9103')],
  ]);
  const outcome = await runMaximizerCli([], {
    linear,
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const discovered = allResults(outcome.report!).map((entry) => entry.issue_id).sort();
  assert.deepStrictEqual(
    discovered,
    ['UTV2-9101', 'UTV2-9102', 'UTV2-9103'],
    'candidates on pages 2 and 3 must be discovered; the population is not capped at the first page',
  );

  // The pagination MECHANISM, asserted directly -- not inferred from the fake's
  // call count. Removing `after: $cursor` or the `cursor = endCursor`
  // advancement must fail here even if the fake still had pages to give.
  assert.deepStrictEqual(
    linear.cursorsSent,
    [null, 'cursor-1', 'cursor-2'],
    'the walk must send no cursor for page 1 and then each page\'s endCursor verbatim',
  );
  assert.equal(
    linear.candidateQueries.length,
    3,
    'exactly one candidate query per page must be issued',
  );
  for (const graphql of linear.candidateQueries) {
    assert.match(
      graphql,
      /after:\s*\$cursor/,
      'the candidate query must pass the cursor through `after: $cursor`',
    );
    assert.match(
      graphql,
      /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/,
      'the candidate query must request the pageInfo the walk advances on',
    );
    assert.match(
      graphql,
      /orderBy:\s*createdAt/,
      'the walk must order by the immutable createdAt: an issue whose updatedAt changes mid-walk ' +
        'can move behind an already-consumed cursor and be silently skipped',
    );
  }
});

// AC2 supporting control (PM defect 2). The fake refuses any cursor it did not
// itself hand back, so a walk that does not advance cannot reach page 2. This
// test states that contract explicitly so the guarantee is visible, not
// incidental.
test('UTV2-1699 AC2: a walk that does not advance the cursor fails closed', async () => {
  const linear = fakeLinearDeps([
    [candidateIssueNode('UTV2-9121')],
    [candidateIssueNode('UTV2-9122')],
  ]);
  const query = linear.query!;
  const stuck = (async (graphql: string, variables: Record<string, unknown>, opts: unknown) =>
    query(
      graphql,
      graphql.includes('ResolveTeam') ? variables : { ...variables, cursor: null },
      opts as never,
    )) as LinearCandidateFetchDeps['query'];

  const outcome = await runMaximizerCli([], {
    linear: { ...linear, query: stuck },
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(
    outcome.exitCode,
    1,
    'a walk pinned to the first cursor must fail, never silently re-serve page 1 forever',
  );
  assert.equal(outcome.error?.code, 'candidate_discovery_failed');
});

// AC2 supporting control: a page boundary that cannot be walked is a failure,
// never a smaller candidate population.
test('UTV2-1699 AC2: a truncated page walk fails closed instead of returning a partial population', async () => {
  const outcome = await runMaximizerCli([], {
    linear: {
      token: 'fixture-token',
      query: (async (graphql: string) => {
        if (graphql.includes('ResolveTeam')) {
          return { ok: true, data: { teams: { nodes: [{ id: 'team-fixture', key: 'UTV2' }] } } };
        }
        return {
          ok: true,
          data: {
            team: {
              issues: {
                pageInfo: { hasNextPage: true, endCursor: null },
                nodes: [candidateIssueNode('UTV2-9111')],
              },
            },
          },
        };
      }) as LinearCandidateFetchDeps['query'],
    },
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.error?.code, 'candidate_discovery_failed');
});

// AC3 / Defect 1. Mutation: restore the catch that empties both populations.
test('UTV2-1699 AC3: candidate-source failure exits non-zero with a candidate-discovery code', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9201')]], { failOnPage: 1 }),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 1, 'a candidate-source failure must never exit 0');
  assert.equal(outcome.error?.code, 'candidate_discovery_failed');
  assert.match(outcome.error!.message, /candidate source/i);

  // Requirement 7: stdout must be unambiguously an error to a machine consumer,
  // not a report with empty arrays.
  const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, true);
  assert.equal(parsed.code, 'candidate_discovery_failed');
  assert.equal(parsed.recommended, undefined, 'a failure payload must not carry report-shaped empty arrays');
  assert.equal(parsed.blocked, undefined);
  assert.equal(parsed.dispatch_limits, undefined);
  assert.equal(outcome.report, undefined);
});

// AC3 supporting control: an auth failure on the team resolve is the same class.
test('UTV2-1699 AC3: a Linear auth failure fails closed as candidate discovery', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]], { failTeamResolve: true }),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.error?.code, 'candidate_discovery_failed');
});

// AC4 / Defect 1. Mutation: restore the catch that empties both populations.
test('UTV2-1699 AC4: active-lane discovery failure exits non-zero with a DISTINCT code', async () => {
  const candidateFailure = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]], { failOnPage: 1 }),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  const activeFailure = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9301')]]),
    activeLaneDiscovery: {
      listOpenPullRequests: () => {
        throw new Error('gh: could not authenticate to github.com');
      },
      readLocalManifests: () => [],
    },
  });

  assert.equal(activeFailure.exitCode, 1, 'an unknown active board must never exit 0');
  assert.equal(activeFailure.error?.code, 'active_lane_discovery_failed');
  assert.notEqual(
    activeFailure.error!.code,
    candidateFailure.error!.code,
    'active-lane discovery failure must not collapse into the candidate-discovery code',
  );
  assert.notEqual(
    activeFailure.error!.remediation,
    candidateFailure.error!.remediation,
    'the two fail-closed conditions must carry different remediations',
  );
  assert.match(activeFailure.error!.remediation, /gh/);

  const parsed = JSON.parse(activeFailure.stdout) as Record<string, unknown>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.dispatch_limits, undefined);
  assert.equal(parsed.recommended, undefined);
});

// AC4 supporting control / requirement 8: a partial manifest read is a failure.
test('UTV2-1699 AC4: an unreadable lane manifest is a failure, not a smaller board', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]]),
    activeLaneDiscovery: {
      listOpenPullRequests: () => [],
      readLocalManifests: () => {
        throw new Error('Unexpected token } in JSON at position 12');
      },
    },
  });

  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.error?.code, 'active_lane_discovery_failed');
});

// AC5. This is what stops the repair becoming "always fail".
test('UTV2-1699 AC5: a genuinely empty candidate population still exits 0', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]]),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  assert.equal(outcome.error, undefined);
  const report = outcome.report;
  assert.ok(report, 'an honestly empty board is still a report');
  assert.deepStrictEqual(report.recommended, []);
  assert.deepStrictEqual(report.blocked, []);
  assert.deepStrictEqual(report.risky, []);
  assert.deepStrictEqual(report.deferred, []);
  const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
  assert.ok(parsed.dispatch_limits, 'a real report carries dispatch_limits; an error envelope does not');
  assert.equal(parsed.ok, undefined);
});

// AC6 / Defect 2. Mutation: revert to the local-manifest-only readActiveLanes.
test('UTV2-1699 AC6: a PR-head-only lane manifest is counted as active', async () => {
  const prHeadOnly = makeManifest('UTV2-9601', {
    status: 'in_progress',
    executor: 'codex-cli',
    lane_type: 'hygiene',
    branch: 'codex/utv2-9601-pr-head-only',
    file_scope_lock: ['scripts/ops/utv2-9601-pr-head-only.ts'],
  });

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[
      candidateIssueNode('UTV2-9602', { fileScope: 'scripts/ops/utv2-9601-pr-head-only.ts' }),
    ]]),
    activeLaneDiscovery: {
      // Deliberately empty: the manifest does NOT exist in the local tree, which
      // is the measured production condition (zero active manifests on `main`).
      readLocalManifests: () => [],
      listOpenPullRequests: () => [
        { number: 9601, headRefName: 'codex/utv2-9601-pr-head-only' },
      ],
      readManifestAtRef: (issueId: string) =>
        (issueId === 'UTV2-9601' ? (prHeadOnly as unknown as SharedLaneManifest) : null),
    },
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const report = outcome.report!;
  assert.equal(
    report.dispatch_limits.active_codex,
    1,
    'a lane whose manifest exists only on its open PR head must count against capacity',
  );
  assert.deepStrictEqual(
    report.blocked.map((entry) => ({ id: entry.issue_id, codes: entry.reason_codes })),
    [{ id: 'UTV2-9602', codes: ['OVERLAP'] }],
    'a candidate overlapping a PR-head-only active lane must be blocked on OVERLAP',
  );
  assert.deepStrictEqual(report.recommended, []);
});

// AC8. Business ranking policy is OUT OF SCOPE for this lane. These are the
// literal ranking_score / ranking_reasons values produced by the unmodified
// scoreCandidate/rankCandidates for a fixed candidate set.
test('UTV2-1699 AC8: ranking output is unchanged for a fixed candidate set', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-RANK-A', {
        tier: 'T2',
        lane_type: 'hygiene',
        file_scope: ['scripts/ops/rank-a.ts'],
        has_acceptance_criteria: true,
      }),
      makeCandidate('UTV2-RANK-B', {
        tier: 'T3',
        lane_type: 'hygiene',
        file_scope: [],
        has_acceptance_criteria: false,
      }),
      makeCandidate('UTV2-RANK-C', {
        tier: 'T1',
        file_scope: ['packages/domain/src/rank-c.ts'],
      }),
    ],
    [],
    { maxClaude: 2, maxCodex: 4 },
    { doneIssueIds: new Set<string>(), singletonLaneTypes: [], forbiddenCombinations: [] },
  );

  const ranking = allResults(report)
    .map((entry) => ({
      issue_id: entry.issue_id,
      rank: entry.rank,
      ranking_score: entry.ranking_score,
      ranking_reasons: entry.ranking_reasons,
    }))
    .sort((left, right) => left.issue_id.localeCompare(right.issue_id));

  assert.deepStrictEqual(ranking, [
    {
      issue_id: 'UTV2-RANK-A',
      rank: 1,
      ranking_score: 80,
      ranking_reasons: [
        'tier:T2 dispatchable default',
        'file scope declared',
        'acceptance criteria present',
        'safe work class',
      ],
    },
    {
      issue_id: 'UTV2-RANK-B',
      rank: 3,
      ranking_score: -25,
      ranking_reasons: [
        'tier:T3 lower urgency',
        'file scope missing',
        'acceptance criteria missing',
        'safe work class',
      ],
    },
    {
      issue_id: 'UTV2-RANK-C',
      rank: 2,
      ranking_score: 45,
      ranking_reasons: [
        'tier:T1 requires PM authorization',
        'file scope declared',
        'safe work class',
      ],
    },
  ]);
});


// ---------------------------------------------------------------------------
// UTV2-1699 F1: capacity classification of the discovered population.
//
// `activeLanes` is the ACTIVE_LOCK_STATUSES population -- the set that holds a
// file-scope LOCK. It is deliberately WIDER than the set that consumes an
// executor slot (EXECUTOR_CAPACITY_STATUSES) or a lane slot
// (TOTAL_CAPACITY_STATUSES). Counting the lock population straight into
// executor counts, singleton forecasts and forbidden-combination forecasts
// manufactures phantom occupancy out of parked and in-review lanes. The
// classification comes from `classifyLaneCapacity` in shared.ts -- the same
// function `ops:execution-state` uses -- never from a local rule.
// ---------------------------------------------------------------------------

function discoveryOf(manifests: LaneManifest[]) {
  return {
    // `expected_proof_paths` is present on every real manifest; the local
    // fixture helper predates it, and ops:execution-state reads it directly.
    readLocalManifests: () =>
      manifests.map((manifest) => ({
        expected_proof_paths: [] as string[],
        ...manifest,
      })) as unknown as SharedLaneManifest[],
    listOpenPullRequests: () => [],
  };
}

// F1 regression 1. Mutation: count raw ACTIVE_LOCK_STATUSES lanes.
test('UTV2-1699 F1: an in_progress lane consumes executor capacity', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]]),
    activeLaneDiscovery: discoveryOf([
      makeManifest('UTV2-9711', {
        status: 'in_progress',
        executor: 'claude',
        lane_type: 'hygiene',
        branch: 'claude/utv2-9711-active',
      }),
    ]),
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const report = outcome.report!;
  assert.equal(report.dispatch_limits.active_claude, 1, 'an in_progress lane must consume an executor slot');
  assert.equal(
    report.dispatch_plan.lane_saturation_forecast.executors.claude.active,
    1,
    'the saturation forecast must report the same occupancy as dispatch_limits',
  );
  assert.deepStrictEqual(
    report.dispatch_plan.lane_saturation_forecast.visible_uncounted_lanes,
    [],
    'a capacity-consuming lane is not an uncounted lane',
  );
});

// F1 regression 2. Mutation: count raw ACTIVE_LOCK_STATUSES lanes.
test('UTV2-1699 F1: a parked lane stays visible but consumes no capacity', async () => {
  const parked = makeManifest('UTV2-9712', {
    status: 'parked',
    executor: 'codex-cli',
    lane_type: 'hygiene',
    branch: 'codex/utv2-9712-parked',
    file_scope_lock: ['scripts/ops/utv2-9712-parked.ts'],
  });

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[
      candidateIssueNode('UTV2-9713', { fileScope: 'scripts/ops/utv2-9712-parked.ts' }),
    ]]),
    activeLaneDiscovery: discoveryOf([parked]),
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const report = outcome.report!;
  assert.equal(report.dispatch_limits.active_codex, 0, 'a parked lane must NOT consume an executor slot');
  assert.equal(
    report.dispatch_plan.lane_saturation_forecast.executors.codex.active,
    0,
    'a parked lane must not appear as executor occupancy in the saturation forecast',
  );

  // Visible: it still holds its file-scope lock, and it is named explicitly so a
  // consumer cannot read "absent from the counts" as "absent from the board".
  assert.deepStrictEqual(
    report.dispatch_plan.lane_saturation_forecast.visible_uncounted_lanes,
    [{ issue_id: 'UTV2-9712', lane_type: 'hygiene', status: 'parked' }],
    'a parked lane must remain visible in the report',
  );
  assert.deepStrictEqual(
    report.blocked.map((entry) => ({ id: entry.issue_id, codes: entry.reason_codes })),
    [{ id: 'UTV2-9713', codes: ['OVERLAP'] }],
    'a candidate overlapping a parked lane must still be blocked on OVERLAP',
  );
});

// F1 regression 3. Mutation: count raw ACTIVE_LOCK_STATUSES lanes.
test('UTV2-1699 F1: in_review lanes do not create phantom executor saturation', async () => {
  const inReview = Array.from({ length: 6 }, (_unused, index) =>
    makeManifest(`UTV2-972${index}`, {
      status: 'in_review',
      executor: 'codex-cli',
      lane_type: 'hygiene',
      branch: `codex/utv2-972${index}-in-review`,
      file_scope_lock: [`scripts/ops/utv2-972${index}-in-review.ts`],
    }));

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9729', { fileScope: 'scripts/ops/free-path.ts' })]]),
    activeLaneDiscovery: discoveryOf(inReview),
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const report = outcome.report!;
  assert.equal(
    report.dispatch_limits.active_codex,
    0,
    'lanes awaiting review hold no executor; they must not saturate the codex cap',
  );
  assert.equal(report.dispatch_limits.codex_available, true);
  assert.ok(
    report.dispatch_plan.lane_saturation_forecast.executors.codex.available_slots > 0,
    'the forecast must report real headroom, not phantom saturation from in-review lanes',
  );
});

// F1 regression 4. Mutation: count raw ACTIVE_LOCK_STATUSES lanes.
test('UTV2-1699 F1: a parked migration lane fabricates no singleton and no forbidden pair', async () => {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]]),
    activeLaneDiscovery: discoveryOf([
      makeManifest('UTV2-9731', {
        status: 'parked',
        executor: 'codex-cli',
        lane_type: 'migration',
        branch: 'codex/utv2-9731-parked-migration',
        file_scope_lock: ['supabase/migrations/9731_parked.sql'],
      }),
      makeManifest('UTV2-9732', {
        status: 'in_progress',
        executor: 'claude',
        lane_type: 'runtime',
        branch: 'claude/utv2-9732-runtime',
        file_scope_lock: ['apps/api/src/utv2-9732.ts'],
      }),
    ]),
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const forecast = outcome.report!.dispatch_plan.lane_saturation_forecast;
  assert.deepStrictEqual(
    forecast.active_singletons,
    ['runtime'],
    'only the genuinely active runtime singleton exists; the parked migration lane holds no singleton',
  );
  // NOTE: ['runtime','runtime'] is reported from the single active runtime lane
  // by the pre-existing `activeForbiddenCombinations` membership rule, which is
  // out of scope for this lane. What must NOT appear is any pair sourced from
  // the PARKED migration lane.
  assert.deepStrictEqual(
    forecast.forbidden_combinations_active.filter((pair) => pair.includes('migration')),
    [],
    'a parked migration lane must not manufacture a migration+runtime forbidden pair',
  );
});

// F1 regression 5. Mutation: count raw ACTIVE_LOCK_STATUSES lanes.
test('UTV2-1699 F1: lane-maximizer and ops:execution-state agree on capacity for one population', async () => {
  const population = [
    makeManifest('UTV2-9741', { status: 'in_progress', executor: 'claude', lane_type: 'hygiene', branch: 'claude/utv2-9741-a' }),
    makeManifest('UTV2-9742', { status: 'in_review', executor: 'codex-cli', lane_type: 'hygiene', branch: 'codex/utv2-9742-b' }),
    makeManifest('UTV2-9743', { status: 'parked', executor: 'codex-cli', lane_type: 'migration', branch: 'codex/utv2-9743-c' }),
    makeManifest('UTV2-9744', { status: 'started', executor: 'codex-cli', lane_type: 'hygiene', branch: 'codex/utv2-9744-d' }),
    makeManifest('UTV2-9745', { status: 'blocked', executor: 'codex-cli', lane_type: 'hygiene', branch: 'codex/utv2-9745-e' }),
  ];
  const discovery = discoveryOf(population);

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[]]),
    activeLaneDiscovery: discovery,
  });
  assert.equal(outcome.exitCode, 0, outcome.stdout);

  const executionState = buildExecutionStateReport(resolveActiveLaneManifests(discovery), {
    generatedAt: '2026-01-01T00:00:00.000Z',
    nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(
    outcome.report!.dispatch_limits.active_claude,
    executionState.dispatch_slots.claude.used,
    'lane-maximizer and ops:execution-state must report the same claude occupancy for one population',
  );
  assert.equal(
    outcome.report!.dispatch_limits.active_codex,
    executionState.dispatch_slots.codex.used,
    'lane-maximizer and ops:execution-state must report the same codex occupancy for one population',
  );
  // Anchored, so the agreement cannot be satisfied by both sides being wrong the
  // same way: in_progress + started consume, in_review/blocked/parked do not.
  assert.equal(outcome.report!.dispatch_limits.active_claude, 1);
  assert.equal(outcome.report!.dispatch_limits.active_codex, 1);
});

// ---------------------------------------------------------------------------
// UTV2-1699 (PM defect 3): malformed DISCOVERED state must still emit the
// machine-readable error envelope. The failure mode being closed here is not
// "it crashes" -- it is that it crashed with exit 1 and EMPTY stdout, which a
// consumer parsing stdout cannot distinguish from a crash-free empty board.
// ---------------------------------------------------------------------------

// Mutation: delete the `file_scope_lock` Array.isArray check in
// assertUsableActiveLanes.
test('UTV2-1699 defect 3: a PR-head manifest with no file_scope_lock fails closed with an envelope', async () => {
  const malformed = { ...makeManifest('UTV2-9751', { status: 'in_progress' }) } as Record<string, unknown>;
  delete malformed.file_scope_lock;

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9752')]]),
    activeLaneDiscovery: {
      readLocalManifests: () => [],
      listOpenPullRequests: () => [{ number: 9751, headRefName: 'codex/utv2-9751-malformed' }],
      readManifestAtRef: (issueId: string) =>
        (issueId === 'UTV2-9751' ? (malformed as unknown as SharedLaneManifest) : null),
    },
  });

  assert.equal(outcome.exitCode, 1, 'an unreadable active-lane scope is never an empty scope');
  assert.equal(outcome.error?.code, 'active_lane_discovery_failed');
  assert.ok(outcome.stdout.trim().length > 0, 'the failure path must never print an empty stdout');
  const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, true);
  assert.equal(parsed.recommended, undefined, 'a failure envelope must carry no report-shaped keys');
  assert.match(String(parsed.message), /UTV2-9751/, 'the envelope must name the offending lane');
});

// Mutation: remove the try/catch around evaluateCandidates in runMaximizerCli.
test('UTV2-1699 defect 3: a throw during evaluation emits an envelope, never empty stdout', async () => {
  const structurallyBad = makeManifest('UTV2-9761', {
    status: 'in_progress',
    // Array-shaped, so it passes the boundary contract, but the entries are not
    // paths -- the overlap scan throws deep inside evaluateCandidates.
    file_scope_lock: [null as unknown as string],
  });

  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[candidateIssueNode('UTV2-9762', { fileScope: 'scripts/ops/utv2-9762.ts' })]]),
    activeLaneDiscovery: discoveryOf([structurallyBad]),
  });

  assert.equal(outcome.exitCode, 1, 'an unevaluatable board is never a safe board');
  assert.equal(outcome.error?.code, 'evaluation_failed');
  assert.ok(outcome.stdout.trim().length > 0, 'the failure path must never print an empty stdout');
  const parsed = JSON.parse(outcome.stdout) as Record<string, unknown>;
  assert.equal(parsed.ok, false);
  assert.equal(parsed.recommended, undefined, 'a failure envelope must carry no report-shaped keys');
});

// UTV2-1819: the candidate page size is bounded by Linear's query-complexity
// budget, not by its row limit. `first: 100` was rejected with HTTP 400 at a
// reported complexity of 11601/10000, which took candidate discovery -- and so
// the entire dispatch family -- down on main. These regressions make a repeat
// a test failure instead of a production outage.

test('UTV2-1819 AC2: the candidate page size stays inside Linear query-complexity budget', () => {
  const projected = LINEAR_CANDIDATE_PAGE_SIZE * LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE;
  assert.ok(
    projected < LINEAR_CANDIDATE_COMPLEXITY_BUDGET,
    `page size ${LINEAR_CANDIDATE_PAGE_SIZE} projects to complexity ${projected}, ` +
      `which is not under Linear's budget of ${LINEAR_CANDIDATE_COMPLEXITY_BUDGET}. ` +
      'Linear rejects an over-budget query with HTTP 400, so this is a hard outage, not a slowdown.',
  );
  // Headroom, so Linear re-pricing the selection slightly does not break discovery.
  assert.ok(
    projected <= LINEAR_CANDIDATE_COMPLEXITY_BUDGET * 0.75,
    `page size ${LINEAR_CANDIDATE_PAGE_SIZE} projects to ${projected}, over 75% of the ` +
      `${LINEAR_CANDIDATE_COMPLEXITY_BUDGET} budget. Leave margin for re-pricing.`,
  );
});

test('UTV2-1819 AC4: the measured per-node cost still matches the query it was measured against', () => {
  // The per-node complexity figure is only valid for the selection it was measured
  // on. Linear charges for nested connections, so adding one invalidates it. Count
  // the nested `{ nodes {` connections in the REAL exported query text.
  const nested = [...LINEAR_CANDIDATE_QUERY.matchAll(/\w+\s*\{\s*nodes\s*\{/g)].length;
  assert.equal(
    nested,
    LINEAR_CANDIDATE_NESTED_CONNECTIONS,
    `LaneCandidates now has ${nested} nested connections, but the per-node complexity ` +
      `figure ${LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE} was measured against ` +
      `${LINEAR_CANDIDATE_NESTED_CONNECTIONS}. Re-measure against the live API and update ` +
      'both constants before shipping the wider selection.',
  );
});

test('UTV2-1819 AC3: the bounded page size reaches the wire and never caps discovery', async () => {
  const linear = fakeLinearDeps([
    [candidateIssueNode('UTV2-9201')],
    [candidateIssueNode('UTV2-9202')],
    [candidateIssueNode('UTV2-9203')],
  ]);
  const outcome = await runMaximizerCli([], {
    linear,
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });

  assert.equal(outcome.exitCode, 0, outcome.stdout);

  // The `first:` actually sent must be the bounded constant. Restoring 100 fails
  // here, which is the whole point: Linear rejects it with HTTP 400 in production.
  assert.deepStrictEqual(
    linear.limitsSent,
    [LINEAR_CANDIDATE_PAGE_SIZE, LINEAR_CANDIDATE_PAGE_SIZE, LINEAR_CANDIDATE_PAGE_SIZE],
    'every page must request exactly the complexity-bounded page size',
  );

  // ...and the smaller page size must cost only round trips, never candidates.
  const discovered = allResults(outcome.report!).map((entry) => entry.issue_id).sort();
  assert.deepStrictEqual(
    discovered,
    ['UTV2-9201', 'UTV2-9202', 'UTV2-9203'],
    'a bounded page size is a transport detail; it must not cap the candidate population',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1819 (PM repair): whole-board capacity must not be a side effect of the
// transport page size.
//
// The pre-repair guard was `page > 100` while the page size was 100, so the
// supported population ceiling -- 10000 nodes -- existed only as the PRODUCT of
// two unrelated constants. Halving the page size to satisfy Linear's complexity
// budget would silently have halved capacity to 5000, turning a real board of
// 6000 issues into a fail-closed discovery error with no constant anywhere
// stating that limit. The ceiling is now named in nodes and the page bound is
// derived from it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal cursor-driven transport over a synthetic population of `total`
 * candidate issues. Deliberately separate from `fakeLinearDeps`: these
 * regressions run at the ten-thousand-node ceiling, so the fixture serves pages
 * lazily from an index rather than materializing every page up front.
 *
 * The page size is whatever the implementation actually asks for, so a walk
 * that sends the wrong `first:` is visible in `pagesServed`.
 */
function syntheticBoardDeps(total: number): LinearCandidateFetchDeps & { pagesServed: number } {
  const state = { pagesServed: 0 };
  const query = async (
    graphql: string,
    variables: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
    if (graphql.includes('ResolveTeam')) {
      return { ok: true, data: { teams: { nodes: [{ id: 'team-fixture', key: 'UTV2' }] } } };
    }
    state.pagesServed += 1;
    const offset = typeof variables.cursor === 'string' ? Number.parseInt(variables.cursor, 10) : 0;
    const first = Number(variables.limit);
    const end = Math.min(offset + first, total);
    const nodes: Array<Record<string, unknown>> = [];
    for (let index = offset; index < end; index += 1) {
      nodes.push(candidateIssueNode(`UTV2-${100000 + index}`));
    }
    return {
      ok: true,
      data: {
        team: {
          issues: {
            pageInfo: { hasNextPage: end < total, endCursor: String(end) },
            nodes,
          },
        },
      },
    };
  };
  return {
    token: 'fixture-token',
    query: query as LinearCandidateFetchDeps['query'],
    get pagesServed() {
      return state.pagesServed;
    },
  } as LinearCandidateFetchDeps & { pagesServed: number };
}

test('UTV2-1819 AC6: a board at the supported maximum is fully discoverable', async () => {
  const deps = syntheticBoardDeps(LINEAR_CANDIDATE_MAX_NODES);
  const candidates = await fetchLinearCandidates([], deps);

  assert.equal(
    candidates.length,
    LINEAR_CANDIDATE_MAX_NODES,
    `a board of exactly ${LINEAR_CANDIDATE_MAX_NODES} candidates must be returned whole. ` +
      'Reverting the node ceiling to a page-count guard fails here as soon as the page ' +
      'size changes, which is the defect this repair removes.',
  );
});

test('UTV2-1819 AC7: a board one node over the supported maximum fails closed', async () => {
  const deps = syntheticBoardDeps(LINEAR_CANDIDATE_MAX_NODES + 1);
  await assert.rejects(
    () => fetchLinearCandidates([], deps),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(
        message,
        /exceeded 10000 nodes/,
        `expected the node-ceiling refusal, got: ${message}`,
      );
      assert.match(message, /cannot be proven complete/, message);
      return true;
    },
    'a population above the supported ceiling must fail closed, never return a truncated board',
  );
});

test('UTV2-1819 AC8: page size does not define the supported node ceiling', () => {
  // The invariant the pre-repair code violated: the derived page bound must
  // always be able to carry the full node ceiling, at ANY page size. Under the
  // old `page > 100` guard, page size 50 carried only 5000 and this fails.
  for (const pageSize of [10, 25, 50, 75, 100, 250]) {
    const reachable = linearCandidateMaxPages(pageSize) * pageSize;
    assert.ok(
      reachable >= LINEAR_CANDIDATE_MAX_NODES,
      `page size ${pageSize} reaches only ${reachable} nodes, below the supported ceiling of ` +
        `${LINEAR_CANDIDATE_MAX_NODES}. Transport page size must not define board capacity.`,
    );
  }

  // ...and the loop stays bounded: the page bound is finite and never more than
  // one page looser than the ceiling strictly needs.
  for (const pageSize of [10, 50, 250]) {
    assert.equal(
      linearCandidateMaxPages(pageSize),
      Math.ceil(LINEAR_CANDIDATE_MAX_NODES / pageSize) + 1,
      'the page bound must stay derived from the node ceiling, not float free of it',
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1820 — dependency direction.
//
// Linear stores one row per relation and exposes it from BOTH ends with the
// same `type: "blocks"`. Measured live on 2026-09-01 for the real edge
// UTV2-1771 -> UTV2-1370:
//
//   UTV2-1771.relations        -> { type: "blocks", relatedIssue: UTV2-1370 }
//   UTV2-1370.inverseRelations -> { type: "blocks", issue:        UTV2-1771 }
//
// So the type string carries no direction; the connection does. These tests
// drive the REAL transport mapping, not a hand-built CandidateLane, because the
// defect lived in the mapping and a candidate fixture would bypass it entirely.
// ─────────────────────────────────────────────────────────────────────────────

function relationNode(
  identifier: string,
  relations: Array<{ type: string; relatedIssue: { identifier: string } | null }>,
  inverseRelations:
    | Array<{ type: string; issue: { identifier: string } | null }>
    | undefined,
): Record<string, unknown> {
  const node = candidateIssueNode(identifier) as Record<string, unknown>;
  node['relations'] = { nodes: relations };
  if (inverseRelations === undefined) {
    delete node['inverseRelations'];
  } else {
    node['inverseRelations'] = { nodes: inverseRelations };
  }
  return node;
}

/**
 * Runs the REAL transport mapping and returns the resulting reason codes, which
 * is what the dispatcher actually acts on. Asserting the decision rather than an
 * intermediate field keeps these regressions honest: a mapper that produced the
 * right `blocked_by` but never reached the dependency check would still pass a
 * field-level assertion.
 */
async function reasonCodesFor(node: Record<string, unknown>): Promise<string[]> {
  const outcome = await runMaximizerCli([], {
    linear: fakeLinearDeps([[node]]),
    activeLaneDiscovery: EMPTY_ACTIVE_BOARD,
  });
  assert.equal(outcome.exitCode, 0, outcome.stdout);
  const entry = allResults(outcome.report!)[0];
  assert.ok(entry, 'the candidate must be discovered');
  return entry.reason_codes ?? [];
}

// AC1 + AC3 (admit half). Mutation: read `blocks` off `relations` again.
test('UTV2-1820 AC1: an outgoing "blocks" relation is not a prerequisite', async () => {
  const codes = await reasonCodesFor(
    relationNode(
      'UTV2-9801',
      [{ type: 'blocks', relatedIssue: { identifier: 'UTV2-9899' } }],
      [],
    ),
  );

  assert.ok(
    !codes.includes('BLOCKED_DEP'),
    `UTV2-9801 blocks UTV2-9899, so UTV2-9899 is downstream of it, not a prerequisite for it; got ${JSON.stringify(codes)}`,
  );
});

// AC3 (refuse half). Mutation: stop reading `inverseRelations`.
test('UTV2-1820 AC3: a real incoming prerequisite still blocks', async () => {
  const codes = await reasonCodesFor(
    relationNode('UTV2-9802', [], [
      { type: 'blocks', issue: { identifier: 'UTV2-9898' } },
    ]),
  );

  assert.deepStrictEqual(
    codes,
    ['BLOCKED_DEP'],
    'UTV2-9898 blocks UTV2-9802 on the inverse edge, so it IS a prerequisite',
  );
});

// The exact shape the live board produced: the same issue is downstream of one
// issue and genuinely blocked by another. Only the second may count.
test('UTV2-1820: both edges at once — only the incoming one counts', async () => {
  const codes = await reasonCodesFor(
    relationNode(
      'UTV2-9803',
      [
        { type: 'blocks', relatedIssue: { identifier: 'UTV2-9897' } },
        { type: 'related', relatedIssue: { identifier: 'UTV2-9896' } },
      ],
      [
        { type: 'blocks', issue: { identifier: 'UTV2-9895' } },
        { type: 'related', issue: { identifier: 'UTV2-9894' } },
      ],
    ),
  );

  assert.deepStrictEqual(
    codes,
    ['BLOCKED_DEP'],
    'the incoming prerequisite UTV2-9895 must still block, and the outgoing edge must not',
  );
});

// AC4. Mutation: treat a missing `inverseRelations` as an empty one.
test('UTV2-1820 AC4: an absent relation set blocks rather than silently admitting', async () => {
  const codes = await reasonCodesFor(relationNode('UTV2-9804', [], undefined));

  assert.deepStrictEqual(
    codes,
    ['BLOCKED_DEP'],
    'a server that did not return the connection has told us nothing, not "unblocked"',
  );
});

// AC4. A relation that IS returned but names no issue is equally unreadable.
test('UTV2-1820 AC4: a prerequisite with no identifier blocks rather than vanishing', async () => {
  const codes = await reasonCodesFor(
    relationNode('UTV2-9805', [], [{ type: 'blocks', issue: null }]),
  );

  assert.deepStrictEqual(codes, ['BLOCKED_DEP']);
});

// The sentinel is only useful if it actually survives the completion check.
test('UTV2-1820 AC4: the unreadable sentinel resolves to BLOCKED_DEP, not to done', () => {
  const report = evaluateCandidates(
    [
      makeCandidate('UTV2-9806', {
        blocked_by: [LINEAR_UNREADABLE_RELATIONS_SENTINEL],
        file_scope: ['scripts/ops/unreadable-relations.ts'],
      }),
    ],
    [],
    { maxClaude: 1, maxCodex: 2 },
  );

  assert.deepStrictEqual(findDecisionIssueIds(report, 'blocked'), ['UTV2-9806']);
  assert.deepStrictEqual(report.blocked[0]?.reason_codes, ['BLOCKED_DEP']);
});

// The query must actually ask for the edge the fix depends on. Without this,
// deleting `inverseRelations` from the query would leave every candidate
// carrying the sentinel and the failure would look like a board problem.
test('UTV2-1820: the shipped query requests the inverse edge', () => {
  assert.match(
    LINEAR_CANDIDATE_QUERY,
    /inverseRelations\s*\{\s*nodes\s*\{\s*type\s*issue\s*\{\s*identifier\s*\}/,
    'the prerequisite edge must be in the real query text, not just in the mapper',
  );
});

// ---------------------------------------------------------------------------
// UTV2-1837 — tracker independence in discovery.
//
// `fetchLinearCandidates` throws 'LINEAR_API_TOKEN or LINEAR_API_KEY not set'
// with no credential, so the FIRST step of an ordinary task depended on the
// tracker. The queue file is a repo-owned, PR-reviewable population and is now
// selected when no credential exists. This is a source selection, not a silent
// degradation: `candidate_source` is already reported on every outcome.
// ---------------------------------------------------------------------------

test('UTV2-1837: a bare invocation with no tracker credential selects the repo-owned queue', () => {
  assert.equal(resolveCandidateSource([], false), 'queue');
});

test('UTV2-1837 AC4 inversion: with a credential the tracker is still preferred', () => {
  assert.equal(resolveCandidateSource([], true), 'linear');
});

test('UTV2-1837: an explicit source always outranks the credential probe', () => {
  for (const hasCredential of [true, false]) {
    assert.equal(resolveCandidateSource(['--from-queue'], hasCredential), 'queue');
    assert.equal(resolveCandidateSource(['--candidates', '[]'], hasCredential), 'explicit');
    assert.equal(resolveCandidateSource(['--from-stdin'], hasCredential), 'explicit');
  }
});

// UTV2-1837 — the source decision must come from the deps the caller supplied,
// not from whatever credential the machine happens to hold. Getting this wrong
// is not hypothetical: probing only `process.env` made sixteen pre-existing
// tests that inject a fake tracker pass locally and fail in CI, where they
// silently stopped exercising the Linear path at all.
test('UTV2-1837: injected Linear deps ARE a tracker source', () => {
  assert.equal(
    hasTrackerSource({ linear: fakeLinearDeps([[candidateIssueNode('UTV2-9001')]]) }),
    true,
    'a caller that supplies a tracker in place of the wire has a tracker source',
  );
});

test('UTV2-1837: with no deps and no credential the CLI reads the queue, not an unreachable tracker', async () => {
  assert.equal(resolveCandidateSource([], false), 'queue');
  assert.equal(
    resolveCandidateSource(['--from-linear'], false),
    'linear',
    'an EXPLICIT --from-linear is still honoured; the fallback is a default, never an override',
  );
});

test('UTV2-1837 inversion: an explicit flag beats the credential probe in both directions', () => {
  assert.equal(resolveCandidateSource(['--from-queue'], true), 'queue');
  assert.equal(resolveCandidateSource(['--candidates', '[]'], false), 'explicit');
});

