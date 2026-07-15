import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CandidateLane,
  type LaneManifest,
  evaluateCandidates,
  isBlockingLinearRelationType,
  parseQueueCandidates,
} from './lane-maximizer.js';
import { buildPnpmStateEnv } from './lane-start.js';
import { checkConcurrencyLimits, type ConcurrencyManifestLike } from './concurrency-rules.js';
import {
  CONFIG_FILE_PATH,
  clearConcurrencyConfigCache,
  type ConcurrencyConfig,
  type EffectiveConcurrencyConfig,
} from './concurrency-config.js';
import type { CanonicalLaneType } from './shared.js';

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
  assert.equal(isBlockingLinearRelationType('related'), false);
  assert.equal(isBlockingLinearRelationType('blocked_by'), true);
  assert.equal(isBlockingLinearRelationType('blocks'), true);
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
