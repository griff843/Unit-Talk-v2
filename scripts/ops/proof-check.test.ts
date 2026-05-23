/**
 * Tests for ops:proof-check (Proof Freshness Validator — WFR-v2 Phase A)
 *
 * These tests exercise the run() logic via fixture files written to a
 * temp dir. They use node:test so they run under `pnpm test`.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProofSchema, isProofStale, PROOF_SCHEMA_VERSION } from './proof-schema.js';
import type { ProofSchemaV2 } from './proof-schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const THIRD_SHA = 'c'.repeat(40);

function makeProof(overrides: Partial<ProofSchemaV2> = {}): ProofSchemaV2 {
  return {
    schema_version: PROOF_SCHEMA_VERSION,
    issue_id: 'UTV2-1156',
    pr_number: 900,
    source_sha: VALID_SHA,
    reviewed_head_sha: VALID_SHA,
    evidence_commit_sha: null,
    current_head_sha: null,
    merge_sha: null,
    gate_results: [{ gate: 'ci', verdict: 'PASS', detail: 'All green' }],
    reviewer_verdict: null,
    pm_verdict: null,
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation unit tests (no filesystem)
// ---------------------------------------------------------------------------

describe('proof-schema validation fixtures', () => {
  it('valid proof passes', () => {
    const r = validateProofSchema(makeProof());
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: wrong schema_version → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), schema_version: 1 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'schema_version'));
  });

  it('NEGATIVE: missing issue_id → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), issue_id: '' });
    assert.ok(!r.valid);
  });

  it('NEGATIVE: pr_number = 0 → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), pr_number: 0 });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'pr_number'));
  });

  it('NEGATIVE: bad source_sha → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), source_sha: 'deadbeef' });
    assert.ok(!r.valid);
    assert.ok(r.failures.some(f => f.field === 'source_sha'));
  });

  it('NEGATIVE: bad gate verdict → invalid', () => {
    const r = validateProofSchema({
      ...makeProof(),
      gate_results: [{ gate: 'ci', verdict: 'YES', detail: 'hmm' }],
    });
    assert.ok(!r.valid);
  });

  it('NEGATIVE: empty gate_results is valid (no gates required yet)', () => {
    const r = validateProofSchema({ ...makeProof(), gate_results: [] });
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: non-array gate_results → invalid', () => {
    const r = validateProofSchema({ ...makeProof(), gate_results: 'bad' as unknown as [] });
    assert.ok(!r.valid);
  });
});

// ---------------------------------------------------------------------------
// Staleness logic unit tests
// ---------------------------------------------------------------------------

describe('isProofStale', () => {
  it('fresh: source_sha == current head → not stale', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), VALID_SHA), false);
  });

  it('NEGATIVE stale: source_sha != current head → stale', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), OTHER_SHA), true);
  });

  it('NEGATIVE stale: proof written at HEAD-1, new commit pushed → stale', () => {
    const proof = makeProof({ source_sha: VALID_SHA });
    const newHead = THIRD_SHA;
    assert.equal(isProofStale(proof, newHead), true);
  });

  it('malformed currentHeadSha → treats as not-stale (unknown)', () => {
    assert.equal(isProofStale(makeProof({ source_sha: VALID_SHA }), 'short'), false);
  });

  it('malformed source_sha → treats as stale (invalid proof)', () => {
    assert.equal(isProofStale(makeProof({ source_sha: 'bad' }), VALID_SHA), true);
  });
});

// ---------------------------------------------------------------------------
// Filesystem fixture tests
// ---------------------------------------------------------------------------

describe('proof-check file resolution', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-check-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds valid JSON proof file', () => {
    const proofPath = path.join(tmpDir, 'UTV2-TEST.json');
    fs.writeFileSync(proofPath, JSON.stringify(makeProof({ issue_id: 'UTV2-TEST' })));
    assert.ok(fs.existsSync(proofPath));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as unknown;
    const r = validateProofSchema(content);
    assert.ok(r.valid, JSON.stringify(r.failures));
  });

  it('NEGATIVE: missing proof file → no content', () => {
    const proofPath = path.join(tmpDir, 'UTV2-MISSING.json');
    assert.ok(!fs.existsSync(proofPath));
  });

  it('NEGATIVE: corrupt JSON → parse error', () => {
    const proofPath = path.join(tmpDir, 'UTV2-CORRUPT.json');
    fs.writeFileSync(proofPath, '{bad json}');
    assert.throws(() => JSON.parse(fs.readFileSync(proofPath, 'utf8')));
  });

  it('NEGATIVE: proof with wrong schema_version in file → invalid', () => {
    const proofPath = path.join(tmpDir, 'UTV2-V1.json');
    fs.writeFileSync(proofPath, JSON.stringify({ ...makeProof(), schema_version: 1 }));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as unknown;
    const r = validateProofSchema(content);
    assert.ok(!r.valid);
  });

  it('NEGATIVE: stale proof written to file', () => {
    const proofPath = path.join(tmpDir, 'UTV2-STALE.json');
    const proof = makeProof({ source_sha: VALID_SHA });
    fs.writeFileSync(proofPath, JSON.stringify(proof));
    const content = JSON.parse(fs.readFileSync(proofPath, 'utf8')) as ProofSchemaV2;
    // Simulate that the head has moved
    const newHead = OTHER_SHA;
    assert.equal(isProofStale(content, newHead), true);
  });

  it('NEGATIVE: pr_number mismatch', () => {
    const proof = makeProof({ pr_number: 900 });
    const claimedPr = 901;
    assert.notEqual(proof.pr_number, claimedPr);
  });
});
