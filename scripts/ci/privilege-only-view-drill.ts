/**
 * WORK-2026102205 — positively assert a privilege-only view migration.
 *
 * A policy marker selects this drill, but never grants an exemption. The SQL must
 * first pass a mechanical, single-view classifier. The drill then proves the
 * declared state on scratch Postgres and proves exact up/down/up parity.
 */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const IDENT = '[a-z_][a-z0-9_$]*';
const QUALIFIED_IDENT = `${IDENT}\\.${IDENT}`;
const MARKER = new RegExp(
  `^[ \\t]*--[ \\t]*PRIVILEGE-ONLY-VIEW:[ \\t]*(${QUALIFIED_IDENT})[ \\t]+` +
    'security_invoker=(true|false)[ \\t]+anon=(none|select|all)[ \\t]+' +
    'authenticated=(none|select|all)[ \\t]+service_role=(none|select|all)[ \\t]*$',
  'gim',
);
const PRECONDITION_MARKER = /^[ \t]*--[ \t]*FAIL-CLOSED-PRECONDITION:/im;
const EXEMPTION_MARKER = /^[ \t]*--[ \t]*NO-PRECONDITION-REQUIRED:/im;
const PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const;
const ROLES = ['anon', 'authenticated', 'service_role'] as const;
type Privilege = (typeof PRIVILEGES)[number];
type Role = (typeof ROLES)[number];
type Posture = 'none' | 'select' | 'all';

export interface PrivilegeOnlyViewPolicy {
  readonly view: string;
  readonly securityInvoker: boolean;
  readonly roles: Readonly<Record<Role, Posture>>;
}

export type PrivilegeOnlyClassification =
  | { readonly kind: 'ordinary'; readonly errors: readonly [] }
  | {
      readonly kind: 'valid';
      readonly policy: PrivilegeOnlyViewPolicy;
      readonly statements: readonly string[];
      readonly errors: readonly [];
    }
  | {
      readonly kind: 'invalid';
      readonly policy?: PrivilegeOnlyViewPolicy;
      readonly errors: readonly string[];
    };

export interface PrivilegeDrillCase {
  readonly name: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

/** Split at executable top-level semicolons, ignoring comments and quoted bodies. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;
  let single = false;
  let double = false;
  let lineComment = false;
  let blockDepth = 0;
  let dollarTag: string | null = null;

  while (index < sql.length) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        current += ' ';
      }
      index += 1;
      continue;
    }
    if (blockDepth > 0) {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        index += 2;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        index += 2;
      } else index += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        current += char;
        index += 1;
      }
      continue;
    }
    if (single) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 2;
      } else {
        if (char === "'") single = false;
        index += 1;
      }
      continue;
    }
    if (double) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        index += 2;
      } else {
        if (char === '"') double = false;
        index += 1;
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      blockDepth = 1;
      index += 2;
      continue;
    }
    if (char === "'") {
      single = true;
      current += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      double = true;
      current += char;
      index += 1;
      continue;
    }
    if (char === '$') {
      const match = /^\$[a-z_][a-z0-9_]*\$|^\$\$/i.exec(sql.slice(index));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseMarker(sql: string): {
  policy?: PrivilegeOnlyViewPolicy;
  errors: string[];
} {
  const matches = [...sql.matchAll(MARKER)];
  if (matches.length === 0) return { errors: [] };
  if (matches.length !== 1)
    return { errors: ['exactly one PRIVILEGE-ONLY-VIEW marker is required'] };
  const match = matches[0]!;
  return {
    policy: {
      view: match[1]!.toLowerCase(),
      securityInvoker: match[2]!.toLowerCase() === 'true',
      roles: {
        anon: match[3]!.toLowerCase() as Posture,
        authenticated: match[4]!.toLowerCase() as Posture,
        service_role: match[5]!.toLowerCase() as Posture,
      },
    },
    errors: [],
  };
}

function sqlStrings(value: string): string[] {
  const values: string[] = [];
  for (const match of value.matchAll(/'((?:''|[^'])*)'/g))
    values.push((match[1] ?? '').replaceAll("''", "'"));
  return values;
}

function stripPlpgsqlComments(value: string): string {
  let result = '';
  let index = 0;
  let single = false;
  let blockDepth = 0;
  while (index < value.length) {
    const char = value[index] ?? '';
    const next = value[index + 1] ?? '';
    if (blockDepth > 0) {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        index += 2;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        index += 2;
      } else index += 1;
      continue;
    }
    if (!single && char === '-' && next === '-') {
      index += 2;
      while (index < value.length && value[index] !== '\n') index += 1;
      result += ' ';
      continue;
    }
    if (!single && char === '/' && next === '*') {
      blockDepth = 1;
      index += 2;
      continue;
    }
    result += char;
    if (char === "'") {
      if (single && next === "'") {
        result += next;
        index += 2;
        continue;
      }
      single = !single;
    }
    index += 1;
  }
  return result;
}

function validateDoBlock(statement: string, target: string): string[] {
  const match = /^DO\s+(\$[a-z_][a-z0-9_]*\$|\$\$)([\s\S]*)\1$/i.exec(
    statement.trim(),
  );
  if (!match) return ['DO block must use one closed dollar-quoted body'];
  const rawBody = match[2] ?? '';
  const body = stripPlpgsqlComments(rawBody);
  const errors: string[] = [];

  // The lexer above only understands single quotes and comments. Double-quoted
  // identifiers, backslashes (E'' escapes), nested dollar-quoted strings and U&
  // forms let attacker text hide
  // behind a fake comment marker, so none is admitted in a guard block.
  if (/["\\$]/.test(rawBody) || /\bU&/i.test(rawBody))
    errors.push(
      'DO block must not contain double quotes, backslashes, dollar signs or U& literals',
    );

  if (
    /\b(?:CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|MERGE|COPY|CALL|PERFORM)\b/i.test(
      body.replace(/'((?:''|[^'])*)'/g, "''"),
    )
  )
    errors.push('DO block contains a non-allowlisted executable keyword');

  const executePattern =
    /\bEXECUTE\s+(?:format\(\s*)?'((?:''|[^'])*)'(?:\s*,\s*role_name\s*\))?/gi;
  const executes = [...body.matchAll(executePattern)];
  const executeCount = [...body.matchAll(/\bEXECUTE\b/gi)].length;
  if (executeCount === 0 || executes.length !== executeCount)
    errors.push(
      'every EXECUTE must be a literal GRANT/REVOKE command or format call',
    );
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const command = new RegExp(
    `^(?:REVOKE (?:ALL(?: PRIVILEGES)?|${PRIVILEGES.join('|')}) ON TABLE ${escapedTarget} FROM (?:%I|anon|authenticated|service_role|PUBLIC)|GRANT (?:ALL(?: PRIVILEGES)?|${PRIVILEGES.join('|')}) ON TABLE ${escapedTarget} TO (?:%I|anon|authenticated|service_role))$`,
    'i',
  );
  for (const execute of executes) {
    const value = (execute[1] ?? '')
      .replaceAll("''", "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!command.test(value))
      errors.push(`DO EXECUTE is not allowlisted for ${target}`);
  }

  for (const value of sqlStrings(body)) {
    if (
      /^[a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*$/i.test(value) &&
      value.toLowerCase() !== target
    )
      errors.push(`DO block names second relation ${value}`);
  }

  const scrubbed = body.replace(/'((?:''|[^'])*)'/g, "''");
  const functions = [...scrubbed.matchAll(/\b([a-z_][a-z0-9_$]*)\s*\(/gi)].map(
    (item) => item[1]!.toLowerCase(),
  );
  const allowedFunctions = new Set([
    'format',
    'coalesce',
    'unnest',
    'has_table_privilege',
    'exists',
    'any',
  ]);
  for (const fn of functions)
    if (!allowedFunctions.has(fn))
      errors.push(`DO block calls non-allowlisted function ${fn}`);

  const allowedWords = new Set([
    'declare',
    'role_name',
    'priv',
    'expected',
    'text',
    'boolean',
    'begin',
    'foreach',
    'in',
    'array',
    'loop',
    'if',
    'exists',
    'select',
    'from',
    'pg_catalog',
    'pg_roles',
    'pg_class',
    'where',
    'rolname',
    'then',
    'execute',
    'format',
    'end',
    'not',
    'oid',
    'regclass',
    'and',
    'any',
    'coalesce',
    'reloptions',
    'raise',
    'exception',
    'has_table_privilege',
    'is',
    'distinct',
    'true',
    'false',
  ]);
  for (const token of scrubbed.match(/[a-z_][a-z0-9_$]*/gi) ?? [])
    if (!allowedWords.has(token.toLowerCase()))
      errors.push(`DO block contains non-allowlisted token ${token}`);

  if (
    !/IF\s+(?:NOT\s+)?EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_catalog\.pg_roles\b/i.test(
      scrubbed,
    )
  )
    errors.push('DO block lacks an allowlisted pg_roles existence guard');
  if (!/\bFOREACH\s+role_name\s+IN\s+ARRAY\s+ARRAY\s*\[/i.test(scrubbed))
    errors.push('DO block lacks the allowlisted role-name FOREACH');
  if (!/\bhas_table_privilege\s*\(/i.test(scrubbed))
    errors.push('DO block lacks positive has_table_privilege checks');
  if (!/\bRAISE\s+EXCEPTION\b/i.test(scrubbed))
    errors.push('DO block lacks fail-closed RAISE EXCEPTION');

  const relations = [
    ...scrubbed.matchAll(
      /\b(?:FROM|JOIN|ON\s+TABLE)\s+([a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*)/gi,
    ),
  ]
    .map((item) => item[1]!.toLowerCase())
    .filter(
      (name) => !['pg_catalog.pg_roles', 'pg_catalog.pg_class'].includes(name),
    );
  for (const relation of relations)
    if (relation !== target)
      errors.push(`DO block names second relation ${relation}`);

  return [...new Set(errors)];
}

/** Classify only migrations carrying the anchored policy marker; invalid markers fail closed. */
export function classifyPrivilegeOnlyViewMigration(
  sql: string,
): PrivilegeOnlyClassification {
  const parsed = parseMarker(sql);
  if (!parsed.policy)
    return parsed.errors.length
      ? { kind: 'invalid', errors: parsed.errors }
      : { kind: 'ordinary', errors: [] };
  const policy = parsed.policy;
  const errors = [...parsed.errors];
  if (PRECONDITION_MARKER.test(sql) || EXEMPTION_MARKER.test(sql))
    errors.push(
      'PRIVILEGE-ONLY-VIEW cannot be combined with another precondition declaration',
    );
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) errors.push('marker has no executable SQL');
  const targets = new Set<string>();
  let alterCount = 0;
  let privilegeCount = 0;

  for (const [index, statement] of statements.entries()) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (/^(?:BEGIN|COMMIT)$/i.test(normalized)) continue;
    const alter = new RegExp(
      `^ALTER VIEW (${QUALIFIED_IDENT}) (?:SET \\(security_invoker = (?:true|false)\\)|RESET \\(security_invoker\\))$`,
      'i',
    ).exec(normalized);
    if (alter) {
      alterCount += 1;
      targets.add(alter[1]!.toLowerCase());
      continue;
    }
    const privilege = new RegExp(
      `^(GRANT|REVOKE) (ALL(?: PRIVILEGES)?|(?:${PRIVILEGES.join('|')})(?:\\s*,\\s*(?:${PRIVILEGES.join('|')}))*) ON (?:TABLE )?(${QUALIFIED_IDENT}) (TO|FROM) (PUBLIC|anon|authenticated|service_role)$`,
      'i',
    ).exec(normalized);
    if (privilege) {
      if (
        (privilege[1]!.toUpperCase() === 'GRANT') !==
        (privilege[4]!.toUpperCase() === 'TO')
      )
        errors.push(
          `statement ${index + 1} has mismatched GRANT/REVOKE direction`,
        );
      privilegeCount += 1;
      targets.add(privilege[3]!.toLowerCase());
      continue;
    }
    if (/^DO\b/i.test(normalized)) {
      for (const error of validateDoBlock(statement, policy.view))
        errors.push(`statement ${index + 1}: ${error}`);
      for (const value of sqlStrings(statement))
        if (value.toLowerCase().includes(policy.view)) targets.add(policy.view);
      privilegeCount += 1;
      continue;
    }
    errors.push(
      `statement ${index + 1} is not privilege-only: ${normalized.slice(0, 80)}`,
    );
  }
  if (alterCount === 0)
    errors.push('migration does not alter security_invoker');
  if (privilegeCount === 0)
    errors.push('migration does not change or verify privileges');
  if (targets.size !== 1 || !targets.has(policy.view))
    errors.push(
      `declared view ${policy.view} must be the one and only SQL target`,
    );
  if (!policy.securityInvoker)
    errors.push('alternate policy requires security_invoker=true');
  return errors.length > 0
    ? { kind: 'invalid', policy, errors: [...new Set(errors)] }
    : { kind: 'valid', policy, statements, errors: [] };
}

function assertScratchDsn(dsn: string): void {
  const url = new URL(dsn);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'Postgres DSN required',
  );
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'only loopback scratch Postgres is permitted',
  );
  assert.equal(url.search, '', 'DSN query overrides are prohibited');
}

function psql(
  dsn: string,
  args: string[],
  input?: string,
): { ok: boolean; stdout: string; stderr: string } {
  assertScratchDsn(dsn);
  try {
    const stdout = execFileSync(
      'psql',
      [
        dsn,
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        'VERBOSITY=verbose',
        ...args,
      ],
      {
        input,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio:
          input === undefined
            ? ['ignore', 'pipe', 'pipe']
            : ['pipe', 'pipe', 'pipe'],
      },
    );
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: detail.stdout ?? '',
      stderr: detail.stderr ?? '',
    };
  }
}

function snapshot(dsn: string, view: string): string {
  const roles = ROLES.map((role) => `'${role}'`).join(',');
  const privileges = PRIVILEGES.map((privilege) => `'${privilege}'`).join(',');
  const result = psql(dsn, [
    '-c',
    `
    SELECT jsonb_build_object(
      'kind', c.relkind,
      'options', coalesce(to_jsonb(c.reloptions), '[]'::jsonb),
      'acl', coalesce(to_jsonb(c.relacl), '[]'::jsonb),
      'privileges', (
        SELECT jsonb_object_agg(role_name || ':' || privilege, has_table_privilege(role_name, '${view}', privilege))
        FROM unnest(ARRAY[${roles}]) role_name
        CROSS JOIN unnest(ARRAY[${privileges}]) privilege
      )
    )::text
    FROM pg_catalog.pg_class c WHERE c.oid = '${view}'::regclass;
  `,
  ]);
  if (!result.ok) throw new Error(result.stderr);
  return result.stdout;
}

function verifyPolicy(dsn: string, policy: PrivilegeOnlyViewPolicy): string[] {
  const result = psql(dsn, [
    '-F',
    '|',
    '-c',
    `
    SELECT role_name, privilege, has_table_privilege(role_name, '${policy.view}', privilege)
    FROM unnest(ARRAY[${ROLES.map((role) => `'${role}'`).join(',')}]) role_name
    CROSS JOIN unnest(ARRAY[${PRIVILEGES.map((privilege) => `'${privilege}'`).join(',')}]) privilege
    ORDER BY role_name, privilege;
  `,
  ]);
  if (!result.ok) return [`privilege query failed: ${result.stderr}`];
  const errors: string[] = [];
  for (const row of result.stdout.split('\n').filter(Boolean)) {
    const [roleValue, privilegeValue, actualValue] = row.split('|');
    const role = roleValue as Role;
    const privilege = privilegeValue as Privilege;
    const posture = policy.roles[role];
    const expected =
      posture === 'all' || (posture === 'select' && privilege === 'SELECT');
    if ((actualValue === 't') !== expected)
      errors.push(
        `${role} ${privilege} expected ${expected ? 'allowed' : 'denied'}`,
      );
  }
  const options = psql(dsn, [
    '-c',
    `
    SELECT coalesce('security_invoker=true' = ANY (reloptions), false)
    FROM pg_catalog.pg_class WHERE oid = '${policy.view}'::regclass AND relkind = 'v';
  `,
  ]);
  if (
    !options.ok ||
    options.stdout !== String(policy.securityInvoker ? 't' : 'f')
  )
    errors.push(`security_invoker expected ${String(policy.securityInvoker)}`);
  return errors;
}

function applyFile(dsn: string, file: string): { ok: boolean; detail: string } {
  const result = psql(dsn, ['-f', file]);
  return {
    ok: result.ok,
    detail: result.ok ? 'applied' : result.stderr.trim(),
  };
}

export function runPrivilegeOnlyViewDrill(
  dsn: string,
  migrationPath: string,
  downPath = path.resolve(
    process.cwd(),
    'db/migrations-rollback',
    `${path.basename(migrationPath, '.sql')}.down.sql`,
  ),
): PrivilegeDrillCase[] {
  const sql = readFileSync(migrationPath, 'utf8');
  const classification = classifyPrivilegeOnlyViewMigration(sql);
  if (classification.kind !== 'valid')
    return [
      {
        name: 'classification',
        status: 'fail',
        detail:
          classification.kind === 'ordinary'
            ? 'anchored PRIVILEGE-ONLY-VIEW marker missing'
            : classification.errors.join('; '),
      },
    ];
  const { policy } = classification;
  const cases: PrivilegeDrillCase[] = [
    {
      name: 'classification',
      status: 'pass',
      detail: `single target ${policy.view}`,
    },
  ];
  if (!existsSync(downPath))
    return [
      ...cases,
      { name: 'down script', status: 'fail', detail: `missing ${downPath}` },
    ];

  const relation = psql(dsn, [
    '-c',
    `SELECT relkind FROM pg_catalog.pg_class WHERE oid = to_regclass('${policy.view}');`,
  ]);
  if (!relation.ok || relation.stdout !== 'v')
    return [
      ...cases,
      {
        name: 'target resolves to a view',
        status: 'fail',
        detail: relation.stdout
          ? `${policy.view} has relkind ${relation.stdout}`
          : `${policy.view} is unresolved`,
      },
    ];
  cases.push({
    name: 'target resolves to a view',
    status: 'pass',
    detail: `${policy.view} has relkind v`,
  });

  const setup = psql(
    dsn,
    [],
    `
    DO $roles$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $roles$;
    ALTER VIEW ${policy.view} RESET (security_invoker);
    REVOKE ALL PRIVILEGES ON TABLE ${policy.view} FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE ${policy.view} FROM anon, authenticated, service_role;
    GRANT ALL PRIVILEGES ON TABLE ${policy.view} TO anon, authenticated, service_role;
  `,
  );
  if (!setup.ok)
    return [
      ...cases,
      {
        name: 'permissive pre-state',
        status: 'fail',
        detail: setup.stderr.trim(),
      },
    ];
  const baseline = snapshot(dsn, policy.view);
  cases.push({
    name: 'permissive pre-state',
    status: 'pass',
    detail: 'roles hold ALL, PUBLIC none, security_invoker reset',
  });

  const first = applyFile(dsn, migrationPath);
  if (!first.ok)
    return [
      ...cases,
      { name: 'first apply', status: 'fail', detail: first.detail },
    ];
  const policyErrors = verifyPolicy(dsn, policy);
  cases.push({
    name: 'declared post-state',
    status: policyErrors.length ? 'fail' : 'pass',
    detail: policyErrors.length
      ? policyErrors.join('; ')
      : 'security option and all 21 role/privilege assertions match the marker',
  });
  if (policyErrors.length) return cases;
  const postUp = snapshot(dsn, policy.view);

  const down = applyFile(dsn, downPath);
  if (!down.ok)
    return [
      ...cases,
      { name: 'rollback apply', status: 'fail', detail: down.detail },
    ];
  const recovered = snapshot(dsn, policy.view);
  cases.push({
    name: 'rollback exact restoration',
    status: recovered === baseline ? 'pass' : 'fail',
    detail:
      recovered === baseline
        ? 'pre-state restored exactly'
        : 'down script did not restore reloptions, ACL, and effective privileges',
  });
  if (recovered !== baseline) return cases;

  const second = applyFile(dsn, migrationPath);
  if (!second.ok)
    return [
      ...cases,
      { name: 'reapply', status: 'fail', detail: second.detail },
    ];
  const postReapply = snapshot(dsn, policy.view);
  cases.push({
    name: 'up/down/up parity',
    status: postReapply === postUp ? 'pass' : 'fail',
    detail:
      postReapply === postUp
        ? 'reapply matches first apply exactly'
        : 'reapply differs from first apply',
  });
  return cases;
}

function main(): number {
  const args = process.argv.slice(2);
  const migrationPath = args.find((arg) => arg.endsWith('.sql'));
  if (!migrationPath) {
    console.error(
      'Usage: tsx scripts/ci/privilege-only-view-drill.ts <migration.sql> [--classify] [--json]',
    );
    return 2;
  }
  const classification = classifyPrivilegeOnlyViewMigration(
    readFileSync(migrationPath, 'utf8'),
  );
  if (args.includes('--classify')) {
    if (args.includes('--json'))
      console.log(JSON.stringify(classification, null, 2));
    else if (classification.kind === 'valid')
      console.log(
        `privilege-only-view classifier: PASS (${classification.policy.view})`,
      );
    else if (classification.kind === 'ordinary')
      console.log(
        'privilege-only-view classifier: ordinary migration (no marker)',
      );
    else
      console.error(
        `privilege-only-view classifier: FAIL — ${classification.errors.join('; ')}`,
      );
    return classification.kind === 'valid'
      ? 0
      : classification.kind === 'ordinary'
        ? 3
        : 1;
  }
  const dsn = process.env['POSTGRES_URL'];
  if (!dsn) {
    console.error('POSTGRES_URL must point to loopback scratch Postgres');
    return 2;
  }
  const cases = runPrivilegeOnlyViewDrill(dsn, migrationPath);
  const failures = cases.filter((item) => item.status === 'fail');
  if (args.includes('--json'))
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          gate: 'privilege-only-view-drill',
          migration: migrationPath,
          cases,
          ok: failures.length === 0,
        },
        null,
        2,
      ),
    );
  else {
    console.log(`privilege-only-view-drill: ${migrationPath}`);
    for (const item of cases)
      console.log(
        `  [${item.status.toUpperCase()}] ${item.name} — ${item.detail}`,
      );
    console.log(
      failures.length
        ? `privilege-only-view-drill: FAIL (${failures.length})`
        : 'privilege-only-view-drill: PASS',
    );
  }
  return failures.length ? 1 : 0;
}

if ((process.argv[1] ?? '').endsWith('privilege-only-view-drill.ts')) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
