import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCodexModelArgs,
  loadModelRoutingPolicy,
  reconcileObservedModelRouting,
  reResolveModelRouting,
  verifyRoutingApproval,
  type RoutingApproval,
  type RoutingApprovalComment,
  resolveLegacyModelRouting,
  resolveModelProfile,
  validateOverride,
  validatePersistedModelRouting,
  validatePreMergeModelRoutingEvidence,
  type ModelRoutingBlock,
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
      'codex-luna-medium': {
        model: 'gpt-5.6-luna',
        reasoning_effort: 'medium',
        enabled: true,
        permitted_tiers: ['T2'],
        use_cases: ['clear-scope-t2-implementation'],
        requires_pm_authorization: false,
        description: 'default T2 profile',
      },
      'codex-sol-medium': {
        model: 'gpt-5.6-sol',
        reasoning_effort: 'medium',
        enabled: true,
        permitted_tiers: ['T1', 'T2'],
        use_cases: ['complex-t2-multi-file-or-multi-package', 'failure-rescue-lane'],
        requires_pm_authorization: false,
        description: 'complex work',
      },
      'codex-sol-high': {
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
        enabled: true,
        permitted_tiers: ['T1', 'T2'],
        use_cases: ['failure-rescue-lane'],
        requires_pm_authorization: false,
        description: 'rescue escalation',
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
        enabled: true,
        permitted_tiers: ['T2'],
        use_cases: ['fine-grained-edit'],
        requires_pm_authorization: false,
        description: 'narrow work',
      },
    },
    reasoning_effort_catalog: {
      'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    legacy_compatibility: {
      default_profile: 'codex-luna-medium',
      description: 'test fixture legacy default',
    },
  };
}

test('the real canonical policy file loads and validates', () => {
  // Self-consistency check on the shipped policy -- not the fixture above.
  const policy = loadModelRoutingPolicy();
  assert.strictEqual(policy.schema_version, 1);
  assert.ok(policy.policy_version.length > 0);
  for (const name of ['codex-luna-low', 'codex-luna-medium', 'codex-sol-medium', 'codex-sol-high', 'codex-astra-medium']) {
    assert.ok(policy.profiles[name], `expected profile ${name} to be defined`);
  }
  assert.deepStrictEqual(
    [policy.profiles['codex-luna-medium']!.model, policy.profiles['codex-luna-medium']!.reasoning_effort],
    ['gpt-6-luna', 'medium'],
  );
  assert.deepStrictEqual(
    [policy.profiles['codex-sol-medium']!.model, policy.profiles['codex-sol-medium']!.reasoning_effort],
    ['gpt-6.1-sol', 'medium'],
  );
  assert.strictEqual(policy.profiles['codex-astra-medium']!.enabled, false);
  assert.strictEqual(policy.profiles['codex-astra-medium']!.requires_pm_authorization, true);
  assert.strictEqual(policy.legacy_compatibility.default_profile, 'codex-luna-medium');
});

test('scenario 1: standard clear-scope T2 resolves to codex-luna-medium', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-luna-medium', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-luna');
  assert.strictEqual(result.model_routing?.reasoning_effort, 'medium');
  assert.strictEqual(result.model_routing?.selected_by, 'three-brain');
});

test('scenario 2: complex multi-package T2 resolves to codex-sol-medium', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-sol-medium', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-sol');
  assert.strictEqual(result.model_routing?.reasoning_effort, 'medium');
});

test('scenario 3: failure-rescue lane resolves to codex-sol-high', () => {
  const policy = fixturePolicy();
  // Rescue is a use_case documented on codex-sol-high, not a distinct code path --
  // the routing rule itself lives in three-brain.md and selects this same profile.
  const result = resolveModelProfile({ profileName: 'codex-sol-high', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.ok(policy.profiles['codex-sol-high']!.use_cases.includes('failure-rescue-lane'));
});

// PM review finding #3: a caller-supplied authorized_by/reason override is not proof of
// PM authorization -- it is self-asserted. codex-sol-max (requires_pm_authorization:
// true) is mechanically unavailable regardless of any override, until a trusted
// external authorization mechanism exists. This fixture deliberately sets
// codex-sol-max.enabled: true so these tests exercise the requires_pm_authorization
// rejection itself (defense in depth), independent of the real policy's enabled: false.

test('scenario 4 & 19: codex-sol-max is rejected with no override', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-sol-max', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'TRUSTED_AUTHORIZATION_UNAVAILABLE');
});

test('scenario 4 & 19: codex-sol-max is rejected even with a well-formed, "authorized" override', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: 'griff', reason: 'stuck lane, sol-high failed twice' },
  });
  assert.strictEqual(result.ok, false, 'a caller-supplied override must never unlock a requires_pm_authorization profile');
  assert.strictEqual(result.code, 'TRUSTED_AUTHORIZATION_UNAVAILABLE');
});

test('scenario 19: codex-sol-max is rejected the same way regardless of override content quality', () => {
  const policy = fixturePolicy();
  const withEmptyAuthority = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: '', reason: 'stuck lane' },
  });
  const withEmptyReason = resolveModelProfile({
    profileName: 'codex-sol-max',
    tier: 'T2',
    policy,
    override: { authorized_by: 'griff', reason: '' },
  });
  assert.strictEqual(withEmptyAuthority.ok, false);
  assert.strictEqual(withEmptyAuthority.code, 'TRUSTED_AUTHORIZATION_UNAVAILABLE');
  assert.strictEqual(withEmptyReason.ok, false);
  assert.strictEqual(withEmptyReason.code, 'TRUSTED_AUTHORIZATION_UNAVAILABLE');
});

test('the real canonical policy disables codex-sol-max as defense in depth beyond the code-level rejection', () => {
  const policy = loadModelRoutingPolicy();
  assert.strictEqual(policy.profiles['codex-sol-max']!.enabled, false);
  assert.strictEqual(policy.profiles['codex-sol-max']!.requires_pm_authorization, true);
});

test('scenario 5: codex-luna-low is enabled for narrow T2 work', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-luna-low', tier: 'T2', policy });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-luna');
  assert.strictEqual(result.model_routing?.reasoning_effort, 'low');
});

test('scenario 8: unknown profile fails closed', () => {
  const policy = fixturePolicy();
  const result = resolveModelProfile({ profileName: 'codex-nonexistent', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_UNKNOWN');
});

test('profile not permitted for the requested tier fails closed', () => {
  const policy = fixturePolicy();
  // codex-luna-medium is T2-only in the fixture policy.
  const result = resolveModelProfile({ profileName: 'codex-luna-medium', tier: 'T1', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_NOT_PERMITTED_FOR_TIER');
});

test('scenario 11: invalid reasoning effort fails closed', () => {
  const policy = fixturePolicy();
  // Bypass loadModelRoutingPolicy's own load-time shape validation to exercise
  // resolveModelProfile's independent, defensive re-check of the effort catalog.
  policy.profiles['codex-luna-medium']!.reasoning_effort = 'ludicrous' as never;
  const result = resolveModelProfile({ profileName: 'codex-luna-medium', tier: 'T2', policy });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'REASONING_EFFORT_INVALID');
});

test('scenario 10: manifest model drift from policy fails closed (tamper detection)', () => {
  const policy = fixturePolicy();
  const result = validatePersistedModelRouting(
    {
      profile: 'codex-luna-medium',
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
      profile: 'codex-luna-medium',
      model: 'gpt-5.6-luna',
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
      profile: 'codex-luna-medium',
      model: 'gpt-5.6-luna',
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
      profile: 'codex-luna-medium',
      model: 'gpt-5.6-luna',
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
  const args = buildCodexModelArgs({ model: 'gpt-5.6-luna', reasoning_effort: 'medium' });
  assert.deepStrictEqual(args, ['--model', 'gpt-5.6-luna', '-c', 'model_reasoning_effort=medium']);
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
    profileName: 'codex-luna-medium',
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
  policy.profiles['codex-luna-medium']!.reasoning_effort = 'ultra-plus' as never;
  const tmpPath = path.join(os.tmpdir(), `codex-model-routing-fixture-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(policy));
  try {
    assert.throws(() => loadModelRoutingPolicy(tmpPath), /reasoning_effort_catalog/);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
});

test('pre-merge sidecar contract rejects the real #1434/#1435 branch-SHA-as-merge shape', () => {
  for (const [issueId, branchSha] of [
    ['UTV2-1383', '825259a0b5279ab9c35508582ac1eedb5aa7398f'],
    ['UTV2-1667', '8856a4c1a089638e88fa12f251c2d1541afaad39'],
  ] as const) {
    const result = validatePreMergeModelRoutingEvidence({
      issue_id: issueId,
      merge_sha: branchSha,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      override_used: false,
    }, { expectedIssueId: issueId });
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((violation) => /top-level merge_sha is forbidden/.test(violation)));
  }
});

test('pre-merge sidecar contract accepts execution identity without claiming merge authority', () => {
  const result = validatePreMergeModelRoutingEvidence({
    issue_id: 'UTV2-1729',
    execution_sha: 'a'.repeat(40),
    model_profile: 'codex-sol-high',
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    policy_version: '1.0.0',
    override_used: false,
  }, {
    expectedIssueId: 'UTV2-1729',
    manifestRouting: {
      profile: 'codex-sol-high',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
  });
  assert.deepEqual(result, { valid: true, violations: [] });
});

// ── WORK-2026102902: reconciling a lane to the model its session reported running ──

const DECLARED: ModelRoutingBlock = {
  profile: 'codex-luna-medium',
  model: 'gpt-5.6-luna',
  reasoning_effort: 'medium',
  selected_by: 'three-brain',
  policy_version: '1.0.0',
};
const HEAD = 'a'.repeat(40);
const OBSERVED = { profile: 'session-default', model: 'gpt-6.1-sol', reasoning_effort: null, source: 'executor report in proof' };
const APPROVAL: RoutingApproval = {
  comment_url: 'https://github.com/o/r/pull/1800#issuecomment-1',
  reviewer: 'griff843',
  pr_number: 1800,
  head_sha: HEAD,
};
const NOW = '2026-10-29T12:00:00.000Z';
const CONTEXT = { repository: 'o/r', issueId: 'WORK-2026102806', prNumber: 1800, headSha: HEAD, model: 'gpt-6.1-sol', reasoningEffort: 'unavailable' };

function verdictComment(overrides: Partial<RoutingApprovalComment> = {}, body?: string): RoutingApprovalComment {
  return {
    html_url: APPROVAL.comment_url,
    issue_url: 'https://api.github.com/repos/o/r/issues/1800',
    user: { login: 'griff843', type: 'User' },
    body:
      body ??
      ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: WORK-2026102806', 'PR: 1800', `Head SHA: ${HEAD}`,
        'Routing reconciliation: gpt-6.1-sol / unavailable'].join('\n'),
    ...overrides,
  };
}

test('reconcileObservedModelRouting records the report as unverified, the unexposed effort as unavailable, and keeps the declaration', () => {
  const result = reconcileObservedModelRouting(DECLARED, OBSERVED, APPROVAL, NOW);
  assert.deepStrictEqual(result, {
    profile: 'session-default',
    model: 'gpt-6.1-sol',
    reasoning_effort: 'unavailable',
    selected_by: 'manual-override',
    policy_version: '1.0.0',
    override: {
      authorized_by: 'griff843',
      reason: `pm-verdict/v1 APPROVED ${APPROVAL.comment_url}`,
      at: NOW,
      declared: { profile: 'codex-luna-medium', model: 'gpt-5.6-luna', reasoning_effort: 'medium', selected_by: 'three-brain' },
      observation: { verification: 'unverified-external-session', source: 'executor report in proof', unavailable_fields: ['reasoning_effort'] },
      approval: APPROVAL,
    },
  });
});

test('a reported reasoning effort is recorded with no unavailable fields', () => {
  const result = reconcileObservedModelRouting(DECLARED, { ...OBSERVED, reasoning_effort: 'high' }, APPROVAL, NOW);
  assert.strictEqual(result.reasoning_effort, 'high');
  assert.deepStrictEqual(result.override?.observation?.unavailable_fields, []);
});

test('the unavailable sentinel cannot be passed off as an observed reasoning effort', () => {
  assert.throws(
    () => reconcileObservedModelRouting(DECLARED, { ...OBSERVED, reasoning_effort: 'Unavailable' }, APPROVAL, NOW),
    /is not an observed reasoning effort/,
  );
});

test('a second reconciliation keeps the first declaration', () => {
  const first = reconcileObservedModelRouting(DECLARED, OBSERVED, APPROVAL, NOW);
  const second = reconcileObservedModelRouting(first, { ...OBSERVED, reasoning_effort: 'high' }, APPROVAL, NOW);
  assert.strictEqual(second.reasoning_effort, 'high');
  assert.deepStrictEqual(second.override?.declared, first.override?.declared);
});

test('reconcileObservedModelRouting refuses a no-op and names every empty field', () => {
  assert.throws(
    () => reconcileObservedModelRouting(DECLARED, { profile: 'codex-luna-medium', model: 'gpt-5.6-luna', reasoning_effort: 'medium', source: 's' }, APPROVAL, NOW),
    /already equals the manifest model_routing/,
  );
  assert.throws(
    () => reconcileObservedModelRouting(DECLARED, { profile: ' ', model: '', reasoning_effort: ' ', source: '' }, APPROVAL, NOW),
    /requires non-empty profile, model, source, reasoning_effort$/,
  );
});

test('verifyRoutingApproval takes the reviewer from the GitHub comment author', () => {
  assert.deepStrictEqual(verifyRoutingApproval(verdictComment(), CONTEXT), APPROVAL);
});

test('adversarial: approvals that are forged, stale, misdirected or for other values are refused', () => {
  const refuse = (comment: RoutingApprovalComment, pattern: RegExp, context = CONTEXT) =>
    assert.throws(() => verifyRoutingApproval(comment, context), pattern);
  refuse(verdictComment({ user: { login: 'mallory', type: 'User' } }), /"mallory" is not a CODEOWNERS reviewer/);
  refuse(verdictComment({ user: { login: 'griff843', type: 'Bot' } }), /is a bot/);
  refuse(verdictComment({ user: null }), /not a CODEOWNERS reviewer/);
  refuse(verdictComment({}, 'authorized_by: griff843\nRouting reconciliation: gpt-6.1-sol / unavailable'), /not a pm-verdict\/v1 verdict/);
  refuse(
    verdictComment({}, verdictComment().body!.replace('PM_VERDICT: APPROVED', 'PM_VERDICT: CHANGES_REQUIRED')),
    /verdict is CHANGES_REQUIRED/,
  );
  refuse(verdictComment({}, verdictComment().body!.replace('WORK-2026102806', 'WORK-2026102807')), /Issue WORK-2026102807 is not/);
  refuse(verdictComment({}, verdictComment().body!.replace('PR: 1800', 'PR: 1801')), /PR 1801 is not #1800/);
  refuse(verdictComment(), /is not the PR head/, { ...CONTEXT, headSha: 'b'.repeat(40) });
  refuse(verdictComment(), /does not contain the line "Routing reconciliation: gpt-6.1-sol \/ medium"/, { ...CONTEXT, reasoningEffort: 'medium' });
  refuse(verdictComment(), /Routing reconciliation: gpt-5.6-sol/, { ...CONTEXT, model: 'gpt-5.6-sol' });
});

test('adversarial: a genuine matching verdict posted on a different PR or repository is refused', () => {
  const refuse = (overrides: Partial<RoutingApprovalComment>, pattern: RegExp) =>
    assert.throws(() => verifyRoutingApproval(verdictComment(overrides), CONTEXT), pattern);
  refuse(
    { issue_url: 'https://api.github.com/repos/o/r/issues/1799', html_url: 'https://github.com/o/r/pull/1799#issuecomment-1' },
    /comment is on https:\/\/api.github.com\/repos\/o\/r\/issues\/1799, not .*issues\/1800/,
  );
  refuse({ issue_url: 'https://api.github.com/repos/o/r/issues/1799' }, /comment is on .*issues\/1799/);
  refuse({ html_url: 'https://github.com/o/r/pull/1799#issuecomment-1' }, /is not on o\/r PR #1800/);
  refuse(
    { issue_url: 'https://api.github.com/repos/x/r/issues/1800', html_url: 'https://github.com/x/r/pull/1800#issuecomment-1' },
    /comment is on https:\/\/api.github.com\/repos\/x\/r\/issues\/1800/,
  );
  refuse({ issue_url: undefined }, /comment is on <no issue_url>/);
  refuse({ html_url: 'https://github.com/o/r/pull/18000#issuecomment-1' }, /is not on o\/r PR #1800/);
});

function honestSidecar(reconciled: ModelRoutingBlock) {
  return {
    issue_id: 'WORK-2026102806',
    model_profile: reconciled.profile,
    model: reconciled.model,
    reasoning_effort: reconciled.reasoning_effort,
    policy_version: '1.0.0',
    override_used: true,
    override_authorized_by: 'griff843',
    execution_verification: 'unverified-external-session',
    unavailable_fields: ['reasoning_effort'],
  };
}

test('a reconciled manifest accepts only a sidecar that carries the unverified flag and unavailable fields', () => {
  const reconciled = reconcileObservedModelRouting(DECLARED, OBSERVED, APPROVAL, NOW);
  assert.deepStrictEqual(
    validatePreMergeModelRoutingEvidence(honestSidecar(reconciled), { expectedIssueId: 'WORK-2026102806', manifestRouting: reconciled }),
    { valid: true, violations: [] },
  );
});

test('adversarial: fabricated sidecars cannot pass against a reconciled manifest', () => {
  const reconciled = reconcileObservedModelRouting(DECLARED, OBSERVED, APPROVAL, NOW);
  const violations = (sidecar: Record<string, unknown>) =>
    validatePreMergeModelRoutingEvidence(sidecar, { manifestRouting: reconciled }).violations;
  const honest = honestSidecar(reconciled);
  assert.ok(violations({ ...honest, execution_verification: 'verified' }).some((v) => v.startsWith('execution_verification')));
  const { execution_verification: _dropped, ...unflagged } = honest;
  assert.ok(violations(unflagged).some((v) => v.startsWith('execution_verification')));
  assert.ok(violations({ ...honest, reasoning_effort: 'medium', unavailable_fields: [] }).includes('reasoning_effort does not match manifest model_routing'));
  assert.ok(violations({ ...honest, unavailable_fields: [] }).some((v) => v.startsWith('unavailable_fields')));
  assert.ok(violations({ ...honest, override_authorized_by: 'mallory' }).some((v) => v.startsWith('override_authorized_by')));
  assert.ok(
    violations({ ...honest, model_profile: 'codex-luna-medium', model: 'gpt-5.6-luna', reasoning_effort: 'medium', override_used: false })
      .includes('model does not match manifest model_routing'),
  );
});

test('codex-exec refuses a reconciled lane even when the reported values match a policy profile', () => {
  const reconciled = reconcileObservedModelRouting(
    DECLARED,
    { profile: 'codex-sol-medium', model: 'gpt-5.6-sol', reasoning_effort: 'medium', source: 's' },
    APPROVAL,
    NOW,
  );
  const result = validatePersistedModelRouting(reconciled, 'T2', fixturePolicy());
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'RECONCILED_OBSERVATION');
});

// ── WORK-2026102906: re-resolve a lane's routing onto a new policy version ──

function nextPolicy(): ModelRoutingPolicy {
  const policy = fixturePolicy();
  policy.policy_version = '2.0.0';
  policy.profiles['codex-luna-medium']!.model = 'gpt-6-luna';
  policy.profiles['codex-sol-high']!.model = 'gpt-6.1-sol';
  policy.reasoning_effort_catalog['gpt-6-luna'] = ['low', 'medium', 'high'];
  policy.reasoning_effort_catalog['gpt-6.1-sol'] = ['low', 'medium', 'high', 'max'];
  return policy;
}

const PINNED_V1: ModelRoutingBlock = {
  profile: 'codex-luna-medium',
  model: 'gpt-5.6-luna',
  reasoning_effort: 'medium',
  selected_by: 'three-brain',
  policy_version: '1.0.0',
};

test('re-resolve moves a stranded lane to the current policy, same profile, and codex-exec then accepts it', () => {
  const policy = nextPolicy();
  assert.strictEqual(validatePersistedModelRouting(PINNED_V1, 'T2', policy).code, 'POLICY_VERSION_MISMATCH');
  const next = reResolveModelRouting(PINNED_V1, 'T2', NOW, policy);
  assert.deepStrictEqual(next, {
    profile: 'codex-luna-medium',
    model: 'gpt-6-luna',
    reasoning_effort: 'medium',
    selected_by: 'three-brain',
    policy_version: '2.0.0',
    re_resolutions: [
      { from_policy_version: '1.0.0', from_model: 'gpt-5.6-luna', from_reasoning_effort: 'medium', to_policy_version: '2.0.0', at: NOW },
    ],
  });
  assert.strictEqual(validatePersistedModelRouting(next, 'T2', policy).ok, true);
});

test('re-resolve appends to earlier re-resolutions and keeps an audit override', () => {
  const policy = nextPolicy();
  const earlier = { from_policy_version: '0.9.0', from_model: 'm', from_reasoning_effort: 'medium', to_policy_version: '1.0.0', at: 'then' };
  const override = { authorized_by: 'griff843', reason: 'operator chose high' };
  const next = reResolveModelRouting(
    { ...PINNED_V1, profile: 'codex-sol-high', model: 'gpt-5.6-sol', reasoning_effort: 'high', selected_by: 'manual-override', override, re_resolutions: [earlier] },
    'T1',
    NOW,
    policy,
  );
  assert.strictEqual(next.model, 'gpt-6.1-sol');
  assert.strictEqual(next.selected_by, 'manual-override');
  assert.deepStrictEqual(next.override, override);
  assert.deepStrictEqual(next.re_resolutions?.map((r) => r.to_policy_version), ['1.0.0', '2.0.0']);
});

test('adversarial: re-resolve never substitutes a profile the new policy removed, disabled or denies the tier', () => {
  const removed = nextPolicy();
  delete removed.profiles['codex-luna-medium'];
  removed.legacy_compatibility.default_profile = 'codex-luna-low';
  assert.throws(() => reResolveModelRouting(PINNED_V1, 'T2', NOW, removed), /PROFILE_UNKNOWN/);
  const disabled = nextPolicy();
  disabled.profiles['codex-luna-medium']!.enabled = false;
  assert.throws(() => reResolveModelRouting(PINNED_V1, 'T2', NOW, disabled), /PROFILE_DISABLED/);
  assert.throws(() => reResolveModelRouting(PINNED_V1, 'T1', NOW, nextPolicy()), /PROFILE_NOT_PERMITTED_FOR_TIER/);
  const gated = nextPolicy();
  gated.profiles['codex-luna-medium']!.requires_pm_authorization = true;
  assert.throws(() => reResolveModelRouting(PINNED_V1, 'T2', NOW, gated), /TRUSTED_AUTHORIZATION_UNAVAILABLE/);
});

test('re-resolve refuses a reconciled lane and a lane already on the current policy', () => {
  const reconciled = reconcileObservedModelRouting(DECLARED, OBSERVED, APPROVAL, NOW);
  assert.throws(() => reResolveModelRouting(reconciled, 'T2', NOW, nextPolicy()), /reconciled to an observed execution/);
  assert.throws(() => reResolveModelRouting(PINNED_V1, 'T2', NOW, fixturePolicy()), /already on policy version 1\.0\.0/);
});
