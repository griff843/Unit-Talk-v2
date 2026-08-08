import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GhExecutor } from './ci-db-proof-harvest.js';
import {
  buildDiffSummary,
  buildRuntimeVerification,
  applyProofManifestOverrides,
  autoHarvestCiDbProofIntoEvidence,
  autoPopulateStaticProofFromVerifyRun,
  collectProofGitTruth,
  detectCurrentProofContext,
  generateProofArtifacts,
  rebindEvidenceJsonSha,
  rebindMergeSha,
  rebindModelRoutingJsonSha,
  rebindVerificationMdSha,
  standardProofPaths,
  ModelRoutingRebindError,
  ProofPreservationError,
  type ProofGitTruth,
} from './proof-generate.js';
import { ROOT } from './shared.js';
import type { LaneManifest } from './shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEAD_SHA = '1111111111111111111111111111111111111111';
const MERGE_SHA = '2222222222222222222222222222222222222222';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1170',
    lane_type: 'verification',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '.out/worktrees/codex__utv2-1170-proof-generate',
    branch: 'codex/utv2-1170-proof-generate',
    base_branch: 'main',
    commit_sha: MERGE_SHA,
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
    files_changed: ['scripts/ops/proof-generate.ts', 'scripts/ops/proof-generate.test.ts'],
    file_scope_lock: ['scripts/ops/proof-generate.ts', 'scripts/ops/proof-generate.test.ts'],
    expected_proof_paths: [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ],
    status: 'merged',
    started_at: '2026-05-25T00:00:00.000Z',
    heartbeat_at: '2026-05-25T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1170-proof-generate.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function gitTruth(overrides: Partial<ProofGitTruth> = {}): ProofGitTruth {
  return {
    head_sha: HEAD_SHA,
    merge_sha: MERGE_SHA,
    diff_base_ref: `${MERGE_SHA}^1`,
    diff_target_ref: MERGE_SHA,
    diff_stat: ' scripts/ops/proof-generate.ts | 250 +++++++++++++++++++++',
    name_status: [
      'A\tscripts/ops/proof-generate.ts',
      'A\tscripts/ops/proof-generate.test.ts',
    ].join('\n'),
    ...overrides,
  };
}

function input(overrides: Partial<LaneManifest> = {}) {
  return {
    manifest: manifest(overrides),
    generatedAt: '2026-05-25T16:00:00.000Z',
    gitTruth: gitTruth({ merge_sha: overrides.commit_sha === null ? null : MERGE_SHA }),
  };
}

test('standard proof paths target diff summary and verification docs', () => {
  assert.deepStrictEqual(standardProofPaths('utv2-1170'), {
    'diff-summary.md': 'docs/06_status/proof/UTV2-1170/diff-summary.md',
    'verification.md': 'docs/06_status/proof/UTV2-1170/verification.md',
  });
});

test('generated artifacts include manifest metadata, git truth, and SHA bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-generate-'));
  try {
    const result = generateProofArtifacts(input(), { root });
    const diffPath = path.join(root, 'docs/06_status/proof/UTV2-1170/diff-summary.md');
    const verificationPath = path.join(root, 'docs/06_status/proof/UTV2-1170/verification.md');

    assert.deepStrictEqual(result.generated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ]);
    assert.strictEqual(result.head_sha, HEAD_SHA);
    assert.strictEqual(result.merge_sha, MERGE_SHA);
    assert.strictEqual(fs.existsSync(diffPath), true);
    assert.strictEqual(fs.existsSync(verificationPath), true);

    const diffContent = fs.readFileSync(diffPath, 'utf8');
    const verificationContent = fs.readFileSync(verificationPath, 'utf8');
    assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(diffContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(diffContent, /A\tscripts\/ops\/proof-generate\.ts/);
    assert.match(verificationContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(verificationContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(verificationContent, /^## Verification/m);
    assert.match(verificationContent, /`pnpm type-check`/);
    assert.match(verificationContent, /`pnpm test`/);
    assert.match(verificationContent, /`pnpm verify`/);
    assert.match(verificationContent, /scripts\/ci\/r-level-check\.ts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// UTV2-1516: a freshly-generated verification.md must satisfy truth-check-lib's
// own P13 ("pnpm verify" mention) and P14 ("r-level-check.ts" mention) checks --
// otherwise ops:proof-generate --merge-sha (the automated post-merge step) writes
// a file that immediately fails its own downstream truth-check, deadlocking any
// T2 lane's auto-close.
test('generated verification.md satisfies truth-check-lib P13/P14 requirements', () => {
  const content = buildRuntimeVerification(input());
  assert.match(content, /\bpnpm\s+verify\b/i);
  assert.match(content, /\bscripts\/ci\/r-level-check\.ts\b/i);
});

/**
 * UTV2-1631: this test previously asserted that existing artifacts missing the
 * current SHA are REPLACED wholesale with a generated template. That assertion
 * was the defect, written down. Existing artifacts are now SHA-rebound in
 * place; the stale label is rebound and nothing else about the file moves.
 */
test('existing artifacts are rebound in place, not replaced, when their merge SHA is stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-stale-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'diff-summary.md'), '# Authored diff notes\n\nMerge SHA: stale\n', 'utf8');
    fs.writeFileSync(path.join(proofDir, 'verification.md'), '# PROOF: UTV2-1170\n\nMERGE_SHA: stale\n\nASSERTIONS: measured\n', 'utf8');

    const result = generateProofArtifacts(input(), { root });

    assert.deepStrictEqual(result.generated_paths, []);
    assert.deepStrictEqual(result.updated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ]);
    assert.deepStrictEqual(result.rebound_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ]);
    assert.deepStrictEqual(result.stale_paths_replaced, []);

    assert.strictEqual(
      fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8'),
      `# PROOF: UTV2-1170\n\nMERGE_SHA: ${MERGE_SHA}\n\nASSERTIONS: measured\n`,
    );
    assert.strictEqual(
      fs.readFileSync(path.join(proofDir, 'diff-summary.md'), 'utf8'),
      `# Authored diff notes\n\nMerge SHA: ${MERGE_SHA}\n`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unchanged artifacts are not rewritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-unchanged-'));
  try {
    const first = generateProofArtifacts(input(), { root });
    const second = generateProofArtifacts(input(), { root });

    assert.strictEqual(first.generated_paths.length, 2);
    assert.deepStrictEqual(second.generated_paths, []);
    assert.deepStrictEqual(second.updated_paths, []);
    assert.deepStrictEqual(second.unchanged_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pre-merge artifacts bind head SHA and use N/A for merge SHA', () => {
  const preMergeInput = {
    ...input({ commit_sha: null }),
    gitTruth: gitTruth({ merge_sha: null, diff_base_ref: 'base-sha', diff_target_ref: HEAD_SHA }),
  };

  const diffContent = buildDiffSummary(preMergeInput);
  const verificationContent = buildRuntimeVerification(preMergeInput);

  assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(diffContent, /Merge SHA: N\/A/);
  assert.match(verificationContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(verificationContent, /Merge SHA: N\/A/);
});

test('manifest overrides bind proof artifacts to the current branch and PR', () => {
  const overridden = applyProofManifestOverrides(manifest(), {
    branch: 'codex/utv2-1170-current-proof',
    prUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1700',
  });
  const diffContent = buildDiffSummary({
    ...input(),
    manifest: overridden,
  });

  assert.match(diffContent, /Branch: codex\/utv2-1170-current-proof/);
  assert.match(diffContent, /PR URL: https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/1700/);
});

test('detectCurrentProofContext reads branch and head from git without requiring manifest truth', () => {
  const calls: string[][] = [];
  const detected = detectCurrentProofContext({
    root: '/repo',
    gitRunner: (args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
        return { ok: true, stdout: 'codex/current-proof\n', stderr: '' };
      }
      if (args.join(' ') === 'rev-parse HEAD') {
        return { ok: true, stdout: HEAD_SHA, stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'unset' };
    },
  });

  assert.deepStrictEqual(detected, {
    branch: 'codex/current-proof',
    prUrl: null,
    headSha: HEAD_SHA,
  });
  assert.deepStrictEqual(calls.map((call) => call.join(' ')), [
    'rev-parse --abbrev-ref HEAD',
    'config --get branch.codex/current-proof.pr-url',
    'rev-parse HEAD',
  ]);
});

test('collectProofGitTruth prefers manifest merge SHA and diffs against first parent', () => {
  const calls: string[][] = [];
  const collected = collectProofGitTruth(manifest(), {
    root: '/tmp/nonexistent-proof-root',
    gitRunner: (args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse HEAD') {
        return { ok: true, stdout: HEAD_SHA, stderr: '' };
      }
      if (args.join(' ') === `diff --stat ${MERGE_SHA}^1 ${MERGE_SHA}`) {
        return { ok: true, stdout: 'stat output', stderr: '' };
      }
      if (args.join(' ') === `diff --name-status ${MERGE_SHA}^1 ${MERGE_SHA}`) {
        return { ok: true, stdout: 'M\tfile.ts', stderr: '' };
      }
      return { ok: false, stdout: '', stderr: 'unexpected' };
    },
  });

  assert.strictEqual(collected.head_sha, HEAD_SHA);
  assert.strictEqual(collected.merge_sha, MERGE_SHA);
  assert.strictEqual(collected.diff_base_ref, `${MERGE_SHA}^1`);
  assert.strictEqual(collected.diff_target_ref, MERGE_SHA);
  assert.strictEqual(collected.diff_stat, 'stat output');
  assert.deepStrictEqual(calls.slice(-2), [
    ['diff', '--stat', `${MERGE_SHA}^1`, MERGE_SHA],
    ['diff', '--name-status', `${MERGE_SHA}^1`, MERGE_SHA],
  ]);
});

// ── UTV2-1392: evidence.json / verification.md merge-SHA rebinding ──────────

function preMergeEvidenceJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      status: 'in_review',
      verifier: { identity: 'claude/utv2-1170' },
      static_proof: { pnpm_verify: 'pass' },
      runtime_proof: { pnpm_test_db: 'pass' },
      sha_binding: {
        verified_source_sha: HEAD_SHA,
        sha_type: 'branch_head',
        bound_at: '2026-05-25T10:00:00.000Z',
        ci_sentinels: { merge_gate: 'pass' },
      },
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

function preMergeVerificationMd(): string {
  return [
    '# UTV2-1170 — Verification',
    '',
    '## Verification',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Issue ID | UTV2-1170 |',
    `| Commit SHA(s) | \`${HEAD_SHA}\` (pre-merge placeholder) |`,
    '',
    '## Sign-off',
    '',
    '**Status:** pending',
    '',
    '## Merge SHA Binding',
    '',
    '(Filled post-merge by post-merge-lane-close.yml)',
  ].join('\n');
}

function preMergeModelRoutingJson(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      issue_id: 'UTV2-1170',
      manifest_schema_version: 2,
      model_profile: 'codex-sol-high',
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      policy_version: '1.0.0',
      codex_cli_version: 'codex-cli 0.145.0',
      legacy_compatibility_used: false,
      override_used: false,
      override_authorized_by: null,
      codex_exit_code: 0,
      generated_at: '2026-05-25T10:00:00.000Z',
      forward_compatible_field: { retained: true },
      ...overrides,
    },
    null,
    2,
  )}\n`;
}

test('rebindEvidenceJsonSha rewrites sha_binding to the merge SHA and flips pre-merge status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-evidence-'));
  try {
    const evidencePath = path.join(root, 'evidence.json');
    fs.writeFileSync(evidencePath, preMergeEvidenceJson(), 'utf8');

    const outcome = rebindEvidenceJsonSha(evidencePath, MERGE_SHA, '2026-05-26T00:00:00.000Z');
    assert.strictEqual(outcome.status, 'updated');

    const rewritten = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.strictEqual(rewritten.sha_binding.verified_source_sha, MERGE_SHA);
    assert.strictEqual(rewritten.sha_binding.sha_type, 'merge_sha');
    assert.strictEqual(rewritten.sha_binding.bound_at, '2026-05-26T00:00:00.000Z');
    assert.strictEqual(rewritten.status, 'merged');
    // Untouched fields must survive unchanged.
    assert.strictEqual(rewritten.verifier.identity, 'claude/utv2-1170');
    assert.strictEqual(rewritten.static_proof.pnpm_verify, 'pass');
    assert.strictEqual(rewritten.sha_binding.ci_sentinels.merge_gate, 'pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindEvidenceJsonSha is idempotent — re-running with the same merge SHA is a no-op', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-idempotent-'));
  try {
    const evidencePath = path.join(root, 'evidence.json');
    fs.writeFileSync(evidencePath, preMergeEvidenceJson(), 'utf8');

    rebindEvidenceJsonSha(evidencePath, MERGE_SHA, '2026-05-26T00:00:00.000Z');
    const afterFirst = fs.readFileSync(evidencePath, 'utf8');
    const second = rebindEvidenceJsonSha(evidencePath, MERGE_SHA, '2026-05-27T00:00:00.000Z');

    assert.strictEqual(second.status, 'unchanged');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), afterFirst);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindEvidenceJsonSha reports missing without creating a file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-missing-'));
  try {
    const evidencePath = path.join(root, 'evidence.json');
    const outcome = rebindEvidenceJsonSha(evidencePath, MERGE_SHA, '2026-05-26T00:00:00.000Z');
    assert.strictEqual(outcome.status, 'missing');
    assert.strictEqual(fs.existsSync(evidencePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindEvidenceJsonSha leaves non-evidence JSON (no sha_binding) untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-no-shabinding-'));
  try {
    const evidencePath = path.join(root, 'evidence.json');
    const content = `${JSON.stringify({ schema_version: 1, note: 'no sha_binding here' }, null, 2)}\n`;
    fs.writeFileSync(evidencePath, content, 'utf8');

    const outcome = rebindEvidenceJsonSha(evidencePath, MERGE_SHA, '2026-05-26T00:00:00.000Z');
    assert.strictEqual(outcome.status, 'unchanged');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindVerificationMdSha rewrites the Commit SHA(s) row and Merge SHA Binding section', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-verification-'));
  try {
    const verificationPath = path.join(root, 'verification.md');
    fs.writeFileSync(verificationPath, preMergeVerificationMd(), 'utf8');

    const outcome = rebindVerificationMdSha(
      verificationPath,
      MERGE_SHA,
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
    );
    assert.strictEqual(outcome.status, 'updated');

    const rewritten = fs.readFileSync(verificationPath, 'utf8');
    assert.match(rewritten, new RegExp(`\\| Commit SHA\\(s\\) \\| \`${MERGE_SHA}\` \\(merge SHA\\) \\|`));
    assert.match(rewritten, new RegExp(`Merge SHA: \`${MERGE_SHA}\``));
    assert.match(rewritten, /PR: https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/1170/);
    assert.doesNotMatch(rewritten, /pre-merge placeholder/);
    assert.doesNotMatch(rewritten, /Filled post-merge/);
    // Untouched surrounding content must survive.
    assert.match(rewritten, /\*\*Status:\*\* pending/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindVerificationMdSha is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-verification-idempotent-'));
  try {
    const verificationPath = path.join(root, 'verification.md');
    fs.writeFileSync(verificationPath, preMergeVerificationMd(), 'utf8');

    rebindVerificationMdSha(verificationPath, MERGE_SHA, null);
    const afterFirst = fs.readFileSync(verificationPath, 'utf8');
    const second = rebindVerificationMdSha(verificationPath, MERGE_SHA, null);

    assert.strictEqual(second.status, 'unchanged');
    assert.strictEqual(fs.readFileSync(verificationPath, 'utf8'), afterFirst);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindVerificationMdSha leaves files with no matching sections untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-verification-nomatch-'));
  try {
    const verificationPath = path.join(root, 'verification.md');
    const content = '# Some other doc\n\nNo commit SHA table or merge SHA binding section here.\n';
    fs.writeFileSync(verificationPath, content, 'utf8');

    const outcome = rebindVerificationMdSha(verificationPath, MERGE_SHA, null);
    assert.strictEqual(outcome.status, 'unchanged');
    assert.strictEqual(fs.readFileSync(verificationPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindMergeSha is a no-op without a merge SHA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-no-mergesha-'));
  try {
    const outcomes = rebindMergeSha(root, 'UTV2-1170', null, '2026-05-26T00:00:00.000Z', null);
    assert.deepStrictEqual(outcomes, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindMergeSha reports missing for lanes with no evidence.json/verification.md (e.g. T3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-t3-'));
  try {
    const outcomes = rebindMergeSha(root, 'UTV2-1170', MERGE_SHA, '2026-05-26T00:00:00.000Z', null);
    assert.deepStrictEqual(
      outcomes.map((o) => o.status),
      ['missing', 'missing'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha adds closeout binding and preserves all execution provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const original = JSON.parse(preMergeModelRoutingJson());
    fs.writeFileSync(routingPath, preMergeModelRoutingJson(), 'utf8');

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true },
    );
    assert.strictEqual(outcome.status, 'updated');

    const rebound = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    const { closeout_binding: closeoutBinding, ...preserved } = rebound;
    assert.deepStrictEqual(preserved, original);
    assert.deepStrictEqual(closeoutBinding, {
      sha_type: 'merge_sha',
      merge_sha: MERGE_SHA,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      bound_at: '2026-05-26T00:00:00.000Z',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects a legacy top-level merge_sha that conflicts with the authoritative SHA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-legacy-conflict-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    // Real historical shape (e.g. docs/06_status/proof/UTV2-1531/model-routing.json):
    // a top-level merge_sha field pre-dating closeout_binding.
    const content = preMergeModelRoutingJson({ merge_sha: 'a-different-legacy-sha' });
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'legacy_binding_conflict',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content, 'no proof mutation on legacy conflict');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha accepts a legacy top-level merge_sha that already agrees with the authoritative SHA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-legacy-agree-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ merge_sha: MERGE_SHA }), 'utf8');

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true },
    );
    assert.strictEqual(outcome.status, 'updated');
    const rebound = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    assert.strictEqual(rebound.merge_sha, MERGE_SHA, 'legacy field is preserved, not overwritten');
    assert.strictEqual(rebound.closeout_binding.merge_sha, MERGE_SHA);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha replay is idempotent and preserves the original bound_at', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-idempotent-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson(), 'utf8');

    rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true },
    );
    const afterFirst = fs.readFileSync(routingPath, 'utf8');
    const second = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-27T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170/',
      { required: true },
    );

    assert.strictEqual(second.status, 'unchanged');
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), afterFirst);
    assert.strictEqual(
      JSON.parse(afterFirst).closeout_binding.bound_at,
      '2026-05-26T00:00:00.000Z',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const conflict of [
  {
    name: 'merge SHA',
    closeoutBinding: {
      sha_type: 'merge_sha',
      merge_sha: '3333333333333333333333333333333333333333',
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      bound_at: '2026-05-26T00:00:00.000Z',
    },
  },
  {
    name: 'PR URL',
    closeoutBinding: {
      sha_type: 'merge_sha',
      merge_sha: MERGE_SHA,
      pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/9999',
      bound_at: '2026-05-26T00:00:00.000Z',
    },
  },
]) {
  test(`rebindModelRoutingJsonSha fails closed on a conflicting ${conflict.name}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-conflict-'));
    try {
      const routingPath = path.join(root, 'model-routing.json');
      const content = preMergeModelRoutingJson({ closeout_binding: conflict.closeoutBinding });
      fs.writeFileSync(routingPath, content, 'utf8');

      assert.throws(
        () => rebindModelRoutingJsonSha(
          routingPath,
          MERGE_SHA,
          '2026-05-27T00:00:00.000Z',
          'https://github.com/griff843/Unit-Talk-v2/pull/1170',
          { required: true },
        ),
        (error) => error instanceof ModelRoutingRebindError && error.code === 'binding_conflict',
      );
      assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('rebindModelRoutingJsonSha rejects invalid JSON without overwriting it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-invalid-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = '{ invalid json\n';
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'malformed_required_sidecar',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects malformed JSON objects without overwriting them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-malformed-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = preMergeModelRoutingJson({ closeout_binding: { sha_type: 'merge_sha' } });
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'malformed_required_sidecar',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails when a required sidecar is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-missing-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'missing_required_sidecar',
    );
    assert.strictEqual(fs.existsSync(routingPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails without an authoritative PR URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-no-pr-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = preMergeModelRoutingJson();
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        null,
        { required: true },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'missing_pr_url',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects a required sidecar whose issue_id does not match the lane', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-identity-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = preMergeModelRoutingJson({ issue_id: 'UTV2-9999' });
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true, expectedIssueId: 'UTV2-1170' },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'sidecar_identity_mismatch',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects an identity-less sidecar (e.g. {}) even though it is otherwise valid JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-empty-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = `${JSON.stringify({})}\n`;
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true, expectedIssueId: 'UTV2-1170' },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'sidecar_identity_mismatch',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects a required sidecar truncated to only issue_id, even with a matching issue_id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-truncated-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    // Matches the lane's issue_id but was truncated/tampered so it carries no
    // execution-provenance fields at all -- the exact attack an independent
    // review flagged: this must not silently receive an authoritative binding.
    const content = `${JSON.stringify({ issue_id: 'UTV2-1170' })}\n`;
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true, expectedIssueId: 'UTV2-1170' },
      ),
      (error) =>
        error instanceof ModelRoutingRebindError &&
        error.code === 'incomplete_required_sidecar' &&
        error.message.includes('model') &&
        error.message.includes('reasoning_effort'),
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha rejects a required sidecar with model present but reasoning_effort blank', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-blank-effort-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = preMergeModelRoutingJson({ issue_id: 'UTV2-1170', reasoning_effort: '   ' });
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true, expectedIssueId: 'UTV2-1170' },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'incomplete_required_sidecar',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha does not require execution-provenance fields for an optional (non-required) sidecar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-optional-truncated-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, `${JSON.stringify({ issue_id: 'UTV2-1170' })}\n`, 'utf8');

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { expectedIssueId: 'UTV2-1170' },
    );
    assert.strictEqual(outcome.status, 'updated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── UTV2-1589: sidecar-vs-manifest routing agreement ────────────────────────

function matchingManifestRouting(overrides: Partial<{
  profile: string;
  model: string;
  reasoning_effort: string;
  policy_version: string;
}> = {}) {
  return {
    profile: 'codex-sol-high',
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    selected_by: 'three-brain' as const,
    policy_version: '1.0.0',
    ...overrides,
  };
}

test('rebindModelRoutingJsonSha binds when sidecar routing exactly matches the manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-manifest-match-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true, expectedIssueId: 'UTV2-1170', manifestModelRouting: matchingManifestRouting() },
    );
    assert.strictEqual(outcome.status, 'updated');
    const rebound = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    assert.strictEqual(rebound.closeout_binding.merge_sha, MERGE_SHA);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar model differs from manifest model_routing.model', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-model-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = preMergeModelRoutingJson({ issue_id: 'UTV2-1170' });
    fs.writeFileSync(routingPath, content, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: matchingManifestRouting({ model: 'claude-sonnet-5' }),
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
    assert.strictEqual(fs.readFileSync(routingPath, 'utf8'), content, 'no proof mutation on mismatch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar reasoning_effort differs from manifest model_routing.reasoning_effort', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-effort-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: matchingManifestRouting({ reasoning_effort: 'medium' }),
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar model_profile differs from manifest model_routing.profile (both present)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-profile-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: matchingManifestRouting({ profile: 'claude-sol-high' }),
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar policy_version differs from manifest model_routing.policy_version (both present)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-policy-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: matchingManifestRouting({ policy_version: '2.0.0' }),
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha does not fail on profile/policy_version absent from only one side', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-optional-fields-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    // Sidecar carries model_profile/policy_version; manifest routing (constructed
    // without overriding those) still carries them too per ModelRoutingBlock's
    // required fields -- so exercise the other direction: sidecar omits them.
    fs.writeFileSync(
      routingPath,
      `${JSON.stringify({
        issue_id: 'UTV2-1170',
        model: 'gpt-5.6-sol',
        reasoning_effort: 'high',
        override_used: false,
      })}\n`,
      'utf8',
    );

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true, expectedIssueId: 'UTV2-1170', manifestModelRouting: matchingManifestRouting() },
    );
    assert.strictEqual(outcome.status, 'updated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when the manifest model_routing block itself is missing required fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-manifest-incomplete-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          // Malformed manifest content: model present but blank.
          manifestModelRouting: matchingManifestRouting({ model: '   ' }),
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar override_used disagrees with manifest selected_by', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-override-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    // Sidecar claims no override was used; manifest says one was.
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170', override_used: false, override_authorized_by: null }),
      'utf8',
    );

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: {
            ...matchingManifestRouting(),
            selected_by: 'manual-override',
            override: { authorized_by: 'griff843', reason: 'urgent capacity swap' },
          },
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar override_authorized_by disagrees with manifest override.authorized_by', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-override-authorizer-mismatch-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170', override_used: true, override_authorized_by: 'someone-else' }),
      'utf8',
    );

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: {
            ...matchingManifestRouting(),
            selected_by: 'manual-override',
            override: { authorized_by: 'griff843', reason: 'urgent capacity swap' },
          },
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when manifest selected_by is manual-override but override.authorized_by is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-override-manifest-incomplete-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170', override_used: true, override_authorized_by: 'griff843' }),
      'utf8',
    );

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        {
          required: true,
          expectedIssueId: 'UTV2-1170',
          manifestModelRouting: {
            ...matchingManifestRouting(),
            selected_by: 'manual-override',
            // No `override` object at all -- malformed manifest.
          },
        },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha binds when sidecar override provenance agrees with a manual-override manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-override-agree-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(
      routingPath,
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170', override_used: true, override_authorized_by: 'griff843' }),
      'utf8',
    );

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      {
        required: true,
        expectedIssueId: 'UTV2-1170',
        manifestModelRouting: {
          ...matchingManifestRouting(),
          selected_by: 'manual-override',
          override: { authorized_by: 'griff843', reason: 'urgent capacity swap' },
        },
      },
    );
    assert.strictEqual(outcome.status, 'updated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha fails closed when sidecar is missing override_used entirely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-override-used-absent-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const content = JSON.parse(preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }));
    delete content.override_used;
    fs.writeFileSync(routingPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');

    assert.throws(
      () => rebindModelRoutingJsonSha(
        routingPath,
        MERGE_SHA,
        '2026-05-26T00:00:00.000Z',
        'https://github.com/griff843/Unit-Talk-v2/pull/1170',
        { required: true, expectedIssueId: 'UTV2-1170', manifestModelRouting: matchingManifestRouting() },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'sidecar_manifest_routing_mismatch',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha leaves ordinary closeout unchanged when the manifest has no model_routing block at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-routing-no-manifest-block-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    // No manifestModelRouting passed at all -- e.g. a Claude-authored or
    // schema_version 1 lane with no model_routing block. Behavior must be
    // identical to before this cross-check existed.
    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true, expectedIssueId: 'UTV2-1170' },
    );
    assert.strictEqual(outcome.status, 'updated');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha accepts a sidecar whose issue_id matches the lane', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-identity-match-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    fs.writeFileSync(routingPath, preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }), 'utf8');

    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
      { required: true, expectedIssueId: 'UTV2-1170' },
    );
    assert.strictEqual(outcome.status, 'updated');
    const rebound = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
    assert.strictEqual(rebound.closeout_binding.merge_sha, MERGE_SHA);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rebindModelRoutingJsonSha leaves an optional missing sidecar unaffected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-model-routing-optional-'));
  try {
    const routingPath = path.join(root, 'model-routing.json');
    const outcome = rebindModelRoutingJsonSha(
      routingPath,
      MERGE_SHA,
      '2026-05-26T00:00:00.000Z',
      'https://github.com/griff843/Unit-Talk-v2/pull/1170',
    );
    assert.deepStrictEqual(outcome, { path: routingPath, status: 'missing' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    issueId: 'UTV2-1586',
    prUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1306',
    mergeSha: 'fe09f637a7eeebf216e062dd4a003d7e38932d1a',
  },
  {
    issueId: 'UTV2-1585',
    prUrl: 'https://github.com/griff843/Unit-Talk-v2/pull/1305',
    mergeSha: '97527b791fc37acce41f4f46fd88699dce054b66',
  },
]) {
  test(`${fixture.issueId} fixture binds to its authoritative PR and merge SHA`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-rebind-real-fixture-'));
    try {
      const proofDir = path.join(root, 'docs/06_status/proof', fixture.issueId);
      const routingPath = path.join(proofDir, 'model-routing.json');
      fs.mkdirSync(proofDir, { recursive: true });
      // Read the REAL committed sidecar for this lane, not a synthesized
      // stand-in, so this test actually proves the real historical record
      // passes the new manifest-agreement validation (UTV2-1589 PM directive).
      const realSidecarContent = fs.readFileSync(
        path.join(ROOT, 'docs/06_status/proof', fixture.issueId, 'model-routing.json'),
        'utf8',
      );
      fs.writeFileSync(routingPath, realSidecarContent, 'utf8');
      // Read the REAL lane manifest's own model_routing block too -- not
      // derived from the sidecar just read, which would make this
      // comparison tautological and unable to catch a future drift between
      // the two real, independently-authored files (independent review
      // finding on the first version of this fixture).
      const realManifest = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'docs/06_status/lanes', `${fixture.issueId}.json`), 'utf8'),
      ) as LaneManifest;
      assert.ok(realManifest.model_routing, `${fixture.issueId} manifest must declare model_routing`);

      const fixtureInput = input({
        issue_id: fixture.issueId,
        commit_sha: fixture.mergeSha,
        pr_url: fixture.prUrl,
        expected_proof_paths: [
          `docs/06_status/proof/${fixture.issueId}/model-routing.json`,
        ],
        model_routing: realManifest.model_routing,
      });
      fixtureInput.gitTruth = gitTruth({
        merge_sha: fixture.mergeSha,
        diff_base_ref: `${fixture.mergeSha}^1`,
        diff_target_ref: fixture.mergeSha,
      });
      generateProofArtifacts(fixtureInput, { root, bindModelRouting: true });

      // The real committed sidecar may already be bound to this exact merge
      // SHA (once a lane's own governed closeout replay has run for real) --
      // rebindModelRoutingJsonSha treats that as idempotent-unchanged and
      // preserves the sidecar's own bound_at rather than overwriting it with
      // this fixture's injected generatedAt. Assert against whichever of the
      // two is actually correct for the real file's current state, instead
      // of a fixed literal that goes stale the moment the real lane closes.
      const realClosoutBinding = JSON.parse(realSidecarContent).closeout_binding;
      const alreadyBoundToThisMergeSha =
        realClosoutBinding?.sha_type === 'merge_sha' && realClosoutBinding?.merge_sha === fixture.mergeSha;
      assert.deepStrictEqual(
        JSON.parse(fs.readFileSync(routingPath, 'utf8')).closeout_binding,
        {
          sha_type: 'merge_sha',
          merge_sha: fixture.mergeSha,
          pr_url: fixture.prUrl,
          bound_at: alreadyBoundToThisMergeSha ? realClosoutBinding.bound_at : '2026-05-25T16:00:00.000Z',
        },
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('generateProofArtifacts validates required model-routing authority before any write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-routing-atomic-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofDir, 'model-routing.json'),
      preMergeModelRoutingJson({
        closeout_binding: {
          sha_type: 'merge_sha',
          merge_sha: '3333333333333333333333333333333333333333',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
          bound_at: '2026-05-26T00:00:00.000Z',
        },
      }),
      'utf8',
    );

    assert.throws(
      () => generateProofArtifacts(
        input({
          expected_proof_paths: [
            'docs/06_status/proof/UTV2-1170/model-routing.json',
          ],
        }),
        { root, bindModelRouting: true },
      ),
      (error) => error instanceof ModelRoutingRebindError && error.code === 'binding_conflict',
    );
    assert.strictEqual(fs.existsSync(path.join(proofDir, 'diff-summary.md')), false);
    assert.strictEqual(fs.existsSync(path.join(proofDir, 'verification.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts does not bind model-routing.json by default -- bindModelRouting must be explicitly opted into', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-skip-routing-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'evidence.json'), preMergeEvidenceJson(), 'utf8');
    fs.writeFileSync(path.join(proofDir, 'verification.md'), preMergeVerificationMd(), 'utf8');
    const routingContent = preMergeModelRoutingJson();
    fs.writeFileSync(path.join(proofDir, 'model-routing.json'), routingContent, 'utf8');

    const result = generateProofArtifacts(
      input({ expected_proof_paths: ['docs/06_status/proof/UTV2-1170/model-routing.json'] }),
      { root },
    );

    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/evidence.json'));
    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
    assert.ok(!result.updated_paths.some((p) => p.endsWith('model-routing.json')));
    assert.strictEqual(
      fs.readFileSync(path.join(proofDir, 'model-routing.json'), 'utf8'),
      routingContent,
      'model-routing.json is byte-for-byte untouched when bindModelRouting is not set',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts does not validate or throw on an otherwise-conflicting sidecar when bindModelRouting is not set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-skip-routing-no-validate-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(
      path.join(proofDir, 'model-routing.json'),
      preMergeModelRoutingJson({
        closeout_binding: {
          sha_type: 'merge_sha',
          merge_sha: '3333333333333333333333333333333333333333',
          pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1170',
          bound_at: '2026-05-26T00:00:00.000Z',
        },
      }),
      'utf8',
    );

    assert.doesNotThrow(() => generateProofArtifacts(
      input({ expected_proof_paths: ['docs/06_status/proof/UTV2-1170/model-routing.json'] }),
      { root },
    ));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts binds model-routing.json only when bindModelRouting is explicitly true (CLI --bind-model-routing)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-explicit-bind-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'model-routing.json'), preMergeModelRoutingJson(), 'utf8');

    const result = generateProofArtifacts(
      input({ expected_proof_paths: ['docs/06_status/proof/UTV2-1170/model-routing.json'] }),
      { root, bindModelRouting: true },
    );

    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/model-routing.json'));
    const rebound = JSON.parse(fs.readFileSync(path.join(proofDir, 'model-routing.json'), 'utf8'));
    assert.strictEqual(rebound.closeout_binding.merge_sha, MERGE_SHA);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts binds every declared model-routing.json sidecar, not just the first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-routing-multi-'));
  try {
    const primaryDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    const secondaryDir = path.join(root, 'docs/06_status/proof/UTV2-1170/secondary-executor');
    fs.mkdirSync(primaryDir, { recursive: true });
    fs.mkdirSync(secondaryDir, { recursive: true });
    fs.writeFileSync(
      path.join(primaryDir, 'model-routing.json'),
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170' }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(secondaryDir, 'model-routing.json'),
      preMergeModelRoutingJson({ issue_id: 'UTV2-1170', model: 'claude-sonnet-5' }),
      'utf8',
    );

    const result = generateProofArtifacts(
      input({
        expected_proof_paths: [
          'docs/06_status/proof/UTV2-1170/model-routing.json',
          'docs/06_status/proof/UTV2-1170/secondary-executor/model-routing.json',
        ],
      }),
      { root, bindModelRouting: true },
    );

    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/model-routing.json'));
    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/secondary-executor/model-routing.json'));

    const primary = JSON.parse(fs.readFileSync(path.join(primaryDir, 'model-routing.json'), 'utf8'));
    const secondary = JSON.parse(fs.readFileSync(path.join(secondaryDir, 'model-routing.json'), 'utf8'));
    assert.strictEqual(primary.closeout_binding.merge_sha, MERGE_SHA);
    assert.strictEqual(secondary.closeout_binding.merge_sha, MERGE_SHA);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts rebinds evidence.json and verification.md when a merge SHA is present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-rebind-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'evidence.json'), preMergeEvidenceJson(), 'utf8');
    fs.writeFileSync(path.join(proofDir, 'verification.md'), preMergeVerificationMd(), 'utf8');

    const result = generateProofArtifacts(input(), { root });

    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/evidence.json'));
    assert.ok(result.updated_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
    assert.ok(result.rebound_paths.includes('docs/06_status/proof/UTV2-1170/evidence.json'));
    assert.ok(result.rebound_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
    // UTV2-1631: rebinding is not replacement. Nothing was replaced.
    assert.deepStrictEqual(result.stale_paths_replaced, []);

    const evidence = JSON.parse(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));
    assert.strictEqual(evidence.sha_binding.verified_source_sha, MERGE_SHA);
    assert.strictEqual(evidence.sha_binding.sha_type, 'merge_sha');

    const verification = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');
    assert.match(verification, new RegExp(`\\| Commit SHA\\(s\\) \\| \`${MERGE_SHA}\` \\(merge SHA\\) \\|`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts does not fail for lanes without evidence.json/verification.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-no-evidence-'));
  try {
    const result = generateProofArtifacts(input(), { root });
    assert.strictEqual(result.ok, true);
    assert.ok(!result.updated_paths.some((p) => p.endsWith('evidence.json')));
    assert.ok(!result.updated_paths.some((p) => p.endsWith('verification.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generateProofArtifacts second run on rebound evidence/verification is unchanged (idempotent end-to-end)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-generate-rebind-idempotent-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'evidence.json'), preMergeEvidenceJson(), 'utf8');
    fs.writeFileSync(path.join(proofDir, 'verification.md'), preMergeVerificationMd(), 'utf8');

    generateProofArtifacts(input(), { root });
    const second = generateProofArtifacts(input(), { root });

    assert.ok(second.unchanged_paths.includes('docs/06_status/proof/UTV2-1170/evidence.json'));
    assert.ok(second.unchanged_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
    assert.deepStrictEqual(second.stale_paths_replaced, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// UTV2-1631 — destructive-mutation regression suite.
//
// These tests exist because `ops:proof-generate --merge-sha` used to replace a
// real measured T1 bundle with an empty `result: not_run` template and report
// the loss as `stale_paths_replaced`. `post-merge-lane-close.yml` runs it on
// every merge, so the destruction was automatic and silent while the lane still
// read as closed. Every assertion below fails against the pre-fix
// implementation; that was verified by restoring the pre-fix file and re-running
// this suite (see docs/06_status/proof/UTV2-1631/verification.md).
// ---------------------------------------------------------------------------

const PRIOR_MERGE_SHA = '3333333333333333333333333333333333333333';

/** Modeled on the real UTV2-1628 bundle: prose, assertions, and measurements. */
function measuredVerificationMd(mergeSha: string): string {
  return [
    '# PROOF: UTV2-1170',
    '',
    `MERGE_SHA: ${mergeSha}`,
    '',
    'That is the authoritative merge SHA. The pre-fix baseline this lane measures',
    'against is a different commit, named throughout below.',
    '',
    '## Summary',
    '',
    'Every privileged database client is constructed in one place, and that place',
    'refuses to open a connection to canonical production from a test process.',
    '',
    'ASSERTIONS:',
    '',
    '1. 93 call sites collapsed to 1 constructor. Measured, not estimated.',
    '2. `pnpm verify` is green on the merge SHA.',
    '',
    '## Verification',
    '',
    '- `pnpm verify` — PASS (CI run 30591605559)',
    '- `pnpm type-check` — PASS',
    '',
    'EVIDENCE:',
    '',
    '## Evidence',
    '',
    '| Query | Rows |',
    '|---|---|',
    '| select count(*) from picks where lane = $1 | 1042 |',
    '| select count(*) from provider_offer_history | 1390221 |',
    '',
    '## Row Counts (custom section)',
    '',
    'picks=1042 outbox=17 delivery_outcomes=17',
    '',
  ].join('\n');
}

function measuredEvidenceJson(mergeSha: string): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      issue_id: 'UTV2-1170',
      tier: 'T1',
      title: 'One enforced boundary for every privileged database client',
      implementation_sha: 'a35030ebb3130e5c61b697fa421b13bbb2c1b7f5',
      status: 'merged',
      sha_binding: {
        verified_source_sha: mergeSha,
        merge_sha: mergeSha,
        base_sha: 'fd0b3a114a403065238e562f1ea5b82033f78cdf',
        sha_type: 'merge_sha',
        verified_source_note: 'Every static measurement below was taken on the implementation commit.',
        bound_at: '2026-07-31T00:53:51.470Z',
      },
      verifier: {
        identity: 'github-actions/CI — run 30591605559, job staging-db-proof',
        method: 'scripts/ci/verify-db-proof-receipt.ts re-checked the receipt and printed Verdict: PASS.',
      },
      ci_receipt: {
        run_id: '30591605559',
        job: 'staging-db-proof',
        conclusion: 'success',
        receipt_digest: 'sha256:9f2c1e',
      },
      runtime_proof: {
        queries: [
          { sql: 'select count(*) from picks where lane = $1', rows: 1042 },
          { sql: 'select count(*) from provider_offer_history', rows: 1390221 },
          { sql: 'select count(*) from outbox where status = $1', rows: 17 },
        ],
        row_counts: {
          picks: 1042,
          outbox: 17,
          delivery_outcomes: 17,
          provider_offer_history: 1390221,
        },
      },
      static_proof: { verify: { command: 'pnpm verify', status: 'PASS' } },
      custom_lane_section: { note: 'hand-authored, must survive verbatim' },
    },
    null,
    2,
  )}\n`;
}

function seedMeasuredBundle(root: string, mergeSha: string): string {
  const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'verification.md'), measuredVerificationMd(mergeSha), 'utf8');
  fs.writeFileSync(path.join(proofDir, 'evidence.json'), measuredEvidenceJson(mergeSha), 'utf8');
  fs.writeFileSync(
    path.join(proofDir, 'diff-summary.md'),
    `# UTV2-1170 authored diff notes\n\nMerge SHA: ${mergeSha}\n\nThe rename in packages/db was mechanical; the behaviour change is in the guard.\n`,
    'utf8',
  );
  return proofDir;
}

test('UTV2-1631: measured verification.md survives rebinding byte-identically except its MERGE_SHA line', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-preserve-md-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);
    const before = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');

    const result = generateProofArtifacts(input(), { root });

    const after = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');

    // The ONLY difference is the merge SHA token.
    assert.strictEqual(after, before.replace(PRIOR_MERGE_SHA, MERGE_SHA));
    assert.strictEqual(after, measuredVerificationMd(MERGE_SHA));

    // Nothing was scaffolded over the top of it.
    assert.doesNotMatch(after, /result: not_run/);
    assert.doesNotMatch(after, /not run by proof-generate/);
    assert.doesNotMatch(after, /Generated foundation artifact/);

    // Every measurement, assertion, custom section and prose block survives.
    assert.match(after, /1390221/);
    assert.match(after, /93 call sites collapsed to 1 constructor/);
    assert.match(after, /## Row Counts \(custom section\)/);
    assert.match(after, /picks=1042 outbox=17 delivery_outcomes=17/);
    assert.match(after, /CI run 30591605559/);
    assert.match(after, /## Summary/);
    assert.match(after, /## Evidence/);

    assert.deepStrictEqual(result.stale_paths_replaced, []);
    assert.ok(result.preserved_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
    assert.ok(result.rebound_paths.includes('docs/06_status/proof/UTV2-1170/verification.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: measured evidence.json keeps queries, row_counts, verifier.identity and ci_receipt; only SHA fields move', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-preserve-json-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);
    const before = JSON.parse(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));

    generateProofArtifacts(input(), { root });

    const after = JSON.parse(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));

    assert.deepStrictEqual(after.runtime_proof.queries, before.runtime_proof.queries);
    assert.deepStrictEqual(after.runtime_proof.row_counts, before.runtime_proof.row_counts);
    assert.strictEqual(after.runtime_proof.row_counts.provider_offer_history, 1390221);
    assert.deepStrictEqual(after.verifier, before.verifier);
    assert.strictEqual(after.verifier.identity, before.verifier.identity);
    assert.deepStrictEqual(after.ci_receipt, before.ci_receipt);
    assert.deepStrictEqual(after.static_proof, before.static_proof);
    assert.deepStrictEqual(after.custom_lane_section, before.custom_lane_section);
    assert.strictEqual(after.title, before.title);
    assert.strictEqual(after.sha_binding.verified_source_note, before.sha_binding.verified_source_note);
    assert.strictEqual(after.sha_binding.base_sha, before.sha_binding.base_sha);

    // implementation_sha names the commit the measurements were taken on — it is
    // not a merge-SHA-bearing field and must NOT be rewritten to the merge SHA.
    assert.strictEqual(after.implementation_sha, before.implementation_sha);

    // Only the merge-SHA-bearing fields (and bound_at) differ.
    assert.strictEqual(after.sha_binding.verified_source_sha, MERGE_SHA);
    assert.strictEqual(after.sha_binding.merge_sha, MERGE_SHA);
    assert.strictEqual(after.sha_binding.sha_type, 'merge_sha');
    assert.notStrictEqual(after.sha_binding.bound_at, before.sha_binding.bound_at);

    const volatile = new Set(['verified_source_sha', 'merge_sha', 'sha_type', 'bound_at']);
    for (const key of Object.keys(before.sha_binding)) {
      if (!volatile.has(key)) {
        assert.deepStrictEqual(after.sha_binding[key], before.sha_binding[key], `sha_binding.${key} changed`);
      }
    }
    for (const key of Object.keys(before)) {
      if (key !== 'sha_binding') {
        assert.deepStrictEqual(after[key], before[key], `${key} changed`);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: a sibling sha_binding.merge_sha is rebound too, so the bundle cannot assert two merge identities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-sibling-sha-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);

    generateProofArtifacts(input(), { root });

    const after = JSON.parse(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'));
    assert.strictEqual(after.sha_binding.verified_source_sha, after.sha_binding.merge_sha);
    assert.ok(!JSON.stringify(after.sha_binding).includes(PRIOR_MERGE_SHA));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: authored diff-summary.md is preserved and rebound, never regenerated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-preserve-diff-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);

    generateProofArtifacts(input(), { root });

    const after = fs.readFileSync(path.join(proofDir, 'diff-summary.md'), 'utf8');
    assert.match(after, /The rename in packages\/db was mechanical/);
    assert.match(after, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.doesNotMatch(after, /## Git Name Status/);
    assert.doesNotMatch(after, /## Manifest Files Changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: an unparseable evidence.json is left byte-identical and the run throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-unparseable-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);
    const corrupt = '{ "schema_version": 1, "runtime_proof": { "queries": [ TRUNCATED\n';
    fs.writeFileSync(path.join(proofDir, 'evidence.json'), corrupt, 'utf8');
    const verificationBefore = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');

    assert.throws(
      () => generateProofArtifacts(input(), { root }),
      (error: unknown) =>
        error instanceof ProofPreservationError && error.code === 'malformed_evidence_json',
    );

    // Untouched — and because validation runs before any write, the rest of the
    // bundle is untouched too.
    assert.strictEqual(fs.readFileSync(path.join(proofDir, 'evidence.json'), 'utf8'), corrupt);
    assert.strictEqual(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8'), verificationBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: an authored artifact with no merge-SHA anchor fails loudly and is left untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-unbindable-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    const authored = '# PROOF: UTV2-1170\n\nASSERTIONS: measured, but no SHA anchor anywhere.\n';
    fs.writeFileSync(path.join(proofDir, 'verification.md'), authored, 'utf8');

    assert.throws(
      () => generateProofArtifacts(input(), { root }),
      (error: unknown) =>
        error instanceof ProofPreservationError && error.code === 'unbindable_proof_artifact',
    );

    assert.strictEqual(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8'), authored);
    assert.ok(!fs.existsSync(path.join(proofDir, 'diff-summary.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: a pre-merge run never touches an authored bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-premerge-'));
  try {
    const proofDir = seedMeasuredBundle(root, PRIOR_MERGE_SHA);
    const before = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');

    const preMergeInput = {
      ...input({ commit_sha: null }),
      gitTruth: gitTruth({ merge_sha: null, diff_base_ref: 'base-sha', diff_target_ref: HEAD_SHA }),
    };
    const result = generateProofArtifacts(preMergeInput, { root });

    assert.strictEqual(fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8'), before);
    assert.deepStrictEqual(result.generated_paths, []);
    assert.deepStrictEqual(result.stale_paths_replaced, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: templates are still written when no bundle exists yet', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1630-template-'));
  try {
    const result = generateProofArtifacts(input(), { root });
    assert.deepStrictEqual(result.generated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/verification.md',
    ]);
    assert.deepStrictEqual(result.preserved_paths, []);
    const verification = fs.readFileSync(
      path.join(root, 'docs/06_status/proof/UTV2-1170/verification.md'),
      'utf8',
    );
    assert.match(verification, /result: not_run/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('UTV2-1631: a MERGE_SHA line quoted inside a fenced evidence block is not rewritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1631-fence-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    const authored = [
      '# PROOF: UTV2-1170',
      '',
      `MERGE_SHA: ${PRIOR_MERGE_SHA}`,
      '',
      '## Evidence',
      '',
      '```',
      'MERGE_SHA: 4444444444444444444444444444444444444444',
      'Merge SHA: 5555555555555555555555555555555555555555',
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(proofDir, 'verification.md'), authored, 'utf8');

    generateProofArtifacts(input(), { root });

    const after = fs.readFileSync(path.join(proofDir, 'verification.md'), 'utf8');
    assert.match(after, new RegExp(`^MERGE_SHA: ${MERGE_SHA}$`, 'm'));
    // The quoted evidence is a measurement — it survives verbatim.
    assert.match(after, /^MERGE_SHA: 4444444444444444444444444444444444444444$/m);
    assert.match(after, /^Merge SHA: 5555555555555555555555555555555555555555$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── autoHarvestCiDbProofIntoEvidence (UTV2-1641) ──────────────────────────────
//
// Real fixture data captured from UTV2-1399's own merge (PR #1343, run
// 30680085299, job 91315210076) -- see
// scripts/ops/ci-db-proof-harvest.test.ts's header comment for full provenance.

const HARVEST_FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'utv2-1641-ci-db-proof');
const HARVEST_REAL_RECEIPT_RAW = fs.readFileSync(path.join(HARVEST_FIXTURES_DIR, 'real-utv2-1399-receipt.json'), 'utf8');
const HARVEST_REAL_JOB_LOG = fs.readFileSync(path.join(HARVEST_FIXTURES_DIR, 'real-utv2-1399-job-log.txt'), 'utf8');
const HARVEST_REAL_TEST_SOURCE = fs.readFileSync(path.join(ROOT, 'apps/api/src/database-smoke.test.ts'), 'utf8');
const HARVEST_MERGE_SHA = 'fdc193582f94ad7538fa594b475847eb81a3647f';
/**
 * PR #1343's true head. UTV2-1683: this was previously set to the receipt's
 * `github_sha` (b36840e4), which is actually GitHub's merge-ref commit for a
 * `pull_request` run, not the head. See ci-db-proof-harvest.test.ts.
 */
const HARVEST_HEAD_SHA = '4aaa6c56d3f741b7bcc9ae9cd17c1478120f3772';
const HARVEST_MERGE_REF_SHA = 'b36840e452333cb605e1d0c61f3aec547e50be3d';
const HARVEST_MERGE_REF_BASE_SHA = 'f4c529b51267d86c2dfbd38bdcfab527bd31668c';
const HARVEST_RUN_ID = 30680085299;
const HARVEST_JOB_ID = 91315210076;

function harvestHappyPathExecutor(): GhExecutor {
  return (args: string[]) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${HARVEST_MERGE_SHA}`)) {
      // Fixture is a pull_request run: the merge commit has no run of its own.
      return Buffer.from(JSON.stringify({ workflow_runs: [] }));
    }
    if (key.includes(`commits/${HARVEST_MERGE_REF_SHA}`) && !key.includes('/pulls')) {
      // A2 ancestry proof: merge ref's second parent is the PR head.
      return Buffer.from(
        JSON.stringify({
          sha: HARVEST_MERGE_REF_SHA,
          parents: [{ sha: HARVEST_MERGE_REF_BASE_SHA }, { sha: HARVEST_HEAD_SHA }],
        }),
      );
    }
    if (key.includes(`commits/${HARVEST_MERGE_SHA}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 1343, head: { sha: HARVEST_HEAD_SHA } }]));
    }
    if (key.includes(`actions/workflows/ci.yml/runs?head_sha=${HARVEST_HEAD_SHA}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: HARVEST_RUN_ID, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes(`actions/runs?head_sha=${HARVEST_HEAD_SHA}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: HARVEST_RUN_ID, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes(`actions/runs/${HARVEST_RUN_ID}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [{ id: HARVEST_JOB_ID, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success' }],
        }),
      );
    }
    if (key.includes(`actions/runs/${HARVEST_RUN_ID}/artifacts`)) {
      return Buffer.from(
        JSON.stringify({ artifacts: [{ id: 8811926669, name: `utv2-1630-db-proof-receipt-${HARVEST_RUN_ID}-1`, expired: false }] }),
      );
    }
    if (key.includes('actions/artifacts/8811926669/zip')) {
      return Buffer.from('FAKE_ZIP');
    }
    if (key.includes(`actions/jobs/${HARVEST_JOB_ID}/logs`)) {
      return Buffer.from(HARVEST_REAL_JOB_LOG, 'utf8');
    }
    throw Object.assign(new Error(`harvestHappyPathExecutor: unexpected call "${key}"`), { stderr: 'unexpected' });
  };
}

function writeHarvestEvidence(root: string, issueId: string, evidence: Record<string, unknown>): string {
  const dir = path.join(root, 'docs/06_status/proof', issueId);
  fs.mkdirSync(dir, { recursive: true });
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  return evidencePath;
}

test('autoHarvestCiDbProofIntoEvidence: no merge SHA -> no-op, nothing attempted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-no-sha-'));
  try {
    writeHarvestEvidence(root, 'UTV2-9001', { schema_version: 1 });
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9001', null, 'claude');
    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'no_merge_sha');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoHarvestCiDbProofIntoEvidence: no evidence.json at all -> no-op (T2/T3 lanes never harvest into nothing)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-no-evidence-'));
  try {
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9002', HARVEST_MERGE_SHA, 'claude');
    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'no_evidence_bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoHarvestCiDbProofIntoEvidence: already-populated runtime_proof -> no-op, never overwrites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-already-'));
  try {
    writeHarvestEvidence(root, 'UTV2-9003', {
      schema_version: 1,
      verifier: { identity: 'existing-verifier' },
      runtime_proof: { queries: [{ table: 'picks', description: 'x' }], row_counts: [{ table: 'picks', count: 1, status: 'y' }] },
    });
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9003', HARVEST_MERGE_SHA, 'claude');
    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.code, 'already_populated');
    const untouched = JSON.parse(fs.readFileSync(path.join(root, 'docs/06_status/proof/UTV2-9003/evidence.json'), 'utf8'));
    assert.strictEqual(untouched.verifier.identity, 'existing-verifier');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BEFORE/AFTER (UTV2-1641): a genuine CI receipt harvests real runtime_proof into evidence.json and preserves the pre-existing rich verifier (UTV2-1642)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-happy-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9004', {
      schema_version: 1,
      issue_id: 'UTV2-9004',
      verifier: {
        identity: 'read-only measurement against production Supabase',
        method: 'every count is quoted alongside the exact SQL that produced it',
        independence_note: 'measured in the opposite direction, not by narrative',
      },
      runtime_proof: { status: 'not_run', reason: 'pnpm test:db requires an active lane' },
    });

    // BEFORE: R1/R2 would fail -- queries/row_counts are absent.
    const before = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.strictEqual(Array.isArray(before.runtime_proof?.queries), false);

    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9004', HARVEST_MERGE_SHA, 'claude', {
      ghExecutor: harvestHappyPathExecutor(),
      zipExtractor: () => HARVEST_REAL_RECEIPT_RAW,
      testSourceText: HARVEST_REAL_TEST_SOURCE,
    });

    assert.strictEqual(result.attempted, true, JSON.stringify(result));
    assert.strictEqual(result.applied, true, JSON.stringify(result));
    assert.strictEqual(result.code, 'harvested');

    // AFTER: R1/R2 would now pass -- both arrays are real and non-empty.
    const after = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.ok(Array.isArray(after.runtime_proof.queries) && after.runtime_proof.queries.length > 0);
    assert.ok(Array.isArray(after.runtime_proof.row_counts) && after.runtime_proof.row_counts.length > 0);
    assert.strictEqual(after.runtime_proof.queries.length, 7);
    assert.strictEqual(after.runtime_proof.row_counts.length, 8);

    // UTV2-1642: the pre-existing rich verifier narrative survives; only
    // identity is extended, never replaced.
    assert.strictEqual(after.verifier.method, 'every count is quoted alongside the exact SQL that produced it');
    assert.strictEqual(after.verifier.independence_note, 'measured in the opposite direction, not by narrative');
    assert.match(after.verifier.identity, /^read-only measurement against production Supabase; runtime_proof auto-harvested/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoHarvestCiDbProofIntoEvidence: no CI evidence exists for this merge SHA -> fails closed, evidence.json untouched (R1/R2 stay honestly failed)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-noci-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9005', {
      schema_version: 1,
      issue_id: 'UTV2-9005',
      runtime_proof: { status: 'not_run' },
    });
    const before = fs.readFileSync(evidencePath, 'utf8');

    const noPrExecutor: GhExecutor = () => Buffer.from(JSON.stringify([]));
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9005', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'claude', {
      ghExecutor: noPrExecutor,
    });

    assert.strictEqual(result.attempted, true);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'no_pr_for_merge_sha');

    const after = fs.readFileSync(evidencePath, 'utf8');
    assert.strictEqual(after, before, 'evidence.json must be byte-identical when the harvest finds no CI evidence');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoHarvestCiDbProofIntoEvidence: refuses when the harvested verifier identity would equal manifest.created_by', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-identity-'));
  try {
    writeHarvestEvidence(root, 'UTV2-9006', { schema_version: 1, runtime_proof: { status: 'not_run' } });
    const collidingCreator =
      'runtime_proof auto-harvested by ops:proof-generate from CI job "Writable DB proof (staging only)" ' +
      `(run ${HARVEST_RUN_ID}, job ${HARVEST_JOB_ID})`;
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9006', HARVEST_MERGE_SHA, collidingCreator, {
      ghExecutor: harvestHappyPathExecutor(),
      zipExtractor: () => HARVEST_REAL_RECEIPT_RAW,
      testSourceText: HARVEST_REAL_TEST_SOURCE,
    });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'verifier_identity_matches_creator');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoHarvestCiDbProofIntoEvidence: --dry-run-equivalent (write:false) computes but does not persist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-harvest-dryrun-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9007', { schema_version: 1, runtime_proof: { status: 'not_run' } });
    const before = fs.readFileSync(evidencePath, 'utf8');
    const result = autoHarvestCiDbProofIntoEvidence(root, 'UTV2-9007', HARVEST_MERGE_SHA, 'claude', {
      ghExecutor: harvestHappyPathExecutor(),
      zipExtractor: () => HARVEST_REAL_RECEIPT_RAW,
      testSourceText: HARVEST_REAL_TEST_SOURCE,
      write: false,
    });
    assert.strictEqual(result.applied, true);
    const after = fs.readFileSync(evidencePath, 'utf8');
    assert.strictEqual(after, before, 'write:false must not persist anything to disk');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── autoPopulateStaticProofFromVerifyRun (UTV2-1683 B) ───────────────────────

const STATIC_MERGE_SHA = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
const STATIC_RUN_ID = 31276897581;
const STATIC_VERIFY_JOB_ID = 93152450883;

/** CI on the merge SHA's own push, with a successful `verify` job. */
function verifyRunExecutor(conclusion: string | null = 'success'): GhExecutor {
  return (args: string[]) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${STATIC_MERGE_SHA}`)) {
      return Buffer.from(
        JSON.stringify({
          workflow_runs: [
            {
              id: STATIC_RUN_ID,
              name: 'CI',
              conclusion: 'success',
              html_url: `https://github.com/griff843/Unit-Talk-v2/actions/runs/${STATIC_RUN_ID}`,
            },
          ],
        }),
      );
    }
    if (key.includes(`actions/runs/${STATIC_RUN_ID}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [
            { id: 93151835178, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success' },
            {
              id: STATIC_VERIFY_JOB_ID,
              name: 'verify',
              run_attempt: 1,
              conclusion,
              html_url: `https://github.com/griff843/Unit-Talk-v2/actions/runs/${STATIC_RUN_ID}/job/${STATIC_VERIFY_JOB_ID}`,
            },
          ],
        }),
      );
    }
    throw Object.assign(new Error(`verifyRunExecutor: unexpected call "${key}"`), { stderr: 'unexpected' });
  };
}

test('autoPopulateStaticProofFromVerifyRun: populates static_proof from the merge SHA verify run, bound to that SHA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-ok-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9101', { schema_version: 1 });
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9101', STATIC_MERGE_SHA, {
      ghExecutor: verifyRunExecutor(),
    });
    assert.strictEqual(result.applied, true, result.reason);
    assert.strictEqual(result.code, 'static_proof_populated');

    const written = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert.strictEqual(written.static_proof.conclusion, 'success');
    assert.strictEqual(written.static_proof.merge_sha, STATIC_MERGE_SHA);
    assert.strictEqual(written.static_proof.run_id, STATIC_RUN_ID);
    assert.match(written.static_proof.run_url, /actions\/runs\/31276897581/);
    // P8 reads test_run_logs[].merge_sha — it must carry the merge SHA.
    assert.strictEqual(written.static_proof.test_run_logs[0].merge_sha, STATIC_MERGE_SHA);
    assert.ok(written.static_proof.test_run_logs[0].path.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoPopulateStaticProofFromVerifyRun: a verify job that did NOT succeed fails closed and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-red-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9102', { schema_version: 1 });
    const before = fs.readFileSync(evidencePath, 'utf8');
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9102', STATIC_MERGE_SHA, {
      ghExecutor: verifyRunExecutor('failure'),
    });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'verify_job_not_successful');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), before, 'a red gate must never be recorded as static proof');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoPopulateStaticProofFromVerifyRun: no verify job for the merge SHA fails closed and writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-nojob-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9103', { schema_version: 1 });
    const before = fs.readFileSync(evidencePath, 'utf8');
    const ghExecutor: GhExecutor = (args: string[]) => {
      const key = args.join(' ');
      if (key.includes(`head_sha=${STATIC_MERGE_SHA}`)) {
        return Buffer.from(JSON.stringify({ workflow_runs: [{ id: STATIC_RUN_ID, name: 'CI', conclusion: 'success' }] }));
      }
      return Buffer.from(JSON.stringify({ jobs: [{ id: 1, name: 'Housekeeping', conclusion: 'success' }] }));
    };
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9103', STATIC_MERGE_SHA, { ghExecutor });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'no_verify_job');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoPopulateStaticProofFromVerifyRun: an already-populated static_proof is never overwritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-already-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9104', {
      schema_version: 1,
      static_proof: { command: 'hand authored', conclusion: 'success' },
    });
    const before = fs.readFileSync(evidencePath, 'utf8');
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9104', STATIC_MERGE_SHA, {
      ghExecutor: verifyRunExecutor(),
    });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.code, 'already_populated');
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoPopulateStaticProofFromVerifyRun: no evidence.json -> no-op (T2/T3 lanes never gain a bundle)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-noevidence-'));
  try {
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9105', STATIC_MERGE_SHA, {
      ghExecutor: verifyRunExecutor(),
    });
    assert.strictEqual(result.attempted, false);
    assert.strictEqual(result.code, 'no_evidence_bundle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoPopulateStaticProofFromVerifyRun: write:false persists nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1683-static-dryrun-'));
  try {
    const evidencePath = writeHarvestEvidence(root, 'UTV2-9106', { schema_version: 1 });
    const before = fs.readFileSync(evidencePath, 'utf8');
    const result = autoPopulateStaticProofFromVerifyRun(root, 'UTV2-9106', STATIC_MERGE_SHA, {
      ghExecutor: verifyRunExecutor(),
      write: false,
    });
    assert.strictEqual(result.applied, true);
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), before, 'write:false must not persist anything to disk');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
