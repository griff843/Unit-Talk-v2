import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBindingEvidenceContract } from './proof-binding-validator.js';

const SHA = 'a'.repeat(40);

function migrationBundle() {
  return {
    schema_version: 2,
    issue_id: 'UTV2-1718',
    sha_binding: {
      verified_source_sha: SHA,
      evidence_commit_sha: 'set-by-ci',
      current_pr_head_sha: 'set-by-ci',
    },
    static_proof: { type_check: { status: 'PASS' } },
    runtime_proof: {
      head: SHA,
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

test('binding gate consumes the shared schema-v2 migration contract', () => {
  const result = validateBindingEvidenceContract(migrationBundle(), 'migration');
  assert.equal(result.valid, true, JSON.stringify(result.failures));
  assert.equal(result.profile, 'migration');
});

test('binding gate fails schema v2 when sha_binding is absent', () => {
  const bundle = migrationBundle();
  Reflect.deleteProperty(bundle, 'sha_binding');
  const result = validateBindingEvidenceContract(bundle, 'migration');
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.code === 'sha_binding_missing'));
});

test('binding gate keeps supported schema-v1 evidence readable', () => {
  const result = validateBindingEvidenceContract({ schema_version: 1 }, null);
  assert.equal(result.valid, true);
  assert.equal(result.profile, 'legacy-v1');
});
