import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runFablePilotRollback, verifyFableUnselectableAfterRollback } from './fable-pilot-rollback.js';
import { resolvePlanningModel, resolveFableAdvisoryReview, type FablePilotPolicy } from './planning-model-routing.js';
import type { FablePilotState } from './fable-pilot-state.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fable-pilot-rollback-test-'));
}

function activePolicy(): FablePilotPolicy {
  return {
    policy_version: 'test-1.0.0',
    schema_version: 1,
    pilot_enabled: true,
    default_model: 'claude-sonnet-5',
    default_profile: 'sonnet-default',
    fable_model: 'claude-fable-5',
    trigger_classes: {
      repeated_architecture_bounce: { enabled: true, profile: 'fable-pilot-advisory', description: 'x' },
      live_state_root_cause: { enabled: true, profile: 'fable-pilot-advisory', description: 'x' },
      product_synthesis_no_precedent: { enabled: true, profile: 'fable-pilot-advisory', description: 'x' },
      build_mode_certification_review: {
        enabled: true,
        profile: 'fable-pilot-certification-review',
        description: 'x',
      },
    },
    skip_list: [],
    caps: { max_qualifying_tasks: 8, max_days: 30, usage_ceiling_usd: 150, estimated_usage_per_task_usd: 15 },
    advisory_only: true,
    binding_authority: false,
    reviewer_independence_required: true,
    fallback_model: 'claude-sonnet-5',
  };
}

function activeState(): FablePilotState {
  const now = new Date('2026-07-21T00:00:00.000Z');
  return {
    schema_version: 1,
    status: 'active',
    activated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    max_tasks: 8,
    max_days: 30,
    usage_ceiling_usd: 150,
    task_count: 1,
    usage_used_usd: 5,
    qualifying_tasks: [],
    updated_at: now.toISOString(),
    updated_by: 'test',
    reason: 'test fixture: fully active, eligible pilot',
  };
}

function setup(): { dir: string; policyPath: string; statePath: string } {
  const dir = makeTmpDir();
  const policyPath = path.join(dir, 'fable-pilot-policy.json');
  const statePath = path.join(dir, 'FABLE_PILOT_STATE.json');
  fs.writeFileSync(policyPath, JSON.stringify(activePolicy()), 'utf8');
  fs.writeFileSync(statePath, JSON.stringify(activeState()), 'utf8');
  return { dir, policyPath, statePath };
}

test('SANITY: before rollback, an active + enabled pilot genuinely can select Fable (proves the test fixture is meaningful)', () => {
  const { policyPath, statePath } = setup();
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'repeated_architecture_bounce',
    rationale: 'pre-rollback sanity check',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.routing?.model, 'claude-fable-5');
});

test('runFablePilotRollback flips policy.pilot_enabled to false and state.status to "rolled_back"', () => {
  const { policyPath, statePath } = setup();
  const result = runFablePilotRollback({
    reason: 'test rollback',
    actor: 'test-suite',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.ok, true);

  const policyOnDisk = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as FablePilotPolicy;
  assert.strictEqual(policyOnDisk.pilot_enabled, false);

  const stateOnDisk = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(stateOnDisk.status, 'rolled_back');
});

test('THE PROOF: after runFablePilotRollback, Fable is unselectable for every one of the four ratified trigger classes', () => {
  const { policyPath, statePath } = setup();

  // Before rollback: sanity that at least one class currently resolves to Fable.
  const before = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'pre',
    policyPath,
    statePath,
  });
  assert.strictEqual(before.routing?.model, 'claude-fable-5');

  runFablePilotRollback({ reason: 'restore Rule-9-only state', actor: 'test-suite', policyPath, statePath });

  const verification = verifyFableUnselectableAfterRollback({ policyPath, statePath });
  assert.strictEqual(verification.ok, true, verification.details.join('\n'));

  // Direct re-assertion, not just trusting the helper: every trigger class, both
  // planning and advisory-review paths, must resolve to Sonnet post-rollback.
  for (const triggerClass of [
    'repeated_architecture_bounce',
    'live_state_root_cause',
    'product_synthesis_no_precedent',
    'build_mode_certification_review',
  ] as const) {
    const planning = resolvePlanningModel({
      tier: 'T1',
      triggerClass,
      rationale: 'post-rollback attempt',
      policyPath,
      statePath,
    });
    assert.strictEqual(planning.routing?.model, 'claude-sonnet-5', `planning for ${triggerClass} must fall back to Sonnet`);
    assert.strictEqual(planning.routing?.fallback_used, true);

    const review = resolveFableAdvisoryReview({
      tier: 'T1',
      triggerClass,
      rationale: 'post-rollback attempt',
      policyPath,
      statePath,
      reviewerIndependentOfAuthor: true,
    });
    assert.strictEqual(review.routing?.model, 'claude-sonnet-5', `review for ${triggerClass} must fall back to Sonnet`);
  }
});

test('rollback is idempotent: running it twice in a row is a no-op the second time and still ok:true', () => {
  const { policyPath, statePath } = setup();
  const first = runFablePilotRollback({ reason: 'first', actor: 'test-suite', policyPath, statePath });
  const second = runFablePilotRollback({ reason: 'second', actor: 'test-suite', policyPath, statePath });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.ok, true);
  assert.ok(second.actions.some((a) => a.includes('NO-OP') && a.includes('pilot_enabled')));
  assert.ok(second.actions.some((a) => a.includes('NO-OP') && a.includes('rolled_back')));
});

test('dryRun computes actions without writing any file', () => {
  const { policyPath, statePath } = setup();
  const before = fs.readFileSync(policyPath, 'utf8');
  const result = runFablePilotRollback({ reason: 'x', actor: 'y', policyPath, statePath, dryRun: true });
  assert.strictEqual(result.dry_run, true);
  const after = fs.readFileSync(policyPath, 'utf8');
  assert.strictEqual(before, after, 'dry run must not mutate the policy file');
});

test('rollback against a missing policy/state pair does not throw and still reports ok:true (a missing file already fails closed)', () => {
  const dir = makeTmpDir();
  const policyPath = path.join(dir, 'does-not-exist-policy.json');
  const statePath = path.join(dir, 'does-not-exist-state.json');
  const result = runFablePilotRollback({ reason: 'x', actor: 'y', policyPath, statePath });
  assert.strictEqual(result.ok, true);
});

test('dry-run rollback against the REAL shipped policy/state files: policy is already disabled (NO-OP), state is still "pending" (would transition to rolled_back, but dry run writes nothing)', () => {
  const result = runFablePilotRollback({ reason: 'test-only dry check', actor: 'test-suite', dryRun: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dry_run, true);
  // The real shipped policy already ships with pilot_enabled: false -- rollback's
  // policy step is already a no-op today, by design (the pilot was never activated).
  assert.ok(result.actions.some((a) => a.includes('NO-OP') && a.includes('pilot_enabled')));
  // The real shipped state is "pending" (never activated), not "rolled_back" -- a real
  // (non-dry) rollback run would still transition it to the terminal state, and this
  // dry run must report that intended action without writing it.
  assert.ok(result.actions.some((a) => a.includes('SET') && a.includes('"pending" -> "rolled_back"')));
});
