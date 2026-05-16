import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CandidateLane,
  type LaneManifest,
  evaluateCandidates,
} from './lane-maximizer.js';

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
    assert.deepStrictEqual(findDecisionIssueIds(report, 'blocked').sort(), ['UTV2-96813B', 'UTV2-96813O']);
    assert.deepStrictEqual(findDecisionIssueIds(report, 'risky'), ['UTV2-96813K']);
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
