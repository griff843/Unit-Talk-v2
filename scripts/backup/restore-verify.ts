import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLES = [
  'picks',
  'audit_log',
  'distribution_outbox',
  'settlement_records',
  'pick_lifecycle',
];

export interface RestoreVerifyOptions {
  dumpFile: string;
  targetUrl: string;
  targetEnvironment: string;
  dryRun: boolean;
  schema: string;
  expectedTables: string[];
  now: Date;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface RestoreVerifyReport {
  service: 'backup-restore-verify';
  status: 'pass' | 'fail';
  dryRun: boolean;
  target: {
    environment: string;
    database: string;
    host: string;
    productionGuard: 'passed' | 'rejected';
  };
  dump: {
    file: string;
    exists: boolean;
  };
  restore: {
    attempted: boolean;
    command: 'psql' | 'pg_restore' | 'gzip|psql' | 'none';
    exitCode: number | null;
  };
  checks: {
    schema: {
      expectedTables: string[];
      foundTables: string[];
      missingTables: string[];
    };
    rowCounts: Record<string, number>;
  };
  durationMs: number;
  errors: string[];
  ts: string;
}

interface ParsedArgs {
  dumpFile?: string;
  targetUrl?: string;
  targetEnvironment?: string;
  dryRun: boolean;
  schema?: string;
  expectedTables: string[];
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedArgs {
  const parsed: ParsedArgs = {
    dumpFile: env['BACKUP_RESTORE_VERIFY_DUMP'],
    targetUrl: env['BACKUP_RESTORE_VERIFY_DATABASE_URL'] ?? env['RESTORE_VERIFY_DATABASE_URL'],
    targetEnvironment: env['BACKUP_RESTORE_VERIFY_TARGET_ENV'],
    dryRun: false,
    schema: env['BACKUP_RESTORE_VERIFY_SCHEMA'],
    expectedTables: env['BACKUP_RESTORE_VERIFY_TABLES']
      ? env['BACKUP_RESTORE_VERIFY_TABLES'].split(',').map((table) => table.trim()).filter(Boolean)
      : [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--dump-file') {
      parsed.dumpFile = argv[++index];
    } else if (arg === '--target-url') {
      parsed.targetUrl = argv[++index];
    } else if (arg === '--target-environment') {
      parsed.targetEnvironment = argv[++index];
    } else if (arg === '--schema') {
      parsed.schema = argv[++index];
    } else if (arg === '--expected-table') {
      const table = argv[++index];
      if (table) parsed.expectedTables.push(table);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

export function buildOptions(argv: string[], env: NodeJS.ProcessEnv = process.env, now = new Date()): RestoreVerifyOptions {
  const parsed = parseArgs(argv, env);
  const missing: string[] = [];
  if (!parsed.dumpFile) missing.push('--dump-file or BACKUP_RESTORE_VERIFY_DUMP');
  if (!parsed.targetUrl) missing.push('--target-url or BACKUP_RESTORE_VERIFY_DATABASE_URL');
  if (!parsed.targetEnvironment) missing.push('--target-environment or BACKUP_RESTORE_VERIFY_TARGET_ENV');
  if (missing.length > 0) {
    throw new Error(`Missing required restore verification input: ${missing.join(', ')}`);
  }

  return {
    dumpFile: parsed.dumpFile,
    targetUrl: parsed.targetUrl,
    targetEnvironment: parsed.targetEnvironment,
    dryRun: parsed.dryRun,
    schema: parsed.schema ?? DEFAULT_SCHEMA,
    expectedTables: parsed.expectedTables.length > 0 ? parsed.expectedTables : DEFAULT_TABLES,
    now,
  };
}

function parseTarget(targetUrl: string): { host: string; database: string } {
  try {
    const url = new URL(targetUrl);
    return {
      host: url.hostname,
      database: basename(url.pathname) || '(unknown)',
    };
  } catch {
    return { host: '(invalid)', database: '(invalid)' };
  }
}

function assertNonProductionTarget(options: RestoreVerifyOptions): void {
  const environment = options.targetEnvironment.trim().toLowerCase();
  const target = options.targetUrl.toLowerCase();
  const targetParts = parseTarget(options.targetUrl);
  const productionNames = new Set(['prod', 'production', 'live']);

  if (productionNames.has(environment)) {
    throw new Error(`Refusing restore verification against production environment: ${options.targetEnvironment}`);
  }

  if (target.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
    throw new Error(`Refusing restore verification against production Supabase project ${PRODUCTION_SUPABASE_PROJECT_REF}`);
  }

  if (/\bprod(?:uction)?\b/.test(targetParts.host.toLowerCase()) || /\bprod(?:uction)?\b/.test(targetParts.database.toLowerCase())) {
    throw new Error(`Refusing restore verification against production-like target: ${targetParts.host}/${targetParts.database}`);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function restoreCommandForDump(dumpFile: string): RestoreVerifyReport['restore']['command'] {
  if (dumpFile.endsWith('.sql.gz')) return 'gzip|psql';
  if (dumpFile.endsWith('.dump') || dumpFile.endsWith('.backup') || dumpFile.endsWith('.tar')) return 'pg_restore';
  return 'psql';
}

export async function defaultRunner(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ status: 127, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

async function runGzipSqlRestore(targetUrl: string, dumpFile: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const gzip = spawn('gzip', ['-dc', dumpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const psql = spawn('psql', ['-v', 'ON_ERROR_STOP=1', '--dbname', targetUrl], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    gzip.stdout.pipe(psql.stdin);
    gzip.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    psql.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    psql.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    let gzipStatus: number | null = null;
    let psqlStatus: number | null = null;
    const finish = (): void => {
      if (gzipStatus === null || psqlStatus === null) return;
      resolve({ status: gzipStatus === 0 && psqlStatus === 0 ? 0 : 1, stdout, stderr });
    };

    gzip.on('error', (error) => {
      gzipStatus = 127;
      stderr += error.message;
      finish();
    });
    psql.on('error', (error) => {
      psqlStatus = 127;
      stderr += error.message;
      finish();
    });
    gzip.on('close', (code) => {
      gzipStatus = code ?? 1;
      finish();
    });
    psql.on('close', (code) => {
      psqlStatus = code ?? 1;
      finish();
    });
  });
}

async function runRestore(options: RestoreVerifyOptions, runner: CommandRunner): Promise<CommandResult> {
  const command = restoreCommandForDump(options.dumpFile);
  if (command === 'gzip|psql') {
    return runGzipSqlRestore(options.targetUrl, options.dumpFile);
  }
  if (command === 'pg_restore') {
    return runner('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', options.targetUrl, options.dumpFile]);
  }
  return runner('psql', ['-v', 'ON_ERROR_STOP=1', '--dbname', options.targetUrl, '--file', options.dumpFile]);
}

function parsePsqlLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function runSchemaChecks(options: RestoreVerifyOptions, runner: CommandRunner): Promise<RestoreVerifyReport['checks']> {
  const tableList = options.expectedTables.map((table) => `'${table.replace(/'/g, "''")}'`).join(',');
  const schemaSql = [
    'select table_name',
    'from information_schema.tables',
    `where table_schema = '${options.schema.replace(/'/g, "''")}'`,
    `and table_name in (${tableList})`,
    'order by table_name;',
  ].join(' ');
  const schemaResult = await runner('psql', ['--dbname', options.targetUrl, '--tuples-only', '--no-align', '--command', schemaSql]);
  if (schemaResult.status !== 0) {
    throw new Error(`Schema sanity check failed: ${schemaResult.stderr || schemaResult.stdout}`);
  }

  const foundTables = parsePsqlLines(schemaResult.stdout);
  const missingTables = options.expectedTables.filter((table) => !foundTables.includes(table));
  if (missingTables.length > 0) {
    throw new Error(`Schema sanity check missing tables: ${missingTables.join(', ')}`);
  }

  const rowCounts: Record<string, number> = {};
  for (const table of options.expectedTables) {
    const countSql = `select count(*) from ${quoteIdentifier(options.schema)}.${quoteIdentifier(table)};`;
    const countResult = await runner('psql', ['--dbname', options.targetUrl, '--tuples-only', '--no-align', '--command', countSql]);
    if (countResult.status !== 0) {
      throw new Error(`Row-count check failed for ${table}: ${countResult.stderr || countResult.stdout}`);
    }
    const count = Number.parseInt(parsePsqlLines(countResult.stdout)[0] ?? '', 10);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`Row-count check returned invalid count for ${table}: ${countResult.stdout.trim()}`);
    }
    rowCounts[table] = count;
  }

  return {
    schema: {
      expectedTables: options.expectedTables,
      foundTables,
      missingTables,
    },
    rowCounts,
  };
}

export async function runRestoreVerify(
  options: RestoreVerifyOptions,
  runner: CommandRunner = defaultRunner,
): Promise<{ exitCode: number; report: RestoreVerifyReport }> {
  const startedAt = Date.now();
  const target = parseTarget(options.targetUrl);
  const dumpExists = existsSync(options.dumpFile);
  const errors: string[] = [];
  let productionGuard: RestoreVerifyReport['target']['productionGuard'] = 'passed';
  let restoreExitCode: number | null = null;
  let checks: RestoreVerifyReport['checks'] = {
    schema: { expectedTables: options.expectedTables, foundTables: [], missingTables: [] },
    rowCounts: {},
  };

  try {
    assertNonProductionTarget(options);
  } catch (error) {
    productionGuard = 'rejected';
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (productionGuard === 'passed' && !dumpExists) {
    errors.push(`Dump file not found: ${options.dumpFile}`);
  }

  if (productionGuard === 'passed' && dumpExists && !options.dryRun) {
    const restoreResult = await runRestore(options, runner);
    restoreExitCode = restoreResult.status;
    if (restoreResult.status !== 0) {
      errors.push(`Restore command failed: ${restoreResult.stderr || restoreResult.stdout || `exit ${restoreResult.status}`}`);
    } else {
      try {
        checks = await runSchemaChecks(options, runner);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const status: RestoreVerifyReport['status'] = errors.length === 0 ? 'pass' : 'fail';
  const report: RestoreVerifyReport = {
    service: 'backup-restore-verify',
    status,
    dryRun: options.dryRun,
    target: {
      environment: options.targetEnvironment,
      database: target.database,
      host: target.host,
      productionGuard,
    },
    dump: {
      file: options.dumpFile,
      exists: dumpExists,
    },
    restore: {
      attempted: productionGuard === 'passed' && dumpExists && !options.dryRun,
      command: options.dryRun ? 'none' : restoreCommandForDump(options.dumpFile),
      exitCode: restoreExitCode,
    },
    checks,
    durationMs: Date.now() - startedAt,
    errors,
    ts: options.now.toISOString(),
  };

  return { exitCode: status === 'pass' ? 0 : 1, report };
}

async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  const { exitCode, report } = await runRestoreVerify(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const report = {
      service: 'backup-restore-verify',
      status: 'fail',
      errors: [error instanceof Error ? error.message : String(error)],
      ts: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  });
}
