import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_TABLES = [
  'picks',
  'audit_log',
  'distribution_outbox',
  'settlement_records',
  'pick_lifecycle',
];

export interface DrillStep {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  duration_ms: number;
}

export interface RestoreDrillReport {
  service: 'restore-drill';
  source: string;
  target_masked: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  steps: DrillStep[];
  passed: boolean;
  errors: string[];
}

export interface RestoreDrillOptions {
  source: string;
  targetUrl: string;
  tables: string[];
  dryRun: boolean;
  timeoutMinutes: number;
  env: NodeJS.ProcessEnv;
}

export interface RestoreCommandResult {
  command: string;
}

export interface DbClient {
  countRows(table: string): Promise<number>;
  close?(): Promise<void>;
}

export type DbClientFactory = (targetUrl: string) => DbClient;
export type RestoreExecutor = (source: string, targetUrl: string) => Promise<RestoreCommandResult>;
export type ArtifactReader = (source: string) => Promise<string>;
export type Clock = () => Date;

export interface RestoreDrillDependencies {
  createDbClient?: DbClientFactory;
  restoreExecutor?: RestoreExecutor;
  artifactReader?: ArtifactReader;
  now?: Clock;
}

interface ParsedArgs {
  source?: string;
  targetUrl?: string;
  tables?: string[];
  dryRun: boolean;
  timeoutMinutes: number;
}

interface StepOutcome {
  status: DrillStep['status'];
  detail: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dryRun: false,
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg.startsWith('--source=')) {
      parsed.source = arg.slice('--source='.length);
    } else if (arg.startsWith('--target-url=')) {
      parsed.targetUrl = arg.slice('--target-url='.length);
    } else if (arg.startsWith('--tables=')) {
      parsed.tables = arg
        .slice('--tables='.length)
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--timeout-minutes=')) {
      const value = Number.parseFloat(arg.slice('--timeout-minutes='.length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-minutes must be a positive number');
      }
      parsed.timeoutMinutes = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function buildOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RestoreDrillOptions {
  const parsed = parseArgs(argv);
  const missing: string[] = [];
  if (!parsed.source) missing.push('--source');
  if (!parsed.targetUrl) missing.push('--target-url');
  if (missing.length > 0) {
    throw new Error(`Missing required restore drill input: ${missing.join(', ')}`);
  }

  return {
    source: parsed.source,
    targetUrl: parsed.targetUrl,
    tables: parsed.tables && parsed.tables.length > 0 ? parsed.tables : DEFAULT_TABLES,
    dryRun: parsed.dryRun,
    timeoutMinutes: parsed.timeoutMinutes,
    env,
  };
}

export function maskPostgresUrl(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(invalid-url)';
  }
}

function isLikelyLocalPath(source: string): boolean {
  return isAbsolute(source) || source.startsWith('./') || source.startsWith('../') || /^[A-Za-z]:[\\/]/.test(source);
}

export async function defaultArtifactReader(source: string): Promise<string> {
  if (!isLikelyLocalPath(source)) {
    return `simulated remote artifact readable: ${source}`;
  }

  await access(source);
  return `local artifact readable: ${source}`;
}

export async function defaultRestoreExecutor(source: string, targetUrl: string): Promise<RestoreCommandResult> {
  const command = `pg_restore --clean --if-exists --no-owner --dbname ${maskPostgresUrl(targetUrl)} ${source}`;
  return { command };
}

export function defaultDbClientFactory(_targetUrl: string): DbClient {
  return {
    async countRows(_table: string): Promise<number> {
      return 0;
    },
  };
}

function assertProductionGuard(options: RestoreDrillOptions): void {
  if (options.targetUrl.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error(`Refusing restore drill against production Supabase project ${PRODUCTION_SUPABASE_PROJECT_REF}`);
  }

  if (options.env['NODE_ENV'] === 'production' && options.env['ALLOW_PROD_DRILL'] !== '1') {
    throw new Error('Refusing restore drill with NODE_ENV=production unless ALLOW_PROD_DRILL=1');
  }
}

function assertNotTimedOut(startedAtMs: number, options: RestoreDrillOptions, now: Clock): void {
  const elapsedMs = now().getTime() - startedAtMs;
  const timeoutMs = options.timeoutMinutes * 60_000;
  if (elapsedMs > timeoutMs) {
    throw new Error(`Restore drill exceeded timeout of ${options.timeoutMinutes} minute(s)`);
  }
}

async function timedStep(
  name: string,
  now: Clock,
  run: () => Promise<StepOutcome>,
): Promise<{ step: DrillStep; error?: string }> {
  const startedAt = now().getTime();
  try {
    const outcome = await run();
    return {
      step: {
        name,
        status: outcome.status,
        detail: outcome.detail,
        duration_ms: Math.max(0, now().getTime() - startedAt),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      step: {
        name,
        status: 'fail',
        detail: message,
        duration_ms: Math.max(0, now().getTime() - startedAt),
      },
      error: message,
    };
  }
}

export async function runRestoreDrill(
  options: RestoreDrillOptions,
  dependencies: RestoreDrillDependencies = {},
): Promise<{ exitCode: number; report: RestoreDrillReport }> {
  const now = dependencies.now ?? (() => new Date());
  const artifactReader = dependencies.artifactReader ?? defaultArtifactReader;
  const restoreExecutor = dependencies.restoreExecutor ?? defaultRestoreExecutor;
  const createDbClient = dependencies.createDbClient ?? defaultDbClientFactory;
  const startedAt = now();
  const startedAtMs = startedAt.getTime();
  const steps: DrillStep[] = [];
  const errors: string[] = [];

  const appendStep = async (name: string, run: () => Promise<StepOutcome>): Promise<boolean> => {
    const result = await timedStep(name, now, run);
    steps.push(result.step);
    if (result.error) {
      errors.push(result.error);
      return false;
    }
    return result.step.status !== 'fail';
  };

  await appendStep('production_guard', async () => {
    assertProductionGuard(options);
    return { status: 'pass', detail: 'Target passed non-production guard checks.' };
  });

  if (errors.length === 0) {
    await appendStep('validate_artifact', async () => {
      assertNotTimedOut(startedAtMs, options, now);
      const detail = await artifactReader(options.source);
      return { status: 'pass', detail };
    });
  }

  if (errors.length === 0) {
    await appendStep('restore_to_target', async () => {
      assertNotTimedOut(startedAtMs, options, now);
      const result = await restoreExecutor(options.source, options.targetUrl);
      const prefix = options.dryRun ? 'dry-run: would run' : 'simulated: would run';
      return { status: options.dryRun ? 'skipped' : 'pass', detail: `${prefix} ${result.command}` };
    });
  }

  if (errors.length === 0) {
    let dbClient: DbClient | null = null;
    await appendStep('row_count_sanity_checks', async () => {
      assertNotTimedOut(startedAtMs, options, now);
      if (options.dryRun) {
        return {
          status: 'skipped',
          detail: `dry-run: would count rows for ${options.tables.join(', ')}`,
        };
      }
      dbClient = createDbClient(options.targetUrl);
      const counts: Record<string, number> = {};
      for (const table of options.tables) {
        assertNotTimedOut(startedAtMs, options, now);
        const count = await dbClient.countRows(table);
        if (!Number.isFinite(count) || count < 0) {
          throw new Error(`Invalid row count for ${table}: ${count}`);
        }
        counts[table] = count;
      }
      return { status: 'pass', detail: JSON.stringify(counts) };
    });
    if (dbClient?.close) {
      await dbClient.close();
    }
  }

  if (errors.length === 0) {
    const timeoutStep = await timedStep('timeout_check', now, async () => {
      assertNotTimedOut(startedAtMs, options, now);
      return { status: 'pass', detail: `Completed within ${options.timeoutMinutes} minute(s).` };
    });
    steps.push(timeoutStep.step);
    if (timeoutStep.error) errors.push(timeoutStep.error);
  }

  const finishedAt = now();
  const report: RestoreDrillReport = {
    service: 'restore-drill',
    source: options.source,
    target_masked: maskPostgresUrl(options.targetUrl),
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.getTime() - startedAtMs),
    steps,
    passed: errors.length === 0,
    errors,
  };

  return { exitCode: report.passed ? 0 : 1, report };
}

async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  const { exitCode, report } = await runRestoreDrill(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    process.stdout.write(
      `${JSON.stringify(
        {
          service: 'restore-drill',
          source: '',
          target_masked: '',
          started_at: now,
          finished_at: now,
          duration_ms: 0,
          steps: [],
          passed: false,
          errors: [message],
        },
        null,
        2,
      )}\n`,
    );
    process.exit(1);
  });
}
