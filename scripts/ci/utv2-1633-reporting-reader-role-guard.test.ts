/**
 * UTV2-1633 — static guards for the reporting_reader least-privilege role.
 *
 * These tests encode, mechanically, the properties the lane promised so they
 * cannot be quietly regressed later:
 *
 *   1. The role is granted SELECT on schema `reporting` only -- never
 *      INSERT/UPDATE/DELETE/TRUNCATE/CREATE anywhere, never anything on
 *      schema `public` (the reporting.* views are security-definer
 *      specifically so this role never needs base-table access -- granting
 *      it anything on public would reopen the exact path this role exists
 *      to remove).
 *   2. The role is NOLOGIN and holds no role-administration attribute
 *      (NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS).
 *   3. The migration is reversible: the down script drops the role and
 *      revokes everything it was granted, and does not touch the
 *      `reporting` schema itself (owned by UTV2-1399, not this migration).
 *
 * Per CLAUDE.md invariant 11: if a rule can be enforced mechanically, it must
 * not live only in prose.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MIGRATION = 'supabase/migrations/20260801000000_utv2_1633_reporting_reader_role.sql';
const ROLLBACK =
  'db/migrations-rollback/20260801000000_utv2_1633_reporting_reader_role.down.sql';

const migrationSql = readFileSync(MIGRATION, 'utf8');
const rollbackSql = readFileSync(ROLLBACK, 'utf8');

/** Strip `--` line comments so prose describing forbidden SQL is not matched. */
function executableSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const migrationCode = executableSql(migrationSql);
const rollbackCode = executableSql(rollbackSql);

test('UTV2-1633 migration creates a NOLOGIN role with no elevated attributes', () => {
  assert.match(migrationCode, /CREATE\s+ROLE\s+reporting_reader/i);
  assert.match(migrationCode, /\bNOLOGIN\b/i);
  assert.match(migrationCode, /\bNOSUPERUSER\b/i);
  assert.match(migrationCode, /\bNOCREATEDB\b/i);
  assert.match(migrationCode, /\bNOCREATEROLE\b/i);
  assert.match(migrationCode, /\bNOREPLICATION\b/i);
  assert.match(migrationCode, /\bNOBYPASSRLS\b/i);

  // The role must never be described as LOGIN, SUPERUSER, CREATEDB,
  // CREATEROLE, REPLICATION, or BYPASSRLS anywhere (a stray positive
  // attribute would silently elevate the role).
  const createRoleStatement = migrationCode.match(/CREATE\s+ROLE\s+reporting_reader[\s\S]*?;/i)?.[0] ?? '';
  assert.ok(createRoleStatement.length > 0, 'expected a CREATE ROLE reporting_reader statement');

  for (const positiveAttr of ['LOGIN', 'SUPERUSER', 'CREATEDB', 'CREATEROLE', 'REPLICATION', 'BYPASSRLS']) {
    const positiveRegex = new RegExp(`(?<!NO)\\b${positiveAttr}\\b`, 'i');
    assert.equal(
      positiveRegex.test(createRoleStatement),
      false,
      `CREATE ROLE reporting_reader must not carry the positive attribute ${positiveAttr}`,
    );
  }
});

/**
 * Extracts individual `GRANT ... ;` and `ALTER DEFAULT PRIVILEGES ... ;`
 * statements as standalone strings, so assertions can inspect one statement
 * at a time instead of using an open-ended character window that can
 * accidentally span into unrelated text.
 *
 * `startKeyword` is matched only when it is the first non-whitespace token
 * on its line (`^[ \t]*` anchor, multiline mode). In this codebase's SQL
 * style, every real top-level statement starts a fresh line, while prose
 * inside a multi-line RAISE EXCEPTION/NOTICE message is always a `'...'`
 * string-literal continuation line -- so a sentence that happens to contain
 * the word "grant" (e.g. "grant row(s)") can never be mistaken for a real
 * GRANT statement, because that line starts with `'`, not `GRANT`.
 */
function extractStatements(code: string, startKeyword: string): string[] {
  const statements: string[] = [];
  const pattern = new RegExp(`^[ \\t]*(${startKeyword})\\b`, 'gim');
  const starts = [...code.matchAll(pattern)];
  for (const match of starts) {
    const from = match.index! + match[0].indexOf(match[1]!);
    const rest = code.slice(from);
    const end = rest.indexOf(';');
    statements.push(end === -1 ? rest : rest.slice(0, end + 1));
  }
  return statements;
}

test('UTV2-1633 migration grants SELECT on reporting only, never public', () => {
  const grantStatements = extractStatements(migrationCode, 'GRANT');
  const alterDefaultStatements = extractStatements(migrationCode, 'ALTER\\s+DEFAULT\\s+PRIVILEGES');

  assert.ok(
    grantStatements.some((s) => /GRANT\s+USAGE\s+ON\s+SCHEMA\s+reporting\s+TO\s+reporting_reader/i.test(s)),
    'expected GRANT USAGE ON SCHEMA reporting TO reporting_reader',
  );
  assert.ok(
    grantStatements.some((s) =>
      /GRANT\s+SELECT\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+reporting\s+TO\s+reporting_reader/i.test(s),
    ),
    'expected GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader',
  );
  assert.ok(
    alterDefaultStatements.some((s) =>
      /IN\s+SCHEMA\s+reporting[\s\S]*GRANT\s+SELECT\s+ON\s+TABLES\s+TO\s+reporting_reader/i.test(s),
    ),
    'expected ALTER DEFAULT PRIVILEGES IN SCHEMA reporting ... GRANT SELECT ON TABLES TO reporting_reader',
  );
  assert.ok(
    grantStatements.some((s) => /GRANT\s+CONNECT\s+ON\s+DATABASE\s+\w+\s+TO\s+reporting_reader/i.test(s)),
    'expected GRANT CONNECT ON DATABASE ... TO reporting_reader',
  );

  // No GRANT or ALTER DEFAULT PRIVILEGES statement may reference schema
  // public or any public.<relation> at all -- checked per-statement, not
  // over an open window.
  for (const statement of [...grantStatements, ...alterDefaultStatements]) {
    assert.equal(
      /\bSCHEMA\s+public\b/i.test(statement),
      false,
      `statement must not reference schema public: ${statement}`,
    );
    assert.equal(
      /\bpublic\.\w+/i.test(statement),
      false,
      `statement must not reference a public.* relation: ${statement}`,
    );
    // Forbidden privilege verbs -- extract the actual comma-separated
    // privilege list immediately following GRANT (e.g. "SELECT" in
    // "GRANT SELECT ON ..."), not a substring match, so a legitimate phrase
    // like "ON ALL TABLES" cannot false-positive against the verb "ALL".
    const privilegeListMatch = statement.match(/GRANT\s+((?:\w+\s*,\s*)*\w+)\s+ON\b/i);
    const grantedPrivileges = privilegeListMatch
      ? privilegeListMatch[1]!.split(',').map((p) => p.trim().toUpperCase())
      : [];
    for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'CREATE', 'ALL']) {
      assert.equal(
        grantedPrivileges.includes(verb),
        false,
        `statement must never grant ${verb} to reporting_reader: ${statement}`,
      );
    }
  }

  // Every GRANT statement in this migration must target reporting_reader --
  // no incidental grant to any other role.
  for (const statement of grantStatements) {
    assert.match(
      statement,
      /TO\s+reporting_reader/i,
      `every GRANT in this migration must target reporting_reader: ${statement}`,
    );
  }
});

test('UTV2-1633 migration fails closed if schema reporting is missing', () => {
  assert.match(migrationCode, /RAISE\s+EXCEPTION[\s\S]{0,200}schema\s+"?reporting"?\s+does\s+not\s+exist/i);
});

test('UTV2-1633 migration verifies its own grant set before committing', () => {
  // The in-transaction sanity check must assert both a positive (reporting
  // SELECT exists) and a negative (zero grants on public) condition.
  assert.match(migrationCode, /role_table_grants/i);
  assert.match(migrationCode, /table_schema\s*=\s*'reporting'/i);
  assert.match(migrationCode, /table_schema\s*=\s*'public'/i);
  assert.match(migrationCode, /v_public_grant_count\s*>\s*0/i);
});

test('UTV2-1633 rollback drops the role and revokes every grant, touches nothing else', () => {
  assert.match(rollbackCode, /DROP\s+ROLE\s+IF\s+EXISTS\s+reporting_reader/i);
  assert.match(rollbackCode, /DROP\s+OWNED\s+BY\s+reporting_reader/i);
  assert.match(rollbackCode, /REVOKE\s+USAGE\s+ON\s+SCHEMA\s+reporting\s+FROM\s+reporting_reader/i);
  assert.match(rollbackCode, /REVOKE\s+SELECT\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+reporting\s+FROM\s+reporting_reader/i);
  assert.match(rollbackCode, /REVOKE\s+CONNECT\s+ON\s+DATABASE\s+postgres\s+FROM\s+reporting_reader/i);

  // The rollback must not be marked irreversible.
  assert.equal(
    /--\s*IRREVERSIBLE:/i.test(rollbackSql),
    false,
    'this migration is fully reversible; it must not claim an IRREVERSIBLE exemption',
  );

  const registry = JSON.parse(
    readFileSync('db/migrations-rollback/irreversible-exemption-registry.json', 'utf8'),
  ) as { exemptions: Array<{ migration: string }> };
  assert.equal(
    registry.exemptions.some((e) => e.migration.includes('utv2_1633')),
    false,
    'UTV2-1633 must not hold an irreversibility exemption',
  );

  // The rollback must never drop the reporting schema itself -- that belongs
  // to UTV2-1399, not this migration.
  assert.equal(
    /DROP\s+SCHEMA[\s\S]{0,40}reporting/i.test(rollbackCode),
    false,
    'rollback must never drop schema reporting -- it is owned by UTV2-1399, not this migration',
  );
  for (const pattern of [/\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bDROP\s+TABLE\b/i, /\bDROP\s+VIEW\b/i]) {
    assert.equal(
      pattern.test(rollbackCode),
      false,
      'rollback must only remove the role and its privileges; no data object may be touched',
    );
  }
});

test('UTV2-1633 migration creates no object outside the role itself (no CREATE TABLE/VIEW/SCHEMA)', () => {
  for (const pattern of [
    /\bCREATE\s+TABLE\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i,
    /\bCREATE\s+SCHEMA\b/i,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
  ]) {
    assert.equal(
      pattern.test(migrationCode),
      false,
      'this migration must create only the reporting_reader role -- no schema object of any kind',
    );
  }
});
