import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildT2ProofBundle,
  generateT2ProofBundle,
  isEligibleT2OpsLane,
  isMarkdownProofPath,
  readOptionalFile,
} from './t2-proof-bundle.js';
import type { LaneManifest } from './shared.js';

function manifest(overrides: Partial<LaneManifest> = {}): LaneManifest {
  return {
    schema_version: 1,
    issue_id: 'UTV2-1067',
    lane_type: 'governance',
    executor: 'codex-cli',
    tier: 'T2',
    worktree_path: '.out/worktrees/codex__utv2-1067-t2-proof-bundle',
    branch: 'codex/utv2-1067-t2-proof-bundle',
    base_branch: 'main',
    commit_sha: 'abc123merge',
    pr_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1067',
    files_changed: ['scripts/ops/t2-proof-bundle.ts', 'scripts/ops/t2-proof-bundle.test.ts'],
    file_scope_lock: ['scripts/ops/t2-proof-bundle.ts', 'scripts/ops/t2-proof-bundle.test.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md'],
    status: 'merged',
    started_at: '2026-05-19T00:00:00.000Z',
    heartbeat_at: '2026-05-19T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: '.out/ops/preflight/codex/utv2-1067-t2-proof-bundle.json',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

function input(overrides: Partial<LaneManifest> = {}) {
  return {
    manifest: manifest(overrides),
    generatedAt: '2026-05-19T18:30:00.000Z',
    diffSummary: 'scripts/ops/t2-proof-bundle.ts | 120 ++++++++++',
    verificationSummary: 'pnpm verify: PASS',
    rLevelOutput: 'R-level compliance: PASS',
  };
}

test('eligible T2 ops lane writes missing declared proof path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-'));
  try {
    const result = generateT2ProofBundle(input(), { root });
    const proofPath = path.join(root, 'docs/06_status/proof/UTV2-1067/t2-proof-bundle.md');

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.generated_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.strictEqual(fs.existsSync(proofPath), true);
    const content = fs.readFileSync(proofPath, 'utf8');
    assert.match(content, /PR URL: https:\/\/github\.com\/griff843\/Unit-Talk-v2\/pull\/1067/);
    assert.match(content, /Merge SHA: abc123merge/);
    assert.match(content, /pnpm verify: PASS/);
    assert.match(content, /R-level compliance: PASS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime and T1 lanes are not eligible for generated T2 proof', () => {
  assert.strictEqual(isEligibleT2OpsLane(manifest({ lane_type: 'runtime' })), false);
  assert.strictEqual(isEligibleT2OpsLane(manifest({ tier: 'T1' })), false);

  const runtime = generateT2ProofBundle(input({ lane_type: 'runtime' }), {
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-runtime-')),
  });
  assert.strictEqual(runtime.ok, false);
  assert.strictEqual(runtime.code, 'proof_ineligible');
});

test('missing merge SHA is a hard failure', () => {
  const result = generateT2ProofBundle(input({ commit_sha: null }), {
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-sha-')),
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'missing_merge_sha');
});

test('generated proof content is SHA-bound', () => {
  const content = buildT2ProofBundle(input());

  assert.match(content, /Merge SHA: abc123merge/);
  assert.match(content, /This proof bundle is bound to merge SHA abc123merge\./);
});

test('existing proof path is skipped unless force is supplied', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-existing-'));
  try {
    const proofPath = path.join(root, 'docs/06_status/proof/UTV2-1067/t2-proof-bundle.md');
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, 'existing proof\n', 'utf8');

    const skipped = generateT2ProofBundle(input(), { root });
    assert.deepStrictEqual(skipped.generated_paths, []);
    assert.deepStrictEqual(skipped.skipped_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.strictEqual(fs.readFileSync(proofPath, 'utf8'), 'existing proof\n');

    const forced = generateT2ProofBundle(input(), { root, force: true });
    assert.deepStrictEqual(forced.generated_paths, ['docs/06_status/proof/UTV2-1067/t2-proof-bundle.md']);
    assert.match(fs.readFileSync(proofPath, 'utf8'), /Merge SHA: abc123merge/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// UTV2-1838 -- the coupled pair.
//
// `lane-finalize.ts` always passes `--force`, and 27 T2-eligible lane manifests
// on `main` declare a structured sidecar (`evidence.json`, `model-routing.json`)
// in `expected_proof_paths`. Until 2026-09-06 the only thing stopping the
// Markdown bundle from landing on top of one of those was an unrelated ENOENT
// crash in `readOptionalFile`, thrown while evaluating an argument before the
// writer ever ran. Repairing that crash unmasks the overwrite, so the guard and
// the repair land together.
//
// INVERSION: delete the `!isMarkdownProofPath(proofPath)` branch in
// `generateT2ProofBundle` and this test fails on the file's *content* -- the
// JSON is replaced by the Markdown bundle -- not merely on an exit code.
test('force never overwrites a non-Markdown declared proof artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-json-'));
  try {
    const evidenceRel = 'docs/06_status/proof/UTV2-1067/evidence.json';
    const markdownRel = 'docs/06_status/proof/UTV2-1067/t2-proof-bundle.md';
    const evidencePath = path.join(root, evidenceRel);
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    const originalEvidence = JSON.stringify({ schema_version: 2, static_proof: {} }, null, 2);
    fs.writeFileSync(evidencePath, originalEvidence, 'utf8');

    const result = generateT2ProofBundle(
      input({ expected_proof_paths: [markdownRel, evidenceRel] }),
      { root, force: true },
    );

    // The sidecar is byte-identical after a forced run.
    assert.strictEqual(fs.readFileSync(evidencePath, 'utf8'), originalEvidence);
    assert.deepStrictEqual(result.refused_paths, [evidenceRel]);
    // The Markdown artifact it was asked for alongside is still written, so the
    // guard refuses the unsafe path rather than aborting the whole bundle.
    assert.deepStrictEqual(result.generated_paths, [markdownRel]);
    assert.match(fs.readFileSync(path.join(root, markdownRel), 'utf8'), /Merge SHA: abc123merge/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a non-Markdown path is refused even without force', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-json-noforce-'));
  try {
    const routingRel = 'docs/06_status/proof/UTV2-1067/model-routing.json';
    const result = generateT2ProofBundle(
      input({ expected_proof_paths: [routingRel] }),
      { root },
    );

    // Not merely skipped-because-present: the file does not exist at all, and
    // the generator still must not create it.
    assert.strictEqual(fs.existsSync(path.join(root, routingRel)), false);
    assert.deepStrictEqual(result.refused_paths, [routingRel]);
    assert.deepStrictEqual(result.skipped_paths, []);
    assert.deepStrictEqual(result.generated_paths, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isMarkdownProofPath accepts markdown and rejects structured sidecars', () => {
  assert.strictEqual(isMarkdownProofPath('docs/06_status/proof/UTV2-1/verification.md'), true);
  assert.strictEqual(isMarkdownProofPath('docs/06_status/proof/UTV2-1/VERIFICATION.MD'), true);
  assert.strictEqual(isMarkdownProofPath('docs/06_status/proof/UTV2-1/evidence.json'), false);
  assert.strictEqual(isMarkdownProofPath('docs/06_status/proof/UTV2-1/model-routing.json'), false);
  assert.strictEqual(isMarkdownProofPath('docs/06_status/proof/UTV2-1/notes'), false);
});

// UTV2-1838 -- the ENOENT half of the coupled pair.
//
// `lane-finalize.ts` builds its `--verification-log` argument unconditionally,
// and `readOptionalFile` is evaluated as a *function argument*, so an absent
// file threw before `generateT2ProofBundle` ever ran. The step is
// `required: true`, so finalize halted on every static-proof lane -- observed
// on UTV2-1835 and UTV2-1836.
test('readOptionalFile returns empty for an absent path instead of throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-t2-proof-optional-'));
  try {
    assert.strictEqual(
      readOptionalFile('docs/06_status/proof/UTV2-1067/runtime-verification.md', root),
      '',
    );
    assert.strictEqual(readOptionalFile(undefined, root), '');

    const presentRel = 'docs/06_status/proof/UTV2-1067/verification.md';
    const presentAbs = path.join(root, presentRel);
    fs.mkdirSync(path.dirname(presentAbs), { recursive: true });
    fs.writeFileSync(presentAbs, 'pnpm verify: PASS\n', 'utf8');
    // Resolves against the injected root, not the module-level ROOT -- the
    // writer twelve lines above already honoured `options.root`.
    assert.strictEqual(readOptionalFile(presentRel, root), 'pnpm verify: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
