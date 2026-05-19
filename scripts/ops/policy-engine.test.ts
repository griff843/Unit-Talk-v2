import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionsMatch, evaluate, loadPolicies, pathMatchesGlob } from './policy-engine.js';
import type { PolicyEvalContext } from './policy-engine.js';

// ---------------------------------------------------------------------------
// pathMatchesGlob unit tests
// ---------------------------------------------------------------------------

test('pathMatchesGlob: exact match', () => {
  assert.equal(pathMatchesGlob('apps/api/src/auth.ts', 'apps/api/src/auth.ts'), true);
  assert.equal(pathMatchesGlob('apps/api/src/auth.ts', 'apps/api/src/other.ts'), false);
});

test('pathMatchesGlob: ** wildcard', () => {
  assert.equal(pathMatchesGlob('apps/worker/**', 'apps/worker/src/index.ts'), true);
  assert.equal(pathMatchesGlob('apps/worker/**', 'apps/worker/src/adapters/discord.ts'), true);
  assert.equal(pathMatchesGlob('apps/worker/**', 'apps/api/src/index.ts'), false);
  assert.equal(pathMatchesGlob('packages/domain/src/**', 'packages/domain/src/lifecycle/fsm.ts'), true);
  assert.equal(pathMatchesGlob('supabase/migrations/**', 'supabase/migrations/20260101_init.sql'), true);
});

test('pathMatchesGlob: * single-segment wildcard', () => {
  assert.equal(pathMatchesGlob('apps/*/src/index.ts', 'apps/worker/src/index.ts'), true);
  assert.equal(pathMatchesGlob('apps/*/src/index.ts', 'apps/api/src/index.ts'), true);
  assert.equal(pathMatchesGlob('apps/*/src/index.ts', 'apps/api/src/other.ts'), false);
});

// ---------------------------------------------------------------------------
// conditionsMatch unit tests
// ---------------------------------------------------------------------------

test('conditionsMatch: tier filter matches', () => {
  const conditions = { tier: ['T1' as const] };
  const ctx: PolicyEvalContext = { trigger: 'dispatch', tier: 'T1' };
  assert.equal(conditionsMatch(conditions, ctx), true);
});

test('conditionsMatch: tier filter rejects wrong tier', () => {
  const conditions = { tier: ['T1' as const] };
  const ctx: PolicyEvalContext = { trigger: 'dispatch', tier: 'T2' };
  assert.equal(conditionsMatch(conditions, ctx), false);
});

test('conditionsMatch: paths filter matches when any path matches any glob', () => {
  const conditions = { paths: ['apps/worker/**'] };
  const ctx: PolicyEvalContext = { trigger: 'dispatch', paths: ['apps/worker/src/foo.ts'] };
  assert.equal(conditionsMatch(conditions, ctx), true);
});

test('conditionsMatch: paths filter rejects when no path matches', () => {
  const conditions = { paths: ['apps/worker/**'] };
  const ctx: PolicyEvalContext = { trigger: 'dispatch', paths: ['apps/api/src/foo.ts'] };
  assert.equal(conditionsMatch(conditions, ctx), false);
});

test('conditionsMatch: empty conditions always match', () => {
  const conditions = {};
  const ctx: PolicyEvalContext = { trigger: 'dispatch' };
  assert.equal(conditionsMatch(conditions, ctx), true);
});

test('conditionsMatch: work_class filter', () => {
  const conditions = { work_class: ['dangerous'] };
  assert.equal(conditionsMatch(conditions, { trigger: 'dispatch', work_class: 'dangerous' }), true);
  assert.equal(conditionsMatch(conditions, { trigger: 'dispatch', work_class: 'safe' }), false);
  assert.equal(conditionsMatch(conditions, { trigger: 'dispatch' }), false);
});

// ---------------------------------------------------------------------------
// Engine loading — uses actual policy files from docs/05_operations/policies/
// ---------------------------------------------------------------------------

test('loadPolicies: loads all policy files and returns a non-empty array', () => {
  const policies = loadPolicies();
  assert.ok(policies.length > 0, `Expected at least 1 policy, got ${policies.length}`);
  for (const p of policies) {
    assert.ok(p.id, `Policy missing id: ${JSON.stringify(p)}`);
    assert.ok(p.trigger, `Policy ${p.id} missing trigger`);
    assert.ok(Array.isArray(p.actions), `Policy ${p.id} actions must be an array`);
    assert.equal(typeof p.escalate_to_griff, 'boolean', `Policy ${p.id} escalate_to_griff must be boolean`);
  }
});

test('loadPolicies: each policy id is unique', () => {
  const policies = loadPolicies();
  const ids = policies.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, `Duplicate policy ids found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
});

// ---------------------------------------------------------------------------
// evaluate: T1 triggers escalate_to_griff
// ---------------------------------------------------------------------------

test('evaluate: T1 dispatch triggers t1-route-to-claude with escalate_to_griff=true', () => {
  const ctx: PolicyEvalContext = { trigger: 'dispatch', tier: 'T1' };
  const results = evaluate(ctx);
  const t1Route = results.find((r) => r.policy_id === 't1-route-to-claude');
  assert.ok(t1Route, 't1-route-to-claude policy should match for T1 dispatch');
  assert.equal(t1Route.escalate_to_griff, true);
  assert.ok(t1Route.actions.includes('route_to_claude'));
});

test('evaluate: T1 pr_open triggers t1-pm-merge-gate with escalate_to_griff=true', () => {
  const ctx: PolicyEvalContext = { trigger: 'pr_open', tier: 'T1' };
  const results = evaluate(ctx);
  const mergeGate = results.find((r) => r.policy_id === 't1-pm-merge-gate');
  assert.ok(mergeGate, 't1-pm-merge-gate should match for T1 pr_open');
  assert.equal(mergeGate.escalate_to_griff, true);
  assert.ok(mergeGate.actions.includes('require_pm_verdict'));
  assert.ok(mergeGate.actions.includes('require_test_db'));
});

// ---------------------------------------------------------------------------
// evaluate: non-matching context returns empty
// ---------------------------------------------------------------------------

test('evaluate: codex_return trigger with no policies defined returns empty', () => {
  const ctx: PolicyEvalContext = { trigger: 'codex_return' };
  const results = evaluate(ctx);
  // No policies currently define codex_return trigger
  assert.equal(results.length, 0, 'No policies should match codex_return trigger');
});

test('evaluate: T3 dispatch with no sensitive paths returns no escalations', () => {
  const ctx: PolicyEvalContext = { trigger: 'dispatch', tier: 'T3', paths: ['scripts/ops/foo.ts'] };
  const results = evaluate(ctx);
  const escalations = results.filter((r) => r.escalate_to_griff);
  assert.equal(escalations.length, 0, 'T3 on non-sensitive path should not escalate to Griff');
});

// ---------------------------------------------------------------------------
// evaluate: sensitive path triggers Tier C policy
// ---------------------------------------------------------------------------

test('evaluate: dispatch touching apps/worker/** triggers tier-c-sensitive-paths', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'dispatch',
    paths: ['apps/worker/src/delivery-adapter.ts'],
  };
  const results = evaluate(ctx);
  const tierC = results.find((r) => r.policy_id === 'tier-c-sensitive-paths');
  assert.ok(tierC, 'tier-c-sensitive-paths should match for apps/worker path');
  assert.equal(tierC.escalate_to_griff, true);
  assert.ok(tierC.actions.includes('require_pm_plan'));
  assert.ok(tierC.actions.includes('block_codex'));
});

test('evaluate: dispatch touching packages/domain/src/** triggers tier-c-sensitive-paths', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'dispatch',
    paths: ['packages/domain/src/lifecycle/fsm.ts'],
  };
  const results = evaluate(ctx);
  const tierC = results.find((r) => r.policy_id === 'tier-c-sensitive-paths');
  assert.ok(tierC, 'tier-c-sensitive-paths should match for packages/domain path');
});

// ---------------------------------------------------------------------------
// evaluate: post-merge QA trigger
// ---------------------------------------------------------------------------

test('evaluate: T2 post_merge on apps/worker triggers post-merge-qa', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'post_merge',
    tier: 'T2',
    paths: ['apps/worker/src/index.ts'],
  };
  const results = evaluate(ctx);
  const qa = results.find((r) => r.policy_id === 'post-merge-qa-runtime-delivery');
  assert.ok(qa, 'post-merge-qa-runtime-delivery should match');
  assert.ok(qa.actions.includes('pnpm qa:experience'));
  assert.equal(qa.escalate_to_griff, false);
});

test('evaluate: T1 post_merge on apps/worker does NOT trigger post-merge-qa (T1 only)', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'post_merge',
    tier: 'T1',
    paths: ['apps/worker/src/index.ts'],
  };
  const results = evaluate(ctx);
  const qa = results.find((r) => r.policy_id === 'post-merge-qa-runtime-delivery');
  assert.equal(qa, undefined, 'post-merge-qa should not match T1 (only T2/T3)');
});

// ---------------------------------------------------------------------------
// evaluate: codex concurrency policies
// ---------------------------------------------------------------------------

test('evaluate: safe-class Codex dispatch triggers slot-limit check', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'dispatch',
    executor: 'codex-cli',
    work_class: 'safe',
  };
  const results = evaluate(ctx);
  const slotCheck = results.find((r) => r.policy_id === 'codex-safe-class-slot-limit');
  assert.ok(slotCheck, 'codex-safe-class-slot-limit should match');
  assert.ok(slotCheck.actions.includes('check_slot_limit'));
});

test('evaluate: dangerous-class dispatch triggers singleton enforcement', () => {
  const ctx: PolicyEvalContext = {
    trigger: 'dispatch',
    work_class: 'dangerous',
  };
  const results = evaluate(ctx);
  const singleton = results.find((r) => r.policy_id === 'codex-dangerous-class-singleton');
  assert.ok(singleton, 'codex-dangerous-class-singleton should match');
  assert.ok(singleton.actions.includes('enforce_singleton'));
});
