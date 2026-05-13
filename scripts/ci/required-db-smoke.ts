import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  const result = spawnSync('pnpm test:db', {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
  });
  const output = [
    result.stdout,
    result.stderr,
    result.error ? result.error.message : '',
  ].filter(Boolean).join('\n');
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

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

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/required-db-smoke.ts')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
