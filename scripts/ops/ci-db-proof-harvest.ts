/**
 * scripts/ops/ci-db-proof-harvest.ts
 *
 * UTV2-1641 — automatic harvest of CI's genuine "Writable DB proof (staging
 * only)" evidence into an evidence.json's `runtime_proof.queries` /
 * `runtime_proof.row_counts`.
 *
 * ## The gap this closes
 *
 * Three T1 lanes today (UTV2-1632, UTV2-1613, UTV2-1594 -- five by the time this
 * lane started) each merged cleanly with CI's "Writable DB proof (staging only)"
 * job genuinely green, then had `ops:truth-check`'s R1/R2 checks fail post-merge:
 *
 *   [FAIL] R1 runtime_proof.queries must be non-empty
 *   [FAIL] R2 runtime_proof.row_counts must be non-empty
 *
 * The evidence existed the whole time -- in the `ci-db-proof-receipt/v2` artifact
 * CI's `staging-db-proof` job uploads, and in that same job's step logs -- but
 * nothing ever harvested it into evidence.json. Every lane's operator had to do
 * this by hand: download the receipt, read the job log, transcribe both into a
 * second follow-up PR. This module does that mechanically.
 *
 * ## What is, and is not, harvested
 *
 * `ci-db-proof-receipt/v2` (see scripts/ci/isolated-proof-attestation.ts) is a
 * tamper-evident record of a real `pnpm test:db` run: every field is either
 * observed by the job at runtime or re-derivable from `captured_output`, which is
 * bound to `output_sha256` and the whole receipt to `receipt_sha256`. This module
 * re-verifies all of that itself (`verifyHarvestedReceipt`) rather than trusting
 * the receipt's own declared fields -- the same trust model
 * `scripts/ci/verify-db-proof-receipt.ts` (the CI-time auditor) uses, MINUS the
 * "must equal THIS process's own GITHUB_RUN_ID" binding, which only makes sense
 * when verification happens inside the same run that produced the receipt. A
 * harvest, by definition, always happens later, in a different workflow run
 * (`post-merge-lane-close.yml`), so that specific binding is replaced here with:
 * the receipt names a real run/job/sha, which this module goes and finds and
 * cross-checks independently via the GitHub API, rather than accepting anything
 * about identity from the receipt's own text.
 *
 * `runtime_proof.queries` (per-test description + involved table names) and
 * `runtime_proof.row_counts` (seeded/reset row counts) are NOT already
 * structured fields on the receipt -- the receipt only carries the raw
 * `captured_output` of `pnpm test:db` and TAP pass/fail/skip counts. Building
 * the required `RuntimeProofFile` shape (scripts/ops/proof-repair.ts) therefore
 * requires two additional, purely mechanical derivations, never fabrication:
 *
 *   1. `queries`: every passing (`ok N - <description>`) TAP line in
 *      `captured_output` is real, re-parsed text from the actual run. The
 *      `table` field per query is derived by statically grepping THIS
 *      commit's own `apps/api/src/database-smoke.test.ts` source for literal
 *      `.from('<table>')` calls inside that specific test's body -- a
 *      mechanical, checked-in-source fact, not an inference. A test whose body
 *      has no literal `.from()` call (i.e. all its DB writes happen inside a
 *      service function this static pass does not trace into) is labelled
 *      exactly that, honestly, rather than guessing a table name.
 *   2. `row_counts`: the "Seed synthetic staging fixtures" step runs in the
 *      SAME job, immediately before the smoke-test step, and its plain
 *      `[seed-staging] ...` log lines report exact reset/upsert counts per
 *      table. Those lines are not part of the receipt artifact (they are a
 *      different step's stdout), so this module fetches that job's raw logs
 *      from the GitHub Actions API and re-parses them.
 *
 * If EITHER derivation comes up empty, or the receipt fails structural
 * verification, or no CI run/job/artifact can be located at all for the merge
 * SHA, this module returns a typed failure and nothing is written --
 * `ops:proof-generate` (the caller) must leave R1/R2 to fail honestly rather
 * than populate anything partial. See `harvestCiDbProofForMergeSha`'s doc
 * comment for the exhaustive failure-code list.
 *
 * ## Why the network/IO layer is injectable
 *
 * `GhExecutor` and `ZipExtractor` are injection seams (mirroring the `GitRunner`
 * pattern already used by `collectProofGitTruth` in proof-generate.ts) so the
 * pure decision logic in `locateCiDbProofRun` can be exercised in
 * `ci-db-proof-harvest.test.ts` against canned GitHub API responses --
 * including responses shaped exactly like the REAL ones this lane captured
 * from UTV2-1399's own merge (PR #1343, run 30680085299, job 91315210076) --
 * without making a live network call in every `pnpm test` run. The default
 * implementations shell out to the `gh` CLI exactly as
 * `scripts/ops/lane-close.ts`'s `fetchMergedPrInfo` already does elsewhere in
 * this codebase.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  parseTapCounts,
  RECEIPT_SCHEMA,
  sha256,
  type CiProofReceipt,
} from '../ci/isolated-proof-attestation.js';
import { ROOT } from './shared.js';

export const TRUSTED_HARVEST_REPOSITORY = 'griff843/Unit-Talk-v2';
export const DB_SMOKE_WORKFLOW_NAME = 'CI';
export const DB_SMOKE_JOB_NAME = 'Writable DB proof (staging only)';
export const DB_SMOKE_JOB_ID_NAME = 'staging-db-proof';
export const DB_SMOKE_TEST_FILE = 'apps/api/src/database-smoke.test.ts';
const SEED_STAGING_STEP_LOG_PREFIX = '[seed-staging]';

export interface RuntimeProofQuery {
  table: string;
  description: string;
}

export interface RuntimeProofRowCount {
  table: string;
  count: number;
  status: string;
}

export interface HarvestedCiRunInfo {
  workflow: string;
  job: string;
  run_id: number;
  run_attempt: number;
  job_id: number;
  job_url: string | null;
  target_head_sha: string;
  target_merge_sha: string;
  conclusion: string | null;
}

export interface HarvestedRuntimeProof {
  command: string;
  supabase_project: string;
  test_file: string;
  tests: number;
  pass: number;
  fail: number;
  queries: RuntimeProofQuery[];
  row_counts: RuntimeProofRowCount[];
  row_counts_captured_at?: string;
  row_counts_note: string;
  ci_run: HarvestedCiRunInfo;
  [key: string]: unknown;
}

export type HarvestFailureCode =
  | 'no_pr_for_merge_sha'
  | 'no_ci_run_found'
  | 'no_db_proof_job'
  | 'no_receipt_artifact'
  | 'artifact_expired'
  | 'artifact_download_failed'
  | 'receipt_invalid'
  | 'job_log_fetch_failed'
  | 'no_queries_derived'
  | 'no_row_counts_derived'
  | 'gh_api_error';

export type HarvestFailure = { ok: false; code: HarvestFailureCode; reason: string };
export type LocateResult = { ok: true; runInfo: HarvestedCiRunInfo } | HarvestFailure;
export type HarvestResult =
  | { ok: true; runtimeProof: HarvestedRuntimeProof; runInfo: HarvestedCiRunInfo }
  | HarvestFailure;

// ── structural receipt verification (no live-run identity binding) ───────────

/**
 * Structurally verifies a `ci-db-proof-receipt/v2` on its own terms: internal
 * hash integrity, TAP counts re-derived from `captured_output` (never trusting
 * the declared counters), a non-production staging target, and the presence of
 * the identity fields (`github_sha`/`github_run_id`/`github_job`) a caller needs
 * to cross-check against the GitHub API. Deliberately does NOT require the
 * receipt's `github_run_id`/`github_sha` to equal THIS process's own -- unlike
 * `scripts/ci/verify-db-proof-receipt.ts`, this always runs later, in a
 * different workflow run, so that binding is meaningless here. The caller
 * (`harvestCiDbProofForMergeSha`) independently confirms the receipt came from
 * the run/job it just located via the GitHub API, which is the equivalent trust
 * property for an out-of-band harvest.
 */
export function verifyHarvestedReceipt(
  raw: string,
  options: { expectedStagingRef?: string } = {},
): { ok: true; receipt: CiProofReceipt } | { ok: false; reason: string } {
  const expectedStaging = options.expectedStagingRef ?? EXPECTED_STAGING_SUPABASE_PROJECT_REF;

  let receipt: CiProofReceipt;
  try {
    receipt = JSON.parse(raw) as CiProofReceipt;
  } catch {
    return { ok: false, reason: 'receipt is not valid JSON' };
  }
  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, reason: 'receipt is not a JSON object' };
  }
  if (receipt.schema !== RECEIPT_SCHEMA) {
    return { ok: false, reason: `receipt schema is not ${RECEIPT_SCHEMA}` };
  }
  if (receipt.command !== 'pnpm test:db') {
    return { ok: false, reason: `receipt is for "${receipt.command}", not "pnpm test:db"` };
  }

  const declaredHash = receipt.receipt_sha256;
  const { receipt_sha256: _drop, ...withoutHash } = receipt;
  if (!declaredHash || sha256(JSON.stringify(withoutHash)) !== declaredHash) {
    return { ok: false, reason: 'receipt_sha256 does not match receipt contents (modified receipt)' };
  }

  if (receipt.exit_code !== 0) {
    return { ok: false, reason: `command exited ${receipt.exit_code ?? 'null'}, not 0` };
  }

  const captured = receipt.captured_output ?? '';
  if (!captured.trim()) {
    return { ok: false, reason: 'receipt has no captured_output' };
  }
  if (sha256(captured) !== receipt.output_sha256) {
    return { ok: false, reason: 'output_sha256 does not match captured_output (edited output)' };
  }

  const measured = parseTapCounts(captured);
  if (measured.pass === null || measured.fail === null || measured.skipped === null) {
    return { ok: false, reason: 'captured_output has no node:test TAP summary' };
  }
  if (
    receipt.tap?.pass !== measured.pass ||
    receipt.tap?.fail !== measured.fail ||
    receipt.tap?.skipped !== measured.skipped
  ) {
    return { ok: false, reason: 'declared TAP counts do not match captured output (edited receipt)' };
  }
  if (measured.fail !== 0) {
    return { ok: false, reason: `captured output reports ${measured.fail} failing tests` };
  }
  if (measured.pass < 1) {
    return { ok: false, reason: 'captured output reports zero passing tests' };
  }

  const ref = receipt.observed_project_ref;
  if (!ref) {
    return { ok: false, reason: 'receipt does not positively identify a Supabase project' };
  }
  if (ref === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    return { ok: false, reason: 'run targeted canonical production -- never a valid harvest source' };
  }
  if (ref !== expectedStaging) {
    return { ok: false, reason: `run targeted ${ref}, which is not the expected staging project ${expectedStaging}` };
  }

  if (!receipt.github_sha || !receipt.github_run_id || !receipt.github_job) {
    return { ok: false, reason: 'receipt is missing github_sha/github_run_id/github_job identity fields' };
  }

  return { ok: true, receipt };
}

// ── mechanical derivation: queries (TAP output x static table grep) ───────────

interface ParsedTapTest {
  n: number;
  description: string;
  durationMs: number | null;
}

/** Parses every PASSING (`ok N - <description>`) TAP test line out of real captured_output. */
export function parsePassingTapTests(capturedOutput: string): ParsedTapTest[] {
  const lines = capturedOutput.split('\n');
  const results: ParsedTapTest[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^ok (\d+) - (.+)$/.exec(lines[i]);
    if (!match) continue;
    let durationMs: number | null = null;
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j += 1) {
      if (/^(ok|not ok) \d+ - /.test(lines[j])) break;
      const durMatch = /^\s*duration_ms:\s*([\d.]+)\s*$/.exec(lines[j]);
      if (durMatch) {
        durationMs = Number(durMatch[1]);
        break;
      }
    }
    results.push({ n: Number(match[1]), description: match[2], durationMs });
  }
  return results;
}

/**
 * Statically greps `apps/api/src/database-smoke.test.ts`'s own source for the
 * literal `.from('<table>')` calls inside each `test('<description>', ...)`
 * block. Intentionally simple text slicing on the file's own consistent
 * `test(\n  '<description>',` convention -- not a full TS parse -- because the
 * mechanical fact this needs ("which table names appear literally in this
 * test's body") does not require one. A test whose real DB writes happen only
 * inside a service function (invisible to this grep) legitimately yields an
 * empty table list for that test; `buildRuntimeProofQueries` labels that
 * honestly rather than inventing a table name.
 */
export function extractTablesPerTestFromSource(testSourceText: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const testCallPattern = /\btest\(\s*\n?\s*['"]([^'"]+)['"]/g;
  const matches = [...testSourceText.matchAll(testCallPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const description = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? testSourceText.length : testSourceText.length;
    const body = testSourceText.slice(start, end);
    const tableMatches = [...body.matchAll(/\.from\(\s*['"]([a-zA-Z0-9_]+)['"]/g)];
    const tables = [...new Set(tableMatches.map((m) => m[1]))].sort();
    result.set(description, tables);
  }
  return result;
}

const NO_TABLE_LABEL = 'unknown (no literal .from() table reference found in test source)';

export function buildRuntimeProofQueries(
  capturedOutput: string,
  testSourceText: string,
): RuntimeProofQuery[] {
  const passing = parsePassingTapTests(capturedOutput);
  const tablesByDescription = extractTablesPerTestFromSource(testSourceText);
  return passing.map((t) => {
    const tables = tablesByDescription.get(t.description) ?? [];
    const table = tables.length > 0 ? tables.join(',') : NO_TABLE_LABEL;
    const durationSuffix = t.durationMs !== null ? `, ${t.durationMs.toFixed(2)}ms` : '';
    return {
      table,
      description: `${t.description} (ok ${t.n}${durationSuffix})`,
    };
  });
}

// ── mechanical derivation: row_counts (seed-staging step log) ─────────────────

const GHA_LOG_TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;

/**
 * Parses the `[seed-staging] ...` lines `scripts/ci/seed-staging-fixtures.ts`
 * prints -- verbatim, real strings that script emits, not derived or guessed --
 * out of the raw GitHub Actions job log (which prefixes every line with an ISO
 * timestamp; that prefix is stripped before matching).
 */
export function buildRuntimeProofRowCounts(jobLogText: string): RuntimeProofRowCount[] {
  const rowCounts: RuntimeProofRowCount[] = [];
  const lines = jobLogText.split('\n').map((line) => line.replace(GHA_LOG_TIMESTAMP_PREFIX, ''));
  for (const line of lines) {
    if (!line.startsWith(SEED_STAGING_STEP_LOG_PREFIX)) continue;
    const resetMatch = /^\[seed-staging\] reset (\S+): (\d+) row\(s\) deleted$/.exec(line);
    if (resetMatch) {
      rowCounts.push({ table: resetMatch[1], count: Number(resetMatch[2]), status: 'reset (rows deleted)' });
      continue;
    }
    const upsertMatch = /^\[seed-staging\] (?!reset\b)(\S+): (\d+) synthetic row\(s\) upserted$/.exec(line);
    if (upsertMatch) {
      rowCounts.push({
        table: upsertMatch[1],
        count: Number(upsertMatch[2]),
        status: 'upserted (synthetic reference rows)',
      });
    }
  }
  return rowCounts;
}

// ── combining the two mechanical derivations into a RuntimeProofFile ─────────

export function buildHarvestedRuntimeProof(input: {
  receipt: CiProofReceipt;
  testSourceText: string;
  jobLogText: string;
  runInfo: HarvestedCiRunInfo;
}): { ok: true; runtimeProof: HarvestedRuntimeProof } | HarvestFailure {
  const queries = buildRuntimeProofQueries(input.receipt.captured_output, input.testSourceText);
  if (queries.length === 0) {
    return {
      ok: false,
      code: 'no_queries_derived',
      reason:
        "no passing TAP tests could be parsed from the receipt's captured_output -- refusing to harvest an empty queries array",
    };
  }
  const rowCounts = buildRuntimeProofRowCounts(input.jobLogText);
  if (rowCounts.length === 0) {
    return {
      ok: false,
      code: 'no_row_counts_derived',
      reason:
        'no "[seed-staging] ..." row-count log lines were found in the job log -- refusing to harvest an empty row_counts array',
    };
  }
  const measured = parseTapCounts(input.receipt.captured_output);
  const runtimeProof: HarvestedRuntimeProof = {
    command: input.receipt.command,
    supabase_project: input.receipt.observed_project_ref ?? EXPECTED_STAGING_SUPABASE_PROJECT_REF,
    test_file: DB_SMOKE_TEST_FILE,
    tests: measured.tests ?? queries.length,
    pass: measured.pass ?? queries.length,
    fail: measured.fail ?? 0,
    queries,
    row_counts: rowCounts,
    row_counts_captured_at: input.receipt.finished_at,
    row_counts_note:
      "Harvested automatically by ops:proof-generate's CI-DB-proof auto-harvest (UTV2-1641) from the " +
      `"Seed synthetic staging fixtures" step's log of CI job "${input.runInfo.job}" (run ${input.runInfo.run_id}, ` +
      `job ${input.runInfo.job_id}), which ran immediately before the smoke-test step in the same job, on head ` +
      `${input.runInfo.target_head_sha}. Not re-run locally -- this host has no credential to staging ` +
      `${input.receipt.observed_project_ref ?? EXPECTED_STAGING_SUPABASE_PROJECT_REF}.`,
    ci_run: input.runInfo,
  };
  return { ok: true, runtimeProof };
}

// ── GitHub IO layer (injectable) ──────────────────────────────────────────────

/** Executes `gh` with the given args, returning raw stdout bytes. Throws on non-zero exit. */
export type GhExecutor = (args: string[]) => Buffer;

function defaultGhExecutor(args: string[]): Buffer {
  return execFileSync('gh', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 64,
  });
}

function tryGh(executor: GhExecutor, args: string[]): { ok: true; stdout: string } | { ok: false; reason: string } {
  try {
    return { ok: true, stdout: executor(args).toString('utf8') };
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : err.stderr) : '';
    return { ok: false, reason: (stderr || err.message || String(error)).trim() };
  }
}

/** Extracts a single named entry from a zip archive's raw bytes as UTF-8 text. */
export type ZipExtractor = (zipBuffer: Buffer, entryName: string) => string;

function defaultZipExtractor(zipBuffer: Buffer, entryName: string): string {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'utv2-1641-ci-db-proof-'));
  try {
    const zipPath = path.join(tmpDir, 'artifact.zip');
    writeFileSync(zipPath, zipBuffer);
    return execFileSync('unzip', ['-p', zipPath, entryName], { encoding: 'utf8' });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface HarvestIoOptions {
  repository?: string;
  ghExecutor?: GhExecutor;
  zipExtractor?: ZipExtractor;
}

interface GitHubPullRef {
  number?: number;
  head?: { sha?: string | null } | null;
}

interface GitHubWorkflowRun {
  id: number;
  name?: string | null;
  conclusion?: string | null;
}

interface GitHubWorkflowJob {
  id: number;
  name?: string | null;
  html_url?: string | null;
  run_attempt?: number | null;
  conclusion?: string | null;
}

interface GitHubArtifact {
  id: number;
  name?: string | null;
  expired?: boolean;
}

/**
 * Resolves a merge SHA to the CI run/job that actually produced its DB proof.
 *
 * GitHub does not re-run checks against a squash-merge commit -- they stay
 * associated with the PR's HEAD commit, which is a different SHA. So this:
 *   1. finds the PR associated with `mergeSha` (`commits/{sha}/pulls`) and reads
 *      its head SHA;
 *   2. lists workflow runs for that head SHA, filters to the `CI` workflow;
 *   3. lists that run's jobs and finds `"Writable DB proof (staging only)"`.
 *
 * Fails closed with a specific `HarvestFailureCode` at every step -- including,
 * legitimately, when CI genuinely never ran a DB proof for this lane (T2/T3
 * lanes, or a T1 lane whose CI run predates this job's existence).
 */
export function locateCiDbProofRun(mergeSha: string, options: HarvestIoOptions = {}): LocateResult {
  const repository = options.repository ?? TRUSTED_HARVEST_REPOSITORY;
  const executor = options.ghExecutor ?? defaultGhExecutor;

  const prsResult = tryGh(executor, ['api', `repos/${repository}/commits/${mergeSha}/pulls`]);
  if (!prsResult.ok) {
    return {
      ok: false,
      code: 'gh_api_error',
      reason: `could not resolve a pull request for merge SHA ${mergeSha}: ${prsResult.reason}`,
    };
  }
  let prs: GitHubPullRef[];
  try {
    prs = JSON.parse(prsResult.stdout) as GitHubPullRef[];
  } catch {
    return { ok: false, code: 'gh_api_error', reason: 'GitHub commits/{sha}/pulls response was not valid JSON' };
  }
  const headSha = prs[0]?.head?.sha ?? null;
  if (!headSha) {
    return {
      ok: false,
      code: 'no_pr_for_merge_sha',
      reason: `no pull request (with a head SHA) is associated with merge SHA ${mergeSha}`,
    };
  }

  const runsResult = tryGh(executor, ['api', `repos/${repository}/actions/runs?head_sha=${headSha}&per_page=20`]);
  if (!runsResult.ok) {
    return {
      ok: false,
      code: 'gh_api_error',
      reason: `could not list workflow runs for head SHA ${headSha}: ${runsResult.reason}`,
    };
  }
  let runsResponse: { workflow_runs?: GitHubWorkflowRun[] };
  try {
    runsResponse = JSON.parse(runsResult.stdout) as { workflow_runs?: GitHubWorkflowRun[] };
  } catch {
    return { ok: false, code: 'gh_api_error', reason: 'GitHub actions/runs response was not valid JSON' };
  }
  const candidateRuns = (runsResponse.workflow_runs ?? []).filter((run) => run.name === DB_SMOKE_WORKFLOW_NAME);
  if (candidateRuns.length === 0) {
    return {
      ok: false,
      code: 'no_ci_run_found',
      reason: `no "${DB_SMOKE_WORKFLOW_NAME}" workflow run found for head SHA ${headSha} -- CI may never have run for this lane`,
    };
  }
  // The GitHub API returns workflow runs newest-first.
  const run = candidateRuns[0];

  const jobsResult = tryGh(executor, ['api', `repos/${repository}/actions/runs/${run.id}/jobs`]);
  if (!jobsResult.ok) {
    return { ok: false, code: 'gh_api_error', reason: `could not list jobs for run ${run.id}: ${jobsResult.reason}` };
  }
  let jobsResponse: { jobs?: GitHubWorkflowJob[] };
  try {
    jobsResponse = JSON.parse(jobsResult.stdout) as { jobs?: GitHubWorkflowJob[] };
  } catch {
    return { ok: false, code: 'gh_api_error', reason: 'GitHub actions/runs/{id}/jobs response was not valid JSON' };
  }
  const job = (jobsResponse.jobs ?? []).find((j) => j.name === DB_SMOKE_JOB_NAME);
  if (!job) {
    return {
      ok: false,
      code: 'no_db_proof_job',
      reason: `no "${DB_SMOKE_JOB_NAME}" job found in run ${run.id} -- CI never ran a live DB proof for this lane`,
    };
  }

  return {
    ok: true,
    runInfo: {
      workflow: DB_SMOKE_WORKFLOW_NAME,
      job: DB_SMOKE_JOB_NAME,
      run_id: run.id,
      run_attempt: job.run_attempt ?? 1,
      job_id: job.id,
      job_url: job.html_url ?? null,
      target_head_sha: headSha,
      target_merge_sha: mergeSha,
      conclusion: job.conclusion ?? null,
    },
  };
}

export function downloadCiDbProofReceipt(
  runInfo: HarvestedCiRunInfo,
  options: HarvestIoOptions = {},
): { ok: true; raw: string } | HarvestFailure {
  const repository = options.repository ?? TRUSTED_HARVEST_REPOSITORY;
  const executor = options.ghExecutor ?? defaultGhExecutor;
  const extractor = options.zipExtractor ?? defaultZipExtractor;
  const artifactName = `utv2-1630-db-proof-receipt-${runInfo.run_id}-${runInfo.run_attempt}`;

  const artifactsResult = tryGh(executor, ['api', `repos/${repository}/actions/runs/${runInfo.run_id}/artifacts`]);
  if (!artifactsResult.ok) {
    return {
      ok: false,
      code: 'gh_api_error',
      reason: `could not list artifacts for run ${runInfo.run_id}: ${artifactsResult.reason}`,
    };
  }
  let artifactsResponse: { artifacts?: GitHubArtifact[] };
  try {
    artifactsResponse = JSON.parse(artifactsResult.stdout) as { artifacts?: GitHubArtifact[] };
  } catch {
    return { ok: false, code: 'gh_api_error', reason: 'GitHub artifacts response was not valid JSON' };
  }
  const artifact = (artifactsResponse.artifacts ?? []).find((a) => a.name === artifactName);
  if (!artifact) {
    return {
      ok: false,
      code: 'no_receipt_artifact',
      reason: `no artifact named "${artifactName}" found on run ${runInfo.run_id}`,
    };
  }
  if (artifact.expired) {
    return {
      ok: false,
      code: 'artifact_expired',
      reason: `artifact "${artifactName}" has expired and can no longer be downloaded`,
    };
  }

  try {
    const zipBuffer = executor(['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`]);
    const raw = extractor(zipBuffer, 'ci-db-proof-receipt.json');
    return { ok: true, raw };
  } catch (error) {
    return {
      ok: false,
      code: 'artifact_download_failed',
      reason: `failed to download/extract receipt artifact ${artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function fetchCiDbProofJobLog(
  runInfo: HarvestedCiRunInfo,
  options: HarvestIoOptions = {},
): { ok: true; text: string } | HarvestFailure {
  const repository = options.repository ?? TRUSTED_HARVEST_REPOSITORY;
  const executor = options.ghExecutor ?? defaultGhExecutor;
  const result = tryGh(executor, ['api', `repos/${repository}/actions/jobs/${runInfo.job_id}/logs`]);
  if (!result.ok) {
    return {
      ok: false,
      code: 'job_log_fetch_failed',
      reason: `failed to fetch job log for job ${runInfo.job_id}: ${result.reason}`,
    };
  }
  return { ok: true, text: result.stdout };
}

// ── top-level orchestrator ────────────────────────────────────────────────────

export interface HarvestCiDbProofOptions extends HarvestIoOptions {
  /** Overrides reading `apps/api/src/database-smoke.test.ts` from `root`. Exists for tests. */
  testSourceText?: string;
  root?: string;
}

/**
 * End-to-end: merge SHA in, a real `HarvestedRuntimeProof` (or a specific,
 * honest failure) out. Never fabricates: every failure path leaves R1/R2 to
 * fail on their own genuine terms.
 */
export function harvestCiDbProofForMergeSha(mergeSha: string, options: HarvestCiDbProofOptions = {}): HarvestResult {
  const located = locateCiDbProofRun(mergeSha, options);
  if (!located.ok) {
    return located;
  }
  const runInfo = located.runInfo;

  const receiptDownload = downloadCiDbProofReceipt(runInfo, options);
  if (!receiptDownload.ok) {
    return receiptDownload;
  }

  const verified = verifyHarvestedReceipt(receiptDownload.raw);
  if (!verified.ok) {
    return { ok: false, code: 'receipt_invalid', reason: verified.reason };
  }
  // The receipt must actually be the one from the run/job this function just
  // located -- otherwise a stale or substituted artifact could be harvested as
  // if it belonged to this merge SHA.
  if (
    String(verified.receipt.github_run_id) !== String(runInfo.run_id) ||
    verified.receipt.github_job !== DB_SMOKE_JOB_ID_NAME ||
    verified.receipt.github_sha !== runInfo.target_head_sha
  ) {
    return {
      ok: false,
      code: 'receipt_invalid',
      reason:
        `downloaded receipt identity (run=${verified.receipt.github_run_id}, job=${verified.receipt.github_job}, ` +
        `sha=${verified.receipt.github_sha}) does not match the located run (run=${runInfo.run_id}, ` +
        `job=${DB_SMOKE_JOB_ID_NAME}, sha=${runInfo.target_head_sha})`,
    };
  }

  const jobLog = fetchCiDbProofJobLog(runInfo, options);
  if (!jobLog.ok) {
    return jobLog;
  }

  const testSourceText =
    options.testSourceText ?? readFileSync(path.join(options.root ?? ROOT, DB_SMOKE_TEST_FILE), 'utf8');

  const built = buildHarvestedRuntimeProof({
    receipt: verified.receipt,
    testSourceText,
    jobLogText: jobLog.text,
    runInfo,
  });
  if (!built.ok) {
    return built;
  }

  return { ok: true, runtimeProof: built.runtimeProof, runInfo };
}
