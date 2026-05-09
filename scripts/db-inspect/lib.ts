import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const ENV_FILES = ['.env.example', '.env', 'local.env'] as const;
const CONNECTION_KEYS = ['DATABASE_URL', 'SUPABASE_DATABASE_URL', 'SUPABASE_DB_URL'] as const;

export type OutputFormat = 'text' | 'json';
export type CommandName = 'diagnostics' | 'schema' | 'table';

export interface CliArgs {
  command: CommandName;
  connectionString?: string;
  format: OutputFormat;
  help: boolean;
  limit: number;
  schema: string;
  table?: string;
}

export interface InspectionResult {
  command: CommandName;
  generatedAt: string;
  schema: string;
  target?: string;
  payload: unknown;
}

interface QuerySpec {
  sql: string;
  target?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command: CommandName = 'diagnostics';
  let connectionString: string | undefined;
  let format: OutputFormat = 'text';
  let help = false;
  let limit = DEFAULT_LIMIT;
  let schema = 'public';
  let table: string | undefined;

  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    command = parseCommandName(args.shift()!);
  }

  while (args.length > 0) {
    const token = args.shift()!;
    switch (token) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--json':
        format = 'json';
        break;
      case '--format':
        format = parseFormat(readOptionValue(token, args.shift()));
        break;
      case '--connection-string':
        connectionString = readOptionValue(token, args.shift());
        break;
      case '--schema':
        schema = sanitizeIdentifier(readOptionValue(token, args.shift()), 'schema');
        break;
      case '--table':
        table = sanitizeIdentifier(readOptionValue(token, args.shift()), 'table');
        break;
      case '--limit':
        limit = parseLimit(readOptionValue(token, args.shift()));
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (command === 'table' && !help && !table) {
    throw new Error('The table command requires --table <name>.');
  }

  return {
    command,
    connectionString,
    format,
    help,
    limit,
    schema,
    table,
  };
}

function parseCommandName(value: string): CommandName {
  if (value === 'diagnostics' || value === 'schema' || value === 'table') {
    return value;
  }

  throw new Error(`Unknown command: ${value}`);
}

function parseFormat(value: string): OutputFormat {
  if (value === 'text' || value === 'json') {
    return value;
  }

  throw new Error(`Unsupported format: ${value}`);
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }

  return Math.min(parsed, MAX_LIMIT);
}

function readOptionValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function sanitizeIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe ${label} identifier: ${value}`);
  }

  return value;
}

export function quoteLiteral(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

function parseEnvFile(filePath: string): Array<[string, string]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const rows: Array<[string, string]> = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    rows.push([key, value]);
  }

  return rows;
}

export function resolveConnectionString(explicit?: string, rootDir = process.cwd()): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const env = new Map<string, string>();
  for (const envFile of ENV_FILES) {
    for (const [key, value] of parseEnvFile(path.join(rootDir, envFile))) {
      env.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value?.trim()) {
      env.set(key, value.trim());
    }
  }

  for (const key of CONNECTION_KEYS) {
    const value = env.get(key);
    if (value) {
      return value;
    }
  }

  throw new Error(
    'Missing database connection string. Set DATABASE_URL, SUPABASE_DATABASE_URL, or SUPABASE_DB_URL, or pass --connection-string.',
  );
}

export function buildQuery(args: CliArgs): QuerySpec {
  const qualifiedSchema = quoteLiteral(args.schema);

  if (args.command === 'diagnostics') {
    return {
      sql: `
WITH relation_sizes AS (
  SELECT
    c.relname AS relation_name,
    c.relkind AS relation_kind,
    c.reltuples::bigint AS estimated_rows,
    pg_total_relation_size(c.oid)::bigint AS total_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${qualifiedSchema}
    AND c.relkind IN ('r', 'p', 'm')
  ORDER BY total_bytes DESC, relation_name ASC
  LIMIT ${args.limit}
)
SELECT json_build_object(
  'database', current_database(),
  'current_user', current_user,
  'schema', ${qualifiedSchema},
  'transaction_read_only', current_setting('transaction_read_only'),
  'checked_at', now(),
  'server_version', current_setting('server_version'),
  'table_count', (
    SELECT count(*)::int
    FROM information_schema.tables
    WHERE table_schema = ${qualifiedSchema}
      AND table_type = 'BASE TABLE'
  ),
  'view_count', (
    SELECT count(*)::int
    FROM information_schema.views
    WHERE table_schema = ${qualifiedSchema}
  ),
  'database_size_bytes', pg_database_size(current_database())::bigint,
  'active_connections', (
    SELECT count(*)::int
    FROM pg_stat_activity
    WHERE datname = current_database()
  ),
  'waiting_locks', (
    SELECT count(*)::int
    FROM pg_locks
    WHERE NOT granted
  ),
  'largest_relations', COALESCE((
    SELECT json_agg(
      json_build_object(
        'name', relation_name,
        'kind', relation_kind,
        'estimated_rows', estimated_rows,
        'total_bytes', total_bytes
      )
      ORDER BY total_bytes DESC, relation_name ASC
    )
    FROM relation_sizes
  ), '[]'::json)
);
`.trim(),
    };
  }

  if (args.command === 'schema') {
    return {
      sql: `
SELECT COALESCE(json_agg(row_data ORDER BY relation_name), '[]'::json)
FROM (
  SELECT
    t.table_name AS relation_name,
    t.table_type,
    obj_description(to_regclass(format('%I.%I', t.table_schema, t.table_name)), 'pg_class') AS description,
    COALESCE(cls.reltuples::bigint, 0) AS estimated_rows,
    COALESCE(pg_total_relation_size(to_regclass(format('%I.%I', t.table_schema, t.table_name)))::bigint, 0) AS total_bytes,
    (
      SELECT count(*)::int
      FROM information_schema.columns c
      WHERE c.table_schema = t.table_schema
        AND c.table_name = t.table_name
    ) AS column_count,
    (
      SELECT max(c.column_name)
      FROM information_schema.columns c
      WHERE c.table_schema = t.table_schema
        AND c.table_name = t.table_name
        AND c.column_name IN ('updated_at', 'created_at', 'snapshot_at', 'recorded_at')
    ) AS timestamp_hint
  FROM information_schema.tables t
  LEFT JOIN pg_class cls
    ON cls.relname = t.table_name
   AND cls.relnamespace = to_regnamespace(t.table_schema)
  WHERE t.table_schema = ${qualifiedSchema}
    AND t.table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY t.table_name ASC
  LIMIT ${args.limit}
) row_data;
`.trim(),
    };
  }

  const tableName = sanitizeIdentifier(args.table!, 'table');
  return {
    target: `${args.schema}.${tableName}`,
    sql: `
SELECT json_build_object(
  'relation', format('%I.%I', ${qualifiedSchema}, ${quoteLiteral(tableName)}),
  'relation_exists', to_regclass(format('%I.%I', ${qualifiedSchema}, ${quoteLiteral(tableName)})) IS NOT NULL,
  'estimated_rows', (
    SELECT COALESCE(cls.reltuples::bigint, 0)
    FROM pg_class cls
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = ${qualifiedSchema}
      AND cls.relname = ${quoteLiteral(tableName)}
    LIMIT 1
  ),
  'total_bytes', COALESCE(
    pg_total_relation_size(to_regclass(format('%I.%I', ${qualifiedSchema}, ${quoteLiteral(tableName)})))::bigint,
    0
  ),
  'columns', COALESCE((
    SELECT json_agg(
      json_build_object(
        'position', c.ordinal_position,
        'name', c.column_name,
        'type', c.data_type,
        'nullable', c.is_nullable,
        'default', c.column_default
      )
      ORDER BY c.ordinal_position
    )
    FROM information_schema.columns c
    WHERE c.table_schema = ${qualifiedSchema}
      AND c.table_name = ${quoteLiteral(tableName)}
  ), '[]'::json),
  'indexes', COALESCE((
    SELECT json_agg(
      json_build_object(
        'name', indexname,
        'definition', indexdef
      )
      ORDER BY indexname
    )
    FROM pg_indexes
    WHERE schemaname = ${qualifiedSchema}
      AND tablename = ${quoteLiteral(tableName)}
  ), '[]'::json),
  'constraints', COALESCE((
    SELECT json_agg(
      json_build_object(
        'name', tc.constraint_name,
        'type', tc.constraint_type
      )
      ORDER BY tc.constraint_name
    )
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = ${qualifiedSchema}
      AND tc.table_name = ${quoteLiteral(tableName)}
  ), '[]'::json),
  'column_count', (
    SELECT count(*)::bigint
    FROM information_schema.columns c
    WHERE c.table_schema = ${qualifiedSchema}
      AND c.table_name = ${quoteLiteral(tableName)}
  )
);
`.trim(),
  };
}

export async function runInspectionCommand(
  connectionString: string,
  args: CliArgs,
): Promise<InspectionResult> {
  const query = buildQuery(args);
  const payload = await selectJson(connectionString, query.sql);

  return {
    command: args.command,
    generatedAt: new Date().toISOString(),
    schema: args.schema,
    target: query.target,
    payload,
  };
}

async function selectJson(connectionString: string, sql: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    'psql',
    [
      connectionString,
      '--no-align',
      '--tuples-only',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      sql,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        PGAPPNAME: 'unit-talk-db-inspect',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000',
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Inspection query returned no output.');
  }

  return JSON.parse(trimmed) as unknown;
}

export function formatResult(result: InspectionResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    `command: ${result.command}`,
    `generated_at: ${result.generatedAt}`,
    `schema: ${result.schema}`,
  ];
  if (result.target) {
    lines.push(`target: ${result.target}`);
  }

  const payload = result.payload;
  if (Array.isArray(payload)) {
    lines.push('');
    for (const row of payload) {
      lines.push(formatRow(row));
    }
    return lines.join('\n');
  }

  if (payload && typeof payload === 'object') {
    lines.push('');
    lines.push(...formatObject(payload as Record<string, unknown>));
    return lines.join('\n');
  }

  lines.push('', String(payload));
  return lines.join('\n');
}

function formatRow(row: unknown): string {
  if (!row || typeof row !== 'object') {
    return `- ${String(row)}`;
  }

  const parts = Object.entries(row as Record<string, unknown>).map(
    ([key, value]) => `${key}=${formatScalar(value)}`,
  );
  return `- ${parts.join(' | ')}`;
}

function formatObject(value: Record<string, unknown>, indent = ''): string[] {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      lines.push(`${indent}${key}:`);
      if (entry.length === 0) {
        lines.push(`${indent}  []`);
        continue;
      }

      for (const item of entry) {
        if (item && typeof item === 'object') {
          lines.push(`${indent}  -`);
          lines.push(...formatObject(item as Record<string, unknown>, `${indent}    `));
        } else {
          lines.push(`${indent}  - ${formatScalar(item)}`);
        }
      }
      continue;
    }

    if (entry && typeof entry === 'object') {
      lines.push(`${indent}${key}:`);
      lines.push(...formatObject(entry as Record<string, unknown>, `${indent}  `));
      continue;
    }

    lines.push(`${indent}${key}: ${formatScalar(entry)}`);
  }

  return lines;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export function printHelp(): void {
  console.log(`Usage: tsx scripts/db-inspect/index.ts [command] [options]

Commands:
  diagnostics        Standardized non-destructive database diagnostics
  schema             List tables/views for a schema with row and size hints
  table              Show columns, indexes, and constraints for one table

Options:
  --schema <name>               Schema to inspect (default: public)
  --table <name>                Required for the table command
  --limit <n>                   Row limit for relation listings (default: ${DEFAULT_LIMIT})
  --json                        Shortcut for --format json
  --format <text|json>          Output format (default: text)
  --connection-string <value>   Override DATABASE_URL/SUPABASE_DATABASE_URL
  --help                        Show this message
`);
}
