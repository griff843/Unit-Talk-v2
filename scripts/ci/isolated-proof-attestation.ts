/**
 * UTV2-1630 — CI-produced database proof receipts.
 *
 * ## Why the first two attempts failed
 *
 * v1 emitted an "attestation" naming the project a DB command targeted, and the
 * gate re-derived its verdict from that field. Exact-head review showed the
 * hole immediately: the attestation was an unsigned line of text in a
 * hand-authored markdown file. Typing
 *
 *     [isolated-db-proof-attestation/v1] {"observedProjectRef":"aaaa…", …}
 *     # pass 12 / # fail 0 / # skipped 0
 *
 * yielded `{"verdict":"PASS"}` for a run that actually targeted production —
 * while an HONEST production receipt correctly failed. The gate blocked lanes
 * that told the truth and passed lanes that did not.
 *
 * That reproduced exactly what UTV2-1627 documented: a *declared* label
 * enforces nothing. Re-deriving the verdict from `observedProjectRef` rather
 * than `canonicalProduction` narrowed nothing, because both fields were
 * author-controlled.
 *
 * ## What makes a receipt trustworthy here
 *
 * Every field is observed at runtime by the job that ran the command, and the
 * auditor re-checks the ones that identify the run against ITS OWN environment:
 *
 *   - run id / attempt / sha / repository / workflow / job must equal the
 *     verifying process's own `GITHUB_*` values. A receipt copied from another
 *     run, or typed by hand, cannot match.
 *   - TAP counts are RE-PARSED from `captured_output`, never read from the
 *     declared counters — editing the counters changes nothing.
 *   - `output_sha256` binds the counters to the captured text; `receipt_sha256`
 *     binds the whole receipt.
 *   - the observed project ref must equal the expected staging ref and must not
 *     be the canonical production ref.
 *
 * Outside CI there is no run to bind to, so verification FAILS CLOSED. A local
 * PASS would be unverifiable by construction, which is the point.
 */
import { createHash } from 'node:crypto';

/**
 * ## Where the identity check lives now (UTV2-1628)
 *
 * `extractProjectRefFromUrl` / `isApprovedStagingTarget` and the two project
 * refs were defined in this file. UTV2-1628 needed the same check inside the
 * database client constructor in `packages/db`, and a package cannot import
 * from `scripts/`. Rather than write a second check — the failure mode this
 * whole area exists to prevent — the implementation moved to
 * `@unit-talk/db/target-identity` and is re-exported here unchanged.
 *
 * Every previous importer of this module still resolves to the same code, and
 * there is still exactly one place in the repository that decides what a
 * Supabase URL points at.
 */
export {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
  isLoopbackTarget,
} from '@unit-talk/db/target-identity';

import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  PROJECT_REF_PATTERN,
  extractProjectRefFromUrl,
} from '@unit-talk/db/target-identity';

export const RECEIPT_SCHEMA = 'ci-db-proof-receipt/v2';

export interface CiContext {
  repository: string | null;
  workflow: string | null;
  workflowRef: string | null;
  runId: string | null;
  runAttempt: string | null;
  job: string | null;
  sha: string | null;
  refName: string | null;
}

export interface TapCounts {
  tests: number | null;
  pass: number | null;
  fail: number | null;
  skipped: number | null;
}

export interface CiProofReceipt {
  schema: typeof RECEIPT_SCHEMA;
  repository: string | null;
  workflow: string | null;
  workflow_ref: string | null;
  github_run_id: string | null;
  github_run_attempt: string | null;
  github_job: string | null;
  github_sha: string | null;
  github_ref_name: string | null;
  command: string;
  started_at: string;
  finished_at: string;
  exit_code: number | null;
  observed_project_ref: string | null;
  observed_host: string | null;
  expected_staging_project_ref: string;
  canonical_production_project_ref: string;
  tap: TapCounts;
  captured_output: string;
  output_sha256: string;
  /**
   * The REPOSITORY's latest migration filename at the reviewed commit.
   *
   * Deliberately NOT called schema_migration_head: nothing here observes the
   * schema actually applied to staging, so naming it that would overclaim in a
   * receipt whose entire purpose is that its fields are observed rather than
   * asserted. Detecting staging drift is live-schema-parity's job.
   */
  repo_migration_head: string | null;
  fixture_run_id: string | null;
  cleanup_result: string | null;
  receipt_sha256?: string;
}

export interface ReceiptVerdict {
  ok: boolean;
  reason: string;
}

export function readCiContext(env: NodeJS.ProcessEnv = process.env): CiContext {
  return {
    repository: env['GITHUB_REPOSITORY'] ?? null,
    workflow: env['GITHUB_WORKFLOW'] ?? null,
    workflowRef: env['GITHUB_WORKFLOW_REF'] ?? null,
    runId: env['GITHUB_RUN_ID'] ?? null,
    runAttempt: env['GITHUB_RUN_ATTEMPT'] ?? null,
    job: env['GITHUB_JOB'] ?? null,
    sha: env['GITHUB_SHA'] ?? null,
    refName: env['GITHUB_REF_NAME'] ?? null,
  };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parse node:test TAP counters out of captured output. */
export function parseTapCounts(text: string): TapCounts {
  // Anchor to line start and take the LAST match. A lazy first-match search let
  // an earlier '# pass 99' block shadow the real summary, and loose leading
  // whitespace let indented prose parse as counters.
  const grab = (label: string): number | null => {
    const matches = [...text.matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gmu'))];
    const last = matches.at(-1);
    return last ? Number(last[1]) : null;
  };
  return {
    tests: grab('tests'),
    pass: grab('pass'),
    fail: grab('fail'),
    skipped: grab('skipped'),
  };
}

export function buildCiProofReceipt(input: {
  supabaseUrl: string | undefined;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  capturedOutput: string;
  repoMigrationHead?: string | null;
  fixtureRunId?: string | null;
  cleanupResult?: string | null;
  ci?: CiContext;
}): CiProofReceipt {
  const { projectRef, host } = extractProjectRefFromUrl(input.supabaseUrl);
  const ci = input.ci ?? readCiContext();
  const receipt: CiProofReceipt = {
    schema: RECEIPT_SCHEMA,
    repository: ci.repository,
    workflow: ci.workflow,
    workflow_ref: ci.workflowRef,
    github_run_id: ci.runId,
    github_run_attempt: ci.runAttempt,
    github_job: ci.job,
    github_sha: ci.sha,
    github_ref_name: ci.refName,
    command: input.command,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    exit_code: input.exitCode,
    observed_project_ref: projectRef,
    observed_host: host,
    expected_staging_project_ref: EXPECTED_STAGING_SUPABASE_PROJECT_REF,
    canonical_production_project_ref: CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
    tap: parseTapCounts(input.capturedOutput),
    captured_output: input.capturedOutput,
    output_sha256: sha256(input.capturedOutput),
    repo_migration_head: input.repoMigrationHead ?? null,
    fixture_run_id: input.fixtureRunId ?? null,
    cleanup_result: input.cleanupResult ?? null,
  };
  receipt.receipt_sha256 = sha256(JSON.stringify(receipt));
  return receipt;
}

export function serializeReceipt(receipt: CiProofReceipt): string {
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export interface VerifyOptions {
  ci?: CiContext;
  expectedStagingRef?: string;
  /** Required workflow/job identity, when the caller wants to pin them. */
  expectedWorkflow?: string | null;
  expectedJob?: string | null;
}

/**
 * Verify a CI-produced receipt. Fails closed on every ambiguous case.
 *
 * The declared TAP counters are never trusted: they are re-parsed from
 * `captured_output`, and `output_sha256` must match that text.
 */
export function verifyCiProofReceipt(
  raw: string,
  command: string,
  options: VerifyOptions = {},
): ReceiptVerdict {
  const ci = options.ci ?? readCiContext();
  const expectedStaging =
    options.expectedStagingRef ?? EXPECTED_STAGING_SUPABASE_PROJECT_REF;

  if (!ci.runId || !ci.sha) {
    return {
      ok: false,
      reason:
        `cannot verify DB proof for "${command}" outside GitHub Actions: no ` +
        'GITHUB_RUN_ID/GITHUB_SHA to bind against. DB proof is produced and ' +
        'validated inside CI by design.',
    };
  }

  let receipt: CiProofReceipt;
  try {
    receipt = JSON.parse(raw) as CiProofReceipt;
  } catch {
    return { ok: false, reason: 'receipt is not valid JSON' };
  }
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) {
    return { ok: false, reason: `receipt schema is not ${RECEIPT_SCHEMA}` };
  }
  if (receipt.command !== command) {
    return {
      ok: false,
      reason: `receipt is for "${receipt.command}", not "${command}"`,
    };
  }

  // Integrity: the whole receipt must hash to its recorded value.
  const declaredReceiptHash = receipt.receipt_sha256;
  const { receipt_sha256: _drop, ...withoutHash } = receipt;
  if (!declaredReceiptHash || sha256(JSON.stringify(withoutHash)) !== declaredReceiptHash) {
    return { ok: false, reason: 'receipt_sha256 does not match the receipt contents (modified receipt)' };
  }

  // Bind to THIS run. A hand-authored or reused receipt cannot match.
  const mismatches: string[] = [];
  if (receipt.github_run_id !== ci.runId) mismatches.push('github_run_id');
  if (receipt.github_run_attempt !== ci.runAttempt) mismatches.push('github_run_attempt');
  if (receipt.github_sha !== ci.sha) mismatches.push('github_sha');
  if (ci.repository && receipt.repository !== ci.repository) mismatches.push('repository');
  if (options.expectedWorkflow && receipt.workflow !== options.expectedWorkflow) {
    mismatches.push('workflow');
  }
  if (options.expectedJob && receipt.github_job !== options.expectedJob) {
    mismatches.push('github_job');
  }
  if (mismatches.length > 0) {
    return {
      ok: false,
      reason:
        `receipt is not bound to this CI run (mismatched: ${mismatches.join(', ')}). ` +
        `Expected run ${ci.runId} attempt ${ci.runAttempt ?? '?'} @ ${ci.sha}, got ` +
        `${receipt.github_run_id ?? 'none'} attempt ${receipt.github_run_attempt ?? '?'} @ ${receipt.github_sha ?? 'none'}.`,
    };
  }

  if (receipt.exit_code !== 0) {
    return { ok: false, reason: `command exited ${receipt.exit_code ?? 'null'}, not 0` };
  }

  // Captured output must match its hash, then be re-parsed for TAP.
  const captured = receipt.captured_output ?? '';
  if (!captured.trim()) {
    return { ok: false, reason: 'receipt has no captured_output' };
  }
  if (sha256(captured) !== receipt.output_sha256) {
    return { ok: false, reason: 'output_sha256 does not match captured_output (edited output)' };
  }

  const measured = parseTapCounts(captured);
  if (measured.pass === null || measured.fail === null || measured.skipped === null) {
    return {
      ok: false,
      reason:
        "captured_output has no node:test TAP summary (expected '# pass <n>', '# fail <n>', '# skipped <n>')",
    };
  }
  // Declared counters are advisory; a mismatch means the receipt was edited.
  if (
    receipt.tap?.pass !== measured.pass ||
    receipt.tap?.fail !== measured.fail ||
    receipt.tap?.skipped !== measured.skipped
  ) {
    return {
      ok: false,
      reason:
        `declared TAP counts do not match captured output (declared pass=${receipt.tap?.pass} ` +
        `fail=${receipt.tap?.fail} skipped=${receipt.tap?.skipped}; measured pass=${measured.pass} ` +
        `fail=${measured.fail} skipped=${measured.skipped})`,
    };
  }
  if (measured.fail !== 0) {
    return { ok: false, reason: `captured output reports ${measured.fail} failing tests` };
  }
  if (measured.pass < 1) {
    return { ok: false, reason: 'captured output reports zero passing tests' };
  }

  const ref = receipt.observed_project_ref;
  if (!ref || !PROJECT_REF_PATTERN.test(ref)) {
    return {
      ok: false,
      reason:
        `receipt could not positively identify a Supabase project (host: ` +
        `${receipt.observed_host ?? 'unparseable'}). A custom domain, pooler, or tunnel ` +
        'may front production, so the target is not provably isolated.',
    };
  }
  if (ref === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    return {
      ok: false,
      reason:
        `run targeted canonical production ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}. ` +
        'Production is never a valid proof target.',
    };
  }
  if (ref !== expectedStaging) {
    return {
      ok: false,
      reason: `run targeted ${ref}, which is not the expected staging project ${expectedStaging}`,
    };
  }

  return {
    ok: true,
    reason:
      `DB proof verified: run ${ci.runId} attempt ${ci.runAttempt ?? '1'} @ ${ci.sha}, ` +
      `target ${ref}, pass=${measured.pass} fail=${measured.fail} skipped=${measured.skipped}`,
  };
}
