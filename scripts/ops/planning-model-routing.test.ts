import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FABLE_PILOT_POLICY_PATH,
  loadFablePilotPolicy,
  resolvePlanningModel,
  resolveFableAdvisoryReview,
  resolveAndRecordPlanningModel,
  resolveAndRecordFableAdvisoryReview,
  toAgentModelOverride,
  type FablePilotPolicy,
} from './planning-model-routing.js';
import type { FablePilotState } from './fable-pilot-state.js';
import { ROOT } from './shared.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'planning-model-routing-test-'));
}

function writePolicy(dir: string, policy: FablePilotPolicy): string {
  const filePath = path.join(dir, 'fable-pilot-policy.json');
  fs.writeFileSync(filePath, JSON.stringify(policy), 'utf8');
  return filePath;
}

function writeState(dir: string, state: FablePilotState): string {
  const filePath = path.join(dir, 'FABLE_PILOT_STATE.json');
  fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');
  return filePath;
}

function basePolicy(overrides: Partial<FablePilotPolicy> = {}): FablePilotPolicy {
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
    skip_list: ['routine_coding', 'manifest_bookkeeping', 'proof_rebinding', 'ci_cleanup', 'mechanical_reconciliation'],
    caps: { max_qualifying_tasks: 8, max_days: 30, usage_ceiling_usd: 150, estimated_usage_per_task_usd: 15 },
    advisory_only: true,
    binding_authority: false,
    reviewer_independence_required: true,
    fallback_model: 'claude-sonnet-5',
    ...overrides,
  };
}

function activeState(overrides: Partial<FablePilotState> = {}): FablePilotState {
  const now = new Date('2026-07-21T00:00:00.000Z');
  return {
    schema_version: 1,
    status: 'active',
    activated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    max_tasks: 8,
    max_days: 30,
    usage_ceiling_usd: 150,
    task_count: 0,
    usage_used_usd: 0,
    qualifying_tasks: [],
    updated_at: now.toISOString(),
    updated_by: 'test',
    reason: 'test fixture',
    ...overrides,
  };
}

function pendingState(): FablePilotState {
  return activeState({ status: 'pending', activated_at: null, expires_at: null });
}

test('FABLE_PILOT_POLICY_PATH points at the canonical docs/05_operations/policies location', () => {
  assert.strictEqual(
    FABLE_PILOT_POLICY_PATH,
    path.join(ROOT, 'docs', '05_operations', 'policies', 'fable-pilot-policy.json'),
  );
});

test('the real shipped fable-pilot-policy.json loads, validates, and has pilot_enabled: false', () => {
  const policy = loadFablePilotPolicy();
  assert.strictEqual(policy.schema_version, 1);
  assert.strictEqual(policy.pilot_enabled, false);
  assert.strictEqual(policy.default_model, 'claude-sonnet-5');
  for (const cls of [
    'repeated_architecture_bounce',
    'live_state_root_cause',
    'product_synthesis_no_precedent',
    'build_mode_certification_review',
  ] as const) {
    assert.ok(policy.trigger_classes[cls], `missing trigger class ${cls}`);
  }
});

test('resolvePlanningModel with no triggerClass always returns Sonnet, regardless of tier', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  for (const tier of ['T1', 'T2', 'T3']) {
    const result = resolvePlanningModel({ tier, rationale: 'ordinary work', policyPath });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.code, 'OK_SONNET_DEFAULT');
    assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
    assert.strictEqual(result.routing?.fallback_used, false);
  }
});

test('resolvePlanningModel never considers Fable for a non-T1 tier, even with a valid trigger class', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const result = resolvePlanningModel({
    tier: 'T2',
    triggerClass: 'live_state_root_cause',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
});

test('resolvePlanningModel selects Fable only when policy enabled + trigger class enabled + pilot state active-within-caps', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'repeated_architecture_bounce',
    rationale: '2x CHANGES_REQUIRED on the same architectural question',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.routing?.model, 'claude-fable-5');
  assert.strictEqual(result.routing?.fallback_used, false);
  assert.strictEqual(result.routing?.profile, 'fable-pilot-advisory');
});

test('resolvePlanningModel falls back to Sonnet when pilot_enabled is false (the rollback kill switch)', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy({ pilot_enabled: false }));
  const statePath = writeState(dir, activeState());
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'repeated_architecture_bounce',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'FALLBACK_POLICY_DISABLED');
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
  assert.strictEqual(result.routing?.fallback_used, true);
  assert.strictEqual(result.routing?.requested_model, 'claude-fable-5');
});

test('resolvePlanningModel falls back to Sonnet when the pilot state is "pending" (not yet activated)', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, pendingState());
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'live_state_root_cause',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'FALLBACK_PILOT_NOT_ELIGIBLE');
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
  assert.strictEqual(result.routing?.fallback_used, true);
});

test('resolvePlanningModel falls back to Sonnet when the pilot state has expired caps even if status still says active', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState({ task_count: 8 }));
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'product_synthesis_no_precedent',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'FALLBACK_PILOT_NOT_ELIGIBLE');
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
});

test('resolvePlanningModel rejects an unknown trigger class and falls back to Sonnet', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'i_made_this_up',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'FALLBACK_UNKNOWN_TRIGGER_CLASS');
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
});

test('resolvePlanningModel refuses every skip-listed class regardless of pilot eligibility', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  for (const skipped of ['routine_coding', 'manifest_bookkeeping', 'proof_rebinding', 'ci_cleanup', 'mechanical_reconciliation']) {
    const result = resolvePlanningModel({
      tier: 'T1',
      triggerClass: skipped,
      rationale: 'x',
      policyPath,
      statePath,
    });
    assert.strictEqual(result.code, 'FALLBACK_SKIP_LISTED', `expected skip-listed fallback for ${skipped}`);
    assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
  }
});

test('resolvePlanningModel falls back when an individual trigger class is disabled in policy even though pilot_enabled is true', () => {
  const dir = makeTmpDir();
  const policy = basePolicy();
  policy.trigger_classes.build_mode_certification_review.enabled = false;
  const policyPath = writePolicy(dir, policy);
  const statePath = writeState(dir, activeState());
  const result = resolvePlanningModel({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'x',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'FALLBACK_TRIGGER_CLASS_DISABLED');
  assert.strictEqual(result.routing?.model, 'claude-sonnet-5');
});

test('resolveFableAdvisoryReview refuses to resolve without reviewer_independent_of_author: true, no override exists', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const result = resolveFableAdvisoryReview({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'x',
    policyPath,
    statePath,
    reviewerIndependentOfAuthor: false,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'FALLBACK_MISSING_REVIEWER_INDEPENDENCE');
  assert.strictEqual(result.routing, undefined);
});

test('resolveFableAdvisoryReview resolves normally once reviewer_independent_of_author is true and the pilot is eligible', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const result = resolveFableAdvisoryReview({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'independent certification review',
    policyPath,
    statePath,
    reviewerIndependentOfAuthor: true,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.routing?.model, 'claude-fable-5');
});

test('toAgentModelOverride maps claude-fable-5 to "fable" and claude-sonnet-5 to "sonnet"', () => {
  assert.strictEqual(toAgentModelOverride('claude-fable-5'), 'fable');
  assert.strictEqual(toAgentModelOverride('claude-sonnet-5'), 'sonnet');
});

test('resolvePlanningModel never throws on a missing/malformed policy file -- fails closed with POLICY_LOAD_FAILED', () => {
  const dir = makeTmpDir();
  const missingPath = path.join(dir, 'does-not-exist.json');
  const result = resolvePlanningModel({ tier: 'T1', rationale: 'x', policyPath: missingPath });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'POLICY_LOAD_FAILED');
});

// ── resolveAndRecordPlanningModel (UTV2-1569 PR #1292 fix: a real Fable selection must ──
// ── atomically record task_count/usage_used_usd in the SAME call, never a separate step ──

test('resolveAndRecordPlanningModel records a qualifying task and persists it when Fable is genuinely selected', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());

  const before = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(before.task_count, 0);
  assert.strictEqual(before.usage_used_usd, 0);

  const result = resolveAndRecordPlanningModel({
    tier: 'T1',
    triggerClass: 'repeated_architecture_bounce',
    rationale: '2x CHANGES_REQUIRED on the same architectural question',
    taskId: 'UTV2-9001',
    policyPath,
    statePath,
  });

  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.routing?.model, 'claude-fable-5');
  assert.strictEqual(result.pilotStateRecorded, true);

  const after = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(after.task_count, 1);
  assert.strictEqual(after.usage_used_usd, 15);
  assert.strictEqual(after.qualifying_tasks.length, 1);
  assert.strictEqual(after.qualifying_tasks[0]!.task_id, 'UTV2-9001');
});

test('resolveAndRecordPlanningModel does NOT touch the state file when the resolution falls back to Sonnet', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy({ pilot_enabled: false }));
  const statePath = writeState(dir, activeState());
  const before = fs.readFileSync(statePath, 'utf8');

  const result = resolveAndRecordPlanningModel({
    tier: 'T1',
    triggerClass: 'repeated_architecture_bounce',
    rationale: 'x',
    taskId: 'UTV2-9002',
    policyPath,
    statePath,
  });

  assert.strictEqual(result.code, 'FALLBACK_POLICY_DISABLED');
  assert.strictEqual(result.pilotStateRecorded, false);
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before);
});

test('resolveAndRecordPlanningModel mechanically expires the pilot the moment the 8th qualifying task is recorded through this path', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState({ task_count: 7 }));

  const result = resolveAndRecordPlanningModel({
    tier: 'T1',
    triggerClass: 'live_state_root_cause',
    rationale: 'x',
    taskId: 'UTV2-9008',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.pilotStateRecorded, true);

  const after = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(after.task_count, 8);
  assert.strictEqual(after.status, 'expired');

  // A subsequent selection attempt must now fall back to Sonnet -- the cap is real.
  const nextAttempt = resolveAndRecordPlanningModel({
    tier: 'T1',
    triggerClass: 'live_state_root_cause',
    rationale: 'x',
    taskId: 'UTV2-9009',
    policyPath,
    statePath,
  });
  assert.strictEqual(nextAttempt.routing?.model, 'claude-sonnet-5');
  assert.strictEqual(nextAttempt.pilotStateRecorded, false);
});

test('resolveAndRecordFableAdvisoryReview refuses (no state write) without reviewer_independent_of_author: true', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());
  const before = fs.readFileSync(statePath, 'utf8');

  const result = resolveAndRecordFableAdvisoryReview({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'x',
    taskId: 'UTV2-9011',
    policyPath,
    statePath,
    reviewerIndependentOfAuthor: false,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'FALLBACK_MISSING_REVIEWER_INDEPENDENCE');
  assert.strictEqual(result.pilotStateRecorded, false);
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before);
});

test('resolveAndRecordFableAdvisoryReview records a qualifying task when reviewer independence is asserted and the pilot is eligible', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState());

  const result = resolveAndRecordFableAdvisoryReview({
    tier: 'T1',
    triggerClass: 'build_mode_certification_review',
    rationale: 'certification packet review',
    taskId: 'UTV2-9012',
    policyPath,
    statePath,
    reviewerIndependentOfAuthor: true,
  });
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  assert.strictEqual(result.pilotStateRecorded, true);

  const after = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(after.task_count, 1);
  assert.strictEqual(after.qualifying_tasks[0]!.task_id, 'UTV2-9012');
});

test('resolveAndRecordPlanningModel mechanically expires the pilot when usage crosses the ceiling in the same recorded call', () => {
  const dir = makeTmpDir();
  const policyPath = writePolicy(dir, basePolicy());
  const statePath = writeState(dir, activeState({ usage_used_usd: 140, usage_ceiling_usd: 150 }));

  const result = resolveAndRecordPlanningModel({
    tier: 'T1',
    triggerClass: 'product_synthesis_no_precedent',
    rationale: 'x',
    taskId: 'UTV2-9010',
    policyPath,
    statePath,
  });
  assert.strictEqual(result.code, 'OK_FABLE_SELECTED');
  const after = JSON.parse(fs.readFileSync(statePath, 'utf8')) as FablePilotState;
  assert.strictEqual(after.usage_used_usd, 155);
  assert.strictEqual(after.status, 'expired');
});
