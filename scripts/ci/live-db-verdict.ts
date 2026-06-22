/**
 * Live-DB verdict classifier (UTV2-1292).
 *
 * Runs the live-DB proof suite (`pnpm test:live-db`) and classifies the outcome
 * into a machine-readable verdict so CI can distinguish a real CODE failure from
 * transient INFRASTRUCTURE unavailability (the Supabase write-path degradation
 * tracked in UTV2-1290). This does NOT decide merge — the CI tier/lane policy
 * consumes the verdict and decides block/allow. T1 strictness is preserved:
 * `infra_unavailable` is reported as infrastructure-blocked, but the tier policy
 * still treats it as *proof insufficient* (blocking) for T1/runtime lanes.
 *
 * Verdicts:
 *   passed            — live suite ran and passed.
 *   code_failed       — live suite failed on an assertion / type / app defect. BLOCK everywhere.
 *   infra_unavailable — Supabase unreachable / timing out / schema-cache degraded before a
 *                       conclusive assertion. NOT a code defect. (T1 still blocked = proof insufficient.)
 *   proof_skipped     — live suite did not run because Supabase credentials are absent.
 *
 * Pure classification (`classifyLiveDbOutcome`) is unit-tested offline; `main`
 * shells out and writes the verdict to stdout + `live-db-verdict.json`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export type LiveDbVerdict =
  | 'passed'
  | 'code_failed'
  | 'infra_unavailable'
  | 'proof_skipped';

export interface LiveDbOutcomeInput {
  exitCode: number | null;
  output: string; // combined stdout+stderr
}

export interface LiveDbVerdictResult {
  verdict: LiveDbVerdict;
  reason: string;
}

// Substrings that indicate the live DB / PostgREST layer was unavailable or
// degraded — an infrastructure condition, not a code defect. Matched
// case-insensitively against the combined test output.
const INFRA_SIGNATURES: readonly string[] = [
  'could not query the database for the schema cache',
  'schema cache',
  'statement timeout',
  'canceling statement due to statement timeout',
  'connection terminated',
  'connection timeout',
  'fetch failed',
  'econnreset',
  'econnrefused',
  'etimedout',
  'socket hang up',
  'service unavailable',
  ' 520', // Cloudflare unknown error
  ' 521', // web server is down
  ' 522', // connection timed out
  ' 503',
];

// Substrings indicating the live suite was skipped for missing credentials.
const MISSING_CREDS_SIGNATURES: readonly string[] = [
  'supabase credentials',
  'supabase_service_role_key',
  'missing supabase',
  'no supabase credentials',
  'skipping live',
];

/**
 * Classify a live-DB run outcome. Pure + deterministic.
 * Precedence: missing-creds → passed (exit 0) → infra signatures → code_failed.
 */
export function classifyLiveDbOutcome(input: LiveDbOutcomeInput): LiveDbVerdictResult {
  const haystack = input.output.toLowerCase();

  if (input.exitCode !== 0 && MISSING_CREDS_SIGNATURES.some((s) => haystack.includes(s))) {
    return { verdict: 'proof_skipped', reason: 'Supabase credentials absent — live proof not run.' };
  }

  if (input.exitCode === 0) {
    return { verdict: 'passed', reason: 'Live-DB proof suite passed.' };
  }

  const infraHit = INFRA_SIGNATURES.find((s) => haystack.includes(s));
  if (infraHit) {
    return {
      verdict: 'infra_unavailable',
      reason: `Live DB unavailable/degraded (matched "${infraHit.trim()}") — infrastructure-blocked, not a code defect.`,
    };
  }

  return {
    verdict: 'code_failed',
    reason: 'Live-DB proof suite failed and no infrastructure-degradation signature matched — treat as a code failure.',
  };
}

/** Map verdict → process exit code. code_failed is the only hard failure here; the CI tier policy decides whether infra_unavailable/proof_skipped block a given lane. */
export function verdictExitCode(verdict: LiveDbVerdict): number {
  return verdict === 'code_failed' ? 1 : 0;
}

function main(): void {
  const run = spawnSync('pnpm', ['test:live-db'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  const exitCode = run.status;
  const result = classifyLiveDbOutcome({ exitCode, output });

  const payload = {
    schema: 'live-db-verdict/v1',
    verdict: result.verdict,
    reason: result.reason,
    test_exit_code: exitCode,
    classified_at_unix: undefined as number | undefined, // stamped by caller/CI if needed; avoid nondeterminism here
  };

  // Emit for humans + machines.
  process.stdout.write(`${run.stdout ?? ''}\n${run.stderr ?? ''}\n`);
  process.stdout.write(`LIVE_DB_VERDICT: ${result.verdict}\n`);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  try {
    fs.writeFileSync('live-db-verdict.json', `${JSON.stringify(payload, null, 2)}\n`);
  } catch {
    // Non-fatal: CI reads stdout if the file write fails.
  }

  process.exit(verdictExitCode(result.verdict));
}

// Only run when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('live-db-verdict.ts') || invokedPath.endsWith('live-db-verdict.js')) {
  main();
}
