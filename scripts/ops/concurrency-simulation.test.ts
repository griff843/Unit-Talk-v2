import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConcurrencyLimits, type ConcurrencyViolation } from './lane-start.js';
import type { ConcurrencyConfig } from './concurrency-config.js';
import type { LaneManifest } from './shared.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const POLICY: ConcurrencyConfig = {
  version: 1,
  total: 6,
  executors: { claude: 2, codex: 4 },
  merge_serialized_max: 1,
  singleton_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
  forbidden_combinations: [
    ['migration', 'runtime'],
    ['migration', 'migration'],
    ['migration', 'data-canonical'],
    ['runtime', 'runtime'],
    ['modeling', 'modeling'],
  ],
};

function manifest(
  issueId: string,
  executor: LaneManifest['executor'],
  laneType: string,
  fileScopeLock: string[] = [`scripts/ops/${issueId.toLowerCase()}.ts`],
): LaneManifest {
  return {
    schema_version: 1,
    issue_id: issueId,
    lane_type: laneType as LaneManifest['lane_type'],
    executor,
    tier: 'T2',
    worktree_path: `.out/worktrees/${issueId.toLowerCase()}`,
    branch: `${executor === 'claude' ? 'claude' : 'codex'}/${issueId.toLowerCase()}-lane`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: fileScopeLock,
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: executor === 'claude' ? 'claude' : 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
  };
}

function violationCodes(violations: ConcurrencyViolation[]): string[] {
  return violations.map((v) => v.code);
}

// ── 1. 2 Claude + 4 Codex allowed ──────────────────────────────────────────
test('2 Claude + 4 Codex: adding 1 Claude when 1 Claude + 3 Codex active is allowed', () => {
  const active = [
    manifest('UTV2-SIM01', 'claude', 'governance', ['scripts/ops/a.ts']),
    manifest('UTV2-SIM02', 'codex-cli', 'hygiene', ['scripts/ops/b.ts']),
    manifest('UTV2-SIM03', 'codex-cli', 'hygiene', ['scripts/ops/c.ts']),
    manifest('UTV2-SIM04', 'codex-cli', 'hygiene', ['scripts/ops/d.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.strictEqual(violations.length, 0, `Expected no violations, got: ${JSON.stringify(violations)}`);
});

test('2 Claude + 4 Codex: full 6-lane board — adding any more is allowed until total exceeds 6', () => {
  const active = [
    manifest('UTV2-SIM10', 'claude', 'governance', ['scripts/ops/sim10.ts']),
    manifest('UTV2-SIM11', 'claude', 'hygiene', ['scripts/ops/sim11.ts']),
    manifest('UTV2-SIM12', 'codex-cli', 'hygiene', ['scripts/ops/sim12.ts']),
    manifest('UTV2-SIM13', 'codex-cli', 'hygiene', ['scripts/ops/sim13.ts']),
    manifest('UTV2-SIM14', 'codex-cli', 'hygiene', ['scripts/ops/sim14.ts']),
    manifest('UTV2-SIM15', 'codex-cli', 'hygiene', ['scripts/ops/sim15.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.ok(
    violationCodes(violations).includes('total_cap_exceeded') ||
    violationCodes(violations).includes('claude_cap_exceeded'),
    `Expected cap violation, got: ${JSON.stringify(violations)}`,
  );
});

// ── 2. 3 Claude blocked ────────────────────────────────────────────────────
test('3 Claude blocked: 2 active Claude → adding 1 more is rejected', () => {
  const active = [
    manifest('UTV2-SIM20', 'claude', 'governance', ['scripts/ops/sim20.ts']),
    manifest('UTV2-SIM21', 'claude', 'hygiene', ['scripts/ops/sim21.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.ok(
    violationCodes(violations).includes('claude_cap_exceeded'),
    `Expected claude_cap_exceeded, got: ${JSON.stringify(violations)}`,
  );
});

// ── 3. 5 Codex blocked ────────────────────────────────────────────────────
test('5 Codex blocked: 4 active Codex → adding 1 more is rejected', () => {
  const active = [
    manifest('UTV2-SIM30', 'codex-cli', 'hygiene', ['scripts/ops/sim30.ts']),
    manifest('UTV2-SIM31', 'codex-cli', 'hygiene', ['scripts/ops/sim31.ts']),
    manifest('UTV2-SIM32', 'codex-cli', 'hygiene', ['scripts/ops/sim32.ts']),
    manifest('UTV2-SIM33', 'codex-cli', 'hygiene', ['scripts/ops/sim33.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'codex-cli', POLICY);
  assert.ok(
    violationCodes(violations).includes('codex_cap_exceeded'),
    `Expected codex_cap_exceeded, got: ${JSON.stringify(violations)}`,
  );
});

// ── 4. 7 total blocked ────────────────────────────────────────────────────
test('7 total blocked: 6 active lanes → adding any lane is rejected with total_cap_exceeded', () => {
  const active = [
    manifest('UTV2-SIM40', 'claude', 'governance', ['scripts/ops/sim40.ts']),
    manifest('UTV2-SIM41', 'claude', 'hygiene', ['scripts/ops/sim41.ts']),
    manifest('UTV2-SIM42', 'codex-cli', 'hygiene', ['scripts/ops/sim42.ts']),
    manifest('UTV2-SIM43', 'codex-cli', 'hygiene', ['scripts/ops/sim43.ts']),
    manifest('UTV2-SIM44', 'codex-cli', 'hygiene', ['scripts/ops/sim44.ts']),
    manifest('UTV2-SIM45', 'codex-cli', 'hygiene', ['scripts/ops/sim45.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.ok(violations.length > 0, 'Expected violations when 6 lanes are active');
  const codes = violationCodes(violations);
  assert.ok(
    codes.includes('total_cap_exceeded') || codes.includes('claude_cap_exceeded'),
    `Expected total or claude cap violation, got: ${JSON.stringify(codes)}`,
  );
});

// ── 5. Second runtime/migration/modeling/data-canonical blocked ───────────
test('second runtime blocked: existing runtime lane → new runtime rejected', () => {
  const active = [manifest('UTV2-SIM50', 'claude', 'runtime', ['apps/worker/src/a.ts'])];
  const violations = checkConcurrencyLimits(active, 'runtime', 'codex-cli', POLICY);
  assert.ok(
    violationCodes(violations).includes('singleton_type_conflict'),
    `Expected singleton_type_conflict, got: ${JSON.stringify(violations)}`,
  );
});

test('second migration blocked: existing migration lane → new migration rejected', () => {
  const active = [manifest('UTV2-SIM51', 'claude', 'migration', ['supabase/migrations/a.sql'])];
  const violations = checkConcurrencyLimits(active, 'migration', 'codex-cli', POLICY);
  assert.ok(
    violationCodes(violations).includes('singleton_type_conflict'),
    `Expected singleton_type_conflict, got: ${JSON.stringify(violations)}`,
  );
});

test('second modeling blocked: existing modeling lane → new modeling rejected', () => {
  const active = [manifest('UTV2-SIM52', 'claude', 'modeling', ['packages/domain/src/score.ts'])];
  const violations = checkConcurrencyLimits(active, 'modeling', 'codex-cli', POLICY);
  assert.ok(
    violationCodes(violations).includes('singleton_type_conflict'),
    `Expected singleton_type_conflict, got: ${JSON.stringify(violations)}`,
  );
});

test('second data-canonical blocked: existing data-canonical lane → new data-canonical rejected', () => {
  const active = [manifest('UTV2-SIM53', 'claude', 'data-canonical', ['apps/ingestor/src/a.ts'])];
  const violations = checkConcurrencyLimits(active, 'data-canonical', 'codex-cli', POLICY);
  assert.ok(
    violationCodes(violations).includes('singleton_type_conflict'),
    `Expected singleton_type_conflict, got: ${JSON.stringify(violations)}`,
  );
});

// ── 6. Forbidden combinations blocked ────────────────────────────────────
test('migration + runtime forbidden: active migration → new runtime rejected', () => {
  const active = [manifest('UTV2-SIM60', 'claude', 'migration', ['supabase/migrations/b.sql'])];
  const violations = checkConcurrencyLimits(active, 'runtime', 'claude', POLICY);
  assert.ok(
    violationCodes(violations).includes('forbidden_combination'),
    `Expected forbidden_combination, got: ${JSON.stringify(violations)}`,
  );
});

test('migration + data-canonical forbidden: active migration → new data-canonical rejected', () => {
  const active = [manifest('UTV2-SIM61', 'claude', 'migration', ['supabase/migrations/c.sql'])];
  const violations = checkConcurrencyLimits(active, 'data-canonical', 'claude', POLICY);
  assert.ok(
    violationCodes(violations).includes('forbidden_combination'),
    `Expected forbidden_combination, got: ${JSON.stringify(violations)}`,
  );
});

// ── 7. Governance unblocked — allowed next to anything ────────────────────
test('governance + runtime allowed: active runtime → new governance allowed', () => {
  const active = [manifest('UTV2-SIM70', 'claude', 'runtime', ['apps/worker/src/b.ts'])];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.strictEqual(violations.length, 0, `Expected no violations, got: ${JSON.stringify(violations)}`);
});

// ── 8. Merge/closeout serialization ──────────────────────────────────────
test('merge_serialized_max is 1 in CONCURRENCY_CONFIG.json', async () => {
  const fs = await import('node:fs');
  const configPath = path.join(ROOT, 'docs', 'governance', 'CONCURRENCY_CONFIG.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ConcurrencyConfig;
  assert.strictEqual(config.merge_serialized_max, 1, 'merge_serialized_max must be 1');
  assert.strictEqual(config.total, 6, 'total must be 6');
  assert.strictEqual(config.executors.claude, 2, 'claude limit must be 2');
  assert.strictEqual(config.executors.codex, 4, 'codex limit must be 4');
});

// ── 9. Done manifests don't count against limits ──────────────────────────
test('done manifests are excluded from active count', () => {
  const active = [
    { ...manifest('UTV2-SIM80', 'claude', 'governance', ['scripts/ops/sim80.ts']), status: 'done' as const },
    { ...manifest('UTV2-SIM81', 'claude', 'governance', ['scripts/ops/sim81.ts']), status: 'done' as const },
    { ...manifest('UTV2-SIM82', 'claude', 'governance', ['scripts/ops/sim82.ts']), status: 'done' as const },
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', POLICY);
  assert.strictEqual(violations.length, 0, `Done manifests should not count; got: ${JSON.stringify(violations)}`);
});

// ── 10. Zero active lanes — always allowed ────────────────────────────────
test('zero active lanes — any lane type is allowed', () => {
  for (const laneType of ['runtime', 'migration', 'modeling', 'data-canonical', 'governance', 'hygiene'] as const) {
    const violations = checkConcurrencyLimits([], laneType, 'claude', POLICY);
    assert.strictEqual(violations.length, 0, `Expected no violations for ${laneType} on empty board`);
  }
});
