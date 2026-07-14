import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexModelArgs, loadModelRoutingPolicy } from './model-routing.js';
import { buildModelRoutingEvidence, commitAndPushEvidence, resolveExecModelRouting } from './codex-exec.js';
import { ROOT } from './shared.js';

// codex-exec.ts is an executable entry point — its `main()` process/spawn flow is
// exercised via integration (pnpm ops:codex-exec --dry-run, which requires a live Codex
// CLI). The pure resolution/evidence/arg-building helpers below are fully unit-testable
// without spawning Codex or making any paid model call.

const REAL_POLICY_VERSION = loadModelRoutingPolicy().policy_version;

test('codex-exec module imports without error', async () => {
  assert.ok(true, 'module structure valid');
});

test('resolveExecModelRouting validates a manifest that already carries model_routing', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: REAL_POLICY_VERSION,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.legacy_compatibility_used, false);
  assert.strictEqual(result.model_routing?.model, 'gpt-5.6-terra');
});

test('scenario 13: schema_version-1 legacy manifest (no model_routing) resolves via the documented default and is flagged', () => {
  const result = resolveExecModelRouting({ tier: 'T2', schema_version: 1, model_routing: undefined });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.legacy_compatibility_used, true);
  assert.strictEqual(result.model_routing?.legacy_resolved, true);
  assert.ok(result.model_routing?.model, 'legacy resolution must still produce a concrete model');
});

// PM review finding #2 (deletion attack): a schema_version-2 manifest with
// model_routing missing must fail closed, NEVER silently fall back to the legacy
// default. Presence alone cannot distinguish "predates the field" from "was deleted" --
// schema_version is what makes that distinction real.
test('schema_version-2 manifest with model_routing deleted/missing fails closed, does not fall back to legacy', () => {
  const result = resolveExecModelRouting({ tier: 'T2', schema_version: 2, model_routing: undefined });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.legacy_compatibility_used, false);
  assert.strictEqual(result.code, 'MODEL_ROUTING_REQUIRED_FOR_SCHEMA_VERSION');
});

test('resolveExecModelRouting fails closed on a policy-version mismatch', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '0.0.1-stale',
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'POLICY_VERSION_MISMATCH');
});

test('resolveExecModelRouting fails closed on a disabled profile', () => {
  const result = resolveExecModelRouting({
    tier: 'T2',
    schema_version: 2,
    model_routing: {
      profile: 'codex-luna-low',
      model: 'gpt-5.6-luna',
      reasoning_effort: 'low',
      selected_by: 'three-brain',
      policy_version: REAL_POLICY_VERSION,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PROFILE_DISABLED');
});

test('scenario 14, 15 & 17: buildCodexModelArgs never falls back to a Codex CLI default', () => {
  const args = buildCodexModelArgs({ model: 'gpt-5.6-sol', reasoning_effort: 'high' });
  assert.deepStrictEqual(args, ['--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high']);
  assert.ok(args.includes('--model'));
  assert.ok(args.some((a) => a.startsWith('model_reasoning_effort=')));
});

test('scenario 8: buildModelRoutingEvidence records all required evidence fields', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-sol-high',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
    legacyCompatibilityUsed: false,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: 0,
    now: '2026-07-13T00:00:00.000Z',
  });
  assert.strictEqual(evidence.issue_id, 'UTV2-1526');
  assert.strictEqual(evidence.model_profile, 'codex-sol-high');
  assert.strictEqual(evidence.model, 'gpt-5.6-sol');
  assert.strictEqual(evidence.reasoning_effort, 'high');
  assert.strictEqual(evidence.policy_version, '1.0.0');
  assert.strictEqual(evidence.codex_cli_version, 'codex-cli 0.144.1');
  assert.strictEqual(evidence.legacy_compatibility_used, false);
  assert.strictEqual(evidence.override_used, false);
  assert.strictEqual(evidence.codex_exit_code, 0);
});

test('buildModelRoutingEvidence records override authority when a manual override was used', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-sol-max',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'max',
      selected_by: 'manual-override',
      policy_version: '1.0.0',
      override: { authorized_by: 'griff', reason: 'stuck lane escalation' },
    },
    legacyCompatibilityUsed: false,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: 1,
  });
  assert.strictEqual(evidence.override_used, true);
  assert.strictEqual(evidence.override_authorized_by, 'griff');
  assert.strictEqual(evidence.codex_exit_code, 1);
});

test('buildModelRoutingEvidence marks legacy resolutions explicitly', () => {
  const evidence = buildModelRoutingEvidence({
    issueId: 'UTV2-1526',
    manifestSchemaVersion: 1,
    modelRouting: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
      legacy_resolved: true,
    },
    legacyCompatibilityUsed: true,
    codexCliVersion: 'codex-cli 0.144.1',
    codexExitCode: null,
  });
  assert.strictEqual(evidence.legacy_compatibility_used, true);
  assert.strictEqual(evidence.codex_exit_code, null);
});

// PM review finding #4: the evidence sidecar must be committed and pushed by
// codex-exec.ts itself -- Codex's own commit/push already happened before this file
// even exists, so nothing else on the branch would ever pick it up otherwise.
test('commitAndPushEvidence publishes a first-push lane branch and establishes its upstream', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-evidence-'));
  const bareRemote = path.join(tmpRoot, 'origin.git');
  const workingRepo = path.join(tmpRoot, 'work');
  try {
    // --initial-branch and an explicit HEAD symref make this independent of the
    // runner's init.defaultBranch config (CI runners often default to something other
    // than "main", which left the bare repo's HEAD pointing nowhere and the later
    // fresh-clone verification checking out an empty tree).
    spawnSync('git', ['init', '--bare', '--initial-branch=main', bareRemote], { stdio: 'pipe' });
    spawnSync('git', ['-C', bareRemote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'pipe' });
    spawnSync('git', ['clone', bareRemote, workingRepo], { stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-B', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    fs.writeFileSync(path.join(workingRepo, 'README.md'), 'seed\n');
    spawnSync('git', ['add', 'README.md'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-b', 'codex/utv2-9999-first-push'], { cwd: workingRepo, stdio: 'pipe' });

    fs.mkdirSync(path.join(workingRepo, 'docs', '06_status', 'proof', 'UTV2-9999'), { recursive: true });
    const evidenceRelPath = 'docs/06_status/proof/UTV2-9999/model-routing.json';
    fs.writeFileSync(path.join(workingRepo, evidenceRelPath), '{"ok":true}\n');

    const result = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): UTV2-9999 model-routing evidence');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.step, 'push');

    // Prove it reached the new remote lane branch and that subsequent bare pushes can
    // rely on the upstream established by the helper.
    const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
      cwd: workingRepo,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.strictEqual(upstream.status, 0);
    assert.strictEqual(upstream.stdout.trim(), 'origin/codex/utv2-9999-first-push');
    const freshClone = path.join(tmpRoot, 'verify-clone');
    spawnSync('git', ['clone', '--branch', 'codex/utv2-9999-first-push', bareRemote, freshClone], { stdio: 'pipe' });
    const cloned = fs.readFileSync(path.join(freshClone, evidenceRelPath), 'utf8');
    assert.match(cloned, /"ok":true/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('commitAndPushEvidence is idempotent -- a second call with unchanged content reports "none" rather than failing', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-evidence-idempotent-'));
  const bareRemote = path.join(tmpRoot, 'origin.git');
  const workingRepo = path.join(tmpRoot, 'work');
  try {
    spawnSync('git', ['init', '--bare', bareRemote], { stdio: 'pipe' });
    spawnSync('git', ['clone', bareRemote, workingRepo], { stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: workingRepo, stdio: 'pipe' });
    fs.writeFileSync(path.join(workingRepo, 'README.md'), 'seed\n');
    spawnSync('git', ['add', 'README.md'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'seed'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-b', 'main'], { cwd: workingRepo, stdio: 'pipe' });
    spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: workingRepo, stdio: 'pipe' });

    fs.mkdirSync(path.join(workingRepo, 'docs', '06_status', 'proof', 'UTV2-9998'), { recursive: true });
    const evidenceRelPath = 'docs/06_status/proof/UTV2-9998/model-routing.json';
    fs.writeFileSync(path.join(workingRepo, evidenceRelPath), '{"ok":true}\n');

    const first = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): first');
    assert.strictEqual(first.ok, true);

    const second = commitAndPushEvidence(workingRepo, evidenceRelPath, 'chore(proof): second');
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.step, 'none');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// Ordering (PM review finding #4): a successful execution must never leave dangling
// evidence. Prove structurally that commitAndPushEvidence is called, and its result
// checked, BEFORE either the SUCCESS or EXECUTION_FAILED result is emitted.
test('codex-exec.ts persists evidence before emitting either a SUCCESS or EXECUTION_FAILED result', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'codex-exec.ts'), 'utf8');

  const persistCallIndex = source.indexOf('commitAndPushEvidence(');
  assert.notStrictEqual(persistCallIndex, -1, 'expected codex-exec.ts to call commitAndPushEvidence');

  const executionFailedIndex = source.indexOf("code: 'EXECUTION_FAILED'", persistCallIndex);
  const evidencePersistenceFailedIndex = source.indexOf("code: 'EVIDENCE_PERSISTENCE_FAILED'", persistCallIndex);
  const successIndex = source.indexOf("code: 'SUCCESS'", persistCallIndex);

  assert.notStrictEqual(executionFailedIndex, -1);
  assert.notStrictEqual(evidencePersistenceFailedIndex, -1);
  assert.notStrictEqual(successIndex, -1);

  assert.ok(persistCallIndex < executionFailedIndex, 'evidence must be persisted before the EXECUTION_FAILED result is emitted');
  assert.ok(
    persistCallIndex < evidencePersistenceFailedIndex,
    'evidence persistence must be attempted before its own failure is reported',
  );
  assert.ok(
    evidencePersistenceFailedIndex < successIndex,
    'a persistence failure must be checked and reported BEFORE a SUCCESS result could ever be emitted -- ' +
      'this is what prevents a successful Codex run with a dangling, uncommitted evidence file from being reported READY_FOR_REVIEW',
  );
});
