import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../ci/isolated-proof-attestation.js';
import {
  buildHarvestedRuntimeProof,
  buildRuntimeProofQueries,
  buildRuntimeProofRowCounts,
  downloadCiDbProofReceipt,
  extractTablesPerTestFromSource,
  fetchCiDbProofJobLog,
  harvestCiDbProofForMergeSha,
  locateCiDbProofRun,
  parsePassingTapTests,
  verifyHarvestedReceipt,
  type GhExecutor,
  type HarvestedCiRunInfo,
  type ZipExtractor,
} from './ci-db-proof-harvest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'utv2-1641-ci-db-proof');

/**
 * ## Provenance of the fixtures used below
 *
 * `real-utv2-1399-receipt.json` and `real-utv2-1399-job-log.txt` are NOT
 * synthetic. They are byte-for-byte what this lane downloaded from GitHub's
 * own API for UTV2-1399's real, already-merged closeout repair:
 *   - PR: griff843/Unit-Talk-v2#1343
 *   - CI run: 30680085299 (workflow "CI")
 *   - job: 91315210076 ("Writable DB proof (staging only)")
 *   - `gh api repos/griff843/Unit-Talk-v2/actions/artifacts/8811926669/zip`
 *     unzipped to the receipt fixture; `gh api
 *     repos/griff843/Unit-Talk-v2/actions/jobs/91315210076/logs` to the log
 *     fixture.
 * The row_counts this test suite derives from the log fixture below
 * (distribution_receipts:1, distribution_outbox:11, system_runs:1, sports:9,
 * cappers:1, market_families:6, selection_types:3, market_types:133) match
 * EXACTLY what UTV2-1399's own hand-authored evidence.json repair recorded
 * (see PR #1348) -- independent cross-validation that this module's mechanical
 * derivation reproduces what a human derived by hand from the same real run.
 */
const REAL_RECEIPT_RAW = fs.readFileSync(path.join(FIXTURES_DIR, 'real-utv2-1399-receipt.json'), 'utf8');
const REAL_JOB_LOG = fs.readFileSync(path.join(FIXTURES_DIR, 'real-utv2-1399-job-log.txt'), 'utf8');
const REAL_TEST_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'apps/api/src/database-smoke.test.ts'), 'utf8');
const REAL_RUN_INFO: HarvestedCiRunInfo = {
  workflow: 'CI',
  job: 'Writable DB proof (staging only)',
  run_id: 30680085299,
  run_attempt: 1,
  job_id: 91315210076,
  job_url: 'https://github.com/griff843/Unit-Talk-v2/actions/runs/30680085299/job/91315210076',
  target_head_sha: 'b36840e452333cb605e1d0c61f3aec547e50be3d',
  target_merge_sha: 'fdc193582f94ad7538fa594b475847eb81a3647f',
  conclusion: 'success',
};

// ── verifyHarvestedReceipt: real receipt passes, tampering fails closed ───────

test('verifyHarvestedReceipt: the real UTV2-1399 receipt fixture passes structural verification', () => {
  const result = verifyHarvestedReceipt(REAL_RECEIPT_RAW);
  assert.strictEqual(result.ok, true, !result.ok ? result.reason : undefined);
  if (result.ok) {
    assert.strictEqual(result.receipt.observed_project_ref, 'xskgrzbteyqdufktjrjx');
    assert.strictEqual(result.receipt.tap.pass, 7);
    assert.strictEqual(result.receipt.tap.fail, 0);
  }
});

test('verifyHarvestedReceipt: editing captured_output without updating the hash fails closed', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  receipt.captured_output = `${receipt.captured_output}\nEXTRA LINE INJECTED BY A TAMPERING ATTEMPT`;
  const result = verifyHarvestedReceipt(JSON.stringify(receipt));
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /output_sha256|receipt_sha256/);
  }
});

test('verifyHarvestedReceipt: a receipt targeting canonical production fails closed even if otherwise well-formed', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  receipt.observed_project_ref = 'zfzdnfwdarxucxtaojxm'; // CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF
  // Recompute the hash so this test isolates the production-ref check, not the
  // integrity check above.
  const { receipt_sha256: _drop, ...withoutHash } = receipt;
  receipt.receipt_sha256 = sha256(JSON.stringify(withoutHash));
  const result = verifyHarvestedReceipt(JSON.stringify(receipt));
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /production/);
  }
});

test('verifyHarvestedReceipt: a receipt for a different command fails closed', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  receipt.command = 'pnpm test';
  const result = verifyHarvestedReceipt(JSON.stringify(receipt));
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /pnpm test:db/);
  }
});

// ── parsePassingTapTests: real captured_output ────────────────────────────────

test('parsePassingTapTests: extracts all 7 real passing tests with durations', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  const parsed = parsePassingTapTests(receipt.captured_output);
  assert.strictEqual(parsed.length, 7);
  assert.strictEqual(parsed[0].description, 'database repository bundle persists a submission and settlement when Supabase is configured');
  assert.strictEqual(Math.round(parsed[0].durationMs ?? 0), 7329);
  assert.strictEqual(
    parsed[6].description,
    'UTV2-996: correction chain is additive — original settlement row is not mutated',
  );
});

// ── extractTablesPerTestFromSource: real database-smoke.test.ts ──────────────

test('extractTablesPerTestFromSource: derives real .from() table references per test from the actual source file', () => {
  const map = extractTablesPerTestFromSource(REAL_TEST_SOURCE);
  assert.deepStrictEqual(
    map.get('database repository bundle persists a submission and settlement when Supabase is configured'),
    ['picks', 'submissions'],
  );
  assert.deepStrictEqual(
    map.get('UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes'),
    ['audit_log', 'distribution_outbox', 'distribution_receipts', 'pick_lifecycle', 'picks', 'submissions'],
  );
  // UTV2-883 has no literal .from() call in its body (it goes through
  // repositories.participants.listByType only) -- this must be an honest empty
  // array, not a fabricated guess.
  assert.deepStrictEqual(
    map.get('UTV2-883: no duplicate participants for the same external_id and sport'),
    [],
  );
});

// ── buildRuntimeProofQueries: combining real TAP output + real source ────────

test('buildRuntimeProofQueries: real captured_output x real test source yields 7 honest query entries', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  const queries = buildRuntimeProofQueries(receipt.captured_output, REAL_TEST_SOURCE);
  assert.strictEqual(queries.length, 7);
  assert.strictEqual(queries[0].table, 'picks,submissions');
  assert.match(queries[0].description, /database repository bundle persists.*\(ok 1, 7328\.86ms\)/);
  // The one test with no literal .from() call is labelled honestly, not guessed.
  const utv2883 = queries.find((q) => q.description.startsWith('UTV2-883'));
  assert.ok(utv2883);
  assert.match(utv2883!.table, /^unknown \(no literal \.from\(\) table reference found/);
});

// ── buildRuntimeProofRowCounts: real seed-staging job log ─────────────────────

test('buildRuntimeProofRowCounts: real job log reproduces the exact counts UTV2-1399\'s own hand-authored repair recorded', () => {
  const rowCounts = buildRuntimeProofRowCounts(REAL_JOB_LOG);
  assert.deepStrictEqual(rowCounts, [
    { table: 'distribution_receipts', count: 1, status: 'reset (rows deleted)' },
    { table: 'distribution_outbox', count: 11, status: 'reset (rows deleted)' },
    { table: 'system_runs', count: 1, status: 'reset (rows deleted)' },
    { table: 'sports', count: 9, status: 'upserted (synthetic reference rows)' },
    { table: 'cappers', count: 1, status: 'upserted (synthetic reference rows)' },
    { table: 'market_families', count: 6, status: 'upserted (synthetic reference rows)' },
    { table: 'selection_types', count: 3, status: 'upserted (synthetic reference rows)' },
    { table: 'market_types', count: 133, status: 'upserted (synthetic reference rows)' },
  ]);
});

test('buildRuntimeProofRowCounts: a log with no seed-staging lines yields an empty array (fails closed upstream, never fabricates)', () => {
  assert.deepStrictEqual(buildRuntimeProofRowCounts('##[group]Run something unrelated\nhello world\n'), []);
});

// ── buildHarvestedRuntimeProof: the full before/after harvest demonstration ───
//
// This is the concrete before/after: a fixture WITH a genuine CI receipt
// harvests real, non-empty runtime_proof.queries/row_counts (what R1/R2
// require); a fixture with no derivable evidence at all refuses to harvest
// anything, leaving R1/R2 to fail honestly.

test('BEFORE/AFTER: a genuine CI receipt + job log harvests real, non-empty queries and row_counts (R1/R2 would now PASS)', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  const result = buildHarvestedRuntimeProof({
    receipt,
    testSourceText: REAL_TEST_SOURCE,
    jobLogText: REAL_JOB_LOG,
    runInfo: REAL_RUN_INFO,
  });
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.runtimeProof.queries.length, 7);
    assert.strictEqual(result.runtimeProof.row_counts.length, 8);
    assert.strictEqual(result.runtimeProof.pass, 7);
    assert.strictEqual(result.runtimeProof.fail, 0);
    assert.strictEqual(result.runtimeProof.ci_run.run_id, REAL_RUN_INFO.run_id);
    // This is exactly what makes truth-check-lib.ts's R1/R2 pass:
    assert.ok(Array.isArray(result.runtimeProof.queries) && result.runtimeProof.queries.length > 0);
    assert.ok(Array.isArray(result.runtimeProof.row_counts) && result.runtimeProof.row_counts.length > 0);
  }
});

test('BEFORE/AFTER: no receipt/log evidence at all -- refuses to harvest, R1/R2 stay honestly failed', () => {
  const receiptWithNoPassingTests = {
    ...JSON.parse(REAL_RECEIPT_RAW),
    captured_output: 'TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n# skipped 0\n',
    tap: { tests: 0, pass: 0, fail: 0, skipped: 0 },
  };
  const result = buildHarvestedRuntimeProof({
    receipt: receiptWithNoPassingTests,
    testSourceText: REAL_TEST_SOURCE,
    jobLogText: REAL_JOB_LOG,
    runInfo: REAL_RUN_INFO,
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.code, 'no_queries_derived');
  }
});

test('BEFORE/AFTER: a genuine test:db receipt but no seed-staging log lines refuses to harvest row_counts (no partial fabrication)', () => {
  const receipt = JSON.parse(REAL_RECEIPT_RAW);
  const result = buildHarvestedRuntimeProof({
    receipt,
    testSourceText: REAL_TEST_SOURCE,
    jobLogText: '##[group]Run something unrelated\nno seed-staging lines here\n',
    runInfo: REAL_RUN_INFO,
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.code, 'no_row_counts_derived');
  }
});

// ── locateCiDbProofRun: injected fake GitHub responses ────────────────────────

function fakeGhExecutor(responses: Record<string, string>): GhExecutor {
  return (args: string[]) => {
    const key = args.join(' ');
    const match = Object.keys(responses).find((pattern) => key.includes(pattern));
    if (!match) {
      throw Object.assign(new Error(`fakeGhExecutor: no canned response for "${key}"`), { stderr: 'not found' });
    }
    return Buffer.from(responses[match], 'utf8');
  };
}

test('locateCiDbProofRun: happy path resolves PR -> head SHA -> CI run -> DB proof job', () => {
  const mergeSha = 'fdc193582f94ad7538fa594b475847eb81a3647f';
  const headSha = 'b36840e452333cb605e1d0c61f3aec547e50be3d';
  const ghExecutor = fakeGhExecutor({
    [`commits/${mergeSha}/pulls`]: JSON.stringify([{ number: 1343, head: { sha: headSha } }]),
    [`actions/runs?head_sha=${headSha}`]: JSON.stringify({
      workflow_runs: [{ id: 30680085299, name: 'CI', conclusion: 'success' }],
    }),
    'actions/runs/30680085299/jobs': JSON.stringify({
      jobs: [
        { id: 91315210076, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success', html_url: 'https://example.test/job' },
        { id: 91315210077, name: 'verify', run_attempt: 1, conclusion: 'success' },
      ],
    }),
  });

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.runInfo.run_id, 30680085299);
    assert.strictEqual(result.runInfo.job_id, 91315210076);
    assert.strictEqual(result.runInfo.target_head_sha, headSha);
    assert.strictEqual(result.runInfo.target_merge_sha, mergeSha);
  }
});

test('locateCiDbProofRun: no associated PR fails closed with no_pr_for_merge_sha (never invents a head SHA)', () => {
  const ghExecutor = fakeGhExecutor({ 'commits/': JSON.stringify([]) });
  const result = locateCiDbProofRun('deadbeef', { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_pr_for_merge_sha');
});

test('locateCiDbProofRun: no CI workflow run for the head SHA fails closed honestly (e.g. a T2/T3 lane with no DB proof job at all)', () => {
  const headSha = 'a'.repeat(40);
  const ghExecutor = fakeGhExecutor({
    'commits/': JSON.stringify([{ number: 1, head: { sha: headSha } }]),
    'actions/runs?head_sha=': JSON.stringify({ workflow_runs: [] }),
  });
  const result = locateCiDbProofRun('deadbeef', { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_ci_run_found');
});

test('locateCiDbProofRun: CI ran but never included the DB proof job fails closed honestly (genuine no-evidence case)', () => {
  const headSha = 'b'.repeat(40);
  const ghExecutor = fakeGhExecutor({
    'commits/': JSON.stringify([{ number: 1, head: { sha: headSha } }]),
    'actions/runs?head_sha=': JSON.stringify({ workflow_runs: [{ id: 999, name: 'CI', conclusion: 'success' }] }),
    'actions/runs/999/jobs': JSON.stringify({ jobs: [{ id: 1, name: 'verify', conclusion: 'success' }] }),
  });
  const result = locateCiDbProofRun('deadbeef', { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_db_proof_job');
});

// ── downloadCiDbProofReceipt / fetchCiDbProofJobLog: injected IO ──────────────

test('downloadCiDbProofReceipt: happy path finds the run-scoped artifact and extracts it via the injected zip extractor', () => {
  const runInfo = REAL_RUN_INFO;
  const artifactName = `utv2-1630-db-proof-receipt-${runInfo.run_id}-${runInfo.run_attempt}`;
  const ghExecutor = fakeGhExecutor({
    [`actions/runs/${runInfo.run_id}/artifacts`]: JSON.stringify({
      artifacts: [{ id: 8811926669, name: artifactName, expired: false }],
    }),
    [`actions/artifacts/8811926669/zip`]: 'FAKE_ZIP_BYTES',
  });
  const zipExtractor: ZipExtractor = (buffer, entryName) => {
    assert.strictEqual(buffer.toString('utf8'), 'FAKE_ZIP_BYTES');
    assert.strictEqual(entryName, 'ci-db-proof-receipt.json');
    return REAL_RECEIPT_RAW;
  };
  const result = downloadCiDbProofReceipt(runInfo, { ghExecutor, zipExtractor });
  assert.strictEqual(result.ok, true);
  if (result.ok) assert.strictEqual(result.raw, REAL_RECEIPT_RAW);
});

test('downloadCiDbProofReceipt: missing artifact fails closed with no_receipt_artifact', () => {
  const runInfo = REAL_RUN_INFO;
  const ghExecutor = fakeGhExecutor({
    [`actions/runs/${runInfo.run_id}/artifacts`]: JSON.stringify({ artifacts: [] }),
  });
  const result = downloadCiDbProofReceipt(runInfo, { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_receipt_artifact');
});

test('downloadCiDbProofReceipt: an expired artifact fails closed with artifact_expired', () => {
  const runInfo = REAL_RUN_INFO;
  const artifactName = `utv2-1630-db-proof-receipt-${runInfo.run_id}-${runInfo.run_attempt}`;
  const ghExecutor = fakeGhExecutor({
    [`actions/runs/${runInfo.run_id}/artifacts`]: JSON.stringify({
      artifacts: [{ id: 1, name: artifactName, expired: true }],
    }),
  });
  const result = downloadCiDbProofReceipt(runInfo, { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'artifact_expired');
});

test('fetchCiDbProofJobLog: happy path returns the raw log text', () => {
  const ghExecutor: GhExecutor = () => Buffer.from(REAL_JOB_LOG, 'utf8');
  const result = fetchCiDbProofJobLog(REAL_RUN_INFO, { ghExecutor });
  assert.strictEqual(result.ok, true);
  if (result.ok) assert.strictEqual(result.text, REAL_JOB_LOG);
});

test('fetchCiDbProofJobLog: a gh failure fails closed with job_log_fetch_failed', () => {
  const ghExecutor: GhExecutor = () => {
    throw Object.assign(new Error('boom'), { stderr: '404' });
  };
  const result = fetchCiDbProofJobLog(REAL_RUN_INFO, { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'job_log_fetch_failed');
});

// ── harvestCiDbProofForMergeSha: full end-to-end with every IO seam faked ─────

function fullHappyPathExecutor(): GhExecutor {
  const mergeSha = REAL_RUN_INFO.target_merge_sha;
  const headSha = REAL_RUN_INFO.target_head_sha;
  return (args: string[]) => {
    const key = args.join(' ');
    if (key.includes(`commits/${mergeSha}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 1343, head: { sha: headSha } }]));
    }
    if (key.includes(`actions/runs?head_sha=${headSha}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: REAL_RUN_INFO.run_id, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes(`actions/runs/${REAL_RUN_INFO.run_id}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [
            {
              id: REAL_RUN_INFO.job_id,
              name: 'Writable DB proof (staging only)',
              run_attempt: 1,
              conclusion: 'success',
              html_url: REAL_RUN_INFO.job_url,
            },
          ],
        }),
      );
    }
    if (key.includes(`actions/runs/${REAL_RUN_INFO.run_id}/artifacts`)) {
      return Buffer.from(
        JSON.stringify({ artifacts: [{ id: 8811926669, name: `utv2-1630-db-proof-receipt-${REAL_RUN_INFO.run_id}-1`, expired: false }] }),
      );
    }
    if (key.includes('actions/artifacts/8811926669/zip')) {
      return Buffer.from('FAKE_ZIP');
    }
    if (key.includes(`actions/jobs/${REAL_RUN_INFO.job_id}/logs`)) {
      return Buffer.from(REAL_JOB_LOG, 'utf8');
    }
    throw Object.assign(new Error(`fullHappyPathExecutor: unexpected call "${key}"`), { stderr: 'unexpected' });
  };
}

test('harvestCiDbProofForMergeSha: full pipeline, every IO seam faked with real captured data, produces a real non-empty runtime_proof', () => {
  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: fullHappyPathExecutor(),
    zipExtractor: () => REAL_RECEIPT_RAW,
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, true, !result.ok ? `${result.code}: ${result.reason}` : undefined);
  if (result.ok) {
    assert.strictEqual(result.runtimeProof.queries.length, 7);
    assert.strictEqual(result.runtimeProof.row_counts.length, 8);
    assert.strictEqual(result.runInfo.run_id, REAL_RUN_INFO.run_id);
  }
});

test('harvestCiDbProofForMergeSha: a merge SHA with no associated PR fails closed end-to-end (never fabricates)', () => {
  const ghExecutor: GhExecutor = () => Buffer.from(JSON.stringify([]));
  const result = harvestCiDbProofForMergeSha('0'.repeat(40), { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_pr_for_merge_sha');
});

test('harvestCiDbProofForMergeSha: a receipt whose identity does not match the located run is rejected (anti-substitution)', () => {
  const mismatched = { ...JSON.parse(REAL_RECEIPT_RAW), github_run_id: '99999999999' };
  const { receipt_sha256: _drop, ...withoutHash } = mismatched;
  mismatched.receipt_sha256 = sha256(JSON.stringify(withoutHash));

  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: fullHappyPathExecutor(),
    zipExtractor: () => JSON.stringify(mismatched),
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.code, 'receipt_invalid');
    assert.match(result.reason, /does not match the located run/);
  }
});
