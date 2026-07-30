import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCiProofReceipt,
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
  serializeReceipt,
} from './isolated-proof-attestation.js';

type EnvMap = Record<string, string | undefined>;

export interface DbSmokeEvaluationInput {
  required: boolean;
  hasCredentials: boolean;
  exitCode: number | null;
  output: string;
}

export interface DbSmokeEvaluation {
  ok: boolean;
  status: 'passed' | 'failed' | 'skipped';
  skipped: boolean;
  reason: string;
}

const REQUIRED_SUPABASE_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export function parseEnvText(text: string): EnvMap {
  const parsed: EnvMap = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    parsed[key] = value;
  }
  return parsed;
}

export function collectEffectiveEnv(cwd = process.cwd(), processEnv: EnvMap = process.env): EnvMap {
  return {
    ...readEnvFile(join(cwd, '.env.example')),
    ...readEnvFile(join(cwd, '.env')),
    ...readEnvFile(join(cwd, 'local.env')),
    ...processEnv,
  };
}

export function hasSupabaseSmokeCredentials(env: EnvMap): boolean {
  return REQUIRED_SUPABASE_KEYS.every((key) => (env[key] ?? '').trim().length > 0);
}

export function isDbSmokeRequired(env: EnvMap): boolean {
  return (
    truthy(env['CI_REQUIRE_DB_SMOKE']) ||
    truthy(env['GITHUB_REF_PROTECTED']) ||
    env['GITHUB_REF'] === 'refs/heads/main'
  );
}

export function detectDbSmokeSkipped(output: string): boolean {
  return (
    /SUPABASE_URL\s*\/\s*SUPABASE_ANON_KEY\s*\/\s*SUPABASE_SERVICE_ROLE_KEY not configured/i.test(output) ||
    /\bskipped\s+[1-9][0-9]*\b/i.test(output)
  );
}

export function evaluateDbSmokeResult(input: DbSmokeEvaluationInput): DbSmokeEvaluation {
  if (input.required && !input.hasCredentials) {
    return {
      ok: false,
      status: 'failed',
      skipped: true,
      reason: 'DB smoke is required but Supabase smoke credentials are missing',
    };
  }

  if (input.exitCode !== 0) {
    return {
      ok: false,
      status: 'failed',
      skipped: detectDbSmokeSkipped(input.output),
      reason: `pnpm test:db exited with ${input.exitCode ?? 'unknown'}`,
    };
  }

  const skipped = detectDbSmokeSkipped(input.output);
  if (input.required && skipped) {
    return {
      ok: false,
      status: 'failed',
      skipped,
      reason: 'DB smoke is required but the test run reported skipped smoke tests',
    };
  }

  return {
    ok: true,
    status: skipped ? 'skipped' : 'passed',
    skipped,
    reason: skipped ? 'DB smoke skipped because credentials are optional for this ref' : 'DB smoke passed',
  };
}

async function main(): Promise<void> {
  const env = collectEffectiveEnv();
  const required = isDbSmokeRequired(env);
  const hasCredentials = hasSupabaseSmokeCredentials(env);

  console.log(`[ci:db-smoke] required=${required}`);
  console.log(`[ci:db-smoke] supabase_credentials=${hasCredentials ? 'present' : 'missing'}`);

  if (required && !hasCredentials) {
    const evaluation = evaluateDbSmokeResult({
      required,
      hasCredentials,
      exitCode: 0,
      output: '',
    });
    writeSummary(evaluation, required);
    console.error(`[ci:db-smoke] ${evaluation.reason}`);
    process.exit(1);
  }

  // UTV2-1630: refuse BEFORE any DB access unless the target is POSITIVELY
  // identified as a non-production project.
  //
  // The first version refused only when production was positively identified,
  // so every unidentifiable target — custom domain, pooler, tunnel,
  // `db.<ref>.supabase.co`, empty value — fell through and the smoke test ran
  // and wrote. That protected the paperwork and left the database exposed,
  // which is backwards given this lane exists because 310 fixture rows were
  // written to production.
  const targetUrl = env['SUPABASE_URL'];
  const { projectRef, host } = extractProjectRefFromUrl(targetUrl);
  // Resolved target is echoed WITHOUT credentials so the log shows what was
  // actually contacted, not what was intended.
  console.log(
    `[ci:db-smoke] resolved target host=${host ?? 'unparseable'} ref=${projectRef ?? 'unidentified'}`,
  );
  if (!isApprovedStagingTarget(targetUrl)) {
    console.error(
      `[ci:db-smoke] refusing to run: target is not the approved staging project. ` +
        `observed=${projectRef ?? 'unidentified'} expected=${EXPECTED_STAGING_SUPABASE_PROJECT_REF} ` +
        `production=${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}. ` +
        'Unknown, ambiguous, custom-domain, proxy, tunnel, malformed and missing targets are all refused.',
    );
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const result = spawnSync('pnpm test:db', {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
  });
  const finishedAt = new Date().toISOString();
  const capturedOutput = [
    result.stdout,
    result.stderr,
    result.error ? result.error.message : '',
  ].filter(Boolean).join('\n');
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Emit a receipt bound to this CI run. The auditor re-checks run/attempt/sha
  // against its own environment and re-parses TAP from captured_output, so this
  // cannot be hand-authored, copied from another run, or edited.
  const receipt = buildCiProofReceipt({
    supabaseUrl: targetUrl,
    command: 'pnpm test:db',
    startedAt,
    finishedAt,
    exitCode: result.status,
    capturedOutput,
    repoMigrationHead: env['CI_REPO_MIGRATION_HEAD'] ?? null,
    fixtureRunId: env['CI_FIXTURE_RUN_ID'] ?? null,
    cleanupResult: env['CI_FIXTURE_CLEANUP_RESULT'] ?? null,
  });
  const receiptPath = process.env['CI_DB_PROOF_RECEIPT_PATH'];
  if (receiptPath) {
    writeFileSync(receiptPath, serializeReceipt(receipt), 'utf8');
    console.log(
      `[ci:db-smoke] receipt written to ${receiptPath} ` +
        `(sha256=${receipt.receipt_sha256}, target=${receipt.observed_project_ref})`,
    );
  }

  const output = capturedOutput;

  const evaluation = evaluateDbSmokeResult({
    required,
    hasCredentials,
    exitCode: result.status,
    output,
  });

  writeSummary(evaluation, required);
  if (!evaluation.ok) {
    console.error(`[ci:db-smoke] ${evaluation.reason}`);
    process.exit(1);
  }
  console.log(`[ci:db-smoke] ${evaluation.reason}`);
}

function readEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  return parseEnvText(readFileSync(path, 'utf8'));
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());
}

function writeSummary(evaluation: DbSmokeEvaluation, required: boolean): void {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (!summaryPath) return;
  appendFileSync(
    summaryPath,
    [
      '### Database smoke',
      `- status: ${evaluation.status}`,
      `- required: ${required}`,
      `- skipped: ${evaluation.skipped}`,
      `- reason: ${evaluation.reason}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

/**
 * UTV2-1630: compare resolved real paths, never the filename.
 *
 * This file previously used `endsWith('/required-db-smoke.ts')`. That fails
 * OPEN: under any rename, copy, symlink or compiled-.js invocation `main()`
 * never runs and the process exits 0 having executed no smoke test and written
 * no receipt. `ci.yml` happens to catch that with a follow-up `test -f` on the
 * receipt path, but `proof-gate.yml` and `t1-proof-gate.yml` invoke
 * `pnpm ci:db-smoke` bare — they would print "C2 PASS: pnpm test:db executed"
 * having executed nothing.
 *
 * The same pattern was replaced with this comparison in assert-staging-target.ts,
 * seed-staging-fixtures.ts and proof-auditor-gate.ts; this file was missed.
 */
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
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
