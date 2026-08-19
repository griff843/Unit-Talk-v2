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
/**
 * The receipt fixture's `github_sha`. Captured from a `pull_request` run
 * (`github_ref_name: 1343/merge`), so this is GitHub's synthetic merge-ref
 * commit, NOT the PR head. Confirmed against the live API:
 *
 *   b36840e4 = "Merge 4aaa6c56 into f4c529b5", parents [f4c529b5, 4aaa6c56]
 *
 * UTV2-1683: `REAL_RUN_INFO.target_head_sha` used to be set to THIS value,
 * which is what let the old `receipt.github_sha === target_head_sha` identity
 * check pass in tests while failing for every real lane. In production
 * `locateCiDbProofRun` fills `target_head_sha` from the actual PR head
 * (4aaa6c56), so the two were never equal outside this fixture. The fixture
 * now models reality and the merge-ref relationship is proven explicitly.
 */
const REAL_MERGE_REF_SHA = 'b36840e452333cb605e1d0c61f3aec547e50be3d';
/** PR #1343's true head commit — the second parent of REAL_MERGE_REF_SHA. */
const REAL_PR_HEAD_SHA = '4aaa6c56d3f741b7bcc9ae9cd17c1478120f3772';
/** PR #1343's base at the time the merge ref was built — the FIRST parent. */
const REAL_MERGE_REF_BASE_SHA = 'f4c529b51267d86c2dfbd38bdcfab527bd31668c';

const REAL_RUN_INFO: HarvestedCiRunInfo = {
  workflow: 'CI',
  job: 'Writable DB proof (staging only)',
  run_id: 30680085299,
  run_attempt: 1,
  job_id: 91315210076,
  job_url: 'https://github.com/griff843/Unit-Talk-v2/actions/runs/30680085299/job/91315210076',
  target_head_sha: REAL_PR_HEAD_SHA,
  target_merge_sha: 'fdc193582f94ad7538fa594b475847eb81a3647f',
  conclusion: 'success',
  identity_source: 'pr_head_run',
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

test('locateCiDbProofRun: falls back to PR -> head SHA -> CI run -> DB proof job when the merge SHA has no push run', () => {
  const mergeSha = 'fdc193582f94ad7538fa594b475847eb81a3647f';
  const headSha = REAL_PR_HEAD_SHA;
  const ghExecutor = fakeGhExecutor({
    // The merge commit itself has no CI run (e.g. a proof-only merge that
    // ci.yml skipped via paths-ignore), so the lookup falls through.
    [`actions/workflows/ci.yml/runs?head_sha=${mergeSha}`]: JSON.stringify({ workflow_runs: [] }),
    [`commits/${mergeSha}/pulls`]: JSON.stringify([{ number: 1343, head: { sha: headSha } }]),
    [`actions/workflows/ci.yml/runs?head_sha=${headSha}`]: JSON.stringify({
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
    assert.strictEqual(result.runInfo.identity_source, 'pr_head_run');
  }
});

test('locateCiDbProofRun: UTV2-1683 A1 prefers the merge SHA\'s own push run and binds identity to the merge SHA', () => {
  const mergeSha = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
  const ghExecutor = fakeGhExecutor({
    [`actions/workflows/ci.yml/runs?head_sha=${mergeSha}`]: JSON.stringify({
      workflow_runs: [{ id: 31276897581, name: 'CI', conclusion: 'success' }],
    }),
    'actions/runs/31276897581/jobs': JSON.stringify({
      jobs: [
        { id: 93151835178, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success', html_url: 'https://example.test/job' },
      ],
    }),
  });

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, true, !result.ok ? `${result.code}: ${result.reason}` : undefined);
  if (result.ok) {
    assert.strictEqual(result.runInfo.run_id, 31276897581);
    assert.strictEqual(result.runInfo.identity_source, 'merge_sha_run');
    // The whole point: the target IS the merge SHA, so the receipt binds to
    // the implementation tree with no indirection.
    assert.strictEqual(result.runInfo.target_head_sha, mergeSha);
    assert.strictEqual(result.runInfo.target_merge_sha, mergeSha);
  }
});

test('locateCiDbProofRun: UTV2-1683 A1 never resolves the PR when a merge-SHA run exists (no commits/pulls call at all)', () => {
  const mergeSha = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
  const calls: string[] = [];
  const ghExecutor: GhExecutor = (args) => {
    const key = args.join(' ');
    calls.push(key);
    if (key.includes(`actions/workflows/ci.yml/runs?head_sha=${mergeSha}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: 31276897581, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes('actions/runs/31276897581/jobs')) {
      return Buffer.from(
        JSON.stringify({ jobs: [{ id: 93151835178, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success' }] }),
      );
    }
    throw Object.assign(new Error(`unexpected call "${key}"`), { stderr: 'unexpected' });
  };

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, true);
  assert.ok(
    !calls.some((call) => call.includes('/pulls')),
    `the PR fallback must not run when a merge-SHA run exists; calls were ${JSON.stringify(calls)}`,
  );
});

test('locateCiDbProofRun: UTV2-1683 a transport failure on the merge-SHA lookup fails closed instead of silently using the weaker PR path', () => {
  const mergeSha = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
  const headSha = REAL_PR_HEAD_SHA;
  // A fully working PR fallback IS available. That is the point of the test:
  // without the fail-closed branch this executor would happily resolve a
  // pr_head_run result, so the assertion below only holds if a transport
  // error genuinely stops the downgrade.
  const ghExecutor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${mergeSha}`)) {
      throw Object.assign(new Error('500'), { stderr: 'server error' });
    }
    if (key.includes(`commits/${mergeSha}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 1343, head: { sha: headSha } }]));
    }
    if (key.includes(`head_sha=${headSha}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: 30680085299, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes('actions/runs/30680085299/jobs')) {
      return Buffer.from(
        JSON.stringify({
          jobs: [{ id: 91315210076, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success' }],
        }),
      );
    }
    throw Object.assign(new Error(`unexpected call "${key}"`), { stderr: 'unexpected' });
  };

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, false, 'an unreadable merge-SHA lookup must not fall back to the weaker PR binding');
  if (!result.ok) assert.strictEqual(result.code, 'gh_api_error');
});

test('locateCiDbProofRun: UTV2-1646 regression queries ci.yml directly when CI is item 21 of 25 repository-wide runs', () => {
  // Real captured identity from UTV2-1646 / PR #1356. GitHub's unfiltered
  // actions/runs response contained 25 runs for this exact head SHA; CI run
  // 30704058474 was item 21, outside the old per_page=20 lookup. The
  // workflow-specific endpoint returns the same completed CI run directly.
  const mergeSha = '6adaa5d08016971f90ba4cac68bad23e894555a5';
  const headSha = '37f0c092a7903af2db49ad5f53ce04a039ca6088';
  const ciRunId = 30704058474;
  const dbProofJobId = 91379988421;
  const unrelatedRuns = Array.from({ length: 20 }, (_, index) => ({
    id: 30704449052 - index,
    name: `Unrelated workflow ${index + 1}`,
    conclusion: 'success',
  }));
  const ghExecutor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${mergeSha}`)) {
      // No push run for the merge commit itself; fall through to the PR path.
      return Buffer.from(JSON.stringify({ workflow_runs: [] }));
    }
    if (key.includes(`commits/${mergeSha}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 1356, head: { sha: headSha } }]));
    }
    if (key.includes(`actions/workflows/ci.yml/runs?head_sha=${headSha}`)) {
      return Buffer.from(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [{ id: ciRunId, name: 'CI', conclusion: 'success' }],
        }),
      );
    }
    if (key.includes(`actions/runs?head_sha=${headSha}`)) {
      // This is what the old repository-wide per_page=20 query saw: no CI.
      return Buffer.from(JSON.stringify({ total_count: 25, workflow_runs: unrelatedRuns }));
    }
    if (key.includes(`actions/runs/${ciRunId}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [
            {
              id: dbProofJobId,
              name: 'Writable DB proof (staging only)',
              run_attempt: 1,
              conclusion: 'success',
              html_url: `https://github.com/griff843/Unit-Talk-v2/actions/runs/${ciRunId}/job/${dbProofJobId}`,
            },
          ],
        }),
      );
    }
    throw Object.assign(new Error(`unexpected GitHub request: ${key}`), { stderr: 'not found' });
  };

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.runInfo.run_id, ciRunId);
    assert.strictEqual(result.runInfo.job_id, dbProofJobId);
    assert.strictEqual(result.runInfo.target_head_sha, headSha);
    assert.strictEqual(result.runInfo.target_merge_sha, mergeSha);
  }
});

test('locateCiDbProofRun: falls back to a 100-run repository page when the workflow-specific endpoint is unavailable', () => {
  const mergeSha = 'c'.repeat(40);
  const headSha = 'd'.repeat(40);
  const ciRunId = 12345;
  const dbProofJobId = 67890;
  const ghExecutor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${mergeSha}`)) {
      // No push run for the merge commit itself; fall through to the PR path.
      return Buffer.from(JSON.stringify({ workflow_runs: [] }));
    }
    if (key.includes(`commits/${mergeSha}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 99, head: { sha: headSha } }]));
    }
    if (key.includes(`actions/workflows/ci.yml/runs?head_sha=${headSha}&per_page=100`)) {
      throw Object.assign(new Error('workflow endpoint unavailable'), { stderr: 'not found' });
    }
    if (key.includes(`actions/runs?head_sha=${headSha}&per_page=100`)) {
      return Buffer.from(
        JSON.stringify({ workflow_runs: [{ id: ciRunId, name: 'CI', conclusion: 'success' }] }),
      );
    }
    if (key.includes(`actions/runs/${ciRunId}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [{ id: dbProofJobId, name: 'Writable DB proof (staging only)', conclusion: 'success' }],
        }),
      );
    }
    throw Object.assign(new Error(`unexpected GitHub request: ${key}`), { stderr: 'not found' });
  };

  const result = locateCiDbProofRun(mergeSha, { ghExecutor });
  assert.strictEqual(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.runInfo.run_id, ciRunId);
    assert.strictEqual(result.runInfo.job_id, dbProofJobId);
  }
});

test('locateCiDbProofRun: no associated PR fails closed with no_pr_for_merge_sha (never invents a head SHA)', () => {
  const ghExecutor = fakeGhExecutor({
    'actions/workflows/ci.yml/runs?head_sha=': JSON.stringify({ workflow_runs: [] }),
    'commits/': JSON.stringify([]),
  });
  const result = locateCiDbProofRun('deadbeef', { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_pr_for_merge_sha');
});

test('locateCiDbProofRun: no CI workflow run for the head SHA fails closed honestly (e.g. a T2/T3 lane with no DB proof job at all)', () => {
  const headSha = 'a'.repeat(40);
  const ghExecutor = fakeGhExecutor({
    'commits/': JSON.stringify([{ number: 1, head: { sha: headSha } }]),
    'actions/workflows/ci.yml/runs?head_sha=': JSON.stringify({ workflow_runs: [] }),
  });
  const result = locateCiDbProofRun('deadbeef', { ghExecutor });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'no_ci_run_found');
});

test('locateCiDbProofRun: CI ran but never included the DB proof job fails closed honestly (genuine no-evidence case)', () => {
  const headSha = 'b'.repeat(40);
  const ghExecutor = fakeGhExecutor({
    'commits/': JSON.stringify([{ number: 1, head: { sha: headSha } }]),
    'actions/workflows/ci.yml/runs?head_sha=': JSON.stringify({
      workflow_runs: [{ id: 999, name: 'CI', conclusion: 'success' }],
    }),
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

test('fetchCiDbProofJobLog: retries with --allow-escape-sequences when gh refuses ANSI output', () => {
  const calls: string[][] = [];
  const ghExecutor: GhExecutor = (args) => {
    calls.push(args);
    if (!args.includes('--allow-escape-sequences')) {
      throw Object.assign(new Error('refused'), {
        stderr: 'the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway',
      });
    }
    return Buffer.from(REAL_JOB_LOG, 'utf8');
  };
  const result = fetchCiDbProofJobLog(REAL_RUN_INFO, { ghExecutor });
  assert.strictEqual(result.ok, true, !result.ok ? result.reason : undefined);
  if (result.ok) assert.strictEqual(result.text, REAL_JOB_LOG);
  assert.strictEqual(calls.length, 2, 'plain call first, then the flagged retry');
  assert.ok(!calls[0].includes('--allow-escape-sequences'), 'older gh must still get the plain call');
});

test('fetchCiDbProofJobLog: does NOT retry with the flag for an unrelated failure', () => {
  const calls: string[][] = [];
  const ghExecutor: GhExecutor = (args) => {
    calls.push(args);
    throw Object.assign(new Error('404'), { stderr: 'Not Found' });
  };
  const result = fetchCiDbProofJobLog(REAL_RUN_INFO, { ghExecutor });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(calls.length, 1, 'a 404 must not be retried as if it were an ANSI refusal');
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
    if (key.includes(`head_sha=${mergeSha}`)) {
      // This fixture is a pull_request run, so the merge commit has no run of
      // its own and the PR fallback (plus A2's ancestry proof) is exercised.
      return Buffer.from(JSON.stringify({ workflow_runs: [] }));
    }
    // A2: GitHub's answer proving the receipt's merge-ref SHA descends from
    // the PR head as its second parent.
    if (key.includes(`commits/${REAL_MERGE_REF_SHA}`) && !key.includes('/pulls')) {
      return Buffer.from(
        JSON.stringify({
          sha: REAL_MERGE_REF_SHA,
          parents: [{ sha: REAL_MERGE_REF_BASE_SHA }, { sha: headSha }],
        }),
      );
    }
    if (key.includes(`commits/${mergeSha}/pulls`)) {
      return Buffer.from(JSON.stringify([{ number: 1343, head: { sha: headSha } }]));
    }
    if (key.includes(`actions/workflows/ci.yml/runs?head_sha=${headSha}`)) {
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

// ── UTV2-1683: SHA-binding regression coverage (PM-specified) ─────────────────

/** Re-seals a mutated receipt so it fails on identity, not on its hash. */
function reseal(receipt: Record<string, unknown>): string {
  const { receipt_sha256: _drop, ...withoutHash } = receipt;
  return JSON.stringify({ ...receipt, receipt_sha256: sha256(JSON.stringify(withoutHash)) });
}

const MERGE_SHA_RUN_ID = 31276897581;
const MERGE_SHA_JOB_ID = 93151835178;

/**
 * A1 world: the merge commit has its own push-triggered CI run, so the receipt
 * records the merge SHA directly.
 */
function mergeShaRunExecutor(mergeSha: string): GhExecutor {
  return (args: string[]) => {
    const key = args.join(' ');
    if (key.includes(`head_sha=${mergeSha}`)) {
      return Buffer.from(JSON.stringify({ workflow_runs: [{ id: MERGE_SHA_RUN_ID, name: 'CI', conclusion: 'success' }] }));
    }
    if (key.includes(`actions/runs/${MERGE_SHA_RUN_ID}/jobs`)) {
      return Buffer.from(
        JSON.stringify({
          jobs: [{ id: MERGE_SHA_JOB_ID, name: 'Writable DB proof (staging only)', run_attempt: 1, conclusion: 'success' }],
        }),
      );
    }
    if (key.includes(`actions/runs/${MERGE_SHA_RUN_ID}/artifacts`)) {
      return Buffer.from(
        JSON.stringify({ artifacts: [{ id: 9027325270, name: `utv2-1630-db-proof-receipt-${MERGE_SHA_RUN_ID}-1`, expired: false }] }),
      );
    }
    if (key.includes('actions/artifacts/9027325270/zip')) return Buffer.from('FAKE_ZIP');
    if (key.includes(`actions/jobs/${MERGE_SHA_JOB_ID}/logs`)) return Buffer.from(REAL_JOB_LOG, 'utf8');
    throw Object.assign(new Error(`mergeShaRunExecutor: unexpected call "${key}"`), { stderr: 'unexpected' });
  };
}

// (1) Receipt mismatch rejection — an incorrect github_sha must fail.
test('UTV2-1683 regression 1: a receipt whose github_sha is not the target implementation SHA is REJECTED', () => {
  const mergeSha = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
  const wrongSha = { ...JSON.parse(REAL_RECEIPT_RAW), github_run_id: String(MERGE_SHA_RUN_ID), github_sha: 'f'.repeat(40) };

  const result = harvestCiDbProofForMergeSha(mergeSha, {
    ghExecutor: mergeShaRunExecutor(mergeSha),
    zipExtractor: () => reseal(wrongSha),
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, false, 'a receipt bound to an unrelated SHA must never be harvested');
  if (!result.ok) {
    assert.strictEqual(result.code, 'receipt_invalid');
    assert.match(result.reason, /must bind exactly/);
  }
});

// (2) Exact merge SHA acceptance — receipt SHA === target merge SHA passes.
test('UTV2-1683 regression 2: a receipt whose github_sha IS the merge SHA is ACCEPTED and binds runtime_proof to it', () => {
  const mergeSha = '20505c8e7f0ee3ddd89f599c99d0b8af55836fde';
  const exact = { ...JSON.parse(REAL_RECEIPT_RAW), github_run_id: String(MERGE_SHA_RUN_ID), github_sha: mergeSha };

  const result = harvestCiDbProofForMergeSha(mergeSha, {
    ghExecutor: mergeShaRunExecutor(mergeSha),
    zipExtractor: () => reseal(exact),
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, true, !result.ok ? `${result.code}: ${result.reason}` : undefined);
  if (result.ok) {
    assert.strictEqual(result.runInfo.identity_source, 'merge_sha_run');
    assert.strictEqual(result.runInfo.target_merge_sha, mergeSha);
    assert.strictEqual(result.runInfo.target_head_sha, mergeSha);
    assert.ok(result.runtimeProof.queries.length > 0, 'runtime_proof.queries must be non-empty');
    assert.ok(result.runtimeProof.row_counts.length > 0, 'runtime_proof.row_counts must be non-empty');
  }
});

// (3) Merge-ref fallback — succeeds ONLY when the second-parent relationship
//     proves identity.
test('UTV2-1683 regression 3a: the merge-ref fallback is ACCEPTED when the second parent IS the PR head', () => {
  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: fullHappyPathExecutor(),
    zipExtractor: () => REAL_RECEIPT_RAW,
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, true, !result.ok ? `${result.code}: ${result.reason}` : undefined);
  if (result.ok) {
    assert.strictEqual(result.runInfo.identity_source, 'pr_head_run');
    // The receipt SHA is the merge ref, which is NOT the head — acceptance
    // came from proving ancestry, not from a loosened comparison.
    assert.notStrictEqual(REAL_MERGE_REF_SHA, result.runInfo.target_head_sha);
  }
});

test('UTV2-1683 regression 3b: the merge-ref fallback is REJECTED when the second parent is a different head (substitution)', () => {
  const executor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`commits/${REAL_MERGE_REF_SHA}`) && !key.includes('/pulls')) {
      // Same merge-ref SHA, but it descends from somebody else's head.
      return Buffer.from(
        JSON.stringify({ sha: REAL_MERGE_REF_SHA, parents: [{ sha: REAL_MERGE_REF_BASE_SHA }, { sha: '9'.repeat(40) }] }),
      );
    }
    return fullHappyPathExecutor()(args);
  };

  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: executor,
    zipExtractor: () => REAL_RECEIPT_RAW,
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, false, 'a merge ref belonging to a different head must never be harvested');
  if (!result.ok) {
    assert.strictEqual(result.code, 'receipt_invalid');
    assert.match(result.reason, /second parent is/);
  }
});

test('UTV2-1683 regression 3c: the merge-ref fallback is REJECTED when the receipt SHA is not a merge commit at all', () => {
  const executor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`commits/${REAL_MERGE_REF_SHA}`) && !key.includes('/pulls')) {
      // An ordinary single-parent commit cannot be a pull_request merge ref.
      return Buffer.from(JSON.stringify({ sha: REAL_MERGE_REF_SHA, parents: [{ sha: REAL_MERGE_REF_BASE_SHA }] }));
    }
    return fullHappyPathExecutor()(args);
  };

  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: executor,
    zipExtractor: () => REAL_RECEIPT_RAW,
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.code, 'receipt_invalid');
    assert.match(result.reason, /not a pull_request merge ref/);
  }
});

test('UTV2-1683 regression 3d: the merge-ref fallback fails closed when ancestry cannot be read (never assumes identity)', () => {
  const executor: GhExecutor = (args) => {
    const key = args.join(' ');
    if (key.includes(`commits/${REAL_MERGE_REF_SHA}`) && !key.includes('/pulls')) {
      throw Object.assign(new Error('500'), { stderr: 'server error' });
    }
    return fullHappyPathExecutor()(args);
  };

  const result = harvestCiDbProofForMergeSha(REAL_RUN_INFO.target_merge_sha, {
    ghExecutor: executor,
    zipExtractor: () => REAL_RECEIPT_RAW,
    testSourceText: REAL_TEST_SOURCE,
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.strictEqual(result.code, 'gh_api_error');
});
