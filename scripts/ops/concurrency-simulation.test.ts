import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConcurrencyLimits, type ConcurrencyViolation } from './lane-start.js';
import { getEffectiveConfig, type ConcurrencyConfig } from './concurrency-config.js';
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
  type_caps: {
    hygiene: 4,
    governance: 3,
    'delivery-ui': { max_per_app: 1 },
    verification: { max_per_target: 1 },
  },
};

// Mirrors the real docs/governance/CONCURRENCY_CONFIG.json base values exactly (UTV2-1533),
// so the "Lane N rejected" tests below prove the shipped numbers, not just the generic
// mechanism (which the POLICY fixture above already covers at smaller numbers).
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
  assert.strictEqual(config.total, 10, 'total must be 10');
  assert.strictEqual(config.executors.claude, 4, 'claude limit must be 4');
  assert.strictEqual(config.executors.codex, 6, 'codex limit must be 6');
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

// ── 11. Trial governor — getEffectiveConfig ───────────────────────────────

const TRIAL_DISABLED: ConcurrencyConfig = {
  ...POLICY,
  trial: {
    enabled: false,
    total: 8,
    executors: { claude: 3, codex: 5 },
    allowed_until: null,
    rationale: 'test',
    safe_types_only: ['governance', 'hygiene', 'delivery-ui', 'verification'],
  },
};

const FUTURE = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
const PAST = new Date(Date.now() - 86_400_000).toISOString();   // -1 day

const TRIAL_ACTIVE: ConcurrencyConfig = {
  ...POLICY,
  trial: {
    enabled: true,
    total: 8,
    executors: { claude: 3, codex: 5 },
    allowed_until: FUTURE,
    rationale: 'test',
    safe_types_only: ['governance', 'hygiene', 'delivery-ui', 'verification'],
  },
};

const TRIAL_EXPIRED: ConcurrencyConfig = {
  ...POLICY,
  trial: {
    enabled: true,
    total: 8,
    executors: { claude: 3, codex: 5 },
    allowed_until: PAST,
    rationale: 'test',
    safe_types_only: ['governance', 'hygiene', 'delivery-ui', 'verification'],
  },
};

test('getEffectiveConfig: trial disabled → base limits returned', () => {
  const eff = getEffectiveConfig(TRIAL_DISABLED);
  assert.strictEqual(eff.total, 6, 'total must be 6 when trial disabled');
  assert.strictEqual(eff.executors.claude, 2);
  assert.strictEqual(eff.executors.codex, 4);
  assert.strictEqual(eff.trial_active, false);
});

test('getEffectiveConfig: trial enabled with future expiry → trial limits returned', () => {
  const eff = getEffectiveConfig(TRIAL_ACTIVE);
  assert.strictEqual(eff.total, 8, 'total must be 8 when trial active');
  assert.strictEqual(eff.executors.claude, 3);
  assert.strictEqual(eff.executors.codex, 5);
  assert.strictEqual(eff.trial_active, true);
  assert.strictEqual(eff.trial_expires_at, FUTURE);
});

test('getEffectiveConfig: trial expired (allowed_until in past) → base limits returned', () => {
  const eff = getEffectiveConfig(TRIAL_EXPIRED);
  assert.strictEqual(eff.total, 6, 'must revert to 6 after expiry');
  assert.strictEqual(eff.executors.claude, 2);
  assert.strictEqual(eff.trial_active, false);
});

test('getEffectiveConfig: trial enabled with null allowed_until → never expires', () => {
  const cfg: ConcurrencyConfig = {
    ...POLICY,
    trial: {
      enabled: true,
      total: 8,
      executors: { claude: 3, codex: 5 },
      allowed_until: null,
      rationale: 'test',
      safe_types_only: [],
    },
  };
  const eff = getEffectiveConfig(cfg);
  assert.strictEqual(eff.total, 8);
  assert.strictEqual(eff.trial_active, true);
  assert.strictEqual(eff.trial_expires_at, null);
});

test('trial mode: 7th lane allowed when trial active (6 active → add 1 more)', () => {
  const eff = getEffectiveConfig(TRIAL_ACTIVE);
  const trialPolicy: ConcurrencyConfig = {
    ...POLICY,
    total: eff.total,
    executors: { claude: eff.executors.claude, codex: eff.executors.codex },
  };
  // UTV2-1533: rebalanced from the original fixture (which put 4 hygiene lanes active
  // and then added a 5th) now that hygiene has its own type cap of 4 -- that scenario is
  // covered on its own merits by 'fifth Hygiene lane rejected' below. This fixture keeps
  // the original test's intent (prove total/executor headroom allows a 7th lane under
  // trial) while respecting every type cap: 3 governance (at cap, not exceeded) + 3
  // hygiene, adding a 4th hygiene (at cap, not exceeded).
  const active = [
    manifest('UTV2-T01', 'claude', 'governance', ['scripts/ops/t01.ts']),
    manifest('UTV2-T02', 'claude', 'governance', ['scripts/ops/t02.ts']),
    manifest('UTV2-T03', 'claude', 'governance', ['scripts/ops/t03.ts']),
    manifest('UTV2-T04', 'codex-cli', 'hygiene', ['scripts/ops/t04.ts']),
    manifest('UTV2-T05', 'codex-cli', 'hygiene', ['scripts/ops/t05.ts']),
    manifest('UTV2-T06', 'codex-cli', 'hygiene', ['scripts/ops/t06.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'codex-cli', trialPolicy);
  assert.strictEqual(violations.length, 0, `Expected no violations at 7th lane under trial: ${JSON.stringify(violations)}`);
});

test('trial mode: 9th lane blocked even when trial allows 8', () => {
  const eff = getEffectiveConfig(TRIAL_ACTIVE);
  const trialPolicy: ConcurrencyConfig = {
    ...POLICY,
    total: eff.total,
    executors: { claude: eff.executors.claude, codex: eff.executors.codex },
  };
  const active = [
    manifest('UTV2-T10', 'claude', 'governance', ['scripts/ops/t10.ts']),
    manifest('UTV2-T11', 'claude', 'hygiene', ['scripts/ops/t11.ts']),
    manifest('UTV2-T12', 'claude', 'governance', ['scripts/ops/t12.ts']),
    manifest('UTV2-T13', 'codex-cli', 'hygiene', ['scripts/ops/t13.ts']),
    manifest('UTV2-T14', 'codex-cli', 'hygiene', ['scripts/ops/t14.ts']),
    manifest('UTV2-T15', 'codex-cli', 'hygiene', ['scripts/ops/t15.ts']),
    manifest('UTV2-T16', 'codex-cli', 'hygiene', ['scripts/ops/t16.ts']),
    manifest('UTV2-T17', 'codex-cli', 'hygiene', ['scripts/ops/t17.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'codex-cli', trialPolicy);
  assert.ok(violations.length > 0, 'Expected violation at 9th lane even under trial');
});

test('trial mode: expired trial still blocks at 7 (reverts to base 6 cap)', () => {
  const eff = getEffectiveConfig(TRIAL_EXPIRED);
  assert.strictEqual(eff.trial_active, false);
  const basePolicy: ConcurrencyConfig = {
    ...POLICY,
    total: eff.total,
    executors: { claude: eff.executors.claude, codex: eff.executors.codex },
  };
  const active = [
    manifest('UTV2-E01', 'claude', 'governance', ['scripts/ops/e01.ts']),
    manifest('UTV2-E02', 'claude', 'hygiene', ['scripts/ops/e02.ts']),
    manifest('UTV2-E03', 'codex-cli', 'hygiene', ['scripts/ops/e03.ts']),
    manifest('UTV2-E04', 'codex-cli', 'hygiene', ['scripts/ops/e04.ts']),
    manifest('UTV2-E05', 'codex-cli', 'hygiene', ['scripts/ops/e05.ts']),
    manifest('UTV2-E06', 'codex-cli', 'hygiene', ['scripts/ops/e06.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', basePolicy);
  assert.ok(violations.length > 0, `Expected violation at 7th lane after trial expiry: ${JSON.stringify(violations)}`);
});

test('trial mode: unsafe lane types cannot fill slots above the base cap', () => {
  const eff = getEffectiveConfig(TRIAL_ACTIVE);
  const active = [
    manifest('UTV2-U01', 'claude', 'governance', ['scripts/ops/u01.ts']),
    manifest('UTV2-U02', 'claude', 'hygiene', ['scripts/ops/u02.ts']),
    manifest('UTV2-U03', 'codex-cli', 'hygiene', ['scripts/ops/u03.ts']),
    manifest('UTV2-U04', 'codex-cli', 'verification', ['scripts/ops/u04.ts']),
    manifest('UTV2-U05', 'codex-cli', 'governance', ['scripts/ops/u05.ts']),
    manifest('UTV2-U06', 'codex-cli', 'hygiene', ['scripts/ops/u06.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'runtime', 'codex-cli', eff);
  assert.ok(
    violations.some((violation) => violation.code === 'trial_unsafe_lane_type'),
    `Expected trial_unsafe_lane_type violation above base cap: ${JSON.stringify(violations)}`,
  );
});

// ── 12. Type-level distribution caps (UTV2-1533 P2 fix) ───────────────────
// Tested against PROD_POLICY (the real shipped 10/4/6 + hygiene:4/governance:3/
// delivery-ui:1-per-app/verification:1-per-target numbers), not the generic small-number
// POLICY fixture above, so these tests prove the actual production caps hold.

test('1. lane 11 rejected by total cap', () => {
  const active = [
    manifest('UTV2-P01', 'claude', 'runtime', ['apps/worker/src/a.ts']),
    manifest('UTV2-P02', 'claude', 'modeling', ['packages/domain/src/score.ts']),
    manifest('UTV2-P03', 'claude', 'governance', ['docs/gov/a.md']),
    manifest('UTV2-P04', 'claude', 'governance', ['docs/gov/b.md']),
    manifest('UTV2-P05', 'codex-cli', 'hygiene', ['scripts/ops/p05.ts']),
    manifest('UTV2-P06', 'codex-cli', 'hygiene', ['scripts/ops/p06.ts']),
    manifest('UTV2-P07', 'codex-cli', 'hygiene', ['scripts/ops/p07.ts']),
    manifest('UTV2-P08', 'codex-cli', 'hygiene', ['scripts/ops/p08.ts']),
    manifest('UTV2-P09', 'codex-cli', 'delivery-ui', ['apps/command-center/page.tsx']),
    { ...manifest('UTV2-P10', 'codex-cli', 'verification', ['apps/api/src/x.test.ts']), verification_target: 'UTV2-9001' },
  ];
  assert.strictEqual(active.length, 10, 'fixture must have exactly 10 active lanes');
  const violations = checkConcurrencyLimits(
    active,
    'delivery-ui',
    'codex-cli',
    PROD_POLICY,
    { fileScopeLock: ['apps/discord-bot/x.tsx'] },
  );
  assert.ok(
    violationCodes(violations).includes('total_cap_exceeded'),
    `Expected total_cap_exceeded at lane 11, got: ${JSON.stringify(violations)}`,
  );
});

test('2. fifth Claude lane rejected', () => {
  const active = [
    manifest('UTV2-P20', 'claude', 'governance', ['docs/gov/c.md']),
    manifest('UTV2-P21', 'claude', 'governance', ['docs/gov/d.md']),
    manifest('UTV2-P22', 'claude', 'governance', ['docs/gov/e.md']),
    manifest('UTV2-P23', 'claude', 'runtime', ['apps/worker/src/b.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'claude', PROD_POLICY);
  assert.ok(
    violationCodes(violations).includes('claude_cap_exceeded'),
    `Expected claude_cap_exceeded at the 5th Claude lane, got: ${JSON.stringify(violations)}`,
  );
});

test('3. seventh Codex lane rejected', () => {
  const active = [
    manifest('UTV2-P30', 'codex-cli', 'hygiene', ['scripts/ops/p30.ts']),
    manifest('UTV2-P31', 'codex-cli', 'hygiene', ['scripts/ops/p31.ts']),
    manifest('UTV2-P32', 'codex-cli', 'hygiene', ['scripts/ops/p32.ts']),
    manifest('UTV2-P33', 'codex-cli', 'hygiene', ['scripts/ops/p33.ts']),
    manifest('UTV2-P34', 'codex-cli', 'delivery-ui', ['apps/command-center/page.tsx']),
    { ...manifest('UTV2-P35', 'codex-cli', 'verification', ['apps/api/src/y.test.ts']), verification_target: 'UTV2-9001' },
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    PROD_POLICY,
    { verificationTarget: 'UTV2-9002' },
  );
  assert.ok(
    violationCodes(violations).includes('codex_cap_exceeded'),
    `Expected codex_cap_exceeded at the 7th Codex lane, got: ${JSON.stringify(violations)}`,
  );
});

test('4. fifth Hygiene lane rejected (isolated: no other cap fires)', () => {
  const active = [
    manifest('UTV2-P40', 'claude', 'hygiene', ['scripts/ops/p40.ts']),
    manifest('UTV2-P41', 'claude', 'hygiene', ['scripts/ops/p41.ts']),
    manifest('UTV2-P42', 'codex-cli', 'hygiene', ['scripts/ops/p42.ts']),
    manifest('UTV2-P43', 'codex-cli', 'hygiene', ['scripts/ops/p43.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'claude', PROD_POLICY);
  assert.deepStrictEqual(
    violationCodes(violations),
    ['hygiene_type_cap_exceeded'],
    `Expected exactly hygiene_type_cap_exceeded (isolated), got: ${JSON.stringify(violations)}`,
  );
});

test('5. fourth Governance lane rejected (isolated: no other cap fires)', () => {
  const active = [
    manifest('UTV2-P50', 'claude', 'governance', ['docs/gov/f.md']),
    manifest('UTV2-P51', 'claude', 'governance', ['docs/gov/g.md']),
    manifest('UTV2-P52', 'codex-cli', 'governance', ['docs/gov/h.md']),
  ];
  const violations = checkConcurrencyLimits(active, 'governance', 'claude', PROD_POLICY);
  assert.deepStrictEqual(
    violationCodes(violations),
    ['governance_type_cap_exceeded'],
    `Expected exactly governance_type_cap_exceeded (isolated), got: ${JSON.stringify(violations)}`,
  );
});

test('6. second Delivery/UI lane for the same app rejected', () => {
  const active = [
    manifest('UTV2-P60', 'claude', 'delivery-ui', ['apps/command-center/page.tsx']),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'delivery-ui',
    'codex-cli',
    PROD_POLICY,
    { fileScopeLock: ['apps/command-center/other-page.tsx'] },
  );
  assert.ok(
    violationCodes(violations).includes('delivery_ui_app_conflict'),
    `Expected delivery_ui_app_conflict for same-app Delivery/UI lanes, got: ${JSON.stringify(violations)}`,
  );
});

test('7. Delivery/UI lanes for different apps accepted', () => {
  const active = [
    manifest('UTV2-P70', 'claude', 'delivery-ui', ['apps/command-center/page.tsx']),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'delivery-ui',
    'codex-cli',
    PROD_POLICY,
    { fileScopeLock: ['apps/discord-bot/formatter.ts'] },
  );
  assert.strictEqual(violations.length, 0, `Expected no violations across different apps, got: ${JSON.stringify(violations)}`);
});

test('8. second Verification lane for the same target rejected', () => {
  const active = [
    { ...manifest('UTV2-P80', 'claude', 'verification', ['apps/api/src/z.test.ts']), verification_target: 'UTV2-9010' },
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    PROD_POLICY,
    { verificationTarget: 'UTV2-9010' },
  );
  assert.ok(
    violationCodes(violations).includes('verification_target_conflict'),
    `Expected verification_target_conflict for same-target Verification lanes, got: ${JSON.stringify(violations)}`,
  );
});

test('9. Verification lanes for different targets accepted', () => {
  const active = [
    { ...manifest('UTV2-P90', 'claude', 'verification', ['apps/api/src/z2.test.ts']), verification_target: 'UTV2-9020' },
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    PROD_POLICY,
    { verificationTarget: 'UTV2-9021' },
  );
  assert.strictEqual(violations.length, 0, `Expected no violations across different targets, got: ${JSON.stringify(violations)}`);
});

test('10. existing singleton behavior remains intact under PROD_POLICY', () => {
  const active = [manifest('UTV2-P100', 'claude', 'runtime', ['apps/worker/src/c.ts'])];
  const violations = checkConcurrencyLimits(active, 'runtime', 'codex-cli', PROD_POLICY);
  assert.ok(
    violationCodes(violations).includes('singleton_type_conflict'),
    `Expected singleton_type_conflict to still fire under PROD_POLICY, got: ${JSON.stringify(violations)}`,
  );
});

test('11. forbidden combinations remain intact under PROD_POLICY', () => {
  const active = [manifest('UTV2-P110', 'claude', 'migration', ['supabase/migrations/d.sql'])];
  const violations = checkConcurrencyLimits(active, 'runtime', 'claude', PROD_POLICY);
  assert.ok(
    violationCodes(violations).includes('forbidden_combination'),
    `Expected forbidden_combination to still fire under PROD_POLICY, got: ${JSON.stringify(violations)}`,
  );
});

test('12. disabled 12-14 trial remains inactive in the real shipped config', async () => {
  const fs = await import('node:fs');
  const configPath = path.join(ROOT, 'docs', 'governance', 'CONCURRENCY_CONFIG.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ConcurrencyConfig;
  assert.strictEqual(config.trial?.enabled, false, 'the 12-14 trial must be disabled in the shipped config');
  const eff = getEffectiveConfig(config);
  assert.strictEqual(eff.total, 10, 'effective total must be the 10-lane base while trial is disabled');
  assert.strictEqual(eff.executors.claude, 4);
  assert.strictEqual(eff.executors.codex, 6);
  assert.strictEqual(eff.trial_active, false);
});

test('13. trial activation does not silently remove type-level protections', () => {
  const trialActiveHighHeadroom: ConcurrencyConfig = {
    ...PROD_POLICY,
    trial: {
      enabled: true,
      total: 14,
      executors: { claude: 5, codex: 9 },
      allowed_until: null,
      rationale: 'test',
      safe_types_only: ['governance', 'hygiene', 'delivery-ui', 'verification'],
    },
  };
  const eff = getEffectiveConfig(trialActiveHighHeadroom);
  assert.strictEqual(eff.trial_active, true);
  assert.strictEqual(eff.total, 14, 'trial total headroom must be in effect');
  // 4 active hygiene lanes -- well within the trial's 14-lane/9-codex headroom, but
  // already AT the type_caps.hygiene cap, which trial must not widen.
  const active = [
    manifest('UTV2-P130', 'codex-cli', 'hygiene', ['scripts/ops/p130.ts']),
    manifest('UTV2-P131', 'codex-cli', 'hygiene', ['scripts/ops/p131.ts']),
    manifest('UTV2-P132', 'codex-cli', 'hygiene', ['scripts/ops/p132.ts']),
    manifest('UTV2-P133', 'codex-cli', 'hygiene', ['scripts/ops/p133.ts']),
  ];
  const violations = checkConcurrencyLimits(active, 'hygiene', 'codex-cli', eff);
  assert.ok(
    violationCodes(violations).includes('hygiene_type_cap_exceeded'),
    `Trial headroom must not bypass the hygiene type cap, got: ${JSON.stringify(violations)}`,
  );
});

test('14. execution-state reports the effective caps from the real CONCURRENCY_CONFIG.json', async () => {
  const { MAX_CLAUDE_LANES, MAX_CODEX_LANES } = await import('./execution-state.js');
  assert.strictEqual(MAX_CLAUDE_LANES, 4, 'execution-state must report claude max=4 from the real shipped config');
  assert.strictEqual(MAX_CODEX_LANES, 6, 'execution-state must report codex max=6 from the real shipped config');
});

// ── 15. Delivery/UI fail-closed on an undetermined ACTIVE lane (PR #1215 Codex review) ────
// deriveDeliveryUiApp() returning null for an active lane means "cannot determine which app",
// not "proven to be a different app" -- treating it as non-conflicting would let a second
// Delivery/UI lane onto the same app whenever the first lane's scope happens to be ambiguous.

test('15. delivery-ui: active lane with an undetermined app is treated as a conflict, not ignored', () => {
  const active = [
    // Spans two app roots -- deriveDeliveryUiApp returns null for this manifest's own scope.
    manifest('UTV2-P150', 'claude', 'delivery-ui', [
      'apps/command-center/src/app/page.tsx',
      'apps/discord-bot/src/formatter.ts',
    ]),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'delivery-ui',
    'codex-cli',
    PROD_POLICY,
    { fileScopeLock: ['apps/command-center/src/app/other.tsx'] },
  );
  assert.ok(
    violationCodes(violations).includes('delivery_ui_app_undetermined_conflict'),
    `Expected delivery_ui_app_undetermined_conflict when an active lane's app can't be determined, got: ${JSON.stringify(violations)}`,
  );
});

test('15b. delivery-ui: a determined active lane on a different app is still accepted (regression guard)', () => {
  const active = [
    manifest('UTV2-P151', 'claude', 'delivery-ui', ['apps/discord-bot/src/formatter.ts']),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'delivery-ui',
    'codex-cli',
    PROD_POLICY,
    { fileScopeLock: ['apps/command-center/src/app/other.tsx'] },
  );
  assert.strictEqual(violations.length, 0, `Expected no violations for a clearly different app, got: ${JSON.stringify(violations)}`);
});
