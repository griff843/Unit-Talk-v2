import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDiffSummary,
  buildRuntimeVerification,
  applyProofManifestOverrides,
  collectProofGitTruth,
  detectCurrentProofContext,
  generateProofArtifacts,
  rebindEvidenceJsonSha,
  rebindMergeSha,
  rebindVerificationMdSha,
  standardProofPaths,
  type ProofGitTruth,
} from './proof-generate.js';
import type { LaneManifest } from './shared.js';

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
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
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

test('standard proof paths target diff summary and runtime verification docs', () => {
  assert.deepStrictEqual(standardProofPaths('utv2-1170'), {
    'diff-summary.md': 'docs/06_status/proof/UTV2-1170/diff-summary.md',
    'runtime-verification.md': 'docs/06_status/proof/UTV2-1170/runtime-verification.md',
  });
});

test('generated artifacts include manifest metadata, git truth, and SHA bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-generate-'));
  try {
    const result = generateProofArtifacts(input(), { root });
    const diffPath = path.join(root, 'docs/06_status/proof/UTV2-1170/diff-summary.md');
    const runtimePath = path.join(root, 'docs/06_status/proof/UTV2-1170/runtime-verification.md');

    assert.deepStrictEqual(result.generated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.strictEqual(result.head_sha, HEAD_SHA);
    assert.strictEqual(result.merge_sha, MERGE_SHA);
    assert.strictEqual(fs.existsSync(diffPath), true);
    assert.strictEqual(fs.existsSync(runtimePath), true);

    const diffContent = fs.readFileSync(diffPath, 'utf8');
    const runtimeContent = fs.readFileSync(runtimePath, 'utf8');
    assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(diffContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(diffContent, /A\tscripts\/ops\/proof-generate\.ts/);
    assert.match(runtimeContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
    assert.match(runtimeContent, new RegExp(`Merge SHA: ${MERGE_SHA}`));
    assert.match(runtimeContent, /^## Verification/m);
    assert.match(runtimeContent, /`pnpm type-check`/);
    assert.match(runtimeContent, /`pnpm test`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing artifacts are updated when they are missing current SHA bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-stale-'));
  try {
    const proofDir = path.join(root, 'docs/06_status/proof/UTV2-1170');
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, 'diff-summary.md'), 'Merge SHA: stale\n', 'utf8');
    fs.writeFileSync(path.join(proofDir, 'runtime-verification.md'), 'Head SHA: stale\n', 'utf8');

    const result = generateProofArtifacts(input(), { root });

    assert.deepStrictEqual(result.generated_paths, []);
    assert.deepStrictEqual(result.updated_paths, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.deepStrictEqual(result.stale_paths_replaced, [
      'docs/06_status/proof/UTV2-1170/diff-summary.md',
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
    ]);
    assert.match(
      fs.readFileSync(path.join(proofDir, 'runtime-verification.md'), 'utf8'),
      new RegExp(`Merge SHA: ${MERGE_SHA}`),
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
      'docs/06_status/proof/UTV2-1170/runtime-verification.md',
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
  const runtimeContent = buildRuntimeVerification(preMergeInput);

  assert.match(diffContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(diffContent, /Merge SHA: N\/A/);
  assert.match(runtimeContent, new RegExp(`Head SHA: ${HEAD_SHA}`));
  assert.match(runtimeContent, /Merge SHA: N\/A/);
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
    assert.ok(result.stale_paths_replaced.includes('docs/06_status/proof/UTV2-1170/evidence.json'));
    assert.ok(result.stale_paths_replaced.includes('docs/06_status/proof/UTV2-1170/verification.md'));

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
