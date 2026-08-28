import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createManifest,
  defaultProofPaths,
  deriveDeliveryUiApp,
  mergeVerifierIdentity,
  normalizeFileScopePath,
  normalizeRepoRelativePath,
  requireIssueId,
  requireVerificationTarget,
  validateBranchName,
  validateManifest,
  worktreePathForBranch,
} from './shared.js';

test('normalizeFileScopePath canonicalizes repo-relative file paths', () => {
  const normalized = normalizeFileScopePath('.\\docs\\05_operations\\EXECUTION_TRUTH_MODEL.md');
  assert.strictEqual(normalized, 'docs/05_operations/EXECUTION_TRUTH_MODEL.md');
});

test('normalizeFileScopePath rejects parent traversal', () => {
  assert.throws(
    () => normalizeFileScopePath('../docs/05_operations/EXECUTION_TRUTH_MODEL.md'),
    /Parent traversal is not allowed/,
  );
});

test('normalizeFileScopePath accepts non-existent proof paths without requiring existence', () => {
  // Proof paths are intent declarations — the lane will create them.
  // They must not throw even when the file does not exist on disk.
  const normalized = normalizeFileScopePath(
    'docs/06_status/proof/UTV2-9999/diff-summary.md',
  );
  assert.strictEqual(normalized, 'docs/06_status/proof/UTV2-9999/diff-summary.md');
});

test('normalizeFileScopePath accepts the guard-supported trailing directory glob', () => {
  assert.strictEqual(normalizeFileScopePath('scripts/ops/**'), 'scripts/ops/**');
});

test('normalizeFileScopePath accepts literal bracketed route paths', () => {
  assert.strictEqual(
    normalizeFileScopePath('apps/command-center/src/app/picks/[id]/page.tsx'),
    'apps/command-center/src/app/picks/[id]/page.tsx',
  );
});

test('normalizeFileScopePath rejects unsupported glob syntax', () => {
  assert.throws(
    () => normalizeFileScopePath('scripts/*/shared.ts'),
    /Only a trailing \/\*\* directory glob is allowed/,
  );
});

test('normalizeFileScopePath still rejects parent traversal for proof paths', () => {
  assert.throws(
    () => normalizeFileScopePath('../docs/06_status/proof/UTV2-9999/diff-summary.md'),
    /Parent traversal is not allowed/,
  );
});

test('normalizeRepoRelativePath allows canonical deleted-file style paths', () => {
  const normalized = normalizeRepoRelativePath('docs/06_status/lanes/deleted-file.json');
  assert.strictEqual(normalized, 'docs/06_status/lanes/deleted-file.json');
});

test('validateBranchName enforces ratified branch format', () => {
  assert.doesNotThrow(() => validateBranchName('codex/utv2-539-truth-check'));
  assert.throws(() => validateBranchName('Codex/UTV2-539-truth-check'), /lowercase/);
  assert.throws(() => validateBranchName('codex/utv2-539'), /<owner>\/<issue-id-lowercase>-<slug>/);
});

test('defaultProofPaths are tier-aware', () => {
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T1'), ['docs/06_status/proof/UTV2-539/evidence.json']);
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T2'), [
    'docs/06_status/proof/UTV2-539/diff-summary.md',
    'docs/06_status/proof/UTV2-539/verification.md',
  ]);
  assert.deepStrictEqual(defaultProofPaths('UTV2-539', 'T3'), []);
});

test('validateManifest accepts a canonical done status manifest', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-539',
    tier: 'T2',
    branch: 'codex/utv2-539-truth-check',
    worktree_path: worktreePathForBranch('codex/utv2-539-truth-check'),
    file_scope_lock: ['docs/05_operations/EXECUTION_TRUTH_MODEL.md'],
    expected_proof_paths: defaultProofPaths('UTV2-539', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-539-truth-check.json',
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  const errors = validateManifest(manifest);
  assert.deepStrictEqual(errors, []);
});

test('validateManifest accepts a supported directory glob and literal bracketed route', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1531',
    tier: 'T2',
    branch: 'codex/utv2-1531-file-scope-debt',
    worktree_path: worktreePathForBranch('codex/utv2-1531-file-scope-debt'),
    file_scope_lock: ['scripts/ops/**', 'apps/command-center/src/app/picks/[id]/page.tsx'],
    expected_proof_paths: defaultProofPaths('UTV2-1531', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1531-file-scope-debt.json',
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();

  assert.deepStrictEqual(validateManifest(manifest), []);
});

test('validateManifest rejects dispatch-auto for active lane manifests', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1025',
    tier: 'T2',
    branch: 'codex/utv2-1025-preflight-token-validation',
    worktree_path: worktreePathForBranch('codex/utv2-1025-preflight-token-validation'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1025', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1025-preflight-token-validation.json',
  });
  manifest.preflight_token = 'dispatch-auto';

  assert.match(
    validateManifest(manifest).join('\n'),
    /preflight_token must reference a real preflight token file, not dispatch-auto/,
  );
});

test('validateManifest preserves legacy closed dispatch-auto compatibility', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1026',
    tier: 'T2',
    branch: 'codex/utv2-1026-legacy-token',
    worktree_path: worktreePathForBranch('codex/utv2-1026-legacy-token'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1026', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1026-legacy-token.json',
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  manifest.preflight_token = 'dispatch-auto';

  assert.deepStrictEqual(validateManifest(manifest), []);
});

test('createManifest can require a real preflight token file for lane starts', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1027',
        tier: 'T2',
        branch: 'codex/utv2-1027-missing-token',
        worktree_path: worktreePathForBranch('codex/utv2-1027-missing-token'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1027', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1027-missing-token.json',
        requireExistingPreflightToken: true,
      }),
    /preflight_token file does not exist/,
  );
});

test('createManifest requires model_routing for a Codex lane (UTV2-1526)', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1526',
        tier: 'T2',
        branch: 'codex/utv2-1526-no-routing',
        worktree_path: worktreePathForBranch('codex/utv2-1526-no-routing'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1526', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1526-no-routing.json',
        executor: 'codex-cli',
      }),
    /requires a model_routing decision at creation time/,
  );
});

// PM review finding #2: the schema_version boundary, not field presence, is the real
// legacy-compatibility discriminator. A schema_version-1 fixture (constructed the way a
// pre-UTV2-1526 manifest actually looked) may omit model_routing even for a Codex
// executor -- this is the one sanctioned reason to pass schema_version explicitly.
test('createManifest allows a schema_version-1 Codex fixture to omit model_routing (legacy compatibility)', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1531',
    tier: 'T2',
    branch: 'codex/utv2-1531-legacy-fixture',
    worktree_path: worktreePathForBranch('codex/utv2-1531-legacy-fixture'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1531', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1531-legacy-fixture.json',
    executor: 'codex-cli',
    schema_version: 1,
  });
  assert.strictEqual(manifest.schema_version, 1);
  assert.strictEqual(manifest.model_routing, undefined);
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  assert.deepStrictEqual(validateManifest(manifest), []);
});

// PM review finding #2 (the core deletion-attack fix): simulate a schema_version-2
// Codex manifest that HAD model_routing and lost it -- indistinguishable from "never
// had it" under the old presence-only design, but now caught by schema_version.
test('validateManifest rejects a schema_version-2 Codex manifest with model_routing deleted', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1532',
    tier: 'T2',
    branch: 'codex/utv2-1532-deletion-attack',
    worktree_path: worktreePathForBranch('codex/utv2-1532-deletion-attack'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1532', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1532-deletion-attack.json',
    executor: 'codex-cli',
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
  });
  assert.strictEqual(manifest.schema_version, 2);
  // Simulate deletion: someone hand-edits the manifest JSON to remove model_routing.
  delete (manifest as { model_routing?: unknown }).model_routing;
  assert.match(
    validateManifest(manifest).join('\n'),
    /schema_version 2 Codex-executor manifest is missing model_routing/,
  );
});

test('createManifest rejects an unknown schema_version outright', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1533',
        tier: 'T2',
        branch: 'codex/utv2-1533-bad-version',
        worktree_path: worktreePathForBranch('codex/utv2-1533-bad-version'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1533-bad-version.json',
        // @ts-expect-error -- intentionally invalid to prove fail-closed behavior
        schema_version: 3,
      }),
    /Invalid schema_version/,
  );
});

test('validateManifest rejects an unknown schema_version outright', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1534',
    tier: 'T2',
    branch: 'codex/utv2-1534-bad-version-write',
    worktree_path: worktreePathForBranch('codex/utv2-1534-bad-version-write'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1534', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1534-bad-version-write.json',
  });
  (manifest as { schema_version: number }).schema_version = 3;
  assert.match(validateManifest(manifest).join('\n'), /schema_version must be one of 1, 2/);
});

test('createManifest rejects model_routing on a Claude lane (UTV2-1526)', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1526',
        tier: 'T2',
        branch: 'claude/utv2-1526-with-routing',
        worktree_path: worktreePathForBranch('claude/utv2-1526-with-routing'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1526', 'T2'),
        preflight_token: '.out/ops/preflight/claude/utv2-1526-with-routing.json',
        executor: 'claude',
        model_routing: {
          profile: 'codex-terra-medium',
          model: 'gpt-5.6-terra',
          reasoning_effort: 'medium',
          selected_by: 'three-brain',
          policy_version: '1.0.0',
        },
      }),
    /model_routing is Codex-only/,
  );
});

test('createManifest accepts a Codex lane with a valid model_routing block', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1526',
    tier: 'T2',
    branch: 'codex/utv2-1526-with-routing',
    worktree_path: worktreePathForBranch('codex/utv2-1526-with-routing'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1526', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1526-with-routing.json',
    executor: 'codex-cli',
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
  });
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  assert.deepStrictEqual(validateManifest(manifest), []);
  assert.strictEqual(manifest.model_routing?.profile, 'codex-terra-medium');
});

test('validateManifest rejects a model_routing block manually attached to a Claude manifest', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1528',
    tier: 'T2',
    branch: 'claude/utv2-1528-tamper',
    worktree_path: worktreePathForBranch('claude/utv2-1528-tamper'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1528', 'T2'),
    preflight_token: '.out/ops/preflight/claude/utv2-1528-tamper.json',
    executor: 'claude',
  });
  // Simulate a hand-edited manifest bypassing createManifest's own guard —
  // validateManifest must independently reject this on every write.
  (manifest as { model_routing?: unknown }).model_routing = {
    profile: 'codex-terra-medium',
    model: 'gpt-5.6-terra',
    reasoning_effort: 'medium',
    selected_by: 'three-brain',
    policy_version: '1.0.0',
  };
  assert.match(validateManifest(manifest).join('\n'), /model_routing is Codex-only/);
});

test('validateManifest rejects a structurally incomplete model_routing block', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1529',
    tier: 'T2',
    branch: 'codex/utv2-1529-bad-routing',
    worktree_path: worktreePathForBranch('codex/utv2-1529-bad-routing'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1529', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1529-bad-routing.json',
    executor: 'codex-cli',
    model_routing: {
      profile: 'codex-terra-medium',
      model: 'gpt-5.6-terra',
      reasoning_effort: 'medium',
      selected_by: 'three-brain',
      policy_version: '1.0.0',
    },
  });
  (manifest as { model_routing?: { selected_by?: unknown } }).model_routing!.selected_by = 'because-i-said-so';
  assert.match(
    validateManifest(manifest).join('\n'),
    /model_routing.selected_by must be "three-brain" or "manual-override"/,
  );
});

test('validateManifest rejects an override block missing authority or reason', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1530',
    tier: 'T1',
    branch: 'codex/utv2-1530-bad-override',
    worktree_path: worktreePathForBranch('codex/utv2-1530-bad-override'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1530', 'T1'),
    preflight_token: '.out/ops/preflight/codex/utv2-1530-bad-override.json',
    executor: 'codex-cli',
    model_routing: {
      profile: 'codex-sol-max',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'max',
      selected_by: 'manual-override',
      policy_version: '1.0.0',
      override: { authorized_by: '', reason: '' },
    },
  });
  const errors = validateManifest(manifest).join('\n');
  assert.match(errors, /model_routing.override.authorized_by is required/);
  assert.match(errors, /model_routing.override.reason is required/);
});

test('validateManifest accepts Windows absolute worktree paths on non-Windows runners', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1062',
    tier: 'T2',
    branch: 'codex/utv2-1062-cross-platform-closeout',
    worktree_path: 'C:/Dev/Unit-Talk-v2-main',
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1062', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1062-cross-platform-closeout.json',
  });
  manifest.status = 'merged';
  manifest.created_by = 'codex-cli';
  manifest.execution_location = {
    mode: 'main-control',
    cwd: 'C:\\Dev\\Unit-Talk-v2-main',
    package_install: 'not_required',
  };

  const errors = validateManifest(manifest).filter((entry) =>
    entry.includes('worktree_path') || entry.includes('execution_location.cwd'),
  );
  assert.deepStrictEqual(errors, []);
});

// ── verification_target (UTV2-1533 P2 fix) — mirrors the model_routing pattern above ──

test('createManifest requires verification_target for a verification lane (UTV2-1533)', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1533',
        tier: 'T2',
        branch: 'codex/utv2-1533-no-target',
        worktree_path: worktreePathForBranch('codex/utv2-1533-no-target'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1533-no-target.json',
        lane_type: 'verification',
      }),
    /requires a verification_target at creation time/,
  );
});

test('createManifest allows a schema_version-1 verification fixture to omit verification_target (legacy compatibility)', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1533',
    tier: 'T2',
    branch: 'codex/utv2-1533-legacy-verification',
    worktree_path: worktreePathForBranch('codex/utv2-1533-legacy-verification'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1533-legacy-verification.json',
    lane_type: 'verification',
    schema_version: 1,
  });
  assert.strictEqual(manifest.schema_version, 1);
  assert.strictEqual(manifest.verification_target, undefined);
  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  assert.deepStrictEqual(validateManifest(manifest), []);
});

test('validateManifest rejects a schema_version-2 verification manifest with verification_target deleted', () => {
  const manifest = createManifest({
    issue_id: 'UTV2-1533',
    tier: 'T2',
    branch: 'codex/utv2-1533-deletion-attack',
    worktree_path: worktreePathForBranch('codex/utv2-1533-deletion-attack'),
    file_scope_lock: ['scripts/ops/shared.ts'],
    expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
    preflight_token: '.out/ops/preflight/codex/utv2-1533-deletion-attack.json',
    lane_type: 'verification',
    verification_target: 'UTV2-9001',
  });
  assert.strictEqual(manifest.schema_version, 2);
  delete (manifest as { verification_target?: unknown }).verification_target;
  assert.match(
    validateManifest(manifest).join('\n'),
    /schema_version 2 verification-type manifest is missing verification_target/,
  );
});

test('createManifest rejects verification_target on a non-verification lane', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1533',
        tier: 'T2',
        branch: 'codex/utv2-1533-misapplied-target',
        worktree_path: worktreePathForBranch('codex/utv2-1533-misapplied-target'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1533-misapplied-target.json',
        lane_type: 'hygiene',
        verification_target: 'UTV2-9001',
      }),
    /verification_target is verification-lane-only/,
  );
});

test('createManifest rejects a malformed verification_target', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1533',
        tier: 'T2',
        branch: 'codex/utv2-1533-bad-target',
        worktree_path: worktreePathForBranch('codex/utv2-1533-bad-target'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1533-bad-target.json',
        lane_type: 'verification',
        verification_target: 'not-an-issue-id',
      }),
    /verification_target must match UTV2-###/,
  );
});

// Codex review fix (PR #1215, round 6): verification_target is documented UTV2-### only
// (lane_manifest_v1.schema.json, LANE_MANIFEST_SPEC.md §16) -- reusing the general
// requireIssueId()/ISSUE_PATTERN (which also accepts UNI-###) would silently let a UNI target
// pass despite disagreeing with the documented schema.
test('createManifest rejects a UNI-prefixed verification_target (UTV2-### only, not the general issue-id pattern)', () => {
  assert.throws(
    () =>
      createManifest({
        issue_id: 'UTV2-1533',
        tier: 'T2',
        branch: 'codex/utv2-1533-uni-target',
        worktree_path: worktreePathForBranch('codex/utv2-1533-uni-target'),
        file_scope_lock: ['scripts/ops/shared.ts'],
        expected_proof_paths: defaultProofPaths('UTV2-1533', 'T2'),
        preflight_token: '.out/ops/preflight/codex/utv2-1533-uni-target.json',
        lane_type: 'verification',
        verification_target: 'UNI-123',
      }),
    /verification_target must match UTV2-###/,
  );
});

test('requireVerificationTarget rejects UNI-### even though requireIssueId accepts it', () => {
  assert.doesNotThrow(() => requireIssueId('uni-123'), 'sanity check: the general helper accepts UNI-###');
  assert.throws(
    () => requireVerificationTarget('uni-123'),
    /verification_target must match UTV2-###/,
    'requireVerificationTarget must reject UNI-### -- it is deliberately stricter than requireIssueId',
  );
  assert.strictEqual(requireVerificationTarget('utv2-1533'), 'UTV2-1533', 'valid lower-case UTV2 input must still normalize to upper-case');
});

// ── deriveDeliveryUiApp (UTV2-1533 P2 fix) ─────────────────────────────────────────

test('deriveDeliveryUiApp identifies the single app for a scoped Delivery/UI lane', () => {
  assert.strictEqual(
    deriveDeliveryUiApp(['apps/command-center/src/app/page.tsx', 'apps/command-center/src/components/Card.tsx']),
    'command-center',
  );
  assert.strictEqual(deriveDeliveryUiApp(['apps/discord-bot/src/formatter.ts']), 'discord-bot');
  assert.strictEqual(deriveDeliveryUiApp(['apps/smart-form/src/flow.ts']), 'smart-form');
  assert.strictEqual(deriveDeliveryUiApp(['apps/qa-agent/src/scaffold.ts']), 'qa-agent');
});

test('deriveDeliveryUiApp fails closed on empty scope', () => {
  assert.strictEqual(deriveDeliveryUiApp([]), null);
});

test('deriveDeliveryUiApp fails closed when scope spans more than one app', () => {
  assert.strictEqual(
    deriveDeliveryUiApp(['apps/command-center/src/app/page.tsx', 'apps/discord-bot/src/formatter.ts']),
    null,
  );
});

test('deriveDeliveryUiApp fails closed when a path is outside any canonical app root', () => {
  assert.strictEqual(
    deriveDeliveryUiApp(['apps/command-center/src/app/page.tsx', 'scripts/ops/shared.ts']),
    null,
  );
});

// ── mergeVerifierIdentity (UTV2-1642) ──────────────────────────────────────────

test('mergeVerifierIdentity preserves every pre-existing field, only setting identity', () => {
  const existing = {
    identity: 'stale-identity',
    method: 'every count is quoted alongside the exact SQL that produced it',
    verifier_scope: 'verifies the classifier behaviour only',
    independence_note: 'measured in the opposite direction, not by narrative',
  };
  const merged = mergeVerifierIdentity(existing, 'claude/utv2-1642-proof-repair');
  assert.deepStrictEqual(merged, {
    ...existing,
    identity: 'claude/utv2-1642-proof-repair',
  });
});

test('mergeVerifierIdentity degrades to a bare object when there is no prior verifier', () => {
  assert.deepStrictEqual(mergeVerifierIdentity(undefined, 'claude/x'), { identity: 'claude/x' });
  assert.deepStrictEqual(mergeVerifierIdentity(null, 'claude/x'), { identity: 'claude/x' });
});

test('mergeVerifierIdentity treats non-object existing values (string/array) as absent, not as content to spread', () => {
  assert.deepStrictEqual(mergeVerifierIdentity('not-an-object', 'claude/x'), { identity: 'claude/x' });
  assert.deepStrictEqual(mergeVerifierIdentity(['a', 'b'], 'claude/x'), { identity: 'claude/x' });
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1634: authoritative active-lane discovery.
//
// readAllManifests() reads only the local working tree, but an active lane's
// manifest lives on its own PR branch until it merges. That made the governor
// fail OPEN -- an empty board and a full board were indistinguishable.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActiveLaneDiscoveryError,
  activeManifestOverlap,
  classifyLaneCapacity,
  issueIdFromBranchName,
  issueToManifestPath,
  readAllManifestEntries,
  readAllManifestPaths,
  readAllManifests,
  readManifestAtRef,
  resolveActiveLaneManifests,
  writeJsonFile,
  writeManifestAtPath,
  type LaneManifest,
  type LaneManifestLocation,
  type OpenPullRequestRef,
} from './shared.js';

function laneManifest(overrides: Partial<LaneManifest> & { issue_id: string }): LaneManifest {
  return {
    schema_version: 2,
    lane_type: 'governance',
    executor: 'claude',
    tier: 'T2',
    worktree_path: `/tmp/${overrides.issue_id}`,
    branch: `claude/${overrides.issue_id.toLowerCase()}-slug`,
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: [],
    expected_proof_paths: [],
    status: 'in_progress',
    started_at: '2026-07-31T00:00:00.000Z',
    heartbeat_at: '2026-07-31T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'dispatch-auto',
    created_by: 'claude',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  } as LaneManifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1682: parked lanes are visible-but-uncounted, independent of location.
// Their file-scope locks remain an orthogonal conflict constraint.
// ─────────────────────────────────────────────────────────────────────────────

test('UTV2-1682: local manifest discovery recursively includes the parked directory', () => {
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1682-manifests-'));
  try {
    const parkedDir = path.join(manifestDir, 'parked');
    fs.mkdirSync(parkedDir);
    fs.writeFileSync(
      path.join(manifestDir, 'UTV2-16820.json'),
      JSON.stringify(laneManifest({ issue_id: 'UTV2-16820', status: 'in_progress' })),
    );
    fs.writeFileSync(
      path.join(parkedDir, 'UTV2-16821.json'),
      JSON.stringify(laneManifest({ issue_id: 'UTV2-16821', status: 'parked' })),
    );

    assert.deepStrictEqual(
      readAllManifestPaths(manifestDir).map((filePath) => path.relative(manifestDir, filePath)),
      ['parked/UTV2-16821.json', 'UTV2-16820.json'],
    );
    assert.deepStrictEqual(
      readAllManifests(manifestDir).map((manifest) => manifest.issue_id).sort(),
      ['UTV2-16820', 'UTV2-16821'],
    );
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
  }
});

test('UTV2-1682: PR-head lookup falls back from the root path to the parked path', () => {
  const lookedUpPaths: string[] = [];
  const parked = laneManifest({ issue_id: 'UTV2-16822', status: 'parked' });
  const lookup = readManifestAtRef('UTV2-16822', 'codex/utv2-16822-parked', {
    readManifestAtPath: (_issueId, _ref, manifestPath) => {
      lookedUpPaths.push(manifestPath);
      return manifestPath.includes('/parked/') ? parked : null;
    },
  });

  assert.deepStrictEqual(lookedUpPaths, [
    'docs/06_status/lanes/UTV2-16822.json',
    'docs/06_status/lanes/parked/UTV2-16822.json',
  ]);
  assert.strictEqual(lookup?.manifest, parked);
  assert.strictEqual(lookup?.location, 'lanes_parked');
});

test('UTV2-1682: unreadable parked fallback cannot degrade into absence', () => {
  const lookedUpPaths: string[] = [];
  assert.throws(
    () =>
      readManifestAtRef('UTV2-16823', 'codex/utv2-16823-parked', {
        readManifestAtPath: (_issueId, _ref, manifestPath) => {
          lookedUpPaths.push(manifestPath);
          if (!manifestPath.includes('/parked/')) return null;
          throw new Error('HTTP 500 reading parked population');
        },
      }),
    /HTTP 500 reading parked population/,
  );
  assert.strictEqual(lookedUpPaths.length, 2, 'an unknown parked read must throw, never return null');
});

function discoverParkedAt(location: LaneManifestLocation) {
  const parked = laneManifest({
    issue_id: 'UTV2-16824',
    status: 'parked',
    file_scope_lock: ['scripts/ops/shared.ts'],
  });
  return resolveActiveLaneManifests({
    listOpenPullRequests: () => [],
    readLocalManifestEntries: () => [{ manifest: parked, location }],
  });
}

test('UTV2-1682: a parked lane is visible-but-uncounted in either manifest location', () => {
  const root = discoverParkedAt('lanes_root');
  const relocated = discoverParkedAt('lanes_parked');

  for (const discovery of [root, relocated]) {
    assert.deepStrictEqual(discovery.manifests.map((manifest) => manifest.issue_id), ['UTV2-16824']);
    assert.strictEqual(discovery.lanes[0]?.source, 'local_worktree');
    assert.deepStrictEqual(discovery.lanes[0]?.capacity, {
      lifecycleStatus: 'parked',
      sourcePopulation: 'canonical_active_lane_union',
      classification: 'visible_uncounted',
      countsAgainst: { executor: false, total: false, laneType: false },
    });
  }

  assert.strictEqual(root.lanes[0]?.manifestLocation, 'lanes_root');
  assert.strictEqual(relocated.lanes[0]?.manifestLocation, 'lanes_parked');
  assert.deepStrictEqual(
    root.lanes[0]?.capacity,
    relocated.lanes[0]?.capacity,
    'relocation must not alter capacity arithmetic',
  );
  assert.deepStrictEqual(classifyLaneCapacity('parked'), root.lanes[0]?.capacity);
});

test('UTV2-1682: a parked PR-head manifest reports its lifecycle, source population, and location', () => {
  const parked = laneManifest({ issue_id: 'UTV2-16825', status: 'parked' });
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [],
    listOpenPullRequests: () => [
      { number: 16825, headRefName: 'codex/utv2-16825-parked' },
    ],
    readManifestAtRef: () => ({ manifest: parked, location: 'lanes_parked' }),
  });

  assert.strictEqual(discovery.lanes[0]?.source, 'open_pr_head');
  assert.strictEqual(discovery.lanes[0]?.manifestLocation, 'lanes_parked');
  assert.strictEqual(discovery.lanes[0]?.capacity.lifecycleStatus, 'parked');
  assert.strictEqual(
    discovery.lanes[0]?.capacity.sourcePopulation,
    'canonical_active_lane_union',
  );
  assert.strictEqual(discovery.lanes[0]?.capacity.classification, 'visible_uncounted');
});

test('UTV2-1682: parking or relocating a manifest never releases its file-scope lock', () => {
  for (const location of ['lanes_root', 'lanes_parked'] as const) {
    const discovery = discoverParkedAt(location);
    assert.deepStrictEqual(
      activeManifestOverlap('UTV2-99999', ['scripts/ops/shared.ts'], discovery.manifests),
      { issue_id: 'UTV2-16824', overlapping_files: ['scripts/ops/shared.ts'] },
    );
  }
});

test('UTV2-1682 fail-closed: an unreadable local population is not an empty board', () => {
  assert.throws(
    () =>
      resolveActiveLaneManifests({
        listOpenPullRequests: () => [],
        readLocalManifestEntries: () => {
          throw new Error('EACCES: parked directory unreadable');
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ActiveLaneDiscoveryError);
      assert.strictEqual(error.code, 'active_lane_discovery_failed');
      assert.match(error.message, /unreadable local board as an empty one/);
      return true;
    },
  );
});

test('UTV2-1634 issueIdFromBranchName extracts the canonical id from lane branches', () => {
  assert.strictEqual(issueIdFromBranchName('claude/utv2-1634-lane-discovery'), 'UTV2-1634');
  assert.strictEqual(issueIdFromBranchName('codex/utv2-1604-parked-mode'), 'UTV2-1604');
  assert.strictEqual(issueIdFromBranchName('griffadavi/uni-100-thing'), 'UNI-100');
  assert.strictEqual(issueIdFromBranchName('main'), null);
  assert.strictEqual(issueIdFromBranchName('dependabot/npm_and_yarn/foo-1.2.3'), null);
});

test('UTV2-1634: a lane whose manifest exists ONLY on its PR branch is counted as active', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [],
    listOpenPullRequests: (): OpenPullRequestRef[] => [
      { number: 1319, headRefName: 'codex/utv2-1604-parked-mode-scheduler-policy' },
    ],
    readManifestAtRef: (issueId) =>
      issueId === 'UTV2-1604'
        ? laneManifest({ issue_id: 'UTV2-1604', lane_type: 'runtime', status: 'in_review' })
        : null,
  });

  assert.deepStrictEqual(discovery.manifests.map((m) => m.issue_id), ['UTV2-1604']);
  assert.strictEqual(discovery.lanes[0]!.source, 'open_pr_head');
  assert.strictEqual(discovery.lanes[0]!.prNumber, 1319);
});

test('UTV2-1634 exact reported case: a runtime lane visible only on a PR branch is discoverable, so a migration lane-start can be refused', () => {
  const discovery = resolveActiveLaneManifests({
    // The UTV2-1399 worktree could see none of this locally -- that was the bug.
    readLocalManifests: () => [],
    listOpenPullRequests: () => [
      { number: 1319, headRefName: 'codex/utv2-1604-parked-mode-scheduler-policy' },
    ],
    readManifestAtRef: () =>
      laneManifest({ issue_id: 'UTV2-1604', lane_type: 'runtime', status: 'in_review' }),
  });

  const runtimeLanes = discovery.manifests.filter((m) => m.lane_type === 'runtime');
  assert.strictEqual(
    runtimeLanes.length,
    1,
    'the active runtime lane must be visible so ["migration","runtime"] can be detected as forbidden',
  );
});

test('UTV2-1634: executor cap is enforceable when N-1 manifests are unmerged', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [laneManifest({ issue_id: 'UTV2-1000' })],
    listOpenPullRequests: () => [
      { number: 1, headRefName: 'claude/utv2-1001-a' },
      { number: 2, headRefName: 'claude/utv2-1002-b' },
      { number: 3, headRefName: 'claude/utv2-1003-c' },
    ],
    readManifestAtRef: (issueId) => laneManifest({ issue_id: issueId }),
  });

  assert.deepStrictEqual(
    discovery.manifests.map((m) => m.issue_id),
    ['UTV2-1000', 'UTV2-1001', 'UTV2-1002', 'UTV2-1003'],
    'all four lanes must count toward the executor cap, not just the one on disk',
  );
});

test('UTV2-1634 fail-closed: enumeration failure throws rather than reporting an empty board', () => {
  assert.throws(
    () =>
      resolveActiveLaneManifests({
        readLocalManifests: () => [],
        listOpenPullRequests: () => {
          throw new Error('gh: network unreachable');
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ActiveLaneDiscoveryError);
      assert.strictEqual(error.code, 'active_lane_discovery_failed');
      return true;
    },
    'an unknown board must never be silently treated as an empty one',
  );
});

test('UTV2-1634: merged lanes still release their locks even with an open PR', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [laneManifest({ issue_id: 'UTV2-1500', status: 'in_progress' })],
    listOpenPullRequests: () => [{ number: 9, headRefName: 'claude/utv2-1500-thing' }],
    // Head says the lane has since merged -- authoritative over the stale local copy.
    readManifestAtRef: () => laneManifest({ issue_id: 'UTV2-1500', status: 'merged' }),
  });

  assert.deepStrictEqual(discovery.manifests, [], 'a merged lane must not keep holding locks');
});

test('UTV2-1634: the PR-head manifest wins over a stale local copy of the same lane', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [
      laneManifest({ issue_id: 'UTV2-1600', lane_type: 'hygiene', status: 'started' }),
    ],
    listOpenPullRequests: () => [{ number: 7, headRefName: 'claude/utv2-1600-thing' }],
    readManifestAtRef: () =>
      laneManifest({ issue_id: 'UTV2-1600', lane_type: 'migration', status: 'in_review' }),
  });

  assert.strictEqual(discovery.manifests.length, 1);
  assert.strictEqual(discovery.manifests[0]!.lane_type, 'migration');
  assert.strictEqual(discovery.lanes[0]!.source, 'open_pr_head');
});

test('UTV2-1634: non-lane PRs are skipped diagnostically, not treated as discovery failures', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [],
    listOpenPullRequests: () => [
      { number: 42, headRefName: 'dependabot/npm_and_yarn/lodash-4.17.21' },
    ],
    readManifestAtRef: () => null,
  });

  assert.deepStrictEqual(discovery.manifests, []);
  assert.strictEqual(discovery.skippedPullRequests.length, 1);
  assert.strictEqual(discovery.skippedPullRequests[0]!.number, 42);
});

test('UTV2-1634: a PR whose head has no manifest for its id contributes nothing and does not throw', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [],
    listOpenPullRequests: () => [{ number: 5, headRefName: 'claude/utv2-9999-no-manifest' }],
    readManifestAtRef: () => null,
  });

  assert.deepStrictEqual(discovery.manifests, []);
  assert.deepStrictEqual(discovery.skippedPullRequests, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1634 correction round: a manifest lookup may be treated as ABSENT only
// on a confirmed 404. Auth loss, rate limiting, network failure, 5xx, malformed
// base64/JSON and any other lookup failure are UNKNOWN lane state and must
// refuse admission -- treating unknown as absent is the same fail-open this
// lane exists to remove, just one level down.
// ─────────────────────────────────────────────────────────────────────────────

import { isConfirmedManifestNotFound, OPEN_PR_LISTING_LIMIT } from './shared.js';

test('UTV2-1634: only a confirmed 404 counts as manifest-absent', () => {
  assert.strictEqual(isConfirmedManifestNotFound('gh: Not Found (HTTP 404)', 1), true);
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 404: Not Found', 1), true);

  // Auth, rate limit, server and transport failures are never absence.
  assert.strictEqual(isConfirmedManifestNotFound('gh: Bad credentials (HTTP 401)', 1), false);
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 403: rate limit exceeded', 1), false);
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 429 too many requests', 1), false);
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 502 Bad Gateway', 1), false);
  assert.strictEqual(isConfirmedManifestNotFound('could not resolve host: api.github.com', 1), false);
  assert.strictEqual(isConfirmedManifestNotFound('connection reset by peer', 1), false);
  // A 404 string alongside an auth failure is ambiguous -- refuse.
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 404 Not Found; HTTP 401 Bad credentials', 1), false);
  // Non-1 exit codes are not the documented gh 404 shape.
  assert.strictEqual(isConfirmedManifestNotFound('HTTP 404 Not Found', 127), false);
  assert.strictEqual(isConfirmedManifestNotFound('', null), false);
});

test('UTV2-1634: a confirmed 404 skips exactly one PR and leaves the rest of the board intact', () => {
  const discovery = resolveActiveLaneManifests({
    readLocalManifests: () => [],
    listOpenPullRequests: () => [
      { number: 1, headRefName: 'claude/utv2-2001-has-manifest' },
      { number: 2, headRefName: 'claude/utv2-2002-no-manifest' },
    ],
    readManifestAtRef: (issueId) =>
      issueId === 'UTV2-2001' ? laneManifest({ issue_id: 'UTV2-2001' }) : null,
  });

  assert.deepStrictEqual(discovery.manifests.map((m) => m.issue_id), ['UTV2-2001']);
});

for (const failure of [
  'HTTP 401: Bad credentials',
  'HTTP 403: rate limit exceeded',
  'could not resolve host: api.github.com',
  'HTTP 500 Internal Server Error',
  'Unexpected token < in JSON at position 0',
]) {
  test(`UTV2-1634 fail-closed: manifest lookup failure "${failure}" refuses admission`, () => {
    assert.throws(
      () =>
        resolveActiveLaneManifests({
          readLocalManifests: () => [],
          listOpenPullRequests: () => [{ number: 1, headRefName: 'claude/utv2-2100-thing' }],
          readManifestAtRef: () => {
            throw new Error(failure);
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ActiveLaneDiscoveryError);
        assert.strictEqual(error.code, 'active_lane_discovery_failed');
        return true;
      },
      'an unreadable manifest must never be treated as an absent one',
    );
  });
}

test('UTV2-1634: a lookup failure does not get masked by other lanes resolving fine', () => {
  assert.throws(
    () =>
      resolveActiveLaneManifests({
        readLocalManifests: () => [],
        listOpenPullRequests: () => [
          { number: 1, headRefName: 'claude/utv2-2201-ok' },
          { number: 2, headRefName: 'claude/utv2-2202-broken' },
        ],
        readManifestAtRef: (issueId) => {
          if (issueId === 'UTV2-2201') return laneManifest({ issue_id: 'UTV2-2201' });
          throw new Error('HTTP 401: Bad credentials');
        },
      }),
    ActiveLaneDiscoveryError,
  );
});

test('UTV2-1634: the open-PR listing limit is a truncation detector, not a page size', () => {
  assert.ok(
    OPEN_PR_LISTING_LIMIT >= 200,
    'the cap must be well above any plausible real open-PR count so it only trips on genuine truncation risk',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1634 reliability round: bounded retry for transient discovery failures.
//
// Active-lane discovery makes N+1 sequential GitHub calls for N open PRs and
// originally aborted admission on the FIRST transient error of any one of them,
// so the abort probability compounded with board size. Measured 2026-08-11 with
// 15 open PRs: `ops:lane-start` aborted on 5 of 6 consecutive attempts while a
// single `gh api` call succeeded 8/8.
//
// Retry must not weaken anything: a transient error still never counts as an
// absence, and once the attempt budget is exhausted the original error is
// rethrown so the caller's fail-closed path is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { isRetryableDiscoveryFailure, withDiscoveryRetry } from './shared.js';

function ghError(stderr: string, status = 1): Error & { stderr: string; status: number } {
  return Object.assign(new Error(stderr), { stderr, status });
}

test('UTV2-1634 retry: a transient failure followed by success returns the value', () => {
  let calls = 0;
  const slept: number[] = [];
  const value = withDiscoveryRetry(
    () => {
      calls += 1;
      if (calls < 3) throw ghError('dial tcp 140.82.114.5:443: i/o timeout');
      return 'manifest-body';
    },
    (error) => {
      const e = error as { stderr: string; status: number };
      return isRetryableDiscoveryFailure(e.stderr, e.status);
    },
    { attempts: 4, baseDelayMs: 10, sleep: (ms) => slept.push(ms) },
  );

  assert.strictEqual(value, 'manifest-body');
  assert.strictEqual(calls, 3, 'should have retried until it succeeded');
  assert.deepStrictEqual(slept, [10, 20], 'exponential backoff between attempts only');
});

test('UTV2-1634 retry: backoff doubles and is capped', () => {
  const slept: number[] = [];
  assert.throws(() =>
    withDiscoveryRetry(
      () => {
        throw ghError('i/o timeout');
      },
      () => true,
      { attempts: 6, baseDelayMs: 500, maxDelayMs: 4000, sleep: (ms) => slept.push(ms) },
    ),
  );
  // 5 sleeps for 6 attempts; doubling 500→8000 but clamped at 4000.
  assert.deepStrictEqual(slept, [500, 1000, 2000, 4000, 4000]);
});

test('UTV2-1634 retry: a permanent transient failure still fails closed with the original error', () => {
  let calls = 0;
  const original = ghError('dial tcp 140.82.114.5:443: i/o timeout');

  assert.throws(
    () =>
      withDiscoveryRetry(
        () => {
          calls += 1;
          throw original;
        },
        (error) => {
          const e = error as { stderr: string; status: number };
          return isRetryableDiscoveryFailure(e.stderr, e.status);
        },
        { attempts: 3, baseDelayMs: 1, sleep: () => {} },
      ),
    // The LAST error is rethrown unchanged, so the caller's fail-closed
    // ActiveLaneDiscoveryError wrapping and message are preserved verbatim.
    (thrown: unknown) => thrown === original,
  );
  assert.strictEqual(calls, 3, 'should have exhausted exactly the attempt budget');
});

test('UTV2-1634 retry: normal discovery is unchanged — one call, no sleeping', () => {
  let calls = 0;
  const slept: number[] = [];
  const value = withDiscoveryRetry(
    () => {
      calls += 1;
      return 'ok';
    },
    () => true,
    { attempts: 4, baseDelayMs: 10, sleep: (ms) => slept.push(ms) },
  );

  assert.strictEqual(value, 'ok');
  assert.strictEqual(calls, 1, 'a succeeding call must not be repeated');
  assert.deepStrictEqual(slept, [], 'no backoff on the happy path');
});

test('UTV2-1634 retry: a non-retryable failure is rethrown immediately without retrying', () => {
  // Permanent auth failures resolve to the same answer every time; burning the
  // attempt budget on them only delays the inevitable.
  for (const stderr of ['gh: Bad credentials (HTTP 401)', 'HTTP 403: permission denied']) {
    let calls = 0;
    assert.throws(() =>
      withDiscoveryRetry(
        () => {
          calls += 1;
          throw ghError(stderr);
        },
        (error) => {
          const e = error as { stderr: string; status: number };
          return isRetryableDiscoveryFailure(e.stderr, e.status);
        },
        { attempts: 4, baseDelayMs: 1, sleep: () => {} },
      ),
    );
    assert.strictEqual(calls, 1, `${stderr} must not be retried`);
  }
});

test('UTV2-1634 retry: a confirmed 404 is a definitive answer, never retried', () => {
  // 404 means "this PR has no manifest" -- a real result. It is handled by the
  // caller as absence-for-this-PR; retrying it would be pure waste and would
  // multiply latency across every non-lane PR on the board.
  assert.strictEqual(isRetryableDiscoveryFailure('gh: Not Found (HTTP 404)', 1), false);
  assert.strictEqual(isRetryableDiscoveryFailure('HTTP 404: Not Found', 1), false);
});

test('UTV2-1634 retry: transport and server faults are retryable, and unknown errors default to retryable', () => {
  for (const stderr of [
    'dial tcp 140.82.114.5:443: i/o timeout',
    'could not resolve host: api.github.com',
    'connection reset by peer',
    'HTTP 502 Bad Gateway',
    'HTTP 429 too many requests',
    'something nobody has seen before',
  ]) {
    assert.strictEqual(isRetryableDiscoveryFailure(stderr, 1), true, `${stderr} should be retryable`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1756: manifest write path fidelity + the fail-closed write guard.
//
// The defect: `a67a6a59` (github-actions[bot], direct push to protected `main`)
// reverted PR #1448's ratified `superseded` on
// `docs/06_status/lanes/UTV2-1512.json` back to `blocked` and deleted 58 lines
// of `truth_check_history`. The reconciler had read
// `docs/06_status/lanes/parked/UTV2-1512.json` -- a distinct record that
// happens to share the `issue_id` -- and written that record's content to a
// destination resolved from the issue ID alone.
//
// Two independent defences are asserted below, and they are independent on
// purpose. Path fidelity stops the write from being aimed at the wrong file.
// The guard stops the wrong file from accepting a write even when some future
// caller aims badly. Either alone leaves a hole; the pair is what closes it.
// ─────────────────────────────────────────────────────────────────────────────

function manifestFixtureDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `utv2-1756-${label}-`));
}

test('UTV2-1756: readAllManifestEntries pairs every manifest with the file it was read from', () => {
  const dir = manifestFixtureDir('entries');
  fs.mkdirSync(path.join(dir, 'parked'), { recursive: true });

  // The exact duplicate arrangements present on `main` today: a root/parked
  // pair sharing a filename, and a same-directory alias pair sharing an
  // issue_id under two different filenames.
  writeJsonFile(path.join(dir, 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));
  writeJsonFile(path.join(dir, 'parked', 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }));
  writeJsonFile(path.join(dir, 'UTV2-1157.json'), laneManifest({ issue_id: 'UTV2-1157', status: 'in_progress' }));
  writeJsonFile(path.join(dir, 'UTV2-1157-codex.json'), laneManifest({ issue_id: 'UTV2-1157', status: 'blocked' }));

  const entries = readAllManifestEntries(dir);
  assert.strictEqual(entries.length, 4);

  for (const entry of entries) {
    assert.strictEqual(
      JSON.parse(fs.readFileSync(entry.path, 'utf8')).status,
      entry.manifest.status,
      `${entry.path} must be paired with its OWN record, not another record sharing its issue_id`,
    );
  }

  // Same issue_id, three distinct files, three distinct destinations.
  const byPath = new Map(entries.map((entry) => [entry.path, entry.manifest.status]));
  assert.strictEqual(byPath.get(path.join(dir, 'UTV2-1512.json')), 'superseded');
  assert.strictEqual(byPath.get(path.join(dir, 'parked', 'UTV2-1512.json')), 'blocked');
  assert.strictEqual(byPath.get(path.join(dir, 'UTV2-1157.json')), 'in_progress');
  assert.strictEqual(byPath.get(path.join(dir, 'UTV2-1157-codex.json')), 'blocked');
});

test('UTV2-1756: readAllManifests output is unchanged by the entry refactor', () => {
  const dir = manifestFixtureDir('compat');
  fs.mkdirSync(path.join(dir, 'parked'), { recursive: true });
  writeJsonFile(path.join(dir, 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));
  writeJsonFile(path.join(dir, 'parked', 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }));

  assert.deepStrictEqual(
    readAllManifests(dir),
    readAllManifestEntries(dir).map((entry) => entry.manifest),
    'existing callers must observe exactly the same manifests, in the same order',
  );
  assert.deepStrictEqual(
    readAllManifestPaths(dir),
    readAllManifestEntries(dir).map((entry) => entry.path),
  );
});

test('UTV2-1756: writeManifestAtPath writes to the subdirectory it was given, not the root path', () => {
  const dir = manifestFixtureDir('subdir');
  fs.mkdirSync(path.join(dir, 'parked'), { recursive: true });
  const rootPath = path.join(dir, 'UTV2-1512.json');
  const parkedPath = path.join(dir, 'parked', 'UTV2-1512.json');

  writeJsonFile(rootPath, laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));
  writeJsonFile(parkedPath, laneManifest({ issue_id: 'UTV2-1512', status: 'in_progress' }));
  const rootBefore = fs.readFileSync(rootPath, 'utf8');

  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }), parkedPath, { validate: false });

  assert.strictEqual(JSON.parse(fs.readFileSync(parkedPath, 'utf8')).status, 'blocked');
  assert.strictEqual(
    fs.readFileSync(rootPath, 'utf8'),
    rootBefore,
    'the root manifest must be byte-identical: it was never the destination',
  );
});

test('UTV2-1756: writeManifest still resolves the canonical root path for a genuinely new manifest', () => {
  // `writeManifest` is now a thin delegation to `writeManifestAtPath` over the
  // issue-ID-derived path. That derivation is still correct -- and still the
  // right default -- for a lane that has exactly one manifest.
  assert.strictEqual(
    issueToManifestPath('utv2-9999'),
    issueToManifestPath('UTV2-9999'),
    'issueToManifestPath must stay case-insensitive on the issue ID',
  );
  assert.ok(issueToManifestPath('UTV2-9999').endsWith(path.join('lanes', 'UTV2-9999.json')));
});

test('UTV2-1756 GUARD: a superseded manifest refuses a write back to blocked (the a67a6a59 condition)', () => {
  const dir = manifestFixtureDir('guard-terminal');
  const target = path.join(dir, 'UTV2-1512.json');
  writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));

  assert.throws(
    () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }), target, { validate: false }),
    /cannot transition to "blocked"/,
    'reconciling a ratified terminal manifest backwards must be refused',
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(target, 'utf8')).status,
    'superseded',
    'a refused write must leave the file untouched',
  );
});

test('UTV2-1756 MUTATION CONTROL: without the guard the same write lands, so the guard is what refuses it', () => {
  // Inversion control for the test above. If this assertion ever fails, the
  // refusal above is being produced by something other than the guard -- a
  // read-only file, a bad fixture -- and that test proves nothing.
  const dir = manifestFixtureDir('guard-mutation');
  const target = path.join(dir, 'UTV2-1512.json');
  writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));

  // The pre-UTV2-1756 write: no identity check, no transition check.
  writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }));

  assert.strictEqual(
    JSON.parse(fs.readFileSync(target, 'utf8')).status,
    'blocked',
    'the unguarded write must succeed — otherwise the guard test is vacuous',
  );
});

test('UTV2-1756 GUARD: legal transitions still pass — merged to done, and a terminal self-transition', () => {
  const dir = manifestFixtureDir('guard-legal');

  const closeout = path.join(dir, 'UTV2-1759.json');
  writeJsonFile(closeout, laneManifest({ issue_id: 'UTV2-1759', status: 'merged' }));
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1759', status: 'done' }), closeout, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(closeout, 'utf8')).status, 'done');

  const terminal = path.join(dir, 'UTV2-1512.json');
  writeJsonFile(terminal, laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }));
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'superseded' }), terminal, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(terminal, 'utf8')).status, 'superseded');
});

test('UTV2-1756 GUARD: refuses a write whose issue_id differs from the record already at that path', () => {
  const dir = manifestFixtureDir('guard-identity');
  // An ALIASED filename on purpose. validateManifest already refuses a write
  // whose basename disagrees with issue_id, so a plainly-named target would
  // prove nothing about the guard. `UTV2-1157-codex.json` is a real filename
  // on `main` whose basename encodes no usable identity, which is exactly
  // where filename-based validation has nothing to say and the guard does.
  const target = path.join(dir, 'UTV2-1157-codex.json');
  writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1157', status: 'in_progress' }));

  assert.throws(
    () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'in_progress' }), target, { validate: false }),
    /must be written back to its own file/,
  );
  assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).issue_id, 'UTV2-1157');
});

test('UTV2-1756: writeManifestAtPath validates the outgoing manifest by default', () => {
  // The reconciler opts out of schema validation (see WriteManifestOptions);
  // nothing else does, and this asserts the default has not drifted.
  const dir = manifestFixtureDir('validate-default');
  const target = path.join(dir, 'UTV2-9996.json');
  assert.throws(
    () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-9996', status: 'started' }), target),
    /file_scope_lock must contain at least one file/,
  );
  assert.strictEqual(fs.existsSync(target), false, 'a rejected write must not create the file');
});

test('UTV2-1756 GUARD: abstains when there is nothing to protect — a new file, or an unreadable one', () => {
  const dir = manifestFixtureDir('guard-abstain');

  // A genuinely new lane: no on-disk record, so no vote to cast.
  const fresh = path.join(dir, 'UTV2-9999.json');
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-9999', status: 'started' }), fresh, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')).status, 'started');

  // A corrupt record must stay repairable — refusing to overwrite garbage
  // would brick the only path that fixes it.
  const corrupt = path.join(dir, 'UTV2-9998.json');
  fs.writeFileSync(corrupt, '{ not json at all', 'utf8');
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-9998', status: 'started' }), corrupt, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(corrupt, 'utf8')).status, 'started');

  // A record whose status predates the current schema: same reasoning.
  const legacy = path.join(dir, 'UTV2-9997.json');
  writeJsonFile(legacy, { ...laneManifest({ issue_id: 'UTV2-9997' }), status: 'closed' });
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-9997', status: 'blocked' }), legacy, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(legacy, 'utf8')).status, 'blocked');
});

test('UTV2-1756: classifyLaneCapacity stays location-independent', () => {
  // classifyLaneCapacity documents that manifest location is deliberately
  // absent from its API, so relocating a lane can never alter its arithmetic.
  // UTV2-1756 makes location matter for the WRITE destination; this asserts it
  // still does not leak into capacity, which is the property that would break
  // if the two concerns were conflated.
  const dir = manifestFixtureDir('capacity');
  fs.mkdirSync(path.join(dir, 'parked'), { recursive: true });
  writeJsonFile(path.join(dir, 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }));
  writeJsonFile(path.join(dir, 'parked', 'UTV2-1512.json'), laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }));

  const [rootEntry, parkedEntry] = readAllManifestEntries(dir);
  assert.notStrictEqual(rootEntry?.path, parkedEntry?.path, 'fixture must hold two distinct files');
  assert.deepStrictEqual(
    classifyLaneCapacity(rootEntry!.manifest.status),
    classifyLaneCapacity(parkedEntry!.manifest.status),
    'the same status must classify identically regardless of where the manifest lives',
  );
});

test('UTV2-1756 GUARD: an in-flight record is not transition-gated, so PR binding still works', () => {
  // The guard protects settled records; it is not a lifecycle authority.
  // `ops:lane-link-pr` moves every lane `started -> in_review` on PR binding —
  // a transition TRANSITIONS does not list. Gating in-flight writes on that
  // table would break PR binding for every lane, which is a lifecycle change
  // this lane did not ratify. The narrowing is deliberate; this asserts it.
  const dir = manifestFixtureDir('guard-inflight');
  const target = path.join(dir, 'UTV2-1756.json');
  writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1756', status: 'started' }));

  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1756', status: 'in_review' }), target, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).status, 'in_review');
});

test('UTV2-1756 GUARD: every settled status vetoes a rollback to an active status', () => {
  const dir = manifestFixtureDir('guard-settled');
  for (const settled of ['merged', 'done', 'failed', 'superseded', 'cancelled'] as const) {
    const target = path.join(dir, `UTV2-${settled}.json`);
    writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: settled }));
    assert.throws(
      () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'blocked' }), target, { validate: false }),
      /cannot transition to "blocked"/,
      `${settled} must veto a rollback to blocked`,
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).status, settled);
  }
});

// UTV2-1756: a deliberate, reviewed behaviour change -- not an accident.
//
// `applyPrMergeToManifest` (scripts/ops/lane-manifest.ts) forces `merged` from
// ANY starting status except `done`, and `recordMergeCommand` then hands that
// result to `writeManifest`. Before this lane, stamping `merged` onto a lane
// that had already settled as `failed`/`superseded`/`cancelled` wrote silently.
// It is now refused.
//
// That refusal is the intended reading of the truth model: a merge SHA may not
// be recorded onto a lane whose settled record says it never merged. It is the
// same judgement the PM applied by hand when rejecting `record_merge_on_manifest`
// for UTV2-1512, whose PR #1173 closed unmerged. Locking it in a test so the
// behaviour is asserted rather than incidental, and so anyone who wants the old
// silence has to delete an explicit assertion to get it.
test('UTV2-1756 GUARD: record-merge cannot stamp merged onto a lane that settled as not-merged', () => {
  const dir = manifestFixtureDir('guard-record-merge');
  for (const settled of ['failed', 'superseded', 'cancelled'] as const) {
    const target = path.join(dir, `UTV2-${settled}.json`);
    writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: settled }));
    assert.throws(
      () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'merged' }), target, { validate: false }),
      /cannot transition to "merged"/,
      `${settled} must refuse a recorded merge`,
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(target, 'utf8')).status,
      settled,
      `${settled} must survive the refused record-merge byte-for-byte`,
    );
  }

  // The sanctioned shapes still work: in_review -> merged, and merged -> merged.
  const live = path.join(dir, 'UTV2-1756.json');
  writeJsonFile(live, laneManifest({ issue_id: 'UTV2-1756', status: 'in_review' }));
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1756', status: 'merged' }), live, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(live, 'utf8')).status, 'merged');
  writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1756', status: 'merged' }), live, { validate: false });
  assert.strictEqual(JSON.parse(fs.readFileSync(live, 'utf8')).status, 'merged');
});

// UTV2-1756: the existing-done restart path must survive the guard.
//
// ops:lane-start replaces a `done` manifest with a fresh `started` one when an
// issue is worked a second time (lane-start.ts, which hard-errors on an
// existing manifest in any other status). `done -> started` is absent from
// TRANSITIONS, so an unqualified terminal arm refuses it -- and lane-start
// creates the branch, the worktree, and the lease BEFORE it reaches its
// manifest write, on a path with no rollback. A refusal there strands all
// three on every restart of a completed issue.
test('UTV2-1756 RESTART: a done manifest accepts the sanctioned replacement by a fresh started lane', () => {
  const dir = manifestFixtureDir('guard-restart');
  const target = path.join(dir, 'UTV2-1512.json');
  const settled = laneManifest({ issue_id: 'UTV2-1512', status: 'done' });
  writeJsonFile(target, settled);

  const restart = laneManifest({ issue_id: 'UTV2-1512', status: 'started' });
  writeManifestAtPath(restart, target, { validate: false });

  const after = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.strictEqual(after.status, 'started', 'the restart must land, not be refused');
});

test('UTV2-1756 RESTART: the exception is exactly done->started and nothing wider', () => {
  const dir = manifestFixtureDir('guard-restart-bounds');

  // No other settled status may be reanimated to started. `done` is the only
  // record ops:lane-start will replace; the rest are terminal for good.
  for (const settled of ['merged', 'failed', 'superseded', 'cancelled'] as const) {
    const target = path.join(dir, `UTV2-${settled}.json`);
    writeJsonFile(target, laneManifest({ issue_id: 'UTV2-1512', status: settled }));
    assert.throws(
      () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'started' }), target, { validate: false }),
      /cannot transition to "started"/,
      `${settled} must not be reanimated to started`,
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(target, 'utf8')).status, settled);
  }

  // And `done` itself only opens for `started` -- not for any other status.
  for (const illegal of ['blocked', 'in_progress', 'in_review', 'merged', 'parked'] as const) {
    const target = path.join(dir, `UTV2-done-to-${illegal}.json`);
    const before = laneManifest({ issue_id: 'UTV2-1512', status: 'done' });
    writeJsonFile(target, before);
    const bytes = fs.readFileSync(target, 'utf8');
    assert.throws(
      () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: illegal }), target, { validate: false }),
      new RegExp(`cannot transition to "${illegal}"`),
      `done -> ${illegal} must stay refused`,
    );
    assert.strictEqual(fs.readFileSync(target, 'utf8'), bytes, 'a refused write must leave the file byte-identical');
  }

  // The identity arm still applies to a restart: a fresh lane for a different
  // issue may not claim a done record's file.
  const foreign = path.join(dir, 'UTV2-1157-codex.json');
  writeJsonFile(foreign, laneManifest({ issue_id: 'UTV2-1157', status: 'done' }));
  const foreignBytes = fs.readFileSync(foreign, 'utf8');
  assert.throws(
    () => writeManifestAtPath(laneManifest({ issue_id: 'UTV2-1512', status: 'started' }), foreign, { validate: false }),
    /must be written back to its own file/,
    'the restart exception must not bypass the identity arm',
  );
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), foreignBytes);
});
