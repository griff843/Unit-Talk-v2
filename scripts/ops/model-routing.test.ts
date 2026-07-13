import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCodexModelArgs,
  loadModelRoutingPolicy,
  resolveLegacyModelRouting,
  resolveModelProfile,
  validateOverride,
  validatePersistedModelRouting,
  type ModelRoutingPolicy,
} from './model-routing.js';

// A fixed synthetic policy, independent of the real policy file on disk, so these tests
// stay deterministic even if the canonical policy is later re-versioned or re-tuned.
function fixturePolicy(): ModelRoutingPolicy {
  return {
    policy_version: '1.0.0',
    schema_version: 1,
    description: 'test fixture',
    verified_against: {},
    profiles: {
      'codex-terra-medium': {
        model: 'gpt-5.6-terra',
        reasoning_effort: 'medium',
        enabled: true,
        permitted_tiers: ['T2'],
        use_cases: ['clear-scope-t2-implementation'],
        requires_pm_authorization: false,
        description: 'default T2 profile',
      },
      'codex-sol-high': {
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
        enabled: true,
        permitted_tiers: ['T1', 'T2'],
        use_cases: ['complex-t2-multi-file-or-multi-package', 'failure-rescue-lane'],
        requires_pm_authorization: false,
        description: 'complex work / rescue',
      },
      'codex-sol-max': {
        model: 'gpt-5.6-sol',
        reasoning_effort: 'max',
        enabled: true,
        permitted_tiers: ['T1', 'T2'],
        use_cases: ['rescue-threshold-exceeded-after-sol-high-failed'],
        requires_pm_authorization: true,
        description: 'stuck-lane escalation only',
      },
      'codex-luna-low': {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'low',
        enabled: false,
        permitted_tiers: [],
        use_cases: [],
        requires_pm_authorization: true,
        description: 'reserved, disabled',
      },
    },
    reasoning_effort_catalog: {
      'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      'gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    legacy_compatibility: {
      default_profile: 'codex-terra-medium',
      description: 'test fixture legacy default',
    },
  };
}

test('the real canonical policy file loads and validates', () => {
  // Self-consistency check on the shipped policy -- not the fixture above.
  const policy = loadModelRoutingPolicy();
  assert.strictEqual(policy.schema_version, 1);
  assert.ok(policy.policy_version.length > 0);
  for (const name of ['codex-sol-high', 'codex-terra-medium', 'codex-luna-low', 'codex-sol-max']) {
    assert.ok(policy.profiles[name], `expected profile ${name} to be defined`);
  }
});

test('scenario 1: standard clear-scope T2 resolves to codex-terra-medium', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-terra-medium', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-terra');
  assert.strictEqual(result.model_routing?.reasoning_effort, 'medium');
  assert.strictEqual(result.model_routing?.selected_by, 'three-brain');
});

test('scenario 2: complex multi-package T2 resolves to codex-sol-high', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-sol-high', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-sol');
  assert.strictEqual(result.model_routing?.reasoning_effort, 'high');
});

test('scenario 3: failure-rescue lane resolves to codex-sol-high', () => {
  const policy = fixturePolicy();
  // Rescue is a use_case documented on codex-sol-high, not a distinct code path --
  // the routing rule itself lives in three-brain.md and selects this same profile.
  const result = resolveModelProfile({ profileName: 'codex-sol-high', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.ok(policy.profiles['codex-sol-high']!.use_cases.includes('failure-rescue-lane'));
});

test('scenario 4 & 19: codex-sol-max is rejected without an escalation override', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-sol-max', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'OVERRIDE_REQUIRED');
});

test('scenario 4: codex-sol-max succeeds with a valid, authorized override', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: 'griff', reason: 'stuck lane, sol-high failed twice' },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.selected_by, 'manual-override');
  assert.strictEqual(result.model_routing?.override?.authorized_by, 'griff');
});

test('scenario 19: manual override without authority is rejected', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: '', reason: 'stuck lane' },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'OVERRIDE_INVALID');
});

test('scenario 19: manual override without a reason is rejected', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: 'griff', reason: '' },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'OVERRIDE_INVALID');
});

test('scenario 5 & 9: codex-luna-low is disabled and fails closed by default', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-luna-low', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_DISABLED');
});

test('scenario 8: unknown profile fails closed', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-nonexistent', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_UNKNOWN');
});

test('profile not permitted for the requested tier fails closed', () => {
  const policy = fixturePolicy();
  // codex-terra-medium is T2-only in the fixture policy.
  const result = resolveModelProfile({ profileName: 'codex-terra-medium', tier: 'T1', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_NOT_PERMITTED_FOR_TIER');
});

test('scenario 11: invalid reasoning effort fails closed', () => {
  const policy = fixturePolicy();
  // Bypass loadModelRoutingPolicy's own load-time shape validation to exercise
  // resolveModelProfile's independent, defensive re-check of the effort catalog.
  policy.profiles['codex-terra-medium']!.reasoning_effort = 'ludicrous' as never;
  const result = resolveModelProfile({ profileName: 'codex-terra-medium', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'REASONING_EFFORT_INVALID');
});

test('scenario 10: manifest model drift from policy fails closed (tamper detection)', () => {
  const policy = fixturePolicy();
  const result = validatePersistedModelRouting(
    {
      profile: 'codex-terra-medium',
      model: 'gpt-9.9-fictional', // does not match what policy defines for this profile
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
    'T2',
    policy,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'MODEL_MISMATCH');
});

test('manifest reasoning_effort drift from policy fails closed', () => {
  const policy = fixturePolicy();
  const result = validatePersistedModelRouting(
    {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'ultra', // policy says medium for this profile
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
    'T2',
    policy,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'REASONING_EFFORT_INVALID');
});

test('scenario 12: policy-version mismatch is handled deterministically (fail closed)', () => {
  const policy = fixturePolicy();
  const result = validatePersistedModelRouting(
    {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '0.9.0', // stale
    },
    'T2',
    policy,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'POLICY_VERSION_MISMATCH');
});

test('validatePersistedModelRouting accepts a manifest that matches current policy exactly', () => {
  const policy = fixturePolicy();
  const result = validatePersistedModelRouting(
    {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
    'T2',
    policy,
  );
  assert.strictEqual(result.ok, true);
});

test('scenario 13: legacy manifest resolution is explicit and reports legacy_resolved', () => {
  const policy = fixturePolicy();
  const result = resolveLegacyModelRouting('T2', policy);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.profile, policy.legacy_compatibility.default_profile);
  assert.strictEqual(result.model_routing?.legacy_resolved, true);
});

test('scenario 14 & 15 & 17: buildCodexModelArgs always emits explicit --model and reasoning effort', () => {
  const args = buildCodexModelArgs({ model: 'gpt-5.6-terra', reasoning_effort: 'medium' });
  assert.deepStrictEqual(args, ['--model', 'gpt-5.6-terra', '-c', 'model_reasoning_effort=medium']);
  assert.ok(args.includes('--model'));
  assert.ok(args.some((a) => a.startsWith('model_reasoning_effort=')));
});

test('validateOverride rejects whitespace-only fields', () => {
  const result = validateOverride({ authorized_by: '   ', reason: 'valid reason' });
  assert.strictEqual(result.ok, false);
});

test('validateOverride accepts a well-formed override', () => {
  const result = validateOverride({ authorized_by: 'griff', reason: 'explicit escalation' });
  assert.strictEqual(result.ok, true);
});

test('validateOverride treats an absent override as valid (no override present)', () => {
  const result = validateOverride(undefined);
  assert.strictEqual(result.ok, true);
});

test('an override on a profile that does not require one is still structurally validated', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({
    profileName: 'codex-terra-medium',
    tier: 'T2',
    policy,
    override: { authorized_by: 'griff', reason: '' },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'OVERRIDE_INVALID');
});

test('loadModelRoutingPolicy throws on a missing file', () => {
  assert.throws(() => loadModelRoutingPolicy('/nonexistent/path/codex-model-routing.json'), /not found/);
});

test('loadModelRoutingPolicy rejects a profile whose reasoning_effort is outside its model catalog', () => {
  const policy = fixturePolicy();
  policy.profiles['codex-terra-medium']!.reasoning_effort = 'ultra-plus' as never;
  const tmpPath = path.join(os.tmpdir(), `codex-model-routing-fixture-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(policy));
  try {
    assert.throws(() => loadModelRoutingPolicy(tmpPath), /reasoning_effort_catalog/);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});
