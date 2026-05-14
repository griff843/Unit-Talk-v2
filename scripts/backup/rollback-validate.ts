import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
} from '@unit-talk/db';

const SERVICE = 'backup-rollback-validate';
const PRODUCTION_SUPABASE_PROJECT_REF = 'zfzdnfwdarxucxtaojxm';
const PAGE_SIZE = 1_000;
const IN_CHUNK_SIZE = 200;

export interface RollbackValidateOptions {
  tables: string[];
  minRows: Map<string, number>;
  checkFk: boolean;
  dryRun: boolean;
  supabaseDbUrl?: string | undefined;
  allowProdRollbackValidate: boolean;
}

export interface RollbackValidateResult {
  service: typeof SERVICE;
  tables_checked: string[];
  passed: boolean;
  failed: boolean;
  errors: string[];
  durationMs: number;
}

interface DbError {
  message: string;
}

interface QueryResult<T extends Record<string, unknown>> {
  data: T[] | null;
  count?: number | null;
  error: DbError | null;
}

interface QueryBuilder<T extends Record<string, unknown>> extends PromiseLike<QueryResult<T>> {
  in(column: string, values: readonly string[]): QueryBuilder<T>;
  not(column: string, operator: string, value: unknown): QueryBuilder<T>;
  range(from: number, to: number): QueryBuilder<T>;
}

interface TableBuilder {
  select<T extends Record<string, unknown>>(
    columns: string,
    options?: { count?: 'exact'; head?: boolean },
  ): QueryBuilder<T>;
}

export interface RollbackDbClient {
  from(table: string): TableBuilder;
}

interface ForeignKeyCheck {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
}

const DEFAULT_FK_CHECKS: ForeignKeyCheck[] = [
  { childTable: 'picks', childColumn: 'submission_id', parentTable: 'submissions', parentColumn: 'id' },
  { childTable: 'submission_events', childColumn: 'submission_id', parentTable: 'submissions', parentColumn: 'id' },
  { childTable: 'pick_lifecycle', childColumn: 'pick_id', parentTable: 'picks', parentColumn: 'id' },
  { childTable: 'pick_promotion_history', childColumn: 'pick_id', parentTable: 'picks', parentColumn: 'id' },
  { childTable: 'distribution_outbox', childColumn: 'pick_id', parentTable: 'picks', parentColumn: 'id' },
  {
    childTable: 'distribution_receipts',
    childColumn: 'outbox_id',
    parentTable: 'distribution_outbox',
    parentColumn: 'id',
  },
  { childTable: 'settlement_records', childColumn: 'pick_id', parentTable: 'picks', parentColumn: 'id' },
  {
    childTable: 'settlement_records',
    childColumn: 'corrects_id',
    parentTable: 'settlement_records',
    parentColumn: 'id',
  },
];

function readFlagValue(arg: string, flag: string, argv: string[], index: number): { value: string; nextIndex: number } {
  const inlinePrefix = `${flag}=`;
  if (arg.startsWith(inlinePrefix)) {
    return { value: arg.slice(inlinePrefix.length), nextIndex: index };
  }

  if (arg === flag) {
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return { value, nextIndex: index + 1 };
  }

  throw new Error(`Unknown argument: ${arg}`);
}

function parseTables(value: string): string[] {
  const tables = value
    .split(',')
    .map((table) => table.trim())
    .filter(Boolean);

  if (tables.length === 0) {
    throw new Error('--tables must include at least one table name');
  }

  for (const table of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Unsafe table identifier: ${table}`);
    }
  }

  return [...new Set(tables)];
}

function parseMinRows(value: string): Map<string, number> {
  const minRows = new Map<string, number>();
  if (!value.trim()) {
    return minRows;
  }

  for (const entry of value.split(',')) {
    const [table, countText] = entry.split(':');
    const cleanTable = table?.trim();
    const cleanCount = countText?.trim();
    if (!cleanTable || !cleanCount) {
      throw new Error(`Invalid --min-rows entry: ${entry}`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanTable)) {
      throw new Error(`Unsafe table identifier in --min-rows: ${cleanTable}`);
    }

    const count = Number.parseInt(cleanCount, 10);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`Invalid --min-rows count for ${cleanTable}: ${cleanCount}`);
    }
    minRows.set(cleanTable, count);
  }

  return minRows;
}

export function buildOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): RollbackValidateOptions {
  let tables: string[] | undefined;
  let minRows = new Map<string, number>();
  let checkFk = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === '--check-fk') {
      checkFk = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--tables' || arg.startsWith('--tables=')) {
      const parsed = readFlagValue(arg, '--tables', argv, index);
      tables = parseTables(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    if (arg === '--min-rows' || arg.startsWith('--min-rows=')) {
      const parsed = readFlagValue(arg, '--min-rows', argv, index);
      minRows = parseMinRows(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!tables) {
    throw new Error('Missing required --tables=<comma-separated table names>');
  }

  for (const table of minRows.keys()) {
    if (!tables.includes(table)) {
      throw new Error(`--min-rows table ${table} was not listed in --tables`);
    }
  }

  return {
    tables,
    minRows,
    checkFk,
    dryRun,
    supabaseDbUrl: env['SUPABASE_DB_URL'],
    allowProdRollbackValidate: env['ALLOW_PROD_ROLLBACK_VALIDATE'] === '1',
  };
}

function assertProductionGuard(options: RollbackValidateOptions): void {
  if (
    options.supabaseDbUrl?.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF) &&
    !options.allowProdRollbackValidate
  ) {
    throw new Error(
      `Refusing rollback validation against production Supabase project ${PRODUCTION_SUPABASE_PROJECT_REF}. ` +
        'Set ALLOW_PROD_ROLLBACK_VALIDATE=1 to override.',
    );
  }
}

async function validateTableCounts(client: RollbackDbClient, options: RollbackValidateOptions): Promise<string[]> {
  const errors: string[] = [];

  for (const table of options.tables) {
    const result = await client
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (result.error) {
      errors.push(`Required table missing or unreadable: ${table}: ${result.error.message}`);
      continue;
    }

    const rowCount = result.count;
    if (typeof rowCount !== 'number') {
      errors.push(`Row-count check returned no exact count for ${table}`);
      continue;
    }

    const minimum = options.minRows.get(table);
    if (minimum !== undefined && rowCount < minimum) {
      errors.push(`Row-count check failed for ${table}: expected at least ${minimum}, found ${rowCount}`);
    }
  }

  return errors;
}

function uniqueStrings(rows: Record<string, unknown>[], column: string): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (typeof value === 'string' && value.trim()) {
      values.add(value);
    }
  }
  return [...values];
}

async function fetchColumnValues(client: RollbackDbClient, table: string, column: string): Promise<string[]> {
  const values = new Set<string>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client
      .from(table)
      .select<Record<string, unknown>>(column)
      .not(column, 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (result.error) {
      throw new Error(`FK source query failed for ${table}.${column}: ${result.error.message}`);
    }

    const rows = result.data ?? [];
    for (const value of uniqueStrings(rows, column)) {
      values.add(value);
    }

    if (rows.length < PAGE_SIZE) {
      break;
    }
  }

  return [...values];
}

async function fetchExistingParentValues(
  client: RollbackDbClient,
  table: string,
  column: string,
  values: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();

  for (let index = 0; index < values.length; index += IN_CHUNK_SIZE) {
    const chunk = values.slice(index, index + IN_CHUNK_SIZE);
    const result = await client
      .from(table)
      .select<Record<string, unknown>>(column)
      .in(column, chunk);

    if (result.error) {
      throw new Error(`FK parent query failed for ${table}.${column}: ${result.error.message}`);
    }

    for (const value of uniqueStrings(result.data ?? [], column)) {
      found.add(value);
    }
  }

  return found;
}

async function validateForeignKeys(client: RollbackDbClient, tables: readonly string[]): Promise<string[]> {
  const errors: string[] = [];
  const requestedTables = new Set(tables);
  const checks = DEFAULT_FK_CHECKS.filter((check) => requestedTables.has(check.childTable));

  for (const check of checks) {
    try {
      const childValues = await fetchColumnValues(client, check.childTable, check.childColumn);
      if (childValues.length === 0) {
        continue;
      }

      const parentValues = await fetchExistingParentValues(
        client,
        check.parentTable,
        check.parentColumn,
        childValues,
      );
      const missingValues = childValues.filter((value) => !parentValues.has(value));
      if (missingValues.length > 0) {
        errors.push(
          `Orphaned FK references found for ${check.childTable}.${check.childColumn} -> ` +
            `${check.parentTable}.${check.parentColumn}: ${missingValues.length} missing`,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return errors;
}

function createDefaultClient(): RollbackDbClient {
  const env = loadEnvironment();
  const connection = createServiceRoleDatabaseConnectionConfig(env);
  return createDatabaseClientFromConnection(connection) as unknown as RollbackDbClient;
}

function buildResult(options: RollbackValidateOptions, startedAt: number, errors: string[]): RollbackValidateResult {
  return {
    service: SERVICE,
    tables_checked: options.tables,
    passed: errors.length === 0,
    failed: errors.length > 0,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

export async function runRollbackValidate(
  options: RollbackValidateOptions,
  clientFactory: () => RollbackDbClient = createDefaultClient,
): Promise<{ exitCode: number; result: RollbackValidateResult }> {
  const startedAt = Date.now();
  const errors: string[] = [];

  try {
    assertProductionGuard(options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length === 0 && !options.dryRun) {
    const client = clientFactory();
    errors.push(...await validateTableCounts(client, options));
    if (options.checkFk) {
      errors.push(...await validateForeignKeys(client, options.tables));
    }
  }

  const result = buildResult(options, startedAt, errors);
  return { exitCode: result.passed ? 0 : 1, result };
}

async function main(): Promise<void> {
  const options = buildOptions(process.argv.slice(2));
  const { exitCode, result } = await runRollbackValidate(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const result: RollbackValidateResult = {
      service: SERVICE,
      tables_checked: [],
      passed: false,
      failed: true,
      errors: [error instanceof Error ? error.message : String(error)],
      durationMs: 0,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  });
}
