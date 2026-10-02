#!/usr/bin/env tsx
/**
 * Production post-migration verification.
 *
 * This is deliberately not a test suite. Writable DB proof remains confined to
 * staging. Production is inspected through the existing warehouse_reader login,
 * whose role default is read-only, and every catalog probe is additionally run
 * inside a transaction that PostgreSQL reports as read-only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
} from '@unit-talk/db';

export const RECEIPT_SCHEMA = 'unit-talk-production-post-migration/v1';
export const READ_ONLY_PREAMBLE = 'SET TRANSACTION READ ONLY';
export const READ_ONLY_STATE_SQL = 'SHOW transaction_read_only';
export const EXPECTED_MIGRATION_VERSION = '20260928131714';
export const EXPECTED_REPOSITORY = 'griff843/Unit-Talk-v2';
export const EXPECTED_WORKFLOW_REF_PREFIX =
  `${EXPECTED_REPOSITORY}/.github/workflows/production-post-migration-verify.yml@`;

const PHASE_ROLES = [
  'warehouse_retention_planner',
  'warehouse_retention_executor',
  'warehouse_retention_recovery',
] as const;

export const ACCEPTED_IMMUTABILITY_TRIGGER_STATES = ['O', 'A'] as const;

export function isAcceptedImmutabilityTriggerState(state: string): boolean {
  return (ACCEPTED_IMMUTABILITY_TRIGGER_STATES as readonly string[]).includes(state);
}

function acceptedTriggerStateSql(column: string): string {
  return `${column} IN (${ACCEPTED_IMMUTABILITY_TRIGGER_STATES.map((state) => `'${state}'`).join(', ')})`;
}

const PLAN_FUNCTION =
  'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)';
const EXECUTE_FUNCTION =
  'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)';
const RECOVER_FUNCTION =
  'public.warehouse_retention_recover_window(uuid,jsonb,text,text,timestamptz,text)';

export const DB_FACTS_SQL = `
SELECT json_build_object(
  'current_user', current_user,
  'transaction_read_only', current_setting('transaction_read_only'),
  'objects_present',
    to_regclass('public.warehouse_retention_plans') IS NOT NULL
    AND to_regclass('public.warehouse_retention_executions') IS NOT NULL
    AND to_regclass('public.warehouse_retention_recoveries') IS NOT NULL
    AND to_regprocedure('public.warehouse_retention_control_immutable()') IS NOT NULL
    AND to_regprocedure('public.warehouse_retention_source_config(text)') IS NOT NULL
    AND to_regprocedure('public.warehouse_retention_assert_fk_contract(text)') IS NOT NULL
    AND to_regprocedure('public.warehouse_retention_window_counts(text,timestamptz,timestamptz)') IS NOT NULL
    AND to_regprocedure('${PLAN_FUNCTION}') IS NOT NULL
    AND to_regprocedure('${EXECUTE_FUNCTION}') IS NOT NULL
    AND to_regprocedure('${RECOVER_FUNCTION}') IS NOT NULL,
  'phase_roles_inert', (
    SELECT count(*) = 3 AND bool_and(
      NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
    )
    FROM pg_catalog.pg_roles
    WHERE rolname = ANY(ARRAY['${PHASE_ROLES.join("','")}'])
  ),
  'phase_roles_have_no_memberships', NOT EXISTS (
    WITH RECURSIVE phase_role_membership_paths AS (
      SELECT
        phase_role.rolname AS phase_role,
        membership.roleid AS reachable_role_oid,
        ARRAY[membership.member, membership.roleid]::oid[] AS membership_path
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles phase_role ON phase_role.oid = membership.member
      WHERE phase_role.rolname = ANY(ARRAY['${PHASE_ROLES.join("','")}'])

      UNION ALL

      SELECT
        membership_path.phase_role,
        membership.roleid,
        membership_path.membership_path || membership.roleid
      FROM phase_role_membership_paths membership_path
      JOIN pg_catalog.pg_auth_members membership
        ON membership.member = membership_path.reachable_role_oid
      WHERE NOT membership.roleid = ANY(membership_path.membership_path)
    )
    SELECT 1 FROM phase_role_membership_paths
  ),
  'phase_privileges_exact',
    has_function_privilege('warehouse_retention_planner', '${PLAN_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_planner', '${EXECUTE_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_planner', '${RECOVER_FUNCTION}', 'EXECUTE')
    AND has_function_privilege('warehouse_retention_executor', '${EXECUTE_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_executor', '${PLAN_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_executor', '${RECOVER_FUNCTION}', 'EXECUTE')
    AND has_function_privilege('warehouse_retention_recovery', '${RECOVER_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_recovery', '${PLAN_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege('warehouse_retention_recovery', '${EXECUTE_FUNCTION}', 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY['${PHASE_ROLES.join("','")}']) AS r(role_name)
      CROSS JOIN unnest(ARRAY[
        'public.warehouse_retention_control_immutable()',
        'public.warehouse_retention_source_config(text)',
        'public.warehouse_retention_assert_fk_contract(text)',
        'public.warehouse_retention_window_counts(text,timestamptz,timestamptz)'
      ]) AS f(function_signature)
      WHERE has_function_privilege(r.role_name, f.function_signature, 'EXECUTE')
    ),
  'phase_roles_have_no_direct_dml', NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['${PHASE_ROLES.join("','")}']) AS r(role_name)
    CROSS JOIN unnest(ARRAY[
      'provider_offer_history', 'provider_offers_legacy_quarantine', 'raw_payloads',
      'odds_snapshots', 'system_runs', 'warehouse_retention_plans',
      'warehouse_retention_executions', 'warehouse_retention_recoveries'
    ]) AS t(table_name)
    WHERE has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRUNCATE')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'REFERENCES')
       OR has_table_privilege(r.role_name, 'public.' || t.table_name, 'TRIGGER')
  ),
  'data_api_execute_denied', NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role_name)
    JOIN pg_catalog.pg_roles pr ON pr.rolname = r.role_name
    WHERE has_function_privilege(r.role_name, '${PLAN_FUNCTION}', 'EXECUTE')
       OR has_function_privilege(r.role_name, '${EXECUTE_FUNCTION}', 'EXECUTE')
       OR has_function_privilege(r.role_name, '${RECOVER_FUNCTION}', 'EXECUTE')
  ),
  'public_execute_denied', NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'warehouse_retention_plan_window',
        'warehouse_retention_execute_window',
        'warehouse_retention_recover_window'
      ])
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  'reader_is_least_privilege',
    current_user = 'warehouse_reader'
    AND NOT has_function_privilege(current_user, '${PLAN_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege(current_user, '${EXECUTE_FUNCTION}', 'EXECUTE')
    AND NOT has_function_privilege(current_user, '${RECOVER_FUNCTION}', 'EXECUTE')
    AND has_table_privilege(current_user, 'public.provider_offers_legacy_quarantine', 'SELECT')
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'provider_offer_history', 'provider_offers_legacy_quarantine', 'raw_payloads',
        'odds_snapshots', 'system_runs', 'warehouse_retention_plans',
        'warehouse_retention_executions', 'warehouse_retention_recoveries'
      ]) AS t(table_name)
      WHERE has_table_privilege(current_user, 'public.' || t.table_name, 'INSERT')
         OR has_table_privilege(current_user, 'public.' || t.table_name, 'UPDATE')
         OR has_table_privilege(current_user, 'public.' || t.table_name, 'DELETE')
         OR has_table_privilege(current_user, 'public.' || t.table_name, 'TRUNCATE')
    ),
  'control_tables_rls', (
    SELECT count(*) = 3 AND bool_and(relrowsecurity)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY[
        'warehouse_retention_plans', 'warehouse_retention_executions',
        'warehouse_retention_recoveries'
      ])
  ),
  'control_immutability_triggers', (
    SELECT count(t.oid) = 3 AND bool_and(
      table_namespace.nspname = 'public'
      AND table_relation.relname = expected.table_name
      AND function_namespace.nspname = 'public'
      AND trigger_function.proname = 'warehouse_retention_control_immutable'
      AND ${acceptedTriggerStateSql('t.tgenabled')}
    )
    FROM (VALUES
      ('warehouse_retention_plans_immutable', 'warehouse_retention_plans'),
      ('warehouse_retention_executions_immutable', 'warehouse_retention_executions'),
      ('warehouse_retention_recoveries_immutable', 'warehouse_retention_recoveries')
    ) AS expected(trigger_name, table_name)
    LEFT JOIN pg_catalog.pg_trigger t
      ON t.tgname = expected.trigger_name AND NOT t.tgisinternal
    LEFT JOIN pg_catalog.pg_class table_relation ON table_relation.oid = t.tgrelid
    LEFT JOIN pg_catalog.pg_namespace table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    LEFT JOIN pg_catalog.pg_proc trigger_function ON trigger_function.oid = t.tgfoid
    LEFT JOIN pg_catalog.pg_namespace function_namespace
      ON function_namespace.oid = trigger_function.pronamespace
  ),
  'runtime_functions_security_definer', (
    SELECT count(*) = 3 AND bool_and(prosecdef)
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'warehouse_retention_plan_window',
        'warehouse_retention_execute_window',
        'warehouse_retention_recover_window'
      ])
  )
) AS facts
`;

export interface LedgerEvidence {
  aligned: boolean;
  expectedVersion: string;
  local: string[];
  remote: string[];
}

export interface DatabaseFacts {
  current_user: string;
  transaction_read_only: string;
  objects_present: boolean;
  phase_roles_inert: boolean;
  phase_roles_have_no_memberships: boolean;
  phase_privileges_exact: boolean;
  phase_roles_have_no_direct_dml: boolean;
  data_api_execute_denied: boolean;
  public_execute_denied: boolean;
  reader_is_least_privilege: boolean;
  control_tables_rls: boolean;
  control_immutability_triggers: boolean;
  runtime_functions_security_definer: boolean;
}

export interface VerificationReceipt {
  schema: typeof RECEIPT_SCHEMA;
  environment: 'production';
  project_ref: string;
  migration_version: string;
  generated_at: string;
  github: {
    repository: string | null;
    workflow_ref: string | null;
    event_name: string | null;
    ref: string | null;
    run_id: string | null;
    run_attempt: string | null;
    job: string | null;
    sha: string | null;
  };
  read_only: true;
  mutated: false;
  ledger: LedgerEvidence;
  database: DatabaseFacts;
  live_schema_parity: { required: true; evidence: 'separate-authoritative-workflow-run-and-job' };
  verdict: 'PASS' | 'FAIL';
}

const FORBIDDEN_SQL_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'drop',
  'alter',
  'create',
  'replace',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'vacuum',
  'analyze',
  'reindex',
  'cluster',
  'refresh',
  'lock',
  'reset',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'listen',
  'notify',
  'prepare',
  'execute',
  'deallocate',
  'discard',
] as const;

const READ_ONLY_FUNCTIONS = new Set([
  'acldefault',
  'aclexplode',
  'bool_and',
  'coalesce',
  'count',
  'current_setting',
  'has_function_privilege',
  'has_table_privilege',
  'json_build_object',
  'to_regclass',
  'to_regprocedure',
  'unnest',
]);

const NON_CALL_KEYWORDS = new Set([
  'all',
  'and',
  'any',
  'array',
  'as',
  'case',
  'cross',
  'exists',
  'from',
  'in',
  'join',
  'not',
  'or',
  'select',
  'values',
  'where',
]);

function stripSqlLiteralsAndComments(sql: string): string {
  let output = '';
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      if (close === -1) throw new Error('production verifier refused unterminated SQL comment');
      index = close + 2;
      continue;
    }
    const character = sql[index] as string;
    if (character === "'" || character === '"') {
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === character) {
          if (sql[index + 1] === character) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error('production verifier refused unterminated SQL literal');
      output += ' ';
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function assertOnlyReadOnlyFunctions(sql: string): void {
  const callPattern = /(?:(?<schema>[a-z_][a-z0-9_$]*)\s*\.\s*)?(?<name>[a-z_][a-z0-9_$]*)\s*\(/giu;
  for (const match of sql.matchAll(callPattern)) {
    const schema = match.groups?.['schema']?.toLowerCase() ?? null;
    const name = match.groups?.['name']?.toLowerCase() ?? '';
    const prefix = sql.slice(0, match.index).trimEnd();
    if (NON_CALL_KEYWORDS.has(name) || /(?:\bas|\))$/iu.test(prefix)) continue;
    if (schema && schema !== 'pg_catalog') {
      throw new Error(`production verifier refused function outside pg_catalog: ${schema}.${name}`);
    }
    if (!READ_ONLY_FUNCTIONS.has(name)) {
      throw new Error(`production verifier refused non-allowlisted function: ${name}`);
    }
  }
}

export function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim().replace(/;$/u, '').trim();
  if (normalized === READ_ONLY_PREAMBLE || normalized === READ_ONLY_STATE_SQL) return;

  const code = stripSqlLiteralsAndComments(normalized);
  if (!/^SELECT\b/iu.test(code) || code.includes(';')) {
    throw new Error(`production verifier refused non-read-only SQL: ${normalized.slice(0, 48)}`);
  }
  for (const keyword of FORBIDDEN_SQL_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'iu').test(code)) {
      throw new Error(`production verifier refused non-read-only SQL keyword: ${keyword}`);
    }
  }
  if (/\bselect\b[\s\S]*\binto\b/iu.test(code)) {
    throw new Error('production verifier refused SELECT INTO');
  }
  assertOnlyReadOnlyFunctions(code);
}

export function assertProductionIdentity(apiUrl: string, dsn: string): void {
  const apiRef = extractProjectRefFromUrl(apiUrl).projectRef;
  if (apiRef !== CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(`production verifier refused API project ref ${apiRef ?? 'unidentified'}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error('production verifier refused an unparseable reader DSN');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('production verifier requires a PostgreSQL reader DSN');
  }

  const username = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname.toLowerCase();
  const directMatch = /^db\.([a-z0-9]{20})\.supabase\.co$/u.exec(hostname);
  const poolerMatch = /^warehouse_reader\.([a-z0-9]{20})$/u.exec(username);
  const directRef = directMatch?.[1] ?? null;
  const poolerRef = poolerMatch?.[1] ?? null;
  const roleIsReader = username === 'warehouse_reader' || poolerRef !== null;
  const dsnRef = directRef ?? poolerRef;

  if (!roleIsReader || dsnRef !== CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(
      `production verifier requires warehouse_reader bound to ${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}`,
    );
  }
  const poolerHostIsCanonical = /^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$/u.test(hostname);
  if (poolerRef && !poolerHostIsCanonical) {
    throw new Error('production verifier refused a non-Supabase pooler host');
  }
  if (directRef && poolerRef && directRef !== poolerRef) {
    throw new Error('production verifier refused conflicting DSN project identities');
  }
}

export function assertLedgerCredentialMode(ledgerPath: string | null, accessToken: string): void {
  if (ledgerPath && accessToken) {
    throw new Error('production verifier refused SUPABASE_ACCESS_TOKEN in ledger-file mode');
  }
  if (!ledgerPath && !accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required when the verifier captures the ledger');
  }
}

export function buildPsqlEnvironment(
  environment: NodeJS.ProcessEnv,
  dsn: string,
): NodeJS.ProcessEnv {
  // main validates canonical production identity before invoking this mapper.
  const parsed = new URL(dsn);
  const sslModes = parsed.searchParams.getAll('sslmode');
  const sslMode = sslModes[0] ?? 'require';
  if (sslModes.length > 1 || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new Error('production verifier refused insecure or ambiguous SSL mode');
  }
  if ([...parsed.searchParams.keys()].some((key) => key !== 'sslmode') || parsed.hash) {
    throw new Error('production verifier refused unsupported reader DSN options');
  }
  let database: string;
  let username: string;
  let password: string;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
    username = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('production verifier refused malformed reader DSN encoding');
  }
  if (!database || database.includes('/') || !password ||
      [database, username, password].some((value) => [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      }))) {
    throw new Error('production verifier requires an explicit database and reader password');
  }
  // PGDATABASE alone does not expand a URI in this psql/libpq path. Resolve
  // every connection field explicitly, and discard inherited libpq/service
  // overrides so they cannot redirect the already validated reader identity.
  const childEnvironment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: username,
    PGPASSWORD: password,
    PGDATABASE: database,
    PGSSLMODE: sslMode,
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000',
  };
  delete childEnvironment['SUPABASE_ACCESS_TOKEN'];
  delete childEnvironment['UNIT_TALK_WAREHOUSE_SOURCE_DSN'];
  return childEnvironment;
}

export function buildPsqlArguments(): string[] {
  return [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--single-transaction',
    '--command',
    `${READ_ONLY_PREAMBLE}; ${READ_ONLY_STATE_SQL}; ${DB_FACTS_SQL}`,
  ];
}

function migrationPrefixes(): string[] {
  return readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.split('_', 1)[0] ?? '')
    .filter((value) => /^\d{12,14}$/u.test(value))
    .sort();
}

export function parseMigrationLedger(
  output: string,
  expectedVersion = EXPECTED_MIGRATION_VERSION,
  local = migrationPrefixes(),
): LedgerEvidence {
  const remote: string[] = [];
  const cliLocal: string[] = [];
  let malformedVersionCell = false;
  const normalizeVersionCell = (cell: string): string | null => {
    const normalized = /^`[^`]*`$/u.test(cell) ? cell.slice(1, -1) : cell;
    return /^\d{12,14}$/u.test(normalized) ? normalized : null;
  };
  for (const rawLine of output.split('\n')) {
    const columns = rawLine.split('|').map((part) => part.trim());
    if (columns.length < 2) continue;
    const localCell = columns[0] ?? '';
    const remoteCell = columns[1] ?? '';
    if (localCell === 'Local' && remoteCell === 'Remote') continue;
    if (/^[-:\s]+$/u.test(localCell) && /^[-:\s]+$/u.test(remoteCell)) continue;
    const localVersion = normalizeVersionCell(localCell);
    const remoteVersion = normalizeVersionCell(remoteCell);
    if ((localCell && !localVersion) || (remoteCell && !remoteVersion)) malformedVersionCell = true;
    if (localVersion) cliLocal.push(localVersion);
    if (remoteVersion) remote.push(remoteVersion);
  }
  const sortedLocal = [...new Set(local)].sort();
  const sortedCliLocal = [...new Set(cliLocal)].sort();
  const sortedRemote = [...new Set(remote)].sort();
  const aligned =
    !malformedVersionCell &&
    sortedLocal.length > 0 &&
    JSON.stringify(sortedLocal) === JSON.stringify(sortedCliLocal) &&
    JSON.stringify(sortedLocal) === JSON.stringify(sortedRemote) &&
    sortedRemote.includes(expectedVersion);
  return { aligned, expectedVersion, local: sortedLocal, remote: sortedRemote };
}

const REQUIRED_FACTS: Array<keyof DatabaseFacts> = [
  'objects_present',
  'phase_roles_inert',
  'phase_roles_have_no_memberships',
  'phase_privileges_exact',
  'phase_roles_have_no_direct_dml',
  'data_api_execute_denied',
  'public_execute_denied',
  'reader_is_least_privilege',
  'control_tables_rls',
  'control_immutability_triggers',
  'runtime_functions_security_definer',
];

export function receiptPasses(receipt: VerificationReceipt): boolean {
  return (
    receipt.schema === RECEIPT_SCHEMA &&
    receipt.environment === 'production' &&
    receipt.project_ref === CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF &&
    receipt.github.repository === EXPECTED_REPOSITORY &&
    receipt.github.workflow_ref === `${EXPECTED_WORKFLOW_REF_PREFIX}refs/heads/main` &&
    receipt.github.event_name === 'workflow_dispatch' &&
    receipt.github.ref === 'refs/heads/main' &&
    /^\d+$/u.test(receipt.github.run_id ?? '') &&
    /^\d+$/u.test(receipt.github.run_attempt ?? '') &&
    receipt.github.job === 'verify' &&
    /^[0-9a-f]{40}$/u.test(receipt.github.sha ?? '') &&
    receipt.read_only === true &&
    receipt.mutated === false &&
    receipt.migration_version === EXPECTED_MIGRATION_VERSION &&
    receipt.ledger.aligned &&
    receipt.ledger.expectedVersion === EXPECTED_MIGRATION_VERSION &&
    receipt.ledger.local.includes(EXPECTED_MIGRATION_VERSION) &&
    receipt.ledger.remote.includes(EXPECTED_MIGRATION_VERSION) &&
    receipt.database.current_user === 'warehouse_reader' &&
    receipt.database.transaction_read_only === 'on' &&
    REQUIRED_FACTS.every((key) => receipt.database[key] === true)
  );
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const dsn = process.env['UNIT_TALK_WAREHOUSE_SOURCE_DSN'] ?? '';
  const apiUrl = process.env['SUPABASE_URL'] ?? '';
  const token = process.env['SUPABASE_ACCESS_TOKEN'] ?? '';
  const receiptPath = readArg('--receipt') ?? 'artifacts/production-post-migration-verification.json';
  const ledgerPath = readArg('--ledger-file');

  if (!dsn || !apiUrl) {
    throw new Error('SUPABASE_URL and UNIT_TALK_WAREHOUSE_SOURCE_DSN are required');
  }
  assertLedgerCredentialMode(ledgerPath, token);
  assertProductionIdentity(apiUrl, dsn);
  for (const statement of [READ_ONLY_PREAMBLE, READ_ONLY_STATE_SQL, DB_FACTS_SQL]) {
    assertReadOnlyStatement(statement);
  }

  const ledgerOutput = ledgerPath
    ? readFileSync(ledgerPath, 'utf8')
    : execFileSync('supabase', ['migration', 'list', '--linked'], {
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        timeout: 60_000,
      });
  const ledger = parseMigrationLedger(ledgerOutput);

  // PGOPTIONS makes the session read-only before psql can issue its first
  // statement. SET TRANSACTION READ ONLY inside --single-transaction is a
  // second, independently observed guard. The connection string stays out of
  // argv and logs.
  const databaseOutput = execFileSync(
    'psql',
    buildPsqlArguments(),
    {
      encoding: 'utf8',
      env: buildPsqlEnvironment(process.env, dsn),
      timeout: 30_000,
    },
  );
  const outputLines = databaseOutput.split('\n').map((line) => line.trim()).filter(Boolean);
  if (outputLines[0] !== 'on') {
    throw new Error('PostgreSQL did not report transaction_read_only=on');
  }
  const facts = JSON.parse(outputLines.at(-1) ?? 'null') as DatabaseFacts | null;
  if (!facts) throw new Error('production schema probe returned no facts');

  const provisional: VerificationReceipt = {
    schema: RECEIPT_SCHEMA,
    environment: 'production',
    project_ref: CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
    migration_version: EXPECTED_MIGRATION_VERSION,
    generated_at: new Date().toISOString(),
    github: {
      repository: process.env['GITHUB_REPOSITORY'] ?? null,
      workflow_ref: process.env['GITHUB_WORKFLOW_REF'] ?? null,
      event_name: process.env['GITHUB_EVENT_NAME'] ?? null,
      ref: process.env['GITHUB_REF'] ?? null,
      run_id: process.env['GITHUB_RUN_ID'] ?? null,
      run_attempt: process.env['GITHUB_RUN_ATTEMPT'] ?? null,
      job: process.env['GITHUB_JOB'] ?? null,
      sha: process.env['GITHUB_SHA'] ?? null,
    },
    read_only: true,
    mutated: false,
    ledger,
    database: facts,
    live_schema_parity: {
      required: true,
      evidence: 'separate-authoritative-workflow-run-and-job',
    },
    verdict: 'FAIL',
  };
  provisional.verdict = receiptPasses(provisional) ? 'PASS' : 'FAIL';
  mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(provisional, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(provisional, null, 2)}\n`);
  if (provisional.verdict !== 'PASS') process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`[production-post-migration-verify] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
