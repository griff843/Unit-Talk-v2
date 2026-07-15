import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyProofRepair,
  buildProofRepairScaffold,
  mergeRuntimeProofIntoEvidence,
  type RuntimeProofFile,
} from './proof-repair.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MERGE_SHA = '8ca5acf38a31fc1492961a0951a6af10029bc6c0';

function realRuntimeProof(overrides: Partial<RuntimeProofFile> = {}): RuntimeProofFile {
  return {
    command: 'pnpm test:db',
    supabase_project: 'zfzdnfwdarxucxtaojxm',
    test_file: 'apps/api/src/database-smoke.test.ts',
    tests: 7,
    pass: 7,
    fail: 0,
    queries: [{ table: 'picks', description: 'live query evidence' }],
    row_counts: [{ table: 'picks', count: 100, status: 'healthy' }],
    ...overrides,
  };
}

function boundEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    issue_id: 'UTV2-9999',
    status: 'MERGED',
    continuation: {
      reason: 'hand-authored narrative section that must survive a repair pass untouched',
    },
    sha_binding: {
      merge_sha: MERGE_SHA,
      sha_type: 'merge_sha',
    },
    ...overrides,
  };
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proof-repair-test-'));
}

// ── scaffold: routes through a governed PR, never main directly ───────────────

test('scaffold: produces a claude/ branch and steps that open a PR, never a direct push to main', () => {
  const scaffold = buildProofRepairScaffold('utv2-9999');
  assert.strictEqual(scaffold.issue_id, 'UTV2-9999');
  assert.match(scaffold.branch, /^claude\//);

  const joined = scaffold.steps.join('\n');
  assert.match(joined, /pnpm test:db/);
  assert.match(joined, /ops:proof-repair apply/);
  assert.match(joined, /gh pr create/);
  // AGENTS.md requires executable lanes to start through pnpm ops:lane-start, not a
  // hand-rolled `git worktree add -b` -- so worktree_path is recorded, the
  // file-scope lock is reserved, and the lane cwd is verified (Codex review finding).
  assert.match(joined, /pnpm ops:lane-start/);
  assert.doesNotMatch(joined, /git worktree add .+ -b /);
  // Never a direct write-and-push to main anywhere in the scaffold's own instructions
  // (the scaffold's own explanatory prose is allowed to mention "--admin" as a
  // prohibition -- what must never appear is an actual invocation of it).
  assert.doesNotMatch(joined, /git push(?!\s+-u origin claude\/)/);
  assert.doesNotMatch(joined, /merge\s+--admin\b/);
  assert.doesNotMatch(joined, /push\s+origin\s+main\b/);
});

// ── apply happy path ───────────────────────────────────────────────────────────

test('apply: happy path adds verifier + runtime_proof and preserves hand-authored content', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(boundEvidence(), null, 2));

  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude/utv2-9999-proof-repair',
    manifestCreatedBy: 'claude',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'repaired');

  const written = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.strictEqual(written.verifier.identity, 'claude/utv2-9999-proof-repair');
  assert.deepStrictEqual(written.runtime_proof.queries, realRuntimeProof().queries);
  // Hand-authored narrative section survives byte-identical.
  assert.strictEqual(
    written.continuation.reason,
    'hand-authored narrative section that must survive a repair pass untouched',
  );
  // Merge SHA is untouched -- still the true implementation merge SHA, not rewritten.
  assert.strictEqual(written.sha_binding.merge_sha, MERGE_SHA);
});

// ── missing runtime evidence fails closed with a precise remediation message ──
//
// Note: applyProofRepair() takes an already-validated RuntimeProofFile object -- the
// fail/pass/tests-count consistency and "must not report a failure" validation lives
// in the CLI layer's validateRuntimeProofFile (exercised end-to-end below by actually
// invoking the CLI), so a bad runtime-proof-file can never reach applyProofRepair in
// the first place. This regression test reproduces the CLI's fail-closed behavior for
// exactly the shape this incident's own gate rejects (a failing/inconsistent test run).

test('CLI validation: fails closed with a precise message when the runtime-proof-file reports a failing test', () => {
  const dir = makeTmpDir();
  const runtimeProofFilePath = path.join(dir, 'runtime-proof.json');
  fs.writeFileSync(
    runtimeProofFilePath,
    JSON.stringify(realRuntimeProof({ fail: 1, pass: 6 })),
  );
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(boundEvidence(), null, 2));

  const scriptPath = path.join(__dirname, 'proof-repair.ts');
  let stdout = '';
  let threw = false;
  try {
    execFileSync(
      'npx',
      [
        'tsx',
        scriptPath,
        'apply',
        '--issue',
        'UTV2-9999',
        '--merge-sha',
        MERGE_SHA,
        '--runtime-proof-file',
        runtimeProofFilePath,
        '--verifier-identity',
        'claude/utv2-9999-proof-repair',
        '--evidence-path',
        evidencePath,
      ],
      { encoding: 'utf8' },
    );
  } catch (error) {
    threw = true;
    stdout = (error as { stdout?: string }).stdout ?? '';
  }

  assert.strictEqual(threw, true, 'CLI must exit non-zero on a failing runtime-proof-file');
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.ok, false);
  assert.match(parsed.message, /refusing to record proof of a failing/i);
});

// ── merge SHA guarding: never invent or overwrite ──────────────────────────────

test('apply: refuses when evidence.json has no sha_binding.merge_sha bound yet (never invents one)', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(boundEvidence({ sha_binding: {} }), null, 2));

  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude/utv2-9999-proof-repair',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'merge_sha_not_bound');
  const untouched = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.strictEqual(untouched.runtime_proof, undefined);
});

test('apply: refuses when --merge-sha does not match the already-bound sha_binding.merge_sha', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(boundEvidence(), null, 2));

  const repairCommitSha = 'ffffffffffffffffffffffffffffffffffffffff';
  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: repairCommitSha, // wrong: this is NOT the implementation merge SHA
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude/utv2-9999-proof-repair',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'merge_sha_mismatch');

  const untouched = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  // Merge SHA in the file is still the TRUE implementation merge SHA -- a later
  // repair commit's own SHA was never written anywhere.
  assert.strictEqual(untouched.sha_binding.merge_sha, MERGE_SHA);
  assert.notStrictEqual(untouched.sha_binding.merge_sha, repairCommitSha);
});

test('mergeRuntimeProofIntoEvidence never sets sha_binding.merge_sha itself, even on success', () => {
  const existing = boundEvidence();
  const merged = mergeRuntimeProofIntoEvidence(existing, {
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude/utv2-9999-proof-repair',
  });
  assert.strictEqual(merged.ok, true);
  if (merged.ok) {
    assert.strictEqual((merged.next.sha_binding as Record<string, unknown>).merge_sha, MERGE_SHA);
    // sha_binding object identity/content is otherwise untouched.
    assert.deepStrictEqual(merged.next.sha_binding, existing.sha_binding);
  }
});

// ── verifier identity requirements (mirrors truth-check P10/R3) ───────────────

test('apply: refuses when verifier identity equals manifest.created_by', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(boundEvidence(), null, 2));

  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude',
    manifestCreatedBy: 'claude',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'verifier_identity_matches_creator');
});

// ── idempotency / already-repaired ─────────────────────────────────────────────

test('apply: is idempotent -- refuses to overwrite already-populated runtime_proof/verifier', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');
  fs.writeFileSync(
    evidencePath,
    JSON.stringify(
      boundEvidence({
        verifier: { identity: 'claude/utv2-9999-first-repair' },
        runtime_proof: realRuntimeProof(),
      }),
      null,
      2,
    ),
  );

  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof({ tests: 99, pass: 99 }),
    verifierIdentity: 'claude/utv2-9999-second-repair',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'already_repaired');
  const untouched = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.strictEqual(untouched.verifier.identity, 'claude/utv2-9999-first-repair');
  assert.strictEqual(untouched.runtime_proof.tests, 7);
});

// ── missing evidence file ───────────────────────────────────────────────────────

test('apply: fails closed with a specific message when evidence.json does not exist', () => {
  const dir = makeTmpDir();
  const evidencePath = path.join(dir, 'evidence.json');

  const result = applyProofRepair({
    issueId: 'UTV2-9999',
    mergeSha: MERGE_SHA,
    runtimeProof: realRuntimeProof(),
    verifierIdentity: 'claude/utv2-9999-proof-repair',
    evidenceAbsolutePath: evidencePath,
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'evidence_missing');
  assert.match(result.message, /No evidence bundle found/);
});

// ── design invariant: this module never shells out to git, never touches main ──

test('design invariant: proof-repair.ts source never shells out (no git push / admin-merge invocation is even possible)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'proof-repair.ts'), 'utf8');
  // The strongest possible version of this invariant: the module never imports
  // node:child_process at all, so it is structurally incapable of running `git push`,
  // `gh pr merge --admin`, or any other shell command -- not merely "doesn't currently
  // call one."
  assert.doesNotMatch(source, /node:child_process/);
  assert.doesNotMatch(source, /merge\s+--admin\b/);
});
