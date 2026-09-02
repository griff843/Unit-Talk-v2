import { after, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateProofSchema,
  isProofStale,
  PROOF_SCHEMA_VERSION,
  readEvidenceMergeSlot,
  validateEvidenceBundleContract,
  verifyExternalVerifierProvenanceBinding,
  validateProofMergeShaIdentity,
  type ProofSchemaV2,
} from './proof-schema.js';
import {
  validateBindingEvidenceContract,
  validatePreMergeVerificationBinding,
} from '../ci/proof-binding-validator.js';

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
      merge_sha: null,
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

test('schema-v2 evidence requires a nullable merge slot before merge and forbids branch SHAs in it', () => {
  const missing = migrationEvidence();
  (missing as { proof_profile: string }).proof_profile = 'static';
  Reflect.deleteProperty(missing.sha_binding, 'merge_sha');
  const missingResult = validateEvidenceBundleContract(missing, { gate: 'pre-merge', laneType: 'governance' });
  assert.ok(missingResult.failures.some((failure) => failure.code === 'sha_binding_merge_slot_missing'));

  const premature = migrationEvidence();
  (premature as { proof_profile: string }).proof_profile = 'static';
  premature.sha_binding.merge_sha = OTHER_SHA;
  const prematureResult = validateEvidenceBundleContract(premature, { gate: 'pre-merge', laneType: 'governance' });
  assert.ok(prematureResult.failures.some((failure) => failure.code === 'sha_binding_premature_merge_sha'));
});

test('schema-v2 evidence has one merge authority and requires a concrete post-merge binding', () => {
  const legacy = migrationEvidence() as ReturnType<typeof migrationEvidence> & { merge_sha?: string };
  legacy.merge_sha = VALID_SHA;
  const legacyResult = validateEvidenceBundleContract(legacy, { gate: 'pre-merge', laneType: 'migration' });
  assert.ok(legacyResult.failures.some((failure) => failure.code === 'legacy_merge_sha_forbidden'));

  const rebound = migrationEvidence();
  rebound.sha_binding.merge_sha = OTHER_SHA;
  const reboundResult = validateEvidenceBundleContract(rebound, { gate: 'post-merge-read', laneType: 'migration' });
  assert.ok(!reboundResult.failures.some((failure) => failure.field === 'sha_binding.merge_sha'));

  const missingStatic = migrationEvidence();
  (missingStatic as { proof_profile: string }).proof_profile = 'static';
  Reflect.deleteProperty(missingStatic.sha_binding, 'merge_sha');
  const missingStaticResult = validateEvidenceBundleContract(
    missingStatic,
    { gate: 'post-merge-read', laneType: 'governance' },
  );
  assert.ok(
    missingStaticResult.failures.some((failure) => failure.code === 'sha_binding_merge_slot_missing'),
    'post-merge non-migration evidence cannot omit its authoritative merge slot',
  );
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
      merge_sha: null,
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

  // UTV2-1783: these exercise the markdown half of the identity contract, which
  // is now a fact about the pair (verification.md, evidence.json) rather than
  // the markdown alone — the phase and the ancestry anchor both live in
  // sha_binding. Passing evidence is what a real caller does; the validator
  // reads the bundle it is validating.
  const preMergeBinding = (): Record<string, unknown> => ({
    // schema_version is what selects the v2 identity rules; a bundle that does
    // not declare it stays on the legacy path no matter what fields it carries.
    schema_version: PROOF_SCHEMA_VERSION,
    sha_binding: { merge_sha: null, verified_source_sha: VALID_SHA },
  });

  test('bindability gate rejects the real #1434/#1435 Markdown shape before merge', () => {
    for (const branchSha of [
      'a6bc5c99cc58166321f35d1e0e2aa751450056a8',
      'fb4aa9d90152e0a2dadc6bf0a2013eaf630fbe8a',
    ]) {
      const violations = validatePreMergeVerificationBinding(
        `# PROOF: lane\n\nMERGE_SHA: ${branchSha}\n\n## Verification\n\nmeasured\n`,
        preMergeBinding(),
      );
      assert.ok(
        violations.some((violation) => /Execution identity lives in sha_binding\.verified_source_sha/.test(violation)),
        JSON.stringify(violations),
      );
      assert.ok(violations.some((violation) => /Merge SHA Binding/.test(violation)));
    }
  });

  test('bindability gate accepts the canonical generated Markdown contract', () => {
    const content = [
      '# PROOF: UTV2-1729',
      '',
      'MERGE_SHA: pending merge',
      '',
      '## Verification',
      '',
      'measured',
      '',
      '## Merge SHA Binding',
      '',
      'Merge SHA: pending merge',
      'PR: pending',
      'Approved PR head: pending merge',
      `Execution SHA: ${VALID_SHA}`,
      '',
    ].join('\n');
    assert.deepEqual(validatePreMergeVerificationBinding(content, preMergeBinding()), []);
  });

  test('bindability gate ignores MERGE_SHA-looking rows inside fenced command evidence', () => {
    const content = [
      '# PROOF: UTV2-1729',
      '',
      'MERGE_SHA: pending merge',
      '',
      '## Verification',
      '',
      '```text',
      `MERGE_SHA: ${OTHER_SHA}`,
      '## Merge SHA Binding',
      '```',
      '',
      '## Merge SHA Binding',
      '',
      'Merge SHA: pending merge',
      'PR: pending',
      '',
    ].join('\n');
    assert.deepEqual(validatePreMergeVerificationBinding(content, preMergeBinding()), []);
  });

  test('a bundle with no sha_binding keeps the narrow legacy rule instead of silently relaxing', () => {
    const legacy = (row: string): string[] =>
      validatePreMergeVerificationBinding(`# PROOF: lane\n\nMERGE_SHA: ${row}\n\n## Verification\n\nmeasured\n`);
    // No schema-v2 binding exists, so the row is still the only identity the
    // bundle carries and the pre-UTV2-1783 rule applies to it unchanged.
    assert.deepEqual(legacy(VALID_SHA), []);
    assert.ok(legacy('pending merge').some((v) => /not a valid git SHA/.test(v)));
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
  evidence.sha_binding.merge_sha = verifiedSourceSha;
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
    const attestation = mergedPrAttestation(repo.squashMergeSha, repo.proofOnlyHead);
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

test('external verifier bridge accepts authentic squash, rebase, and two-parent merged-PR attestations', () => {
  const squash = createReceiptBindingRepo();
  const rebase = createRebaseReceiptBindingRepo();
  const merge = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  try {
    const cases = [
      {
        receiptSha: squash.proofOnlyHead,
        verifiedSourceSha: squash.squashMergeSha,
        repoRoot: squash.repoRoot,
      },
      {
        receiptSha: rebase.originalHead,
        verifiedSourceSha: rebase.replayedTip,
        repoRoot: rebase.repoRoot,
      },
      {
        receiptSha: merge.originalHead,
        verifiedSourceSha: merge.mergeSha,
        repoRoot: merge.repoRoot,
      },
    ];

    for (const fixture of cases) {
      const result = verifyExternalVerifierProvenanceBinding({
        receiptSha: fixture.receiptSha,
        verifiedSourceSha: fixture.verifiedSourceSha,
        context: {
          gate: 'post-merge-read',
          repoRoot: fixture.repoRoot,
          mergedPrAttestation: mergedPrAttestation(fixture.verifiedSourceSha, fixture.receiptSha),
        },
      });
      assert.equal(result.valid, true, JSON.stringify(result));
      assert.equal(result.code, 'verifier_provenance_bound_merged_pr_head');
    }
  } finally {
    fs.rmSync(squash.repoRoot, { recursive: true, force: true });
    fs.rmSync(rebase.repoRoot, { recursive: true, force: true });
    fs.rmSync(merge.repoRoot, { recursive: true, force: true });
  }
});

test('external verifier bridge rejects stale, malformed, mismatched, and unverifiable receipts by named code', () => {
  const repo = createReceiptBindingRepo();
  try {
    const context = {
      gate: 'post-merge-read' as const,
      repoRoot: repo.repoRoot,
      mergedPrAttestation: mergedPrAttestation(repo.squashMergeSha, repo.proofOnlyHead),
    };
    assert.equal(
      verifyExternalVerifierProvenanceBinding({
        receiptSha: repo.receiptHead,
        verifiedSourceSha: repo.squashMergeSha,
        context,
      }).code,
      'verifier_receipt_head_mismatch',
    );
    assert.equal(
      verifyExternalVerifierProvenanceBinding({
        receiptSha: 'not-a-sha',
        verifiedSourceSha: repo.squashMergeSha,
        context,
      }).code,
      'verifier_receipt_sha_invalid',
    );
    assert.equal(
      verifyExternalVerifierProvenanceBinding({
        receiptSha: repo.proofOnlyHead,
        verifiedSourceSha: repo.proofOnlyMergeSha,
        context,
      }).code,
      'verifier_merge_attestation_mismatch',
    );

    const unavailable = 'f'.repeat(40);
    const unverifiable = verifyExternalVerifierProvenanceBinding({
      receiptSha: unavailable,
      verifiedSourceSha: repo.squashMergeSha,
      context: {
        gate: 'post-merge-read',
        repoRoot: repo.repoRoot,
        mergedPrAttestation: mergedPrAttestation(repo.squashMergeSha, unavailable),
      },
    });
    assert.equal(unverifiable.code, 'verifier_merge_attestation_unverified');
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test('external verifier bridge fetches the immutable PR-head ref when the attested commit is absent locally', () => {
  const headSha = 'c'.repeat(40);
  const mergeSha = 'd'.repeat(40);
  const mainRef = 'e'.repeat(40);
  let headChecks = 0;
  const calls: string[][] = [];
  const result = verifyExternalVerifierProvenanceBinding({
    receiptSha: headSha,
    verifiedSourceSha: mergeSha,
    context: {
      gate: 'post-merge-read',
      repoRoot: '/tmp/utv2-proof-schema-fetch-seam',
      mergedPrAttestation: mergedPrAttestation(mergeSha, headSha),
      gitRunner: (args) => {
        calls.push([...args]);
        if (args[0] === 'cat-file' && args[2] === `${headSha}^{commit}`) {
          headChecks += 1;
          return { status: headChecks === 1 ? 1 : 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
        if (args[0] === 'cat-file' && args[2] === `${mergeSha}^{commit}`) {
          return { status: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
          return { status: 1, stdout: '', stderr: '' };
        }
        if (args[0] === 'merge-base') return { status: 0, stdout: `${mainRef}\n`, stderr: '' };
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      },
    },
  });

  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.code, 'verifier_provenance_bound_merged_pr_head');
  assert.deepEqual(
    calls.find((args) => args[0] === 'fetch'),
    ['fetch', '--no-tags', 'origin', 'refs/pull/1428/head'],
  );
  assert.equal(headChecks, 2);
});

test('external verifier provenance remains exact-head before merge', () => {
  const result = verifyExternalVerifierProvenanceBinding({
    receiptSha: VALID_SHA,
    verifiedSourceSha: OTHER_SHA,
    context: { gate: 'pre-merge' },
  });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'verifier_receipt_head_mismatch');
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
      merge_sha: null,
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

// --- UTV2-1729: historical `sha_binding.merge_sha` compatibility -------------
//
// The slot is mandatory. A bundle that genuinely predates it may still be read
// after merge, but only when an authentic merged-PR attestation proves its
// identity. These regressions pin every edge of that exemption: it is granted
// on proof of identity, never on profile, never before merge, and never to a
// branch SHA. The mechanism tests below run against a real Git repository with
// a real merge commit, so `resolveMergedPrAttestation` is exercised, not stubbed.

/** A governance/static bundle of the pre-slot vintage: no `sha_binding.merge_sha`. */
function preSlotStaticBundle(verifiedSourceSha: string) {
  return {
    schema_version: 2,
    issue_id: 'UTV2-9000',
    proof_profile: 'static',
    sha_binding: {
      verified_source_sha: verifiedSourceSha,
      evidence_commit_sha: 'abc1234',
      current_pr_head_sha: 'def5678',
    },
    static_proof: { type_check: { status: 'PASS' }, tests: { status: 'PASS' } },
  };
}

const SLOT_MISSING = 'sha_binding_merge_slot_missing';
const hasSlotMissing = (result: { failures: Array<{ code: string }> }): boolean =>
  result.failures.some((failure) => failure.code === SLOT_MISSING);

test('pre-slot static bundle is readable post-merge when an authentic merged-PR attestation proves identity', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  const result = validateEvidenceBundleContract(
    preSlotStaticBundle(repo.mergeSha),
    {
      gate: 'post-merge-read',
      laneType: 'governance',
      tier: 'T1',
      repoRoot: repo.repoRoot,
      mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
    },
  );
  assert.equal(hasSlotMissing(result), false, JSON.stringify(result.failures));
  assert.equal(result.profile, 'static');
});

test('pre-slot compatibility is refused when the attestation belongs to a different merge', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  const result = validateEvidenceBundleContract(
    preSlotStaticBundle(repo.mergeSha),
    {
      gate: 'post-merge-read',
      laneType: 'governance',
      tier: 'T1',
      repoRoot: repo.repoRoot,
      // Authentic in shape, but attests a different PR's merge.
      mergedPrAttestation: mergedPrAttestation(repo.receiptHead, repo.originalHead),
    },
  );
  assert.equal(hasSlotMissing(result), true, JSON.stringify(result.failures));
  assert.equal(result.valid, false);
});

test('pre-slot compatibility is refused when no merged-PR attestation is supplied at all', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  const result = validateEvidenceBundleContract(
    preSlotStaticBundle(repo.mergeSha),
    { gate: 'post-merge-read', laneType: 'governance', tier: 'T1', repoRoot: repo.repoRoot },
  );
  assert.equal(hasSlotMissing(result), true, JSON.stringify(result.failures));
});

test('pre-slot compatibility never applies pre-merge, even with an authentic attestation', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  const result = validateEvidenceBundleContract(
    preSlotStaticBundle(repo.mergeSha),
    {
      gate: 'pre-merge',
      laneType: 'governance',
      tier: 'T1',
      repoRoot: repo.repoRoot,
      mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
    },
  );
  assert.equal(hasSlotMissing(result), true, JSON.stringify(result.failures));
  assert.equal(result.valid, false);
});

test('a branch SHA never satisfies merge authority through the pre-slot compatibility path', () => {
  const repo = createMergeCommitReceiptBindingRepo({ laneAuthoredDelta: false });
  // verified_source_sha is the lane tip that was merged — a branch SHA, not the
  // merge SHA — while the attestation itself is entirely authentic.
  const result = validateEvidenceBundleContract(
    preSlotStaticBundle(repo.originalHead),
    {
      gate: 'post-merge-read',
      laneType: 'governance',
      tier: 'T1',
      repoRoot: repo.repoRoot,
      mergedPrAttestation: mergedPrAttestation(repo.mergeSha, repo.originalHead),
    },
  );
  assert.equal(hasSlotMissing(result), true, JSON.stringify(result.failures));
});

test('a pre-merge bundle must carry sha_binding.merge_sha explicitly null, never a branch SHA', () => {
  const withBranchSha = migrationEvidence();
  withBranchSha.sha_binding.merge_sha = VALID_SHA;
  const premature = validateEvidenceBundleContract(
    withBranchSha,
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(premature.valid, false);
  assert.ok(premature.failures.some((f) => f.code === 'sha_binding_premature_merge_sha'));

  // The same bundle with the slot correctly null is accepted.
  const nulled = migrationEvidence();
  const accepted = validateEvidenceBundleContract(
    nulled,
    { gate: 'pre-merge', laneType: 'migration', tier: 'T1' },
  );
  assert.equal(accepted.valid, true, JSON.stringify(accepted.failures));
});

test('the real UTV2-1720 bundle still has the pre-slot shape this compatibility path exists for', () => {
  // Pins the fixture the compatibility path was opened for. If UTV2-1720's
  // evidence.json is ever rewritten to carry the slot, this test fails and the
  // exemption should be re-examined rather than silently kept alive.
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const bundle = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'docs/06_status/proof/UTV2-1720/evidence.json'), 'utf8'),
  ) as { schema_version: number; proof_profile: string; sha_binding: Record<string, unknown> };

  assert.equal(bundle.schema_version, 2);
  assert.equal(bundle.proof_profile, 'static');
  assert.equal(
    Object.prototype.hasOwnProperty.call(bundle.sha_binding, 'merge_sha'),
    false,
    'UTV2-1720 is expected to predate the reserved merge slot',
  );
  assert.equal(bundle.sha_binding['sha_type'], 'merge_sha');
  assert.equal(
    bundle.sha_binding['verified_source_sha'],
    '374261599d63fea9a4112d94e4db18c05532e171',
    'identity is proven by verified_source_sha equalling the GitHub-recorded merge SHA of PR #1430',
  );
});

// ── UTV2-1776: authoritative merge slot vs execution/source identity ──────────
//
// Regression coverage for Post-Merge Lane Close run 33268421913, where P10 and R3
// rejected a structurally valid UTV2-1729 bundle because merge authority was read
// off `sha_binding.verified_source_sha`. Under a squash merge the merge commit and
// the verified source commit are necessarily different objects, so the old rule
// could only ever be satisfied by a bundle that misreported one of the two.
//
// Every fixture below runs against a real temporary Git repository with a real
// squash merge, so the ancestry facts are produced by git, not asserted by the test.

function createSquashMergeSplitIdentityRepo(): {
  repoRoot: string;
  ancientSha: string;
  forkPoint: string;
  executionSha: string;
  prHead: string;
  mergeSha: string;
  mainAdvance: string;
  unrelatedSha: string;
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-proof-merge-slot-'));
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
  git('commit', '-m', 'ancient main history');
  const ancientSha = git('rev-parse', 'HEAD');
  write('base2.txt', 'later main history\n');
  git('add', '.');
  git('commit', '-m', 'main fork point');
  const forkPoint = git('rev-parse', 'HEAD');

  // The lane: an implementation commit (the execution/source identity), then a
  // proof-only commit that becomes the PR head GitHub records.
  git('switch', '-c', 'lane');
  write('scripts/ops/lane-change.ts', 'export const laneChange = true;\n');
  git('add', '.');
  git('commit', '-m', 'UTV2-9000 implementation');
  const executionSha = git('rev-parse', 'HEAD');

  write('docs/06_status/proof/UTV2-9000/verification.md', 'proof commit\n');
  git('add', '.');
  git('commit', '-m', 'UTV2-9000 proof');
  const prHead = git('rev-parse', 'HEAD');

  // Main advances, then the PR is squash-merged: one parent, and the PR head is
  // NOT an ancestor of the result.
  git('switch', 'main');
  write('main-advance.txt', 'main advanced before merge\n');
  git('add', '.');
  git('commit', '-m', 'unrelated main advance');
  const mainAdvance = git('rev-parse', 'HEAD');

  git('merge', '--squash', 'lane');
  git('commit', '-m', 'UTV2-9000 squashed (#9000)');
  const mergeSha = git('rev-parse', 'HEAD');

  // A commit that belongs to neither the PR nor main's merge lineage.
  git('switch', '-c', 'unrelated', forkPoint);
  write('unrelated.txt', 'not part of the merged PR\n');
  git('add', '.');
  git('commit', '-m', 'unrelated work');
  const unrelatedSha = git('rev-parse', 'HEAD');
  git('switch', 'main');

  return { repoRoot, ancientSha, forkPoint, executionSha, prHead, mergeSha, mainAdvance, unrelatedSha };
}

describe('UTV2-1776: sha_binding.merge_sha carries merge authority; verified_source_sha carries execution identity', () => {
  const repo = createSquashMergeSplitIdentityRepo();
  const attestation = {
    merge_sha: repo.mergeSha,
    head_sha: repo.prHead,
    pr_number: 9000,
    source: 'github-api' as const,
  };
  const postMerge = (overrides: Record<string, unknown> = {}) => ({
    gate: 'post-merge-read' as const,
    repoRoot: repo.repoRoot,
    mergedPrAttestation: attestation,
    ...overrides,
  });

  after(() => {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  });

  it('git really produced the split identity this contract exists for', () => {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo.repoRoot, encoding: 'utf8' }).trim();
    const isAncestor = (a: string, b: string): boolean => {
      const result = spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo.repoRoot });
      assert.ok(result.status === 0 || result.status === 1, 'ancestry probe must complete');
      return result.status === 0;
    };
    assert.notEqual(repo.mergeSha, repo.prHead);
    assert.notEqual(repo.mergeSha, repo.executionSha);
    // A squash merge: one parent, and neither the PR head nor the execution
    // commit is an ancestor of the recorded merge. This is precisely why the old
    // `verified_source_sha === merge_sha` rule could not be satisfied honestly.
    assert.equal(git('rev-list', '--parents', '-n', '1', repo.mergeSha).split(/\s+/).length, 2);
    assert.equal(isAncestor(repo.prHead, repo.mergeSha), false);
    assert.equal(isAncestor(repo.executionSha, repo.mergeSha), false);
    // ...while the execution commit genuinely is inside the merged PR.
    assert.equal(isAncestor(repo.executionSha, repo.prHead), true);
    assert.equal(isAncestor(repo.unrelatedSha, repo.prHead), false);
  });

  it('regression: the explicit merge slot binds a squash-merged split identity', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge(),
    });
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.code, 'verifier_provenance_bound_merge_slot');
  });

  it('negative control 1: an explicit merge slot that disagrees with the GitHub-recorded merge fails closed', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mainAdvance },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
    assert.match(result.detail, /sha_binding\.merge_sha/);
  });

  it('negative control 1b: a wrong merge slot is rejected even when the receipt matches the verified source exactly', () => {
    // The fail-open PM named explicitly: the exact-source shortcut must not be
    // reachable before the slot is checked.
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.executionSha,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mainAdvance },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
  });

  it('negative control 2: the original PR head cannot satisfy merge authority', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.prHead },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
  });

  it('negative control 3: a branch/execution SHA cannot satisfy merge authority', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.executionSha },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
  });

  it('negative control 4: a missing GitHub merged-PR attestation fails closed rather than falling back to source provenance', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge({ mergedPrAttestation: null }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_unverified');
  });

  it('negative control 4b: an attestation that is not sourced from the GitHub API fails closed', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge({
        mergedPrAttestation: { ...attestation, source: 'lane-manifest' as unknown as 'github-api' },
      }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_unverified');
  });

  it('negative control 5: an attestation naming a different PR identity fails closed', () => {
    const forged = { ...attestation, head_sha: repo.unrelatedSha, pr_number: 9999 };
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge({ mergedPrAttestation: forged }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_source_not_in_merged_pr');
  });

  it('negative control 6: a verified source outside the merged PR fails closed even with a correct merge slot', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.unrelatedSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_source_not_in_merged_pr');
  });

  it('negative control 6c: a base-branch commit the PR did not contribute cannot be the verified source', () => {
    // "Ancestor of the PR head" alone would admit all of main behind the branch
    // point — including the merge SHA of every earlier PR. Each of these is a
    // genuine ancestor of the attested head and must still be rejected.
    for (const baseCommit of [repo.ancientSha, repo.forkPoint]) {
      const result = verifyExternalVerifierProvenanceBinding({
        receiptSha: repo.prHead,
        verifiedSourceSha: baseCommit,
        mergeSlot: { declared: true, value: repo.mergeSha },
        context: postMerge(),
      });
      assert.equal(result.valid, false, `base commit ${baseCommit} must not bind`);
      assert.equal(result.code, 'verifier_source_not_in_merged_pr');
    }
  });

  it('negative control 6c is not vacuous: those base commits really are ancestors of the attested PR head', () => {
    const isAncestor = (a: string, b: string): boolean => {
      const result = spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: repo.repoRoot });
      assert.ok(result.status === 0 || result.status === 1, 'ancestry probe must complete');
      return result.status === 0;
    };
    assert.equal(isAncestor(repo.ancientSha, repo.prHead), true);
    assert.equal(isAncestor(repo.forkPoint, repo.prHead), true);
    // ...and the legitimate execution commit is not on the base side.
    assert.equal(isAncestor(repo.executionSha, repo.forkPoint), false);
  });

  it('negative control 6b: a receipt bound to neither the verified source nor the attested PR head fails closed', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.mainAdvance,
      verifiedSourceSha: repo.executionSha,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_receipt_head_mismatch');
  });

  it('negative control 7: an authentic pre-slot bundle keeps the historical verified_source == merge SHA path', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.mergeSha,
      // No mergeSlot: this is what a genuinely pre-slot bundle looks like.
      context: postMerge(),
    });
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.code, 'verifier_provenance_bound_merged_pr_head');
  });

  it('negative control 8: a pre-slot bundle with a wrong attestation still fails closed', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.mainAdvance,
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
    assert.match(result.detail, /verified_source_sha/);
  });

  it('negative control 9: a pre-merge bundle declaring a non-null merge slot fails closed', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.prHead,
      mergeSlot: { declared: true, value: repo.mergeSha },
      context: { gate: 'pre-merge', repoRoot: repo.repoRoot },
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_slot_premature');
  });

  it('a pre-merge bundle declaring merge_sha: null still binds by exact source', () => {
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.prHead,
      mergeSlot: { declared: true, value: null },
      context: { gate: 'pre-merge', repoRoot: repo.repoRoot },
    });
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.code, 'verifier_provenance_bound_exact_source');
  });

  it('a post-merge bundle declaring merge_sha: null is invalid, not exempt', () => {
    // The declared-but-null slot must never be mistaken for an absent slot and
    // routed into the historical compatibility path.
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.mergeSha,
      mergeSlot: { declared: true, value: null },
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_slot_invalid');
  });

  it('a post-merge bundle whose merge slot is not a full Git SHA is invalid', () => {
    for (const value of ['deadbeef', repo.mergeSha.slice(0, 39), 42, {}, []]) {
      const result = verifyExternalVerifierProvenanceBinding({
        receiptSha: repo.prHead,
        verifiedSourceSha: repo.executionSha,
        mergeSlot: { declared: true, value },
        context: postMerge(),
      });
      assert.equal(result.valid, false, `slot ${JSON.stringify(value)} must not bind`);
      assert.equal(result.code, 'verifier_merge_slot_invalid');
    }
  });

  it('omitting mergeSlot preserves pre-UTV2-1776 semantics exactly', () => {
    // The split identity that the slot legitimises is still rejected when the
    // caller does not opt in, so the new path can never widen an old caller.
    const result = verifyExternalVerifierProvenanceBinding({
      receiptSha: repo.prHead,
      verifiedSourceSha: repo.executionSha,
      context: postMerge(),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'verifier_merge_attestation_mismatch');
  });

  it('readEvidenceMergeSlot keeps absent, null, and populated slots distinct', () => {
    assert.deepEqual(readEvidenceMergeSlot({ verified_source_sha: VALID_SHA }), { declared: false });
    assert.deepEqual(readEvidenceMergeSlot({ merge_sha: null }), { declared: true, value: null });
    assert.deepEqual(readEvidenceMergeSlot({ merge_sha: VALID_SHA }), { declared: true, value: VALID_SHA });
    assert.deepEqual(readEvidenceMergeSlot(undefined), { declared: false });
    assert.deepEqual(readEvidenceMergeSlot(null), { declared: false });
  });
});

// ---------------------------------------------------------------------------
// UTV2-1783: one pre-merge fixture, both consumers
// ---------------------------------------------------------------------------
//
// The defect was never in either consumer alone — each was individually
// defensible — it was that they disagreed about what one field meant, and no
// test ever ran them against the same bytes. So these regressions execute both
// real consumers over one fixture:
//
//   scripts/ci/proof-binding-validator.ts   invoked as CI invokes it
//   scripts/ops/proof-schema.ts proof-identity
//                                           the exact command
//                                           .github/workflows/executor-result-validator.yml
//                                           runs, plus the ancestry rule that
//                                           workflow applies to the SHA it returns
//
// The second is deliberately not a reimplementation of ERV's rules. A test
// against a restatement of a validator proves only that the copy agrees with
// itself, which is exactly how these two drifted apart unnoticed.

// tsx transpiles this file to CJS, where import.meta.dirname is undefined, so
// the root is walked up from the working directory instead.
const REPO_ROOT_1783 = ((): string => {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, 'scripts/ops/proof-schema.ts'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('cannot locate repository root from ' + process.cwd());
    dir = parent;
  }
  return dir;
})();

const TSX_BIN = path.join(REPO_ROOT_1783, 'node_modules/.bin/tsx');

interface IdentityFixture {
  repoRoot: string;
  proofDir: string;
  head: string;
}

/** A real git repo carrying one proof bundle at HEAD. */
function createIdentityFixture(options: {
  verification: string;
  evidence: Record<string, unknown>;
}): IdentityFixture {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1783-identity-'));
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'lane@example.test');
  git('config', 'user.name', 'lane');

  const relProofDir = 'docs/06_status/proof/UTV2-1783';
  const proofDir = path.join(repoRoot, relProofDir);
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'implementation.ts'), 'export const shipped = true;\n');
  git('add', '-A');
  git('commit', '-m', 'implementation');
  const head = git('rev-parse', 'HEAD');

  fs.writeFileSync(path.join(proofDir, 'verification.md'), options.verification.replaceAll('<HEAD>', head));
  fs.writeFileSync(
    path.join(proofDir, 'evidence.json'),
    `${JSON.stringify(JSON.parse(JSON.stringify(options.evidence).replaceAll('<HEAD>', head)), null, 2)}\n`,
  );
  git('add', '-A');
  git('commit', '-m', 'proof: bundle');

  return { repoRoot, proofDir, head };
}

/** Runs the identity contract exactly as the ERV workflow runs it. */
function runIdentityCli(proofDir: string, withEvidence = true): {
  status: number;
  result: {
    mode: string;
    phase: string;
    failures: { code: string; field: string; message: string }[];
    provenanceAnchorSha: string | null;
  } | null;
} {
  const argv = [
    path.join(REPO_ROOT_1783, 'scripts/ops/proof-schema.ts'),
    'proof-identity',
    // The phase is stated, exactly as the ERV workflow states it: this stands
    // in for validating an OPEN pull request, which is unmerged by definition.
    '--phase',
    'pre-merge',
    '--verification',
    path.join(proofDir, 'verification.md'),
  ];
  if (withEvidence) argv.push('--evidence', path.join(proofDir, 'evidence.json'));
  // The tsx binary is resolved absolutely: `pnpm exec` refuses to run from the
  // fixture repo, which is deliberately outside this workspace.
  const run = spawnSync(TSX_BIN, argv, { encoding: 'utf8', cwd: REPO_ROOT_1783 });
  return {
    status: run.status ?? -1,
    result: run.status === 0 ? JSON.parse(run.stdout) : null,
  };
}

/** Runs proof-binding-validator exactly as migration-reversibility-gate.yml runs it. */
function runBindingValidator(fixture: IdentityFixture): { status: number; output: string } {
  const run = spawnSync(
    TSX_BIN,
    [
      path.join(REPO_ROOT_1783, 'scripts/ci/proof-binding-validator.ts'),
      '--proof-dir',
      path.relative(fixture.repoRoot, fixture.proofDir),
    ],
    { encoding: 'utf8', cwd: fixture.repoRoot, env: { ...process.env, GITHUB_SHA: fixture.head } },
  );
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

/** The rule Executor Result Validation applies to the SHA the contract returns. */
function ervAcceptsAnchor(fixture: IdentityFixture, anchor: string | null): boolean {
  if (!anchor || !/^[0-9a-f]{7,40}$/i.test(anchor)) return false;
  const cmp = spawnSync('git', ['merge-base', '--is-ancestor', anchor, fixture.head], {
    cwd: fixture.repoRoot,
  });
  return cmp.status === 0;
}

const CANONICAL_PRE_MERGE_MARKDOWN = [
  '# PROOF: UTV2-1783',
  '',
  'MERGE_SHA: pending merge',
  '',
  '## Verification',
  '',
  'ASSERTIONS: measured',
  '',
  'EVIDENCE:',
  '',
  '```',
  '$ pnpm verify',
  '```',
  '',
  '## Merge SHA Binding',
  '',
  'Merge SHA: pending merge',
  'PR: https://github.com/griff843/Unit-Talk-v2/pull/1783',
  'Approved PR head: pending merge',
  'Execution SHA: <HEAD>',
  '',
].join('\n');

/**
 * A migration-lane bundle: the lane type where both consumers actually run, and
 * therefore the only shape that exercises the contradiction end to end
 * (contract item 7). Built from the same migration proof shape the binding gate
 * already validates, so this fixture is realistic rather than minimal.
 */
function identityMigrationEvidence(sha = '<HEAD>'): Record<string, unknown> {
  return {
    schema_version: PROOF_SCHEMA_VERSION,
    issue_id: 'UTV2-1783',
    proof_profile: 'migration',
    sha_binding: {
      merge_sha: null,
      verified_source_sha: sha,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: {
      head: sha,
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

// UTV2-1783 suite (node:test test() calls; AGENTS.md forbids describe/it)
test('one migration-lane fixture satisfies proof-binding-validator AND Executor Result Validation', () => {
  const fixture = createIdentityFixture({
    verification: CANONICAL_PRE_MERGE_MARKDOWN,
    evidence: identityMigrationEvidence(),
  });
  try {
    // Consumer 1 — the gate migration lanes reach through
    // migration-reversibility-gate.yml.
    const binding = runBindingValidator(fixture);
    assert.equal(binding.status, 0, binding.output);

    // Consumer 2 — the required Executor Result Validation check.
    const { status, result } = runIdentityCli(fixture.proofDir);
    assert.equal(status, 0);
    assert.deepEqual(result!.failures, []);
    assert.equal(result!.mode, 'schema-v2');
    assert.equal(result!.phase, 'pre-merge');
    // ERV ancestry-checks execution identity, not the merge row.
    assert.equal(result!.provenanceAnchorSha, fixture.head);
    assert.ok(ervAcceptsAnchor(fixture, result!.provenanceAnchorSha));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('the placeholder is presentation only and is never handed to a consumer as a git SHA', () => {
  const fixture = createIdentityFixture({
    verification: CANONICAL_PRE_MERGE_MARKDOWN,
    evidence: identityMigrationEvidence(),
  });
  try {
    const { result } = runIdentityCli(fixture.proofDir);
    assert.notEqual(result!.provenanceAnchorSha, 'pending merge');
    // The literal that the old ERV rule rejected as "not a valid git SHA" is
    // now never routed to a SHA rule at all.
    assert.ok(!ervAcceptsAnchor(fixture, 'pending merge'));
    assert.ok(ervAcceptsAnchor(fixture, result!.provenanceAnchorSha));
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a branch/execution SHA parked in sha_binding.merge_sha fails', () => {
  const evidence = identityMigrationEvidence();
  (evidence['sha_binding'] as Record<string, unknown>)['merge_sha'] = '<HEAD>';
  const fixture = createIdentityFixture({ verification: CANONICAL_PRE_MERGE_MARKDOWN, evidence });
  try {
    const { result } = runIdentityCli(fixture.proofDir);
    // The caller stated pre-merge, so the bundle's claim is refused outright
    // rather than being believed and then checked for internal consistency.
    assert.equal(result!.phase, 'pre-merge');
    assert.ok(
      result!.failures.some((f) => f.code === 'premature_merge_authority'),
      JSON.stringify(result!.failures),
    );
    assert.notEqual(runBindingValidator(fixture).status, 0);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

/**
 * The open-PR authority-claim regression.
 *
 * An open pull request is unmerged by definition, so a bundle that names a
 * merge SHA is asserting authority GitHub never granted. If the phase were
 * inferred from the bundle, the attacker-controlled path would be trivial:
 * fill sha_binding.merge_sha with a plausible SHA, repeat it in both markdown
 * merge rows, keep verified_source_sha an ancestor of the head, and the
 * identity check falls silent because the bundle is internally consistent with
 * its own lie. Stating the phase is what makes that unreachable.
 */
test('an open PR cannot grant itself merge authority, even with a fully self-consistent bundle', () => {
  const evidence = identityMigrationEvidence();
  (evidence['sha_binding'] as Record<string, unknown>)['merge_sha'] = OTHER_SHA;
  // Every markdown row agrees with the claim: this bundle is self-consistent.
  const selfConsistent = CANONICAL_PRE_MERGE_MARKDOWN
    .replace('MERGE_SHA: pending merge', `MERGE_SHA: ${OTHER_SHA}`)
    .replace('Merge SHA: pending merge', `Merge SHA: ${OTHER_SHA}`);
  const fixture = createIdentityFixture({ verification: selfConsistent, evidence });
  try {
    const { result } = runIdentityCli(fixture.proofDir);
    assert.equal(result!.phase, 'pre-merge', 'the caller states the phase; the bundle does not');
    assert.ok(
      result!.failures.some((f) => f.code === 'premature_merge_authority'),
      JSON.stringify(result!.failures),
    );
    assert.notEqual(runBindingValidator(fixture).status, 0);

    // Inference is what the workflow must never fall back to: without a stated
    // phase this same bundle reads as post-merge and reports nothing wrong.
    const inferred = validateProofMergeShaIdentity({
      verificationMarkdown: selfConsistent.replaceAll('<HEAD>', VALID_SHA),
      evidence: (() => {
        const e = identityMigrationEvidence(VALID_SHA);
        (e['sha_binding'] as Record<string, unknown>)['merge_sha'] = OTHER_SHA;
        return e;
      })(),
    });
    assert.equal(inferred.phase, 'post-merge');
    assert.deepEqual(inferred.failures, [], 'this is precisely why the phase is not inferred here');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('the CLI refuses to run without an explicit phase rather than defaulting to one', () => {
  const fixture = createIdentityFixture({
    verification: CANONICAL_PRE_MERGE_MARKDOWN,
    evidence: identityMigrationEvidence(),
  });
  try {
    const argv = [
      path.join(REPO_ROOT_1783, 'scripts/ops/proof-schema.ts'),
      'proof-identity',
      '--verification',
      path.join(fixture.proofDir, 'verification.md'),
      '--evidence',
      path.join(fixture.proofDir, 'evidence.json'),
    ];
    const run = spawnSync(TSX_BIN, argv, { encoding: 'utf8', cwd: REPO_ROOT_1783 });
    assert.equal(run.status, 2, 'a missing --phase must be an error, never a default');
    assert.match(run.stderr, /--phase is required/);
    for (const bad of ['', 'premerge', 'PRE-MERGE', 'unmerged']) {
      const r = spawnSync(TSX_BIN, [...argv, '--phase', bad], { encoding: 'utf8', cwd: REPO_ROOT_1783 });
      assert.equal(r.status, 2, `--phase ${JSON.stringify(bad)} must be rejected`);
    }
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('a missing or invalid verified_source_sha fails execution provenance and yields no anchor', () => {
  for (const bad of [undefined, null, '', 'pending merge', VALID_SHA.slice(0, 8)]) {
    const evidence = identityMigrationEvidence();
    const binding = evidence['sha_binding'] as Record<string, unknown>;
    if (bad === undefined) delete binding['verified_source_sha'];
    else binding['verified_source_sha'] = bad;
    const result = validateProofMergeShaIdentity({
      verificationMarkdown: CANONICAL_PRE_MERGE_MARKDOWN.replaceAll('<HEAD>', VALID_SHA),
      evidence,
    });
    assert.ok(
      result.failures.some((f) => f.code === 'execution_identity_invalid'),
      `verified_source_sha ${JSON.stringify(bad)} must fail`,
    );
    assert.equal(result.provenanceAnchorSha, null);
  }
});

test('post-merge, merge authority is present and the markdown must present it', () => {
  const evidence = identityMigrationEvidence(VALID_SHA);
  (evidence['sha_binding'] as Record<string, unknown>)['merge_sha'] = OTHER_SHA;
  const rebound = CANONICAL_PRE_MERGE_MARKDOWN
    .replace('MERGE_SHA: pending merge', `MERGE_SHA: ${OTHER_SHA}`)
    .replace('Merge SHA: pending merge', `Merge SHA: ${OTHER_SHA}`)
    .replaceAll('<HEAD>', VALID_SHA);
  const ok = validateProofMergeShaIdentity({ verificationMarkdown: rebound, evidence });
  assert.equal(ok.phase, 'post-merge');
  assert.deepEqual(ok.failures, []);
  // Execution identity stays truthful after the rebind: it is still the
  // source commit, not the merge commit.
  assert.equal(ok.provenanceAnchorSha, VALID_SHA);

  // And a bundle that claims merge authority while still showing the
  // placeholder is a rebind that only half happened.
  const halfBound = validateProofMergeShaIdentity({
    verificationMarkdown: CANONICAL_PRE_MERGE_MARKDOWN.replaceAll('<HEAD>', VALID_SHA),
    evidence,
  });
  assert.ok(halfBound.failures.some((f) => f.code === 'merge_row_not_merge_authority'));
});

// UTV2-1783 mutation control suite (node:test test() calls; AGENTS.md forbids describe/it)
// Every control below re-creates one half of the original contradiction and
// asserts the integration regression above would fail on it. A control that
// cannot fail proves nothing.

test('control A — the old proof-binding rule (execution SHA in the merge row) now fails', () => {
  const withBranchShaInMergeRow = CANONICAL_PRE_MERGE_MARKDOWN.replace(
    'MERGE_SHA: pending merge',
    'MERGE_SHA: <HEAD>',
  );
  const fixture = createIdentityFixture({
    verification: withBranchShaInMergeRow,
    evidence: identityMigrationEvidence(),
  });
  try {
    const { result } = runIdentityCli(fixture.proofDir);
    assert.ok(
      result!.failures.some((f) => f.code === 'merge_row_not_placeholder'),
      JSON.stringify(result!.failures),
    );
    assert.notEqual(runBindingValidator(fixture).status, 0);
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

test('control B — the old ERV rule (merge row parsed as a git SHA) would reject the canonical bundle', () => {
  // This is the control that shows the contradiction was real rather than a
  // formatting quibble: the canonical fixture the binding validator accepts
  // is exactly the one the old ERV rule rejected.
  const row = CANONICAL_PRE_MERGE_MARKDOWN.match(/^MERGE_SHA:\s*(.+)$/m)![1]!.trim();
  const oldErvRule = /^[0-9a-f]{7,40}$/i;
  assert.ok(!oldErvRule.test(row), 'the old rule rejected this row — that was the deadlock');
  // The repaired contract routes ERV to a field that does satisfy it.
  const repaired = validateProofMergeShaIdentity({
    verificationMarkdown: CANONICAL_PRE_MERGE_MARKDOWN.replaceAll('<HEAD>', VALID_SHA),
    evidence: identityMigrationEvidence(VALID_SHA),
  });
  assert.deepEqual(repaired.failures, []);
  assert.ok(oldErvRule.test(repaired.provenanceAnchorSha!));
});

test('control C — the discriminator is the DECLARED schema version, not the presence of sha_binding', () => {
  // Historical compatibility is narrow and explicit: no v2 declaration means
  // the older rule, not a relaxed one. Reading a legacy bundle under the v2
  // rule (or the reverse) fails, which is what keeps the two paths from
  // blurring into each other.
  const legacyMarkdown = `# PROOF: lane\n\nMERGE_SHA: ${VALID_SHA}\n\n## Verification\n\nmeasured\n`;
  const asLegacy = validateProofMergeShaIdentity({ verificationMarkdown: legacyMarkdown });
  assert.equal(asLegacy.mode, 'legacy-anchor');
  assert.deepEqual(asLegacy.failures, []);
  assert.equal(asLegacy.provenanceAnchorSha, VALID_SHA);

  // A sha_binding object alone must NOT promote a bundle to v2 — this is the
  // mutation that would retroactively fail 157 shipped bundles.
  const v1WithBinding = validateProofMergeShaIdentity({
    verificationMarkdown: legacyMarkdown,
    evidence: {
      schema_version: 1,
      sha_binding: { verified_source_sha: VALID_SHA },
    },
  });
  assert.equal(v1WithBinding.mode, 'legacy-anchor');
  assert.deepEqual(v1WithBinding.failures, []);
  assert.equal(v1WithBinding.provenanceAnchorSha, VALID_SHA);

  // And a bundle that does declare v2 is held to the v2 rules.
  const asV2 = validateProofMergeShaIdentity({
    verificationMarkdown: legacyMarkdown,
    evidence: {
      schema_version: PROOF_SCHEMA_VERSION,
      sha_binding: { merge_sha: null, verified_source_sha: VALID_SHA },
    },
    phase: 'pre-merge',
  });
  assert.equal(asV2.mode, 'schema-v2');
  assert.ok(asV2.failures.some((f) => f.code === 'merge_row_not_placeholder'));
});

/**
 * The regression the P2 review thread asked for, run against a REAL shipped
 * bundle rather than a hand-built imitation of one.
 *
 * UTV2-1554 declares `schema_version: 1` and still carries a `sha_binding`
 * block, as 157 bundles in this repository do. Discriminating on the presence
 * of that object rather than the declared version would classify every one of
 * them as v2 and fail them on placeholder and binding-section rules that did
 * not exist when they were written — blocking any PR that resumes or
 * revalidates a historical proof. A fabricated fixture could not have caught
 * this, because the fabricated one would have been written to whatever shape
 * the new code expected.
 */
test('a real historical schema-v1 bundle in this repository stays on the legacy path', () => {
  const dir = path.join(REPO_ROOT_1783, 'docs/06_status/proof/UTV2-1554');
  const evidence = JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'));
  const verification = fs.readFileSync(path.join(dir, 'verification.md'), 'utf8');

  // Preconditions, asserted so this test fails loudly if the fixture is ever
  // migrated rather than silently proving nothing.
  assert.equal(evidence.schema_version, 1, 'fixture must be a real v1 bundle');
  assert.equal(typeof evidence.sha_binding, 'object');
  assert.ok(evidence.sha_binding !== null, 'fixture must carry a sha_binding block');

  const result = validateProofMergeShaIdentity({
    verificationMarkdown: verification,
    evidence,
    phase: 'pre-merge',
  });
  assert.equal(result.mode, 'legacy-anchor');
  assert.deepEqual(result.failures, [], 'a shipped historical bundle must not fail retroactively');
  assert.match(result.provenanceAnchorSha!, /^[0-9a-f]{7,40}$/i);
});

test('every schema-v1 bundle in the repository stays on the legacy path', () => {
  // The census behind the claim above: measured, not asserted from memory.
  const dirs = fs
    .readdirSync(path.join(REPO_ROOT_1783, 'docs/06_status/proof'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(REPO_ROOT_1783, 'docs/06_status/proof', d.name));

  let v1WithBinding = 0;
  const misclassified: string[] = [];
  for (const dir of dirs) {
    const evidencePath = path.join(dir, 'evidence.json');
    const verificationPath = path.join(dir, 'verification.md');
    if (!fs.existsSync(evidencePath) || !fs.existsSync(verificationPath)) continue;
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    } catch {
      continue;
    }
    const binding = evidence['sha_binding'];
    const isV1WithBinding =
      Number(evidence['schema_version']) !== PROOF_SCHEMA_VERSION &&
      typeof binding === 'object' &&
      binding !== null;
    if (!isV1WithBinding) continue;
    v1WithBinding += 1;
    const result = validateProofMergeShaIdentity({
      verificationMarkdown: fs.readFileSync(verificationPath, 'utf8'),
      evidence,
      phase: 'pre-merge',
    });
    if (result.mode !== 'legacy-anchor') misclassified.push(path.basename(dir));
  }

  assert.ok(v1WithBinding > 100, `expected the historical corpus to be large, found ${v1WithBinding}`);
  assert.deepEqual(misclassified, [], 'no shipped v1 bundle may be read under the v2 rules');
});

test('control D — a corrupt evidence.json is an error, never a downgrade to the legacy path', () => {
  const fixture = createIdentityFixture({
    verification: CANONICAL_PRE_MERGE_MARKDOWN,
    evidence: identityMigrationEvidence(),
  });
  try {
    fs.writeFileSync(path.join(fixture.proofDir, 'evidence.json'), '{ not json');
    const run = runIdentityCli(fixture.proofDir);
    assert.equal(run.status, 2, 'unreadable evidence must exit 2, not fall back');
  } finally {
    fs.rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
});

// UTV2-1783 wiring suite (node:test test() calls; AGENTS.md forbids describe/it)
const ERV_WORKFLOW = fs.readFileSync(
  path.join(REPO_ROOT_1783, '.github/workflows/executor-result-validator.yml'),
  'utf8',
);

test('W1 — Executor Result Validation invokes the shared contract module', () => {
  assert.ok(
    ERV_WORKFLOW.includes("'scripts/ops/proof-schema.ts'") &&
      ERV_WORKFLOW.includes("'proof-identity'"),
    'the workflow must execute scripts/ops/proof-schema.ts proof-identity',
  );
});

test('W2 — the workflow does not restate the merge-row SHA rule it used to own', () => {
  // Comment lines are stripped first: the block explaining the removed rule
  // necessarily quotes it, and failing on the explanation would push the next
  // author to delete the explanation rather than the duplication.
  const code = ERV_WORKFLOW.split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('#'))
    .join('\n');
  assert.ok(
    !/\[0-9a-f\]\{7,40\}/.test(code),
    'the SHA rule must live in proof-schema.ts, not in a second copy here',
  );
  assert.ok(
    !code.includes('Proof MERGE_SHA is not a valid git SHA'),
    'the old merge-row-as-git-SHA rejection must not return',
  );
});

test('W3 — the ancestry check runs against the contract-returned anchor, not the merge row', () => {
  const code = ERV_WORKFLOW.split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  assert.ok(code.includes('identity.provenanceAnchorSha'));
  assert.ok(code.includes('base: anchor, head: headSha'));
  assert.ok(
    !/base:\s*fileSha/.test(code),
    'ancestry must never be computed from the markdown merge row again',
  );
});

test('W4 — the workflow states pre-merge explicitly rather than letting the phase be inferred', () => {
  const code = ERV_WORKFLOW.split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  // This job only ever runs against an OPEN pull request, so the phase is a
  // fact about the caller, not about the bundle. Passing it explicitly is what
  // stops an untrusted bundle's own merge slot from talking the validator into
  // believing a merge already happened. The CLI refuses to run without it, so
  // this assertion and that guard fail together rather than silently.
  assert.ok(code.includes("'--phase'"), 'the workflow must pass --phase');
  assert.ok(code.includes("'pre-merge'"), 'an open PR is always validated pre-merge');
});
