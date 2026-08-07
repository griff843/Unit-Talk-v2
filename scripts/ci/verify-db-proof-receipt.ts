/**
 * UTV2-1630 — Proof Auditor entrypoint for CI-produced DB proof receipts.
 *
 * Runs in a job that `needs:` the database job and downloads its artifact from
 * the SAME workflow run. Verification is deliberately hostile to the receipt:
 * run identity is compared against this process's own `GITHUB_*` values, TAP
 * counts are re-parsed from the captured output rather than read from the
 * declared counters, and both the output and the receipt must match their
 * recorded hashes.
 *
 * Fails closed when the artifact is absent, so deleting the upload step turns
 * the gate red rather than silently green.
 */
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  readCiContext,
  verifyCiProofReceipt,
} from './isolated-proof-attestation.js';

interface Options {
  receiptPath: string | null;
  command: string;
  expectedWorkflow: string | null;
  expectedJob: string | null;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    receiptPath: null,
    command: 'pnpm test:db',
    expectedWorkflow: null,
    expectedJob: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--receipt') { options.receiptPath = argv[i + 1] ?? null; i += 1; continue; }
    if (arg === '--command') { options.command = argv[i + 1] ?? options.command; i += 1; continue; }
    if (arg === '--expect-workflow') { options.expectedWorkflow = argv[i + 1] ?? null; i += 1; continue; }
    if (arg === '--expect-job') { options.expectedJob = argv[i + 1] ?? null; i += 1; continue; }
    if (arg === '--json') options.json = true;
  }
  return options;
}

export interface AuditResult {
  verdict: 'PASS' | 'FAIL';
  reason: string;
  receiptPath: string | null;
  observedProjectRef?: string | null;
  runId?: string | null;
}

export function auditReceiptFile(options: Options): AuditResult {
  if (!options.receiptPath) {
    return { verdict: 'FAIL', reason: 'missing required --receipt <path>', receiptPath: null };
  }
  if (!existsSync(options.receiptPath)) {
    // The artifact never arrived. Absence is a failure, never a pass.
    return {
      verdict: 'FAIL',
      reason:
        `receipt artifact not found at ${options.receiptPath}. The database job must ` +
        'upload its receipt as a same-run artifact; a missing artifact fails closed.',
      receiptPath: options.receiptPath,
    };
  }

  const raw = readFileSync(options.receiptPath, 'utf8');
  const ci = readCiContext();
  const verdict = verifyCiProofReceipt(raw, options.command, {
    ci,
    expectedStagingRef: EXPECTED_STAGING_SUPABASE_PROJECT_REF,
    expectedWorkflow: options.expectedWorkflow,
    expectedJob: options.expectedJob,
  });

  let observed: string | null = null;
  try {
    observed = (JSON.parse(raw) as { observed_project_ref?: string }).observed_project_ref ?? null;
  } catch {
    observed = null;
  }

  return {
    verdict: verdict.ok ? 'PASS' : 'FAIL',
    reason: verdict.reason,
    receiptPath: options.receiptPath,
    observedProjectRef: observed,
    runId: ci.runId,
  };
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  const options = parseArgs(process.argv.slice(2));
  const result = auditReceiptFile(options);
  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`Receipt: ${result.receiptPath ?? '(none)'}`);
    console.log(`Observed project: ${result.observedProjectRef ?? '(none)'}`);
    console.log(`Expected staging: ${EXPECTED_STAGING_SUPABASE_PROJECT_REF}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log(`Reason: ${result.reason}`);
  }
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      [
        '### UTV2-1630 DB proof receipt',
        `- verdict: ${result.verdict}`,
        `- observed project: ${result.observedProjectRef ?? '(none)'}`,
        `- expected staging: ${EXPECTED_STAGING_SUPABASE_PROJECT_REF}`,
        `- reason: ${result.reason}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
  process.exitCode = result.verdict === 'PASS' ? 0 : 1;
}

export { parseArgs, isCliEntrypoint, path };
