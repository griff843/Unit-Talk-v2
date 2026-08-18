import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateProofSchema,
  isProofStale,
  PROOF_SCHEMA_VERSION,
  validateEvidenceBundleContract,
  type ProofSchemaV2,
} from './proof-schema.js';
import { validateBindingEvidenceContract } from '../ci/proof-binding-validator.js';

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function makeValid(): ProofSchemaV2 {
  return {
    schema_version: PROOF_SCHEMA_VERSION,
    issue_id: 'UTV2-1156',
    pr_number: 900,
    source_sha: VALID_SHA,
    reviewed_head_sha: VALID_SHA,
    evidence_commit_sha: null,
    current_head_sha: null,
    merge_sha: null,
    gate_results: [{ gate: 'ci', verdict: 'PASS', detail: 'All checks green' }],
    reviewer_verdict: null,
    pm_verdict: null,
    generated_at: new Date().toISOString(),
  };
}

describe('validateProofSchema', () => {
  it('accepts a valid minimal proof', () => {
    const result = validateProofSchema(makeValid());
    assert.ok(result.valid, `Unexpected failures: ${JSON.stringify(result.failures)}`);
    assert.deepEqual(result.failures, []);
  });

  it('rejects null', () => {
    const result = validateProofSchema(null);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'root'));
  });

  it('rejects wrong schema_version', () => {
    const candidate = { ...makeValid(), schema_version: 1 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'schema_version'));
  });

  it('rejects missing issue_id', () => {
    const candidate = { ...makeValid(), issue_id: '' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'issue_id'));
  });

  it('rejects non-integer pr_number', () => {
    const candidate = { ...makeValid(), pr_number: 0 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'pr_number'));
  });

  it('rejects malformed source_sha', () => {
    const candidate = { ...makeValid(), source_sha: 'not-a-sha' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'source_sha'));
  });

  it('rejects malformed reviewed_head_sha', () => {
    const candidate = { ...makeValid(), reviewed_head_sha: 'short' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'reviewed_head_sha'));
  });

  it('accepts null evidence_commit_sha (pre-merge)', () => {
    const candidate = { ...makeValid(), evidence_commit_sha: null };
    const result = validateProofSchema(candidate);
    assert.ok(result.valid, JSON.stringify(result.failures));
  });

  it('rejects malformed evidence_commit_sha when non-null', () => {
    const candidate = { ...makeValid(), evidence_commit_sha: 'bad' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'evidence_commit_sha'));
  });

  it('accepts null merge_sha (pre-merge)', () => {
    const candidate = { ...makeValid(), merge_sha: null };
    const result = validateProofSchema(candidate);
    assert.ok(result.valid, JSON.stringify(result.failures));
  });

  it('rejects invalid gate_results entry', () => {
    const candidate = {
      ...makeValid(),
      gate_results: [{ gate: 'ci', verdict: 'UNKNOWN', detail: 'x' }],
    };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field.startsWith('gate_results[0]')));
  });

  it('rejects gate_results not an array', () => {
    const candidate = { ...makeValid(), gate_results: 'bad' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'gate_results'));
  });

  it('rejects missing generated_at', () => {
    const candidate = { ...makeValid(), generated_at: '' };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.some(f => f.field === 'generated_at'));
  });

  it('accumulates multiple failures', () => {
    const candidate = { schema_version: 1, issue_id: '', pr_number: -1 };
    const result = validateProofSchema(candidate);
    assert.ok(!result.valid);
    assert.ok(result.failures.length >= 3);
  });
});

function migrationEvidence() {
  return {
    schema_version: 2,
    issue_id: 'UTV2-9000',
    sha_binding: {
      verified_source_sha: VALID_SHA,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: {
      head: VALID_SHA,
      precondition_drill: {
        result: 'PASS',
        run: 100,
        job: 101,
        cases: ['refuses when a declared relation exists', 'applies on an empty scratch schema'],
      },
      schema_roundtrip_drill: { result: 'PASS', run: 100, job: 102 },
      live_schema_parity: { result: 'PASS', run: 100, job: 103 },
      writable_db_proof_staging: { result: 'PASS', run: 100, job: 104 },
    },
  };
}

test('version-aware evidence contract accepts schema-v1 only for post-merge historical reads', () => {
  const result = validateEvidenceBundleContract(
    { schema_version: 1 },
    { gate: 'post-merge-read' },
  );
  assert.equal(result.valid, true);
  assert.equal(result.profile, 'legacy-v1');
});

test('schema-v2 migration profile accepts executed receipts without queries or row_counts', () => {
  const result = validateEvidenceBundleContract(
    migrationEvidence(),
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(result.valid, true, JSON.stringify(result.failures));
  assert.equal(result.profile, 'migration');
});

test('schema-v2 evidence fails without valid sha_binding', () => {
  const evidence = migrationEvidence();
  Reflect.deleteProperty(evidence, 'sha_binding');
  const result = validateEvidenceBundleContract(
    evidence,
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.code === 'sha_binding_missing'));
});

test('app-runtime profile fails closed without queries and row_counts', () => {
  const evidence = {
    ...migrationEvidence(),
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: { queries: [], row_counts: [] },
  };
  const result = validateEvidenceBundleContract(
    evidence,
    { gate: 'pre-merge', laneType: 'runtime', tier: 'T1' },
  );
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.code === 'runtime_queries_missing'));
  assert.ok(result.failures.some((failure) => failure.code === 'runtime_row_counts_missing'));
});

test('schema-v2 proof profiles reject unknown, undeclared, mismatched, and author-verifier input', () => {
  const undeclared = validateEvidenceBundleContract(
    { ...migrationEvidence(), proof_profile: undefined },
    { gate: 'pre-merge' },
  );
  assert.ok(undeclared.failures.some((failure) => failure.code === 'proof_profile_missing'));

  const unknown = validateEvidenceBundleContract(
    { ...migrationEvidence(), proof_profile: 'weakest' },
    { gate: 'pre-merge' },
  );
  assert.ok(unknown.failures.some((failure) => failure.code === 'proof_profile_unknown'));

  const mismatch = validateEvidenceBundleContract(
    { ...migrationEvidence(), proof_profile: 'static' },
    { gate: 'pre-merge', laneType: 'runtime', tier: 'T1' },
  );
  assert.ok(mismatch.failures.some((failure) => failure.code === 'proof_profile_mismatch'));

  const selfCertified = validateEvidenceBundleContract(
    { ...migrationEvidence(), verifier: { identity: 'implementer' } },
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.ok(selfCertified.failures.some((failure) => failure.code === 'author_verifier_forbidden'));
});

function bindingMigrationBundle() {
  return {
    schema_version: 2,
    issue_id: 'UTV2-1718',
    sha_binding: {
      verified_source_sha: VALID_SHA,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: {
      head: VALID_SHA,
      precondition_drill: {
        result: 'PASS',
        run: 31999981947,
        job: 95298344670,
        cases: [
          'refuses when a declared relation already exists',
          'applies on an empty scratch schema',
        ],
      },
      schema_roundtrip_drill: { result: 'PASS', run: 31999981947, job: 95298344658 },
      live_schema_parity: { result: 'PASS', run: 31999981924, job: 95298356338 },
      writable_db_proof_staging: { result: 'PASS', run: 31999981913, job: 95298344972 },
    },
  };
}

describe('proof-binding-validator', () => {
  test('binding gate consumes the shared schema-v2 migration contract', () => {
    const result = validateBindingEvidenceContract(bindingMigrationBundle(), 'migration');
    assert.equal(result.valid, true, JSON.stringify(result.failures));
    assert.equal(result.profile, 'migration');
  });

  test('binding gate fails schema v2 when sha_binding is absent', () => {
    const bundle = bindingMigrationBundle();
    Reflect.deleteProperty(bundle, 'sha_binding');
    const result = validateBindingEvidenceContract(bundle, 'migration');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.code === 'sha_binding_missing'));
  });

  test('binding gate rejects schema-v1 evidence before merge', () => {
    const result = validateBindingEvidenceContract({ schema_version: 1 }, null);
    assert.equal(result.valid, false);
    assert.equal(result.profile, 'legacy-v1');
    assert.ok(result.failures.some((failure) => failure.code === 'legacy_v1_not_allowed_pre_merge'));
  });
});

function createReceiptBindingRepo(): {
  repoRoot: string;
  receiptHead: string;
  proofOnlyHead: string;
  proofOnlyMergeSha: string;
  nonProofHead: string;
  squashMergeSha: string;
  nonProofSquashSha: string;
  unrelatedHead: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-binding-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };

  git('init', '-b', 'main');
  git('config', 'user.email', 'proof-schema@example.test');
  git('config', 'user.name', 'Proof Schema Test');
  write('source.txt', 'receipt source\n');
  git('add', '.');
  git('commit', '-m', 'receipt source');
  const receiptHead = git('rev-parse', 'HEAD');

  write('docs/06_status/proof/UTV2-9000/evidence.json', '{"proof":true}\n');
  write('docs/06_status/lanes/UTV2-9000.json', '{}\n');
  write('.ops/sync/UTV2-9000.yml', 'version: 1\n');
  git('add', '.');
  git('commit', '-m', 'proof-only rebind');
  const proofOnlyHead = git('rev-parse', 'HEAD');
  const proofOnlyMergeSha = git(
    'commit-tree',
    git('rev-parse', `${proofOnlyHead}^{tree}`),
    '-p',
    receiptHead,
    '-p',
    proofOnlyHead,
    '-m',
    'two-parent proof-only merge',
  );

  write('scripts/substantive.ts', 'export const changed = true;\n');
  git('add', '.');
  git('commit', '-m', 'non-proof delta');
  const nonProofHead = git('rev-parse', 'HEAD');

  const squashMergeSha = git(
    'commit-tree',
    git('rev-parse', `${proofOnlyHead}^{tree}`),
    '-p',
    receiptHead,
    '-m',
    'squash merge',
  );
  const nonProofSquashSha = git(
    'commit-tree',
    git('rev-parse', `${nonProofHead}^{tree}`),
    '-p',
    receiptHead,
    '-m',
    'squash merge with non-proof delta',
  );

  git('switch', '--orphan', 'unrelated');
  write('unrelated.txt', 'unrelated history\n');
  git('add', '.');
  git('commit', '-m', 'unrelated root');
  const unrelatedHead = git('rev-parse', 'HEAD');
  git('switch', 'main');

  return {
    repoRoot,
    receiptHead,
    proofOnlyHead,
    proofOnlyMergeSha,
    nonProofHead,
    squashMergeSha,
    nonProofSquashSha,
    unrelatedHead,
  };
}

function migrationEvidenceAt(receiptHead: string, verifiedSourceSha: string) {
  const evidence = migrationEvidence();
  evidence.sha_binding.verified_source_sha = verifiedSourceSha;
  evidence.runtime_proof.head = receiptHead;
  return evidence;
}

function mergedPrAttestation(mergeSha: string, headSha: string) {
  return {
    merge_sha: mergeSha,
    head_sha: headSha,
    pr_number: 1428,
    source: 'github-api' as const,
  };
}

function createMainImportReceiptBindingRepo(): {
  repoRoot: string;
  receiptHead: string;
  importedHead: string;
  importedSquashSha: string;
  laneChangedHead: string;
  laneChangedSquashSha: string;
  laneNewHead: string;
  laneNewSquashSha: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-main-import-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };
  const squash = (target: string, parent: string, message: string): string => git(
    'commit-tree',
    git('rev-parse', `${target}^{tree}`),
    '-p',
    parent,
    '-m',
    message,
  );

  git('init', '-b', 'main');
  git('config', 'user.email', 'proof-schema@example.test');
  git('config', 'user.name', 'Proof Schema Test');
  write('source.txt', 'receipt source\n');
  git('add', '.');
  git('commit', '-m', 'receipt source');
  const receiptHead = git('rev-parse', 'HEAD');
  git('branch', 'lane', receiptHead);

  write('docs/06_status/readiness/readiness-score.json', '{"from":"main"}\n');
  git('add', '.');
  git('commit', '-m', 'main readiness update');
  const mainImportHead = git('rev-parse', 'HEAD');

  git('switch', 'lane');
  git('merge', '--no-edit', 'main');
  write('docs/06_status/proof/UTV2-9000/evidence.json', '{"proof":true}\n');
  git('add', '.');
  git('commit', '-m', 'proof-only rebind after main sync');
  const importedHead = git('rev-parse', 'HEAD');
  const importedSquashSha = squash(importedHead, mainImportHead, 'squash main-import lane');

  git('switch', '-c', 'lane-changed', importedHead);
  write('source.txt', 'lane-authored change after receipts\n');
  git('add', '.');
  git('commit', '-m', 'lane-authored non-proof change');
  const laneChangedHead = git('rev-parse', 'HEAD');
  const laneChangedSquashSha = squash(laneChangedHead, mainImportHead, 'squash changed lane');

  git('switch', '-c', 'lane-new', importedHead);
  write('scripts/lane-authored-new.ts', 'export const laneAuthored = true;\n');
  git('add', '.');
  git('commit', '-m', 'lane-authored new non-proof file');
  const laneNewHead = git('rev-parse', 'HEAD');
  const laneNewSquashSha = squash(laneNewHead, mainImportHead, 'squash lane with new file');

  return {
    repoRoot,
    receiptHead,
    importedHead,
    importedSquashSha,
    laneChangedHead,
    laneChangedSquashSha,
    laneNewHead,
    laneNewSquashSha,
  };
}

function createRebaseReceiptBindingRepo(): {
  repoRoot: string;
  receiptHead: string;
  originalHead: string;
  replayedTip: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-rebase-binding-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };

  git('init', '-b', 'main');
  git('config', 'user.email', 'proof-schema@example.test');
  git('config', 'user.name', 'Proof Schema Test');
  write('base.txt', 'fork point\n');
  git('add', '.');
  git('commit', '-m', 'main fork point');
  git('switch', '-c', 'lane');

  write('docs/06_status/proof/UTV2-9000/evidence.json', '{"receipt":true}\n');
  git('add', '.');
  git('commit', '-m', 'receipt commit');
  const receiptHead = git('rev-parse', 'HEAD');

  write('scripts/lane-authored-new.ts', 'export const laneAuthored = true;\n');
  git('add', '.');
  git('commit', '-m', 'lane-authored non-proof file');
  const laneChange = git('rev-parse', 'HEAD');

  write('docs/06_status/proof/UTV2-9000/verification.md', 'trailing proof commit\n');
  git('add', '.');
  git('commit', '-m', 'trailing proof commit');
  const originalHead = git('rev-parse', 'HEAD');

  git('switch', 'main');
  write('main-advance.txt', 'main advanced before replay\n');
  git('add', '.');
  git('commit', '-m', 'advance main before rebase merge');
  git('cherry-pick', receiptHead, laneChange, originalHead);
  const replayedTip = git('rev-parse', 'HEAD');

  return { repoRoot, receiptHead, originalHead, replayedTip };
}

function createMergeCommitReceiptBindingRepo(options: { laneAuthoredDelta: boolean }): {
  repoRoot: string;
  receiptHead: string;
  originalHead: string;
  mergeSha: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-merge-binding-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };

  git('init', '-b', 'main');
  git('config', 'user.email', 'proof-schema@example.test');
  git('config', 'user.name', 'Proof Schema Test');
  write('base.txt', 'fork point\n');
  git('add', '.');
  git('commit', '-m', 'main fork point');
  git('switch', '-c', 'lane');

  write('docs/06_status/proof/UTV2-9000/evidence.json', '{"receipt":true}\n');
  git('add', '.');
  git('commit', '-m', 'receipt commit');
  const receiptHead = git('rev-parse', 'HEAD');

  if (options.laneAuthoredDelta) {
    write('scripts/lane-authored-new.ts', 'export const laneAuthored = true;\n');
  } else {
    write('docs/06_status/proof/UTV2-9000/verification.md', 'proof-only rebind\n');
    write('.ops/sync/UTV2-9000.yml', 'version: 1\n');
  }
  git('add', '.');
  git('commit', '-m', options.laneAuthoredDelta ? 'lane-authored non-proof file' : 'proof-only rebind');
  const originalHead = git('rev-parse', 'HEAD');

  git('switch', 'main');
  write('main-advance.txt', 'main advanced independently\n');
  git('add', '.');
  git('commit', '-m', 'advance main before merge');
  git('merge', '--no-ff', '--no-edit', 'lane');
  const mergeSha = git('rev-parse', 'HEAD');

  return { repoRoot, receiptHead, originalHead, mergeSha };
}

function createFastForwardLikeReceiptBindingRepo(): {
  repoRoot: string;
  receiptHead: string;
  originalHead: string;
  mergeSha: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-single-parent-binding-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };

  git('init', '-b', 'main');
  git('config', 'user.email', 'proof-schema@example.test');
  git('config', 'user.name', 'Proof Schema Test');
  write('docs/06_status/proof/UTV2-9000/evidence.json', '{"receipt":true}\n');
  git('add', '.');
  git('commit', '-m', 'receipt commit');
  const receiptHead = git('rev-parse', 'HEAD');

  write('docs/06_status/proof/UTV2-9000/verification.md', 'original PR head\n');
  git('add', '.');
  git('commit', '-m', 'original PR head');
  const originalHead = git('rev-parse', 'HEAD');

  write('docs/06_status/proof/UTV2-9000/runtime-verification.md', 'single-parent successor\n');
  git('add', '.');
  git('commit', '-m', 'single-parent merge-like successor');
  const mergeSha = git('rev-parse', 'HEAD');

  return { repoRoot, receiptHead, originalHead, mergeSha };
}

test('migration receipt binding is exact pre-merge and fail-closed on mismatch', () => {
  const exact = validateEvidenceBundleContract(
    migrationEvidence(),
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(exact.valid, true, JSON.stringify(exact.failures));

  const mismatchEvidence = migrationEvidence();
  mismatchEvidence.runtime_proof.head = OTHER_SHA;
  const mismatch = validateEvidenceBundleContract(
    mismatchEvidence,
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.failures.some((failure) => failure.code === 'migration_receipt_head_mismatch'));
});

test('post-merge migration receipt binding accepts only proof-only Git ancestry', () => {
  const repo = createReceiptBindingRepo();
  try {
    const proofOnly = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.proofOnlyMergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.proofOnlyMergeSha, repo.proofOnlyHead),
      },
    );
    assert.equal(proofOnly.valid, true, JSON.stringify(proofOnly.failures));

    const stale = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.nonProofSquashSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.nonProofSquashSha, repo.nonProofHead),
      },
    );
    assert.equal(stale.valid, false);
    assert.ok(stale.failures.some((failure) => failure.code === 'migration_receipt_non_proof_delta'));

    const unrelated = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.unrelatedHead, repo.proofOnlyMergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.proofOnlyMergeSha, repo.proofOnlyHead),
      },
    );
    assert.equal(unrelated.valid, false);
    assert.ok(unrelated.failures.some((failure) => failure.code === 'migration_receipt_not_ancestor'));

    const noGitContext = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.proofOnlyHead),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        mergedPrAttestation: mergedPrAttestation(repo.proofOnlyHead, repo.proofOnlyHead),
      },
    );
    assert.equal(noGitContext.valid, false);
    assert.ok(noGitContext.failures.some((failure) => failure.code === 'migration_receipt_ancestry_unverified'));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge migration receipt binding is squash-aware and attestation-bound', () => {
  const repo = createReceiptBindingRepo();
  try {
    const squashShaped = migrationEvidenceAt(repo.receiptHead, repo.squashMergeSha);
    const attestation = mergedPrAttestation(repo.squashMergeSha, repo.receiptHead);
    const accepted = validateEvidenceBundleContract(
      squashShaped,
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: attestation,
      },
    );
    assert.equal(accepted.valid, true, JSON.stringify(accepted.failures));

    const missingAttestation = validateEvidenceBundleContract(
      squashShaped,
      { gate: 'post-merge-read', laneType: 'migration', tier: 'T1', repoRoot: repo.repoRoot },
    );
    assert.equal(missingAttestation.valid, false);
    assert.ok(missingAttestation.failures.some(
      (failure) => failure.code === 'migration_receipt_ancestry_unverified',
    ));

    const unrelatedReceipt = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.unrelatedHead, repo.squashMergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.squashMergeSha, repo.proofOnlyHead),
      },
    );
    assert.equal(unrelatedReceipt.valid, false);
    assert.ok(unrelatedReceipt.failures.some(
      (failure) => failure.code === 'migration_receipt_not_ancestor',
    ));

    const wrongMergeAttestation = validateEvidenceBundleContract(
      squashShaped,
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.proofOnlyHead, repo.receiptHead),
      },
    );
    assert.equal(wrongMergeAttestation.valid, false);
    assert.ok(wrongMergeAttestation.failures.some(
      (failure) => failure.code === 'migration_receipt_merge_attestation_mismatch',
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge squash binding accepts a net-diff main import with matching pre-merge blob', () => {
  const repo = createMainImportReceiptBindingRepo();
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.importedSquashSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.importedSquashSha, repo.importedHead),
      },
    );
    assert.equal(result.valid, true, JSON.stringify(result.failures));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge squash binding rejects lane-authored non-proof blob drift after receipts', () => {
  const repo = createMainImportReceiptBindingRepo();
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.laneChangedSquashSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.laneChangedSquashSha, repo.laneChangedHead),
      },
    );
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(
      (failure) => failure.code === 'migration_receipt_non_proof_delta' &&
        failure.message.includes('source.txt'),
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge squash binding rejects a lane-authored new non-proof file after receipts', () => {
  const repo = createMainImportReceiptBindingRepo();
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.laneNewSquashSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.laneNewSquashSha, repo.laneNewHead),
      },
    );
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(
      (failure) => failure.code === 'migration_receipt_non_proof_delta' &&
        failure.message.includes('scripts/lane-authored-new.ts'),
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge rebase binding rejects a lane-authored non-proof file in the replayed chain', () => {
  const repo = createRebaseReceiptBindingRepo();
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.replayedTip),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.replayedTip, repo.originalHead),
      },
    );
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(
      (failure) => failure.code === 'migration_receipt_non_proof_delta' &&
        failure.message.includes('scripts/lane-authored-new.ts'),
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge two-parent binding rejects lane-authored non-proof drift after receipts', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: true });
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.mergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
      },
    );
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(
      (failure) => failure.code === 'migration_receipt_non_proof_delta' &&
        failure.message.includes('scripts/lane-authored-new.ts'),
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge two-parent binding accepts proof-only rebind plus independent main advance', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.mergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
      },
    );
    assert.equal(result.valid, true, JSON.stringify(result.failures));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('post-merge binding rejects a single-parent merge SHA that contains the PR head', () => {
  const repo = createFastForwardLikeReceiptBindingRepo();
  try {
    const result = validateEvidenceBundleContract(
      migrationEvidenceAt(repo.receiptHead, repo.mergeSha),
      {
        gate: 'post-merge-read',
        laneType: 'migration',
        tier: 'T1',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
      },
    );
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(
      (failure) => failure.code === 'migration_receipt_ancestry_unverified',
    ));
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

for (const laneType of ['modeling', 'data-canonical'] as const) {
  test(`${laneType} T1 evidence requires app-runtime queries and row counts`, () => {
    const evidence = {
      ...migrationEvidence(),
      proof_profile: 'app-runtime',
      runtime_proof: { queries: [], row_counts: [] },
    };
    const result = validateEvidenceBundleContract(
      evidence,
      { gate: 'pre-merge', laneType, tier: 'T1' },
    );
    assert.equal(result.profile, 'app-runtime');
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.code === 'runtime_queries_missing'));
    assert.ok(result.failures.some((failure) => failure.code === 'runtime_row_counts_missing'));
  });
}

test('governance evidence remains on the static proof profile', () => {
  const evidence = {
    schema_version: 2,
    issue_id: 'UTV2-9000',
    proof_profile: 'static',
    sha_binding: {
      verified_source_sha: VALID_SHA,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
  };
  const result = validateEvidenceBundleContract(
    evidence,
    { gate: 'pre-merge', laneType: 'governance', tier: 'T1' },
  );
  assert.equal(result.profile, 'static');
  assert.equal(result.valid, true, JSON.stringify(result.failures));
});

describe('isProofStale', () => {
  it('returns false when source_sha matches current head', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, VALID_SHA), false);
  });

  it('returns true when source_sha differs from current head', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, OTHER_SHA), true);
  });

  it('returns false when currentHeadSha is malformed', () => {
    const proof = { ...makeValid(), source_sha: VALID_SHA };
    assert.equal(isProofStale(proof, 'bad-sha'), false);
  });

  it('returns true when source_sha is malformed', () => {
    const proof = { ...makeValid(), source_sha: 'bad' };
    assert.equal(isProofStale(proof, VALID_SHA), true);
  });
});
