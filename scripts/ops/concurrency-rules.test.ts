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
