import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManifest,
  defaultProofPaths,
  deriveDeliveryUiApp,
  normalizeFileScopePath,
  normalizeRepoRelativePath,
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
