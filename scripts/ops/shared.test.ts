import test from 'node:test';
import assert from 'node:assert/strict';
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
  issueIdFromBranchName,
  resolveActiveLaneManifests,
  type LaneManifest,
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
