import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkConcurrencyLimits,
  isValidVerificationTarget,
  type ConcurrencyManifestLike,
} from './concurrency-rules.js';
import type { ConcurrencyConfig } from './concurrency-config.js';

const POLICY: ConcurrencyConfig = {
  version: 1,
  total: 10,
  executors: { claude: 4, codex: 6 },
  merge_serialized_max: 1,
  singleton_types: ['runtime', 'migration', 'modeling', 'data-canonical'],
  forbidden_combinations: [],
  type_caps: {
    hygiene: 4,
    governance: 3,
    'delivery-ui': { max_per_app: 1 },
    verification: { max_per_target: 1 },
  },
};

function manifest(overrides: Partial<ConcurrencyManifestLike> = {}): ConcurrencyManifestLike {
  return {
    issue_id: 'UTV2-90000',
    lane_type: 'verification',
    executor: 'claude',
    status: 'in_progress',
    file_scope_lock: ['scripts/ops/example.ts'],
    ...overrides,
  };
}

// Codex review fix (PR #1220): a non-empty but malformed active verification_target
// (a stray UNI-### id, a typo, hand-edited manifest state) must fail closed the same
// way a genuinely missing target does. isValidVerificationTarget() format-validates
// rather than only checking presence.

test('isValidVerificationTarget accepts a well-formed UTV2-### target', () => {
  assert.equal(isValidVerificationTarget('UTV2-4242'), true);
});

test('isValidVerificationTarget rejects a UNI-### target', () => {
  assert.equal(isValidVerificationTarget('UNI-4242'), false);
});

test('isValidVerificationTarget rejects a malformed string', () => {
  assert.equal(isValidVerificationTarget('not-a-real-target'), false);
});

test('isValidVerificationTarget rejects empty string and undefined', () => {
  assert.equal(isValidVerificationTarget(''), false);
  assert.equal(isValidVerificationTarget(undefined), false);
});

test('checkConcurrencyLimits treats a malformed active verification_target as undetermined (fails closed)', () => {
  const active = [
    manifest({ issue_id: 'UTV2-90001', verification_target: 'UNI-500' }),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    POLICY,
    { verificationTarget: 'UTV2-9010' },
  );

  assert.ok(
    violations.some((v) => v.code === 'verification_target_undetermined_conflict'),
    `Expected verification_target_undetermined_conflict for a malformed active target, got: ${JSON.stringify(violations)}`,
  );
});

test('checkConcurrencyLimits still treats a genuinely absent active verification_target as undetermined (regression)', () => {
  const active = [
    manifest({ issue_id: 'UTV2-90002' }), // no verification_target at all
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    POLICY,
    { verificationTarget: 'UTV2-9011' },
  );

  assert.ok(
    violations.some((v) => v.code === 'verification_target_undetermined_conflict'),
    `Expected verification_target_undetermined_conflict for a missing active target, got: ${JSON.stringify(violations)}`,
  );
});

test('checkConcurrencyLimits allows a distinct valid target when the active target is valid and different (regression)', () => {
  const active = [
    manifest({ issue_id: 'UTV2-90003', verification_target: 'UTV2-9020' }),
  ];
  const violations = checkConcurrencyLimits(
    active,
    'verification',
    'codex-cli',
    POLICY,
    { verificationTarget: 'UTV2-9021' },
  );

  assert.deepStrictEqual(violations, [], `Expected no violations for a distinct valid target, got: ${JSON.stringify(violations)}`);
});

// ── UTV2-1619 capability 13: capacity is a matrix, not one flat set ──────────
// Regression fixture for the measured defect: lanes waiting on a human held
// executor slots identically to lanes being actively worked, so work nobody was
// doing denied admission to work somebody would have.

/** POLICY with targeted overrides, so each assertion isolates one cap. */
function capPolicy(overrides: Partial<ConcurrencyConfig>): ConcurrencyConfig {
  return { ...POLICY, ...overrides } as ConcurrencyConfig;
}

test('CAP-1: in_review consumes a lane slot but NOT an executor slot', () => {
  const board = [
    { issue_id: 'UTV2-9001', status: 'in_review', executor: 'claude', lane_type: 'governance' },
    { issue_id: 'UTV2-9002', status: 'in_review', executor: 'claude', lane_type: 'governance' },
    { issue_id: 'UTV2-9003', status: 'in_review', executor: 'claude', lane_type: 'governance' },
    { issue_id: 'UTV2-9004', status: 'in_review', executor: 'claude', lane_type: 'governance' },
  ] as never[];
  const config = capPolicy({ total: 10, executors: { claude: 4, codex: 6 }, type_caps: { governance: 99 } });
  const violations = checkConcurrencyLimits(board, 'governance', 'claude', config, {});
  assert.equal(
    violations.some((v) => v.code === 'claude_cap_exceeded'),
    false,
    'four lanes awaiting review must not exhaust a 4-lane executor cap',
  );
});

test('CAP-2: in_progress does consume an executor slot', () => {
  const board = [
    { issue_id: 'UTV2-9001', status: 'in_progress', executor: 'claude', lane_type: 'governance' },
    { issue_id: 'UTV2-9002', status: 'in_progress', executor: 'claude', lane_type: 'governance' },
  ] as never[];
  const config = capPolicy({ total: 10, executors: { claude: 2, codex: 6 }, type_caps: { governance: 99 } });
  const violations = checkConcurrencyLimits(board, 'governance', 'claude', config, {});
  assert.equal(violations.some((v) => v.code === 'claude_cap_exceeded'), true);
});

test('CAP-3: parked releases executor capacity but still occupies a lane slot', () => {
  const parked = [
    { issue_id: 'UTV2-9001', status: 'parked', executor: 'claude', lane_type: 'governance' },
    { issue_id: 'UTV2-9002', status: 'parked', executor: 'claude', lane_type: 'governance' },
  ] as never[];
  const execConfig = capPolicy({ total: 99, executors: { claude: 1, codex: 6 }, type_caps: { governance: 99 } });
  assert.equal(
    checkConcurrencyLimits(parked, 'governance', 'claude', execConfig, {})
      .some((v) => v.code === 'claude_cap_exceeded'),
    false,
    'parked must not hold executor capacity',
  );
  const totalConfig = capPolicy({ total: 2, executors: { claude: 99, codex: 99 }, type_caps: { governance: 99 } });
  assert.equal(
    checkConcurrencyLimits(parked, 'governance', 'claude', totalConfig, {})
      .some((v) => v.code === 'total_cap_exceeded'),
    true,
    'parked must still occupy a lane slot, or park becomes a way to defeat the caps',
  );
});

test('CAP-4: every terminal state releases all three capacity kinds', () => {
  for (const status of ['done', 'merged', 'failed', 'superseded', 'cancelled']) {
    const board = [
      { issue_id: 'UTV2-9001', status, executor: 'claude', lane_type: 'governance' },
      { issue_id: 'UTV2-9002', status, executor: 'claude', lane_type: 'governance' },
    ] as never[];
    const config = capPolicy({ total: 1, executors: { claude: 1, codex: 1 }, type_caps: { governance: 1 } });
    assert.deepEqual(
      checkConcurrencyLimits(board, 'governance', 'claude', config, {}).map((v) => v.code),
      [],
      `terminal state "${status}" must release total, executor and type capacity`,
    );
  }
});

test('CAP-5: blocked releases executor capacity but holds its lane and type slot', () => {
  const board = [
    { issue_id: 'UTV2-9001', status: 'blocked', executor: 'claude', lane_type: 'governance' },
  ] as never[];
  assert.equal(
    checkConcurrencyLimits(board, 'governance', 'claude',
      capPolicy({ total: 99, executors: { claude: 1, codex: 9 }, type_caps: { governance: 99 } }), {})
      .some((v) => v.code === 'claude_cap_exceeded'),
    false,
  );
  assert.equal(
    checkConcurrencyLimits(board, 'governance', 'claude',
      capPolicy({ total: 99, executors: { claude: 9, codex: 9 }, type_caps: { governance: 1 } }), {})
      .some((v) => v.code === 'governance_type_cap_exceeded'),
    true,
    'a blocked lane still occupies its type slot -- it can still be changing that surface',
  );
});
