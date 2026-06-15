#!/usr/bin/env tsx
/**
 * Continuous schema parity verification for two Postgres databases.
 *
 * This script builds normalized schema snapshots for an expected database
 * (usually repo migrations applied to scratch Postgres) and an actual live
 * database (usually Supabase), then emits a machine-readable drift report.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'schema-parity');

type RelationKind = 'table' | 'partitioned_table' | 'view' | 'materialized_view';

interface RelationDefinition {
  schema: string;
  name: string;
  kind: RelationKind;
}

interface ColumnDefinition {
  schema: string;
  table: string;
  column: string;
  ordinalPosition: number;
  dataType: string;
  formattedType: string;
  defaultExpression: string | null;
  isNullable: boolean;
  identityGeneration: string | null;
}

interface ConstraintDefinition {
  schema: string;
  table: string;
  name: string;
  type: string;
  definition: string;
}

interface IndexDefinition {
  schema: string;
  table: string;
  name: string;
  definition: string;
}

interface PolicyDefinition {
  schema: string;
  table: string;
  name: string;
  command: string;
  permissive: string;
  roles: string[];
  usingExpression: string | null;
  withCheckExpression: string | null;
}

interface TriggerDefinition {
  schema: string;
  table: string;
  name: string;
  enabledMode: string;
  definition: string;
}

interface ExtensionDefinition {
  schema: string;
  name: string;
  version: string;
}

interface SchemaSnapshot {
  relations: RelationDefinition[];
  columns: ColumnDefinition[];
  constraints: ConstraintDefinition[];
  indexes: IndexDefinition[];
  policies: PolicyDefinition[];
  triggers: TriggerDefinition[];
  extensions: ExtensionDefinition[];
}

interface DriftEntry<TItem> {
  key: string;
  expected: TItem | null;
  actual: TItem | null;
}

interface CollectionDiff<TItem> {
  missing_in_actual: DriftEntry<TItem>[];
  missing_in_expected: DriftEntry<TItem>[];
  changed: DriftEntry<TItem>[];
}

interface SchemaDiff {
  relations: CollectionDiff<RelationDefinition>;
  columns: CollectionDiff<ColumnDefinition>;
  constraints: CollectionDiff<ConstraintDefinition>;
  indexes: CollectionDiff<IndexDefinition>;
  policies: CollectionDiff<PolicyDefinition>;
  triggers: CollectionDiff<TriggerDefinition>;
  extensions: CollectionDiff<ExtensionDefinition>;
}

interface CompareReport {
  generated_at: string;
  expected_label: string;
  actual_label: string;
  compared_schema: string;
  excluded_relation_pattern: string | null;
  drift_detected: boolean;
  drift_count: number;
  summary: Record<keyof SchemaDiff, { expected: number; actual: number; drift: number }>;
  diff: SchemaDiff;
}

interface CliOptions {
  expectedDbUrl: string;
  actualDbUrl: string;
  expectedLabel: string;
  actualLabel: string;
  schema: string;
  outputPath: string | null;
  // POSIX/JS regex matched against a relation's unqualified name. Relations whose
  // name matches — and all of their columns/constraints/indexes/policies/triggers —
  // are dropped from BOTH snapshots before diffing. Used to exclude dynamically
  // created partition children (e.g. provider_offer_history_p<YYYYMMDD>) that live
  // creates at runtime and the repo baseline intentionally does not bake in, so they
  // never read as perpetual drift. Narrow by construction; never a wildcard. (UTV2-1274)
  excludeRelationPattern: string | null;
}

interface ParsedArgs {
  options: CliOptions;
  pretty: boolean;
  help: boolean;
}

const JSON_QUERY = `
WITH relations AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS relation_name,
    CASE c.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'partitioned_table'
      WHEN 'v' THEN 'view'
      WHEN 'm' THEN 'materialized_view'
    END AS relation_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '__SCHEMA__'
    AND c.relkind IN ('r', 'p', 'v', 'm')
),
columns AS (
  SELECT
    cols.table_schema AS schema_name,
    cols.table_name,
    cols.column_name,
    cols.ordinal_position,
    cols.data_type,
    pg_catalog.format_type(attr.atttypid, attr.atttypmod) AS formatted_type,
    cols.column_default,
    cols.is_nullable,
    NULLIF(cols.identity_generation, '') AS identity_generation
  FROM information_schema.columns cols
  JOIN pg_namespace ns
    ON ns.nspname = cols.table_schema
  JOIN pg_class cls
    ON cls.relname = cols.table_name
   AND cls.relnamespace = ns.oid
  JOIN pg_attribute attr
    ON attr.attrelid = cls.oid
   AND attr.attname = cols.column_name
   AND attr.attnum > 0
   AND NOT attr.attisdropped
  WHERE cols.table_schema = '__SCHEMA__'
),
constraints AS (
  SELECT
    ns.nspname AS schema_name,
    cls.relname AS table_name,
    con.conname AS constraint_name,
    con.contype::text AS constraint_type,
    pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = '__SCHEMA__'
),
indexes AS (
  SELECT
    schemaname AS schema_name,
    tablename AS table_name,
    indexname AS index_name,
    indexdef AS definition
  FROM pg_indexes
  WHERE schemaname = '__SCHEMA__'
),
policies AS (
  SELECT
    schemaname AS schema_name,
    tablename AS table_name,
    policyname AS policy_name,
    cmd,
    permissive,
    roles,
    qual,
    with_check
  FROM pg_policies
  WHERE schemaname = '__SCHEMA__'
),
triggers AS (
  SELECT
    ns.nspname AS schema_name,
    cls.relname AS table_name,
    trg.tgname AS trigger_name,
    tgenabled::text AS enabled_mode,
    pg_get_triggerdef(trg.oid, true) AS definition
  FROM pg_trigger trg
  JOIN pg_class cls ON cls.oid = trg.tgrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = '__SCHEMA__'
    AND NOT trg.tgisinternal
),
extensions AS (
  SELECT
    ns.nspname AS schema_name,
    ext.extname AS extension_name,
    ext.extversion AS extension_version
  FROM pg_extension ext
  JOIN pg_namespace ns ON ns.oid = ext.extnamespace
)
SELECT json_build_object(
  'relations', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'name', relation_name,
      'kind', relation_kind
    ) ORDER BY schema_name, relation_name, relation_kind)
    FROM relations
  ), '[]'::json),
  'columns', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'table', table_name,
      'column', column_name,
      'ordinalPosition', ordinal_position,
      'dataType', data_type,
      'formattedType', formatted_type,
      'defaultExpression', column_default,
      'isNullable', is_nullable = 'YES',
      'identityGeneration', identity_generation
    ) ORDER BY schema_name, table_name, ordinal_position, column_name)
    FROM columns
  ), '[]'::json),
  'constraints', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'table', table_name,
      'name', constraint_name,
      'type', constraint_type,
      'definition', definition
    ) ORDER BY schema_name, table_name, constraint_name)
    FROM constraints
  ), '[]'::json),
  'indexes', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'table', table_name,
      'name', index_name,
      'definition', definition
    ) ORDER BY schema_name, table_name, index_name)
    FROM indexes
  ), '[]'::json),
  'policies', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'table', table_name,
      'name', policy_name,
      'command', cmd,
      'permissive', permissive,
      'roles', roles,
      'usingExpression', qual,
      'withCheckExpression', with_check
    ) ORDER BY schema_name, table_name, policy_name)
    FROM policies
  ), '[]'::json),
  'triggers', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'table', table_name,
      'name', trigger_name,
      'enabledMode', enabled_mode,
      'definition', definition
    ) ORDER BY schema_name, table_name, trigger_name)
    FROM triggers
  ), '[]'::json),
  'extensions', COALESCE((
    SELECT json_agg(json_build_object(
      'schema', schema_name,
      'name', extension_name,
      'version', extension_version
    ) ORDER BY schema_name, extension_name)
    FROM extensions
  ), '[]'::json)
);
`;

function parseEnvFile(filePath: string): Array<[string, string]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const entries: Array<[string, string]> = [];
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
    entries.push([key, value]);
  }

  return entries;
}

function loadEnvironment(rootDir = process.cwd()): Map<string, string> {
  const merged = new Map<string, string>();
  for (const envFile of ['.env.example', '.env', 'local.env']) {
    for (const [key, value] of parseEnvFile(path.join(rootDir, envFile))) {
      merged.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value) {
      merged.set(key, value);
    }
  }

  return merged;
}

function readEnv(env: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = env.get(key);
    if (value) {
      return value;
    }
  }
  return null;
}

function defaultOutputPath(timestamp: string): string {
  const safeTimestamp = timestamp.replaceAll(':', '-').replaceAll('.', '-');
  return path.join(DEFAULT_OUTPUT_DIR, `schema-parity-${safeTimestamp}.json`);
}

async function selectJson<T>(connectionString: string, sql: string): Promise<T> {
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
        PGOPTIONS: '-c default_transaction_read_only=on',
      },
    },
  );

  return JSON.parse(stdout.trim()) as T;
}

function buildSnapshotQuery(schema: string): string {
  return JSON_QUERY.replaceAll('__SCHEMA__', schema.replaceAll("'", "''"));
}

async function fetchSchemaSnapshot(connectionString: string, schema: string): Promise<SchemaSnapshot> {
  return selectJson<SchemaSnapshot>(connectionString, buildSnapshotQuery(schema));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

export function diffCollection<TItem>(
  expected: TItem[],
  actual: TItem[],
  keySelector: (item: TItem) => string,
): CollectionDiff<TItem> {
  const expectedMap = new Map(expected.map((item) => [keySelector(item), item]));
  const actualMap = new Map(actual.map((item) => [keySelector(item), item]));
  const keys = [...new Set([...expectedMap.keys(), ...actualMap.keys()])].sort();

  const diff: CollectionDiff<TItem> = {
    missing_in_actual: [],
    missing_in_expected: [],
    changed: [],
  };

  for (const key of keys) {
    const expectedItem = expectedMap.get(key) ?? null;
    const actualItem = actualMap.get(key) ?? null;

    if (expectedItem === null && actualItem !== null) {
      diff.missing_in_expected.push({ key, expected: null, actual: actualItem });
      continue;
    }

    if (expectedItem !== null && actualItem === null) {
      diff.missing_in_actual.push({ key, expected: expectedItem, actual: null });
      continue;
    }

    if (
      expectedItem !== null &&
      actualItem !== null &&
      stableStringify(expectedItem) !== stableStringify(actualItem)
    ) {
      diff.changed.push({ key, expected: expectedItem, actual: actualItem });
    }
  }

  return diff;
}

function relationKey(item: RelationDefinition): string {
  return `${item.schema}.${item.name}`;
}

function columnKey(item: ColumnDefinition): string {
  return `${item.schema}.${item.table}.${item.column}`;
}

function namedTableObjectKey(item: { schema: string; table: string; name: string }): string {
  return `${item.schema}.${item.table}.${item.name}`;
}

function constraintKey(item: ConstraintDefinition): string {
  return namedTableObjectKey(item);
}

function indexKey(item: IndexDefinition): string {
  return namedTableObjectKey(item);
}

function policyKey(item: PolicyDefinition): string {
  return namedTableObjectKey(item);
}

function triggerKey(item: TriggerDefinition): string {
  return namedTableObjectKey(item);
}

function extensionKey(item: ExtensionDefinition): string {
  return `${item.schema}.${item.name}`;
}

function driftCount<TItem>(collection: CollectionDiff<TItem>): number {
  return (
    collection.missing_in_actual.length +
    collection.missing_in_expected.length +
    collection.changed.length
  );
}

/**
 * Drop relations (and all of their relation-scoped objects) whose unqualified name
 * matches `pattern` from a snapshot. Extensions are schema-scoped, not relation-scoped,
 * so they are never filtered. Returns a new snapshot; the input is not mutated.
 *
 * This is the single, narrow exclusion point for dynamically created partition children
 * (see CliOptions.excludeRelationPattern). Keeping it in one place — rather than baking
 * the pattern into the snapshot SQL — keeps the exclusion auditable and unit-testable,
 * and the report records exactly which pattern was applied. (UTV2-1274)
 */
export function filterSnapshot(snapshot: SchemaSnapshot, pattern: RegExp | null): SchemaSnapshot {
  if (!pattern) {
    return snapshot;
  }

  const matches = (name: string): boolean => pattern.test(name);

  return {
    relations: snapshot.relations.filter((item) => !matches(item.name)),
    columns: snapshot.columns.filter((item) => !matches(item.table)),
    constraints: snapshot.constraints.filter((item) => !matches(item.table)),
    indexes: snapshot.indexes.filter((item) => !matches(item.table)),
    policies: snapshot.policies.filter((item) => !matches(item.table)),
    triggers: snapshot.triggers.filter((item) => !matches(item.table)),
    extensions: snapshot.extensions,
  };
}

export function buildSchemaDiff(expected: SchemaSnapshot, actual: SchemaSnapshot): SchemaDiff {
  return {
    relations: diffCollection(expected.relations, actual.relations, relationKey),
    columns: diffCollection(expected.columns, actual.columns, columnKey),
    constraints: diffCollection(expected.constraints, actual.constraints, constraintKey),
    indexes: diffCollection(expected.indexes, actual.indexes, indexKey),
    policies: diffCollection(expected.policies, actual.policies, policyKey),
    triggers: diffCollection(expected.triggers, actual.triggers, triggerKey),
    extensions: diffCollection(expected.extensions, actual.extensions, extensionKey),
  };
}

export function buildCompareReport(input: {
  expectedLabel: string;
  actualLabel: string;
  schema: string;
  expected: SchemaSnapshot;
  actual: SchemaSnapshot;
  excludedRelationPattern?: string | null;
  generatedAt?: string;
}): CompareReport {
  const diff = buildSchemaDiff(input.expected, input.actual);
  const summary = {
    relations: {
      expected: input.expected.relations.length,
      actual: input.actual.relations.length,
      drift: driftCount(diff.relations),
    },
    columns: {
      expected: input.expected.columns.length,
      actual: input.actual.columns.length,
      drift: driftCount(diff.columns),
    },
    constraints: {
      expected: input.expected.constraints.length,
      actual: input.actual.constraints.length,
      drift: driftCount(diff.constraints),
    },
    indexes: {
      expected: input.expected.indexes.length,
      actual: input.actual.indexes.length,
      drift: driftCount(diff.indexes),
    },
    policies: {
      expected: input.expected.policies.length,
      actual: input.actual.policies.length,
      drift: driftCount(diff.policies),
    },
    triggers: {
      expected: input.expected.triggers.length,
      actual: input.actual.triggers.length,
      drift: driftCount(diff.triggers),
    },
    extensions: {
      expected: input.expected.extensions.length,
      actual: input.actual.extensions.length,
      drift: driftCount(diff.extensions),
    },
  } satisfies CompareReport['summary'];

  const drift_count = Object.values(summary).reduce((total, item) => total + item.drift, 0);

  return {
    generated_at: input.generatedAt ?? new Date().toISOString(),
    expected_label: input.expectedLabel,
    actual_label: input.actualLabel,
    compared_schema: input.schema,
    excluded_relation_pattern: input.excludedRelationPattern ?? null,
    drift_detected: drift_count > 0,
    drift_count,
    summary,
    diff,
  };
}

function printSummary(report: CompareReport, outputPath: string | null): void {
  console.log('\nSchema parity verification');
  console.log('='.repeat(28));
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Expected:  ${report.expected_label}`);
  console.log(`Actual:    ${report.actual_label}`);
  console.log(`Schema:    ${report.compared_schema}`);
  if (report.excluded_relation_pattern) {
    console.log(`Excluded:  relations matching /${report.excluded_relation_pattern}/`);
  }
  if (outputPath) {
    console.log(`Report:    ${path.relative(process.cwd(), outputPath)}`);
  }
  console.log(`Drift:     ${report.drift_detected ? 'DETECTED' : 'CLEAN'} (${report.drift_count})`);

  for (const [collection, counts] of Object.entries(report.summary)) {
    console.log(
      `  ${collection}: expected=${counts.expected}, actual=${counts.actual}, drift=${counts.drift}`,
    );
  }
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/ops/compare-databases.ts [options]

Options:
  --expected-db-url <value>   Expected database connection string
  --actual-db-url <value>     Actual database connection string
  --expected-label <value>    Label for the expected database (default: expected)
  --actual-label <value>      Label for the actual database (default: actual)
  --schema <name>             Schema to compare (default: public)
  --output <path>             Write JSON report to an explicit path
  --exclude-relation-pattern <regex>
                              Drop relations whose unqualified name matches this regex
                              (and their columns/constraints/indexes/policies/triggers)
                              from both snapshots before diffing. Use for dynamically
                              created partition children. Narrow patterns only.
  --pretty                    Print a human-readable summary
  --help                      Show this message
`);
}

function writeReport(report: CompareReport, outputPath: string): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function parseArgs(argv: string[]): ParsedArgs {
  const env = loadEnvironment();
  const args = argv.slice(2);

  let expectedDbUrl =
    readEnv(env, ['EXPECTED_DATABASE_URL', 'SUPABASE_DATABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']) ??
    '';
  let actualDbUrl =
    readEnv(env, ['ACTUAL_DATABASE_URL', 'LIVE_DATABASE_URL', 'HETZNER_DATABASE_URL']) ?? '';
  let expectedLabel = 'expected';
  let actualLabel = 'actual';
  let schema = 'public';
  let outputPath: string | null = null;
  let excludeRelationPattern: string | null = null;
  let pretty = false;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--help') {
      help = true;
    } else if (arg === '--expected-db-url' && next) {
      expectedDbUrl = next;
      index++;
    } else if (arg === '--actual-db-url' && next) {
      actualDbUrl = next;
      index++;
    } else if (arg === '--expected-label' && next) {
      expectedLabel = next;
      index++;
    } else if (arg === '--actual-label' && next) {
      actualLabel = next;
      index++;
    } else if (arg === '--schema' && next) {
      schema = next;
      index++;
    } else if (arg === '--output' && next) {
      outputPath = path.resolve(next);
      index++;
    } else if (arg === '--exclude-relation-pattern' && next) {
      excludeRelationPattern = next;
      index++;
    } else if (arg === '--pretty') {
      pretty = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!help && !expectedDbUrl) {
    throw new Error(
      'Missing expected database URL. Set EXPECTED_DATABASE_URL or pass --expected-db-url.',
    );
  }

  if (!help && !actualDbUrl) {
    throw new Error(
      'Missing actual database URL. Set ACTUAL_DATABASE_URL or pass --actual-db-url.',
    );
  }

  return {
    options: {
      expectedDbUrl,
      actualDbUrl,
      expectedLabel,
      actualLabel,
      schema,
      outputPath,
      excludeRelationPattern,
    },
    pretty,
    help,
  };
}

export async function runCompare(options: CliOptions): Promise<CompareReport> {
  const [expectedSnapshot, actualSnapshot] = await Promise.all([
    fetchSchemaSnapshot(options.expectedDbUrl, options.schema),
    fetchSchemaSnapshot(options.actualDbUrl, options.schema),
  ]);

  // Compile the exclusion regex up front so an invalid pattern fails loudly rather
  // than silently comparing un-filtered snapshots (fail-closed). (UTV2-1274)
  const excludePattern = options.excludeRelationPattern
    ? new RegExp(options.excludeRelationPattern)
    : null;

  return buildCompareReport({
    expectedLabel: options.expectedLabel,
    actualLabel: options.actualLabel,
    schema: options.schema,
    expected: filterSnapshot(expectedSnapshot, excludePattern),
    actual: filterSnapshot(actualSnapshot, excludePattern),
    excludedRelationPattern: options.excludeRelationPattern,
  });
}

async function main(): Promise<void> {
  const { options, pretty, help } = parseArgs(process.argv);
  if (help) {
    printHelp();
    return;
  }
  const report = await runCompare(options);
  const outputPath = writeReport(
    report,
    options.outputPath ?? defaultOutputPath(report.generated_at),
  );

  if (pretty) {
    printSummary(report, outputPath);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.drift_detected) {
    process.exitCode = 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[compare-databases] ${message}`);
    process.exit(1);
  });
}
